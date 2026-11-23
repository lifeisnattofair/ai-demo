// 결제 단계. 결제 수단, 약관 동의, 결제 금액 요약, 결제하기.
// 프로토타입은 모의 결제만 씁니다. 결제대행사 결제창이 돌려주는 paymentKey 자리를 화면에서 만든 값으로 채웁니다.
import { createOrderId } from '../../../supabase/functions/_shared/payments/confirm.js';
import { describeError } from '../../lib/api.js';
import { now as clockNow } from '../../lib/clock.js';
import { escapeHtml, won } from '../../lib/format.js';
import { withBusy } from '../../components/button-busy.js';
import {
  bootCheckout, checkDiscounts, discountSummary, loadDiscounts, messagePage, priceTickets,
} from '../components/checkout-data.js';
import { cancelSchedule, mountShell, summaryListHtml } from '../components/checkout-shell.js';
import { bindTermViews, termRowHtml } from '../components/terms.js';

const METHODS = [
  ['CARD', '신용/체크카드', '국내 모든 카드'],
  ['TRANSFER', '계좌이체', '실시간 계좌이체'],
  ['EASY', '간편결제', '등록한 결제 수단'],
];
const CARD_COMPANIES = ['한빛카드', '누리카드', '하나로카드'];
const INSTALLMENTS = ['일시불', '2개월', '3개월'];
const TERMS = [
  ['booking', '[필수] 예매 및 취소 수수료 규정 확인'],
  ['pgPrivacy', '[필수] 개인정보 제3자 제공(결제대행) 동의'],
  ['pgService', '[필수] 결제 대행 서비스 이용약관 동의'],
];
const CARD_MISSING = '카드사를 선택해 주세요.';
// 선점이 이미 풀렸거나 회차가 닫힌 경우에는 「선점이 유지됩니다」 안내를 하지 않습니다.
const HOLD_LOST = ['HOLD_EXPIRED', 'NOT_ON_SALE', 'NOT_OWNER'];
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 결제창이 돌려주는 값 자리: mock_ + 영숫자 20자리 */
export function createMockPaymentKey() {
  let rand = '';
  while (rand.length < 20) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < 248 && rand.length < 20) rand += ALNUM[b % 62];
    }
  }
  return `mock_${rand}`;
}

let renderSeq = 0;

/**
 * @param {HTMLElement} el
 * @param {{api:object, go:(h:string)=>void, holdId:string, now?:()=>Date}} deps
 */
export async function renderPayment(el, { api, go, holdId, now = clockNow }) {
  const mine = ++renderSeq;
  const selfHash = `#/booking/${encodeURIComponent(holdId)}/pay`;
  const discountHref = `#/booking/${encodeURIComponent(holdId)}/discount`;
  const data = await bootCheckout(el, { api, go, holdId, now, selfHash, stale: () => mine !== renderSeq });
  if (!data || mine !== renderSeq) return;
  const { hold, offering, type, tickets } = data;
  const selectHref = `#/booking/${encodeURIComponent(hold.offering_id)}/select`;

  const types = loadDiscounts(holdId, tickets.length, { discountEnabled: data.discountEnabled });
  if (!checkDiscounts(types, type).ok) {
    go(discountHref);
    return;
  }
  const { lines, total, original } = priceTickets(tickets, types);

  const shell = mountShell(el, {
    program: offering.program,
    offering,
    step: 4,
    expiresAt: new Date(hold.expires_at),
    now,
    onExpire: () => {
      shell.stops.forEach((s) => s());
      messagePage(el, '선점 시간이 지났습니다.', api.messageFor('HOLD_EXPIRED'), selectHref, '좌석 다시 선택');
    },
  });

  shell.main.innerHTML = `
    <div class="booking-live" data-live></div>
    <section class="panel" aria-labelledby="pm-title">
      <div class="panel-head"><h2 id="pm-title">결제 수단</h2><a class="btn btn-text" href="${discountHref}">할인 다시 선택</a></div>
      <div class="panel-body">
        <div class="methods" role="radiogroup" aria-label="결제 수단">
          ${METHODS.map(([v, name, sub]) => `<label class="method"><input type="radio" name="pm" value="${v}"><b>${name}</b><small>${sub}</small></label>`).join('')}
        </div>
        <div class="card-fields" data-card hidden>
          <div class="field"><label for="card">카드사</label><select class="select" id="card"><option value="">카드사를 선택하세요</option>${CARD_COMPANIES.map((c) => `<option>${c}</option>`).join('')}</select><p class="field-error" id="card-error" hidden>${CARD_MISSING}</p></div>
          <div class="field"><label for="inst">할부</label><select class="select" id="inst">${INSTALLMENTS.map((c) => `<option>${c}</option>`).join('')}</select></div>
        </div>
      </div>
    </section>
    <section class="panel" aria-labelledby="ag-title">
      <div class="panel-head"><h2 id="ag-title">약관 동의</h2></div>
      <div class="panel-body agree">
        <label class="check all"><input type="checkbox">전체 동의</label>
        ${TERMS.map(([key, label]) => termRowHtml({ key, label, inputAttrs: 'data-term' })).join('')}
      </div>
    </section>`;

  const schedule = cancelSchedule(offering.starts_at, type);
  const payLabel = `${won(total)} 결제하기`;
  shell.summary.innerHTML = `
    <h2 class="sum-title">결제 금액</h2>
    ${summaryListHtml({ type, tickets, original, discounts: discountSummary(lines) })}
    <div class="sum-total"><span>최종 결제 금액</span><b>${won(total)}</b></div>
    <button class="btn btn-primary btn-block" type="button" data-pay aria-disabled="true">${payLabel}</button>
    <ul class="sum-list sum-cancel" aria-label="취소 수수료 일정">
      ${schedule.map(([a, b]) => `<li><span>${escapeHtml(a)}</span><span>${escapeHtml(b)}</span></li>`).join('')}
    </ul>
    ${type === 'COURSE' ? '<p class="sum-fine">개강 후에는 수강 진행 비율에 따라 환불액이 달라집니다.</p>' : ''}`;
  shell.bar.innerHTML = `<div class="mb-info">최종 결제 금액<b>${won(total)}</b></div>
    <button class="btn btn-primary" type="button" data-pay aria-disabled="true">결제하기</button>`;

  const live = shell.main.querySelector('[data-live]');
  const cardBox = shell.main.querySelector('[data-card]');
  const termBoxes = [...shell.main.querySelectorAll('[data-term]')];
  const allBox = shell.main.querySelector('.check.all input');
  const cardSel = shell.main.querySelector('#card');
  const cardErr = shell.main.querySelector('#card-error');
  let method = null;
  let paying = false;
  bindTermViews(shell.main);

  function showCardError(on) {
    cardErr.hidden = !on;
    if (on) {
      cardSel.setAttribute('aria-invalid', 'true');
      cardSel.setAttribute('aria-describedby', 'card-error');
    } else {
      cardSel.removeAttribute('aria-invalid');
      cardSel.removeAttribute('aria-describedby');
    }
  }

  // 입력 누락 안내: 경고 한 줄만 보입니다(선점 안내나 돌아가기 링크는 붙이지 않습니다).
  function sayMissing(text) {
    if (live.dataset.key === `missing|${text}`) return;
    live.dataset.key = `missing|${text}`;
    const err = document.createElement('p');
    err.className = 'form-error';
    err.setAttribute('role', 'alert');
    err.textContent = text;
    live.replaceChildren(err);
  }

  function say(code, text) {
    if (!text) { live.replaceChildren(); delete live.dataset.key; return; }
    // 이미 같은 안내가 떠 있으면 다시 만들지 않습니다(같은 경고를 되풀이해 읽지 않게).
    if (live.dataset.key === `${code}|${text}`) return;
    live.dataset.key = `${code}|${text}`;
    const err = document.createElement('p');
    err.className = 'form-error';
    err.setAttribute('role', 'alert');
    err.textContent = text;
    const help = document.createElement('p');
    help.className = 'note info';
    const link = document.createElement('a');
    if (HOLD_LOST.includes(code)) {
      help.textContent = '선점이 풀렸을 수 있습니다. ';
      link.href = selectHref;
      link.textContent = type === 'PERFORMANCE' ? '좌석 다시 선택' : '다시 선택';
    } else {
      help.textContent = '선점은 남은 시간 동안 유지됩니다. 할인 선택으로 돌아가 다시 시도해 주세요. ';
      link.href = discountHref;
      link.textContent = '할인 선택으로 돌아가기';
    }
    help.append(link);
    live.replaceChildren(err, help);
  }

  const cardMissing = () => method === 'CARD' && !cardSel.value;
  function ready() {
    return method != null && !cardMissing() && termBoxes.every((b) => b.checked);
  }
  // 누락이 풀렸으면 떠 있던 누락 안내를 지웁니다.
  function clearResolved() {
    if (!cardMissing()) showCardError(false);
    const key = live.dataset.key ?? '';
    if (!key.startsWith('missing|')) return;
    const text = key.slice('missing|'.length);
    if ((text === '결제 수단을 선택해 주세요.' && method != null)
      || (text === CARD_MISSING && !cardMissing())
      || (text === '필수 약관에 모두 동의해 주세요.' && termBoxes.every((b) => b.checked))) say('', '');
  }
  function sync() {
    const on = ready() && !paying;
    for (const b of shell.page.querySelectorAll('[data-pay]')) {
      if (b.dataset.busy === 'true') continue;
      b.setAttribute('aria-disabled', on ? 'false' : 'true');
    }
    allBox.checked = termBoxes.every((b) => b.checked);
  }

  shell.main.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'pm') {
      method = t.value;
      cardBox.hidden = method !== 'CARD';
    } else if (t === allBox) {
      termBoxes.forEach((b) => { b.checked = allBox.checked; });
    }
    clearResolved();
    sync();
  });

  shell.page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pay]');
    if (!btn || paying) return;
    if (!ready()) {
      if (method == null) sayMissing('결제 수단을 선택해 주세요.');
      else if (cardMissing()) {
        sayMissing(CARD_MISSING);
        showCardError(true);
        cardSel.focus();
      } else sayMissing('필수 약관에 모두 동의해 주세요.');
      return;
    }
    paying = true;
    say('', '');
    shell.page.querySelectorAll('[data-pay]').forEach((b) => { if (b !== btn) b.setAttribute('aria-disabled', 'true'); });
    try {
      await withBusy(btn, async () => {
        try {
          const orderId = createOrderId(now());
          const items = tickets.map((t, i) => (t.seatId != null ? { seatId: t.seatId, discountType: types[i] } : { discountType: types[i] }));
          await api.preparePayment(holdId, items, total, orderId);
          // 승인 결과가 취소로 돌아오면 같은 회차의 선택 화면으로 보내기 위해 남겨 둡니다.
          try { sessionStorage.setItem(`hb:order:${orderId}`, hold.offering_id); } catch { /* 저장소를 쓸 수 없어도 진행합니다. */ }
          const paymentKey = createMockPaymentKey();
          shell.stops.forEach((s) => s());
          go(`#/payment/success?${new URLSearchParams({ paymentKey, orderId, amount: String(total) })}`);
        } catch (err) {
          console.error(err);
          say(err?.code, describeError(err));
        }
      });
    } finally {
      paying = false;
      sync();
    }
  });

  sync();
}
