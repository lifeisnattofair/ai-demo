// 좌석/인원 선택. 마크업과 클래스는 설계 확정본(user-seat.html)과 같습니다.
// 공연은 좌석 배치도(또는 좌석 목록), 체험은 인원, 정규 강좌는 본인 1명 신청으로 고릅니다.
import { checkLimit, LIMITS } from '@policy/limits.js';
import { describeError } from '../../lib/api.js';
import { now as clockNow } from '../../lib/clock.js';
import { escapeHtml, kstDateTime, won } from '../../lib/format.js';
import { saleStatus } from '../components/program-card.js';
import { posterImage } from '../components/poster-images.js';
import { bookingSteps } from '../components/booking-steps.js';
import { startHoldTimer } from '../components/hold-timer.js';
import { renderSeatMap, GRADE_NAME } from '../components/seat-map.js';
import { renderSeatList } from '../components/seat-list.js';
import { showSkeleton } from '../../components/skeleton.js';
import { withBusy } from '../../components/button-busy.js';

const NEXT_LABEL = '다음: 할인 선택';
const LOAD_ERROR = '예매 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
const LABEL = {
  PERFORMANCE: { day: '관람일시', unit: '매', limit: '회차당 1인 4매까지 예매할 수 있습니다.' },
  EXPERIENCE: { day: '체험일시', unit: '명', limit: '회차당 1인 4명까지 신청할 수 있습니다.' },
  COURSE: { day: '개강일시', unit: '명', limit: '정규 강좌는 1인 1건만 신청할 수 있습니다.' },
};
const CLOSE_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function messagePage(el, title, body, href, label) {
  const wrap = node('section', 'container page-message');
  wrap.append(node('h1', 'page-title', title), node('p', '', body));
  if (href) {
    const a = node('a', 'btn btn-secondary', label);
    a.href = href;
    wrap.append(a);
  }
  el.replaceChildren(wrap);
}

/**
 * @param {HTMLElement} el
 * @param {{api:object, go:(h:string)=>void, offeringId:string, now?:()=>Date, notice?:string}} deps
 */
let renderSeq = 0;

export async function renderSelect(el, { api, go, offeringId, now = clockNow, notice = '' }) {
  const selfHash = `#/booking/${encodeURIComponent(offeringId)}/select`;
  const mine = ++renderSeq;
  const stale = () => mine !== renderSeq; // 더 새로운 화면이 그려졌으면 이 화면은 그리지 않습니다.
  // 불러오는 동안 실제 예매 화면처럼 왼쪽 좌석 영역과 오른쪽 요약 자리에 스켈레톤을 둡니다.
  const loadHost = node('div', 'container booking');
  const mapSlot = node('div', 'panel hall-loading');
  const sumSlot = node('div', 'panel summary-loading');
  loadHost.append(mapSlot, sumSlot);
  el.replaceChildren(loadHost);
  const releaseMap = showSkeleton(mapSlot, 'seat-map');
  const releaseSum = showSkeleton(sumSlot, 'form');
  const releaseSkeleton = () => { releaseMap(); releaseSum(); };
  let session;
  try {
    session = await api.getSession();
    if (stale()) { releaseSkeleton(); return; }
    if (!session) releaseSkeleton();
  } catch (e) {
    releaseSkeleton();
    if (stale()) return;
    console.error(e);
    messagePage(el, '예매 정보를 불러오지 못했습니다.', LOAD_ERROR, '#/programs', '프로그램 목록');
    return;
  }
  if (!session) {
    go(`#/login?next=${encodeURIComponent(selfHash)}`);
    return;
  }

  let offering;
  let existing;
  let activeHold;
  let seats = [];
  let statusById = {};
  let remainingCap = null;
  try {
    offering = await api.getOffering(offeringId);
    if (stale()) { releaseSkeleton(); return; }
    if (!offering || !LABEL[offering.program?.type]) {
      releaseSkeleton();
      messagePage(el, '회차를 찾을 수 없습니다.', '주소가 바뀌었거나 판매가 끝난 회차일 수 있습니다. 목록에서 다시 찾아 주세요.', '#/programs', '프로그램 목록');
      return;
    }
    const isSeat = offering.program.type === 'PERFORMANCE';
    [existing, activeHold] = await Promise.all([api.myOfferingQty(offeringId), api.myActiveHold(offeringId)]);
    if (isSeat) {
      const map = await api.offeringSeatMap(offeringId);
      seats = map.map((r) => ({ id: r.seat_id, row_label: r.row_label, seat_no: r.seat_no, grade: r.grade }));
      statusById = Object.fromEntries(map.map((r) => [r.seat_id, r.status]));
    } else {
      remainingCap = await api.remainingCapacity(offeringId);
    }
    if (stale()) { releaseSkeleton(); return; }
  } catch (e) {
    releaseSkeleton();
    if (stale()) return;
    console.error(e);
    messagePage(el, '예매 정보를 불러오지 못했습니다.', LOAD_ERROR, '#/programs', '프로그램 목록');
    return;
  }
  releaseSkeleton();
  // 화면 시계가 서버보다 조금 앞서 이미 지난 선점이 남아 있으면 이어가지 않습니다(만료 직후 다시 그리기가 반복되지 않게).
  if (activeHold && new Date(activeHold.expires_at).getTime() <= now().getTime()) activeHold = null;

  const program = offering.program;
  const type = program.type;
  const words = LABEL[type];
  const detailHref = `#/programs/${encodeURIComponent(program.id)}`;

  // 판매 중이 아니면 선택 화면을 열지 않습니다(이미 잡아 둔 선점이 있으면 이어서 진행할 수 있게 둡니다).
  const soldOut = type === 'PERFORMANCE'
    ? !seats.some((s) => statusById[s.id] === 'AVAILABLE')
    : remainingCap === 0;
  const sale = saleStatus(offering, now(), soldOut);
  if (sale !== 'ON_SALE' && !activeHold) {
    const code = sale === 'SOLD_OUT_WAITLIST' ? 'SOLD_OUT' : 'NOT_ON_SALE';
    messagePage(el, '지금은 선택할 수 없는 회차입니다.', api.messageFor(code), detailHref, '프로그램 상세');
    return;
  }

  const prices = {};
  for (const p of offering.prices ?? []) prices[p.grade ?? '_'] = p.price;
  const unitPrice = prices._ ?? 0;
  const priceOf = (seat) => prices[seat.grade] ?? 0;

  // 한도: 이미 확정했거나 선점한 수량을 뺀 만큼만 고를 수 있습니다.
  let limitLeft = 0;
  let maxPick = 0;
  function recomputeLimits() {
    limitLeft = checkLimit({ productType: type, existingQty: existing, requestedQty: LIMITS[type] }).remaining;
    maxPick = type === 'PERFORMANCE' ? limitLeft : Math.min(limitLeft, remainingCap ?? limitLeft);
  }
  recomputeLimits();

  const selected = new Set();
  let qty = type === 'PERFORMANCE' ? 0 : Math.min(1, maxPick);
  let busy = false;
  const stops = [];

  const img = posterImage(program.poster_image).src;
  const dateText = kstDateTime(offering.starts_at);
  el.innerHTML = `<div data-booking>
    <div class="book-head">
      <div class="container">
        <div class="bh-title">${img ? `<img src="${escapeHtml(img)}" alt="">` : ''}<div><h1>${escapeHtml(program.title)}</h1><span class="num">${escapeHtml(dateText)}, ${escapeHtml(program.venue ?? '')}</span></div></div>
      </div>
      <div class="container"><ol></ol></div>
    </div>
    ${activeHold ? '<div class="m-timer"></div>' : ''}
    <div class="container booking">
      <section class="panel" aria-labelledby="sel-title">
        <div class="panel-head">
          <h2 id="sel-title">${type === 'PERFORMANCE' ? '좌석 선택' : type === 'EXPERIENCE' ? '인원 선택' : '수강 신청'}</h2>
          ${type === 'PERFORMANCE' && !activeHold ? `<div class="view-toggle" role="group" aria-label="보기 방식">
            <button type="button" aria-pressed="true" data-view="map">배치도</button>
            <button type="button" aria-pressed="false" data-view="list">좌석 목록</button>
          </div>` : ''}
        </div>
        <div class="panel-body" data-body></div>
      </section>
      <aside class="summary" aria-label="선택 내역">
        <div class="panel">
          ${activeHold ? '<div class="timer"></div>' : ''}
          <div class="panel-body" data-summary></div>
        </div>
      </aside>
    </div>
    <div class="mobile-bar" data-bar></div>
  </div>`;
  const page = el.querySelector('[data-booking]');
  bookingSteps(el.querySelector('.book-head ol'), 2);

  const body = el.querySelector('[data-body]');
  const summary = el.querySelector('[data-summary]');
  const bar = el.querySelector('[data-bar]');

  // 안내와 오류. 화면 낭독기가 바로 읽도록 role 을 붙입니다.
  const live = node('div', 'booking-live');
  function say(text, kind = 'error') {
    if (!text) { live.replaceChildren(); return; }
    const p = node('p', kind === 'error' ? 'form-error' : 'note info', text);
    p.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    live.replaceChildren(p);
  }
  if (notice) say(notice, 'info');

  // 선점 시간 표시
  if (activeHold) {
    const expiresAt = new Date(activeHold.expires_at);
    const onExpire = () => {
      stops.forEach((s) => s());
      renderSelect(el, { api, go, offeringId, now, notice: '선점 시간이 지나 좌석이 해제되었습니다. 다시 선택해 주세요.' });
    };
    stops.push(startHoldTimer(el.querySelector('.timer'), expiresAt, now, onExpire));
    stops.push(startHoldTimer(el.querySelector('.m-timer'), expiresAt, now, () => {}));
  }

  // 선택 내용을 합친 요약
  function lines() {
    if (type === 'PERFORMANCE') {
      const byGrade = new Map();
      for (const id of selected) {
        const seat = seats.find((s) => s.id === id);
        const row = byGrade.get(seat.grade) ?? { n: 0, sum: 0 };
        row.n += 1;
        row.sum += priceOf(seat);
        byGrade.set(seat.grade, row);
      }
      const rows = ['R', 'S', 'A'].filter((g) => byGrade.has(g)).map((g) => [`${GRADE_NAME[g]} ${byGrade.get(g).n}매`, byGrade.get(g).sum]);
      return { rows, total: rows.reduce((a, [, s]) => a + s, 0), count: selected.size };
    }
    const label = type === 'COURSE' ? `수강료 ${qty}명` : `${qty}명 (1인 ${won(unitPrice)})`;
    return { rows: qty ? [[label, unitPrice * qty]] : [], total: unitPrice * qty, count: qty };
  }

  function chips() {
    return [...selected].map((id) => seats.find((s) => s.id === id))
      .sort((a, b) => (a.row_label + String(a.seat_no).padStart(3, '0')).localeCompare(b.row_label + String(b.seat_no).padStart(3, '0')));
  }

  function drawSummary(focusIndex = null) {
    const { rows, total, count } = lines();
    const ready = !activeHold && count > 0;
    if (activeHold) {
      summary.innerHTML = `
        <h2 class="sum-title">선점한 ${type === 'PERFORMANCE' ? '좌석' : '자리'} <span class="num">${activeHold.qty}${words.unit}</span></h2>
        <ul class="sum-list"><li><span>${words.day}</span><span>${escapeHtml(dateText)}</span></li></ul>
        <a class="btn btn-primary btn-block" href="#/booking/${encodeURIComponent(activeHold.id)}/discount">이어서 진행</a>
        <button class="btn btn-secondary btn-block" type="button" data-release>선점 해제</button>`;
      bar.innerHTML = `<div class="mb-info">선점 ${activeHold.qty}${words.unit}</div><a class="btn btn-primary" href="#/booking/${encodeURIComponent(activeHold.id)}/discount">이어서 진행</a>`;
      return;
    }
    const heading = type === 'PERFORMANCE'
      ? `<h2 class="sum-title">선택한 좌석 <span class="num">${count} / ${maxPick}${words.unit}</span></h2>`
      : `<h2 class="sum-title">선택 내역</h2>`;
    const chipHtml = type === 'PERFORMANCE'
      ? (count ? `<div class="seat-chips">${chips().map((s) => {
        const name = escapeHtml(`${GRADE_NAME[s.grade]} ${s.row_label}열 ${s.seat_no}번`);
        return `<span class="seat-chip">${name}<button type="button" data-remove="${s.id}" aria-label="${name} 선택 해제">${CLOSE_ICON}</button></span>`;
      }).join('')}</div>` : '<p class="sum-empty">배치도 또는 좌석 목록에서 좌석을 선택해 주세요.</p>')
      : '';
    summary.innerHTML = `
      ${heading}
      ${chipHtml}
      <ul class="sum-list">
        <li><span>${words.day}</span><span>${escapeHtml(dateText)}</span></li>
        ${rows.map(([t, s]) => `<li><span>${escapeHtml(t)}</span><span>${won(s)}</span></li>`).join('')}
        <li><span>할인</span><span>다음 단계에서 선택</span></li>
      </ul>
      <div class="sum-total"><span>합계</span><b>${won(total)}</b></div>
      <button class="btn btn-primary btn-block" type="button" data-next aria-disabled="${ready ? 'false' : 'true'}">${NEXT_LABEL}</button>
      <p class="sum-fine">다음 단계로 넘어가면 ${type === 'PERFORMANCE' ? '좌석이' : '자리가'} 10분 동안 선점됩니다. ${words.limit}</p>`;
    const barInfo = type === 'PERFORMANCE'
      ? (count ? rows.map(([t]) => t).join(', ') : '좌석을 선택해 주세요')
      : (count ? `${count}명` : '인원을 선택해 주세요');
    bar.innerHTML = `<div class="mb-info">${escapeHtml(barInfo)}<b>${won(total)}</b></div>
      <button class="btn btn-primary" type="button" data-next aria-disabled="${ready ? 'false' : 'true'}">${NEXT_LABEL}</button>`;
    if (focusIndex != null) {
      const btns = summary.querySelectorAll('[data-remove]');
      if (btns.length) btns[Math.min(focusIndex, btns.length - 1)].focus();
      else summary.querySelector('[data-next]')?.focus();
    }
  }

  // 좌석 선택 영역
  let mapView = null;
  let listView = null;
  const mapHost = node('div');
  const listHost = node('div');
  listHost.hidden = true;

  let qtySync = null;
  // 선점 실패 뒤 한도와 잔여 수량을 다시 계산해 화면 곳곳에 반영합니다.
  function refreshLimits() {
    recomputeLimits();
    if (type === 'PERFORMANCE') {
      while (selected.size > maxPick) selected.delete([...selected].pop());
      mapView?.update({ statusById, max: maxPick });
      listView?.update({ statusById, max: maxPick });
      const left = seats.filter((x) => statusById[x.id] === 'AVAILABLE').length;
      const countEl = body.querySelector('.seat-count');
      if (countEl) countEl.textContent = `잔여 ${left}석 / ${seats.length}석`;
    } else {
      qty = maxPick <= 0 ? 0 : Math.min(Math.max(qty, 1), maxPick);
      const capEl = body.querySelector('[data-cap]');
      if (capEl) capEl.textContent = String(remainingCap);
      const subEl = body.querySelector('[data-qty-sub]');
      if (subEl) subEl.textContent = `1인 ${won(unitPrice)}, 잔여 ${remainingCap}명`;
      qtySync?.();
    }
    drawSummary();
  }

  async function reloadSeats() {
    const map = await api.offeringSeatMap(offeringId);
    statusById = Object.fromEntries(map.map((r) => [r.seat_id, r.status]));
    for (const id of [...selected]) if (statusById[id] !== 'AVAILABLE') selected.delete(id);
    existing = await api.myOfferingQty(offeringId);
    refreshLimits();
  }

  function onSeatToggle() {
    mapView.update({});
    listView.update({});
    drawSummary();
  }

  function buildSeatPanel() {
    const grades = ['R', 'S', 'A'].filter((g) => g in prices);
    const total = seats.length;
    const left = seats.filter((s) => statusById[s.id] === 'AVAILABLE').length;
    const legend = `<ul class="legend">
        ${grades.map((g) => `<li><i class="g-${g.toLowerCase()}"></i>${GRADE_NAME[g]} ${won(prices[g])}</li>`).join('')}
        <li><i class="g-sel"></i>선택한 좌석</li>
        <li><i class="g-sold"></i>판매 완료</li>
      </ul>`;
    body.innerHTML = `<div class="seat-tools">${legend}<span class="seat-count num">잔여 ${left}석 / ${total}석</span></div>`;
    body.append(live, mapHost, listHost);
    const ctx = { seats, statusById, selected, max: maxPick };
    mapView = renderSeatMap(mapHost, ctx, onSeatToggle);
    listView = renderSeatList(listHost, { ...ctx, prices }, onSeatToggle);
    el.querySelector('.view-toggle')?.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-view]');
      if (!b) return;
      const isMap = b.dataset.view === 'map';
      for (const x of el.querySelectorAll('.view-toggle button')) x.setAttribute('aria-pressed', String(x === b));
      mapHost.hidden = !isMap;
      listHost.hidden = isMap;
    });
  }

  function buildQtyPanel() {
    const soldNote = remainingCap != null ? `잔여 ${remainingCap}명` : '';
    if (type === 'COURSE') {
      body.innerHTML = `
        <div class="qty-fixed"><b>본인 1명 신청</b><span>정규 강좌는 1인 1건만 신청할 수 있어 인원은 바꿀 수 없습니다.</span></div>
        <dl class="qty-meta"><div><dt>수강료</dt><dd class="num">${won(unitPrice)}</dd></div><div><dt>잔여 정원</dt><dd class="num" data-cap>${remainingCap}</dd></div></dl>`;
      body.prepend(live);
      return;
    }
    body.innerHTML = `
      <div class="qty-row">
        <div><b id="qty-label">인원</b><span class="qty-sub" data-qty-sub>1인 ${won(unitPrice)}, ${soldNote}</span></div>
        <div class="stepper" role="group" aria-labelledby="qty-label">
          <button type="button" data-step="-1" aria-label="인원 줄이기">-</button>
          <output class="num" aria-live="polite" data-qty>${qty}명</output>
          <button type="button" data-step="1" aria-label="인원 늘리기">+</button>
        </div>
      </div>`;
    body.prepend(live);
    const out = body.querySelector('[data-qty]');
    const minus = body.querySelector('[data-step="-1"]');
    const plus = body.querySelector('[data-step="1"]');
    const sync = () => {
      out.textContent = `${qty}명`;
      minus.setAttribute('aria-disabled', String(qty <= 1));
      plus.setAttribute('aria-disabled', String(qty >= maxPick));
    };
    qtySync = sync;
    body.querySelector('.stepper').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-step]');
      if (!b) return;
      const next = qty + Number(b.dataset.step);
      if (next < 1) return;
      if (next > maxPick) {
        say(maxPick === limitLeft ? api.messageFor('LIMIT_EXCEEDED') : '남은 정원보다 많이 선택할 수 없습니다. 남은 인원 안에서 선택해 주세요.');
        return;
      }
      say('');
      qty = next;
      sync();
      drawSummary();
    });
    sync();
  }

  if (activeHold) {
    body.append(live);
    body.append(node('p', 'note', `이미 선점한 ${type === 'PERFORMANCE' ? '좌석' : '자리'}이 있습니다. 이어서 진행하거나 선점을 해제한 뒤 다시 선택해 주세요.`));
    drawSummary();
  } else if (maxPick <= 0) {
    body.append(live);
    say(api.messageFor('LIMIT_EXCEEDED'));
    drawSummary();
  } else {
    if (type === 'PERFORMANCE') buildSeatPanel(); else buildQtyPanel();
    drawSummary();
  }

  async function next(button) {
    if (busy || activeHold) return;
    if (!lines().count) {
      say(type === 'PERFORMANCE' ? '좌석을 선택한 뒤 다음 단계로 이동해 주세요.' : '인원을 선택한 뒤 다음 단계로 이동해 주세요.');
      return;
    }
    busy = true;
    say('');
    // 같은 동작의 다른 버튼(모바일 하단 바 등)도 함께 잠급니다.
    const others = [...el.querySelectorAll('[data-next]')].filter((x) => x !== button);
    others.forEach((x) => x.setAttribute('aria-disabled', 'true'));
    try {
      await withBusy(button, async () => {
        try {
          const hold = type === 'PERFORMANCE'
            ? await api.holdSeats(offeringId, [...selected])
            : await api.holdCapacity(offeringId, qty);
          stops.forEach((x) => x());
          go(`#/booking/${encodeURIComponent(hold.id)}/discount`);
        } catch (e) {
          say(describeError(e));
          try {
            if (type === 'PERFORMANCE') await reloadSeats();
            else {
              remainingCap = await api.remainingCapacity(offeringId);
              existing = await api.myOfferingQty(offeringId);
              refreshLimits();
            }
          } catch (e2) { console.error(e2); }
        }
      });
    } finally {
      busy = false;
      drawSummary();
    }
  }

  page.addEventListener('click', async (e) => {
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      const ids = [...selected];
      const index = ids.indexOf(Number(remove.dataset.remove));
      selected.delete(Number(remove.dataset.remove));
      mapView?.update({});
      listView?.update({});
      say('');
      mapView?.message('');
      drawSummary(index);
      return;
    }
    const nextBtn = e.target.closest('[data-next]');
    if (nextBtn) {
      next(nextBtn);
      return;
    }
    if (e.target.closest('[data-release]')) {
      const releaseBtn = e.target.closest('[data-release]');
      try {
        await withBusy(releaseBtn, () => api.releaseHold(activeHold.id));
        stops.forEach((s) => s());
        renderSelect(el, { api, go, offeringId, now });
      } catch (err) {
        say(describeError(err));
      }
    }
  });
}
