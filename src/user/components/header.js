// 공통 헤더와 푸터. 마크업과 클래스는 설계 확정본(user-list.html)과 같습니다.
import { api as defaultApi } from '../../lib/api.js';

const GNB = [
  ['공연', '#/programs?type=PERFORMANCE'],
  ['체험', '#/programs?type=EXPERIENCE'],
  ['정규 강좌', '#/programs?type=COURSE'],
];

const USER_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
const MENU_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function headerHtml({ name = null, loggedIn = false } = {}) {
  const nav = GNB.map(([label, href]) => `<a href="${href}">${label}</a>`).join('');
  const util = loggedIn
    ? `<a href="#/me/bookings">내 예약</a><a class="me" href="#/account">${USER_ICON}${esc(name ?? '내 정보')}${name ? ' 님' : ''}</a><button class="link" type="button" data-logout>로그아웃</button>`
    : '<a href="#/login">로그인</a><a class="btn btn-primary btn-sm" href="#/signup">회원 가입</a>';
  const mobile = loggedIn
    ? '<a href="#/me/bookings">내 예약</a><a href="#/account">내 정보</a><button type="button" data-logout>로그아웃</button>'
    : '<a href="#/login">로그인</a><a href="#/signup">회원 가입</a>';
  return `<div class="container">
      <a class="logo" href="#/"><b>한빛아트센터</b><span>한빛시 문화재단</span></a>
      <nav class="gnb" aria-label="주 메뉴">${nav}</nav>
      <div class="util">${util}</div>
      <button class="menu-btn" type="button" aria-label="전체 메뉴 열기" aria-expanded="false" aria-controls="m-menu">${MENU_ICON}</button>
    </div>
    <nav class="m-menu" id="m-menu" aria-label="전체 메뉴">${nav}${mobile}</nav>`;
}

export function footerHtml() {
  return `<div class="container">
      <address>한빛시 문화재단 한빛아트센터 | 한빛시 문화로 120 | 예약 문의 031-000-1200 (평일 09:00 - 18:00)<br>Copyright Hanbit Arts Center. All rights reserved.</address>
    </div>`;
}

// host: <header class="site-header"> 요소. 로그인 상태가 바뀌면 다시 그립니다.
export async function mountHeader(host, deps = {}) {
  const api = deps.api ?? defaultApi;
  const go = deps.go ?? ((h) => { window.location.hash = h; });
  let seq = 0;

  async function draw() {
    const my = ++seq;
    let state = { loggedIn: false, name: null };
    try {
      const session = await api.getSession();
      if (session) {
        let name = null;
        try { name = (await api.getProfile())?.name ?? null; } catch { /* 이름 없이 표시합니다. */ }
        state = { loggedIn: true, name };
      }
    } catch (e) {
      console.error(e);
    }
    if (my !== seq) return;
    const wasOpen = host.classList.contains('open');
    host.innerHTML = headerHtml(state);
    host.classList.toggle('open', wasOpen);
    const btn = host.querySelector('.menu-btn');
    btn.setAttribute('aria-expanded', String(wasOpen));
  }

  host.addEventListener('click', async (e) => {
    const menu = e.target.closest('.menu-btn');
    if (menu) {
      const open = host.classList.toggle('open');
      menu.setAttribute('aria-expanded', String(open));
      menu.setAttribute('aria-label', open ? '전체 메뉴 닫기' : '전체 메뉴 열기');
      return;
    }
    if (e.target.closest('[data-logout]')) {
      try { await api.signOut(); } catch (err) { console.error(err); }
      host.classList.remove('open');
      go('#/');
      return;
    }
    if (e.target.closest('a')) host.classList.remove('open');
  });

  api.onAuthChange?.(() => { draw(); });
  await draw();
  return { refresh: draw };
}
