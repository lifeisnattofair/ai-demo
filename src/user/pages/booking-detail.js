// 예약 상세: 예약 내용, 결제 정보, 환불 미리보기와 예약 취소
import { api as defaultApi, describeError } from '../../lib/api.js';
import { now as clockNow, syncClock } from '../../lib/clock.js';
import { showSkeleton } from '../../components/skeleton.js';
import { renderBookingCard } from '../components/booking-card.js';
import { mountMyPage, node, emptyState, loadError } from './my-shell.js';

/**
 * @param {HTMLElement} el
 * @param {{api?:object, go?:(h:string)=>void, id:string, now?:()=>Date, sync?:()=>Promise<void>}} deps
 */
export async function renderBookingDetail(el, deps) {
  const api = deps.api ?? defaultApi;
  const go = deps.go ?? ((h) => { window.location.hash = h; });
  const now = deps.now ?? clockNow;
  // 시각을 주입한 경우(테스트)에는 서버 시각 맞추기를 주입할 때만 씁니다.
  const sync = deps.sync ?? (deps.now ? undefined : syncClock);
  const { id } = deps;

  const shell = await mountMyPage(el, { api, go, active: 'bookings', next: `#/me/bookings/${id}` });
  if (!shell) return;
  const { content, notice, refreshCounts } = shell;

  const back = node('a', 'back-link', '예약 내역으로');
  back.href = '#/me/bookings';
  const h1 = node('h1', 'page-title', '예약 상세');
  const body = node('div', 'my-body');
  content.append(back, h1, body);

  async function load() {
    const release = showSkeleton(body, 'detail');
    let booking;
    try {
      booking = await api.myBooking(id);
    } catch (e) {
      release();
      console.error(e);
      loadError(body, e, load, describeError);
      return;
    }
    release();
    if (!booking) {
      body.replaceChildren(emptyState({
        title: '예약을 찾을 수 없습니다.',
        body: '주소가 올바르지 않거나 본인의 예약이 아닙니다. 내 예약에서 다시 확인해 주세요.',
        href: '#/me/bookings',
        label: '내 예약 보기',
      }));
      return;
    }
    body.replaceChildren(renderBookingCard(booking, {
      api, now, sync, notice, expanded: true,
      reload: async () => { await load(); refreshCounts(); },
    }));
  }
  await load();
}
