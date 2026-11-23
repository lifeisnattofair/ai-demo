import '../styles/base.css';
import '../styles/tokens.css';
import '../styles/user.css';
import '../styles/screens.css';
import { createRouter } from '../lib/router.js';
import { api } from '../lib/api.js';
import { syncClock } from '../lib/clock.js';
import { mountHeader, footerHtml } from './components/header.js';
import { renderSignup, renderLogin, renderReset } from './pages/auth.js';
import { renderAccount } from './pages/account.js';

const root = document.getElementById('root');
root.innerHTML = `<a class="skip" href="#/" data-skip>본문으로 건너뛰기</a>
  <header class="site-header"></header>
  <main id="main" tabindex="-1"></main>
  <footer class="site-footer">${footerHtml()}</footer>`;

const main = root.querySelector('main');
let router;
const go = (h) => router.go(h);

function home(_params, el) {
  el.innerHTML = `<section class="container hero-lite">
    <p class="eyebrow">한빛아트센터</p>
    <h1>무대와 배움이<br>가까운 곳에</h1>
    <p>공연과 체험, 정규 강좌를 한곳에서 찾고 예약하세요.</p>
    <a class="btn btn-primary" href="#/programs?type=PERFORMANCE">공연 보기</a>
  </section>`;
}

router = createRouter(
  {
    '#/': home,
    '#/signup': (_p, el) => renderSignup(el, { api, go }),
    '#/login': (_p, el, query) => renderLogin(el, { api, go, query }),
    '#/reset': (_p, el) => renderReset(el, { api }),
    '#/account': (_p, el) => renderAccount(el, { api, go }),
  },
  main,
);

root.querySelector('[data-skip]').addEventListener('click', (e) => {
  e.preventDefault();
  main.focus();
});

window.addEventListener('hashchange', () => window.scrollTo(0, 0));

// 비밀번호 재설정 메일의 링크로 들어오면 내 정보에서 새 비밀번호를 정하게 합니다.
api.onAuthChange((event) => {
  if (event === 'PASSWORD_RECOVERY') go('#/account');
});

mountHeader(root.querySelector('.site-header'), { api, go });
syncClock();
router.start();
