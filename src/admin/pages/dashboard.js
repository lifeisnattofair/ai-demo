// 대시보드: 역할별 주요 수치와 다가오는 회차
import { kstShortDateTime } from '../../lib/format.js';
import { showSkeleton } from '../../components/skeleton.js';
import { renderDataTable } from '../components/data-table.js';
import { TYPE_LABEL, loadInto, pageHead, typeChip } from '../components/page.js';

const kpi = (label, value, unit, note, link) => `<div class="kpi"><div class="k-label">${label}</div>`
  + `<div class="k-value">${value}${unit ? `<span>${unit}</span>` : ''}</div>`
  + `${note ? `<div class="k-note">${note}</div>` : ''}${link ? `<a class="k-link" href="${link.href}">${link.label}</a>` : ''}</div>`;

const n = (v) => Number(v ?? 0).toLocaleString('en-US');

/**
 * @param {HTMLElement} el
 * @param {{api:object, role:string, available:Set<string>, onCounts?:(c:Object)=>void}} ctx
 */
export async function renderDashboard(el, { api, role, available, onCounts }) {
  el.innerHTML = `${pageHead({ crumbs: ['대시보드'], title: '대시보드' })}
    <section aria-label="주요 수치"><div class="kpi-host"></div></section>
    <section class="result" aria-labelledby="up-h">
      <div class="result-head"><h2 id="up-h">다가오는 회차</h2><small>오늘부터 14일</small></div>
      <div class="up-host"></div>
    </section>`;
  const kpiHost = el.querySelector('.kpi-host');
  const upHost = el.querySelector('.up-host');
  const releaseUp = showSkeleton(upHost, 'table');
  const data = await loadInto(kpiHost, 'kpis', () => api.dashboard());
  releaseUp();
  if (!data) { upHost.replaceChildren(); return; }

  onCounts?.({ '#/waitlist': data.waiting, '#/cancel-requests': data.cancel_requests });
  const link = (href, label) => (available.has(href) ? { href, label } : null);
  const cards = role === 'finance'
    ? [
      kpi('오늘 결제액', n(data.today_paid), '원'),
      kpi('오늘 환불액', n(data.today_refund), '원'),
      kpi('오늘 확정 예약', n(data.today_bookings), '건'),
      kpi('회차 취소 승인 대기', n(data.cancel_requests), '건', null, link('#/cancel-requests', '승인 화면으로 이동')),
    ]
    : [
      kpi('판매 중인 회차', n(data.open_offerings), '개', '시작 전 회차 기준', link('#/offerings', '회차/좌석 관리로 이동')),
      kpi('오늘 확정 예약', n(data.today_bookings), '건'),
      kpi('대기 신청', n(data.waiting), '건', '대기 중과 승격 포함'),
      kpi('회차 취소 요청', n(data.cancel_requests), '건', '정산 담당 승인 대기', link('#/cancel-requests', '취소 요청 화면으로 이동')),
    ];
  kpiHost.innerHTML = `<div class="kpis">${cards.join('')}</div>`;

  const rows = data.upcoming ?? [];
  renderDataTable(upHost, {
    caption: '다가오는 회차 목록', compact: true,
    columns: [
      { key: 'starts_at', label: '회차 일시', format: (r) => kstShortDateTime(r.starts_at) },
      { key: 'type', label: '유형', type: 'chip', chip: (r) => typeChip(r.program.type) },
      { key: 'title', label: '프로그램', align: 'l', format: (r) => r.program.title },
      { key: 'capacity', label: '정원', type: 'number' },
      { key: 'sold', label: '판매/선점', type: 'number', format: (r) => n(r.capacity - r.remaining) },
      { key: 'remaining', label: '잔여', type: 'number' },
    ],
    rows,
    total: rows.length,
    page: 1,
    pageSize: rows.length || 1,
    onPage: () => {},
    empty: '14일 안에 시작하는 회차가 없습니다.',
    emptySub: role === 'operator' ? `${TYPE_LABEL.PERFORMANCE}, ${TYPE_LABEL.EXPERIENCE}, ${TYPE_LABEL.COURSE} 회차는 회차/좌석 관리에서 등록합니다.` : undefined,
  });
}
