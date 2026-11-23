import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, adminClient, userClient } from './helpers.js';

// auth 스키마는 Data API 로 읽을 수 없어 DB 컨테이너의 psql 을 씁니다(없으면 해당 검사만 건너뜀).
const DB_CONTAINER = `supabase_db_${readFileSync('supabase/config.toml', 'utf8').match(/^project_id = "(.+)"/m)[1]}`;
const psql = (sql) => {
  try {
    return execFileSync('docker', ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
  } catch { return null; }
};
const dockerOk = psql('select 1') === '1';

const admin = adminClient();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const created = [];
const stamp = Date.now();

async function newMember(tag) {
  const email = `member-${tag}-${stamp}@example.com`;
  const c = createClient(process.env.API_URL, process.env.ANON_KEY, opts);
  const { data, error } = await c.auth.signUp({ email, password: DEMO_PASSWORD });
  if (error) throw error;
  created.push(data.user.id);
  return { c, email, id: data.user.id };
}

afterAll(async () => {
  for (const id of created) {
    await admin.from('profiles').delete().eq('id', id);
    if (dockerOk) psql(`delete from auth.users where id = '${id}'`);
    else await admin.auth.admin.deleteUser(id).catch(() => {});
  }
});

describe('complete_mock_verification', () => {
  it('프로필을 만들고 verified_at 을 기록하며 role 은 member 입니다', async () => {
    const { c, id } = await newMember('v');
    const { data, error } = await c.rpc('complete_mock_verification', { p_name: ' 김지원 ', p_phone: '010-1234-5678' });
    expect(error).toBeNull();
    expect(data).toMatchObject({ id, name: '김지원', phone: '01012345678', role: 'member' });
    expect(data.verified_at).toBeTruthy();
  });

  it('잘못된 전화번호와 이름은 거절합니다', async () => {
    const { c } = await newMember('bad');
    expect((await c.rpc('complete_mock_verification', { p_name: '김', p_phone: '123' })).error.message).toBe('INVALID_PHONE');
    expect((await c.rpc('complete_mock_verification', { p_name: ' ', p_phone: '01012345678' })).error.message).toBe('INVALID_NAME');
  });

  it('로그인하지 않으면 거절합니다', async () => {
    const anon = createClient(process.env.API_URL, process.env.ANON_KEY, opts);
    const { error } = await anon.rpc('complete_mock_verification', { p_name: '김', p_phone: '01012345678' });
    expect(error).not.toBeNull();
  });
});

describe('withdraw_member', () => {
  it('개인정보를 비우고 로그인 수단, 세션을 지우며 이후 회원 RPC를 막습니다', async () => {
    const { c, id, email } = await newMember('w');
    await c.rpc('complete_mock_verification', { p_name: '김지원', p_phone: '01012345678' });
    const { error } = await c.rpc('withdraw_member');
    expect(error).toBeNull();

    const { data: p } = await admin.from('profiles').select('name, phone, verified_at').eq('id', id).single();
    expect(p).toEqual({ name: '탈퇴한 회원', phone: null, verified_at: null });
    if (dockerOk) {
      expect(psql(`select count(*) from auth.identities where user_id = '${id}'`)).toBe('0');
      expect(psql(`select count(*) from auth.sessions where user_id = '${id}'`)).toBe('0');
      expect(psql(`select count(*) from auth.refresh_tokens where user_id = '${id}'`)).toBe('0');
      expect(psql(`select email <> '${email}' and banned_until > now() + interval '100 years' from auth.users where id = '${id}'`)).toBe('t');
    }

    // 아직 유효한 토큰으로도 프로필을 되살릴 수 없습니다.
    const again = await c.rpc('complete_mock_verification', { p_name: '재가입', p_phone: '01099998888' });
    expect(again.error.message).toBe('UNAUTHENTICATED');
    const { data: p2 } = await admin.from('profiles').select('name, phone').eq('id', id).single();
    expect(p2).toEqual({ name: '탈퇴한 회원', phone: null });
    expect((await c.rpc('withdraw_member')).error.message).toBe('UNAUTHENTICATED');
  });

  it('탈퇴 뒤 같은 이메일로 다시 가입할 수 있습니다', async () => {
    const { c, email } = await newMember('re');
    await c.rpc('complete_mock_verification', { p_name: '김지원', p_phone: '01012345678' });
    expect((await c.rpc('withdraw_member')).error).toBeNull();

    const c2 = createClient(process.env.API_URL, process.env.ANON_KEY, opts);
    const { data, error } = await c2.auth.signUp({ email, password: DEMO_PASSWORD });
    expect(error).toBeNull();
    created.push(data.user.id);
    expect(data.session).toBeTruthy();
    const ok = await c2.rpc('complete_mock_verification', { p_name: '새 회원', p_phone: '01022223333' });
    expect(ok.error).toBeNull();
  });
});

// I2(SFR-002): 내 정보에서 이름과 휴대폰 번호 수정
describe('update_my_contact', () => {
  it('본인 이름과 번호만 바꾸고 role, verified_at 은 그대로입니다', async () => {
    const { c, id } = await newMember('edit');
    const first = (await c.rpc('complete_mock_verification', { p_name: '김지원', p_phone: '01012345678' })).data;
    const { data, error } = await c.rpc('update_my_contact', { p_name: ' 김지원B ', p_phone: '010-9999-8888' });
    expect(error).toBeNull();
    expect(data).toMatchObject({ id, name: '김지원B', phone: '01099998888', role: 'member', verified_at: first.verified_at });
  });

  it('잘못된 값은 거절하고, 프로필이 없으면 PROFILE_REQUIRED 입니다', async () => {
    const { c } = await newMember('edit-bad');
    expect((await c.rpc('update_my_contact', { p_name: '김지원', p_phone: '01012345678' })).error.message).toBe('PROFILE_REQUIRED');
    await c.rpc('complete_mock_verification', { p_name: '김지원', p_phone: '01012345678' });
    expect((await c.rpc('update_my_contact', { p_name: '김', p_phone: '123' })).error.message).toBe('INVALID_PHONE');
    expect((await c.rpc('update_my_contact', { p_name: '', p_phone: '01012345678' })).error.message).toBe('INVALID_NAME');
    expect((await c.rpc('update_my_contact', { p_name: 'x'.repeat(51), p_phone: '01012345678' })).error.message).toBe('INVALID_NAME');
  });

  it('로그인하지 않으면 거절합니다', async () => {
    const anon = createClient(process.env.API_URL, process.env.ANON_KEY, opts);
    expect((await anon.rpc('update_my_contact', { p_name: '김', p_phone: '01012345678' })).error).not.toBeNull();
  });
});

// I3: 공개 시연(env = demo)에서 시연 계정은 연락처 변경과 탈퇴를 할 수 없습니다.
describe('시연 계정 보호(demo)', () => {
  const setEnv = (env) => admin.from('app_settings').upsert([{ key: 'env', value: env }]);

  it('demo 에서 시연 계정의 연락처 변경, 모의 본인인증, 탈퇴는 DEMO_ACCOUNT_LOCKED 이고 프로필은 그대로입니다', async () => {
    const seed = await userClient('member2@demo.test');
    const id = (await seed.auth.getUser()).data.user.id;
    const before = (await admin.from('profiles').select('name, phone').eq('id', id).single()).data;
    await setEnv('demo');
    try {
      expect((await seed.rpc('update_my_contact', { p_name: '바뀐 이름', p_phone: '01011112222' })).error.message).toBe('DEMO_ACCOUNT_LOCKED');
      expect((await seed.rpc('complete_mock_verification', { p_name: '바뀐 이름', p_phone: '01011112222' })).error.message).toBe('DEMO_ACCOUNT_LOCKED');
      expect((await seed.rpc('withdraw_member')).error.message).toBe('DEMO_ACCOUNT_LOCKED');
    } finally {
      await setEnv('local');
    }
    expect((await admin.from('profiles').select('name, phone').eq('id', id).single()).data).toEqual(before);
    await userClient('member2@demo.test'); // 여전히 로그인됩니다.
  });

  it('demo 에서도 새로 가입한 계정은 수정과 탈퇴를 할 수 있습니다', async () => {
    const { c } = await newMember('demo-own');
    await setEnv('demo');
    try {
      expect((await c.rpc('complete_mock_verification', { p_name: '김지원', p_phone: '01012345678' })).error).toBeNull();
      expect((await c.rpc('update_my_contact', { p_name: '김지원B', p_phone: '01012345679' })).error).toBeNull();
      expect((await c.rpc('withdraw_member')).error).toBeNull();
    } finally {
      await setEnv('local');
    }
  });

  it('local 에서는 시연 계정도 연락처를 고칠 수 있습니다', async () => {
    const seed = await userClient('member2@demo.test');
    const id = (await seed.auth.getUser()).data.user.id;
    const before = (await admin.from('profiles').select('name, phone').eq('id', id).single()).data;
    try {
      expect((await seed.rpc('update_my_contact', { p_name: '회원 둘B', p_phone: '01000000002' })).error).toBeNull();
    } finally {
      await admin.from('profiles').update(before).eq('id', id);
    }
  });
});
