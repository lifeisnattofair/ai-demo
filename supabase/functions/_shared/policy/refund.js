// Refund policy. Amounts are integer won: refund = floor(paid * num / den), fee = paid - refund.
import { dDay } from './time.js'

function result(paidAmount, cancellable, { num, den }, rule) {
  const refundAmount = Math.floor((paidAmount * num) / den)
  return { cancellable, refundAmount, feeAmount: paidAmount - refundAmount, rule }
}

export function refundForBeforeStart(paidAmount, baseAt, now) {
  const d = dDay(baseAt, now)
  if (d >= 8) return result(paidAmount, true, { num: 100, den: 100 }, 'D8_PLUS')
  if (d >= 4) return result(paidAmount, true, { num: 90, den: 100 }, 'D7_4')
  if (d >= 1) return result(paidAmount, true, { num: 70, den: 100 }, 'D3_1')
  return result(paidAmount, false, { num: 0, den: 1 }, 'SAME_DAY')
}

export function refundForCourse(paidAmount, lessonStarts, now) {
  if (!lessonStarts || lessonStarts.length === 0) throw new Error('lessonStarts required')
  const times = lessonStarts.map((s) => new Date(s).getTime()).sort((a, b) => a - b)
  const nowMs = new Date(now).getTime()
  const total = times.length
  const started = times.filter((t) => t <= nowMs).length
  if (started === 0) return refundForBeforeStart(paidAmount, new Date(times[0]), now)
  if (started * 3 < total) return result(paidAmount, true, { num: 2, den: 3 }, 'MID_BEFORE_1_3')
  if (started * 2 < total) return result(paidAmount, true, { num: 1, den: 2 }, 'MID_BEFORE_1_2')
  return result(paidAmount, true, { num: 0, den: 1 }, 'MID_AFTER_1_2')
}

export function calcRefund({ productType, paidAmount, baseAt, lessonStarts, now }) {
  if (productType === 'PERFORMANCE' || productType === 'EXPERIENCE') {
    return refundForBeforeStart(paidAmount, baseAt, now)
  }
  if (productType === 'COURSE') return refundForCourse(paidAmount, lessonStarts, now)
  throw new Error('unknown productType: ' + String(productType))
}
