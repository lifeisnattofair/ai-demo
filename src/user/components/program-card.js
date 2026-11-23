// 프로그램 카드와 판매 상태, 기간과 가격 문구. 모든 일시는 Asia/Seoul 기준입니다.
import { dateRange, won } from '../../lib/format.js';
import { renderPoster, TYPE_LABEL } from './poster.js';
import { posterImage } from './poster-images.js';

export const STATUS_LABEL = {
  UPCOMING: '예매 예정',
  ON_SALE: '예매 중',
  SOLD_OUT_WAITLIST: '매진(대기 가능)',
  CLOSED: '마감',
};
// 표식 색은 보조 수단이고, 뜻은 항상 글자로 함께 나옵니다.
const STATUS_CLASS = { UPCOMING: 'soon', ON_SALE: 'on', SOLD_OUT_WAITLIST: 'wait', CLOSED: 'closed' };
const TYPE_CLASS = { PERFORMANCE: 'perf', EXPERIENCE: 'exp', COURSE: 'course' };
const TYPE_ORDER = ['PERFORMANCE', 'EXPERIENCE', 'COURSE'];

/**
 * 회차 하나의 판매 상태. 현재 시각은 인자로 받습니다(SFR-025).
 * @param {{sale_starts_at:string, sale_ends_at:string, status?:string}} offering
 * @param {Date} now
 * @param {boolean} soldOut 잔여석이 0인지
 */
export function saleStatus(offering, now, soldOut) {
  const t = now.getTime();
  if (offering.status && offering.status !== 'OPEN') return 'CLOSED';
  if (t < new Date(offering.sale_starts_at).getTime()) return 'UPCOMING';
  if (t >= new Date(offering.sale_ends_at).getTime()) return 'CLOSED';
  return soldOut ? 'SOLD_OUT_WAITLIST' : 'ON_SALE';
}

export function statusMark(status) {
  const s = document.createElement('span');
  s.className = `status ${STATUS_CLASS[status]}`;
  s.textContent = STATUS_LABEL[status];
  return s;
}

export function typeMark(type) {
  const s = document.createElement('span');
  s.className = `type ${TYPE_CLASS[type]}`;
  s.textContent = TYPE_LABEL[type];
  return s;
}

// 취소된 회차는 목록과 상세에서 빼고, 시작 시각 순으로 둡니다.
export function activeOfferings(program) {
  return (program.offerings ?? [])
    .filter((o) => o.status !== 'CANCELLED')
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
}

// 목록 정렬: 공연, 체험, 정규 강좌 순, 같은 유형은 빠른 일정, 같으면 제목 순
export function sortPrograms(programs) {
  // 같은 날(KST) 시작이면 제목 순으로 둡니다.
  const firstDay = (p) => {
    const s = activeOfferings(p)[0]?.starts_at;
    return s ? Math.floor((new Date(s).getTime() + 9 * 3600000) / 86400000) : Infinity;
  };
  return [...programs].sort((a, b) =>
    TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)
    || firstDay(a) - firstDay(b)
    || a.title.localeCompare(b.title, 'ko'));
}

function periodRange(program) {
  const list = activeOfferings(program);
  if (!list.length) return null;
  const lastOffering = list[list.length - 1];
  // 정규 강좌는 마지막 수업일까지, 나머지는 마지막 회차 시작일까지
  return { start: list[0].starts_at, end: program.type === 'COURSE' ? lastOffering.ends_at : lastOffering.starts_at };
}

/**
 * 프로그램 기간. 표기는 format.js 의 dateRange 를 씁니다.
 * @param {'full'|'plain'|'short'} style full: 2026.12.12(토) - 12.13(일), plain: 2026.12.12 - 12.13, short: 12.12 - 12.13
 */
export function periodText(program, style = 'plain') {
  const r = periodRange(program);
  if (!r) return '';
  return dateRange(r.start, r.end, { weekday: style === 'full', short: style === 'short' });
}

export function minPrice(program) {
  const all = activeOfferings(program).flatMap((o) => (o.prices ?? []).map((p) => p.price));
  return all.length ? Math.min(...all) : null;
}

export function priceText(program) {
  const p = minPrice(program);
  if (p == null) return '';
  if (program.type === 'PERFORMANCE') return `${won(p)}부터`;
  if (program.type === 'EXPERIENCE') return `1인 ${won(p)}`;
  return won(p);
}

/**
 * 프로그램 전체의 상태. 판매 중인 회차가 하나라도 있으면 예매 중입니다.
 * @param {Record<string, number|null>} remaining 회차 id 별 잔여석(모르면 없음)
 */
export function programStatus(program, now, remaining = {}) {
  const list = activeOfferings(program);
  if (!list.length) return 'CLOSED';
  const all = list.map((o) => saleStatus(o, now, remaining[o.id] === 0));
  for (const s of ['ON_SALE', 'SOLD_OUT_WAITLIST', 'UPCOMING']) if (all.includes(s)) return s;
  return 'CLOSED';
}

export function posterProps(program, periodStyle = 'short') {
  const img = posterImage(program.poster_image);
  return {
    image: img.src,
    imagePosition: img.position,
    tone: program.poster_tone,
    series: program.poster_series,
    title: program.poster_title || program.title,
    subtitle: program.poster_sub,
    type: program.type,
    periodText: periodText(program, periodStyle),
    venue: program.venue,
  };
}

function text(tag, className, value) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  n.textContent = value;
  return n;
}

// 격자의 카드 한 장(li). 글자는 모두 textContent 로 넣습니다.
export function renderProgramCard(program, status) {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.className = 'card';
  a.href = `#/programs/${encodeURIComponent(program.id)}`;
  const wrap = document.createElement('div');
  renderPoster(wrap, posterProps(program));

  const top = document.createElement('div');
  top.className = 'c-top';
  top.append(typeMark(program.type), statusMark(status));
  const body = document.createElement('div');
  body.className = 'c-body';
  body.append(
    top,
    text('h3', '', program.title),
    text('p', 'c-meta num', `${periodText(program, 'plain')} ${program.venue ?? ''}`.trim()),
    text('p', 'c-price num', priceText(program)),
  );
  a.append(wrap, body);
  li.append(a);
  return li;
}
