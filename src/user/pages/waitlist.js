// 대기 신청 목록: 순번, 신청/배정 수량, 승격된 건의 결제 기한과 결제하기, 대기 취소
import { api as defaultApi, describeError } from '../../lib/api.js';
import { kstDateTime, kstShortDateTime } from '../../lib/format.js';
import { confirmDialog } from '../../components/dialog.js';
import { isBusy, withBusy } from '../../components/button-busy.js';
import { showSkeleton } from '../../components/skeleton.js';
import { typeMark } from '../components/program-card.js';
import { mountMyPage, node, emptyState, loadError } from './my-shell.js';

const unit = (type) => (type === 'PERFORMANCE' ? '매' : '명');
const WHEN_LABEL = { PERFORMANCE: '관람일시', EXPERIENCE: '체험일시', COURSE: '개강일시' };

function row(label, value) {
  const d = node('div');
  d.append(node('span', null, label), document.createTextNode(value));
  return d;
}

export const deadlineText = (w) => `결제 기한: ${kstShortDateTime(w.deadline_at)}까지`;

// 승격된 대기의 결제하기: 선점을 만들고 할인 선택 단계로 보냅니다.
async function pay(button, w, { api, go, notice }) {
  await withBusy(button, async () => {
    try {
      const hold = await api.holdForPromotion(w.id);
      go(`#/booking/${encodeURIComponent(hold.id)}/discount`);
    } catch (e) {
      notice('error', describeError(e));
    }
  });
}

function payButton(w, ctx) {
  const b = node('button', 'btn btn-primary', '결제하기');
  b.type = 'button';
  b.addEventListener('click', () => pay(b, w, ctx));
  return b;
}

/** 내 예약 화면 맨 위에 보이는 승격 안내 카드 */
export function promotionCard(w, ctx) {
  const card = node('section', 'wait-card');
  card.setAttribute('aria-label', '대기 승격 안내');
  const text = node('div');
  const title = node('b', null, `대기하신 「${w.program.title}」 좌석이 배정되었습니다`);
  const p = node('p', 'num');
  p.append(
    document.createTextNode(`${kstShortDateTime(w.offering.starts_at)}, ${w.allocated_qty}${unit(w.program.type)} 배정. `),
  );
  // 결제 기한을 아직 받지 못했으면 기한 문구 없이 안내합니다.
  if (w.deadline_at) {
    p.append(node('strong', null, deadlineText(w)), document.createTextNode('이며, 기한이 지나면 다음 대기자에게 넘어갑니다.'));
  } else {
    p.append(document.createTextNode('결제 기한 안에 결제하지 않으면 다음 대기자에게 넘어갑니다.'));
  }
  text.append(title, p);
  card.append(text, payButton(w, ctx));
  return card;
}

function waitCard(w, ctx) {
  const promoted = w.status === 'PROMOTED';
  const art = node('article', 'wl');
  art.setAttribute('aria-labelledby', `wl-${w.id}`);
  const info = node('div', 'wl-info');
  const tags = node('div', 'bk-tags');
  tags.append(typeMark(w.program.type), node('span', `status ${promoted ? 'on' : 'wait'}`, promoted ? '결제 가능' : '대기 중'));
  const h = node('h3', null, w.program.title);
  h.id = `wl-${w.id}`;
  const meta = node('div', 'bk-meta num');
  const u = unit(w.program.type);
  meta.append(
    row(WHEN_LABEL[w.program.type] ?? '일시', kstDateTime(w.offering.starts_at)),
    row('순번', `${w.position}번째`),
    row('신청 수량', `${w.qty}${u}`),
    row('배정 수량', `${w.allocated_qty}${u}`),
  );
  info.append(tags, h, meta);
  if (promoted && w.deadline_at) info.append(node('p', 'wl-deadline num', deadlineText(w)));

  const actions = node('div', 'wl-actions');
  if (promoted) actions.append(payButton(w, ctx));
  const cancel = node('button', 'btn btn-secondary btn-sm', '대기 취소');
  cancel.type = 'button';
  cancel.addEventListener('click', async () => {
    if (isBusy(cancel)) return;
    const ok = await confirmDialog({
      title: '대기 신청을 취소하시겠습니까?',
      message: promoted ? '배정된 좌석도 함께 다음 대기자에게 넘어갑니다.' : '대기 순번이 사라지며, 다시 신청하면 맨 뒤에 서게 됩니다.',
      detail: w.program.title,
      confirmLabel: '대기 취소하기',
      cancelLabel: '닫기',
      danger: true,
    });
    if (!ok) return;
    await withBusy(cancel, async () => {
      try {
        await ctx.api.cancelWaitlist(w.id);
        await ctx.reload();
        ctx.notice('ok', '대기 신청을 취소했습니다.', { focus: true });
      } catch (e) {
        ctx.notice('error', describeError(e));
      }
    });
  });
  actions.append(cancel);
  art.append(info, actions);
  return art;
}

/**
 * @param {HTMLElement} el
 * @param {{api?:object, go?:(h:string)=>void, now?:()=>Date}} deps
 */
export async function renderWaitlist(el, deps = {}) {
  const api = deps.api ?? defaultApi;
  const go = deps.go ?? ((h) => { window.location.hash = h; });

  const shell = await mountMyPage(el, { api, go, active: 'waitlist', next: '#/me/waitlist' });
  if (!shell) return;
  const { content, notice, refreshCounts } = shell;

  const h1 = node('h1', 'page-title', '대기 신청');
  const intro = node('p', 'my-intro', '매진된 회차에 대기 신청을 하면, 자리가 나는 순서대로 24시간 안에 결제할 수 있는 기회를 드립니다.');
  const body = node('div', 'my-body');
  content.append(h1, intro, body);

  async function load() {
    const release = showSkeleton(body, 'list');
    let list;
    try {
      list = await api.myWaitlist();
    } catch (e) {
      release();
      console.error(e);
      loadError(body, e, load, describeError);
      return;
    }
    release();
    if (!list.length) {
      body.replaceChildren(emptyState({
        title: '대기 신청한 내역이 없습니다.',
        body: '매진된 회차에서 대기 신청을 하면 이곳에서 순번과 결제 기한을 확인할 수 있습니다.',
        href: '#/programs',
        label: '예매할 공연, 강좌 찾기',
      }));
      return;
    }
    // 결제 가능한 건을 위에 둡니다.
    const sorted = [...list].sort((a, b) => (b.status === 'PROMOTED') - (a.status === 'PROMOTED'));
    const ctx = { api, go, notice, reload: async () => { await load(); refreshCounts(); } };
    body.replaceChildren(...sorted.map((w) => waitCard(w, ctx)));
  }
  await load();
}
