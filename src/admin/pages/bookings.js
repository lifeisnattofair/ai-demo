// 예약 내역(운영/정산 담당): 조회 조건 -> 건수와 증빙 확인/CSV -> 목록(개인정보 가림) -> 예약번호를 누르면 상세(VIEW_PII)
// 증빙 확인(할인 매수의 현장 확인 기록)은 운영 담당만 합니다(Ruling R22). 디자인: design/mockups/admin-bookings.html
import { DISCOUNT_LABELS } from '@policy/pricing.js';
import { kstDateTime, kstDayKey, kstShortDateTime, won } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { withBusy } from '../../components/button-busy.js';
import { confirmDialog } from '../../components/dialog.js';
import { now as clockNow } from '../../lib/clock.js';
import { describeError } from '../../lib/api.js';
import { quickRange, renderSearchBox } from '../components/search-box.js';
import { renderDataTable, pageOf } from '../components/data-table.js';
import { TYPE_LABEL, TYPE_OPTIONS, loadInto, pageHead, typeChip } from '../components/page.js';
import { alertBox, noticeNear } from '../components/form.js';

export const DOWNLOAD_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';

const STATUS_CHIP = { CONFIRMED: { text: '확정', tone: 'ok' }, CANCELLED: { text: '취소', tone: 'cancel' } };
const PROOF = { TODO: { text: '확인 전', cls: 'todo' }, DONE: { text: '확인 완료', cls: 'done' } };
const DISCOUNT_FILTER = [
  { value: '', label: '전체' },
  { value: 'DISABLED', label: '장애인/동반' },
  { value: 'MERIT', label: '국가유공자/동반' },
  { value: 'MULTICHILD', label: '다자녀' },
];
const SEARCH_FIELDS = [
  { value: 'name', label: '예약자명' },
  { value: 'booking_no', label: '예약번호' },
  { value: 'phone4', label: '휴대폰 뒤 4자리' },
];
const isDiscount = (t) => t && t !== 'GENERAL' && t !== 'NONE';

/** 할인 유형 목록을 표시 문구로: ['DISABLED','DISABLED_COMPANION'] -> '장애인, 장애인 동반' */
export function discountText(types) {
  return (types ?? []).map((t) => DISCOUNT_LABELS[t] ?? t).join(', ');
}

/** 선택한 예약 중 증빙 확인 전인 할인 매수(확정 예약만). */
export function proofTargets(rows, selected) {
  const out = [];
  for (const r of rows) {
    if (!selected.has(r.booking_id) || r.status !== 'CONFIRMED') continue;
    for (const it of r.items ?? []) {
      if (isDiscount(it.discount_type) && !it.proof_checked) out.push({ itemId: it.id, bookingNo: r.booking_no });
    }
  }
  return out;
}

const seatText = (r) => r.seats || `${r.qty}명`;
const proofText = (r) => PROOF[r.proof]?.text ?? '-';

function proofNode(r) {
  const p = PROOF[r.proof];
  const s = document.createElement('span');
  if (!p) {
    s.className = 'muted';
    s.textContent = '-';
    return s;
  }
  s.className = `proof ${p.cls}`;
  s.textContent = p.text;
  return s;
}

/**
 * @param {HTMLElement} el
 * @param {{api:object, role:'operator'|'finance', query?:URLSearchParams, now?:()=>Date}} ctx
 */
export async function renderBookings(el, { api, role, query, now = clockNow }) {
  const canProof = role === 'operator';
  const today = kstDayKey(now());
  const week = quickRange('7d', today);
  const state = {
    filters: {
      date: { from: week.from, to: week.to }, type: '', program: '', offering: query?.get('offering') ?? '',
      status: ['CONFIRMED'], discount: '', q: '', qField: 'name',
    },
    page: 1, pageSize: 20, rows: [], selected: new Set(), offerings: [],
  };

  el.innerHTML = `${pageHead({ crumbs: ['예약관리', '예약 내역'], title: '예약 내역', help: '개인정보는 일부를 가려 표시합니다. 예약번호를 누르면 상세 정보를 볼 수 있고, 열람 기록이 남습니다.' })}
    <div class="sb-host"></div>
    <div class="alert-host"></div>
    <section class="result" aria-label="조회 결과">
      <div class="toolbar">
        <span class="total" aria-live="polite" hidden>총 <b class="num">0</b>건 <span class="muted sub"></span></span>
        <div class="tools">
          ${canProof ? '<button class="btn" type="button" data-act="proof">증빙 확인 처리</button>' : ''}
          <button class="btn" type="button" data-act="csv">${DOWNLOAD_ICON}CSV 다운로드</button>
          <label class="sr-only" for="ps">페이지당 건수</label><select class="ctl" id="ps"><option value="20">20건씩</option><option value="50">50건씩</option></select>
        </div>
      </div>
      <div class="tb-host"></div>
    </section>`;
  const tb = el.querySelector('.tb-host');
  const alertHost = el.querySelector('.alert-host');
  const visible = () => state.rows.filter((r) => !state.filters.type || r.program_type === state.filters.type);
  const pageRows = () => pageOf(visible(), state.page, state.pageSize);
  // 머리글 체크박스: 이 쪽이 모두 선택이면 체크, 일부면 중간 상태
  const syncHeader = (input) => {
    if (!input) return;
    const ids = pageRows().map((r) => r.booking_id);
    const n = ids.filter((id) => state.selected.has(id)).length;
    input.checked = ids.length > 0 && n === ids.length;
    input.indeterminate = n > 0 && n < ids.length;
  };
  // 조회 조건(유형 등)으로 안 보이게 된 행은 선택에서 뺍니다(일괄 처리가 숨은 행을 건드리지 않도록).
  const pruneSelection = () => {
    const ids = new Set(visible().map((r) => r.booking_id));
    for (const id of state.selected) if (!ids.has(id)) state.selected.delete(id);
  };

  // 체크박스는 44px 누름 영역(label)으로 감쌉니다.
  const checkbox = (label, checked, onChange) => {
    const wrap = document.createElement('label');
    wrap.className = 'cb';
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = checked;
    c.setAttribute('aria-label', label);
    c.addEventListener('change', () => onChange(c));
    wrap.append(c);
    return wrap;
  };

  async function openDetail(btn, r) {
    await withBusy(btn, async () => {
      try {
        const m = await api.viewMember(r.user_id);
        await confirmDialog({
          title: '예약 상세',
          message: `예약번호 ${r.booking_no}, 결제 금액 ${won(r.total_amount)}`,
          rows: [
            ['프로그램', r.program_title], ['회차', kstDateTime(r.starts_at)], ['좌석/인원', seatText(r)],
            ['할인', discountText(r.discounts) || '없음'], ['증빙', PROOF[r.proof]?.text ?? '대상 아님'],
            ['이름', m.name], ['휴대폰', m.phone], ['이메일', m.email],
          ],
          detail: '이 열람은 작업 이력에 기록되었습니다.', confirmLabel: '닫기', cancelLabel: null,
        });
      } catch (err) {
        await confirmDialog({ title: '예약 상세를 열지 못했습니다', message: describeError(err), confirmLabel: '닫기', cancelLabel: null });
      }
    });
  }

  const columns = [
    ...(canProof ? [{
      key: 'sel', label: '선택', header: () => {
        const box = checkbox('이 쪽 전체 선택', false, (c) => {
          for (const r of pageRows()) {
            if (c.checked) state.selected.add(r.booking_id); else state.selected.delete(r.booking_id);
          }
          draw();
        });
        syncHeader(box.querySelector('input'));
        return box;
      },
      format: (r) => checkbox(`${r.booking_no} 선택`, state.selected.has(r.booking_id), (c) => {
        if (c.checked) state.selected.add(r.booking_id); else state.selected.delete(r.booking_id);
        c.closest('tr')?.classList.toggle('is-selected', c.checked);
        syncHeader(tb.querySelector('thead input[type="checkbox"]'));
      }),
    }] : []),
    { key: 'no', label: '번호', type: 'number', align: 'c' },
    { key: 'booking_no', label: '예약번호', format: (r) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link num';
      b.textContent = r.booking_no;
      b.setAttribute('aria-label', `${r.booking_no} 예약 상세`);
      b.addEventListener('click', () => openDetail(b, r));
      return b;
    } },
    { key: 'type', label: '유형', type: 'chip', chip: (r) => typeChip(r.program_type) },
    { key: 'program_title', label: '프로그램', align: 'l', format: (r) => {
      const s = document.createElement('span');
      s.className = 'ellipsis';
      s.title = r.program_title;
      s.textContent = r.program_title;
      return s;
    } },
    { key: 'starts_at', label: '회차', format: (r) => kstShortDateTime(r.starts_at) },
    { key: 'seats', label: '좌석/인원', align: 'l', format: seatText },
    { key: 'name_masked', label: '예약자' },
    { key: 'phone_masked', label: '연락처' },
    { key: 'discounts', label: '할인', format: (r) => discountText(r.discounts) },
    { key: 'total_amount', label: '결제 금액', type: 'money' },
    { key: 'status', label: '상태', type: 'chip', chip: (r) => STATUS_CHIP[r.status] },
    { key: 'proof', label: '증빙', format: proofNode },
    { key: 'created_at', label: '예약 일시', format: (r) => kstShortDateTime(r.created_at) },
  ];

  function draw() {
    pruneSelection();
    const rows = visible();
    const confirmed = rows.filter((r) => r.status === 'CONFIRMED').length;
    el.querySelector('.total').hidden = false;
    el.querySelector('.total b').textContent = rows.length.toLocaleString('en-US');
    el.querySelector('.total .sub').textContent = rows.length ? `(확정 ${confirmed.toLocaleString('en-US')}, 취소 ${(rows.length - confirmed).toLocaleString('en-US')})` : '';
    const page = pageOf(rows, state.page, state.pageSize).map((r, i) => ({ ...r, no: rows.length - ((state.page - 1) * state.pageSize + i) }));
    renderDataTable(tb, {
      caption: '예약 내역 목록', columns, rows: page, total: rows.length, page: state.page, pageSize: state.pageSize,
      rowClass: (r) => (state.selected.has(r.booking_id) ? 'is-selected' : ''),
      onPage: (p) => { state.page = p; draw(); el.querySelector('.result').scrollIntoView({ block: 'start' }); },
      empty: '조건에 맞는 예약이 없습니다.', emptySub: '기간을 넓히거나 조회 조건을 초기화해 주세요.',
    });
  }

  async function load() {
    const f = state.filters;
    const rows = await loadInto(tb, 'table', () => api.bookings({
      from: f.date.from, to: f.date.to, program: f.program, offering: f.offering, statuses: f.status,
      discount: f.discount, field: f.qField, q: f.q,
    }));
    if (!rows) return;
    state.rows = rows;
    draw();
  }

  // 첫 목록 조회는 선택지 조회를 기다리지 않고 바로 시작해 스켈레톤을 먼저 보입니다(감사 #18).
  const firstLoad = load();
  // 프로그램/회차 선택지는 회차 목록으로 만듭니다(실패해도 목록 조회는 됩니다).
  try { state.offerings = (await api.offerings()) ?? []; } catch { state.offerings = []; }
  const programs = [...new Map(state.offerings.map((o) => [o.program_id, o.program])).entries()]
    .sort((a, b) => a[1].title.localeCompare(b[1].title, 'ko'));
  const offeringOptions = (programId) => {
    const list = state.offerings.filter((o) => !programId || o.program_id === programId)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    return [{ value: '', label: `전체 회차 (${list.length})` },
      ...list.map((o) => ({ value: o.id, label: programId ? kstShortDateTime(o.starts_at) : `${o.program.title} | ${kstShortDateTime(o.starts_at)}` }))];
  };

  renderSearchBox(el.querySelector('.sb-host'), [
    { name: 'date', label: '예약일', type: 'date-range', wide: true, today, value: state.filters.date },
    { name: 'type', label: '유형', type: 'select', options: TYPE_OPTIONS },
    { name: 'program', label: '프로그램', type: 'select', options: [{ value: '', label: '전체' }, ...programs.map(([id, p]) => ({ value: id, label: p.title }))] },
    { name: 'offering', label: '회차', type: 'select', options: offeringOptions(''), value: state.filters.offering },
    { name: 'status', label: '예약 상태', type: 'checks', options: [{ value: 'CONFIRMED', label: '확정' }, { value: 'CANCELLED', label: '취소' }], value: state.filters.status },
    { name: 'discount', label: '할인 유형', type: 'select', options: DISCOUNT_FILTER },
    { name: 'q', label: '검색어', type: 'text', placeholder: '검색어 입력', fieldOptions: SEARCH_FIELDS },
  ], (v) => {
    state.filters = { date: { from: v.dateFrom, to: v.dateTo }, type: v.type, program: v.program, offering: v.offering, status: v.status, discount: v.discount, q: v.q, qField: v.qField };
    state.page = 1;
    alertHost.replaceChildren();
    load();
  });

  // 프로그램을 고르면 회차 선택지를 그 프로그램의 회차로 바꿉니다.
  const progSel = el.querySelector('.sb-host select[name="program"]');
  const offSel = el.querySelector('.sb-host select[name="offering"]');
  const fillOfferings = () => {
    const keep = offSel.value;
    offSel.replaceChildren(...offeringOptions(progSel.value).map((o) => new Option(o.label, o.value)));
    offSel.value = [...offSel.options].some((o) => o.value === keep) ? keep : '';
  };
  progSel.addEventListener('change', fillOfferings);
  // 초기화는 조회 상자가 값을 되돌린 뒤(먼저 등록된 처리) 선택지를 다시 채웁니다.
  el.querySelector('.sb-host [data-act="reset"]').addEventListener('click', fillOfferings);

  el.querySelector('#ps').addEventListener('change', (e) => { state.pageSize = Number(e.target.value); state.page = 1; draw(); });

  const csvBtn = el.querySelector('[data-act="csv"]');
  csvBtn.addEventListener('click', () => withBusy(csvBtn, async () => {
    exportCsv(`예약내역_${today.replace(/-/g, '')}.csv`, [
      { key: 'booking_no', label: '예약번호' },
      { key: 'type', label: '유형', value: (r) => TYPE_LABEL[r.program_type] },
      { key: 'program_title', label: '프로그램' },
      { key: 'starts_at', label: '회차', value: (r) => kstDateTime(r.starts_at) },
      { key: 'seats', label: '좌석/인원', value: seatText },
      { key: 'name_masked', label: '예약자' },
      { key: 'phone_masked', label: '연락처' },
      { key: 'discounts', label: '할인', value: (r) => discountText(r.discounts) },
      { key: 'total_amount', label: '결제 금액' },
      { key: 'status', label: '상태', value: (r) => STATUS_CHIP[r.status]?.text },
      { key: 'proof', label: '증빙', value: proofText },
      { key: 'created_at', label: '예약 일시', value: (r) => kstDateTime(r.created_at) },
    ], visible(), (m) => noticeNear(csvBtn, m));
  }));

  const proofBtn = el.querySelector('[data-act="proof"]');
  proofBtn?.addEventListener('click', () => withBusy(proofBtn, async () => {
    if (!state.selected.size) { alertBox(alertHost, '증빙을 확인할 예약을 목록에서 먼저 선택해 주세요.'); return; }
    pruneSelection();
    const targets = proofTargets(visible(), state.selected);
    if (!targets.length) { alertBox(alertHost, '선택한 예약에 증빙 확인 전인 할인 매수가 없습니다. 할인을 적용한 확정 예약을 선택해 주세요.'); return; }
    const bookings = new Set(targets.map((t) => t.bookingNo)).size;
    const ok = await confirmDialog({
      title: '증빙 확인 처리',
      message: `선택한 예약 ${bookings}건의 할인 ${targets.length}매를 현장 증빙 확인 완료로 기록합니다.`,
      detail: '증빙 파일은 받지 않고 확인 여부만 남깁니다. 기록은 작업 이력에 남습니다.',
      confirmLabel: '확인 처리', cancelLabel: '닫기',
    });
    if (!ok) return;
    let done = 0;
    let failure = null;
    for (const t of targets) {
      try {
        await api.markProof(t.itemId, true);
        done += 1;
      } catch (err) {
        failure = err;
        break;
      }
    }
    state.selected.clear();
    await load();
    if (failure) alertBox(alertHost, `할인 ${done}매까지 기록하고 멈췄습니다. ${describeError(failure)}`);
    else alertBox(alertHost, `할인 ${done}매의 증빙 확인을 기록했습니다.`, 'ok');
  }));

  await firstLoad;
}
