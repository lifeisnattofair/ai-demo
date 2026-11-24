// 내 정보: 회원 정보 보기와 수정, 비밀번호 변경, 로그아웃, 회원 탈퇴
import { api as defaultApi, describeError, messageFor } from '../../lib/api.js';
import { APP_ENV } from '../../lib/supabase.js';
import { formatPhone, kstDate, escapeHtml } from '../../lib/format.js';
import { validatePassword, bindContactForm, contactHash } from './auth.js';
import { withBusy } from '../../components/button-busy.js';

const q = (el, sel) => el.querySelector(sel);

// README 에 비밀번호까지 공개된 시연 계정(supabase/seed.sql). 공개 시연(demo)에서는 바꾸지 못하게 합니다.
// 연락처 수정과 탈퇴는 DB 함수가 막고, 비밀번호 변경은 Supabase Auth 가 처리해 DB 에서 막을 수 없어 화면에서 감춥니다.
export const DEMO_SEED_EMAILS = ['member1@demo.test', 'member2@demo.test', 'member3@demo.test', 'operator@demo.test', 'finance@demo.test'];

export function isLockedDemoAccount(env, email) {
  return env === 'demo' && DEMO_SEED_EMAILS.includes(String(email ?? '').toLowerCase());
}

function note(el, parent, kind, text) {
  q(parent, '[data-note]')?.remove();
  const p = document.createElement('p');
  p.dataset.note = '';
  p.className = kind === 'error' ? 'form-error' : 'note info';
  p.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  p.textContent = text;
  parent.append(p);
}

const EMAIL_HINT = '이메일은 로그인 아이디라 바꿀 수 없습니다. 다른 이메일을 쓰시려면 새로 가입해 주세요.';

function profileHtml({ email, profile, locked }) {
  const verified = Boolean(profile?.verified_at);
  const emailRow = `<dt>이메일</dt><dd>${escapeHtml(email)}</dd>`;
  if (!verified) {
    return `<dl class="profile-list">${emailRow}<dt>연락처 입력</dt><dd>미완료</dd></dl>
      <p class="note info" id="contact-missing">가입 때 연락처 입력이 끝나지 않아 예매할 수 없습니다. 이름과 휴대폰 번호를 입력해 주세요.</p>
      <a class="btn btn-primary" href="${escapeHtml(contactHash('#/account'))}">연락처 입력하기</a>`;
  }
  const doneRow = `<dt>연락처 입력</dt><dd>완료 (${escapeHtml(kstDate(profile.verified_at))})</dd>`;
  if (locked) {
    return `<dl class="profile-list">${emailRow}
        <dt>이름</dt><dd>${escapeHtml(profile.name ?? '-')}</dd>
        <dt>휴대폰 번호</dt><dd class="num">${profile.phone ? escapeHtml(formatPhone(profile.phone)) : '-'}</dd>
        ${doneRow}</dl>`;
  }
  return `<dl class="profile-list">${emailRow}${doneRow}</dl>
    <p class="account-hint" id="email-hint">${EMAIL_HINT}</p>
    <form class="auth-form" id="contact-form" novalidate>
      <div class="field"><label for="name">이름</label><input class="input" id="name" name="name" type="text" autocomplete="name" maxlength="50" required value="${escapeHtml(profile.name ?? '')}"></div>
      <div class="field"><label for="phone">휴대폰 번호</label><input class="input" id="phone" name="phone" type="tel" autocomplete="tel" inputmode="numeric" placeholder="01012345678" required value="${escapeHtml(profile.phone ?? '')}"></div>
      <button class="btn btn-secondary" type="submit">정보 수정</button>
    </form>`;
}

export async function renderAccount(el, deps = {}) {
  const api = deps.api ?? defaultApi;
  const go = deps.go ?? ((h) => { window.location.hash = h; });
  const env = deps.env ?? APP_ENV;

  const session = await api.getSession();
  if (!session) {
    go(`#/login?next=${encodeURIComponent('#/account')}`);
    return;
  }
  const profile = await api.getProfile().catch(() => null);
  const email = session.user?.email ?? '';
  const locked = isLockedDemoAccount(env, email);
  const lockedNote = `<p class="note info" data-demo-locked>${escapeHtml(messageFor('DEMO_ACCOUNT_LOCKED'))}</p>`;

  el.innerHTML = `<section class="container account">
    <h1 class="page-title">내 정보</h1>
    <div class="panel">
      <div class="panel-head"><h2>회원 정보</h2></div>
      <div class="panel-body">
        ${locked ? lockedNote : ''}
        ${profileHtml({ email, profile, locked })}
      </div>
    </div>
    ${locked ? '' : `<div class="panel">
      <div class="panel-head"><h2>비밀번호 변경</h2></div>
      <div class="panel-body">
        <form class="auth-form" id="pw-form" novalidate>
          <div class="field"><label for="new-password">새 비밀번호</label><input class="input" id="new-password" type="password" autocomplete="new-password" aria-describedby="new-password-hint" required></div>
          <p class="field-hint" id="new-password-hint">영문과 숫자를 함께 8자 이상 입력해 주세요.</p>
          <button class="btn btn-secondary" type="submit">비밀번호 변경</button>
        </form>
      </div>
    </div>`}
    <div class="panel">
      <div class="panel-head"><h2>${locked ? '로그아웃' : '로그아웃과 탈퇴'}</h2></div>
      <div class="panel-body">
        <div class="account-actions">
          <button class="btn btn-secondary" type="button" id="logout">로그아웃</button>
          ${locked ? '' : '<button class="btn btn-danger" type="button" id="withdraw-open">회원 탈퇴</button>'}
        </div>
        <div id="withdraw-area"></div>
      </div>
    </div>
  </section>`;

  const contactForm = q(el, '#contact-form');
  if (contactForm) {
    // 다시 저장할 때는 이전 성공 안내부터 지웁니다. 입력칸 오류와 성공 안내가 함께 남지 않게 합니다(QA D-10).
    // bindContactForm 보다 먼저 등록해 검사 전에 실행됩니다.
    contactForm.addEventListener('submit', () => q(contactForm, '[data-note]')?.remove());
    bindContactForm(el, contactForm, async (name, phone) => {
      q(contactForm, '[data-note]')?.remove();
      const row = await api.updateContact(name, phone);
      q(el, '#name').value = row?.name ?? name;
      q(el, '#phone').value = row?.phone ?? phone;
      note(el, contactForm, 'ok', '회원 정보를 수정했습니다.');
    });
  }

  const pwForm = q(el, '#pw-form');
  pwForm?.addEventListener('submit', async (e) => {
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
  q(el, '#withdraw-open')?.addEventListener('click', () => {
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
