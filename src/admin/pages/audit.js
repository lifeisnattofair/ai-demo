// 작업 이력(운영, 정산 담당): 누가 언제 무엇을 바꾸거나 열어 봤는지. 작업자 이름은 서버가 가려서 보냅니다.
import { addDays, fromKstInput, kstDateTime, kstDayKey } from '../../lib/format.js';
import { now as clockNow } from '../../lib/clock.js';
import { ROLE_LABEL } from '../layout.js';
import { renderSearchBox } from '../components/search-box.js';
import { pageOf, renderDataTable } from '../components/data-table.js';
import { loadInto, pageHead } from '../components/page.js';

const ACTIONS = {
  PROGRAM_CREATE: '프로그램 등록',
  PROGRAM_UPDATE: '프로그램 수정',
  OFFERING_CREATE: '회차 등록',
  OFFERING_UPDATE: '회차 수정',
  PRICE_SET: '가격 설정',
  PROOF_CHECK: '증빙 확인',
  VIEW_PII: '개인정보 열람',
  VIEW_PAYMENT_RAW: '결제 원본 열람',
  OFFERING_CANCEL_REQUEST: '회차 취소 요청',
  OFFERING_CANCEL_APPROVE: '회차 취소 승인',
  OFFERING_CANCEL_REJECT: '회차 취소 반려',
  OFFERING_CANCEL: '회차 취소 처리',
  CLOCK_SET: '검수용 시계 변경',
  RESET_DEMO: '시연 데이터 초기화',
};
const TARGETS = {
  program: '프로그램', offering: '회차', profile: '회원', payment: '결제', booking_item: '예약 매수', app_settings: '설정', system: '시스템',
};

export const actionLabel = (code) => ACTIONS[code] ?? code;

const PAGE_SIZE = 20;

/**
 * @param {HTMLElement} el
 * @param {{api:{audit:(f:object)=>Promise<object[]>}, now?:()=>Date}} ctx
 */
export async function renderAudit(el, { api, now = clockNow }) {
  const state = { rows: [], page: 1 };
  el.innerHTML = `${pageHead({ crumbs: ['시스템', '작업 이력'], title: '작업 이력', help: '프로그램, 회차, 가격 변경과 개인정보, 결제 원본 열람 기록입니다. 최신순으로 최대 1,000건까지 보입니다.' })}
    <div class="sb-host"></div>
    <section class="result" aria-label="조회 결과">
      <div class="toolbar"><span class="total" aria-live="polite">총 <b class="num">0</b>건</span></div>
      <div class="tb-host"></div>
    </section>`;
  const tb = el.querySelector('.tb-host');

  const columns = [
    { key: 'at', label: '작업 일시', format: (r) => kstDateTime(r.at) },
    { key: 'actor', label: '작업자', align: 'l', format: (r) => (r.actor_id ? `${r.actor_name_masked ?? '-'} (${ROLE_LABEL[r.actor_role] ?? '-'})` : '-') },
    { key: 'action', label: '작업 종류', align: 'l', format: (r) => actionLabel(r.action) },
    { key: 'target', label: '대상', align: 'l', format: (r) => {
      const s = document.createElement('span');
      const id = String(r.target_id ?? '');
      s.textContent = `${TARGETS[r.target_type] ?? r.target_type ?? '-'}${id ? ` ${id.length > 8 ? id.slice(0, 8) : id}` : ''}`;
      if (id) s.title = id;
      return s;
    } },
    { key: 'detail', label: '상세', align: 'l', format: (r) => {
      const d = document.createElement('details');
      d.className = 'audit-detail';
      const sum = document.createElement('summary');
      sum.textContent = '보기';
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(r.detail ?? {}, null, 2);
      d.append(sum, pre);
      return d;
    } },
  ];

  function draw() {
    el.querySelector('.total b').textContent = state.rows.length.toLocaleString('en-US');
    renderDataTable(tb, {
      caption: '작업 이력 목록', columns, rows: pageOf(state.rows, state.page, PAGE_SIZE), total: state.rows.length, page: state.page, pageSize: PAGE_SIZE,
      onPage: (p) => { state.page = p; draw(); },
      empty: '조건에 맞는 작업 이력이 없습니다.', emptySub: '기간이나 작업 종류를 바꿔 다시 조회해 주세요.',
    });
  }

  const first = await loadInto(tb, 'grid-table', () => api.audit({}));
  if (!first) return;
  state.rows = first;

  // 조회 상자의 선택지는 처음 불러온 전체 이력에서 만듭니다.
  const actors = new Map();
  for (const r of first) if (r.actor_id && !actors.has(r.actor_id)) actors.set(r.actor_id, `${r.actor_name_masked ?? '-'} (${ROLE_LABEL[r.actor_role] ?? '-'})`);
  const kinds = [...new Set(first.map((r) => r.action))].sort((a, b) => actionLabel(a).localeCompare(actionLabel(b), 'ko'));
  renderSearchBox(el.querySelector('.sb-host'), [
    { name: 'period', label: '기간', type: 'date-range', today: kstDayKey(now()) },
    { name: 'actor', label: '작업자', type: 'select', options: [{ value: '', label: '전체' }, ...[...actors].map(([value, label]) => ({ value, label }))] },
    { name: 'kind', label: '작업 종류', type: 'select', options: [{ value: '', label: '전체' }, ...kinds.map((value) => ({ value, label: actionLabel(value) }))] },
  ], async (v) => {
    const f = {
      from: v.periodFrom ? fromKstInput(v.periodFrom) : null,
      to: v.periodTo ? fromKstInput(addDays(v.periodTo, 1)) : null,
      actor: v.actor || null,
      action: v.kind || null,
    };
    const rows = await loadInto(tb, 'grid-table', () => api.audit(f));
    if (!rows) return;
    state.rows = rows;
    state.page = 1;
    draw();
  });
  draw();
}
