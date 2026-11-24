// 예약 카드: 목록과 상세가 함께 씁니다. 펼치면 결제 정보와 환불 미리보기, 예약 취소가 나옵니다.
import { describeError } from '../../lib/api.js';
import { dateRange, kstDateTime, won } from '../../lib/format.js';
import { confirmDialog } from '../../components/dialog.js';
import { isBusy, withBusy } from '../../components/button-busy.js';
import { renderPoster } from './poster.js';
import { posterProps, typeMark } from './program-card.js';
import { DISCOUNT_LABELS } from './checkout-data.js';
import { GRADE_NAME } from './seat-map.js';
import { refundPreview, isEnded, RULE_TEXT } from './refund-preview.js';

let seq = 0;

function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function row(label, value) {
  const d = node('div');
  d.append(node('span', null, label), document.createTextNode(value));
  return d;
}

/** @returns {'upcoming'|'past'|'cancelled'} */
export function bookingGroup(b, now) {
  if (b.status === 'CANCELLED') return 'cancelled';
  return isEnded(b, now) ? 'past' : 'upcoming';
}

const STATUS = {
  upcoming: { PERFORMANCE: '예매 완료', EXPERIENCE: '예약 완료', COURSE: '수강 확정' },
  past: { PERFORMANCE: '관람 완료', EXPERIENCE: '체험 완료', COURSE: '수강 종료' },
};

export function statusLabel(b, now) {
  const g = bookingGroup(b, now);
  if (g === 'cancelled') return { text: '예약 취소', cls: 'closed' };
  return { text: STATUS[g][b.program.type] ?? '예약 완료', cls: g === 'upcoming' ? 'on' : 'closed' };
}

function seatText(b) {
  const seats = b.items.filter((i) => i.row_label).map((i) => `${GRADE_NAME[i.grade] ?? i.grade} ${i.row_label}열 ${i.seat_no}번`);
  return seats.join(', ');
}

function discountText(b) {
  const counts = new Map();
  for (const i of b.items) {
    if (i.discount_type && i.discount_type !== 'GENERAL' && DISCOUNT_LABELS[i.discount_type]) {
      counts.set(i.discount_type, (counts.get(i.discount_type) ?? 0) + 1);
    }
  }
  return [...counts].map(([t, n]) => `${DISCOUNT_LABELS[t]} ${n}`).join(', ');
}

function metaRows(b) {
  const { type } = b.program;
  const rows = [];
  if (type === 'PERFORMANCE') {
    rows.push(row('관람일시', kstDateTime(b.offering.starts_at)));
    const seats = seatText(b);
    if (seats) rows.push(row('좌석', seats));
  } else if (type === 'EXPERIENCE') {
    rows.push(row('체험일시', kstDateTime(b.offering.starts_at)));
    rows.push(row('인원', `${b.items.length}명`));
  } else {
    const lessons = b.lesson_starts ?? [];
    const first = lessons[0] ?? b.offering.starts_at;
    const last = lessons[lessons.length - 1] ?? b.offering.ends_at;
    rows.push(row('수업 기간', `${dateRange(first, last, { weekday: true })}${lessons.length ? ` (${lessons.length}회)` : ''}`));
    rows.push(row('신청 인원', '본인 1명'));
  }
  // 할인 내역은 좌석 문구 뒤 괄호에 붙이면 좁은 폭에서 괄호 안이 끊기므로 따로 보입니다(QA D-03).
  const disc = discountText(b);
  if (disc) rows.push(row('할인', disc));
  if (b.program.venue) rows.push(row('장소', b.program.venue));
  return rows;
}

function paymentList(b) {
  const ul = node('ul', 'sum-list');
  const items = [];
  if (b.payment?.approved_at) items.push(['결제일시', kstDateTime(b.payment.approved_at)]);
  items.push(['결제 금액', won(b.payment?.amount ?? b.total_amount)]);
  items.push(['결제 수단', '모의 결제']);
  if (discountText(b)) items.push(['할인 증빙', '방문 당일 현장에서 확인']);
  for (const [k, v] of items) {
    const li = node('li');
    li.append(node('span', null, k), node('span', null, v));
    ul.append(li);
  }
  return ul;
}

function refundBox(b, now, onCancel) {
  const box = node('div', 'refund-box');
  const p = refundPreview(b, now);

  if (p.state === 'ended') {
    box.append(node('p', 'refund-line', p.sentence));
    return box;
  }
  const head = node('span', 'refund-label', p.state === 'blocked' ? '취소 안내' : '지금 취소하면 환불되는 금액');
  box.append(head);
  if (p.state !== 'blocked') box.append(node('span', 'big num', won(p.refundAmount)));
  const line = node('p', p.state === 'refund' ? 'refund-line' : 'refund-line warn', p.sentence);
  box.append(line);
  if (p.state === 'zero') box.append(node('p', 'refund-rule', '취소하면 예약은 되돌릴 수 없습니다. 그래도 취소하실 수 있습니다.'));
  if (p.rule && p.state !== 'blocked' && RULE_TEXT[p.rule]) box.append(node('p', 'refund-rule', RULE_TEXT[p.rule]));

  const actions = node('div', 'actions');
  const cancel = node('button', 'btn btn-secondary btn-sm', '예약 취소');
  cancel.type = 'button';
  if (p.state === 'blocked') {
    cancel.setAttribute('aria-disabled', 'true');
    cancel.setAttribute('aria-describedby', `refund-${b.id}`);
    line.id = `refund-${b.id}`;
  } else {
    cancel.addEventListener('click', () => onCancel(cancel, p));
  }
  const rules = node('a', 'btn btn-text btn-sm', '취소 규정 보기');
  rules.href = `#/programs/${encodeURIComponent(b.program.id)}`;
  actions.append(cancel, rules);
  box.append(actions);
  return box;
}

function cancelledBox(b) {
  const box = node('div', 'refund-box');
  const r = b.refund;
  box.append(node('span', 'refund-label', '환불 내역'));
  if (r) {
    box.append(node('span', 'big num', `환불 ${won(r.refund_amount)}`));
    box.append(node('p', 'refund-line', r.fee_amount > 0 ? `취소 수수료 ${won(r.fee_amount)}` : '취소 수수료 없음'));
    if (r.rule && RULE_TEXT[r.rule]) box.append(node('p', 'refund-rule', RULE_TEXT[r.rule]));
  } else {
    box.append(node('p', 'refund-line', '환불 내역이 없습니다.'));
  }
  if (b.cancelled_at) box.append(node('p', 'refund-rule', `취소일시 ${kstDateTime(b.cancelled_at)}`));
  return box;
}

/**
 * @param {object} b my_bookings_overview 한 건
 * @param {{api:object, now:()=>Date, notice:Function, reload:()=>Promise<void>, expanded?:boolean, collapsible?:boolean}} ctx
 */
export function renderBookingCard(b, ctx) {
  const id = ++seq;
  const now = ctx.now();
  const art = node('article', 'bk');
  art.setAttribute('aria-labelledby', `bk-t-${id}`);

  const posterHost = node('div');
  renderPoster(posterHost, posterProps(b.program));

  const info = node('div', 'bk-info');
  const tags = node('div', 'bk-tags');
  const st = statusLabel(b, now);
  tags.append(typeMark(b.program.type), node('span', `status ${st.cls}`, st.text));
  const h = node('h3', null);
  h.id = `bk-t-${id}`;
  const link = node('a', null, b.program.title);
  link.href = `#/me/bookings/${encodeURIComponent(b.id)}`;
  h.append(link);
  const meta = node('div', 'bk-meta num');
  meta.append(...metaRows(b));
  info.append(tags, h, meta);

  const side = node('div', 'bk-side');
  const no = node('a', 'bk-no', `예약번호 ${b.booking_no}`);
  no.href = link.href;
  side.append(no, node('span', 'bk-amt', won(b.total_amount)));

  const detail = node('div', 'bk-detail');
  detail.id = `bk-d-${id}`;
  const payCol = node('div');
  payCol.append(node('h4', null, '결제 정보'), paymentList(b));
  detail.append(payCol);

  async function onCancel(button, preview) {
    // 취소 처리 중에 다시 누르면 확인 대화상자를 또 열지 않습니다.
    if (isBusy(button)) return;
    let p = preview;
    // 화면을 연 뒤 취소 구간이 바뀌었을 수 있으므로(자정 경과, 검수용 시계) 서버 시각을 다시 맞추고 금액을 새로 계산합니다.
    if (ctx.sync) {
      await ctx.sync();
      p = refundPreview(b, ctx.now());
      if (p.state !== preview.state || p.refundAmount !== preview.refundAmount || p.rule !== preview.rule) {
        const fresh = refundBox(b, ctx.now(), onCancel);
        detail.querySelector('.refund-box')?.replaceWith(fresh);
        if (p.state === 'blocked' || p.state === 'ended') {
          ctx.notice('error', p.sentence);
          return;
        }
        button = [...fresh.querySelectorAll('button')].find((x) => x.textContent === '예약 취소') ?? button;
      }
    }
    const ok = await confirmDialog({
      title: '예약을 취소하시겠습니까?',
      message: p.sentence,
      detail: `${b.program.title}, 예약번호 ${b.booking_no}. 취소하면 되돌릴 수 없습니다.`,
      confirmLabel: '예약 취소하기',
      cancelLabel: '닫기',
      danger: true,
    });
    if (!ok) return;
    await withBusy(button, async () => {
      try {
        const res = await ctx.api.cancelBooking(b.id);
        if (res?.status === 'CANCELLED') {
          // 목록을 다시 그리면 누른 버튼이 사라지므로, 다시 그린 뒤 결과 안내로 초점을 옮깁니다.
          await ctx.reload();
          ctx.notice('ok', res.refundAmount > 0
            ? `예약이 취소되었습니다. ${won(res.refundAmount)}이 결제 수단으로 환불됩니다(취소 수수료 ${won(res.feeAmount)}).`
            : '예약이 취소되었습니다. 환불 금액은 없습니다.', { focus: true });
        } else {
          ctx.notice('error', res?.message ?? ctx.api.messageFor('UNKNOWN'));
        }
      } catch (e) {
        ctx.notice('error', describeError(e));
      }
    });
  }

  detail.append(b.status === 'CANCELLED' ? cancelledBox(b) : refundBox(b, now, onCancel));

  art.append(posterHost, info, side, detail);

  const expanded = ctx.expanded !== false && !ctx.collapsible;
  detail.hidden = !expanded;
  if (ctx.collapsible) {
    const toggle = node('button', 'btn btn-secondary btn-sm', '상세 보기');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', detail.id);
    toggle.addEventListener('click', () => {
      const open = detail.hidden;
      detail.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? '접기' : '상세 보기';
    });
    side.append(toggle);
  }
  return art;
}
