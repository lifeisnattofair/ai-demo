// 관리자 화면 진입점: 로그인 -> 역할 확인(담당자가 아니면 접근 거부) -> 공통 틀 + 해시 라우터
import '../styles/base.css';
import '../styles/tokens.css';
import '../styles/admin.css';
import { createRouter } from '../lib/router.js';
import { APP_ENV } from '../lib/supabase.js';
import { syncClock } from '../lib/clock.js';
import { withBusy } from '../components/button-busy.js';
import { describeError } from '../lib/api.js';
import { escapeHtml } from '../lib/format.js';
import { adminApi } from './admin-api.js';
import { AVAILABLE, findMenu, renderLayout } from './layout.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderPrograms, renderProgramEdit } from './pages/programs.js';
import { renderOfferings, renderOfferingEdit } from './pages/offerings.js';
import { renderBookings } from './pages/bookings.js';
import { renderWaitlist } from './pages/waitlist.js';
import { renderPayments } from './pages/payments.js';
import { renderCancelRequests } from './pages/cancel-requests.js';
import { renderSettlement } from './pages/settlement.js';

document.body.classList.add('admin');
const root = document.getElementById('root');
const STAFF = ['operator', 'finance'];
const LOGIN_MSG = 'admin-login-msg';

const gateBrand = '<div class="brand"><b>한빛아트센터</b><span>통합 예약 관리</span></div>';

function renderLogin(message, tone = 'err') {
  root.innerHTML = `<main class="gate"><div class="gate-card">${gateBrand}
      <h1 tabindex="-1">관리자 로그인</h1>
      <p class="lead">운영 담당, 정산 담당 계정으로 로그인해 주세요.</p>
      <form novalidate>
        <p class="msg${tone === 'info' ? ' info' : ''}" role="${tone === 'info' ? 'status' : 'alert'}"${message ? '' : ' hidden'}>${escapeHtml(message ?? '')}</p>
        <label>이메일<input class="ctl" type="email" name="email" autocomplete="username" required></label>
        <label>비밀번호<input class="ctl" type="password" name="password" autocomplete="current-password" required></label>
        <button class="btn btn-primary" type="submit">로그인</button>
      </form>
      <p class="alt"><a href="./">사용자 화면으로 이동</a></p>
    </div></main>`;
  document.title = '관리자 로그인 | 한빛아트센터';
  const form = root.querySelector('form');
  const msg = form.querySelector('.msg');
  const show = (text) => { msg.hidden = false; msg.className = 'msg'; msg.setAttribute('role', 'alert'); msg.textContent = text; };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) { show('이메일과 비밀번호를 모두 입력해 주세요.'); (email ? form.password : form.email).focus(); return; }
    withBusy(form.querySelector('button'), async () => {
      try {
        const { session } = await adminApi.signIn(email, password);
        await boot(session);
      } catch (err) {
        show(describeError(err));
        form.password.value = '';
        form.password.focus();
      }
    });
  });
  form.email.focus();
}

function renderDenied(session) {
  root.innerHTML = `<main class="gate"><div class="gate-card">${gateBrand}
      <h1 tabindex="-1">접근 권한이 없습니다</h1>
      <p class="lead">${session.user.email ? `${escapeHtml(session.user.email)} 계정은 ` : ''}관리자 화면을 쓸 수 없는 계정입니다. 운영 담당 또는 정산 담당 계정으로 다시 로그인해 주세요.</p>
      <button class="btn btn-primary" type="button">다른 계정으로 로그인</button>
      <p class="alt"><a href="./">사용자 화면으로 이동</a></p>
    </div></main>`;
  document.title = '접근 권한 없음 | 한빛아트센터';
  const btn = root.querySelector('button');
  btn.addEventListener('click', () => withBusy(btn, async () => { await adminApi.signOut(); window.location.reload(); }));
  root.querySelector('h1').focus();
}

let layout = null;

// 로그아웃하면 화면 상태(라우터, 타이머)를 남기지 않도록 새로 불러온 뒤 안내를 보입니다.
function reloadWith(message) {
  try { sessionStorage.setItem(LOGIN_MSG, message); } catch { /* 저장소를 못 써도 로그인 화면은 뜹니다. */ }
  window.location.reload();
}

async function logout(reason) {
  layout?.destroy();
  layout = null;
  await adminApi.signOut();
  reloadWith(reason === 'idle' ? '30분 동안 사용하지 않아 자동으로 로그아웃되었습니다. 다시 로그인해 주세요.' : '로그아웃했습니다.');
}

async function boot(session) {
  if (!session) {
    let msg = null;
    try { msg = sessionStorage.getItem(LOGIN_MSG); sessionStorage.removeItem(LOGIN_MSG); } catch { /* 없음 */ }
    if (msg) renderLogin(msg, 'info');
    else renderLogin();
    return;
  }
  let me;
  try {
    me = await adminApi.me(session.user.id);
  } catch (err) {
    renderLogin(describeError(err));
    return;
  }
  if (!me || !STAFF.includes(me.role)) { renderDenied(session); return; }
  const role = me.role;

  const routes = {
    '#/': (_p, el) => renderDashboard(el, { api: adminApi, role, available, onCounts: (c) => layout?.setCounts(c) }),
    '#/programs': (_p, el, query) => renderPrograms(el, { api: adminApi, query }),
    '#/programs/new': (_p, el) => renderProgramEdit(el, { api: adminApi, go }),
    '#/programs/:id': (p, el) => renderProgramEdit(el, { api: adminApi, go, id: p.id }),
    '#/offerings': (_p, el, query) => renderOfferings(el, { api: adminApi, query }),
    '#/offerings/new': (_p, el, query) => renderOfferingEdit(el, { api: adminApi, go, query }),
    '#/offerings/:id': (p, el, query) => renderOfferingEdit(el, { api: adminApi, go, id: p.id, query }),
    '#/bookings': (_p, el, query) => renderBookings(el, { api: adminApi, role, query }),
    '#/waitlist': (_p, el, query) => renderWaitlist(el, { api: adminApi, query }),
    '#/payments': (_p, el) => renderPayments(el, { api: adminApi }),
    '#/cancel-requests': (_p, el) => renderCancelRequests(el, { api: adminApi, role, onCounts: (c) => layout?.setCounts(c) }),
    '#/settlement': (_p, el) => renderSettlement(el, { api: adminApi }),
  };
  // 메뉴에 보일 경로(화면이 있는 것만)
  const available = AVAILABLE;

  layout?.destroy();
  layout = renderLayout(root, {
    user: { name: me.name, email: session.user.email, lastSignInAt: session.user.last_sign_in_at },
    role,
    env: APP_ENV,
    available,
    current: window.location.hash || '#/',
    onLogout: logout,
    onSearch: role === 'operator' ? (q) => go(`#/programs${q ? `?q=${encodeURIComponent(q)}` : ''}`) : undefined,
  });

  // 역할에 맞지 않는 메뉴 경로는 화면을 그리기 전에 막습니다(데이터는 RLS 가 다시 막음).
  const guarded = Object.fromEntries(Object.entries(routes).map(([pattern, handler]) => [pattern, (p, el, q) => {
    const path = (window.location.hash || '#/').split('?')[0];
    layout?.setCurrent(path);
    layout?.extend();
    const hit = findMenu(path);
    if (hit && !hit.item.roles.includes(role)) {
      el.innerHTML = '<div class="page-message"><h1>이 메뉴를 쓸 권한이 없습니다</h1><p>담당 역할에 맞는 메뉴를 왼쪽에서 선택해 주세요.</p><a class="btn-secondary" href="#/">대시보드로 이동</a></div>';
      return undefined;
    }
    return handler(p, el, q);
  }]));
  router = createRouter(guarded, layout.content);
  await router.start();
}

let router;
const go = (h) => router.go(h);

adminApi.onAuthChange((event) => {
  // 다른 탭에서 로그아웃했거나 세션이 끝난 경우
  if (event === 'SIGNED_OUT' && layout) {
    layout.destroy();
    layout = null;
    reloadWith('로그인이 끝났습니다. 다시 로그인해 주세요.');
  }
});

syncClock();
adminApi.session().then(boot);
