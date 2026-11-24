// 정산 현황(정산 담당, SFR-024, AC-6): 기간/프로그램 조건, 기간 합계(결제, 환불, 취소 수수료, 순매출),
// 일별 순매출 그래프, 프로그램별 순매출, 일별/프로그램별 정산표(합계 행), CSV 내려받기.
// 순매출 = 결제 금액 - 환불 금액. 취소 수수료는 결제 금액에 이미 들어 있습니다. 디자인: design/mockups/admin-settlement.html
import { dayKeyLabel, dayKeysBetween, escapeHtml, kstDateTime, kstDayKey, won } from '../../lib/format.js';
import { NO_ROWS_MESSAGE, toCsv, downloadCsv } from '../../lib/csv.js';
import { withBusy } from '../../components/button-busy.js';
import { showSkeleton } from '../../components/skeleton.js';
import { now as clockNow } from '../../lib/clock.js';
import { renderDataTable } from '../components/data-table.js';
import { loadInto, pageHead } from '../components/page.js';
import { alertBox } from '../components/form.js';
import { DOWNLOAD_ICON } from './bookings.js';

const MAX_DAYS = 366;
const n = (v) => Number(v ?? 0);
const fmt = (v) => n(v).toLocaleString('en-US');

/**
 * staff_settlement 행(날짜 x 프로그램)을 화면용으로 묶습니다.
 * @param {Object[]} rows
 * @param {{from?:string, to?:string, program?:string}} f
 */
export function summarizeSettlement(rows, { from, to, program } = {}) {
  const list = rows.filter((r) => !program || r.program_id === program);
  const totals = { paid: 0, paidCount: 0, refund: 0, refundCount: 0, userRefundCount: 0, institutionRefundCount: 0, fee: 0, feeCount: 0, net: 0 };
  const byDay = new Map();
  const byProgram = new Map();
  const add = (acc, r) => {
    acc.paid += n(r.paid_sum);
    acc.paidCount += n(r.paid_count);
    acc.refund += n(r.refund_sum);
    acc.refundCount += n(r.refund_count);
    acc.fee += n(r.fee_sum);
    acc.net += n(r.net_sum);
  };
  const blank = () => ({ paid: 0, paidCount: 0, refund: 0, refundCount: 0, fee: 0, net: 0 });
  for (const r of list) {
    add(totals, r);
    totals.userRefundCount += n(r.user_refund_count);
    totals.institutionRefundCount += n(r.institution_refund_count);
    totals.feeCount += n(r.fee_count);
    if (!byDay.has(r.day)) byDay.set(r.day, { day: r.day, ...blank() });
    add(byDay.get(r.day), r);
    if (!byProgram.has(r.program_id)) byProgram.set(r.program_id, { programId: r.program_id, title: r.program_title, type: r.program_type, ...blank() });
    add(byProgram.get(r.program_id), r);
  }
  const keys = list.map((r) => r.day).sort();
  const span = dayKeysBetween(from || keys[0], to || keys.at(-1));
  const days = span.map((day) => byDay.get(day) ?? { day, ...blank() });
  const programs = [...byProgram.values()].sort((a, b) => b.net - a.net || a.title.localeCompare(b.title, 'ko'));
  let max = null;
  let min = null;
  for (const d of days) {
    if (!max || d.net > max.net) max = { day: d.day, net: d.net };
    if (!min || d.net < min.net) min = { day: d.day, net: d.net };
  }
  return { totals, days, programs, stats: { avg: days.length ? Math.round(totals.net / days.length) : 0, max, min } };
}

/** 그래프 세로축: 최댓값을 보기 좋은 값으로 올림하고 눈금 4개(위에서 아래로)를 돌려줍니다. */
export function chartScale(maxValue) {
  if (!(maxValue > 0)) return { max: 3, ticks: [3, 2, 1, 0] };
  const raw = maxValue / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((x) => x * mag).find((s) => s >= raw - 1e-9);
  return { max: step * 3, ticks: [step * 3, step * 2, step, 0] };
}

// 막대 위 짧은 금액: 1,330,000 -> 133만, 36,000 -> 3.6만(100만 원 미만은 소수 한 자리, QA D-06)
export function manLabel(v) {
  const a = Math.abs(v);
  if (a < 10000) return fmt(v);
  const man = a >= 1000000 ? Math.round(v / 10000) : Math.round(v / 1000) / 10;
  return `${man.toLocaleString('en-US', { maximumFractionDigits: 1 })}만`;
}

const kpi = (label, count, value, note, cls = '') => `<div class="kpi${cls ? ` ${cls}` : ''}"><div class="k-label">${label}${count != null ? `<small>${fmt(count)}건</small>` : ''}</div>`
  + `<div class="k-value">${fmt(value)}<span>원</span></div><div class="k-note">${note}</div></div>`;

function chartHtml(s, from, to) {
  const { days, stats } = s;
  const scale = chartScale(Math.max(0, ...days.map((d) => d.net)));
  const dense = days.length > 14;
  const every = Math.ceil(days.length / 10);
  const cols = `grid-template-columns: repeat(${days.length}, minmax(0, 1fr))`;
  const summary = stats.max && stats.max.net > 0
    ? `${dayKeyLabel(stats.max.day, { short: true })}이 ${won(stats.max.net)}으로 가장 높음`
    : '순매출이 있는 날이 없음';
  return `<div class="chart${dense ? ' dense' : ''}" role="img" aria-label="${escapeHtml(`${dayKeyLabel(from)}부터 ${dayKeyLabel(to)}까지 일별 순매출 막대 그래프. ${summary}`)}">
      <div class="axis" aria-hidden="true">${scale.ticks.map((t) => `<span>${fmt(t)}</span>`).join('')}</div>
      <div class="plot" aria-hidden="true" style="${cols}">${days.map((d) => {
        const h = d.net > 0 ? Math.max(0.5, (d.net / scale.max) * 100) : 0;
        return `<div class="bar${d.net < 0 ? ' zero neg' : d.net === 0 ? ' zero' : ''}" style="height:${h.toFixed(1)}%" title="${escapeHtml(`${dayKeyLabel(d.day)} ${won(d.net)}`)}"><span>${manLabel(d.net)}</span></div>`;
      }).join('')}</div>
      <div class="xl" aria-hidden="true" style="${cols}">${days.map((d, i) => `<span>${i % every === 0 ? escapeHtml(dayKeyLabel(d.day, { short: true })) : ''}</span>`).join('')}</div>
    </div>
    <dl class="chart-stats">
      <div><dt>일평균 순매출</dt><dd>${won(stats.avg)}</dd></div>
      <div><dt>최고</dt><dd>${won(stats.max?.net ?? 0)}<small>${stats.max ? escapeHtml(dayKeyLabel(stats.max.day, { short: true })) : ''}</small></dd></div>
      <div><dt>최저</dt><dd>${won(stats.min?.net ?? 0)}<small>${stats.min ? escapeHtml(dayKeyLabel(stats.min.day, { short: true })) : ''}</small></dd></div>
    </dl>`;
}

function shareHtml(programs) {
  if (!programs.length) return '<p class="hint pad">프로그램별 자료가 없습니다.</p>';
  const total = programs.reduce((a, p) => a + Math.max(0, p.net), 0);
  return `<ul class="share">${programs.map((p) => {
    const pct = total > 0 ? (Math.max(0, p.net) / total) * 100 : 0;
    return `<li><span class="ellipsis" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</span><b>${fmt(p.net)}</b><span class="meter" aria-hidden="true"><i style="width:${pct.toFixed(1)}%"></i></span></li>`;
  }).join('')}</ul>`;
}

const AMOUNT_COLUMNS = [
  { key: 'paidCount', label: '결제 건수', type: 'number' },
  { key: 'paid', label: '결제 금액', type: 'money' },
  { key: 'refundCount', label: '환불 건수', type: 'number' },
  { key: 'refund', label: '환불 금액', type: 'money' },
  { key: 'fee', label: '취소 수수료', type: 'money' },
  { key: 'net', label: '순매출', type: 'money' },
];
const totalsRow = (t) => ['합계', t.paidCount, t.paid, t.refundCount, t.refund, t.fee, t.net];

/**
 * @param {HTMLElement} el
 * @param {{api:object, now?:()=>Date}} ctx
 */
export async function renderSettlement(el, { api, now = clockNow }) {
  const today = kstDayKey(now());
  const state = { from: `${today.slice(0, 8)}01`, to: today, program: '', view: 'day', rows: [], summary: null };

  el.innerHTML = `${pageHead({ crumbs: ['결제/정산', '정산 현황'], title: '정산 현황', help: `결제는 승인일, 환불은 환불일 기준(한국 시간)으로 집계합니다. ${kstDateTime(now())} 기준` })}
    <form class="filter-bar" novalidate aria-label="정산 조건">
      <span class="fg"><span class="fl" id="st-period">기간</span><label class="sr-only" for="st-from">시작일</label><input class="ctl date" type="date" id="st-from" name="from" value="${state.from}"><span aria-hidden="true">-</span><label class="sr-only" for="st-to">종료일</label><input class="ctl date" type="date" id="st-to" name="to" value="${state.to}"></span>
      <span class="sep" aria-hidden="true"></span>
      <span class="fg"><label class="fl" for="st-prog">프로그램</label><select class="ctl" id="st-prog" name="program"><option value="">전체 프로그램</option></select></span>
      <span class="sep" aria-hidden="true"></span>
      <span class="fg"><span class="fl" id="st-view">집계</span><span class="seg" role="group" aria-labelledby="st-view"><button type="button" data-view="day" aria-pressed="true">일별</button><button type="button" data-view="program" aria-pressed="false">프로그램별</button></span></span>
      <div class="push"><button class="btn btn-dark" type="submit">조회</button><button class="btn" type="button" data-act="csv">${DOWNLOAD_ICON}CSV 다운로드</button></div>
    </form>
    <div class="alert-host"></div>
    <section class="kpi-host" aria-label="기간 합계"></section>
    <div class="body-host"></div>`;
  const form = el.querySelector('.filter-bar');
  const alertHost = el.querySelector('.alert-host');
  const kpiHost = el.querySelector('.kpi-host');
  const bodyHost = el.querySelector('.body-host');
  const progSel = form.elements.program;

  function drawKpis(t) {
    kpiHost.innerHTML = `<div class="kpis">
        ${kpi('결제 금액', t.paidCount, t.paid, '승인 완료 기준')}
        ${kpi('환불 금액', t.refundCount, t.refund, `회원 취소 ${fmt(t.userRefundCount)}건, 기관 취소 ${fmt(t.institutionRefundCount)}건`)}
        ${kpi('취소 수수료 수입', t.feeCount, t.fee, '결제 금액에 포함')}
        ${kpi('순매출', null, t.net, '결제 금액 - 환불 금액', 'net')}
      </div>`;
  }

  function drawTable() {
    const host = bodyHost.querySelector('.st-table');
    if (!host) return;
    const s = state.summary;
    const byDay = state.view === 'day';
    host.closest('.result').querySelector('.total').innerHTML = byDay
      ? `일별 정산 <b class="num">${fmt(s.days.length)}</b>일`
      : `프로그램별 정산 <b class="num">${fmt(s.programs.length)}</b>개`;
    const rows = byDay ? s.days : s.programs;
    renderDataTable(host, {
      caption: byDay ? '일별 정산표' : '프로그램별 정산표', compact: true,
      columns: [byDay
        ? { key: 'day', label: '일자', format: (r) => dayKeyLabel(r.day) }
        : { key: 'title', label: '프로그램', align: 'l' }, ...AMOUNT_COLUMNS],
      rows, total: rows.length, page: 1, pageSize: rows.length || 1, onPage: () => {},
      foot: totalsRow(s.totals),
      empty: '이 기간에 결제나 환불이 없습니다.',
    });
    syncView();
  }

  // 집계 보기 눌림 표시는 자료가 없을 때도 바로 바꿉니다(감사 #26).
  function syncView() {
    for (const b of form.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
  }
  const hasData = () => state.rows.some((r) => !state.program || r.program_id === state.program);

  function draw() {
    const s = summarizeSettlement(state.rows, state);
    state.summary = s;
    drawKpis(s.totals);
    if (!hasData()) {
      const byDay = state.view === 'day';
      bodyHost.innerHTML = `<div class="result"><div class="empty-state"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>
          <p>${byDay ? '이 기간에 결제나 환불이 없습니다.' : '프로그램별 자료가 없습니다.'}</p><p class="sub">${byDay ? '' : '이 기간에 결제나 환불이 없습니다. '}기간이나 프로그램을 바꿔 다시 조회해 주세요.</p></div></div>`;
      syncView();
      return;
    }
    bodyHost.innerHTML = `<div class="two-col">
        <section class="card" aria-labelledby="st-c1"><div class="card-head"><h2 id="st-c1">일별 순매출</h2><small>단위: 원</small></div>${chartHtml(s, state.from, state.to)}</section>
        <section class="card" aria-labelledby="st-c2"><div class="card-head"><h2 id="st-c2">프로그램별 순매출</h2><small>기간 합계</small></div>${shareHtml(s.programs)}</section>
      </div>
      <section class="result" aria-label="정산표">
        <div class="toolbar"><span class="total"></span><span class="muted note">순매출은 결제 금액에서 환불 금액을 뺀 값입니다. 취소 수수료는 결제 금액에 포함되어 있습니다.</span></div>
        <div class="st-table"></div>
      </section>`;
    drawTable();
  }

  function fillPrograms() {
    const keep = state.program;
    const programs = [...new Map(state.rows.map((r) => [r.program_id, r.program_title])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'ko'));
    progSel.replaceChildren(new Option('전체 프로그램', ''), ...programs.map(([id, t]) => new Option(t, id)));
    progSel.value = programs.some(([id]) => id === keep) ? keep : '';
    state.program = progSel.value;
  }

  async function load() {
    kpiHost.replaceChildren();
    const releaseBody = showSkeleton(bodyHost, 'chart');
    const rows = await loadInto(kpiHost, 'kpis', () => api.settlement(state.from, state.to));
    releaseBody();
    if (!rows) { bodyHost.replaceChildren(); return; }
    state.rows = rows;
    fillPrograms();
    draw();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const from = form.elements.from.value;
    const to = form.elements.to.value;
    if (!from || !to) { alertBox(alertHost, '조회할 기간의 시작일과 종료일을 모두 입력해 주세요.'); return; }
    const days = dayKeysBetween(from, to).length;
    if (!days) { alertBox(alertHost, '시작일이 종료일보다 늦습니다. 기간을 다시 선택해 주세요.'); return; }
    if (days > MAX_DAYS) { alertBox(alertHost, '기간은 1년(366일) 안으로 선택해 주세요.'); return; }
    alertHost.replaceChildren();
    const sameRange = from === state.from && to === state.to;
    state.from = from;
    state.to = to;
    state.program = progSel.value;
    if (sameRange && state.summary) draw();
    else load();
  });

  for (const b of form.querySelectorAll('[data-view]')) {
    b.addEventListener('click', () => {
      state.view = b.dataset.view;
      syncView();
      if (bodyHost.querySelector('.st-table')) drawTable();
      else if (state.summary) draw();
    });
  }

  const csvBtn = form.querySelector('[data-act="csv"]');
  csvBtn.addEventListener('click', () => withBusy(csvBtn, async () => {
    if (!state.summary) { alertBox(alertHost, '정산 자료를 불러온 뒤 내려받을 수 있습니다. 잠시 후 다시 눌러 주세요.'); return; }
    if (!hasData()) { alertBox(alertHost, NO_ROWS_MESSAGE, 'info'); return; }
    const s = state.summary;
    const byDay = state.view === 'day';
    const amount = AMOUNT_COLUMNS.map((c) => ({ key: c.key, label: c.label }));
    const columns = [byDay ? { key: 'day', label: '일자', value: (r) => (r.day === '합계' ? '합계' : dayKeyLabel(r.day)) } : { key: 'title', label: '프로그램' }, ...amount];
    const totals = { day: '합계', title: '합계', ...s.totals };
    const name = `정산현황_${byDay ? '일별' : '프로그램별'}_${state.from.replace(/-/g, '')}-${state.to.replace(/-/g, '')}.csv`;
    downloadCsv(name, toCsv(columns, [...(byDay ? s.days : s.programs), totals]));
  }));

  await load();
}
