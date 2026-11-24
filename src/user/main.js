import '../styles/base.css';
import '../styles/tokens.css';
import '../styles/user.css';
import '../styles/screens.css';
import '../styles/booking.css';
import '../styles/mypage.css';
import '../styles/motion.css';
import { createRouter } from '../lib/router.js';
import { api } from '../lib/api.js';
import { syncClock } from '../lib/clock.js';
import { mountHeader, footerHtml } from './components/header.js';
import { renderSignup, renderLogin, renderReset, renderCompleteContact } from './pages/auth.js';
import { renderAccount } from './pages/account.js';
import { renderPrograms } from './pages/programs.js';
import { renderProgramDetail } from './pages/program-detail.js';
import { renderSelect } from './pages/select.js';
import { renderDiscount } from './pages/discount.js';
import { renderPayment } from './pages/payment.js';
import { renderPaymentSuccess, renderPaymentFail } from './pages/payment-result.js';
import { renderMyBookings } from './pages/my-bookings.js';
import { renderBookingDetail } from './pages/booking-detail.js';
import { renderWaitlist } from './pages/waitlist.js';
import { renderNotifications } from './pages/notifications.js';
import { renderGuideCourse, renderGuideRefund, renderGuideVisit } from './pages/guide.js';

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
    '#/signup/contact': (_p, el, query) => renderCompleteContact(el, { api, go, query }),
    '#/login': (_p, el, query) => renderLogin(el, { api, go, query }),
    '#/reset': (_p, el) => renderReset(el, { api }),
    '#/account': (_p, el) => renderAccount(el, { api, go }),
    '#/me/bookings': (_p, el, query) => renderMyBookings(el, { api, go, query }),
    '#/me/bookings/:id': (p, el) => renderBookingDetail(el, { api, go, id: p.id }),
    '#/me/waitlist': (_p, el) => renderWaitlist(el, { api, go }),
    '#/me/notifications': (_p, el) => renderNotifications(el, { api, go }),
    '#/guide/refund': (_p, el) => renderGuideRefund(el),
    '#/guide/visit': (_p, el) => renderGuideVisit(el),
    '#/guide/course': (_p, el) => renderGuideCourse(el),
    // 예전 주소는 내 예약으로 보냅니다(방문 기록에 예전 주소를 남기지 않습니다).
    '#/my': () => router.replace('#/me/bookings'),
  },
  main,
);

root.querySelector('[data-skip]').addEventListener('click', (e) => {
  e.preventDefault();
  main.focus();
});

// 화면을 옮길 때마다 서버 시각과의 차이를 다시 맞춥니다(남은 선점 시간, 환불 구간 표시, QA D-01).
window.addEventListener('hashchange', () => {
  window.scrollTo(0, 0);
  syncClock();
});

// 비밀번호 재설정 메일의 링크로 들어오면 내 정보에서 새 비밀번호를 정하게 합니다.
api.onAuthChange((event) => {
  if (event === 'PASSWORD_RECOVERY') go('#/account');
});

const header = mountHeader(root.querySelector('.site-header'), { api, go });
// 검수용 시계를 맞춘 뒤 GNB 의 이번 달/다음 달 링크를 다시 계산합니다.
syncClock().then(() => header.then((h) => h.refresh()));
router.start();
