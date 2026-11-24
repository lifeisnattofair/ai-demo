// 검수용 시계, 시연 데이터 초기화, 작업 이력, 환경 분리(0013_system.sql)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminClient, resetDb, userClient } from './helpers.js';

const db = adminClient();
const DAY = 86400000;
const BASE = new Date(Date.now() + DAY).toISOString();
let op;
let fin;
let member;

const code = async (p) => (await p).error?.message ?? null;
async function ok(p) {
  const { data, error } = await p;
  expect(error).toBeNull();
  return data;
}
const setEnv = (env) => db.from('app_settings').upsert([{ key: 'env', value: env }]);
const setting = async (key) => (await db.from('app_settings').select('value').eq('key', key).single()).data.value;
const clockNow = async (c) => Date.parse(await ok(c.rpc('app_now')));

beforeAll(async () => {
  op = await userClient('operator@demo.test');
  fin = await userClient('finance@demo.test');
  member = await userClient('member1@demo.test');
});
beforeEach(async () => {
  await resetDb(BASE);
  await setEnv('qa');
});
afterAll(async () => {
  await setEnv('local');
  await resetDb(BASE);
});

describe('검수용 시계(admin_set_clock)', () => {
  it('qa 에서 운영 담당이 설정하면 app_now 가 앞서고 작업 이력에 남습니다', async () => {
    const before = Date.now();
    const st = await ok(op.rpc('admin_set_clock', { p_offset_ms: DAY }));
    expect(st).toMatchObject({ env: 'qa', enabled: true, offsetMs: DAY });
    const diff = (await clockNow(op)) - before;
    expect(diff).toBeGreaterThanOrEqual(DAY - 1000);
    expect(diff).toBeLessThan(DAY + 30000);
    const log = await ok(db.from('admin_audit').select('*').eq('action', 'CLOCK_SET'));
    expect(log).toHaveLength(1);
    expect(log[0].detail).toMatchObject({ from: 0, to: DAY });
  });

  it('0 으로 되돌리면 실제 시각입니다', async () => {
    await ok(op.rpc('admin_set_clock', { p_offset_ms: DAY }));
    const st = await ok(op.rpc('admin_set_clock', { p_offset_ms: 0 }));
    expect(st.offsetMs).toBe(0);
    expect(Math.abs((await clockNow(op)) - Date.now())).toBeLessThan(30000);
  });

  it('demo 에서는 NOT_ALLOWED_IN_ENV 이고, 저장된 오프셋이 있어도 app_now 가 무시합니다', async () => {
    await setEnv('demo');
    expect(await code(op.rpc('admin_set_clock', { p_offset_ms: DAY }))).toBe('NOT_ALLOWED_IN_ENV');
    await db.from('app_settings').upsert([{ key: 'clock_enabled', value: true }, { key: 'clock_offset_ms', value: 5 * DAY }]);
    expect(Math.abs((await clockNow(op)) - Date.now())).toBeLessThan(30000);
    expect(await ok(op.rpc('staff_clock'))).toMatchObject({ env: 'demo', enabled: false, offsetMs: 0 });
  });

  it('local 에서는 시계와 초기화를 모두 쓸 수 있습니다', async () => {
    await setEnv('local');
    await ok(op.rpc('admin_set_clock', { p_offset_ms: 600000 }));
    await ok(op.rpc('admin_reset_demo'));
  });

  it('정산 담당과 회원은 설정하지 못하고, 값이 잘못되면 거부합니다', async () => {
    expect(await code(fin.rpc('admin_set_clock', { p_offset_ms: DAY }))).toBe('FORBIDDEN');
    expect(await code(member.rpc('admin_set_clock', { p_offset_ms: DAY }))).toBe('FORBIDDEN');
    expect(await code(op.rpc('admin_set_clock', { p_offset_ms: 400 * DAY }))).toBe('INVALID_REQUEST');
    expect(await setting('clock_offset_ms')).toBe(0);
  });

  it('staff_clock 은 담당자만 읽습니다', async () => {
    expect(await ok(fin.rpc('staff_clock'))).toMatchObject({ env: 'qa' });
    expect(await code(member.rpc('staff_clock'))).toBe('FORBIDDEN');
  });
});

describe('시연 데이터 초기화(admin_reset_demo)', () => {
  it('qa 에서는 NOT_ALLOWED_IN_ENV 이고 데이터가 그대로입니다', async () => {
    const before = await ok(db.from('offerings').select('id'));
    expect(await code(op.rpc('admin_reset_demo'))).toBe('NOT_ALLOWED_IN_ENV');
    expect((await ok(db.from('offerings').select('id'))).map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
  });

  it('정산 담당과 회원은 실행하지 못합니다', async () => {
    await setEnv('demo');
    expect(await code(fin.rpc('admin_reset_demo'))).toBe('FORBIDDEN');
    expect(await code(member.rpc('admin_reset_demo'))).toBe('FORBIDDEN');
  });

  it('demo 에서 예약, 대기, 알림이 지워지고 회차 일정이 app_now 기준으로 다시 만들어집니다', async () => {
    await setEnv('demo');
    const { data: u } = await member.auth.getUser();
    await db.from('notifications').insert({ user_id: u.user.id, kind: 'X', title: '남은 알림' });
    const { data: first } = await db.from('offerings').select('starts_at').order('starts_at').limit(1);
    await ok(op.rpc('admin_reset_demo'));
    for (const t of ['bookings', 'booking_items', 'holds', 'waitlist', 'notifications', 'payments', 'pg_mock_transactions']) {
      const { count } = await db.from(t).select('*', { count: 'exact', head: true });
      expect(count, t).toBe(0);
    }
    const { count: offerings } = await db.from('offerings').select('*', { count: 'exact', head: true });
    expect(offerings).toBeGreaterThan(0);
    // 초기화는 app_now 의 KST 날짜 자정을 기준으로 시드의 고정 시각(체험 14:00)을 씁니다(QA D-08).
    const { data: after } = await db.from('offerings').select('starts_at').order('starts_at').limit(1);
    const kstMidnight = Date.parse(`${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)}T00:00:00+09:00`);
    expect(Date.parse(after[0].starts_at)).toBe(kstMidnight + 5 * DAY + 14 * 3600000);
    expect(first[0].starts_at).not.toBe(after[0].starts_at);
    // 계정은 그대로입니다.
    expect((await ok(op.from('profiles').select('role').eq('id', (await op.auth.getUser()).data.user.id).single())).role).toBe('operator');
    await userClient('member2@demo.test');
    expect(await setting('env')).toBe('demo');
  });

  it('시연 계정이 바뀌었으면(비밀번호, 연락처, 탈퇴) 초기화가 시드 상태로 되돌립니다', async () => {
    // local 에서는 보호가 없으므로 member3 을 망가뜨린 뒤 demo 로 바꿔 초기화합니다.
    await setEnv('local');
    const m3 = await userClient('member3@demo.test');
    const id = (await m3.auth.getUser()).data.user.id;
    try {
      expect((await m3.auth.updateUser({ password: 'Changed-9999' })).error).toBeNull();
      await ok(m3.rpc('update_my_contact', { p_name: '바뀐 이름', p_phone: '01077778888' }));
      await ok(m3.rpc('withdraw_member'));
      await expect(userClient('member3@demo.test')).rejects.toThrow();

      await setEnv('demo');
      await ok(op.rpc('admin_reset_demo'));
      const back = await userClient('member3@demo.test'); // 시드 비밀번호로 다시 로그인됩니다.
      expect((await back.auth.getUser()).data.user.id).toBe(id);
      expect((await ok(db.from('profiles').select('name, phone, role, verified_at').eq('id', id).single())))
        .toMatchObject({ name: '회원 셋', phone: '010-0000-0003', role: 'member' });
      expect((await ok(db.from('profiles').select('verified_at').eq('id', id).single())).verified_at).toBeTruthy();
      const rows = await ok(op.rpc('staff_audit', { p_action: 'RESET_DEMO' }));
      expect(rows[0].detail).toMatchObject({ env: 'demo', accounts: 5 });
    } finally {
      await db.rpc('restore_demo_accounts');
    }
  });

  it('초기화 기록이 작업 이력에 남습니다', async () => {
    await setEnv('demo');
    await ok(op.rpc('admin_reset_demo'));
    const rows = await ok(op.rpc('staff_audit', { p_action: 'RESET_DEMO' }));
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toMatchObject({ env: 'demo' });
  });
});

describe('작업 이력(staff_audit)', () => {
  it('운영, 정산 담당이 읽고 작업자 이름은 가려서 돌려줍니다', async () => {
    await ok(op.rpc('admin_set_clock', { p_offset_ms: 600000 }));
    const rows = await ok(fin.rpc('staff_audit'));
    expect(rows[0]).toMatchObject({ action: 'CLOCK_SET', actor_role: 'operator' });
    const { data: p } = await db.from('profiles').select('name').eq('role', 'operator').limit(1).single();
    expect(rows[0].actor_name_masked).not.toBe(p.name);
    expect(rows[0].actor_name_masked).toContain('*');
    expect(await code(member.rpc('staff_audit'))).toBe('FORBIDDEN');
  });

  it('기간, 작업자, 작업 종류로 거릅니다', async () => {
    await ok(op.rpc('admin_set_clock', { p_offset_ms: 600000 }));
    await ok(op.rpc('admin_set_clock', { p_offset_ms: 0 }));
    expect(await ok(op.rpc('staff_audit', { p_action: 'CLOCK_SET' }))).toHaveLength(2);
    expect(await ok(op.rpc('staff_audit', { p_action: 'NOPE' }))).toHaveLength(0);
    const actor = (await op.auth.getUser()).data.user.id;
    expect(await ok(op.rpc('staff_audit', { p_actor: actor }))).toHaveLength(2);
    expect(await ok(op.rpc('staff_audit', { p_actor: (await fin.auth.getUser()).data.user.id }))).toHaveLength(0);
    const future = new Date(Date.now() + 3600000).toISOString();
    expect(await ok(op.rpc('staff_audit', { p_from: future }))).toHaveLength(0);
    expect(await ok(op.rpc('staff_audit', { p_to: future }))).toHaveLength(2);
  });
});
