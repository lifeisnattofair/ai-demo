// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderAccount, isLockedDemoAccount } from '../../src/user/pages/account.js';
import { ApiError } from '../../src/lib/api.js';

const LOCKED = '시연용 계정은 변경할 수 없습니다. 새 계정을 만들어 사용해 주세요.';

function fakeApi(over = {}) {
  return {
    getSession: vi.fn().mockResolvedValue({ user: { id: 'u1', email: 'kim@example.com' } }),
    getProfile: vi.fn().mockResolvedValue({ id: 'u1', name: '김지원', phone: '01012345678', verified_at: '2026-11-20T00:00:00Z' }),
    updateContact: vi.fn().mockImplementation(async (name, phone) => ({ id: 'u1', name, phone, verified_at: '2026-11-20T00:00:00Z' })),
    updatePassword: vi.fn().mockResolvedValue({}),
    withdraw: vi.fn().mockResolvedValue(null),
    signOut: vi.fn().mockResolvedValue(null),
    ...over,
  };
}

let el;
beforeEach(() => {
  el = document.createElement('main');
  document.body.replaceChildren(el);
});
const flush = () => new Promise((r) => setTimeout(r, 10));
function type(selector, value) {
  el.querySelector(selector).value = value;
}
function submit(form) {
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

describe('내 정보(SFR-002)', () => {
  it('이름과 휴대폰 번호를 고치면 update_my_contact 를 부르고 완료를 알립니다', async () => {
    const api = fakeApi();
    await renderAccount(el, { api, go: vi.fn(), env: 'local' });
    expect(el.querySelector('#name').value).toBe('김지원');
    expect(el.querySelector('#email-hint').textContent).toContain('이메일은 로그인 아이디라 바꿀 수 없습니다.');
    type('#name', ' 김지원B ');
    type('#phone', '010-9999-8888');
    submit(el.querySelector('#contact-form'));
    await flush();
    expect(api.updateContact).toHaveBeenCalledWith('김지원B', '01099998888');
    expect(el.querySelector('#contact-form [role="status"]').textContent).toBe('회원 정보를 수정했습니다.');
    expect(el.querySelector('#name').value).toBe('김지원B');
  });

  it('잘못된 번호는 보내지 않고 입력칸에 안내합니다', async () => {
    const api = fakeApi();
    await renderAccount(el, { api, go: vi.fn(), env: 'local' });
    type('#phone', '123');
    submit(el.querySelector('#contact-form'));
    await flush();
    expect(api.updateContact).not.toHaveBeenCalled();
    expect(el.querySelector('#phone').getAttribute('aria-invalid')).toBe('true');
  });

  it('성공 뒤 잘못된 번호로 다시 저장하면 이전 성공 안내를 지우고 오류만 보입니다(D-10)', async () => {
    const api = fakeApi();
    await renderAccount(el, { api, go: vi.fn(), env: 'local' });
    const form = el.querySelector('#contact-form');
    submit(form);
    await flush();
    expect(form.querySelector('[role="status"]').textContent).toBe('회원 정보를 수정했습니다.');
    type('#phone', '12345');
    submit(form);
    await flush();
    expect(el.querySelector('#phone').getAttribute('aria-invalid')).toBe('true');
    expect(form.textContent).not.toContain('회원 정보를 수정했습니다.');
    type('#phone', '01099990000');
    submit(form);
    await flush();
    expect(el.querySelector('#phone').getAttribute('aria-invalid')).not.toBe('true');
    expect(form.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(form.querySelector('[role="status"]').textContent).toBe('회원 정보를 수정했습니다.');
  });

  it('서버 거절(DEMO_ACCOUNT_LOCKED)은 원인과 다음 행동으로 안내합니다', async () => {
    const api = fakeApi({ updateContact: vi.fn().mockRejectedValue(new ApiError('DEMO_ACCOUNT_LOCKED')) });
    await renderAccount(el, { api, go: vi.fn(), env: 'local' });
    submit(el.querySelector('#contact-form'));
    await flush();
    expect(el.querySelector('#contact-form [role="alert"]').textContent).toBe(LOCKED);
  });

  it('프로필이 없으면 연락처 입력 단계로 가는 버튼을 보입니다', async () => {
    await renderAccount(el, { api: fakeApi({ getProfile: vi.fn().mockResolvedValue(null) }), go: vi.fn(), env: 'local' });
    expect(el.querySelector('#contact-form')).toBeNull();
    const link = [...el.querySelectorAll('a')].find((a) => a.textContent === '연락처 입력하기');
    expect(link.getAttribute('href')).toBe(`#/signup/contact?next=${encodeURIComponent('#/account')}`);
  });
});

describe('공개 시연의 시연 계정(I3)', () => {
  it('isLockedDemoAccount 는 demo 의 시드 계정만 참입니다', () => {
    expect(isLockedDemoAccount('demo', 'Member1@demo.test')).toBe(true);
    expect(isLockedDemoAccount('demo', 'finance@demo.test')).toBe(true);
    expect(isLockedDemoAccount('local', 'member1@demo.test')).toBe(false);
    expect(isLockedDemoAccount('demo', 'kim@example.com')).toBe(false);
    expect(isLockedDemoAccount('demo', 'other@demo.test')).toBe(false);
  });

  it('demo 에서 시드 계정은 연락처 수정, 비밀번호 변경, 탈퇴를 감추고 이유를 알립니다', async () => {
    const api = fakeApi({ getSession: vi.fn().mockResolvedValue({ user: { id: 'u1', email: 'member1@demo.test' } }) });
    await renderAccount(el, { api, go: vi.fn(), env: 'demo' });
    expect(el.querySelector('[data-demo-locked]').textContent).toBe(LOCKED);
    expect(el.querySelector('#contact-form')).toBeNull();
    expect(el.querySelector('#pw-form')).toBeNull();
    expect(el.querySelector('#withdraw-open')).toBeNull();
    expect(el.querySelector('#logout')).not.toBeNull();
    expect(el.querySelector('.profile-list').textContent).toContain('김지원');
  });

  it('demo 라도 새로 가입한 계정은 모두 쓸 수 있습니다', async () => {
    await renderAccount(el, { api: fakeApi(), go: vi.fn(), env: 'demo' });
    expect(el.querySelector('[data-demo-locked]')).toBeNull();
    expect(el.querySelector('#contact-form')).not.toBeNull();
    expect(el.querySelector('#pw-form')).not.toBeNull();
    expect(el.querySelector('#withdraw-open')).not.toBeNull();
  });
});
