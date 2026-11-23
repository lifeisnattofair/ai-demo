// 내 정보: 회원 정보, 비밀번호 변경, 로그아웃, 회원 탈퇴
import { api as defaultApi, describeError } from '../../lib/api.js';
import { formatPhone, kstDate, escapeHtml } from '../../lib/format.js';
import { validatePassword } from './auth.js';
import { withBusy } from '../../components/button-busy.js';

const q = (el, sel) => el.querySelector(sel);

function note(el, parent, kind, text) {
  q(parent, '[data-note]')?.remove();
  const p = document.createElement('p');
  p.dataset.note = '';
  p.className = kind === 'error' ? 'form-error' : 'note info';
  p.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  p.textContent = text;
  parent.append(p);
}

export async function renderAccount(el, deps = {}) {
  const api = deps.api ?? defaultApi;
  const go = deps.go ?? ((h) => { window.location.hash = h; });

  const session = await api.getSession();
  if (!session) {
    go(`#/login?next=${encodeURIComponent('#/account')}`);
    return;
  }
  const profile = (await api.getProfile().catch(() => null)) ?? {};
  const email = session.user?.email ?? '';

  el.innerHTML = `<section class="container account">
    <h1 class="page-title">내 정보</h1>
    <div class="panel">
      <div class="panel-head"><h2>회원 정보</h2></div>
      <div class="panel-body">
        <dl class="profile-list">
          <dt>이메일</dt><dd>${escapeHtml(email)}</dd>
          <dt>이름</dt><dd>${escapeHtml(profile.name ?? '-')}</dd>
          <dt>휴대폰 번호</dt><dd class="num">${profile.phone ? escapeHtml(formatPhone(profile.phone)) : '-'}</dd>
          <dt>본인 인증</dt><dd>${profile.verified_at ? `완료 (${escapeHtml(kstDate(profile.verified_at))})` : '미완료'}</dd>
        </dl>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>비밀번호 변경</h2></div>
      <div class="panel-body">
        <form class="auth-form" id="pw-form" novalidate>
          <div class="field"><label for="new-password">새 비밀번호</label><input class="input" id="new-password" type="password" autocomplete="new-password" aria-describedby="new-password-hint" required></div>
          <p class="field-hint" id="new-password-hint">영문과 숫자를 함께 8자 이상 입력해 주세요.</p>
          <button class="btn btn-secondary" type="submit">비밀번호 변경</button>
        </form>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>로그아웃과 탈퇴</h2></div>
      <div class="panel-body">
        <div class="account-actions">
          <button class="btn btn-secondary" type="button" id="logout">로그아웃</button>
          <button class="btn btn-danger" type="button" id="withdraw-open">회원 탈퇴</button>
        </div>
        <div id="withdraw-area"></div>
      </div>
    </div>
  </section>`;

  const pwForm = q(el, '#pw-form');
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = q(el, '#new-password').value;
    const msg = validatePassword(pw);
    if (msg) {
      note(el, pwForm, 'error', msg);
      return;
    }
    await withBusy(q(pwForm, '[type="submit"]'), async () => {
      try {
        await api.updatePassword(pw);
        q(el, '#new-password').value = '';
        note(el, pwForm, 'ok', '비밀번호를 변경했습니다.');
      } catch (err) {
        note(el, pwForm, 'error', describeError(err));
      }
    });
  });

  const logout = q(el, '#logout');
  logout.addEventListener('click', () => withBusy(logout, async () => {
    try {
      await api.signOut();
      go('#/');
    } catch (err) {
      note(el, q(el, '#withdraw-area'), 'error', describeError(err));
    }
  }));

  const area = q(el, '#withdraw-area');
  q(el, '#withdraw-open').addEventListener('click', () => {
    if (q(area, '.confirm-box')) return;
    area.innerHTML = `<div class="confirm-box" role="group" aria-labelledby="wd-title">
      <p id="wd-title"><strong>정말 탈퇴하시겠어요?</strong></p>
      <p>탈퇴하면 이 계정으로 다시 로그인할 수 없고 이름과 휴대폰 번호는 삭제됩니다. 진행 중인 예약이 있으면 탈퇴할 수 없습니다.</p>
      <div class="auth-actions">
        <button class="btn btn-secondary" type="button" id="withdraw-cancel">취소</button>
        <button class="btn btn-danger-solid" type="button" id="withdraw-confirm">탈퇴하기</button>
      </div>
    </div>`;
    q(area, '#withdraw-cancel').addEventListener('click', () => { area.replaceChildren(); q(el, '#withdraw-open').focus(); });
    q(area, '#withdraw-confirm').addEventListener('click', async (ev) => {
      await withBusy(ev.currentTarget, async () => {
        try {
          await api.withdraw();
          await api.signOut().catch(() => {});
          go('#/');
        } catch (err) {
          note(el, q(area, '.confirm-box'), 'error', describeError(err));
        }
      });
    });
    q(area, '#withdraw-cancel').focus();
  });
}
