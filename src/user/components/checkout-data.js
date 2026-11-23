// 할인/결제 두 단계가 함께 쓰는 값: 선점과 회차 불러오기, 티켓 줄, 선택한 할인 보관, 금액 계산.
// 금액과 규칙은 @policy 의 priceItems, validateDiscounts 만 씁니다.
import { DISCOUNTS, DISCOUNT_LABELS, priceItems, validateDiscounts } from '@policy/pricing.js';
import { GRADE_NAME } from './seat-map.js';
import { showSkeleton } from '../../components/skeleton.js';

export { DISCOUNT_LABELS };

const COMPANIONS = ['DISABLED_COMPANION', 'MERIT_COMPANION'];
const ORDER = ['GENERAL', 'DISABLED', 'DISABLED_COMPANION', 'MERIT', 'MERIT_COMPANION', 'MULTICHILD'];

/**
 * 상품 유형에 따라 고를 수 있는 할인 목록(정규 강좌는 동반 할인이 없습니다).
 * 할인을 적용하지 않는 프로그램(discountEnabled false, R23)은 일반만 고릅니다.
 */
export function discountOptions(type, discountEnabled = true) {
  return ORDER.filter((t) => (discountEnabled || t === 'GENERAL') && !(type === 'COURSE' && COMPANIONS.includes(t)))
    .map((value) => ({ value, label: DISCOUNTS[value] ? `${DISCOUNT_LABELS[value]} ${DISCOUNTS[value]}%` : DISCOUNT_LABELS[value] }));
}

/**
 * 선점 + 회차를 불러와 티켓 줄(seatId, 이름, 단가)로 만듭니다.
 * @returns {{hold, offering, type, tickets}|{error:'GONE'|'EXPIRED'}}
 */
export async function loadCheckout(api, holdId, now) {
  const hold = await api.getMyHold(holdId);
  if (!hold) return { error: 'GONE' };
  if (hold.status !== 'ACTIVE' || new Date(hold.expires_at).getTime() <= now().getTime()) return { error: 'EXPIRED', hold };
  const offering = await api.getOffering(hold.offering_id);
  if (!offering) return { error: 'GONE' };
  const type = offering.program.type;
  const prices = {};
  for (const p of offering.prices ?? []) prices[p.grade ?? '_'] = p.price;
  let tickets;
  if (type === 'PERFORMANCE') {
    tickets = (hold.seats ?? []).map((s) => ({
      seatId: s.seat_id,
      name: `${s.row_label}열 ${s.seat_no}번`,
      sub: GRADE_NAME[s.grade] ?? s.grade,
      unitPrice: prices[s.grade] ?? 0,
    }));
  } else {
    tickets = Array.from({ length: hold.qty }, (_, i) => ({
      seatId: null,
      name: `${i + 1}번째 인원`,
      sub: type === 'COURSE' ? '수강' : '체험',
      unitPrice: prices._ ?? 0,
    }));
  }
  return { hold, offering, type, tickets, discountEnabled: offering.program.discount_enabled !== false };
}

const key = (holdId) => `hb:discounts:${holdId}`;

export function saveDiscounts(holdId, types) {
  try { sessionStorage.setItem(key(holdId), JSON.stringify(types)); } catch { /* 저장소를 쓸 수 없어도 진행합니다. */ }
}

/** 저장된 할인 선택. 길이나 값이 맞지 않거나 할인을 적용하지 않는 프로그램이면 모두 일반으로 둡니다. */
export function loadDiscounts(holdId, count, { discountEnabled = true } = {}) {
  const general = Array(count).fill('GENERAL');
  if (!discountEnabled) return general;
  try {
    const v = JSON.parse(sessionStorage.getItem(key(holdId)) ?? 'null');
    if (Array.isArray(v) && v.length === count && v.every((t) => Object.prototype.hasOwnProperty.call(DISCOUNTS, t))) return v;
  } catch { /* 저장값이 깨졌으면 무시합니다. */ }
  return general;
}

export function priceTickets(tickets, types) {
  const { lines, total } = priceItems(tickets.map((t, i) => ({ unitPrice: t.unitPrice, discountType: types[i] })));
  return { lines, total, original: tickets.reduce((a, t) => a + t.unitPrice, 0) };
}

export function checkDiscounts(types, productType) {
  return validateDiscounts(types, productType);
}

/** 할인 유형별로 합친 할인액 줄(요약용). */
export function discountSummary(lines) {
  const by = new Map();
  for (const l of lines) if (l.discountAmount > 0) by.set(l.discountType, (by.get(l.discountType) ?? 0) + l.discountAmount);
  return [...by].map(([type, sum]) => ({ label: `${DISCOUNT_LABELS[type]} 할인`, sum }));
}

const LOAD_ERROR = '예매 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';

/**
 * 로그인 확인, 선점/회차 불러오기(스켈레톤 포함), 오류 화면까지 맡습니다.
 * @returns 화면을 그릴 수 있으면 loadCheckout 결과, 아니면 null(이미 안내 화면이나 이동을 처리함)
 */
export async function bootCheckout(el, { api, go, holdId, now, selfHash, stale }) {
  const host = document.createElement('div');
  host.className = 'container';
  el.replaceChildren(host);
  const release = showSkeleton(host, 'form');
  try {
    const session = await api.getSession();
    if (stale()) return null;
    if (!session) {
      release();
      go(`#/login?next=${encodeURIComponent(selfHash)}`);
      return null;
    }
    const data = await loadCheckout(api, holdId, now);
    if (stale()) return null;
    release();
    if (data.error === 'GONE') {
      messagePage(el, '선점 정보를 찾을 수 없습니다.', '선점이 해제되었거나 주소가 바뀌었습니다. 프로그램을 다시 선택해 주세요.', '#/programs', '프로그램 목록');
      return null;
    }
    if (data.error === 'EXPIRED') {
      messagePage(el, '선점 시간이 지났습니다.', api.messageFor('HOLD_EXPIRED'), `#/booking/${encodeURIComponent(data.hold.offering_id)}/select`, '좌석 다시 선택');
      return null;
    }
    return data;
  } catch (e) {
    release();
    if (stale()) return null;
    console.error(e);
    messagePage(el, '예매 정보를 불러오지 못했습니다.', LOAD_ERROR, '#/programs', '프로그램 목록');
    return null;
  }
}

export function messagePage(el, title, body, href, label) {
  const wrap = document.createElement('section');
  wrap.className = 'container page-message';
  const h = document.createElement('h1');
  h.className = 'page-title';
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = body;
  wrap.append(h, p);
  if (href) {
    const a = document.createElement('a');
    a.className = 'btn btn-secondary';
    a.href = href;
    a.textContent = label;
    wrap.append(a);
  }
  el.replaceChildren(wrap);
}
