// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validatePassword, renderSignup, renderLogin, renderCompleteContact } from '../../src/user/pages/auth.js';
import { messageFor } from '../../src/lib/api.js';

const PW_MSG = '비밀번호는 영문과 숫자를 함께 8자 이상 입력해 주세요.';

function fakeApi(over = {}) {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    signUp: vi.fn().mockResolvedValue({ user: { id: 'u1' } }),
    signIn: vi.fn().mockResolvedValue({ user: { id: 'u1' } }),
    completeVerification: vi.fn().mockResolvedValue({ id: 'u1', name: '김지원' }),
    resetPassword: vi.fn().mockResolvedValue({}),
    getProfile: vi.fn().mockResolvedValue({ id: 'u1', name: '김지원', phone: '01012345678', verified_at: '2026-11-20T00:00:00Z' }),
    ...over,
  };
}

function type(el, selector, value) {
  const input = el.querySelector(selector);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function submit(el) {
  el.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

function fillAccount(el, pw = 'abc12345') {
  type(el, '#email', 'a@example.com');
  type(el, '#password', pw);
  type(el, '#password2', pw);
  submit(el);
}

describe('validatePassword', () => {
  it('abc12345 통과', () => expect(validatePassword('abc12345')).toBe(''));
  it('abcdefgh 거절', () => expect(validatePassword('abcdefgh')).toBe(PW_MSG));
  it('12345678 거절', () => expect(validatePassword('12345678')).toBe(PW_MSG));
  it('짧으면 거절', () => expect(validatePassword('abc1234')).toBe(PW_MSG));
});

describe('가입 폼', () => {
  let el;
  beforeEach(() => {
    el = document.createElement('main');
    document.body.replaceChildren(el);
  });

  it('약한 비밀번호는 안내 문구를 보이고 다음 단계로 가지 않습니다', () => {
    renderSignup(el, { api: fakeApi(), go: vi.fn() });
    fillAccount(el, 'abcdefgh');
    expect(el.querySelector('#password-error').textContent).toBe(PW_MSG);
    expect(el.querySelector('#step-consent')).toBeNull();
  });

  it('비밀번호 안내와 오류가 모두 입력칸에 연결됩니다', () => {
    renderSignup(el, { api: fakeApi(), go: vi.fn() });
    expect(el.querySelector('#password').getAttribute('aria-describedby')).toBe('password-hint');
    fillAccount(el, 'abcdefgh');
    expect(el.querySelector('#password').getAttribute('aria-describedby')).toBe('password-hint password-error');
    fillAccount(el);
    expect(el.querySelector('#step-consent')).not.toBeNull();
  });

  it('이전 단계로 돌아가면 제목에 초점이 갑니다', () => {
    renderSignup(el, { api: fakeApi(), go: vi.fn() });
    fillAccount(el);
    el.querySelector('#consent-back').click();
    expect(document.activeElement).toBe(el.querySelector('.auth-title'));
  });

  it('abc12345 는 약관 단계로 넘어갑니다', () => {
    renderSignup(el, { api: fakeApi(), go: vi.fn() });
    fillAccount(el);
    expect(el.querySelector('#step-consent')).not.toBeNull();
  });

  it('필수 동의를 하지 않으면 제출 버튼이 비활성입니다', () => {
    renderSignup(el, { api: fakeApi(), go: vi.fn() });
    fillAccount(el);
    const btn = el.querySelector('#consent-next');
    expect(btn.disabled).toBe(true);
    el.querySelector('#agree-terms').click();
    expect(btn.disabled).toBe(true);
    el.querySelector('#agree-privacy').click();
    expect(btn.disabled).toBe(false);
    el.querySelector('#agree-terms').click();
    expect(btn.disabled).toBe(true);
  });

  it('전체 동의는 모든 항목을 함께 바꿉니다', () => {
    renderSignup(el, { api: fakeApi(), go: vi.fn() });
    fillAccount(el);
    el.querySelector('#agree-all').click();
    expect(el.querySelector('#agree-terms').checked).toBe(true);
    expect(el.querySelector('#agree-marketing').checked).toBe(true);
    expect(el.querySelector('#consent-next').disabled).toBe(false);
  });

  it('필수 약관에는 보기 버튼이 있고, 누르면 본문 대화상자가 열리며 체크는 그대로입니다', () => {
    renderSignup(el, { api: fakeApi(), go: vi.fn() });
    fillAccount(el);
    const views = [...el.querySelectorAll('#step-consent [data-term-view]')];
    expect(views.map((b) => b.dataset.termView)).toEqual(['service', 'privacy']);
    views[1].click();
    const dlg = document.querySelector('[role="dialog"]');
    expect(dlg.querySelector('h2').textContent).toBe('개인정보 수집과 이용');
    expect(dlg.textContent).toContain('이메일, 이름, 휴대폰 번호');
    expect(el.querySelector('#agree-privacy').checked).toBe(false);
    dlg.querySelector('button').click();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('3단계는 연락처 입력이고 인증을 한 것처럼 보이는 문구가 없습니다', () => {
    renderSignup(el, { api: fakeApi(), go: vi.fn() });
    fillAccount(el);
    el.querySelector('#agree-all').click();
    el.querySelector('#consent-next').click();
    expect(el.querySelector('.auth-title').textContent).toBe('연락처 입력');
    expect(el.querySelector('[type="submit"]').textContent).toBe('입력 완료');
    expect(el.querySelector('.steps').textContent).not.toContain('인증');
    expect(el.textContent).not.toMatch(/인증/);
  });

  it('입력 완료 시 가입과 연락처 저장을 순서대로 호출합니다', async () => {
    const api = fakeApi();
    const go = vi.fn();
    renderSignup(el, { api, go });
    fillAccount(el);
    el.querySelector('#agree-all').click();
    el.querySelector('#consent-next').click();
    type(el, '#name', '김지원');
    type(el, '#phone', '010-1234-5678');
    submit(el);
    await new Promise((r) => setTimeout(r, 10));
    expect(api.signUp).toHaveBeenCalledWith('a@example.com', 'abc12345');
    expect(api.completeVerification).toHaveBeenCalledWith('김지원', '01012345678');
    expect(go).toHaveBeenCalledWith('#/');
  });
});

describe('로그인 폼', () => {
  it('실패 시 원인과 다음 행동을 안내합니다', async () => {
    const el = document.createElement('main');
    document.body.replaceChildren(el);
    const err = Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials' });
    const api = fakeApi({ signIn: vi.fn().mockRejectedValue(err) });
    renderLogin(el, { api, go: vi.fn(), query: new URLSearchParams() });
    type(el, '#email', 'a@example.com');
    type(el, '#password', 'abc12345');
    submit(el);
    await new Promise((r) => setTimeout(r, 10));
    expect(el.querySelector('[role="alert"]').textContent).toContain('이메일 또는 비밀번호가 맞지 않습니다.');
  });

  async function login(api, next) {
    const el = document.createElement('main');
    document.body.replaceChildren(el);
    const go = vi.fn();
    renderLogin(el, { api, go, query: new URLSearchParams(next ? { next } : {}) });
    type(el, '#email', 'a@example.com');
    type(el, '#password', 'abc12345');
    submit(el);
    await new Promise((r) => setTimeout(r, 10));
    return go;
  }

  it('연락처 입력을 마친 계정은 원래 가려던 곳으로 갑니다', async () => {
    expect(await login(fakeApi(), '#/me/bookings')).toHaveBeenCalledWith('#/me/bookings');
  });

  it('프로필이 없는 계정(가입 중 연락처 입력 실패)은 연락처 입력 단계로 보내고 돌아올 곳을 남깁니다', async () => {
    const api = fakeApi({ getProfile: vi.fn().mockResolvedValue(null) });
    expect(await login(api, '#/booking/o1/select')).toHaveBeenCalledWith(`#/signup/contact?next=${encodeURIComponent('#/booking/o1/select')}`);
    expect(await login(api)).toHaveBeenCalledWith('#/signup/contact');
  });

  it('프로필 조회가 실패하면 막지 않고 그대로 이동합니다', async () => {
    const api = fakeApi({ getProfile: vi.fn().mockRejectedValue(new Error('net')) });
    expect(await login(api)).toHaveBeenCalledWith('#/');
  });
});

describe('연락처 입력 이어서 하기(#/signup/contact)', () => {
  let el;
  beforeEach(() => {
    el = document.createElement('main');
    document.body.replaceChildren(el);
  });

  it('로그인하지 않았으면 로그인으로 보냅니다', async () => {
    const go = vi.fn();
    await renderCompleteContact(el, { api: fakeApi(), go, query: new URLSearchParams() });
    expect(go).toHaveBeenCalledWith(`#/login?next=${encodeURIComponent('#/signup/contact')}`);
  });

  it('이미 연락처가 있으면 다음 주소로 바로 갑니다', async () => {
    const go = vi.fn();
    const api = fakeApi({ getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }) });
    await renderCompleteContact(el, { api, go, query: new URLSearchParams({ next: '#/account' }) });
    expect(go).toHaveBeenCalledWith('#/account');
  });

  it('프로필이 없으면 이름과 번호를 받아 complete_mock_verification 후 다음 주소로 갑니다', async () => {
    const go = vi.fn();
    const api = fakeApi({ getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }), getProfile: vi.fn().mockResolvedValue(null) });
    await renderCompleteContact(el, { api, go, query: new URLSearchParams({ next: '#/booking/o1/select' }) });
    expect(el.querySelector('h1').textContent).toBe('연락처 입력');
    type(el, '#name', '김지원');
    type(el, '#phone', '010-1234-5678');
    submit(el);
    await new Promise((r) => setTimeout(r, 10));
    expect(api.completeVerification).toHaveBeenCalledWith('김지원', '01012345678');
    expect(go).toHaveBeenCalledWith('#/booking/o1/select');
  });

  it('외부 주소나 가입 주소는 next 로 쓰지 않습니다', async () => {
    const go = vi.fn();
    const api = fakeApi({ getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }) });
    await renderCompleteContact(el, { api, go, query: new URLSearchParams({ next: 'https://evil.example' }) });
    expect(go).toHaveBeenCalledWith('#/');
  });
});

describe('messageFor', () => {
  it('오류 코드를 안내 문구로 바꿉니다', () => {
    expect(messageFor('SEAT_TAKEN')).toBe('방금 다른 분이 선택한 좌석입니다. 다른 좌석을 선택해 주세요.');
    expect(messageFor('LIMIT_EXCEEDED')).toBe('1인 예약 한도를 넘었습니다. 남은 매수 안에서 선택해 주세요.');
    expect(messageFor('SOLD_OUT')).toBe('매진되었습니다. 대기 신청을 하실 수 있습니다.');
    expect(messageFor('???')).toBe('요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  });
});
