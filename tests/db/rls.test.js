// 행 단위 접근 정책(0011_rls.sql, SER-002). 기본은 거부이고, 공개 목록만 비회원에게 엽니다.
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, adminClient, resetDb, userClient } from './helpers.js';

const db = adminClient();
const DAY = 24 * 60 * 60 * 1000;
const BASE = new Date(Date.now() + DAY).toISOString();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = createClient(process.env.API_URL, process.env.ANON_KEY, opts);
let m = [];
let uid = [];
let op;
let fin;
let seq = 0;
const created = [];

const orderId = () => `HB-20261123-R${String(Date.now() % 1e6).padStart(6, '0')}${String(seq++).padStart(3, '0')}`;

async function ok(promise) {
  const { data, error } = await promise;
  expect(error).toBeNull();
  return data;
}
async function code(promise) {
  const { error } = await promise;
  return error?.message ?? null;
}
// 읽기가 막혔는지: 오류이거나 0행
async function rowsOrNone(promise) {
  const { data, error } = await promise;
  return error ? [] : data;
}

async function offering(type, idx = 0) {
  const { data: progs } = await db.from('programs').select('id').eq('type', type).order('title');
  const { data } = await db.from('offerings').select('*').eq('program_id', progs[0].id).order('starts_at');
  return data[idx];
}

async function bookCapacity(client, o, qty) {
  const hold = await ok(client.rpc('hold_capacity', { p_offering: o.id, p_qty: qty }));
  const oid = orderId();
  const items = Array.from({ length: qty }, () => ({ discountType: 'GENERAL' }));
  await ok(client.rpc('prepare_payment', { p_hold: hold.id, p_items: items, p_amount: 10000 * qty, p_order_id: oid }));
  await ok(db.rpc('lock_for_confirm', { p_order_id: oid }));
  return ok(db.rpc('finalize_booking', { p_order_id: oid, p_payment_key: `pk_${oid}`, p_raw: { status: 'DONE', card: '1234' } }));
}

beforeAll(async () => {
  m = await Promise.all(['member1', 'member2'].map((n) => userClient(`${n}@demo.test`)));
  uid = (await Promise.all(m.map((c) => c.auth.getUser()))).map((r) => r.data.user.id);
  op = await userClient('operator@demo.test');
  fin = await userClient('finance@demo.test');
});

beforeEach(async () => {
  await resetDb(BASE);
});

afterAll(async () => {
  for (const id of created) await db.auth.admin.deleteUser(id).catch(() => {});
});

describe('비회원(anon)', () => {
  it('공개 프로그램, 회차, 가격, 수업 일정, 좌석은 읽고 비공개 프로그램은 보이지 않습니다', async () => {
    const hidden = await offering('EXPERIENCE');
    await ok(db.from('programs').update({ is_public: false }).eq('id', hidden.program_id));
    const progs = await ok(anon.from('programs').select('id, offerings(id, prices:offering_prices(price), lessons:course_lessons(seq))'));
    expect(progs).toHaveLength(5);
    expect(progs.some((p) => p.id === hidden.program_id)).toBe(false);
    expect(progs.every((p) => p.offerings.length > 0 && p.offerings.every((o) => o.prices.length > 0))).toBe(true);
    expect(progs.some((p) => p.offerings.some((o) => o.lessons.length === 12))).toBe(true);
    expect(await ok(anon.from('offerings').select('id').eq('id', hidden.id))).toEqual([]);
    expect(await ok(anon.from('offering_prices').select('price').eq('offering_id', hidden.id))).toEqual([]);
    expect((await ok(anon.from('seats').select('id'))).length).toBe(200);
    // 비공개 프로그램 회차는 운영 담당에게는 보입니다.
    expect(await ok(op.from('offerings').select('id').eq('id', hidden.id))).toHaveLength(1);
  });

  it('잔여석, 현재 시각, D-day 함수는 그대로 동작합니다', async () => {
    const o = await offering('EXPERIENCE');
    expect(await ok(anon.rpc('remaining_capacity', { p_offering: o.id }))).toBe(20);
    expect(Date.parse(await ok(anon.rpc('app_now')))).toBeGreaterThan(0);
    expect(await ok(anon.rpc('d_day', { base: o.starts_at }))).toBe(await ok(db.rpc('d_day', { base: o.starts_at })));
    expect(await ok(anon.rpc('d_day', { base: o.starts_at }))).toBeGreaterThan(0);
  });

  it('개인/거래 데이터와 설정은 읽지 못하고 어떤 테이블에도 쓰지 못합니다', async () => {
    for (const t of ['profiles', 'holds', 'bookings', 'booking_items', 'refunds', 'waitlist', 'notifications',
      'inventory_seats', 'admin_audit', 'app_settings', 'pg_mock_transactions', 'offering_cancel_requests']) {
      expect(await rowsOrNone(anon.from(t).select('*').limit(1)), t).toEqual([]);
    }
    expect(await rowsOrNone(anon.from('payments').select('id').limit(1))).toEqual([]);
    expect(await code(anon.from('programs').insert({ type: 'EXPERIENCE', title: 'x' }))).not.toBeNull();
    expect(await code(anon.from('app_settings').upsert({ key: 'clock_offset_ms', value: 999 }))).not.toBeNull();
    const { data: clock } = await db.from('app_settings').select('value').eq('key', 'clock_offset_ms').single();
    expect(clock.value).toBe(0);
  });
});

describe('회원', () => {
  it('남의 예약은 0행이고 내 예약, 결제, 환불, 알림만 보입니다', async () => {
    const o = await offering('EXPERIENCE');
    const mine = await bookCapacity(m[0], o, 1);
    const theirs = await bookCapacity(m[1], o, 1);
    expect(await ok(m[0].from('bookings').select('id').eq('id', theirs.id))).toEqual([]);
    expect((await ok(m[0].from('bookings').select('id'))).map((b) => b.id)).toEqual([mine.id]);
    expect(await ok(m[0].from('booking_items').select('id').eq('booking_id', theirs.id))).toEqual([]);
    expect((await ok(m[0].from('payments').select('id, user_id'))).every((p) => p.user_id === uid[0])).toBe(true);
    expect((await ok(m[0].from('notifications').select('user_id'))).every((n) => n.user_id === uid[0])).toBe(true);
    expect((await ok(m[0].from('holds').select('user_id'))).every((h) => h.user_id === uid[0])).toBe(true);
    // 결제 원본(raw)은 본인 결제라도 화면에서 읽지 못합니다.
    expect(await code(m[0].from('payments').select('raw'))).not.toBeNull();
  });

  it('profiles 전체를 조회해도 내 행 하나만 보이고, 역할을 바꾸지 못합니다', async () => {
    const rows = await ok(m[0].from('profiles').select('id, role'));
    expect(rows).toEqual([{ id: uid[0], role: 'member' }]);
    await m[0].from('profiles').update({ role: 'operator' }).eq('id', uid[0]);
    await m[0].from('profiles').upsert({ id: uid[0], name: '회원 하나', role: 'finance' });
    const { data: me } = await db.from('profiles').select('role').eq('id', uid[0]).single();
    expect(me.role).toBe('member');
    expect(await ok(m[0].rpc('is_staff', { p_roles: ['operator', 'finance'] }))).toBe(false);
  });

  it('작업 이력, 좌석 재고, 설정, 모의 결제 기록은 읽지 못합니다', async () => {
    await ok(op.rpc('admin_upsert_program', { p: { type: 'EXPERIENCE', title: '이력 확인용' } }));
    for (const t of ['admin_audit', 'inventory_seats', 'app_settings', 'pg_mock_transactions', 'offering_cancel_requests']) {
      expect(await rowsOrNone(m[0].from(t).select('*').limit(1)), t).toEqual([]);
    }
    expect(await code(m[0].from('bookings').insert({ booking_no: 'B1', user_id: uid[0], offering_id: (await offering('EXPERIENCE')).id, hold_id: uid[0], total_amount: 0 }))).not.toBeNull();
  });
});

describe('담당자', () => {
  it('finance는 admin_upsert_program이 FORBIDDEN', async () => {
    expect(await code(fin.rpc('admin_upsert_program', { p: { type: 'EXPERIENCE', title: 'x' } }))).toBe('FORBIDDEN');
  });

  it('operator는 결제 원본 raw를 조회할 수 없고 결제 행도 보이지 않습니다', async () => {
    const o = await offering('EXPERIENCE');
    await bookCapacity(m[0], o, 1);
    expect(await code(op.from('payments').select('raw'))).not.toBeNull();
    expect(await ok(op.from('payments').select('id'))).toEqual([]);
    expect(await ok(op.from('refunds').select('id'))).toEqual([]);
    // 정산 담당은 결제 행을 보지만 원본은 admin_payment_raw로만 봅니다.
    expect(await ok(fin.from('payments').select('id, amount'))).toHaveLength(1);
    expect(await code(fin.from('payments').select('raw'))).not.toBeNull();
  });

  it('예약은 두 역할 모두 전체를 보고, 다른 사람 프로필은 직접 읽지 못합니다', async () => {
    const o = await offering('EXPERIENCE');
    await bookCapacity(m[0], o, 1);
    await bookCapacity(m[1], o, 1);
    expect(await ok(op.from('bookings').select('id'))).toHaveLength(2);
    expect(await ok(fin.from('bookings').select('id'))).toHaveLength(2);
    expect(await ok(op.from('holds').select('id'))).toHaveLength(2);
    expect(await ok(fin.from('holds').select('id'))).toEqual([]);
    expect((await ok(op.from('profiles').select('id'))).length).toBe(1);
    await ok(op.rpc('admin_upsert_program', { p: { type: 'EXPERIENCE', title: '이력 확인용' } }));
    expect(await ok(fin.from('admin_audit').select('action'))).toEqual([{ action: 'PROGRAM_CREATE' }]);
  });

  it('담당자도 테이블에 직접 쓰지 못합니다(변경은 admin_* 함수로만)', async () => {
    const o = await offering('EXPERIENCE');
    await op.from('offerings').update({ capacity: 1 }).eq('id', o.id);
    await op.from('profiles').update({ role: 'finance' }).neq('id', '00000000-0000-0000-0000-000000000000');
    await fin.from('app_settings').upsert({ key: 'pg_mock_mode', value: 'DECLINE' });
    expect((await ok(db.from('offerings').select('capacity').eq('id', o.id).single())).capacity).toBe(20);
    const { data: roles } = await db.from('profiles').select('role').in('role', ['operator', 'finance']);
    expect(roles.map((r) => r.role).sort()).toEqual(['finance', 'operator']);
    expect((await ok(db.from('app_settings').select('value').eq('key', 'pg_mock_mode').single())).value).toBe('APPROVE');
    expect(await code(op.from('admin_audit').insert({ action: 'FAKE' }))).not.toBeNull();
  });
});

describe('정산 집계 뷰(0012)', () => {
  it('settlement_daily 는 화면 역할이 직접 읽지 못하고 정산 담당 함수(staff_settlement)로만 봅니다', async () => {
    const o = await offering('EXPERIENCE');
    await bookCapacity(m[0], o, 1);
    for (const c of [anon, m[0], op, fin]) {
      expect(await rowsOrNone(c.from('settlement_daily').select('*').limit(1))).toEqual([]);
    }
    expect(await code(op.rpc('staff_settlement', { p_from: null, p_to: null }))).toBe('FORBIDDEN');
    const rows = await ok(fin.rpc('staff_settlement', { p_from: null, p_to: null }));
    expect(rows.reduce((a, r) => a + Number(r.paid_sum), 0)).toBe(10000);
  });

  it('새 함수는 비회원이 실행하지 못합니다', async () => {
    for (const fn of ['staff_bookings', 'staff_waitlist', 'staff_payments', 'staff_refunds', 'staff_cancel_requests', 'staff_settlement']) {
      expect(await code(anon.rpc(fn, {})), fn).not.toBeNull();
    }
  });
});

describe('탈퇴/차단 계정(R17)', () => {
  it('아직 유효한 토큰이라도 회원 쓰기 함수는 UNAUTHENTICATED', async () => {
    const email = `banned-${Date.now()}@example.com`;
    const c = createClient(process.env.API_URL, process.env.ANON_KEY, opts);
    const { data, error } = await c.auth.signUp({ email, password: DEMO_PASSWORD });
    expect(error).toBeNull();
    created.push(data.user.id);
    await ok(c.rpc('complete_mock_verification', { p_name: '차단 회원', p_phone: '01099998888' }));
    await ok(db.auth.admin.updateUserById(data.user.id, { ban_duration: '87600h' }));

    const o = await offering('EXPERIENCE');
    const perf = await offering('PERFORMANCE');
    const x = '00000000-0000-4000-8000-0000000000ee';
    const calls = {
      hold_seats: { p_offering: perf.id, p_seat_ids: [1] },
      hold_capacity: { p_offering: o.id, p_qty: 1 },
      release_hold: { p_hold: x },
      prepare_payment: { p_hold: x, p_items: [], p_amount: 0, p_order_id: 'HB-20261123-ABCDEFGHIJ' },
      join_waitlist: { p_offering: o.id, p_qty: 1 },
      cancel_waitlist: { p_id: x },
      hold_for_promotion: { p_waitlist: x },
    };
    for (const [fn, args] of Object.entries(calls)) {
      expect(await code(c.rpc(fn, args)), fn).toBe('UNAUTHENTICATED');
    }
    const { count } = await db.from('holds').select('*', { count: 'exact', head: true }).eq('user_id', data.user.id);
    expect(count).toBe(0);
  });
});
