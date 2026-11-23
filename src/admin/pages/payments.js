// 결제/환불 내역(정산 담당, SFR-022): 기간, 프로그램, 상태로 조회하고 결제대행 거래 번호를 확인합니다.
// 결제 원본(raw)은 「원본」을 누를 때만 admin_payment_raw 로 열고 작업 이력(VIEW_PAYMENT_RAW)에 남깁니다.
import { kstDateTime, kstDayKey, kstShortDateTime, won } from '../../lib/format.js';
import { toCsv, downloadCsv } from '../../lib/csv.js';
import { withBusy } from '../../components/button-busy.js';
import { confirmDialog } from '../../components/dialog.js';
import { now as clockNow } from '../../lib/clock.js';
import { describeError } from '../../lib/api.js';
import { quickRange, renderSearchBox } from '../components/search-box.js';
import { renderDataTable, pageOf } from '../components/data-table.js';
import { TYPE_LABEL, loadInto, pageHead } from '../components/page.js';
import { DOWNLOAD_ICON } from './bookings.js';

export const PAYMENT_STATUS = {
  DONE: { text: '결제 완료', tone: 'ok' },
  PARTIAL_CANCELED: { text: '부분 취소', tone: 'promo' },
  CANCELED: { text: '전체 취소', tone: 'refund' },
};
export const REFUND_REASON = {
  USER: { text: '회원 취소', tone: 'hold' },
  INSTITUTION: { text: '기관 취소', tone: 'refund' },
  CONFLICT: { text: '결제 충돌', tone: 'promo' },
};
export const RULE_SHORT = {
  D8_PLUS: '8일 전까지(수수료 없음)',
  D7_4: '7 - 4일 전(수수료 10%)',
  D3_1: '3 - 1일 전(수수료 30%)',
  MID_BEFORE_1_3: '수업 1/3 경과 전',
  MID_BEFORE_1_2: '수업 1/2 경과 전',
  MID_AFTER_1_2: '수업 1/2 경과 후',
  INSTITUTION_FULL: '기관 사정(전액)',
};
const TABS = [
  { key: 'payments', label: '결제 내역' },
  { key: 'refunds', label: '환불 내역' },
];
const ellipsis = (text) => {
  const s = document.createElement('span');
  s.className = 'ellipsis';
  s.title = text ?? '';
  s.textContent = text ?? '';
  return s;
};
const mono = (text) => {
  const s = document.createElement('span');
  s.className = 'num mono';
  s.textContent = text ?? '-';
  return s;
};

/**
 * @param {HTMLElement} el
 * @param {{api:object, now?:()=>Date}} ctx
 */
export async function renderPayments(el, { api, now = clockNow }) {
  const today = kstDayKey(now());
  const month = quickRange('1m', today);
  const state = { tab: 'payments', range: { from: month.from, to: month.to }, program: '', status: '', page: 1, pageSize: 20, payments: [], refunds: [] };

  el.innerHTML = `${pageHead({ crumbs: ['결제/정산', '결제/환불 내역'], title: '결제/환불 내역', help: '결제는 승인일, 환불은 환불일 기준입니다. 결제대행 거래 번호로 결제대행사 기록과 대조할 수 있습니다.' })}
    <div class="sb-host"></div>
    <section class="result" aria-label="조회 결과">
      <div class="toolbar">
        <span class="seg" role="group" aria-label="내역 종류">${TABS.map((t) => `<button type="button" data-tab="${t.key}" aria-pressed="${t.key === state.tab}">${t.label}</button>`).join('')}</span>
        <span class="total" aria-live="polite">총 <b class="num">0</b>건 <span class="muted sub"></span></span>
        <div class="tools">
          <button class="btn" type="button" data-act="csv">${DOWNLOAD_ICON}엑셀 다운로드</button>
          <label class="sr-only" for="ps">페이지당 건수</label><select class="ctl" id="ps"><option value="20">20건씩</option><option value="50">50건씩</option></select>
        </div>
      </div>
      <div class="tb-host"></div>
    </section>`;
  const tb = el.querySelector('.tb-host');

  async function openRaw(btn, r) {
    await withBusy(btn, async () => {
      try {
        const raw = (await api.paymentRaw(r.payment_id)) ?? {};
        const rows = Object.entries(raw).filter(([, v]) => v == null || typeof v !== 'object').slice(0, 14)
          .map(([k, v]) => [k, v == null ? '-' : String(v)]);
        await confirmDialog({
          title: '결제 승인 원본', message: `주문번호 ${r.order_id}`, rows,
          detail: '이 열람은 작업 이력에 기록되었습니다.', confirmLabel: '닫기', cancelLabel: null,
        });
      } catch (err) {
        await confirmDialog({ title: '결제 원본을 열지 못했습니다', message: describeError(err), confirmLabel: '닫기', cancelLabel: null });
      }
    });
  }

  const payColumns = [
    { key: 'no', label: '번호', type: 'number', align: 'c' },
    { key: 'approved_at', label: '승인 일시', format: (r) => (r.approved_at ? kstShortDateTime(r.approved_at) : '-') },
    { key: 'payment_key', label: '결제대행 거래 번호', align: 'l', format: (r) => mono(r.payment_key) },
    { key: 'booking_no', label: '예약번호', format: (r) => mono(r.booking_no) },
    { key: 'program_title', label: '프로그램', align: 'l', format: (r) => ellipsis(r.program_title) },
    { key: 'name_masked', label: '결제자' },
    { key: 'amount', label: '결제 금액', type: 'money' },
    { key: 'refunded_amount', label: '환불 금액', type: 'money' },
    { key: 'status', label: '상태', type: 'chip', chip: (r) => PAYMENT_STATUS[r.status] },
    { key: 'raw', label: '원본', format: (r) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link';
      b.textContent = '원본';
      b.setAttribute('aria-label', `${r.order_id} 결제 승인 원본 보기`);
      b.addEventListener('click', () => openRaw(b, r));
      return b;
    } },
  ];
  const refundColumns = [
    { key: 'no', label: '번호', type: 'number', align: 'c' },
    { key: 'created_at', label: '환불 일시', format: (r) => kstShortDateTime(r.created_at) },
    { key: 'pg_transaction_key', label: '결제대행 취소 거래 번호', align: 'l', format: (r) => mono(r.pg_transaction_key) },
    { key: 'payment_key', label: '원 결제 거래 번호', align: 'l', format: (r) => mono(r.payment_key) },
    { key: 'booking_no', label: '예약번호', format: (r) => mono(r.booking_no) },
    { key: 'program_title', label: '프로그램', align: 'l', format: (r) => ellipsis(r.program_title) },
    { key: 'name_masked', label: '결제자' },
    { key: 'paid_amount', label: '결제 금액', type: 'money' },
    { key: 'refund_amount', label: '환불 금액', type: 'money' },
    { key: 'fee_amount', label: '취소 수수료', type: 'money' },
    { key: 'reason', label: '사유', type: 'chip', chip: (r) => REFUND_REASON[r.reason] },
    { key: 'rule', label: '적용 규정', format: (r) => RULE_SHORT[r.rule] ?? r.rule ?? '-' },
  ];

  const statusOptions = () => (state.tab === 'payments'
    ? [{ value: '', label: '전체' }, ...Object.entries(PAYMENT_STATUS).map(([value, s]) => ({ value, label: s.text }))]
    : [{ value: '', label: '전체' }, ...Object.entries(REFUND_REASON).map(([value, s]) => ({ value, label: s.text }))]);

  const rowsOf = () => (state.tab === 'payments' ? state.payments : state.refunds)
    .filter((r) => (!state.program || r.program_id === state.program)
      && (!state.status || (state.tab === 'payments' ? r.status : r.reason) === state.status));

  function draw() {
    const rows = rowsOf();
    const sum = rows.reduce((a, r) => a + (state.tab === 'payments' ? r.amount : r.refund_amount), 0);
    el.querySelector('.total b').textContent = rows.length.toLocaleString('en-US');
    el.querySelector('.total .sub').textContent = rows.length ? `(${state.tab === 'payments' ? '결제' : '환불'} 합계 ${won(sum)})` : '';
    for (const b of el.querySelectorAll('[data-tab]')) b.setAttribute('aria-pressed', String(b.dataset.tab === state.tab));
    const page = pageOf(rows, state.page, state.pageSize).map((r, i) => ({ ...r, no: rows.length - ((state.page - 1) * state.pageSize + i) }));
    renderDataTable(tb, {
      caption: state.tab === 'payments' ? '결제 내역' : '환불 내역',
      columns: state.tab === 'payments' ? payColumns : refundColumns,
      rows: page, total: rows.length, page: state.page, pageSize: state.pageSize,
      onPage: (p) => { state.page = p; draw(); },
      empty: state.tab === 'payments' ? '조건에 맞는 결제가 없습니다.' : '조건에 맞는 환불이 없습니다.',
      emptySub: '기간을 넓히거나 조회 조건을 초기화해 주세요.',
    });
  }

  function drawSearch() {
    const programs = [...new Map([...state.payments, ...state.refunds].filter((r) => r.program_id).map((r) => [r.program_id, r.program_title])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1], 'ko'));
    renderSearchBox(el.querySelector('.sb-host'), [
      { name: 'date', label: state.tab === 'payments' ? '승인일' : '환불일', type: 'date-range', wide: true, today, value: state.range },
      { name: 'program', label: '프로그램', type: 'select', value: state.program, options: [{ value: '', label: '전체' }, ...programs.map(([id, t]) => ({ value: id, label: t }))] },
      { name: 'status', label: state.tab === 'payments' ? '결제 상태' : '환불 사유', type: 'select', value: state.status, options: statusOptions() },
    ], async (v) => {
      const changed = v.dateFrom !== state.range.from || v.dateTo !== state.range.to;
      state.range = { from: v.dateFrom, to: v.dateTo };
      state.program = v.program;
      state.status = v.status;
      state.page = 1;
      if (changed) await load();
      else draw();
    });
  }

  async function load() {
    const data = await loadInto(tb, 'table', async () => {
      const [payments, refunds] = await Promise.all([api.payments(state.range.from, state.range.to), api.refunds(state.range.from, state.range.to)]);
      return { payments, refunds };
    });
    if (!data) return;
    state.payments = data.payments;
    state.refunds = data.refunds;
    drawSearch();
    draw();
  }

  for (const b of el.querySelectorAll('[data-tab]')) {
    b.addEventListener('click', () => {
      if (state.tab === b.dataset.tab) return;
      state.tab = b.dataset.tab;
      state.status = '';
      state.page = 1;
      drawSearch();
      draw();
    });
  }
  el.querySelector('#ps').addEventListener('change', (e) => { state.pageSize = Number(e.target.value); state.page = 1; draw(); });

  const csvBtn = el.querySelector('[data-act="csv"]');
  csvBtn.addEventListener('click', () => withBusy(csvBtn, async () => {
    const key = (d) => (d ? d.replace(/-/g, '') : '전체');
    const range = `${key(state.range.from)}-${key(state.range.to)}`;
    if (state.tab === 'payments') {
      downloadCsv(`결제내역_${range}.csv`, toCsv([
        { key: 'approved_at', label: '승인 일시', value: (r) => (r.approved_at ? kstDateTime(r.approved_at) : '') },
        { key: 'order_id', label: '주문번호' },
        { key: 'payment_key', label: '결제대행 거래 번호' },
        { key: 'booking_no', label: '예약번호' },
        { key: 'type', label: '유형', value: (r) => TYPE_LABEL[r.program_type] ?? '' },
        { key: 'program_title', label: '프로그램' },
        { key: 'name_masked', label: '결제자' },
        { key: 'amount', label: '결제 금액' },
        { key: 'refunded_amount', label: '환불 금액' },
        { key: 'status', label: '상태', value: (r) => PAYMENT_STATUS[r.status]?.text },
      ], rowsOf()));
    } else {
      downloadCsv(`환불내역_${range}.csv`, toCsv([
        { key: 'created_at', label: '환불 일시', value: (r) => kstDateTime(r.created_at) },
        { key: 'pg_transaction_key', label: '결제대행 취소 거래 번호' },
        { key: 'payment_key', label: '원 결제 거래 번호' },
        { key: 'booking_no', label: '예약번호' },
        { key: 'program_title', label: '프로그램' },
        { key: 'name_masked', label: '결제자' },
        { key: 'paid_amount', label: '결제 금액' },
        { key: 'refund_amount', label: '환불 금액' },
        { key: 'fee_amount', label: '취소 수수료' },
        { key: 'reason', label: '사유', value: (r) => REFUND_REASON[r.reason]?.text },
        { key: 'rule', label: '적용 규정', value: (r) => RULE_SHORT[r.rule] ?? r.rule ?? '' },
      ], rowsOf()));
    }
  }));

  drawSearch();
  await load();
}
