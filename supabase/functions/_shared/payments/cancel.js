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
// - 이전 시도가 PG 취소까지 마치고 확정에 실패했다면(cancel_rule 기록 + pg.get의 cancels가 있음) 지금 정책을 다시 보지 않고
//   PG가 실제로 돌려준 금액과 처음 시도의 규칙(bookings.cancel_rule)으로 확정합니다.
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

const lastTxKey = (p) => p.cancels[p.cancels.length - 1].transactionKey

// 첫 시도: 환불액만큼 PG 취소(USER는 금액 지정, INSTITUTION은 남은 금액 전액). before는 클레임 뒤 다시 읽은 결제입니다.
async function chargeBack(pg, ctx, reason, policy, before) {
  const opts = { cancelReason: PG_REASON[reason] }
  if (reason === 'USER') opts.cancelAmount = policy.refundAmount
  const after = await pg.cancel(ctx.paymentKey, opts)
  const refunded = before.balanceAmount - after.balanceAmount
  return { refundAmount: refunded, feeAmount: ctx.paidAmount - refunded, txKey: lastTxKey(after) }
}

// 클레임 전 확인: 이전 시도가 있었고(cancelRule 기록) PG에 취소가 있으면 그 결제를 돌려줍니다.
// 이 경우 지금 정책(당일, 구간 변경)을 보지 않고 확정해야 하므로 정책 검사보다 먼저 봅니다.
// cancelRule이 없는 첫 시도는 여기서 PG를 조회하지 않습니다(당일 거절은 PG 호출 없음).
// 동시 시도나 이 흐름 밖의 PG 취소는 클레임 뒤 다시 읽어 잡습니다(cancelBooking 참고).
async function priorCharge(pg, ctx) {
  if (!ctx.cancelRule || !ctx.paymentKey) return null
  const payment = await pg.get(ctx.paymentKey)
  return payment.cancels.length > 0 ? payment : null
}

async function finalize(db, bookingId, reason, rule, refund) {
  await db.rpc('finalize_cancel', {
    p_booking: bookingId,
    p_refund: refund.refundAmount,
    p_fee: refund.feeAmount,
    p_rule: rule,
    p_reason: reason,
    p_tx_key: refund.txKey,
  })
  return done({ refundAmount: refund.refundAmount, feeAmount: refund.feeAmount, rule })
}

// 이미 PG에서 돈이 나간 결제로 확정합니다. 금액은 PG 기록, 규칙은 처음 시도의 규칙(없으면 지금 정책).
async function finalizeFromPg(db, pg, bookingId, ctx, reason, payment, fallbackRule) {
  let rule = ctx.cancelRule ?? fallbackRule
  // 회원 부분 환불 뒤 확정 전에 회차가 기관 취소되면 남은 금액도 돌려 드립니다.
  if (reason === 'INSTITUTION' && payment.balanceAmount > 0) {
    payment = await pg.cancel(ctx.paymentKey, { cancelReason: PG_REASON.INSTITUTION })
    rule = 'INSTITUTION_FULL'
  }
  // 기관 취소 시도가 남긴 환불이면 회원이 다시 눌러도 기관 사유로 기록합니다.
  const finalReason = rule === 'INSTITUTION_FULL' ? 'INSTITUTION' : reason
  const refunded = payment.totalAmount - payment.balanceAmount
  return finalize(db, bookingId, finalReason, rule, {
    refundAmount: refunded, feeAmount: ctx.paidAmount - refunded, txKey: lastTxKey(payment),
  })
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

  if (reason === 'USER' && ctx.ownerId !== userId) return rejected('NOT_OWNER')
  if (ctx.status === 'CANCELLED') {
    if (ctx.refund) return done(ctx.refund)
    return { status: 'CANCELLED', refundAmount: 0, feeAmount: ctx.paidAmount, rule: null }
  }

  // 재시도: 돈이 이미 나갔으면 지금 정책과 관계없이 PG 기록과 처음 시도의 규칙으로 확정합니다.
  const prior = await priorCharge(pg, ctx)

  let policy = null
  if (!prior) {
    if (reason === 'USER' && ctx.offeringStatus && ctx.offeringStatus !== 'OPEN') return rejected('OFFERING_CANCELLING')
    policy = policyFor(ctx, reason, now)
    if (!policy.cancellable) return rejected('SAME_DAY')
  }

  // 같은 예약의 동시 취소를 막습니다(부분 환불이 두 번 나가지 않도록). 첫 시도는 규칙을 cancel_rule에 남깁니다.
  // pg.cancel과 finalize_cancel 사이에서 프로세스가 죽으면 abort_cancel이 불리지 않아 표시가 남습니다.
  // 그 5분 동안은 CANCEL_IN_PROGRESS로 거절되고, 그 뒤 재시도가 PG 기록대로 확정합니다.
  if (!(await db.rpc('begin_cancel', { p_booking: bookingId, p_rule: prior ? null : policy.rule }))) {
    const again = await db.rpc('cancel_context', { p_booking: bookingId })
    if (again.status === 'CANCELLED' && again.refund) return done(again.refund)
    return rejected('CANCEL_IN_PROGRESS')
  }

  try {
    if (prior) return await finalizeFromPg(db, pg, bookingId, ctx, reason, prior, null)

    // 클레임을 잡은 뒤 PG를 다시 읽습니다. 앞선 시도가 클레임을 쥔 채 PG 취소까지 하고 확정에 실패했거나
    // (이 시도가 ctx를 읽은 뒤의 일), 이 흐름 밖에서 PG 취소가 있었다면 다시 취소하지 않고 그 기록으로 확정합니다.
    if (ctx.paymentKey) {
      const current = await pg.get(ctx.paymentKey)
      if (current.cancels.length > 0) return await finalizeFromPg(db, pg, bookingId, ctx, reason, current, policy.rule)
      if (policy.refundAmount > 0) {
        return await finalize(db, bookingId, reason, policy.rule, await chargeBack(pg, ctx, reason, policy, current))
      }
    } else if (policy.refundAmount > 0) {
      throw new CancelError('PAYMENT_NOT_FOUND')
    }
    return await finalize(db, bookingId, reason, policy.rule, { refundAmount: 0, feeAmount: ctx.paidAmount, txKey: null })
  } catch (e) {
    // PG 취소 뒤 확정만 실패했으면 다음 시도가 그 취소를 이어 씁니다.
    console.error('cancelBooking failed', bookingId, errCode(e))
    try {
      await db.rpc('abort_cancel', { p_booking: bookingId })
    } catch (ae) {
      console.error('abort_cancel failed', bookingId, errCode(ae))
    }
    throw e
  }
}

export const PENDING_PAYMENTS_MESSAGE = (n) =>
  `결제가 진행 중인 예약 ${n}건이 남아 있습니다. 잠시 후 일괄 취소를 다시 실행해 주세요.`

export async function cancelOffering({ db, pg, now }, { userId, offeringId }) {
  if (typeof offeringId !== 'string' || offeringId.length === 0) throw new CancelError('INVALID_REQUEST')
  if ((await db.getRole(userId)) !== 'finance') throw new CancelError('FORBIDDEN')

  const { bookingIds, pendingPayments } = await db.rpc('begin_offering_cancel', { p_offering: offeringId, p_actor: userId })
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
  // 결제 중(PAYING)이던 선점은 확정될 수 있으므로 건수를 알려 다시 실행하게 합니다.
  const pending = pendingPayments ?? 0
  const result = { offeringId, cancelled, failed, pending }
  if (pending > 0) result.pendingMessage = PENDING_PAYMENTS_MESSAGE(pending)
  return result
}
