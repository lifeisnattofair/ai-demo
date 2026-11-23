// 관리자 공통 틀: 상단 바(기관명, 통합 검색, 자동 로그아웃, 역할, 이름, 로그아웃), 좌측 메뉴 트리, 본문.
// 메뉴 구성은 설계 5-9 그대로이고, 역할(roles)과 환경(env)에 맞는 항목만 보입니다.
// 아직 화면이 없는 경로는 available 에서 빼서 메뉴에 그리지 않습니다(동작 없는 링크 금지).
import { clockOffsetText, escapeHtml, kstDateTime } from '../lib/format.js';

const ALL = ['operator', 'finance'];

export const ROLE_LABEL = { operator: '운영 담당', finance: '정산 담당' };

export const MENU = [
  { label: '대시보드', path: '#/', icon: 'dashboard', roles: ALL },
  {
    label: '프로그램관리', icon: 'program', roles: ['operator'], children: [
      { label: '프로그램 목록', path: '#/programs', roles: ['operator'] },
      { label: '회차/좌석 관리', path: '#/offerings', roles: ['operator'] },
    ],
  },
  {
    label: '예약관리', icon: 'ticket', roles: ALL, children: [
      { label: '예약 내역', path: '#/bookings', roles: ALL },
      { label: '대기자 관리', path: '#/waitlist', roles: ['operator'] },
    ],
  },
  {
    label: '결제/정산', icon: 'card', roles: ALL, children: [
      { label: '결제/환불 내역', path: '#/payments', roles: ['finance'] },
      { label: '회차 취소 승인', path: '#/cancel-requests', roles: ALL },
      { label: '정산 현황', path: '#/settlement', roles: ['finance'] },
    ],
  },
  {
    label: '시스템', icon: 'system', roles: ALL, children: [
      { label: '작업 이력', path: '#/audit', roles: ALL },
      { label: '검수용 시계', path: '#/system/clock', roles: ['operator'], envs: ['qa', 'local'] },
      { label: '시연 데이터 초기화', path: '#/system/reset', roles: ['operator'], envs: ['demo', 'local'] },
    ],
  },
];

// 화면이 있는 경로. 메뉴는 이 경로만 그립니다.
export const AVAILABLE = new Set([
  '#/', '#/programs', '#/offerings', '#/bookings', '#/waitlist', '#/payments', '#/cancel-requests', '#/settlement',
  '#/audit', '#/system/clock', '#/system/reset',
]);

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  program: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5"/>',
  ticket: '<path d="M4 5h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z"/><path d="M10 5v12" stroke-dasharray="2 2"/>',
  card: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  system: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
};
const icon = (name) => `<svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${ICONS[name]}</svg>`;
const CHEV = '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

// 환경 제한이 없거나 이 환경이 허용 목록에 있으면 true. 주소로 직접 들어오는 경우에도 같은 규칙을 씁니다.
export const envAllows = (item, env) => !item.envs || item.envs.includes(env);

const allowed = (item, role, env, available) =>
  item.roles.includes(role) && envAllows(item, env) && (!item.path || !available || available.has(item.path));

/**
 * 역할, 환경, 열 수 있는 경로에 맞춰 거른 메뉴. 하위 항목이 모두 빠진 묶음은 없앱니다.
 * @param {string} role
 * @param {string} env 'local' | 'qa' | 'demo'
 * @param {Set<string>} [available] 화면이 있는 경로. 없으면 모두 있다고 봅니다.
 */
export function visibleMenu(role, env = 'local', available) {
  const out = [];
  for (const g of MENU) {
    if (!g.roles.includes(role)) continue;
    if (!g.children) {
      if (allowed(g, role, env, available)) out.push(g);
      continue;
    }
    const children = g.children.filter((c) => allowed(c, role, env, available));
    if (children.length) out.push({ ...g, children });
  }
  return out;
}

// 경로에 맞는 메뉴 항목과 묶음. '#/programs/abc' 는 '#/programs' 에 속합니다.
export function findMenu(path) {
  const p = (path || '#/').split('?')[0];
  let best = null;
  for (const g of MENU) {
    for (const item of g.children ?? [g]) {
      const hit = item.path === '#/' ? p === '#/' : (p === item.path || p.startsWith(`${item.path}/`));
      if (hit && (!best || item.path.length > best.item.path.length)) best = { group: g, item };
    }
  }
  return best;
}

const pad = (n) => String(n).padStart(2, '0');
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

/**
 * @param {HTMLElement} el
 * @param {{user:{name:string,email?:string,lastSignInAt?:string}, role:string, current:string, env?:string,
 *   available?:Set<string>, onLogout?:()=>void, onSearch?:(q:string)=>void, now?:()=>number, idleMs?:number}} opts
 * @returns {{content:HTMLElement, setCurrent:(path:string)=>void, setClock:(clock:{enabled:boolean, offsetMs:number})=>void, setCounts:(counts:Object)=>void, extend:()=>void, destroy:()=>void}}
 */
export function renderLayout(el, {
  user, role, current, env = 'local', available, onLogout = () => {}, onSearch, now = () => Date.now(), idleMs = 30 * 60 * 1000,
}) {
  const menu = visibleMenu(role, env, available);
  const canSearch = typeof onSearch === 'function';
  let seq = 0;

  const groupHtml = (g) => {
    if (!g.children) {
      return `<div class="s-group"><a class="s-head" href="${g.path}" data-path="${g.path}"><span class="lbl">${icon(g.icon)}${escapeHtml(g.label)}</span></a></div>`;
    }
    const id = `nav-g${++seq}`;
    const items = g.children.map((c) => `<li><a href="${c.path}" data-path="${c.path}"><span>${escapeHtml(c.label)}</span><span class="cnt" hidden></span></a></li>`).join('');
    return `<div class="s-group"><button class="s-head" type="button" aria-expanded="true" aria-controls="${id}"><span class="lbl">${icon(g.icon)}${escapeHtml(g.label)}</span>${CHEV}</button><ul id="${id}">${items}</ul></div>`;
  };

  const lastLogin = user?.lastSignInAt ? `최근 접속 ${escapeHtml(kstDateTime(user.lastSignInAt))}` : '';
  el.innerHTML = `
    <div class="top-stack">
    <div class="clock-band" role="status" hidden></div>
    <header class="topbar">
      <button class="menu-toggle" type="button" aria-label="메뉴 열기" aria-expanded="false" aria-controls="admin-nav"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
      <a class="brand" href="#/"><b>한빛아트센터</b><span>통합 예약 관리</span></a>
      ${canSearch ? `<form class="t-search" role="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><label class="sr-only" for="gs">통합 검색</label><input id="gs" name="q" type="search" placeholder="프로그램명 검색" autocomplete="off"></form>` : ''}
      <div class="t-right">
        <span class="session"><span class="lbl">자동 로그아웃</span> <b class="num" aria-hidden="true"></b><span class="sr-only" role="status" aria-live="polite"></span><button type="button">연장</button></span>
        <span class="who"><span class="role">${escapeHtml(ROLE_LABEL[role] ?? role)}</span><span><b>${escapeHtml(user?.name ?? '')}</b> 님</span></span>
        <button class="logout" type="button">로그아웃</button>
      </div>
    </header>
    </div>
    <div class="shell">
      <nav class="sidebar" id="admin-nav" aria-label="관리자 메뉴">
        ${menu.map(groupHtml).join('')}
        <div class="s-foot">${escapeHtml(user?.name ?? '')} (${escapeHtml(ROLE_LABEL[role] ?? role)})${lastLogin ? `<br>${lastLogin}` : ''}</div>
      </nav>
      <button class="nav-scrim" type="button" tabindex="-1" aria-label="메뉴 닫기"></button>
      <main class="content" id="admin-main" tabindex="-1"></main>
    </div>`;

  const shell = el.querySelector('.shell');
  const toggle = el.querySelector('.menu-toggle');
  const content = el.querySelector('.content');

  // 메뉴 묶음 접기/펼치기
  for (const head of el.querySelectorAll('.sidebar button.s-head')) {
    head.addEventListener('click', () => {
      const open = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', String(open));
      document.getElementById(head.getAttribute('aria-controls')).hidden = !open;
    });
  }

  // 좁은 화면 메뉴
  function setNav(open) {
    shell.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
  }
  toggle.addEventListener('click', () => setNav(!shell.classList.contains('nav-open')));
  el.querySelector('.nav-scrim').addEventListener('click', () => setNav(false));
  const onKey = (e) => {
    if (e.key === 'Escape' && shell.classList.contains('nav-open')) {
      setNav(false);
      toggle.focus();
    }
  };
  document.addEventListener('keydown', onKey);
  el.querySelector('.sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) setNav(false); });

  // 통합 검색
  el.querySelector('.t-search')?.addEventListener('submit', (e) => {
    e.preventDefault();
    onSearch(e.currentTarget.q.value.trim());
  });

  el.querySelector('.logout').addEventListener('click', () => onLogout('manual'));

  // 자동 로그아웃: 마지막 연장(또는 화면 이동) 뒤 idleMs 가 지나면 로그아웃합니다.
  const sessionEl = el.querySelector('.session');
  const timerEl = sessionEl.querySelector('.num');
  const liveEl = sessionEl.querySelector('[role="status"]');
  let deadline = now() + idleMs;
  let warned = false;
  let done = false;
  function tick() {
    if (done) return;
    const left = deadline - now();
    timerEl.textContent = mmss(left);
    sessionEl.classList.toggle('is-soon', left <= 60_000);
    if (left <= 60_000 && !warned) {
      warned = true;
      liveEl.textContent = '1분 뒤 자동으로 로그아웃됩니다. 계속 쓰시려면 연장을 눌러 주세요.';
    }
    if (left <= 0) {
      done = true;
      clearInterval(interval);
      onLogout('idle');
    }
  }
  function extend() {
    if (done) return;
    deadline = now() + idleMs;
    warned = false;
    liveEl.textContent = '';
    tick();
  }
  sessionEl.querySelector('button').addEventListener('click', () => {
    extend();
    liveEl.textContent = '로그인 시간을 연장했습니다.';
  });
  const interval = setInterval(tick, 1000);
  tick();

  function setCurrent(path) {
    const hit = findMenu(path);
    for (const a of el.querySelectorAll('.sidebar [data-path]')) {
      if (hit && a.dataset.path === hit.item.path) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    // 현재 항목이 든 묶음은 펼칩니다.
    const cur = el.querySelector('.sidebar ul [aria-current="page"]');
    const ul = cur?.closest('ul');
    if (ul?.hidden) {
      ul.hidden = false;
      el.querySelector(`[aria-controls="${ul.id}"]`)?.setAttribute('aria-expanded', 'true');
    }
  }

  function setCounts(counts) {
    for (const [path, n] of Object.entries(counts ?? {})) {
      const cnt = el.querySelector(`.sidebar a[data-path="${CSS.escape(path)}"] .cnt`);
      if (!cnt) continue;
      cnt.hidden = !(n > 0);
      cnt.innerHTML = n > 0 ? `${Number(n).toLocaleString('en-US')}<span class="sr-only">건</span>` : '';
    }
  }

  // 검수용 시계가 실제 시각과 다를 때만 상단 띠를 보입니다(어느 화면에서든 같은 자리).
  const bandEl = el.querySelector('.clock-band');
  function setClock(clock) {
    const text = clock?.enabled ? clockOffsetText(clock.offsetMs) : '';
    bandEl.hidden = !text;
    bandEl.textContent = text ? `검수용 시계 사용 중: 실제보다 ${text}` : '';
    el.classList.toggle('has-clock-band', Boolean(text));
    // 좁은 화면에서 띠 문구가 두 줄이 되어도 사이드바 위치가 맞도록 실제 높이를 씁니다(36px 는 기본값).
    const h = text ? bandEl.offsetHeight : 0;
    if (h) el.style.setProperty('--band-h', `${h}px`);
    else el.style.removeProperty('--band-h');
  }

  setCurrent(current);
  return {
    content,
    setCurrent,
    setClock,
    setCounts,
    extend,
    destroy() {
      done = true;
      clearInterval(interval);
      document.removeEventListener('keydown', onKey);
    },
  };
}
