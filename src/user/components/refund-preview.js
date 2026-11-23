// 취소 환불 미리보기. 금액과 규칙은 서버와 같은 정책 코드(@policy/refund.js)로 계산하고,
// 현재 시각은 인자로 받습니다(SFR-025). 화면에서는 서버 시각과 맞춘 clock.now() 를 넘깁니다.
import { calcRefund } from '@policy/refund.js';
import { won } from '../../lib/format.js';

export const SAME_DAY_MESSAGE = '관람(개강) 당일에는 취소할 수 없습니다.';
export const NO_REFUND_MESSAGE = '지금 취소하면 환불 금액이 없습니다.';
export const ENDED_MESSAGE = '이미 끝난 예약은 취소할 수 없습니다.';

// 취소 규칙 코드를 화면 문구로 바꿉니다.
export const RULE_TEXT = {
  D8_PLUS: '관람(개강) 8일 전까지 취소: 수수료 없음',
  D7_4: '관람(개강) 7 - 4일 전 취소: 수수료 10%',
  D3_1: '관람(개강) 3 - 1일 전 취소: 수수료 30%',
  SAME_DAY: SAME_DAY_MESSAGE,
  MID_BEFORE_1_3: '수업 1/3 경과 전 취소: 2/3 환불',
  MID_BEFORE_1_2: '수업 1/2 경과 전 취소: 1/2 환불',
  MID_AFTER_1_2: '수업 1/2 경과 후 취소: 환불 없음',
  INSTITUTION_FULL: '기관 사정에 따른 취소: 전액 환불',
};

export function isEnded(booking, now) {
  const end = booking.offering.ends_at ?? booking.offering.starts_at;
  return new Date(end).getTime() <= now.getTime();
}

/**
 * @param {object} booking my_bookings_overview 한 건
 * @param {Date} now
 * @returns {{state:'ended'|'blocked'|'zero'|'refund', refundAmount:number, feeAmount:number, rule:string|null, sentence:string}}
 */
export function refundPreview(booking, now) {
  if (isEnded(booking, now)) return { state: 'ended', refundAmount: 0, feeAmount: 0, rule: null, sentence: ENDED_MESSAGE };

  const type = booking.program.type;
  const lessons = booking.lesson_starts ?? [];
  const paid = booking.payment?.amount ?? booking.total_amount;
  // 서버(cancel_context)와 같게: 기준 시각은 첫 수업이 있으면 첫 수업, 없으면 회차 시작
  const baseAt = new Date(lessons[0] ?? booking.offering.starts_at);
  const r = calcRefund({
    productType: type === 'COURSE' && lessons.length === 0 ? 'EXPERIENCE' : type,
    paidAmount: paid,
    baseAt,
    lessonStarts: lessons.length ? lessons : undefined,
    now,
  });
  if (!r.cancellable) return { state: 'blocked', refundAmount: 0, feeAmount: 0, rule: r.rule, sentence: SAME_DAY_MESSAGE };
  if (r.refundAmount === 0) return { state: 'zero', refundAmount: 0, feeAmount: r.feeAmount, rule: r.rule, sentence: NO_REFUND_MESSAGE };
  const fee = r.feeAmount > 0 ? `취소 수수료 ${won(r.feeAmount)}` : '취소 수수료 없음';
  return {
    state: 'refund', refundAmount: r.refundAmount, feeAmount: r.feeAmount, rule: r.rule,
    sentence: `지금 취소하면 ${won(r.refundAmount)}이 환불됩니다(${fee}).`,
  };
}
