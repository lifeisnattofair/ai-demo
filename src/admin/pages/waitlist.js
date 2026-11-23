// 대기자 관리(운영 담당): 회차별 대기 순번, 신청 수량과 배정 수량, 승격 결제 기한. 개인정보는 가림(SFR-021).
import { kstDateTime, kstDayKey, kstShortDateTime } from '../../lib/format.js';
import { toCsv, downloadCsv } from '../../lib/csv.js';
import { withBusy } from '../../components/button-busy.js';
import { now as clockNow } from '../../lib/clock.js';
import { renderSearchBox } from '../components/search-box.js';
import { renderDataTable, pageOf } from '../components/data-table.js';
import { TYPE_LABEL, TYPE_OPTIONS, loadInto, pageHead, typeChip } from '../components/page.js';
import { DOWNLOAD_ICON } from './bookings.js';

const ACTIVE = new Set(['WAITING', 'PROMOTED']);
export const WAIT_STATUS = {
  WAITING: { text: '대기 중', tone: 'hold' },
  PROMOTED: { text: '승격(결제 대기)', tone: 'promo' },
  COMPLETED: { text: '예매 완료', tone: 'ok' },
  EXPIRED: { text: '기한 만료', tone: 'cancel' },
  CANCELLED: { text: '신청 취소', tone: 'cancel' },
  RELEASED: { text: '대기 종료', tone: 'cancel' },
};
const STATE_OPTIONS = [
  { value: 'ACTIVE', label: '진행 중(대기, 승격)' },
  { value: '', label: '전체' },
  { value: 'WAITING', label: '대기 중' },
  { value: 'PROMOTED', label: '승격(결제 대기)' },
  { value: 'CLOSED', label: '종료' },
];

export function filterWaitlist(rows, f) {
  return rows.filter((r) => (!f.type || r.program_type === f.type)
    && (!f.program || r.program_id === f.program)
    && (!f.state || (f.state === 'ACTIVE' ? ACTIVE.has(r.status) : f.state === 'CLOSED' ? !ACTIVE.has(r.status) : r.status === f.state)));
}

/**
 * @param {HTMLElement} el
 * @param {{api:object, query?:URLSearchParams, now?:()=>Date}} ctx
 */
export async function renderWaitlist(el, { api, query, now = clockNow }) {
  const state = { filters: { type: '', program: query?.get('program') ?? '', state: 'ACTIVE' }, page: 1, pageSize: 20, rows: [] };
  el.innerHTML = `${pageHead({ crumbs: ['예약관리', '대기자 관리'], title: '대기자 관리', help: '순번은 회차별 진행 중 신청의 순서입니다. 취소분이 1순위 신청 수량만큼 모이면 자동으로 승격되고 24시간 안에 결제해야 합니다.' })}
    <div class="sb-host"></div>
    <section class="result" aria-label="조회 결과">
      <div class="toolbar">
        <span class="total" aria-live="polite">총 <b class="num">0</b>건</span>
        <div class="tools">
          <button class="btn" type="button" data-act="csv">${DOWNLOAD_ICON}엑셀 다운로드</button>
          <label class="sr-only" for="ps">페이지당 건수</label><select class="ctl" id="ps"><option value="20">20건씩</option><option value="50">50건씩</option></select>
        </div>
      </div>
      <div class="tb-host"></div>
    </section>`;
  const tb = el.querySelector('.tb-host');
  const filtered = () => filterWaitlist(state.rows, state.filters);
  const columns = [
    { key: 'position', label: '순번', type: 'number', align: 'c', format: (r) => r.position ?? '-' },
    { key: 'type', label: '유형', type: 'chip', chip: (r) => typeChip(r.program_type) },
    { key: 'program_title', label: '프로그램', align: 'l', format: (r) => {
      const s = document.createElement('span');
      s.className = 'ellipsis';
      s.title = r.program_title;
      s.textContent = r.program_title;
      return s;
    } },
    { key: 'starts_at', label: '회차', format: (r) => kstShortDateTime(r.starts_at) },
    { key: 'name_masked', label: '신청자' },
    { key: 'phone_masked', label: '연락처' },
    { key: 'qty', label: '신청 수량', type: 'number' },
    { key: 'allocated_qty', label: '배정 수량', type: 'number' },
    { key: 'status', label: '상태', type: 'chip', chip: (r) => WAIT_STATUS[r.status] },
    { key: 'created_at', label: '신청 일시', format: (r) => kstShortDateTime(r.created_at) },
    { key: 'deadline_at', label: '결제 기한', format: (r) => (r.status === 'PROMOTED' && r.deadline_at ? kstShortDateTime(r.deadline_at) : '-') },
  ];

  function draw() {
    const rows = filtered();
    el.querySelector('.total b').textContent = rows.length.toLocaleString('en-US');
    renderDataTable(tb, {
      caption: '대기자 목록', columns, rows: pageOf(rows, state.page, state.pageSize), total: rows.length, page: state.page, pageSize: state.pageSize,
      onPage: (p) => { state.page = p; draw(); },
      empty: state.rows.length ? '조건에 맞는 대기 신청이 없습니다.' : '대기 신청이 없습니다.',
      emptySub: state.rows.length ? '조회 조건을 바꾸거나 초기화해 주세요.' : '매진된 회차에 회원이 대기 신청을 하면 여기에 나옵니다.',
    });
  }

  const rows = await loadInto(tb, 'grid-table', () => api.waitlist());
  if (!rows) return;
  state.rows = rows;
  const programs = [...new Map(rows.map((r) => [r.program_id, r.program_title])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'ko'));
  renderSearchBox(el.querySelector('.sb-host'), [
    { name: 'type', label: '유형', type: 'select', options: TYPE_OPTIONS },
    { name: 'program', label: '프로그램', type: 'select', value: state.filters.program, options: [{ value: '', label: '전체' }, ...programs.map(([id, t]) => ({ value: id, label: t }))] },
    { name: 'state', label: '상태', type: 'select', options: STATE_OPTIONS, value: state.filters.state },
  ], (v) => { state.filters = v; state.page = 1; draw(); });

  el.querySelector('#ps').addEventListener('change', (e) => { state.pageSize = Number(e.target.value); state.page = 1; draw(); });
  const csvBtn = el.querySelector('[data-act="csv"]');
  csvBtn.addEventListener('click', () => withBusy(csvBtn, async () => {
    downloadCsv(`대기자목록_${kstDayKey(now()).replace(/-/g, '')}.csv`, toCsv([
      { key: 'position', label: '순번', value: (r) => r.position ?? '' },
      { key: 'type', label: '유형', value: (r) => TYPE_LABEL[r.program_type] },
      { key: 'program_title', label: '프로그램' },
      { key: 'starts_at', label: '회차', value: (r) => kstDateTime(r.starts_at) },
      { key: 'name_masked', label: '신청자' },
      { key: 'phone_masked', label: '연락처' },
      { key: 'qty', label: '신청 수량' },
      { key: 'allocated_qty', label: '배정 수량' },
      { key: 'status', label: '상태', value: (r) => WAIT_STATUS[r.status]?.text },
      { key: 'created_at', label: '신청 일시', value: (r) => kstDateTime(r.created_at) },
      { key: 'deadline_at', label: '결제 기한', value: (r) => (r.status === 'PROMOTED' && r.deadline_at ? kstDateTime(r.deadline_at) : '') },
    ], filtered()));
  }));
  draw();
}
