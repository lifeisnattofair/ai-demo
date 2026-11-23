// 결제 승인 오케스트레이션 (의존성 없음, Node/Deno 공용)
//
// 순서: 기존 예약 확인(멱등) -> lock_for_confirm -> 소유자/금액 재검증 -> pg.confirm -> finalize_booking
// - 잠금이나 금액 검증이 실패하면 pg.confirm을 부르지 않습니다(승인 전이라 취소할 것이 없음).
// - 승인 뒤 확정이 실패하면 반드시 pg.cancel로 자동 취소하고 선점을 되돌립니다.
//
// db 어댑터 계약
//   db.rpc(name, args) -> data       // SQL 오류는 code(= SQL 오류 메시지)를 가진 오류로 던집니다.
//   db.findBookingByOrder(orderId) -> bookings 행 | null

import { priceItems } from '../policy/pricing.js'
import { PG_ERROR_MESSAGES } from './gateway.js'

export const CANCEL_MESSAGES = {
  HOLD_EXPIRED: '좌석 선점 시간이 지나 결제가 진행되지 않았습니다. 좌석을 다시 선택해 주세요.',
  AMOUNT_MISMATCH: '결제 금액이 예약 금액과 달라 결제를 진행하지 않았습니다. 다시 시도해 주세요.',
  FINALIZE_FAILED: '예약을 확정하지 못해 결제를 자동으로 취소했습니다. 잠시 후 다시 시도해 주세요.',
  PAYMENT_REJECTED: '카드사에서 결제를 승인하지 않았습니다. 다른 결제 수단으로 다시 시도해 주세요.',
}

// 확정 여부를 확인하지 못해 취소를 보류한 경우의 안내(정리 작업이 이어서 처리)
export const FINALIZE_PENDING_MESSAGE = '결제 처리 결과를 확인하고 있습니다. 잠시 후 내 예약에서 확인해 주세요.'

// 자동 취소까지 실패한 드문 경우의 안내
export const REFUND_PENDING_MESSAGE =
  '예약을 확정하지 못했고 결제 취소도 아직 완료되지 않았습니다. 예매 내역에서 결제 상태를 확인하시거나 문의해 주세요.'

export const CONFIRM_ERROR_MESSAGES = {
  ...PG_ERROR_MESSAGES,
  UNAUTHENTICATED: '로그인이 필요합니다. 로그인한 뒤 다시 시도해 주세요.',
  INVALID_REQUEST: '결제 요청 정보가 올바르지 않습니다. 처음부터 다시 시도해 주세요.',
  NOT_OWNER: '본인의 예약만 결제할 수 있습니다. 로그인한 계정을 확인해 주세요.',
  ORDER_NOT_FOUND: '주문 정보를 찾을 수 없습니다. 좌석을 다시 선택해 주세요.',
  PAYMENT_IN_PROGRESS: '같은 주문의 결제가 진행 중입니다. 잠시 후 예매 내역을 확인해 주세요.',
  NOT_ON_SALE: '판매가 종료된 회차라 결제를 진행하지 않았습니다. 다른 회차를 선택해 주세요.',
}

export class ConfirmError extends Error {
  constructor(code, message = CONFIRM_ERROR_MESSAGES[code] ?? code) {
    super(message)
    this.name = 'ConfirmError'
    this.code = code
  }
}

// 주문번호: HB-YYYYMMDD-영숫자 10자리 (결제대행사 규칙 6~64자, 영숫자/-/_ 준수). 날짜는 KST 기준.
export const ORDER_ID_RE = /^HB-\d{8}-[A-Za-z0-9]{10}$/

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export function createOrderId(now) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll('-', '')
  let rand = ''
  while (rand.length < 10) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      // 248 = 62 * 4. 그 이상은 버려 치우침을 없앱니다.
      if (b < 248 && rand.length < 10) rand += ALNUM[b % 62]
    }
  }
  return `HB-${kst}-${rand}`
}

const errCode = (e) => e?.code ?? e?.message

const cancelled = (reason) => ({ status: 'CANCELLED', reason, message: CANCEL_MESSAGES[reason] })

function confirmed(booking, userId) {
  if (booking.user_id !== userId) throw new ConfirmError('NOT_OWNER')
  return { status: 'CONFIRMED', booking }
}

function validInput({ userId, paymentKey, orderId, amount }) {
  return (
    typeof userId === 'string' && userId.length > 0 &&
    typeof paymentKey === 'string' && paymentKey.length > 0 && paymentKey.length <= 200 &&
    typeof orderId === 'string' && ORDER_ID_RE.test(orderId) &&
    Number.isInteger(amount) && amount > 0
  )
}

// 승인된 결제를 전액 취소합니다. 응답 유실에 대비해 한 번 더 시도하고 상태를 확인합니다.
async function cancelCharge(pg, paymentKey) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await pg.cancel(paymentKey, { cancelReason: '예약 확정 실패' })
      return true
    } catch (e) {
      try {
        if ((await pg.get(paymentKey)).status === 'CANCELED') return true
      } catch {
        // 다음 시도로 넘어갑니다.
      }
      if (attempt === 1) console.error('pg.cancel failed', paymentKey, errCode(e))
    }
  }
  return false
}

export async function confirmPayment({ db, pg }, { userId, paymentKey, orderId, amount }) {
  if (!validInput({ userId, paymentKey, orderId, amount })) throw new ConfirmError('INVALID_REQUEST')

  // 1) 멱등: 이미 확정된 주문이면 결제대행사를 다시 부르지 않습니다.
  const existing = await db.findBookingByOrder(orderId)
  if (existing) return confirmed(existing, userId)

  // 2) 선점 잠금(ACTIVE -> PAYING)
  let hold
  try {
    hold = await db.rpc('lock_for_confirm', { p_order_id: orderId })
  } catch (e) {
    const code = errCode(e)
    if (code === 'HOLD_EXPIRED') return cancelled('HOLD_EXPIRED')
    if (code === 'ALREADY_CONFIRMED') {
      const booking = await db.findBookingByOrder(orderId)
      if (booking) return confirmed(booking, userId)
    }
    throw e
  }

  const unlock = async () => {
    try {
      await db.rpc('unlock_after_failure', { p_order_id: orderId })
    } catch (e) {
      console.error('unlock_after_failure failed', orderId, errCode(e))
    }
  }

  // 3) 소유자와 금액 재검증. 단가/할인은 prepare_payment가 서버 가격으로 저장한 holds.items를 씁니다.
  if (hold.user_id !== userId) {
    await unlock()
    throw new ConfirmError('NOT_OWNER')
  }
  const items = Array.isArray(hold.items) ? hold.items : []
  const { total } = priceItems(items.map((i) => ({ unitPrice: i.unitPrice, discountType: i.discountType })))
  if (items.length === 0 || items.length !== hold.qty || total !== hold.amount || total !== amount) {
    await unlock()
    return cancelled('AMOUNT_MISMATCH')
  }

  // 4) 결제 승인
  let payment
  try {
    payment = await pg.confirm({ paymentKey, orderId, amount })
  } catch (e) {
    if (errCode(e) === 'ALREADY_PROCESSED_PAYMENT') {
      // 앞선 요청이 승인까지 마쳤을 수 있으니 상태를 확인합니다.
      try {
        const p = await pg.get(paymentKey)
        if (p.orderId === orderId && p.status === 'DONE' && p.totalAmount === amount) payment = p
      } catch {
        // 확인 실패는 아래에서 원래 오류로 처리합니다.
      }
    }
    if (!payment) {
      await unlock()
      if (errCode(e) === 'REJECT_CARD_PAYMENT') return cancelled('PAYMENT_REJECTED')
      throw e
    }
  }

  // 5) 예약 확정. 실패하면 자동 취소.
  try {
    if (payment.orderId !== orderId || payment.status !== 'DONE' || payment.totalAmount !== amount) {
      throw new ConfirmError('PG_RESPONSE_MISMATCH')
    }
    const booking = await db.rpc('finalize_booking', {
      p_order_id: orderId, p_payment_key: paymentKey, p_raw: payment,
    })
    return { status: 'CONFIRMED', booking }
  } catch (e) {
    console.error('finalize_booking failed', orderId, errCode(e))
    // 확정은 커밋됐는데 응답만 잃었을 수 있습니다. 그때 취소하면 확정된 예약의 결제를 지우게 됩니다.
    // 조회가 두 번 다 실패하면 확정 여부를 모르므로 취소하지 않고 정리 작업(sweep의 결제 중 정리)에 맡깁니다.
    let lookup = { ok: false, booking: null }
    for (let attempt = 0; attempt < 2 && !lookup.ok; attempt++) {
      try {
        lookup = { ok: true, booking: await db.findBookingByOrder(orderId) }
      } catch (le) {
        console.error('findBookingByOrder failed', orderId, errCode(le))
      }
    }
    if (!lookup.ok) {
      console.error('finalize outcome unknown; charge kept for reconciliation', orderId, paymentKey)
      return { status: 'CANCELLED', reason: 'FINALIZE_FAILED', refunded: false, message: FINALIZE_PENDING_MESSAGE }
    }
    if (lookup.booking) return { status: 'CONFIRMED', booking: lookup.booking }

    const refunded = await cancelCharge(pg, paymentKey)
    if (refunded) {
      await unlock()
    } else {
      // 자동 환불이 실패했으면 선점을 PAYING으로 둡니다. 풀면 다음 prepare_payment가 order_id를 덮어써
      // 승인 기록과의 연결을 잃고 같은 좌석을 다시 팔 수 있습니다. sweep은 승인된(order_has_charge) PAYING을 건드리지 않습니다.
      console.error('auto-refund failed; hold kept PAYING for reconciliation', orderId, paymentKey)
    }
    return refunded
      ? { ...cancelled('FINALIZE_FAILED'), refunded }
      : { status: 'CANCELLED', reason: 'FINALIZE_FAILED', message: REFUND_PENDING_MESSAGE, refunded }
  }
}
