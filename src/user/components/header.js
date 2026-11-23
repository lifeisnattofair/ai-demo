// 공통 헤더(GNB 2depth 메뉴, 모바일 전체 메뉴)와 푸터.
// 키보드: 1depth 버튼은 Enter/Space 로 열고 닫으며, 아래 화살표로 열고 첫 링크로 갑니다. 위/아래 화살표는 링크 사이,
// 좌우 화살표는 1depth 사이를 움직이고, Esc 는 닫고 초점을 1depth 버튼으로 돌려 둡니다.
import { api as defaultApi } from '../../lib/api.js';
import { now as clockNow } from '../../lib/clock.js';
import { addMonths, escapeHtml, kstDayKey } from '../../lib/format.js';

const FAMILY_AUDIENCE = '초등학생 동반 가족';

/**
 * GNB 메뉴. 모든 2depth 는 실제 화면(목록 필터나 안내 화면)으로 갑니다.
 * @param {Date} now 이번 달, 다음 달 필터 계산용(한국 시간)
 * @returns {{id:string, label:string, items:{label:string, href:string}[]}[]}
 */
export function gnbMenus(now) {
  const today = kstDayKey(now);
  const thisMonth = today.slice(0, 7);
  const nextMonth = addMonths(`${thisMonth}-01`, 1).slice(0, 7);
  return [
    { id: 'perf', label: '공연', items: [
      { label: '전체 공연', href: '#/programs?type=PERFORMANCE' },
      { label: '이번 달 공연', href: `#/programs?type=PERFORMANCE&month=${thisMonth}` },
      { label: '다음 달 공연', href: `#/programs?type=PERFORMANCE&month=${nextMonth}` },
    ] },
    { id: 'exp', label: '체험', items: [
      { label: '전체 체험', href: '#/programs?type=EXPERIENCE' },
      { label: '가족 체험', href: `#/programs?type=EXPERIENCE&target=${encodeURIComponent(FAMILY_AUDIENCE)}` },
    ] },
    { id: 'course', label: '정규 강좌', items: [
      { label: '전체 강좌', href: '#/programs?type=COURSE' },
      { label: '수강 신청 안내', href: '#/guide/course' },
    ] },
    { id: 'guide', label: '이용 안내', items: [
      { label: '취소/환불 규정', href: '#/guide/refund' },
      { label: '관람 안내/오시는 길', href: '#/guide/visit' },
    ] },
  ];
}

const USER_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
const MENU_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
const CLOSE_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
// 펼침 상태를 알려 주는 표식(기능 표식이라 남깁니다)
const CARET = '<svg class="caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

const linkHtml = ({ label, href }) => `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`;

export function headerHtml({ name = null, loggedIn = false } = {}, menus = gnbMenus(clockNow())) {
  const nav = menus.map((m) => `<li class="gnb-item">
      <button class="gnb-top" type="button" aria-expanded="false" aria-controls="gnb-${m.id}">${escapeHtml(m.label)}${CARET}</button>
      <div class="gnb-panel" id="gnb-${m.id}" hidden><ul>${m.items.map(linkHtml).join('')}</ul></div>
    </li>`).join('');
  const accordion = menus.map((m) => `<li>
      <button class="m-acc" type="button" aria-expanded="false" aria-controls="m-${m.id}">${escapeHtml(m.label)}${CARET}</button>
      <ul class="m-sub" id="m-${m.id}" hidden>${m.items.map(linkHtml).join('')}</ul>
    </li>`).join('');
  const util = loggedIn
    ? `<a href="#/me/bookings">내 예약</a><a class="me" href="#/account">${USER_ICON}${escapeHtml(name ?? '내 정보')}${name ? ' 님' : ''}</a><button class="link" type="button" data-logout>로그아웃</button>`
    : '<a href="#/login">로그인</a><a class="btn btn-primary btn-sm" href="#/signup">회원 가입</a>';
  const mobile = loggedIn
    ? '<a href="#/me/bookings">내 예약</a><a href="#/account">내 정보</a><button type="button" data-logout>로그아웃</button>'
    : '<a href="#/login">로그인</a><a href="#/signup">회원 가입</a>';
  return `<div class="container">
      <a class="logo" href="#/"><b>한빛아트센터</b><span>한빛시 문화재단</span></a>
      <nav class="gnb" aria-label="주 메뉴"><ul class="gnb-list">${nav}</ul></nav>
      <div class="util">${util}</div>
      <button class="menu-btn" type="button" aria-label="전체 메뉴 열기" aria-expanded="false" aria-controls="m-menu">${MENU_ICON}</button>
    </div>
    <nav class="m-menu" id="m-menu" aria-label="전체 메뉴"><ul class="m-list">${accordion}</ul><div class="m-util">${mobile}</div></nav>`;
}

export function footerHtml() {
  return `<div class="container">
      <ul class="f-links">
        <li><a href="#/guide/refund">취소/환불 규정</a></li>
        <li><a href="#/guide/visit">관람 안내/오시는 길</a></li>
        <li><a href="#/guide/course">수강 신청 안내</a></li>
      </ul>
      <address>한빛시 문화재단 한빛아트센터 | 한빛시 문화로 120 | 예약 문의 031-000-1200 (평일 09:00 - 18:00)<br>Copyright Hanbit Arts Center. All rights reserved.</address>
    </div>`;
}

// 데스크톱 GNB 동작. 마우스를 올리면 열리고(짧은 지연 후 닫힘), 키보드로도 모두 쓸 수 있습니다.
function bindGnb(host) {
  const tops = () => [...host.querySelectorAll('.gnb-top')];
  const panelOf = (btn) => host.querySelector(`#${btn.getAttribute('aria-controls')}`);
  const linksOf = (btn) => [...panelOf(btn).querySelectorAll('a')];
  let leaveTimer = 0;

  function close(btn) {
    if (!btn || btn.getAttribute('aria-expanded') !== 'true') return;
    btn.setAttribute('aria-expanded', 'false');
    btn.closest('.gnb-item').classList.remove('is-open');
    panelOf(btn).hidden = true;
  }
  function closeAll(except) { for (const b of tops()) if (b !== except) close(b); }
  function open(btn) {
    closeAll(btn);
    btn.setAttribute('aria-expanded', 'true');
    btn.closest('.gnb-item').classList.add('is-open');
    panelOf(btn).hidden = false;
  }
  const isOpen = (btn) => btn.getAttribute('aria-expanded') === 'true';
  const openTop = () => tops().find(isOpen);

  host.addEventListener('click', (e) => {
    const top = e.target.closest('.gnb-top');
    if (top) { if (isOpen(top)) close(top); else open(top); return; }
    if (e.target.closest('.gnb-panel a')) closeAll();
  });

  host.addEventListener('keydown', (e) => {
    const top = e.target.closest('.gnb-top');
    const link = e.target.closest('.gnb-panel a');
    if (!top && !link) return;
    const btn = top ?? link.closest('.gnb-item').querySelector('.gnb-top');
    const list = tops();
    const i = list.indexOf(btn);
    const move = (d) => {
      const next = list[(i + d + list.length) % list.length];
      const wasOpen = isOpen(btn);
      if (wasOpen) open(next);
      next.focus();
    };
    if (e.key === 'Escape') {
      if (!isOpen(btn)) return;
      e.preventDefault();
      close(btn);
      btn.focus();
    } else if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (top) {
        open(btn);
        const links = linksOf(btn);
        (e.key === 'ArrowDown' ? links[0] : links[links.length - 1])?.focus();
        return;
      }
      const links = linksOf(btn);
      const j = links.indexOf(link);
      links[(j + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length].focus();
    } else if (e.key === 'Home' && link) { e.preventDefault(); linksOf(btn)[0].focus(); }
    else if (e.key === 'End' && link) { e.preventDefault(); const l = linksOf(btn); l[l.length - 1].focus(); }
  });

  // 초점이 GNB 밖으로 나가면 닫습니다.
  host.addEventListener('focusout', (e) => {
    const nav = host.querySelector('.gnb');
    if (nav && !nav.contains(e.relatedTarget)) closeAll();
  });

  // 마우스: 올리면 열고, 벗어나면 잠시 뒤 닫습니다(대각선으로 패널로 옮겨 가는 동안 닫히지 않게).
  const hoverable = () => window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches;
  host.addEventListener('mouseover', (e) => {
    const item = e.target.closest('.gnb-item');
    if (!item || !hoverable()) return;
    clearTimeout(leaveTimer);
    const btn = item.querySelector('.gnb-top');
    if (!isOpen(btn)) open(btn);
  });
  host.addEventListener('mouseout', (e) => {
    const item = e.target.closest('.gnb-item');
    if (!item || item.contains(e.relatedTarget) || !hoverable()) return;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => { const b = openTop(); if (b && !host.querySelector('.gnb').contains(document.activeElement)) close(b); }, 160);
  });

  const onDocClick = (e) => { if (!host.querySelector('.gnb')?.contains(e.target)) closeAll(); };
  document.addEventListener('click', onDocClick);
  return { closeAll };
}

// host: <header class="site-header"> 요소. 로그인 상태가 바뀌면 다시 그립니다.
export async function mountHeader(host, deps = {}) {
  const api = deps.api ?? defaultApi;
  const go = deps.go ?? ((h) => { window.location.hash = h; });
  const now = deps.now ?? clockNow;
  let seq = 0;
  let state = { loggedIn: false, name: null };
  const gnb = bindGnb(host);

  function setMobileOpen(open) {
    host.classList.toggle('open', open);
    const btn = host.querySelector('.menu-btn');
    if (!btn) return;
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? '전체 메뉴 닫기' : '전체 메뉴 열기');
    btn.innerHTML = open ? CLOSE_ICON : MENU_ICON;
  }

  // 지금 주소와 같은 2depth 링크에 aria-current 를, 그 1depth 에 표시를 둡니다.
  function markCurrent() {
    const hash = window.location.hash || '#/';
    for (const a of host.querySelectorAll('.gnb-panel a, .m-sub a')) {
      if (a.getAttribute('href') === hash) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    const type = /[?&]type=([A-Z]+)/.exec(hash)?.[1];
    const section = hash.startsWith('#/guide/course') ? 'course'
      : hash.startsWith('#/guide/') ? 'guide'
        : ({ PERFORMANCE: 'perf', EXPERIENCE: 'exp', COURSE: 'course' })[type];
    for (const b of host.querySelectorAll('.gnb-top')) {
      b.closest('.gnb-item').classList.toggle('is-current', b.getAttribute('aria-controls') === `gnb-${section}`);
    }
  }

  function paint() {
    const wasOpen = host.classList.contains('open');
    host.innerHTML = headerHtml(state, gnbMenus(now()));
    setMobileOpen(wasOpen);
    markCurrent();
  }

  async function draw() {
    const my = ++seq;
    let next = { loggedIn: false, name: null };
    try {
      const session = await api.getSession();
      if (session) {
        let name = null;
        try { name = (await api.getProfile())?.name ?? null; } catch { /* 이름 없이 표시합니다. */ }
        next = { loggedIn: true, name };
      }
    } catch (e) {
      console.error(e);
    }
    if (my !== seq) return;
    state = next;
    paint();
  }

  host.addEventListener('click', async (e) => {
    if (e.target.closest('.menu-btn')) {
      setMobileOpen(!host.classList.contains('open'));
      return;
    }
    const acc = e.target.closest('.m-acc');
    if (acc) {
      const open = acc.getAttribute('aria-expanded') !== 'true';
      acc.setAttribute('aria-expanded', String(open));
      host.querySelector(`#${acc.getAttribute('aria-controls')}`).hidden = !open;
      return;
    }
    if (e.target.closest('[data-logout]')) {
      try { await api.signOut(); } catch (err) { console.error(err); }
      setMobileOpen(false);
      go('#/');
      return;
    }
    if (e.target.closest('a')) setMobileOpen(false);
  });

  host.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && host.classList.contains('open') && e.target.closest('.m-menu, .menu-btn')) {
      setMobileOpen(false);
      host.querySelector('.menu-btn').focus();
    }
  });

  // 화면이 바뀌면 열린 메뉴(데스크톱 2depth, 모바일 전체 메뉴)를 닫습니다.
  window.addEventListener('hashchange', () => { gnb.closeAll(); setMobileOpen(false); markCurrent(); });
  api.onAuthChange?.(() => { draw(); });
  paint();
  await draw();
  return { refresh: draw };
}
