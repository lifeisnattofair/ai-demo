// 알림함: 모의 문자 알림 목록과 읽음 처리
import { api as defaultApi, describeError } from '../../lib/api.js';
import { kstDateTime } from '../../lib/format.js';
import { withBusy } from '../../components/button-busy.js';
import { showSkeleton } from '../../components/skeleton.js';
import { mountMyPage, node, emptyState, loadError } from './my-shell.js';

const CHANNEL = { SMS_MOCK: '문자(모의)' };

/**
 * @param {HTMLElement} el
 * @param {{api?:object, go?:(h:string)=>void}} deps
 */
export async function renderNotifications(el, deps = {}) {
  const api = deps.api ?? defaultApi;
  const go = deps.go ?? ((h) => { window.location.hash = h; });

  const shell = await mountMyPage(el, { api, go, active: 'notifications', next: '#/me/notifications' });
  if (!shell) return;
  const { content, notice, refreshCounts } = shell;

  const head = node('div', 'my-head');
  const h1 = node('h1', 'page-title', '알림');
  const readAll = node('button', 'btn btn-secondary btn-sm', '모두 읽음 처리');
  readAll.type = 'button';
  head.append(h1, readAll);
  const body = node('div', 'my-body');
  content.append(head, body);

  let list = [];

  function paint() {
    const unread = list.filter((n) => !n.read_at).length;
    readAll.hidden = unread === 0;
    if (!list.length) {
      body.replaceChildren(emptyState({
        title: '받은 알림이 없습니다.',
        body: '예약 완료, 취소, 대기 승격 소식이 이곳에 모입니다.',
        href: '#/programs',
        label: '프로그램 둘러보기',
      }));
      return;
    }
    const ul = node('ul', 'noti-list');
    for (const n of list) {
      const li = node('li', `noti${n.read_at ? '' : ' unread'}`);
      const top = node('div', 'noti-top');
      if (!n.read_at) top.append(node('span', 'noti-flag', '안 읽음'));
      top.append(node('span', 'noti-channel', CHANNEL[n.channel] ?? '알림'), node('time', 'noti-time num', kstDateTime(n.created_at)));
      top.lastChild.setAttribute('datetime', n.created_at);
      const text = node('div', 'noti-text');
      text.append(node('b', null, n.title));
      if (n.body) text.append(node('p', null, n.body));
      li.append(top, text);
      if (!n.read_at) {
        const b = node('button', 'btn btn-text btn-sm', '읽음 처리');
        b.type = 'button';
        b.setAttribute('aria-label', `${n.title} 읽음 처리`);
        b.addEventListener('click', () => markRead(b, n));
        li.append(b);
      }
      ul.append(li);
    }
    body.replaceChildren(ul);
  }

  async function markRead(button, n) {
    await withBusy(button, async () => {
      try {
        await api.markNotificationRead(n.id);
        n.read_at = new Date().toISOString();
        paint();
        refreshCounts();
      } catch (e) {
        notice('error', describeError(e));
      }
    });
  }

  readAll.addEventListener('click', () => withBusy(readAll, async () => {
    try {
      await api.markAllNotificationsRead();
      const stamp = new Date().toISOString();
      for (const n of list) n.read_at ??= stamp;
      paint();
      refreshCounts();
    } catch (e) {
      notice('error', describeError(e));
    }
  }));

  async function load() {
    const release = showSkeleton(body, 'list');
    try {
      list = await api.myNotifications();
    } catch (e) {
      release();
      console.error(e);
      loadError(body, e, load, describeError);
      return;
    }
    release();
    paint();
  }
  await load();
}
