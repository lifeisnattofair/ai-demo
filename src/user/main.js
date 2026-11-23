import '../styles/base.css';
import '../styles/tokens.css';
import '../styles/user.css';
import '../styles/screens.css';
import '../styles/booking.css';
import { createRouter } from '../lib/router.js';
import { api } from '../lib/api.js';
import { syncClock } from '../lib/clock.js';
import { mountHeader, footerHtml } from './components/header.js';
import { renderSignup, renderLogin, renderReset } from './pages/auth.js';
import { renderAccount } from './pages/account.js';
import { renderPrograms } from './pages/programs.js';
import { renderProgramDetail } from './pages/program-detail.js';
import { renderSelect } from './pages/select.js';
import { renderDiscount } from './pages/discount.js';
import { renderPayment } from './pages/payment.js';
import { renderPaymentSuccess, renderPaymentFail } from './pages/payment-result.js';

const root = document.getElementById('root');
root.innerHTML = `<a class="skip" href="#/" data-skip>본문으로 건너뛰기</a>
  <header class="site-header"></header>
  <main id="main" tabindex="-1"></main>
  <footer class="site-footer">${footerHtml()}</footer>`;

const main = root.querySelector('main');
let router;
const go = (h) => router.go(h);

router = createRouter(
  {
    '#/': (_p, el, query) => renderPrograms(el, { api, query }),
    '#/programs': (_p, el, query) => renderPrograms(el, { api, query }),
    '#/programs/:id': (p, el) => renderProgramDetail(el, { api, id: p.id }),
    '#/booking/:offeringId/select': (p, el) => renderSelect(el, { api, go, offeringId: p.offeringId }),
    '#/booking/:holdId/discount': (p, el) => renderDiscount(el, { api, go, holdId: p.holdId }),
    '#/booking/:holdId/pay': (p, el) => renderPayment(el, { api, go, holdId: p.holdId }),
    '#/payment/success': (_p, el, query) => renderPaymentSuccess(el, { api, go, query }),
    '#/payment/fail': (_p, el, query) => renderPaymentFail(el, { query }),
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
