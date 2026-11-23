// 할인 선택. 티켓(좌석 또는 인원)마다 할인 유형을 고르고 합계를 바로 확인합니다.
import { now as clockNow } from '../../lib/clock.js';
import { escapeHtml, won } from '../../lib/format.js';
import { withBusy } from '../../components/button-busy.js';
import {
  bootCheckout, checkDiscounts, discountOptions, discountSummary, loadDiscounts, messagePage, priceTickets, saveDiscounts,
} from '../components/checkout-data.js';
import { mountShell, summaryListHtml } from '../components/checkout-shell.js';

const NOTE = '현장에서 증빙을 확인합니다. 증빙이 없으면 차액을 현장에서 결제합니다.';
const NO_DISCOUNT_NOTE = '이 프로그램은 할인을 적용하지 않습니다. 모든 매수가 일반 요금입니다.';
const NOTE_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>';

let renderSeq = 0;

/**
 * @param {HTMLElement} el
 * @param {{api:object, go:(h:string)=>void, holdId:string, now?:()=>Date}} deps
 */
export async function renderDiscount(el, { api, go, holdId, now = clockNow }) {
  const mine = ++renderSeq;
  const selfHash = `#/booking/${encodeURIComponent(holdId)}/discount`;
  const data = await bootCheckout(el, { api, go, holdId, now, selfHash, stale: () => mine !== renderSeq });
  if (!data || mine !== renderSeq) return;
  const { hold, offering, type, tickets, discountEnabled } = data;
  const selectHref = `#/booking/${encodeURIComponent(hold.offering_id)}/select`;
  const options = discountOptions(type, discountEnabled);
  const types = loadDiscounts(holdId, tickets.length, { discountEnabled });
  const note = discountEnabled ? NOTE : NO_DISCOUNT_NOTE;

  const shell = mountShell(el, {
    program: offering.program,
    offering,
    step: 3,
    expiresAt: new Date(hold.expires_at),
    now,
    onExpire: () => {
      shell.stops.forEach((s) => s());
      messagePage(el, '선점 시간이 지났습니다.', api.messageFor('HOLD_EXPIRED'), selectHref, '좌석 다시 선택');
    },
  });

  shell.main.innerHTML = `<section class="panel" aria-labelledby="dc-title">
      <div class="panel-head"><h2 id="dc-title">할인</h2><a class="btn btn-text" href="${selectHref}">${type === 'PERFORMANCE' ? '좌석 다시 선택' : '인원 다시 선택'}</a></div>
      <div class="panel-body">
        <div class="ticket-rows">${tickets.map((t, i) => `
          <div class="ticket-row" data-row="${i}">
            <div class="seatname">${escapeHtml(t.name)}<small>${escapeHtml(t.sub)}</small></div>
            <label class="sr-only" for="disc-${i}">${escapeHtml(t.name)} 할인</label>
            <select class="select" id="disc-${i}">${options.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('')}</select>
            <div class="amt num" data-amt></div>
          </div>`).join('')}
        </div>
        <div class="booking-live" data-live></div>
        <div class="note info">${NOTE_ICON}<p>${note}</p></div>
      </div>
    </section>`;
  const selects = [...shell.main.querySelectorAll('select')];
  selects.forEach((s, i) => { s.value = types[i]; });
  const live = shell.main.querySelector('[data-live]');

  function draw() {
    const { lines, total, original } = priceTickets(tickets, types);
    const check = checkDiscounts(types, type);
    shell.main.querySelectorAll('[data-amt]').forEach((amt, i) => {
      const l = lines[i];
      amt.innerHTML = l.discountAmount > 0 ? `<s>${won(l.unitPrice)}</s>${won(l.amount)}` : won(l.amount);
    });
    live.replaceChildren(...check.errors.map((m) => {
      const p = document.createElement('p');
      p.className = 'form-error';
      p.setAttribute('role', 'alert');
      p.textContent = m;
      return p;
    }));
    const disabled = check.ok ? 'false' : 'true';
    shell.summary.innerHTML = `
      <h2 class="sum-title">결제 금액</h2>
      ${summaryListHtml({ type, tickets, original, discounts: discountSummary(lines) })}
      <div class="sum-total"><span>합계</span><b>${won(total)}</b></div>
      <button class="btn btn-primary btn-block" type="button" data-next aria-disabled="${disabled}">다음: 결제</button>`;
    shell.bar.innerHTML = `<div class="mb-info">합계<b>${won(total)}</b></div>
      <button class="btn btn-primary" type="button" data-next aria-disabled="${disabled}">다음: 결제</button>`;
  }

  shell.main.addEventListener('change', (e) => {
    const s = e.target.closest('select');
    if (!s) return;
    types[selects.indexOf(s)] = s.value;
    draw();
  });

  shell.page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-next]');
    if (!btn) return;
    if (btn.getAttribute('aria-disabled') === 'true') return;
    if (!checkDiscounts(types, type).ok) return;
    await withBusy(btn, async () => {
      saveDiscounts(holdId, types);
      shell.stops.forEach((s) => s());
      go(`#/booking/${encodeURIComponent(holdId)}/pay`);
    });
  });

  draw();
}
