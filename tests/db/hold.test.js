import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS } from '../../supabase/functions/_shared/policy/limits.js';
import { adminClient, resetDb, setClock, userClient } from './helpers.js';

const db = adminClient();
const MIN = 60 * 1000;
let base;
let m = [];
let uid = [];

async function offering(type, idx = 0) {
  const { data: progs } = await db.from('programs').select('id').eq('type', type).order('title');
  const { data } = await db
    .from('offerings')
    .select('*')
    .eq('program_id', progs[0].id)
    .order('starts_at');
  return data[idx];
}

async function failCode(promise) {
  const { data, error } = await promise;
  return error ? error.message : data;
}

beforeAll(async () => {
  m = await Promise.all(['member1', 'member2', 'member3'].map((n) => userClient(`${n}@demo.test`)));
  uid = (await Promise.all(m.map((c) => c.auth.getUser()))).map((r) => r.data.user.id);
});

beforeEach(async () => {
  // 판매 기간 안(지금)에 들어오도록 기준일은 내일로 둡니다.
  base = new Date(Date.now() + 24 * 60 * MIN).toISOString();
  await resetDb(base);
});

describe('clock', () => {
  it('app_now follows offset when enabled', async () => {
    await setClock(5 * MIN);
    const { data } = await db.rpc('app_now');
    expect(Math.abs(new Date(data).getTime() - (Date.now() + 5 * MIN))).toBeLessThan(2000);
  });

  it('clock_enabled=false ignores offset', async () => {
    await setClock(60 * MIN);
    await db.from('app_settings').upsert([{ key: 'clock_enabled', value: false }]);
    const { data } = await db.rpc('app_now');
    expect(Math.abs(new Date(data).getTime() - Date.now())).toBeLessThan(1000);
  });

  it('d_day uses KST calendar dates', async () => {
    const { data: now } = await db.rpc('app_now');
    const kstDate = (iso) => new Date(new Date(iso).getTime() + 9 * 60 * MIN).toISOString().slice(0, 10);
    const target = new Date(new Date(now).getTime() + 3 * 24 * 60 * MIN).toISOString();
    const expected =
      (Date.parse(kstDate(target)) - Date.parse(kstDate(now))) / (24 * 60 * MIN);
    const { data } = await db.rpc('d_day', { base: target });
    expect(data).toBe(expected);
  });

  it('product_limit matches policy LIMITS', async () => {
    for (const [type, n] of Object.entries(LIMITS)) {
      const { data } = await db.rpc('product_limit', { p_type: type });
      expect(data).toBe(n);
    }
  });
});

describe('hold_seats', () => {
  it('holds 2 seats for 10 minutes', async () => {
    const o = await offering('PERFORMANCE');
    const { data: hold, error } = await m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [1, 2] });
    expect(error).toBeNull();
    expect(hold.status).toBe('ACTIVE');
    expect(hold.qty).toBe(2);
    const { data: now } = await db.rpc('app_now');
    expect(Math.abs(new Date(hold.expires_at).getTime() - (new Date(now).getTime() + 10 * MIN))).toBeLessThan(3000);
    const { data: seats } = await db
      .from('inventory_seats').select('status, hold_id').eq('offering_id', o.id).in('seat_id', [1, 2]);
    expect(seats.map((s) => s.status)).toEqual(['HELD', 'HELD']);
    expect(seats.every((s) => s.hold_id === hold.id)).toBe(true);
  });

  it('concurrency: 20 simultaneous holds on the same seat -> exactly 1 wins (PER-004, AC-3)', async () => {
    const o = await offering('PERFORMANCE');
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        m[i % 3].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [10] }),
      ),
    );
    const ok = results.filter((r) => !r.error);
    const bad = results.filter((r) => r.error);
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(19);
    expect(new Set(bad.map((r) => r.error.message))).toEqual(new Set(['SEAT_TAKEN']));
    const { data: seat } = await db.from('inventory_seats').select('status, hold_id')
      .eq('offering_id', o.id).eq('seat_id', 10).single();
    expect(seat.status).toBe('HELD');
    expect(seat.hold_id).toBe(ok[0].data.id);
    // 실패한 호출이 선점 행을 남기지 않아야 합니다.
    const { data: holds } = await db.from('holds').select('id').eq('offering_id', o.id);
    expect(holds).toHaveLength(1);
  });

  it('partial overlap rolls back everything', async () => {
    const o = await offering('PERFORMANCE');
    await m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [21] });
    const code = await failCode(m[1].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [20, 21] }));
    expect(code).toBe('SEAT_TAKEN');
    const { data: seat } = await db.from('inventory_seats').select('status')
      .eq('offering_id', o.id).eq('seat_id', 20).single();
    expect(seat.status).toBe('AVAILABLE');
  });

  it('expiry frees seats for another member (AC-4); PAYING is untouched', async () => {
    const o = await offering('PERFORMANCE');
    const { data: h1 } = await m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [30, 31] });
    const { data: h2 } = await m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [32] });
    await db.from('holds').update({ status: 'PAYING' }).eq('id', h2.id);
    await db.from('inventory_seats').update({ status: 'PAYING' }).eq('hold_id', h2.id);
    await setClock(10 * MIN + 1000);
    const { error } = await db.rpc('sweep_offering', { p_offering: o.id });
    expect(error).toBeNull();
    const { data: after } = await db.from('holds').select('status').eq('id', h1.id).single();
    expect(after.status).toBe('EXPIRED');
    const { data: seats } = await db.from('inventory_seats').select('seat_id, status, hold_id')
      .eq('offering_id', o.id).in('seat_id', [30, 31, 32]).order('seat_id');
    expect(seats.map((s) => s.status)).toEqual(['AVAILABLE', 'AVAILABLE', 'PAYING']);
    expect(seats[0].hold_id).toBeNull();
    const { data: h3, error: e3 } = await m[1].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [30, 31] });
    expect(e3).toBeNull();
    expect(h3.status).toBe('ACTIVE');
  });

  it('hold on an expired-but-unswept seat succeeds (hold sweeps first)', async () => {
    const o = await offering('PERFORMANCE');
    await m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [40] });
    await setClock(10 * MIN + 1000);
    const { error } = await m[1].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [40] });
    expect(error).toBeNull();
  });

  it('release_hold frees seats; only the owner may release', async () => {
    const o = await offering('PERFORMANCE');
    const { data: h } = await m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [50, 51] });
    expect(await failCode(m[1].rpc('release_hold', { p_hold: h.id }))).toBe('NOT_OWNER');
    const { error } = await m[0].rpc('release_hold', { p_hold: h.id });
    expect(error).toBeNull();
    const { data: row } = await db.from('holds').select('status').eq('id', h.id).single();
    expect(row.status).toBe('RELEASED');
    const { data: seats } = await db.from('inventory_seats').select('status')
      .eq('offering_id', o.id).in('seat_id', [50, 51]);
    expect(seats.map((s) => s.status)).toEqual(['AVAILABLE', 'AVAILABLE']);
  });

  it('5 seats exceed the performance limit of 4', async () => {
    const o = await offering('PERFORMANCE');
    const code = await failCode(m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [1, 2, 3, 4, 5] }));
    expect(code).toBe('LIMIT_EXCEEDED');
  });
});

describe('hold_capacity', () => {
  async function fill(users, offeringId, qty, times) {
    const calls = [];
    for (let i = 0; i < times; i++) calls.push(users[i % users.length].rpc('hold_capacity', { p_offering: offeringId, p_qty: qty }));
    return Promise.all(calls);
  }

  it('concurrency: 20 clients x 2 on capacity 20 never oversell', async () => {
    const o = await offering('EXPERIENCE');
    expect(o.capacity).toBe(20);
    const res = await fill(m, o.id, 2, 20);
    const sum = res.filter((r) => !r.error).reduce((s, r) => s + r.data.qty, 0);
    expect(sum).toBeLessThanOrEqual(20);
    for (const r of res.filter((x) => x.error)) expect(['LIMIT_EXCEEDED', 'SOLD_OUT']).toContain(r.error.message);
    const { data: rem } = await db.rpc('remaining_capacity', { p_offering: o.id });
    expect(rem).toBe(20 - sum);
  });

  it('concurrency on a tight capacity: SOLD_OUT, total never exceeds capacity', async () => {
    const o = await offering('EXPERIENCE', 1);
    await db.from('offerings').update({ capacity: 5 }).eq('id', o.id);
    const res = await fill(m, o.id, 2, 12);
    const sum = res.filter((r) => !r.error).reduce((s, r) => s + r.data.qty, 0);
    expect(sum).toBe(4);
    expect(res.filter((r) => r.error && r.error.message === 'SOLD_OUT').length).toBeGreaterThan(0);
    const { data: rem } = await db.rpc('remaining_capacity', { p_offering: o.id });
    expect(rem).toBe(1);
  });

  it('expired capacity holds are released by sweep', async () => {
    const o = await offering('EXPERIENCE');
    await db.from('offerings').update({ capacity: 2 }).eq('id', o.id);
    const { error } = await m[0].rpc('hold_capacity', { p_offering: o.id, p_qty: 2 });
    expect(error).toBeNull();
    expect(await failCode(m[1].rpc('hold_capacity', { p_offering: o.id, p_qty: 1 }))).toBe('SOLD_OUT');
    await setClock(10 * MIN + 1000);
    await db.rpc('sweep_offering', { p_offering: o.id });
    const { data: h } = await db.from('holds').select('status').eq('offering_id', o.id);
    expect(h.map((x) => x.status)).toEqual(['EXPIRED']);
    const { error: e2 } = await m[1].rpc('hold_capacity', { p_offering: o.id, p_qty: 1 });
    expect(e2).toBeNull();
  });

  it('limit counts active holds and confirmed across tabs', async () => {
    const o = await offering('EXPERIENCE');
    const { data: h } = await db.from('holds').insert({
      offering_id: o.id, user_id: uid[0], qty: 3, status: 'CONSUMED', expires_at: new Date().toISOString(),
    }).select().single();
    const { error: be } = await db.from('bookings').insert({
      booking_no: 'T-LIMIT-1', user_id: uid[0], offering_id: o.id, hold_id: h.id, total_amount: 30000,
    });
    expect(be).toBeNull();
    expect(await failCode(m[0].rpc('hold_capacity', { p_offering: o.id, p_qty: 2 }))).toBe('LIMIT_EXCEEDED');
    const { error } = await m[0].rpc('hold_capacity', { p_offering: o.id, p_qty: 1 });
    expect(error).toBeNull();
    // 한 장 더(다른 탭): 확정 3 + 선점 1 = 4 이므로 초과
    expect(await failCode(m[0].rpc('hold_capacity', { p_offering: o.id, p_qty: 1 }))).toBe('LIMIT_EXCEEDED');
  });

  it('concurrent tabs of one user cannot exceed the limit', async () => {
    const o = await offering('EXPERIENCE');
    const res = await Promise.all(Array.from({ length: 6 }, () => m[2].rpc('hold_capacity', { p_offering: o.id, p_qty: 1 })));
    expect(res.filter((r) => !r.error)).toHaveLength(4);
  });

  it('course limit is 1', async () => {
    const o = await offering('COURSE');
    expect(await failCode(m[0].rpc('hold_capacity', { p_offering: o.id, p_qty: 2 }))).toBe('LIMIT_EXCEEDED');
    expect((await m[0].rpc('hold_capacity', { p_offering: o.id, p_qty: 1 })).error).toBeNull();
    expect(await failCode(m[0].rpc('hold_capacity', { p_offering: o.id, p_qty: 1 }))).toBe('LIMIT_EXCEEDED');
  });
});

describe('sale window', () => {
  it('NOT_ON_SALE before sale start, after sale end, and when not OPEN', async () => {
    const o = await offering('EXPERIENCE');
    await setClock(-30 * 24 * 60 * MIN);
    expect(await failCode(m[0].rpc('hold_capacity', { p_offering: o.id, p_qty: 1 }))).toBe('NOT_ON_SALE');
    await setClock(60 * 24 * 60 * MIN);
    expect(await failCode(m[0].rpc('hold_capacity', { p_offering: o.id, p_qty: 1 }))).toBe('NOT_ON_SALE');
    await setClock(0);
    await db.from('offerings').update({ status: 'CANCELLED' }).eq('id', o.id);
    expect(await failCode(m[0].rpc('hold_capacity', { p_offering: o.id, p_qty: 1 }))).toBe('NOT_ON_SALE');
    const p = await offering('PERFORMANCE');
    await setClock(60 * 24 * 60 * MIN);
    expect(await failCode(m[0].rpc('hold_seats', { p_offering: p.id, p_seat_ids: [1] }))).toBe('NOT_ON_SALE');
  });
});
