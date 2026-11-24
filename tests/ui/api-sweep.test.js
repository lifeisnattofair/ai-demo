import { describe, it, expect, vi, beforeEach } from 'vitest';

// 조회 경로가 기한 만료 처리를 먼저 부르는지(QA D-09)
const calls = [];
let session = { user: { id: 'u1' } };
const rpcMock = vi.fn(async (name) => {
  calls.push(name);
  return { data: name === 'sweep_due_offerings' ? 0 : [], error: null };
});
vi.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    rpc: (...a) => rpcMock(...a),
    auth: { getSession: async () => ({ data: { session } }) },
  },
  APP_ENV: 'local',
}));

const { api } = await import('../../src/lib/api.js');

beforeEach(() => {
  calls.length = 0;
  session = { user: { id: 'u1' } };
});

describe('기한 만료 처리(sweep_due_offerings)', () => {
  it('내 대기 신청과 알림 조회 전에 먼저 부른다', async () => {
    await api.myWaitlist();
    expect(calls).toEqual(['sweep_due_offerings', 'my_waitlist_overview']);
    calls.length = 0;
    await api.myNotifications();
    expect(calls).toEqual(['sweep_due_offerings', 'my_notifications']);
  });

  it('비회원이면 부르지 않고, 실패해도 조회는 이어 간다', async () => {
    session = null;
    await api.myWaitlist();
    expect(calls).toEqual(['my_waitlist_overview']);
    session = { user: { id: 'u1' } };
    calls.length = 0;
    rpcMock.mockImplementationOnce(async (name) => { calls.push(name); return { data: null, error: { message: 'boom' } }; });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(api.myWaitlist()).resolves.toEqual([]);
    expect(calls).toEqual(['sweep_due_offerings', 'my_waitlist_overview']);
    err.mockRestore();
  });
});
