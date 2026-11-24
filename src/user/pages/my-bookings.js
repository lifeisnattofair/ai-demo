// 내 예약 목록: 예정, 지난 예약, 취소 탭과 대기 승격 결제 안내
import { api as defaultApi, describeError } from '../../lib/api.js';
import { now as clockNow, syncClock } from '../../lib/clock.js';
import { showSkeleton } from '../../components/skeleton.js';
import { renderBookingCard, bookingGroup } from '../components/booking-card.js';
import { promotionCard } from './waitlist.js';
import { mountMyPage, node, emptyState, loadError } from './my-shell.js';

const TABS = [
  ['upcoming', '예정', '#/me/bookings'],
  ['past', '지난 예약', '#/me/bookings?tab=past'],
  ['cancelled', '취소', '#/me/bookings?tab=cancelled'],
];

const EMPTY = {
  upcoming: ['예정된 예약이 없습니다.', '마음에 드는 공연, 체험, 강좌를 찾아 예약해 보세요.', '#/programs', '예매할 공연, 강좌 찾기'],
  past: ['지난 예약이 없습니다.', '관람이나 수강이 끝난 예약이 이곳에 모입니다.', '#/programs', '예매할 공연, 강좌 찾기'],
  cancelled: ['취소한 예약이 없습니다.', '취소한 예약과 환불 내역이 이곳에 보입니다.', null, null],
};

/**
 * @param {HTMLElement} el
 * @param {{api?:object, go?:(h:string)=>void, query?:URLSearchParams, now?:()=>Date, sync?:()=>Promise<void>}} deps
 */
export async function renderMyBookings(el, deps = {}) {
  const api = deps.api ?? defaultApi;
  const go = deps.go ?? ((h) => { window.location.hash = h; });
  const now = deps.now ?? clockNow;
  const sync = deps.sync ?? (deps.now ? undefined : syncClock);
  const tab = TABS.some(([k]) => k === deps.query?.get('tab')) ? deps.query.get('tab') : 'upcoming';

  const shell = await mountMyPage(el, { api, go, active: 'bookings', next: '#/me/bookings' });
  if (!shell) return;
  const { content, notice, refreshCounts } = shell;

  const h1 = node('h1', 'page-title', '예약 내역');
  const promo = node('div', 'my-promo');
  const tabs = node('nav', 'sub-tabs');
  tabs.setAttribute('aria-label', '예약 상태');
  const body = node('div', 'my-body');
  content.append(h1, promo, tabs, body);

  async function load() {
    const release = showSkeleton(body, 'list');
    let list;
    let waits = [];
    try {
      [list, waits] = await Promise.all([api.myBookings(), api.myWaitlist().catch((e) => { console.error(e); return []; })]);
    } catch (e) {
      release();
      console.error(e);
      loadError(body, e, load, describeError);
      return;
    }
    release();

    promo.replaceChildren(...waits.filter((w) => w.status === 'PROMOTED').map((w) => promotionCard(w, { api, go, notice })));

    const groups = { upcoming: [], past: [], cancelled: [] };
    for (const b of list) groups[bookingGroup(b, now())].push(b);
    // 예정은 가까운 일정 순, 나머지는 최근 예약 순(서버 정렬)
    groups.upcoming.sort((a, b) => new Date(a.offering.starts_at) - new Date(b.offering.starts_at));

    tabs.replaceChildren(...TABS.map(([key, label, href]) => {
      const a = node('a', null);
      a.href = href;
      a.append(document.createTextNode(`${label} `), node('span', 'num', String(groups[key].length)));
      if (key === tab) a.setAttribute('aria-current', 'true');
      return a;
    }));

    const items = groups[tab];
    if (!items.length) {
      const [title, text, href, label] = EMPTY[tab];
      body.replaceChildren(emptyState({ title, body: text, href, label }));
      return;
    }
    body.replaceChildren(...items.map((b) => renderBookingCard(b, {
      api, now, sync, notice, collapsible: true,
      reload: async () => { await load(); refreshCounts(); },
    })));
  }
  await load();
}
