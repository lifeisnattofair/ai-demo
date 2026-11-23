// 가입(계정 정보, 약관 동의, 연락처 입력), 로그인, 비밀번호 재설정 화면
import { api as defaultApi, describeError } from '../../lib/api.js';
import { withBusy } from '../../components/button-busy.js';
import { bindTermViews, termRowHtml } from '../components/terms.js';

const PW_MESSAGE = '비밀번호는 영문과 숫자를 함께 8자 이상 입력해 주세요.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePassword(pw) {
  const s = String(pw ?? '');
  return s.length >= 8 && /[A-Za-z]/.test(s) && /\d/.test(s) ? '' : PW_MESSAGE;
}

export function validateEmail(v) {
  return EMAIL_RE.test(String(v ?? '').trim()) ? '' : '이메일 주소 형식이 올바르지 않습니다. 예: name@example.com 형식으로 입력해 주세요.';
}

export function normalizePhone(v) {
  return String(v ?? '').replace(/\D/g, '');
}

export function validatePhone(v) {
  return /^01\d{8,9}$/.test(normalizePhone(v)) ? '' : '휴대폰 번호 형식이 올바르지 않습니다. 010으로 시작하는 숫자 10자리 또는 11자리로 입력해 주세요.';
}

const q = (el, sel) => el.querySelector(sel);

function setFieldError(el, id, message) {
  const input = q(el, `#${id}`);
  if (input && input.dataset.baseDescribedby === undefined) input.dataset.baseDescribedby = input.getAttribute('aria-describedby') ?? '';
  const base = input?.dataset.baseDescribedby ?? '';
  let box = q(el, `#${id}-error`);
  if (!message) {
    box?.remove();
    input?.removeAttribute('aria-invalid');
    if (base) input?.setAttribute('aria-describedby', base);
    else input?.removeAttribute('aria-describedby');
    return;
  }
  if (!box) {
    box = document.createElement('p');
    box.id = `${id}-error`;
    box.className = 'field-error';
    input.closest('.field').append(box);
  }
  box.textContent = message;
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', [base, box.id].filter(Boolean).join(' '));
}

function showFormError(form, message) {
  let box = q(form, '.form-error');
  if (!box) {
    box = document.createElement('p');
    box.className = 'form-error';
    box.setAttribute('role', 'alert');
    form.prepend(box);
  }
  box.textContent = message;
}

function clearFormError(form) {
  q(form, '.form-error')?.remove();
}

const STEP_LABELS = ['계정 정보', '약관 동의', '연락처 입력'];

function stepper(current) {
  return `<ol class="steps" aria-label="가입 단계">${STEP_LABELS.map((label, i) => {
    const cls = i < current ? ' class="done"' : '';
    const cur = i === current ? ' aria-current="step"' : '';
    return `<li${cls}${cur}>${label}</li>`;
  }).join('')}</ol>`;
}

function shell(title, bodyHtml, lead = '') {
  return `<section class="container auth-wrap">
    <div class="auth-card panel">
      <div class="panel-body">
        <h1 class="auth-title" tabindex="-1">${title}</h1>
        ${lead ? `<p class="auth-lead">${lead}</p>` : ''}
        ${bodyHtml}
      </div>
    </div>
  </section>`;
}

function field(id, label, type, attrs = '') {
  return `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" name="${id}" type="${type}" ${attrs}></div>`;
}

// ---------- 가입 ----------

export function renderSignup(el, deps = {}) {
  const api = deps.api ?? defaultApi;
  const go = deps.go ?? ((h) => { window.location.hash = h; });
  const state = { email: '', password: '', marketing: false, signedUp: false };

  function focusTitle() {
    q(el, '.auth-title')?.focus();
  }

  function accountStep(focus = false) {
    el.innerHTML = shell('회원 가입', `
      ${stepper(0)}
      <form class="auth-form" novalidate>
        ${field('email', '이메일', 'email', 'autocomplete="email" inputmode="email" required')}
        ${field('password', '비밀번호', 'password', 'autocomplete="new-password" aria-describedby="password-hint" required')}
        <p class="field-hint" id="password-hint">영문과 숫자를 함께 8자 이상 입력해 주세요.</p>
        ${field('password2', '비밀번호 확인', 'password', 'autocomplete="new-password" required')}
        <button class="btn btn-primary btn-block" type="submit">다음</button>
      </form>
      <p class="auth-alt">이미 회원이신가요? <a href="#/login">로그인</a></p>`);
    q(el, '#email').value = state.email;
    if (focus) focusTitle();
    const form = q(el, 'form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = q(el, '#email').value.trim();
      const pw = q(el, '#password').value;
      const pw2 = q(el, '#password2').value;
      const eErr = validateEmail(email);
      const pErr = validatePassword(pw);
      const p2Err = !pErr && pw !== pw2 ? '비밀번호가 서로 다릅니다. 같은 비밀번호를 다시 입력해 주세요.' : '';
      setFieldError(el, 'email', eErr);
      setFieldError(el, 'password', pErr);
      setFieldError(el, 'password2', p2Err);
      if (eErr || pErr || p2Err) {
        q(el, '[aria-invalid="true"]')?.focus();
        return;
      }
      state.email = email;
      state.password = pw;
      consentStep();
    });
  }

  function consentStep() {
    el.innerHTML = shell('약관 동의', `
      ${stepper(1)}
      <div class="agree" id="step-consent">
        <label class="check all"><input type="checkbox" id="agree-all"><span>전체 동의</span></label>
        ${termRowHtml({ key: 'service', label: '[필수] 이용약관에 동의합니다.', inputAttrs: 'id="agree-terms" data-required' })}
        ${termRowHtml({ key: 'privacy', label: '[필수] 개인정보 수집과 이용에 동의합니다. 수집 항목은 이메일, 이름, 휴대폰 번호입니다.', inputAttrs: 'id="agree-privacy" data-required' })}
        <label class="check"><input type="checkbox" id="agree-marketing"><span>[선택] 공연과 강좌 소식 수신에 동의합니다.</span></label>
      </div>
      <div class="auth-actions">
        <button class="btn btn-secondary" type="button" id="consent-back">이전</button>
        <button class="btn btn-primary" type="button" id="consent-next" disabled>다음</button>
      </div>`);
    bindTermViews(q(el, '#step-consent'));
    const boxes = [...el.querySelectorAll('#step-consent input[type="checkbox"]:not(#agree-all)')];
    const all = q(el, '#agree-all');
    const next = q(el, '#consent-next');
    const sync = () => {
      next.disabled = !boxes.filter((b) => b.hasAttribute('data-required')).every((b) => b.checked);
      all.checked = boxes.every((b) => b.checked);
    };
    boxes.forEach((b) => b.addEventListener('change', sync));
    all.addEventListener('change', () => {
      boxes.forEach((b) => { b.checked = all.checked; });
      sync();
    });
    sync();
    q(el, '#consent-back').addEventListener('click', () => accountStep(true));
    next.addEventListener('click', () => {
      if (next.disabled) return;
      state.marketing = q(el, '#agree-marketing').checked;
      verifyStep();
    });
    focusTitle();
  }

  function verifyStep() {
    el.innerHTML = shell('연락처 입력', `
      ${stepper(2)}
      <form class="auth-form" id="step-verify" novalidate>
        ${field('name', '이름', 'text', 'autocomplete="name" required')}
        ${field('phone', '휴대폰 번호', 'tel', 'autocomplete="tel" inputmode="numeric" placeholder="01012345678" required')}
        <div class="auth-actions">
          <button class="btn btn-secondary" type="button" id="verify-back">이전</button>
          <button class="btn btn-primary" type="submit">입력 완료</button>
        </div>
      </form>`, '예매와 취소 안내를 받을 이름과 휴대폰 번호를 입력해 주세요.');
    q(el, '#verify-back').addEventListener('click', consentStep);
    bindContactForm(el, q(el, 'form'), async (name, phone) => {
      try {
        const session = await api.getSession();
        if (!session && !state.signedUp) {
          await api.signUp(state.email, state.password);
          state.signedUp = true;
        }
        await api.completeVerification(name, phone);
        if (state.marketing) await api.saveConsent?.({ marketing_opt_in: true }).catch(() => {});
        go('#/');
      } catch (err) {
        if (err.code === 'user_already_exists') state.signedUp = false;
        throw err;
      }
    });
    focusTitle();
  }

  accountStep();
}

/** 이름과 휴대폰 번호 입력 폼을 검사하고, 통과하면 onValid(name, phone) 을 부릅니다. 실패 오류는 폼 위에 보입니다. */
export function bindContactForm(el, form, onValid) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormError(form);
    const name = q(el, '#name').value.trim();
    const phone = normalizePhone(q(el, '#phone').value);
    const nErr = !name ? '이름을 입력해 주세요.' : name.length > 50 ? '이름은 50자까지 입력할 수 있습니다.' : '';
    const pErr = validatePhone(phone);
    setFieldError(el, 'name', nErr);
    setFieldError(el, 'phone', pErr);
    if (nErr || pErr) {
      q(el, '[aria-invalid="true"]')?.focus();
      return;
    }
    await withBusy(q(form, '[type="submit"]'), async () => {
      try {
        await onValid(name, phone);
      } catch (err) {
        showFormError(form, describeError(err));
      }
    });
  });
}

/** 연락처 입력(프로필)이 끝난 계정인지. 조회에 실패하면 막지 않고 null(모름)을 돌려줍니다. */
export async function hasContact(api) {
  try {
    const p = await api.getProfile();
    return Boolean(p?.verified_at);
  } catch {
    return null;
  }
}

export const contactHash = (next) => `#/signup/contact${next ? `?next=${encodeURIComponent(next)}` : ''}`;

// ---------- 연락처 입력 이어서 하기 ----------
// 가입(signUp)은 됐는데 연락처 입력이 실패한 계정이 다시 들어오면 여기서 마칩니다.

export async function renderCompleteContact(el, deps = {}) {
  const api = deps.api ?? defaultApi;
  const go = deps.go ?? ((h) => { window.location.hash = h; });
  const raw = deps.query?.get('next');
  const next = raw && raw.startsWith('#/') && !raw.startsWith('#/signup') ? raw : '#/';
  const session = await api.getSession();
  if (!session) {
    go(`#/login?next=${encodeURIComponent(contactHash(next === '#/' ? '' : next))}`);
    return;
  }
  if (await hasContact(api)) {
    go(next);
    return;
  }
  el.innerHTML = shell('연락처 입력', `
    ${stepper(2)}
    <form class="auth-form" id="step-verify" novalidate>
      ${field('name', '이름', 'text', 'autocomplete="name" required')}
      ${field('phone', '휴대폰 번호', 'tel', 'autocomplete="tel" inputmode="numeric" placeholder="01012345678" required')}
      <button class="btn btn-primary btn-block" type="submit">입력 완료</button>
    </form>`, '가입이 아직 끝나지 않았습니다. 예매와 취소 안내를 받을 이름과 휴대폰 번호를 입력해 주세요.');
  bindContactForm(el, q(el, 'form'), async (name, phone) => {
    await api.completeVerification(name, phone);
    go(next);
  });
  q(el, '.auth-title')?.focus();
}

// ---------- 로그인 ----------

export function renderLogin(el, deps = {}) {
  const api = deps.api ?? defaultApi;
  const go = deps.go ?? ((h) => { window.location.hash = h; });
  const next = deps.query?.get('next');
  el.innerHTML = shell('로그인', `
    <form class="auth-form" novalidate>
      ${field('email', '이메일', 'email', 'autocomplete="email" inputmode="email" required')}
      ${field('password', '비밀번호', 'password', 'autocomplete="current-password" required')}
      <button class="btn btn-primary btn-block" type="submit">로그인</button>
    </form>
    <p class="auth-alt"><a href="#/reset">비밀번호를 잊으셨나요?</a></p>
    <p class="auth-alt">아직 회원이 아니신가요? <a href="#/signup">회원 가입</a></p>`);
  const form = q(el, 'form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormError(form);
    const email = q(el, '#email').value.trim();
    const pw = q(el, '#password').value;
    const eErr = email ? '' : '이메일을 입력해 주세요.';
    const pErr = pw ? '' : '비밀번호를 입력해 주세요.';
    setFieldError(el, 'email', eErr);
    setFieldError(el, 'password', pErr);
    if (eErr || pErr) {
      q(el, '[aria-invalid="true"]')?.focus();
      return;
    }
    await withBusy(q(form, '[type="submit"]'), async () => {
      try {
        await api.signIn(email, pw);
        const target = next && next.startsWith('#/') ? next : '#/';
        // 연락처 입력을 마치지 못한 계정은 그 단계로 보냅니다(마친 뒤 원래 가려던 곳으로 갑니다).
        go(await hasContact(api) === false ? contactHash(target === '#/' ? '' : target) : target);
      } catch (err) {
        showFormError(form, describeError(err));
      }
    });
  });
}

// ---------- 비밀번호 재설정 ----------

export function renderReset(el, deps = {}) {
  const api = deps.api ?? defaultApi;
  el.innerHTML = shell('비밀번호 재설정', `
    <form class="auth-form" novalidate>
      ${field('email', '가입한 이메일', 'email', 'autocomplete="email" inputmode="email" required')}
      <button class="btn btn-primary btn-block" type="submit">재설정 메일 받기</button>
    </form>
    <p class="auth-alt"><a href="#/login">로그인으로 돌아가기</a></p>`, '가입한 이메일로 비밀번호를 다시 정하는 링크를 보내 드립니다.');
  const form = q(el, 'form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFormError(form);
    const email = q(el, '#email').value.trim();
    const eErr = validateEmail(email);
    setFieldError(el, 'email', eErr);
    if (eErr) {
      q(el, '#email').focus();
      return;
    }
    const btn = q(form, '[type="submit"]');
    let sent = false;
    await withBusy(btn, async () => {
      try {
        await api.resetPassword(email);
        sent = true;
      } catch (err) {
        showFormError(form, describeError(err));
      }
    });
    if (sent) {
      form.replaceChildren();
      const done = document.createElement('p');
      done.className = 'note info';
      done.setAttribute('role', 'status');
      done.textContent = '메일을 보냈습니다. 받은 편지함에서 링크를 열어 새 비밀번호를 정해 주세요. 메일이 보이지 않으면 스팸함을 확인해 주세요.';
      form.append(done);
    }
  });
}
