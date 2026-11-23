// 회차 취소 승인(SFR-023): 운영 담당이 사유와 함께 요청 -> 정산 담당이 승인/반려.
// 승인하면 payments-cancel(mode INSTITUTION)로 회차를 취소하고 확정 예약 전부를 전액 환불하며, 대상자에게 알림이 갑니다.
// 반려하면 회차가 다시 판매 중(OPEN)이 됩니다. 결제 중인 주문이 남으면 「환불 다시 실행」으로 이어서 처리합니다.
import { escapeHtml, kstDateTime, kstShortDateTime, won } from '../../lib/format.js';
import { withBusy } from '../../components/button-busy.js';
import { confirmDialog } from '../../components/dialog.js';
import { now as clockNow } from '../../lib/clock.js';
import { describeError } from '../../lib/api.js';
import { renderDataTable, pageOf } from '../components/data-table.js';
import { TYPE_LABEL, loadInto, pageHead, typeChip } from '../components/page.js';
import { alertBox, formRow, showErrors } from '../components/form.js';

export const OFFERING_CLOSED_MESSAGE = '이미 취소 요청 중이거나 취소된 회차입니다. 목록을 새로 불러와 주세요.';

/** 승인 뒤 아직 환불할 예약이나 결제 중 주문이 남았는지(일괄 환불을 다시 실행해야 하는지). */
export function needsRefundRun(r) {
  return r.status === 'APPROVED' && (r.offering_status !== 'CANCELLED' || r.confirmed_count > 0 || r.pending_payments > 0);
}

export function requestStatus(r) {
  if (r.status === 'REQUESTED') return { text: '승인 대기', tone: 'promo' };
  if (r.status === 'REJECTED') return { text: '반려', tone: 'cancel' };
  if (needsRefundRun(r)) return { text: '환불 진행 중', tone: 'hold' };
  return { text: '환불 완료', tone: 'refund' };
}

const offeringLabel = (o) => `[${TYPE_LABEL[o.program?.type] ?? ''}] ${o.program?.title ?? ''} | ${kstDateTime(o.starts_at)}`;

/**
 * @param {HTMLElement} el
 * @param {{api:object, role:'operator'|'finance', now?:()=>Date, onCounts?:(c:Object)=>void}} ctx
 */
export async function renderCancelRequests(el, { api, role, now = clockNow, onCounts }) {
  const isFinance = role === 'finance';
  const state = { rows: [], page: 1, pageSize: 20 };
  el.innerHTML = `${pageHead({ crumbs: ['결제/정산', '회차 취소 승인'], title: '회차 취소 승인',
    help: isFinance
      ? '승인하면 회차를 취소하고 확정 예약 전부를 결제 금액 그대로 환불합니다. 대상자에게는 알림이 갑니다.'
      : '기관 사정으로 회차를 열 수 없을 때 취소를 요청합니다. 정산 담당이 승인하면 전액 환불됩니다.' })}
    <div class="alert-host"></div>
    ${isFinance ? '' : '<div class="req-host"></div>'}
    <section class="result" aria-labelledby="cr-h">
      <div class="result-head"><h2 id="cr-h">취소 요청 목록</h2><span class="total" aria-live="polite">총 <b class="num">0</b>건</span></div>
      <div class="tb-host"></div>
    </section>`;
  const tb = el.querySelector('.tb-host');
  const alertHost = el.querySelector('.alert-host');

  // ----- 정산 담당: 승인/반려/환불 다시 실행 -----
  async function runRefund(r) {
    try {
      const res = await api.runInstitutionCancel(r.offering_id);
      const parts = [`${r.program_title} (${kstShortDateTime(r.starts_at)}) 회차를 취소하고 예약 ${res.cancelled.length}건을 전액 환불했습니다. 대상자에게 알림을 보냈습니다.`];
      if (res.failed?.length) parts.push(`환불하지 못한 예약 ${res.failed.length}건이 있습니다. ${res.failed[0].message} 「환불 다시 실행」을 눌러 주세요.`);
      if (res.pendingMessage) parts.push(res.pendingMessage);
      alertBox(alertHost, parts.join(' '), res.failed?.length ? 'err' : 'ok');
    } catch (err) {
      alertBox(alertHost, `일괄 환불을 마치지 못했습니다. ${describeError(err)} 목록의 「환불 다시 실행」을 눌러 다시 시도해 주세요.`);
    }
  }

  async function approve(btn, r) {
    await withBusy(btn, async () => {
      const ok = await confirmDialog({
        title: '회차 취소를 승인할까요?',
        message: `${r.program_title} (${kstDateTime(r.starts_at)}) 회차의 확정 예약 ${r.confirmed_count}건, ${won(r.confirmed_amount)}을 전액 환불합니다.`,
        rows: [['요청 사유', r.reason], ['요청자', r.requested_by_name]],
        detail: '승인하면 되돌릴 수 없습니다. 회차는 취소되고 예약자에게 알림이 갑니다.',
        confirmLabel: '승인하고 환불', cancelLabel: '닫기', danger: true,
      });
      if (!ok) return;
      try {
        await api.decideOfferingCancel(r.id, true);
      } catch (err) {
        alertBox(alertHost, describeError(err));
        await load();
        return;
      }
      await runRefund(r);
      await load();
    });
  }

  async function reject(btn, r) {
    await withBusy(btn, async () => {
      const ok = await confirmDialog({
        title: '취소 요청을 반려할까요?',
        message: `${r.program_title} (${kstDateTime(r.starts_at)}) 회차 취소 요청을 반려하면 회차가 다시 판매 중이 됩니다.`,
        confirmLabel: '반려', cancelLabel: '닫기',
      });
      if (!ok) return;
      try {
        await api.decideOfferingCancel(r.id, false);
        alertBox(alertHost, '반려했습니다. 회차가 다시 판매 중이 되었습니다.', 'ok');
      } catch (err) {
        alertBox(alertHost, describeError(err));
      }
      await load();
    });
  }

  const actionCell = (r) => {
    const wrap = document.createElement('span');
    wrap.className = 'cell-acts';
    const btn = (label, cls, act, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn ${cls}`;
      b.dataset.act = act;
      b.textContent = label;
      b.setAttribute('aria-label', `${r.program_title} ${kstShortDateTime(r.starts_at)} ${label}`);
      b.addEventListener('click', () => fn(b, r));
      return b;
    };
    if (isFinance && r.status === 'REQUESTED') {
      wrap.append(btn('승인', 'btn-primary', 'approve', approve), btn('반려', '', 'reject', reject));
    } else if (isFinance && needsRefundRun(r)) {
      wrap.append(btn('환불 다시 실행', '', 'rerun', (b) => withBusy(b, async () => { await runRefund(r); await load(); })));
    } else if (r.decided_at) {
      wrap.textContent = `${r.decided_by_name ?? ''} ${kstShortDateTime(r.decided_at)}`.trim();
    } else {
      wrap.textContent = '정산 담당 승인 대기';
      wrap.classList.add('muted');
    }
    return wrap;
  };

  const columns = [
    { key: 'requested_at', label: '요청 일시', format: (r) => kstShortDateTime(r.requested_at) },
    { key: 'type', label: '유형', type: 'chip', chip: (r) => typeChip(r.program_type) },
    { key: 'program_title', label: '프로그램', align: 'l', format: (r) => {
      const s = document.createElement('span');
      s.className = 'ellipsis';
      s.title = r.program_title;
      s.textContent = r.program_title;
      return s;
    } },
    { key: 'starts_at', label: '회차', format: (r) => kstShortDateTime(r.starts_at) },
    { key: 'reason', label: '사유', align: 'l', format: (r) => {
      const s = document.createElement('span');
      s.className = 'ellipsis';
      s.title = r.reason ?? '';
      s.textContent = r.reason ?? '';
      return s;
    } },
    { key: 'requested_by_name', label: '요청자' },
    { key: 'confirmed_count', label: '남은 확정 예약', type: 'number' },
    { key: 'confirmed_amount', label: '환불 예정 금액', type: 'money' },
    { key: 'refunded_count', label: '기관 환불', type: 'number' },
    { key: 'status', label: '상태', type: 'chip', chip: requestStatus },
    { key: 'act', label: isFinance ? '처리' : '결정', format: actionCell },
  ];

  function draw() {
    el.querySelector('.total b').textContent = state.rows.length.toLocaleString('en-US');
    renderDataTable(tb, {
      caption: '회차 취소 요청 목록', columns, rows: pageOf(state.rows, state.page, state.pageSize), total: state.rows.length,
      page: state.page, pageSize: state.pageSize, onPage: (p) => { state.page = p; draw(); },
      empty: '회차 취소 요청이 없습니다.',
      emptySub: isFinance ? '운영 담당이 요청하면 여기에서 승인합니다.' : '위 양식에서 취소할 회차와 사유를 입력해 요청합니다.',
    });
  }

  async function load() {
    const rows = await loadInto(tb, 'grid-table', () => api.cancelRequests());
    if (!rows) return;
    state.rows = rows;
    onCounts?.({ '#/cancel-requests': rows.filter((r) => r.status === 'REQUESTED').length });
    draw();
  }

  // ----- 운영 담당: 취소 요청 양식 -----
  async function drawRequestForm() {
    const host = el.querySelector('.req-host');
    const offerings = await loadInto(host, 'form', () => api.offerings());
    if (!offerings) return;
    const nowMs = now().getTime();
    const open = offerings.filter((o) => o.status === 'OPEN' && Date.parse(o.starts_at) > nowMs)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    host.innerHTML = `<form class="form-card cancel-form" novalidate aria-labelledby="rq-h"><h2 id="rq-h">회차 취소 요청</h2><div class="form-grid">
        ${formRow({ label: '회차', required: true, name: 'offering', field: `<select class="ctl half" id="f-offering" name="offering"><option value="">취소할 회차 선택</option>${open.map((o) => `<option value="${o.id}">${escapeHtml(offeringLabel(o))}</option>`).join('')}</select>`,
          hint: open.length ? '판매 중인 회차만 고를 수 있습니다. 요청하는 동안 새 예매와 결제가 막힙니다.' : '취소를 요청할 수 있는 판매 중 회차가 없습니다.' })}
        ${formRow({ label: '취소 사유', required: true, name: 'reason', field: '<textarea class="ctl full" id="f-reason" name="reason" rows="3" maxlength="500"></textarea>',
          hint: '예약자 알림과 작업 이력에 남는 내용입니다. 500자까지 입력할 수 있습니다.' })}
      </div><div class="form-foot"><button class="btn btn-primary" type="submit">취소 요청</button></div></form>`;
    const form = host.querySelector('form');
    showErrors(form, {});
    const submit = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const offeringId = form.elements.offering.value;
      const reason = form.elements.reason.value.trim();
      const errs = {};
      if (!offeringId) errs.offering = '취소할 회차를 선택해 주세요.';
      if (!reason) errs.reason = '취소 사유를 입력해 주세요.';
      else if (reason.length > 500) errs.reason = '취소 사유는 500자 안으로 입력해 주세요.';
      if (showErrors(form, errs)) return;
      const target = open.find((o) => o.id === offeringId);
      withBusy(submit, async () => {
        const ok = await confirmDialog({
          title: '회차 취소를 요청할까요?',
          message: `${offeringLabel(target)} 회차의 취소를 요청합니다. 정산 담당이 결정할 때까지 이 회차의 새 예매가 막힙니다.`,
          rows: [['취소 사유', reason]], confirmLabel: '취소 요청', cancelLabel: '닫기',
        });
        if (!ok) return;
        try {
          await api.requestOfferingCancel(offeringId, reason);
          await drawRequestForm();
          await load();
          alertBox(alertHost, '취소를 요청했습니다. 정산 담당이 승인하면 예약 전체가 전액 환불됩니다.', 'ok');
        } catch (err) {
          if (err.code === 'INVALID_REASON') showErrors(form, { reason: err.message });
          else if (err.code === 'OFFERING_CLOSED') {
            // 다른 담당자가 먼저 요청했거나 이미 취소된 회차: 양식과 목록을 새로 불러옵니다.
            await drawRequestForm();
            await load();
            alertBox(alertHost, OFFERING_CLOSED_MESSAGE);
          } else alertBox(alertHost, describeError(err));
        }
      });
    });
  }

  if (!isFinance) await drawRequestForm();
  await load();
}
