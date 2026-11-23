import { describe, it, expect, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('../../src/lib/supabase.js', () => ({
  supabase: { functions: { invoke: (...a) => invokeMock(...a) } },
  APP_ENV: 'local',
}));

const { api, messageFor } = await import('../../src/lib/api.js');

const failWith = (payload) => invokeMock.mockResolvedValueOnce({ data: null, error: { context: { json: async () => payload } } });

describe('DB 오류 코드', () => {
  it('프로필 없는 계정의 선점/대기 FK 오류는 PROFILE_REQUIRED 로 바꿉니다', async () => {
    const { fromDbError } = await import('../../src/lib/api.js');
    const e = fromDbError({ message: 'insert or update on table "holds" violates foreign key constraint "holds_user_id_fkey"' });
    expect(e.code).toBe('PROFILE_REQUIRED');
    expect(e.message).toContain('연락처 입력이 끝나지 않았습니다');
    expect(fromDbError({ message: 'DEMO_ACCOUNT_LOCKED' }).message).toBe(messageFor('DEMO_ACCOUNT_LOCKED'));
    expect(messageFor('DEMO_ACCOUNT_LOCKED')).toBe('시연용 계정은 변경할 수 없습니다. 새 계정을 만들어 사용해 주세요.');
  });
});

describe('Edge Function 오류 문구', () => {
  it('함수가 돌려준 한국어 안내는 그대로 쓴다', async () => {
    failWith({ code: 'AMOUNT_MISMATCH', message: '금액이 달라 결제를 진행하지 못했습니다.' });
    await expect(api.confirmPayment('k', 'o', 1)).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH', message: '금액이 달라 결제를 진행하지 못했습니다.' });
  });

  it('영어 원문(실행 환경 오류)은 화면에 보이지 않고 정해 둔 한국어 안내로 바꾼다', async () => {
    failWith({ code: 'BOOT_ERROR', message: 'Worker failed to boot (please check logs)' });
    await expect(api.confirmPayment('k', 'o', 1)).rejects.toMatchObject({ code: 'BOOT_ERROR', message: messageFor('BOOT_ERROR') });
  });
});
