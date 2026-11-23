// 회차/좌석 관리(운영 담당): 회차 목록, 회차 등록/수정(일정, 정원, 가격, 수업 일정), 좌석 현황, 예약자(가림 처리)
import { escapeHtml, fromKstInput, kstDateTime, kstDayKey, kstShortDateTime, toKstInput, won } from '../../lib/format.js';
import { toCsv, downloadCsv } from '../../lib/csv.js';
import { withBusy } from '../../components/button-busy.js';
import { confirmDialog } from '../../components/dialog.js';
import { now as clockNow } from '../../lib/clock.js';
import { describeError } from '../../lib/api.js';
import { renderSearchBox } from '../components/search-box.js';
import { renderDataTable, pageOf } from '../components/data-table.js';
import { TYPE_LABEL, TYPE_OPTIONS, loadInto, offeringState, pageHead, typeChip } from '../components/page.js';
import { alertBox, formRow, showErrors } from '../components/form.js';

const DOWNLOAD_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
const WEEK = 7 * 24 * 60 * 60 * 1000;
const SEAT_COUNT = 200;
const GRADES = ['R', 'S', 'A'];
const STATE_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'ON_SALE', label: '판매 중' },
  { value: 'BEFORE', label: '판매 전' },
  { value: 'CLOSED', label: '판매 종료' },
  { value: 'CANCEL_REQUESTED', label: '취소 요청' },
  { value: 'CANCELLED', label: '회차 취소' },
];
const link = (href, text) => {
  const a = document.createElement('a');
  a.className = 'link';
  a.href = href;
  a.textContent = text;
  return a;
};

export function filterOfferings(rows, f, nowMs) {
  return rows.filter((r) => {
    const day = kstDayKey(r.starts_at);
    return (!f.program || r.program_id === f.program)
      && (!f.type || r.program?.type === f.type)
      && (!f.state || offeringState(r, nowMs).key === f.state)
      && (!f.dateFrom || day >= f.dateFrom)
      && (!f.dateTo || day <= f.dateTo);
  });
}

export async function renderOfferings(el, { api, query }) {
  const state = { filters: { program: query?.get('program') ?? '' }, page: 1, pageSize: 20, rows: [], stats: new Map() };
  el.innerHTML = `${pageHead({ crumbs: ['프로그램관리', '회차/좌석 관리'], title: '회차/좌석 관리', help: '판매, 선점, 대기 수량은 지금 기준입니다. 회차 일시를 누르면 수정하고 좌석과 예약자를 볼 수 있습니다.' })}
    <div class="sb-host"></div>
    <section class="result" aria-label="조회 결과">
      <div class="toolbar">
        <span class="total" aria-live="polite">총 <b class="num">0</b>건</span>
        <div class="tools">
          <button class="btn" type="button" data-act="csv">${DOWNLOAD_ICON}엑셀 다운로드</button>
          <label class="sr-only" for="ps">페이지당 건수</label><select class="ctl" id="ps"><option value="20">20건씩</option><option value="50">50건씩</option></select>
          <a class="btn btn-primary" href="#/offerings/new">회차 등록</a>
        </div>
      </div>
      <div class="tb-host"></div>
    </section>`;
  const tb = el.querySelector('.tb-host');
  const nowMs = clockNow().getTime();
  const stat = (r, k) => state.stats.get(r.id)?.[k] ?? 0;
  const filtered = () => filterOfferings(state.rows, state.filters, nowMs);
  const columns = [
    { key: 'no', label: '번호', type: 'number', align: 'c' },
    { key: 'type', label: '유형', type: 'chip', chip: (r) => typeChip(r.program?.type) },
    { key: 'title', label: '프로그램', align: 'l', format: (r) => {
      const s = document.createElement('span');
      s.className = 'ellipsis';
      s.title = r.program?.title ?? '';
      s.textContent = r.program?.title ?? '';
      return s;
    } },
    { key: 'starts_at', label: '회차 일시', format: (r) => link(`#/offerings/${r.id}`, kstDateTime(r.starts_at)) },
    { key: 'sale', label: '판매 기간', format: (r) => `${kstShortDateTime(r.sale_starts_at)} - ${kstShortDateTime(r.sale_ends_at)}` },
    { key: 'capacity', label: '정원', type: 'number' },
    { key: 'sold', label: '판매', type: 'number', format: (r) => stat(r, 'sold') },
    { key: 'held', label: '선점', type: 'number', format: (r) => stat(r, 'held') },
    { key: 'waiting', label: '대기', type: 'number', format: (r) => stat(r, 'waiting') },
    { key: 'remaining', label: '잔여', type: 'number', format: (r) => stat(r, 'remaining') },
    { key: 'status', label: '상태', type: 'chip', chip: (r) => offeringState(r, nowMs) },
  ];

  function draw() {
    const rows = filtered();
    el.querySelector('.total b').textContent = rows.length.toLocaleString('en-US');
    const page = pageOf(rows, state.page, state.pageSize).map((r, i) => ({ ...r, no: (state.page - 1) * state.pageSize + i + 1 }));
    renderDataTable(tb, {
      caption: '회차 목록', columns, rows: page, total: rows.length, page: state.page, pageSize: state.pageSize,
      onPage: (p) => { state.page = p; draw(); },
      empty: state.rows.length ? '조건에 맞는 회차가 없습니다.' : '등록된 회차가 없습니다.',
      emptySub: state.rows.length ? '조회 조건을 바꾸거나 초기화해 주세요.' : undefined,
      emptyAction: state.rows.length ? undefined : { label: '회차 등록', href: '#/offerings/new' },
    });
  }

  const data = await loadInto(tb, 'grid-table', async () => {
    const [rows, stats] = await Promise.all([api.offerings(), api.offeringStats()]);
    return { rows, stats };
  });
  if (!data) return;
  state.rows = data.rows;
  state.stats = new Map(data.stats.map((s) => [s.offering_id, s]));

  const programs = [...new Map(state.rows.map((r) => [r.program_id, r.program])).entries()]
    .sort((a, b) => a[1].title.localeCompare(b[1].title, 'ko'));
  renderSearchBox(el.querySelector('.sb-host'), [
    { name: 'date', label: '회차 기간', type: 'date-range', wide: true },
    { name: 'program', label: '프로그램', type: 'select', value: state.filters.program,
      options: [{ value: '', label: '전체' }, ...programs.map(([id, p]) => ({ value: id, label: p.title }))] },
    { name: 'type', label: '유형', type: 'select', options: TYPE_OPTIONS },
    { name: 'state', label: '상태', type: 'select', options: STATE_OPTIONS },
  ], (v) => { state.filters = v; state.page = 1; draw(); });

  el.querySelector('#ps').addEventListener('change', (e) => { state.pageSize = Number(e.target.value); state.page = 1; draw(); });
  el.querySelector('[data-act="csv"]').addEventListener('click', () => {
    downloadCsv(`회차목록_${kstDayKey(clockNow()).replace(/-/g, '')}.csv`, toCsv([
      { key: 'type', label: '유형', value: (r) => TYPE_LABEL[r.program?.type] },
      { key: 'title', label: '프로그램', value: (r) => r.program?.title },
      { key: 'starts_at', label: '회차 일시', value: (r) => kstDateTime(r.starts_at) },
      { key: 'sale', label: '판매 기간', value: (r) => `${kstDateTime(r.sale_starts_at)} - ${kstDateTime(r.sale_ends_at)}` },
      { key: 'capacity', label: '정원' },
      { key: 'sold', label: '판매', value: (r) => stat(r, 'sold') },
      { key: 'held', label: '선점', value: (r) => stat(r, 'held') },
      { key: 'waiting', label: '대기', value: (r) => stat(r, 'waiting') },
      { key: 'remaining', label: '잔여', value: (r) => stat(r, 'remaining') },
      { key: 'status', label: '상태', value: (r) => offeringState(r, nowMs).text },
    ], filtered()));
  });
  draw();
}

// 주 1회 수업 일정(첫 수업 일시부터 count 회)
export function weeklyLessons(firstIso, count) {
  const t = Date.parse(firstIso);
  if (!Number.isFinite(t) || !(count >= 1)) return [];
  return Array.from({ length: count }, (_, i) => new Date(t + i * WEEK).toISOString());
}

/**
 * 회차 입력 검사(화면). 값은 ISO 일시와 숫자입니다. 서버(admin_upsert_offering)가 같은 규칙을 다시 봅니다.
 * @returns {Object<string,string>} 필드별 오류
 */
export function validateOffering(v, { type, isNew, nowMs, minCapacity = 0 }) {
  const e = {};
  if (!v.program_id) e.program_id = '프로그램을 선택해 주세요.';
  if (!v.starts_at) e.starts_at = '시작 일시를 입력해 주세요.';
  else if (isNew && Date.parse(v.starts_at) <= nowMs) e.starts_at = '지난 일시로는 등록할 수 없습니다.';
  if (!v.ends_at) e.ends_at = '종료 일시를 입력해 주세요.';
  else if (v.starts_at && Date.parse(v.ends_at) <= Date.parse(v.lastLesson ?? v.starts_at)) {
    e.ends_at = type === 'COURSE' ? '종료 일시는 마지막 수업 시작보다 늦어야 합니다.' : '종료 일시는 시작 일시보다 늦어야 합니다.';
  }
  if (!v.sale_starts_at) e.sale_starts_at = '판매 시작 일시를 입력해 주세요.';
  if (!v.sale_ends_at) e.sale_ends_at = '판매 종료 일시를 입력해 주세요.';
  else if (v.sale_starts_at && Date.parse(v.sale_ends_at) <= Date.parse(v.sale_starts_at)) e.sale_ends_at = '판매 종료는 판매 시작보다 늦어야 합니다.';
  else if (v.starts_at && Date.parse(v.sale_ends_at) > Date.parse(v.starts_at)) e.sale_ends_at = '판매는 회차 시작 전에 끝나야 합니다.';
  if (type !== 'PERFORMANCE') {
    if (!Number.isInteger(v.capacity) || v.capacity < 1 || v.capacity > 10000) e.capacity = '정원은 1에서 10,000 사이의 숫자로 입력해 주세요.';
    else if (v.capacity < minCapacity) e.capacity = `판매, 선점, 대기 배정된 ${minCapacity.toLocaleString('en-US')}명보다 작게 줄일 수 없습니다.`;
  }
  if (type === 'COURSE' && (!Number.isInteger(v.lessonCount) || v.lessonCount < 1 || v.lessonCount > 52)) e.lessonCount = '수업 횟수는 1에서 52 사이로 입력해 주세요.';
  for (const p of v.prices ?? []) {
    if (!Number.isInteger(p.price) || p.price < 0 || p.price > 10000000) e[`price_${p.grade ?? 'N'}`] = '가격은 0원 이상의 숫자로 입력해 주세요.';
  }
  return e;
}

const num = (s) => (String(s ?? '').trim() === '' ? NaN : Number(String(s).replace(/,/g, '')));

export async function renderOfferingEdit(el, { api, go, id, query }) {
  const isNew = !id;
  const title = isNew ? '회차 등록' : '회차 수정';
  el.innerHTML = `${pageHead({ crumbs: ['프로그램관리', '회차/좌석 관리', title], title })}<div class="form-host"></div>`;
  const host = el.querySelector('.form-host');

  const data = await loadInto(host, 'form', async () => {
    if (isNew) return { programs: await api.programs() };
    const [off, stats] = await Promise.all([api.offering(id), api.offeringStats()]);
    return { off, stat: stats.find((s) => s.offering_id === id) };
  });
  if (!data) return;
  if (!isNew && !data.off) {
    host.innerHTML = '<div class="page-message"><h2 class="page-title">회차를 찾을 수 없습니다.</h2><p>주소가 잘못되었거나 볼 수 없는 회차입니다. 목록에서 다시 선택해 주세요.</p><a class="btn-secondary" href="#/offerings">회차 목록</a></div>';
    return;
  }
  const off = data.off ?? {};
  const stat = data.stat ?? { sold: 0, held: 0, waiting: 0, remaining: 0 };
  const used = isNew ? 0 : Math.max(0, off.capacity - stat.remaining);
  const closed = !isNew && off.status !== 'OPEN';
  const programs = isNew ? data.programs : [off.program];
  const lessons = [...(off.lessons ?? [])].sort((a, b) => a.seq - b.seq);
  const lessonsLocked = !isNew && used > 0;
  const priceOf = (g) => (off.prices ?? []).find((p) => (p.grade ?? null) === g)?.price;

  const progOpts = `${isNew ? '<option value="">프로그램 선택</option>' : ''}${programs.map((p) => `<option value="${p.id}" data-type="${p.type}"${(off.program_id ?? query?.get('program')) === p.id ? ' selected' : ''}>[${TYPE_LABEL[p.type]}] ${escapeHtml(p.title)}</option>`).join('')}`;
  const dis = closed ? ' disabled' : '';
  host.innerHTML = `<div class="alert-host">${closed ? '<p class="form-alert" role="status">취소되었거나 취소 요청 중인 회차라 고칠 수 없습니다.</p>' : ''}</div>
    <form class="off-form" novalidate>
      <section class="form-card" aria-labelledby="fs-sch"><h2 id="fs-sch">회차 정보</h2><div class="form-grid">
        ${formRow({ label: '프로그램', required: true, name: 'program_id', field: `<select class="ctl half" id="f-program_id" name="program_id"${isNew ? '' : ' disabled'}>${progOpts}</select>`,
          hint: isNew ? '먼저 프로그램을 등록해야 회차를 만들 수 있습니다.' : '등록한 회차의 프로그램은 바꿀 수 없습니다.' })}
        ${formRow({ label: '시작 일시', required: true, name: 'starts_at', field: `<input class="ctl dt" type="datetime-local" id="f-starts_at" name="starts_at" value="${toKstInput(off.starts_at)}"${dis}${lessonsLocked && off.program?.type === 'COURSE' ? ' readonly' : ''}>`, hint: '-' })}
        ${formRow({ label: '종료 일시', required: true, name: 'ends_at', field: `<input class="ctl dt" type="datetime-local" id="f-ends_at" name="ends_at" value="${toKstInput(off.ends_at)}"${dis}>`, hint: '-' })}
        <div class="course-only contents">
          ${formRow({ label: '수업 횟수', required: true, name: 'lessonCount', field: `<div class="row"><input class="ctl money" type="number" inputmode="numeric" min="1" max="52" id="f-lessonCount" name="lessonCount" value="${lessons.length || 12}"${dis}${lessonsLocked ? ' readonly' : ''}><span>회 (주 1회)</span></div><ol class="lesson-list" aria-label="수업 일정"></ol>`,
            hint: lessonsLocked ? '판매가 시작되어 수업 일정을 바꿀 수 없습니다.' : '첫 수업부터 매주 같은 요일, 같은 시각으로 만듭니다.' })}
        </div>
        ${formRow({ label: '판매 기간', required: true, name: 'sale', group: true, field: `<div class="row"><label class="sr-only" for="f-sale_starts_at">판매 시작 일시</label><input class="ctl dt" type="datetime-local" id="f-sale_starts_at" name="sale_starts_at" value="${toKstInput(off.sale_starts_at)}"${dis}><span aria-hidden="true">-</span><label class="sr-only" for="f-sale_ends_at">판매 종료 일시</label><input class="ctl dt" type="datetime-local" id="f-sale_ends_at" name="sale_ends_at" value="${toKstInput(off.sale_ends_at)}"${dis}></div>`,
          hint: '판매는 회차 시작 전에 끝나야 합니다.' })}
        ${formRow({ label: '정원', required: true, name: 'capacity', field: `<div class="row"><input class="ctl money" type="number" inputmode="numeric" min="1" id="f-capacity" name="capacity" value="${off.capacity ?? ''}"${dis}><span class="cap-unit">명</span></div>`,
          hint: isNew ? '' : `지금 판매 ${stat.sold}, 선점 ${stat.held}, 대기 배정 포함 사용 ${used}. 이보다 작게 줄일 수 없습니다.` })}
      </div></section>
      <section class="form-card" aria-labelledby="fs-price"><h2 id="fs-price">가격</h2><div class="form-grid price-grid"></div></section>
      <div class="seat-host"></div>
      <div class="booking-host"></div>
      <div class="save-bar"><span class="state">가격을 바꿔도 이미 확정된 예약 금액은 그대로입니다.</span>
        <div class="acts"><a class="btn" href="#/offerings">목록</a>${closed ? '' : '<button class="btn btn-primary" type="submit">저장</button>'}</div></div>
    </form>`;

  const form = host.querySelector('form');
  const progSel = form.elements.program_id;
  const courseRows = form.querySelector('.course-only');
  const priceGrid = form.querySelector('.price-grid');
  const typeNow = () => progSel.selectedOptions[0]?.dataset.type ?? off.program?.type ?? '';

  function drawPrices() {
    const type = typeNow();
    if (!type) {
      priceGrid.innerHTML = '<p class="hint pad">프로그램을 고르면 가격 항목이 나옵니다.</p>';
      return;
    }
    const grades = type === 'PERFORMANCE' ? GRADES : [null];
    priceGrid.innerHTML = grades.map((g) => formRow({
      label: g ? `${g}석` : '1인 가격', required: true, name: `price_${g ?? 'N'}`,
      field: `<div class="row"><input class="ctl money" type="number" inputmode="numeric" min="0" step="1000" id="f-price_${g ?? 'N'}" name="price_${g ?? 'N'}" value="${priceOf(g) ?? ''}"${dis}><span>원</span></div>`,
      hint: g === 'R' ? 'R석 A~D열 80석, S석 E~G열 60석, A석 H~J열 60석' : undefined,
    })).join('');
  }

  // 유형에 맞는 안내 문구(정규 강좌만 수업 기준)
  const setHint = (name, text) => {
    const h = form.querySelector(`[data-field="${name}"] .hint`);
    h.textContent = text;
    h.hidden = !text;
  };

  function drawType() {
    const type = typeNow();
    courseRows.hidden = type !== 'COURSE';
    setHint('starts_at', type === 'COURSE' ? '첫 수업 시작 일시입니다.' : '');
    setHint('ends_at', type === 'COURSE' ? '마지막 수업이 끝나는 일시입니다.' : '');
    const cap = form.elements.capacity;
    if (type === 'PERFORMANCE') {
      cap.value = String(SEAT_COUNT);
      cap.readOnly = true;
      form.querySelector('[data-field="capacity"] .hint')?.replaceChildren(document.createTextNode('공연 정원은 좌석 수(200석)로 정해집니다.'));
    } else {
      cap.readOnly = closed;
      if (isNew && cap.value === String(SEAT_COUNT)) cap.value = '';
    }
    drawPrices();
    drawLessons();
    showErrors(form, {});
  }

  function drawLessons() {
    const list = form.querySelector('.lesson-list');
    if (typeNow() !== 'COURSE') { list.replaceChildren(); return; }
    const dates = lessonsLocked
      ? lessons.map((l) => l.starts_at)
      : weeklyLessons(fromKstInput(form.elements.starts_at.value), Number(form.elements.lessonCount.value));
    list.innerHTML = dates.map((d, i) => `<li><b>${i + 1}회</b>${escapeHtml(kstShortDateTime(d))}</li>`).join('');
  }

  progSel.addEventListener('change', drawType);
  form.elements.starts_at.addEventListener('change', drawLessons);
  form.elements.lessonCount.addEventListener('input', drawLessons);
  drawType();

  if (!isNew) {
    if (off.program?.type === 'PERFORMANCE') drawSeats(host.querySelector('.seat-host'), api, off.id);
    drawBookings(host.querySelector('.booking-host'), api, off.id);
  }

  const alertHost = host.querySelector('.alert-host');
  const saveBtn = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (closed) return;
    const type = typeNow();
    const lessonCount = Number(form.elements.lessonCount.value);
    const startsAt = fromKstInput(form.elements.starts_at.value);
    const genLessons = type === 'COURSE' && !lessonsLocked ? weeklyLessons(startsAt, lessonCount) : null;
    const prices = (type === 'PERFORMANCE' ? GRADES : [null]).map((g) => ({ grade: g, price: num(form.elements[`price_${g ?? 'N'}`]?.value) }));
    const v = {
      program_id: isNew ? progSel.value : off.program_id,
      starts_at: startsAt,
      ends_at: fromKstInput(form.elements.ends_at.value),
      sale_starts_at: fromKstInput(form.elements.sale_starts_at.value),
      sale_ends_at: fromKstInput(form.elements.sale_ends_at.value),
      capacity: type === 'PERFORMANCE' ? SEAT_COUNT : num(form.elements.capacity.value),
      lessonCount: type === 'COURSE' ? (lessonsLocked ? lessons.length : lessonCount) : undefined,
      lastLesson: type === 'COURSE' ? (genLessons?.at(-1) ?? lessons.at(-1)?.starts_at) : undefined,
      prices,
    };
    const errs = validateOffering(v, { type, isNew, nowMs: clockNow().getTime(), minCapacity: used });
    // 판매 시작/종료는 한 줄(sale)에 함께 표시합니다.
    if (errs.sale_starts_at || errs.sale_ends_at) errs.sale = errs.sale_starts_at ?? errs.sale_ends_at;
    if (showErrors(form, errs)) { alertHost.replaceChildren(); return; }

    const payload = {
      starts_at: v.starts_at, ends_at: v.ends_at, sale_starts_at: v.sale_starts_at, sale_ends_at: v.sale_ends_at, prices,
    };
    if (type !== 'PERFORMANCE') payload.capacity = v.capacity;
    if (isNew) payload.program_id = v.program_id;
    else payload.id = off.id;
    // 수업 일정은 바뀌었을 때만 보냅니다(판매 시작 뒤에는 서버가 거절).
    if (genLessons && (isNew || genLessons.join() !== lessons.map((l) => new Date(l.starts_at).toISOString()).join())) payload.lessons = genLessons;

    withBusy(saveBtn, async () => {
      try {
        const saved = await api.saveOffering(payload);
        if (isNew) {
          sessionStorage.setItem('admin-flash', '회차를 등록했습니다. 사용자 화면에서 바로 예약할 수 있습니다.');
          await go(`#/offerings/${saved.id}`);
        } else {
          alertBox(alertHost, '저장했습니다. 사용자 화면에도 바로 반영됩니다.', 'ok');
        }
      } catch (err) {
        const field = { CAPACITY_BELOW_SOLD: 'capacity', INVALID_CAPACITY: 'capacity', INVALID_PRICE: type === 'PERFORMANCE' ? 'price_R' : 'price_N', LESSONS_LOCKED: 'lessonCount' }[err.code];
        if (field) showErrors(form, { [field]: err.message });
        else alertBox(alertHost, err.message);
      }
    });
  });
  const flash = sessionStorage.getItem('admin-flash');
  if (flash) { sessionStorage.removeItem('admin-flash'); alertBox(alertHost, flash, 'ok'); }
}

const SEAT_STATES = [
  ['AVAILABLE', '판매 가능'],
  ['HELD', '선점'],
  ['WAIT_ALLOCATED', '대기 배정'],
  ['SOLD', '판매'],
];
const seatKey = (s) => (s === 'PAYING' ? 'HELD' : s);

// 좌석 현황: 등급별 집계 표와 축소 배치도(색과 함께 각 좌석 이름/상태를 글자로 제공)
async function drawSeats(host, api, offeringId) {
  host.innerHTML = '<section class="result" aria-labelledby="fs-seat"><div class="result-head"><h2 id="fs-seat">좌석 현황</h2><small>결제 중은 선점에 포함</small></div><div class="seat-body"></div></section>';
  const body = host.querySelector('.seat-body');
  const seats = await loadInto(body, 'table', () => api.seatMap(offeringId));
  if (!seats) return;
  const by = Object.fromEntries(GRADES.map((g) => [g, { AVAILABLE: 0, HELD: 0, WAIT_ALLOCATED: 0, SOLD: 0, total: 0 }]));
  for (const s of seats) {
    const b = by[s.seat.grade];
    b[seatKey(s.status)] += 1;
    b.total += 1;
  }
  const rows = GRADES.map((g) => ({ grade: `${g}석`, ...by[g] }));
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const rowsMap = new Map();
  for (const s of [...seats].sort((a, b) => a.seat_id - b.seat_id)) {
    if (!rowsMap.has(s.seat.row_label)) rowsMap.set(s.seat.row_label, []);
    rowsMap.get(s.seat.row_label).push(s);
  }
  const label = Object.fromEntries(SEAT_STATES);
  body.innerHTML = `<div class="seat-overview">
      <div class="table-scroll"><table class="grid-table compact"><caption class="sr-only">등급별 좌석 상태</caption>
        <thead><tr><th scope="col">등급</th>${SEAT_STATES.map(([, l]) => `<th scope="col" class="r">${l}</th>`).join('')}<th scope="col" class="r">합계</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><th scope="row">${r.grade}</th>${SEAT_STATES.map(([k]) => `<td class="r">${r[k]}</td>`).join('')}<td class="r">${r.total}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>합계</td>${SEAT_STATES.map(([k]) => `<td class="r">${sum(k)}</td>`).join('')}<td class="r">${sum('total')}</td></tr></tfoot>
      </table></div>
      <ul class="seat-legend">${SEAT_STATES.map(([k, l]) => `<li><i class="st-${k}" aria-hidden="true"></i>${l}</li>`).join('')}</ul>
      <div class="mini-map" aria-hidden="true">${[...rowsMap.entries()].map(([row, list]) => `<div class="mrow"><span>${row}</span>${list.map((s) => `<i class="st-${seatKey(s.status)}" title="${row}열 ${s.seat.seat_no}번 ${label[seatKey(s.status)]}"></i>`).join('')}</div>`).join('')}</div>
    </div>`;
}

// 예약자 목록(이름, 휴대폰 가림). 「상세」는 전체 정보를 열고 작업 이력에 열람 기록(VIEW_PII)을 남깁니다.
async function drawBookings(host, api, offeringId) {
  host.innerHTML = '<section class="result" aria-labelledby="fs-bk"><div class="result-head"><h2 id="fs-bk">예약자</h2><small>개인정보는 일부를 가려 표시합니다. 상세를 열면 열람 기록이 남습니다.</small></div><div class="bk-body"></div></section>';
  const body = host.querySelector('.bk-body');
  const rows = await loadInto(body, 'grid-table', () => api.offeringBookings(offeringId));
  if (!rows) return;
  renderDataTable(body, {
    caption: '이 회차의 예약자', rows, total: rows.length, page: 1, pageSize: rows.length || 1, onPage: () => {},
    columns: [
      { key: 'booking_no', label: '예약번호', format: (r) => { const s = document.createElement('span'); s.className = 'num'; s.textContent = r.booking_no; return s; } },
      { key: 'name_masked', label: '예약자' },
      { key: 'phone_masked', label: '연락처' },
      { key: 'seats', label: '좌석', align: 'l' },
      { key: 'qty', label: '매수(인원)', type: 'number' },
      { key: 'total_amount', label: '결제 금액', type: 'money' },
      { key: 'status', label: '상태', type: 'chip', chip: (r) => (r.status === 'CONFIRMED' ? { text: '확정', tone: 'ok' } : { text: '취소', tone: 'cancel' }) },
      { key: 'created_at', label: '예약 일시', format: (r) => kstShortDateTime(r.created_at) },
      { key: 'view', label: '상세', format: (r) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'link';
        b.textContent = '상세';
        b.setAttribute('aria-label', `${r.booking_no} 예약자 상세`);
        b.addEventListener('click', () => withBusy(b, async () => {
          try {
            const m = await api.viewMember(r.user_id);
            await confirmDialog({
              title: '예약자 상세', message: `예약번호 ${r.booking_no}, 결제 금액 ${won(r.total_amount)}`,
              rows: [['이름', m.name], ['휴대폰', m.phone], ['이메일', m.email]],
              detail: '이 열람은 작업 이력에 기록되었습니다.', confirmLabel: '닫기', cancelLabel: null,
            });
          } catch (err) {
            await confirmDialog({ title: '예약자 정보를 열지 못했습니다', message: describeError(err), confirmLabel: '닫기', cancelLabel: null });
          }
        }));
        return b;
      } },
    ],
    empty: '아직 예약이 없습니다.',
  });
}

