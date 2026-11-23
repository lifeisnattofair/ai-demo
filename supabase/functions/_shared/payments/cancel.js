// 예약 취소와 환불 오케스트레이션 (의존성 없음, Node/Deno 공용)
//
// 회원 취소(USER): cancel_context -> 소유자/상태 확인 -> calcRefund -> begin_cancel(동시 취소 방지)
//                 -> pg.cancel(환불액이 있을 때만) -> finalize_cancel
// 기관 취소(INSTITUTION): 정책과 관계없이 전액 환불(rule INSTITUTION_FULL), cancelAmount를 생략해 남은 금액 전액 취소.
// 회차 일괄 취소(cancelOffering): begin_offering_cancel(정산 담당 + 승인된 요청, 회차 CANCELLED, 판매/대기 닫기)
//                 -> CONFIRMED 예약마다 cancelBooking(INSTITUTION)을 순차 실행, 실패 건은 목록으로 돌려줌.
//
// 멱등
// - 이미 CANCELLED인 예약은 기록된 환불 결과를 그대로 돌려주고 결제대행사를 부르지 않습니다.
// - 이전 시도가 PG 취소까지 마치고 확정에 실패했다면(pg.get의 cancels가 있음) PG를 다시 부르지 않고 그 취소로 확정합니다.
//
// db 어댑터 계약
//   db.rpc(name, args) -> data   // SQL 오류는 code(= SQL 오류 메시지)를 가진 오류로 던집니다.
//   db.getRole(userId) -> 'member'|'operator'|'finance'|null

import { calcRefund } from '../policy/refund.js'
import { PG_ERROR_MESSAGES } from './gateway.js'

export const CANCEL_REJECT_MESSAGES = {
  SAME_DAY: '관람(개강) 당일에는 취소할 수 없습니다.',
  NOT_OWNER: '본인 예약만 취소할 수 있습니다.',
  BOOKING_NOT_FOUND: '예약 정보를 찾을 수 없습니다. 내 예약에서 다시 확인해 주세요.',
  CANCEL_IN_PROGRESS: '취소를 처리하고 있습니다. 잠시 후 내 예약에서 결과를 확인해 주세요.',
  OFFERING_CANCELLING: '기관 사정으로 회차 취소가 진행 중입니다. 취소가 확정되면 전액 환불해 드립니다.',
}

export const CANCEL_ERROR_MESSAGES = {
  ...PG_ERROR_MESSAGES,
  UNAUTHENTICATED: '로그인이 필요합니다. 로그인한 뒤 다시 시도해 주세요.',
  INVALID_REQUEST: '취소 요청 정보가 올바르지 않습니다. 내 예약에서 다시 시도해 주세요.',
  FORBIDDEN: '회차 일괄 취소는 정산 담당만 할 수 있습니다. 담당자 계정으로 로그인해 주세요.',
  CANCEL_NOT_APPROVED: '승인된 회차 취소 요청이 없습니다. 취소 요청을 먼저 승인해 주세요.',
  OFFERING_NOT_FOUND: '회차 정보를 찾을 수 없습니다. 회차 목록에서 다시 확인해 주세요.',
  OFFERING_NOT_CANCELLED: '회차가 취소되지 않아 기관 사유 환불을 할 수 없습니다. 회차 취소 승인을 먼저 확인해 주세요.',
  PAYMENT_NOT_FOUND: '결제 정보를 찾을 수 없어 환불하지 못했습니다. 결제 내역을 확인해 주세요.',
  AMOUNT_MISMATCH: '환불 금액이 결제 금액과 맞지 않아 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.',
}

export class CancelError extends Error {
  constructor(code, message = CANCEL_ERROR_MESSAGES[code] ?? code) {
    super(message)
    this.name = 'CancelError'
    this.code = code
  }
}

const REASONS = new Set(['USER', 'INSTITUTION'])
const PG_REASON = { USER: '고객 취소', INSTITUTION: '기관 사정 취소' }

const errCode = (e) => e?.code ?? e?.message
const rejected = (code) => ({ status: 'REJECTED', message: CANCEL_REJECT_MESSAGES[code] })
const done = ({ refundAmount, feeAmount, rule }) => ({ status: 'CANCELLED', refundAmount, feeAmount, rule })

function policyFor(ctx, reason, now) {
  if (reason === 'INSTITUTION') {
    return { cancellable: true, refundAmount: ctx.paidAmount, feeAmount: 0, rule: 'INSTITUTION_FULL' }
  }
  return calcRefund({
    productType: ctx.productType,
    paidAmount: ctx.paidAmount,
    baseAt: new Date(ctx.baseAt),
    lessonStarts: ctx.lessonStarts ?? undefined,
    now,
  })
}

// 환불액만큼 PG 취소. 이전 시도가 이미 취소했다면 그 거래를 씁니다.
async function chargeBack(pg, ctx, reason, policy) {
  const payment = await pg.get(ctx.paymentKey)
  if (payment.cancels.length > 0) {
    const refunded = payment.totalAmount - payment.balanceAmount
    return {
      refundAmount: refunded,
      feeAmount: ctx.paidAmount - refunded,
      txKey: payment.cancels[payment.cancels.length - 1].transactionKey,
    }
  }
  const opts = { cancelReason: PG_REASON[reason] }
  if (reason === 'USER') opts.cancelAmount = policy.refundAmount
  const after = await pg.cancel(ctx.paymentKey, opts)
  const refunded = payment.balanceAmount - after.balanceAmount
  return {
    refundAmount: refunded,
    feeAmount: ctx.paidAmount - refunded,
    txKey: after.cancels[after.cancels.length - 1].transactionKey,
  }
}

export async function cancelBooking({ db, pg, now }, { userId, bookingId, reason }) {
  if (typeof bookingId !== 'string' || bookingId.length === 0 || !REASONS.has(reason) || !(now instanceof Date)) {
    throw new CancelError('INVALID_REQUEST')
  }

  let ctx
  try {
    ctx = await db.rpc('cancel_context', { p_booking: bookingId })
  } catch (e) {
    if (errCode(e) === 'BOOKING_NOT_FOUND') return rejected('BOOKING_NOT_FOUND')
    throw e
  }

  if (reason === 'USER') {
    if (ctx.ownerId !== userId) return rejected('NOT_OWNER')
  }
  if (ctx.status === 'CANCELLED') {
    if (ctx.refund) return done(ctx.refund)
    return { status: 'CANCELLED', refundAmount: 0, feeAmount: ctx.paidAmount, rule: null }
  }
  if (reason === 'USER' && ctx.offeringStatus && ctx.offeringStatus !== 'OPEN') return rejected('OFFERING_CANCELLING')

  const policy = policyFor(ctx, reason, now)
  if (!policy.cancellable) return rejected('SAME_DAY')

  // 같은 예약의 동시 취소를 막습니다(부분 환불이 두 번 나가지 않도록).
  if (!(await db.rpc('begin_cancel', { p_booking: bookingId }))) {
    const again = await db.rpc('cancel_context', { p_booking: bookingId })
    if (again.status === 'CANCELLED' && again.refund) return done(again.refund)
    return rejected('CANCEL_IN_PROGRESS')
  }

  const abort = async () => {
    try {
      await db.rpc('abort_cancel', { p_booking: bookingId })
    } catch (e) {
      console.error('abort_cancel failed', bookingId, errCode(e))
    }
  }

  let refund = { refundAmount: 0, feeAmount: ctx.paidAmount, txKey: null }
  try {
    if (policy.refundAmount > 0) {
      if (!ctx.paymentKey) throw new CancelError('PAYMENT_NOT_FOUND')
      refund = await chargeBack(pg, ctx, reason, policy)
    }
    await db.rpc('finalize_cancel', {
      p_booking: bookingId,
      p_refund: refund.refundAmount,
      p_fee: refund.feeAmount,
      p_rule: policy.rule,
      p_reason: reason,
      p_tx_key: refund.txKey,
    })
  } catch (e) {
    // PG 취소 뒤 확정만 실패했으면 다시 시도할 때 chargeBack이 그 취소를 이어 씁니다.
    console.error('cancelBooking failed', bookingId, errCode(e))
    await abort()
    throw e
  }
  return done({ refundAmount: refund.refundAmount, feeAmount: refund.feeAmount, rule: policy.rule })
}

export async function cancelOffering({ db, pg, now }, { userId, offeringId }) {
  if (typeof offeringId !== 'string' || offeringId.length === 0) throw new CancelError('INVALID_REQUEST')
  if ((await db.getRole(userId)) !== 'finance') throw new CancelError('FORBIDDEN')

  const { bookingIds } = await db.rpc('begin_offering_cancel', { p_offering: offeringId, p_actor: userId })
  const cancelled = []
  const failed = []
  for (const bookingId of bookingIds ?? []) {
    try {
      const res = await cancelBooking({ db, pg, now }, { userId, bookingId, reason: 'INSTITUTION' })
      if (res.status === 'CANCELLED') cancelled.push({ bookingId, ...res })
      else failed.push({ bookingId, code: 'REJECTED', message: res.message })
    } catch (e) {
      const code = errCode(e) ?? 'INTERNAL'
      failed.push({ bookingId, code, message: CANCEL_ERROR_MESSAGES[code] ?? '환불 처리 중 문제가 생겼습니다. 다시 시도해 주세요.' })
    }
  }
  return { offeringId, cancelled, failed }
}
