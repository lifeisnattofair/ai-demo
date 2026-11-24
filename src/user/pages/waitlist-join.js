// 매진 회차의 대기 신청(SFR-015). 예매 선택 화면이 매진일 때 이 화면으로 바뀝니다.
// 수량은 남은 1인 한도 안에서 고르고(정규 강좌는 본인 1명), 신청하면 내 대기 신청 목록으로 보냅니다.
import { dDay } from '@policy/time.js';
import { describeError } from '../../lib/api.js';
import { escapeHtml, kstDateTime } from '../../lib/format.js';
import { posterImage } from '../components/poster-images.js';
import { withBusy } from '../../components/button-busy.js';

const WORDS = {
  PERFORMANCE: { day: '관람일시', unit: '매', qty: '매수', base: '공연일', limit: '회차당 1인 4매' },
  EXPERIENCE: { day: '체험일시', unit: '명', qty: '인원', base: '체험일', limit: '회차당 1인 4명' },
  COURSE: { day: '개강일시', unit: '명', qty: '인원', base: '개강일', limit: '정규 강좌는 1인 1명' },
};
const JOIN_LABEL = '대기 신청하기';

function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function rules(type) {
  const w = WORDS[type];
  const list = [
    '취소된 자리가 생기면 신청 순서대로 모아 드리고, 신청하신 수량이 모두 모이면 알림을 보내 드립니다.',
    '알림을 받은 때부터 24시간 안에 결제해 주세요. 기한이 지나면 다음 순번으로 넘어갑니다.',
  ];
  if (type === 'PERFORMANCE') list.push('공연은 취소된 좌석이 그대로 배정되며 좌석은 따로 고를 수 없습니다.');
  list.push(`${w.base} 2일 전부터는 모인 자리가 일반 예매로 전환되고 대기 신청도 마감됩니다.`);
  list.push(`${w.limit}까지라는 예약 한도는 대기 신청에도 같이 적용됩니다.`);
  return list;
}

/**
 * @param {HTMLElement} el
 * @param {{api:object, go:(h:string)=>void, offering:object, existing:number, limitLeft:number, now:()=>Date}} ctx
 */
export async function renderWaitlistJoin(el, { api, go, offering, limitLeft, now }) {
  const program = offering.program;
  const type = program.type;
  const w = WORDS[type];
  const detailHref = `#/programs/${encodeURIComponent(program.id)}`;
  const dateText = kstDateTime(offering.starts_at);
  const img = posterImage(program.poster_image).src;

  // 이미 진행 중인 대기가 있으면 다시 신청하지 않고 순번을 보여 줍니다.
  let mine = null;
  try {
    const list = await api.myWaitlist();
    mine = (list ?? []).find((x) => x.offering?.id === offering.id && (x.status === 'WAITING' || x.status === 'PROMOTED')) ?? null;
  } catch (e) {
    console.error(e); // 목록을 못 읽어도 신청은 서버가 중복을 막습니다.
  }
  const closed = dDay(offering.starts_at, now()) <= 2;
  const isCourse = type === 'COURSE';
  const maxQty = Math.max(0, limitLeft);
  let qty = maxQty > 0 ? 1 : 0;

  el.innerHTML = `<div data-booking data-waitlist-join>
    <div class="book-head">
      <div class="container">
        <div class="bh-title">${img ? `<img src="${escapeHtml(img)}" alt="">` : ''}<div><h1>${escapeHtml(program.title)}</h1><span class="num">${escapeHtml(dateText)}, ${escapeHtml(program.venue ?? '')}</span></div></div>
      </div>
    </div>
    <div class="container booking">
      <section class="panel" aria-labelledby="wj-title">
        <div class="panel-head">
          <h2 id="wj-title">대기 신청</h2>
          <span class="status wait">매진</span>
        </div>
        <div class="panel-body" data-body></div>
      </section>
      <aside class="summary" aria-label="대기 신청 내역">
        <div class="panel"><div class="panel-body" data-summary></div></div>
      </aside>
    </div>
    <div class="mobile-bar" data-bar></div>
  </div>`;
  const body = el.querySelector('[data-body]');
  const summary = el.querySelector('[data-summary]');
  const bar = el.querySelector('[data-bar]');

  const live = node('div', 'booking-live');
  function say(text) {
    if (!text) { live.replaceChildren(); return; }
    const p = node('p', 'form-error', text);
    p.setAttribute('role', 'alert');
    live.replaceChildren(p);
  }

  const canJoin = !mine && !closed && maxQty > 0;

  function drawSummary() {
    const rows = `<ul class="sum-list">
        <li><span>${w.day}</span><span>${escapeHtml(dateText)}</span></li>
        ${mine ? `<li><span>대기 순번</span><span>${mine.position}번째</span></li><li><span>신청 수량</span><span>${mine.qty}${w.unit}</span></li>`
          : `<li><span>신청 수량</span><span data-sum-qty>${qty}${w.unit}</span></li>`}
        <li><span>결제</span><span>배정된 뒤 24시간 안에</span></li>
      </ul>`;
    if (closed && !mine) {
      summary.innerHTML = `<h2 class="sum-title">대기 신청 마감</h2>
        <ul class="sum-list"><li><span>${w.day}</span><span>${escapeHtml(dateText)}</span></li></ul>
        <div class="sum-actions"><a class="btn btn-secondary btn-block" href="${detailHref}">다른 일정 보기</a></div>`;
      bar.innerHTML = `<div class="mb-info">대기 신청 마감</div><a class="btn btn-secondary" href="${detailHref}">다른 일정 보기</a>`;
      return;
    }
    const action = mine
      ? '<a class="btn btn-primary btn-block" href="#/me/waitlist">내 대기 신청 보기</a>'
      : `<button class="btn btn-primary btn-block" type="button" data-join${canJoin ? '' : ' aria-disabled="true"'}>${JOIN_LABEL}</button>`;
    summary.innerHTML = `<h2 class="sum-title">신청 내역</h2>${rows}<div class="sum-actions">${action}
      <a class="btn btn-secondary btn-block" href="${detailHref}">프로그램 상세</a></div>
      <p class="sum-fine">대기 신청은 결제 없이 접수되며, 내 대기 신청에서 언제든 취소할 수 있습니다.</p>`;
    bar.innerHTML = mine
      ? `<div class="mb-info">대기 순번<b>${mine.position}번째</b></div><a class="btn btn-primary" href="#/me/waitlist">내 대기 신청 보기</a>`
      : `<div class="mb-info">대기 신청<b>${qty}${w.unit}</b></div><button class="btn btn-primary" type="button" data-join${canJoin ? '' : ' aria-disabled="true"'}>${JOIN_LABEL}</button>`;
  }

  body.append(live);
  if (mine) {
    body.append(node('p', 'note info', `이미 대기 신청한 회차입니다. 현재 대기 순번은 ${mine.position}번째이며, 순번과 결제 기한은 내 대기 신청에서 확인할 수 있습니다.`));
  } else if (closed) {
    body.append(node('p', 'note', `대기 신청이 마감된 회차입니다. ${w.base} 2일 전부터는 대기 신청을 받지 않습니다. 다른 일정을 확인해 주세요.`));
  } else {
    body.append(node('p', 'wait-lead', '모든 자리가 판매되었습니다. 대기 신청을 하시면 취소된 자리가 생길 때 순번대로 결제 기회를 드립니다.'));
    if (isCourse) {
      const fixed = node('div', 'qty-fixed');
      fixed.append(node('b', null, '본인 1명 신청'), node('span', null, '정규 강좌는 1인 1명만 대기 신청할 수 있어 인원은 바꿀 수 없습니다.'));
      body.append(fixed);
    } else {
      const row = node('div', 'qty-row');
      row.innerHTML = `<div><b id="wj-qty-label">${w.qty}</b><span class="qty-sub">남은 한도 ${maxQty}${w.unit}</span></div>
        <div class="stepper" role="group" aria-labelledby="wj-qty-label">
          <button type="button" data-step="-1" aria-label="${w.qty} 줄이기">-</button>
          <output class="num" aria-live="polite" data-qty>${qty}${w.unit}</output>
          <button type="button" data-step="1" aria-label="${w.qty} 늘리기">+</button>
        </div>`;
      body.append(row);
    }
    if (maxQty <= 0) say(api.messageFor('LIMIT_EXCEEDED'));
  }
  if (!closed) {
    const list = node('ul', 'wait-rules');
    for (const t of rules(type)) list.append(node('li', null, t));
    const h = node('h3', 'wait-rules-title', '대기 신청 안내');
    body.append(h, list);
  }
  drawSummary();

  const out = body.querySelector('[data-qty]');
  const minus = body.querySelector('[data-step="-1"]');
  const plus = body.querySelector('[data-step="1"]');
  function sync() {
    if (!out) return;
    out.textContent = `${qty}${w.unit}`;
    minus.setAttribute('aria-disabled', String(qty <= 1));
    plus.setAttribute('aria-disabled', String(qty >= maxQty));
    const sumQty = summary.querySelector('[data-sum-qty]');
    if (sumQty) sumQty.textContent = `${qty}${w.unit}`;
    const barB = bar.querySelector('.mb-info b');
    if (barB) barB.textContent = `${qty}${w.unit}`;
  }
  sync();
  body.querySelector('.stepper')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-step]');
    if (!b) return;
    const next = qty + Number(b.dataset.step);
    if (next < 1) return;
    if (next > maxQty) { say(api.messageFor('LIMIT_EXCEEDED')); return; }
    say('');
    qty = next;
    sync();
  });

  let busy = false;
  async function join(button) {
    if (busy || !canJoin) return;
    busy = true;
    say('');
    const others = [...el.querySelectorAll('[data-join]')].filter((x) => x !== button);
    others.forEach((x) => x.setAttribute('aria-disabled', 'true'));
    try {
      await withBusy(button, async () => {
        try {
          const row = await api.joinWaitlist(offering.id, isCourse ? 1 : qty);
          go(`#/me/waitlist?joined=${encodeURIComponent(row.id)}`);
        } catch (e) {
          say(describeError(e));
        }
      });
    } finally {
      busy = false;
      others.forEach((x) => x.removeAttribute('aria-disabled'));
    }
  }
  el.querySelector('[data-waitlist-join]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-join]');
    if (b) join(b);
  });
}
