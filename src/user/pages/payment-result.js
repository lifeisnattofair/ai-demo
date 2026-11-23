// 결제 결과. 성공 페이지는 승인 요청을 한 번만 보내고, 결과에 따라 예약 완료/취소 안내/오류 안내를 보입니다.
import { describeError, isKnownError } from '../../lib/api.js';
import { escapeHtml, kstDateTime, won } from '../../lib/format.js';
import { DISCOUNT_LABELS } from '../components/checkout-data.js';
import { GRADE_NAME } from '../components/seat-map.js';
import { showSkeleton } from '../../components/skeleton.js';

const BOOKINGS = '#/me/bookings';
const ORDER_RE = /^HB-\d{8}-[A-Za-z0-9]{10}$/;
const KEY_RE = /^mock_[A-Za-z0-9]{20}$/;
const UNCONFIRMED = '결제 결과를 아직 확인하지 못했습니다. 잠시 후 내 예약에서 다시 확인해 주세요.';
const FAIL_REASON = {
  USER_CANCEL: '결제를 취소하셨습니다.',
};

// 같은 주문은 화면을 다시 그려도 승인을 다시 요청하지 않고 첫 요청의 결과를 씁니다(서버도 멱등이지만 불필요한 호출을 줄입니다).
const confirmations = new Map();
export function resetConfirmGuard() {
  confirmations.clear();
}

function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function page(el, title, bodyNodes, actions = []) {
  const wrap = node('section', 'container result');
  const h = node('h1', 'page-title', title);
  h.tabIndex = -1;
  wrap.append(h, ...bodyNodes);
  if (actions.length) {
    const row = node('div', 'result-actions');
    row.append(...actions);
    wrap.append(row);
  }
  el.replaceChildren(wrap);
}

function link(href, label, kind = 'secondary') {
  const a = node('a', `btn btn-${kind}`, label);
  a.href = href;
  return a;
}

export function orderOffering(orderId) {
  try { return sessionStorage.getItem(`hb:order:${orderId}`); } catch { return null; }
}

function retryAction(go, offeringId) {
  const href = offeringId ? `#/booking/${encodeURIComponent(offeringId)}/select` : '#/programs';
  const b = node('button', 'btn btn-primary', '좌석 다시 선택');
  b.type = 'button';
  b.addEventListener('click', () => go(href));
  return b;
}

async function completion(api, booking) {
  let offering = null;
  let items = [];
  try { offering = await api.getOffering(booking.offering_id); } catch (e) { console.error(e); }
  try { items = (await api.myBookingItems(booking.id)) ?? []; } catch (e) { console.error(e); }
  return { offering, items };
}

function bookingView(el, booking, { offering, items }) {
  const seats = items.filter((i) => i.row_label).map((i) => `${GRADE_NAME[i.grade] ?? i.grade} ${i.row_label}열 ${i.seat_no}번`);
  const discounts = items.filter((i) => i.discount_type && i.discount_type !== 'GENERAL' && DISCOUNT_LABELS[i.discount_type]);
  const rows = [
    ['예약번호', booking.booking_no],
    offering ? ['프로그램', offering.program.title] : null,
    offering ? ['일시', kstDateTime(offering.starts_at)] : null,
    offering?.program.venue ? ['장소', offering.program.venue] : null,
    seats.length ? ['좌석', seats.join(', ')] : (items.length ? ['인원', `${items.length}명`] : null),
    discounts.length ? ['할인', discounts.map((d) => DISCOUNT_LABELS[d.discount_type]).join(', ')] : null,
    ['결제 금액', won(booking.total_amount)],
  ].filter(Boolean);
  const dl = node('dl', 'result-list');
  dl.innerHTML = rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd class="num">${escapeHtml(v)}</dd></div>`).join('');
  const note = node('p', 'result-note', discounts.length
    ? '할인 증빙은 방문 당일 현장에서 확인합니다. 증빙이 없으면 차액을 현장에서 결제합니다.'
    : '예약 내용은 내 예약에서 다시 확인하실 수 있습니다.');
  page(el, '예매가 완료되었습니다.', [dl, note], [link(BOOKINGS, '내 예약 보기', 'primary'), link('#/programs', '다른 공연, 강좌 찾기')]);
}

/**
 * @param {HTMLElement} el
 * @param {{api:object, go:(h:string)=>void, query:URLSearchParams}} deps
 */
export async function renderPaymentSuccess(el, { api, go, query }) {
  const paymentKey = query.get('paymentKey') ?? '';
  const orderId = query.get('orderId') ?? '';
  const amount = Number(query.get('amount'));
  const offeringId = query.get('offeringId') || orderOffering(orderId);

  if (!KEY_RE.test(paymentKey) || !ORDER_RE.test(orderId) || !Number.isInteger(amount) || amount < 0) {
    page(el, '결제 정보를 확인할 수 없습니다.', [node('p', '', '주소가 올바르지 않거나 이미 처리된 결제입니다. 내 예약에서 결과를 확인해 주세요.')],
      [link(BOOKINGS, '내 예약 보기', 'primary')]);
    return;
  }

  const host = node('div', 'container');
  el.replaceChildren(host);
  const release = showSkeleton(host, 'form');

  let outcome = confirmations.get(orderId);
  if (!outcome) {
    outcome = api.confirmPayment(paymentKey, orderId, amount).then(
      (result) => ({ result }),
      (error) => ({ error }),
    );
    confirmations.set(orderId, outcome);
  }
  const { result, error } = await outcome;

  if (error) {
    // 연결 오류처럼 실패한 확인은 기억하지 않아 다시 들어오면 한 번 더 확인합니다.
    confirmations.delete(orderId);
    release();
    console.error(error);
    // 코드별 안내가 없는 오류(실행 환경 오류 등)는 정해 둔 문구와 다시 확인 버튼을 보입니다. 원문은 콘솔에만 남깁니다.
    const known = isKnownError(error);
    const again = node('button', 'btn btn-primary', '결과 다시 확인');
    again.type = 'button';
    again.addEventListener('click', () => renderPaymentSuccess(el, { api, go, query }));
    page(el, '결제 결과를 확인하지 못했습니다.', [node('p', '', known ? describeError(error) : UNCONFIRMED)],
      [again, link(BOOKINGS, '내 예약 보기')]);
    return;
  }
  if (result?.status === 'CONFIRMED' && result.booking) {
    const extra = await completion(api, result.booking);
    release();
    bookingView(el, result.booking, extra);
    return;
  }
  release();
  const message = result?.message || api.messageFor('UNKNOWN');
  page(el, '결제가 완료되지 않았습니다.', [node('p', '', message),
    node('p', 'result-note', result?.refunded ? '승인된 결제는 자동으로 취소되었습니다.' : '')].filter((n) => n.textContent),
  [retryAction(go, offeringId), link(BOOKINGS, '내 예약 보기')]);
}

/**
 * 결제를 하지 못했거나 사용자가 결제를 그만둔 경우. 선점은 만료 전까지 유지되므로 할인 단계로 돌아갑니다(SFR-010).
 * @param {HTMLElement} el
 * @param {{query:URLSearchParams}} deps
 */
export function renderPaymentFail(el, { query }) {
  const holdId = query.get('holdId');
  const code = query.get('code');
  // 주소에 실린 문구는 그대로 보이지 않고, 알려진 코드만 정해 둔 안내로 바꿉니다.
  const reason = FAIL_REASON[code] ?? '결제를 완료하지 못했습니다. 결제 수단을 확인하신 뒤 다시 시도해 주세요.';
  const actions = holdId ? [link(`#/booking/${encodeURIComponent(holdId)}/discount`, '할인 선택으로 돌아가기', 'primary')] : [];
  actions.push(link('#/programs', '프로그램 목록'));
  page(el, '결제가 완료되지 않았습니다.', [
    node('p', '', reason),
    node('p', '', '선점은 남은 시간 동안 유지됩니다. 시간 안에 다시 결제해 주세요. 시간이 지나면 좌석을 다시 선택해야 합니다.'),
  ], actions);
}
