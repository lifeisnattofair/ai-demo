// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validatePassword, renderSignup, renderLogin } from '../../src/user/pages/auth.js';
import { messageFor } from '../../src/lib/api.js';

const PW_MSG = '비밀번호는 영문과 숫자를 함께 8자 이상 입력해 주세요.';

function fakeApi(over = {}) {
  return {
    getSession: vi.fn().mockResolvedValue(null),
    signUp: vi.fn().mockResolvedValue({ user: { id: 'u1' } }),
    signIn: vi.fn().mockResolvedValue({ user: { id: 'u1' } }),
    completeVerification: vi.fn().mockResolvedValue({ id: 'u1', name: '김지원' }),
    resetPassword: vi.fn().mockResolvedValue({}),
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

  it('인증 완료 시 가입과 본인 확인을 순서대로 호출합니다', async () => {
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
});

describe('messageFor', () => {
  it('오류 코드를 안내 문구로 바꿉니다', () => {
    expect(messageFor('SEAT_TAKEN')).toBe('방금 다른 분이 선택한 좌석입니다. 다른 좌석을 선택해 주세요.');
    expect(messageFor('LIMIT_EXCEEDED')).toBe('1인 예약 한도를 넘었습니다. 남은 매수 안에서 선택해 주세요.');
    expect(messageFor('SOLD_OUT')).toBe('매진되었습니다. 대기 신청을 하실 수 있습니다.');
    expect(messageFor('???')).toBe('요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  });
});
