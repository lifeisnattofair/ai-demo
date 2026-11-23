// 할인/결제 화면의 공통 틀: 예매 머리말(작품, 일시, 단계), 모바일 타이머, 본문 2단, 모바일 하단 바.
import { dateRange, escapeHtml, kstDate, kstDateTime, won } from '../../lib/format.js';
import { posterImage } from './poster-images.js';
import { bookingSteps } from './booking-steps.js';
import { startHoldTimer } from './hold-timer.js';

const DAY = 86400000;

const SAME_DAY = { PERFORMANCE: '공연 당일', EXPERIENCE: '체험 당일', COURSE: '개강 당일(첫 수업 전)' };

/** 취소 수수료 일정(정책: 8일 전까지 무료, 7~4일 전 10%, 3~1일 전 30%, 당일 취소 불가). */
export function cancelSchedule(startsAt, type = 'PERFORMANCE') {
  const start = new Date(startsAt).getTime();
  const at = (n) => new Date(start - n * DAY);
  const range = (a, b) => dateRange(at(a), at(b), { weekday: true });
  return [
    ['무료 취소', `${kstDate(at(8))}까지`],
    ['수수료 10%', range(7, 4)],
    ['수수료 30%', range(3, 1)],
    ['취소 불가', SAME_DAY[type] ?? SAME_DAY.PERFORMANCE],
  ];
}

/** 오른쪽 요약의 내역 목록(좌석/인원, 티켓 금액, 할인별 차감, 수수료). */
export function summaryListHtml({ type, tickets, original, discounts }) {
  const what = type === 'PERFORMANCE'
    ? `<li><span>좌석</span><span>${escapeHtml(tickets.map((t) => `${t.sub} ${t.name}`).join(', '))}</span></li>`
    : `<li><span>인원</span><span>${tickets.length}명</span></li>`;
  return `<ul class="sum-list">
    ${what}
    <li><span>티켓 금액</span><span>${won(original)}</span></li>
    ${discounts.map((d) => `<li><span>${escapeHtml(d.label)}</span><span>-${won(d.sum)}</span></li>`).join('')}
    <li><span>예매 수수료</span><span>${won(0)}</span></li>
  </ul>`;
}

/**
 * @returns {{page, main, summary, bar, stops:Function[]}}
 */
export function mountShell(el, { program, offering, step, expiresAt, now, onExpire }) {
  const img = posterImage(program.poster_image).src;
  el.innerHTML = `<div data-booking>
    <div class="book-head">
      <div class="container">
        <div class="bh-title">${img ? `<img src="${escapeHtml(img)}" alt="">` : ''}<div><h1>${escapeHtml(program.title)}</h1><span class="num">${escapeHtml(kstDateTime(offering.starts_at))}, ${escapeHtml(program.venue ?? '')}</span></div></div>
      </div>
      <div class="container"><ol></ol></div>
    </div>
    <div class="m-timer"></div>
    <div class="container booking">
      <div data-main></div>
      <aside class="summary" aria-label="결제 금액">
        <div class="panel">
          <div class="timer"></div>
          <div class="panel-body" data-summary></div>
        </div>
      </aside>
    </div>
    <div class="mobile-bar" data-bar></div>
  </div>`;
  bookingSteps(el.querySelector('.book-head ol'), step);
  const stops = [];
  stops.push(startHoldTimer(el.querySelector('.timer'), expiresAt, now, onExpire));
  stops.push(startHoldTimer(el.querySelector('.m-timer'), expiresAt, now, () => {}));
  return {
    page: el.querySelector('[data-booking]'),
    main: el.querySelector('[data-main]'),
    summary: el.querySelector('[data-summary]'),
    bar: el.querySelector('[data-bar]'),
    stops,
  };
}
