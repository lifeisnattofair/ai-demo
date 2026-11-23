// 마이페이지 공통 틀: 왼쪽 메뉴(좁은 화면에서는 밑줄 탭), 건수 표시, 알림 영역, 로그인 확인.
import { escapeHtml } from '../../lib/format.js';

const MENU = [
  ['bookings', '예약 내역', '#/me/bookings', 'upcoming'],
  ['waitlist', '대기 신청', '#/me/waitlist', 'waitlist'],
  ['notifications', '알림', '#/me/notifications', 'unread'],
  ['account', '회원 정보', '#/account', null],
];

export function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * 로그인을 확인하고 마이페이지 틀을 그립니다. 로그인하지 않았으면 로그인으로 보내고 null 을 돌려줍니다.
 * @returns {Promise<null|{content:HTMLElement, notice:(kind:'ok'|'error', text:string, opts?:{focus?:boolean})=>void, clearNotice:()=>void, refreshCounts:()=>Promise<void>}>}
 */
export async function mountMyPage(el, { api, go, active, next }) {
  const session = await api.getSession();
  if (!session) {
    go(`#/login?next=${encodeURIComponent(next)}`);
    return null;
  }

  const wrap = node('div', 'container mypage');
  const nav = node('nav', 'side-nav');
  nav.setAttribute('aria-label', '마이페이지');
  nav.innerHTML = `<h2>마이페이지</h2><ul>${MENU.map(([key, label, href, count]) => `<li><a href="${href}"${key === active ? ' aria-current="page"' : ''}>${escapeHtml(label)}${count ? `<em data-count="${count}" hidden></em>` : ''}</a></li>`).join('')}</ul>`;
  const main = node('div', 'my-main');
  const content = node('div', 'my-content');
  main.append(content);
  wrap.append(nav, main);
  el.replaceChildren(wrap);

  let noticeBox = null;
  function clearNotice() {
    noticeBox?.remove();
    noticeBox = null;
  }
  // focus: 다시 그리기로 누른 버튼이 사라진 뒤에는 안내로 초점을 옮깁니다.
  // 초점이 가면 화면 낭독기가 읽으므로 이때는 알림 역할(status/alert)을 붙이지 않아 두 번 읽지 않게 합니다.
  function notice(kind, text, { focus = false } = {}) {
    clearNotice();
    noticeBox = node('p', `my-notice ${kind === 'error' ? 'error' : 'ok'}`, text);
    if (focus) noticeBox.tabIndex = -1;
    else noticeBox.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    // 제목 아래, 본문 위
    const h = content.querySelector('h1');
    if (h) h.after(noticeBox); else content.prepend(noticeBox);
    if (focus) noticeBox.focus();
  }

  async function refreshCounts() {
    try {
      const c = await api.myCounts();
      for (const em of nav.querySelectorAll('[data-count]')) {
        const n = Number(c?.[em.dataset.count]) || 0;
        em.textContent = String(n);
        em.hidden = n === 0;
        const label = { upcoming: '예정', waitlist: '진행 중', unread: '안 읽은' }[em.dataset.count];
        em.setAttribute('aria-label', `${label} ${n}건`);
      }
    } catch (e) {
      console.error(e);
    }
  }
  refreshCounts();

  return { content, notice, clearNotice, refreshCounts };
}

// 불러오지 못했을 때: 원인과 다음 행동을 알리고 다시 시도 버튼을 둡니다.
export function loadError(body, error, retry, describe) {
  const box = node('div', 'empty-state');
  const p = node('p', null, describe(error));
  p.setAttribute('role', 'alert');
  const b = node('button', 'btn btn-secondary', '다시 불러오기');
  b.type = 'button';
  b.addEventListener('click', retry);
  box.append(node('h2', null, '내용을 불러오지 못했습니다.'), p, b);
  body.replaceChildren(box);
}

// 목록이 비었을 때 보여 주는 화면(공용 컴포넌트)
export { emptyState } from '../../components/empty-state.js';
