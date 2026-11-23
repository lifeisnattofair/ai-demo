import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminClient, resetDb, setClock, userClient } from './helpers.js';

// 기준 base = 12/01 00:00 KST. 공연 회차는 base+10일(12/11), 정규 강좌 첫 회는 base+9일(12/10).
const BASE = '2026-12-01T00:00:00+09:00';
const H = 60 * 60 * 1000;
const db = adminClient();
let m = [];
let uid = [];

// 커밋 전 트랜잭션을 흉내 내려고 DB 컨테이너의 psql을 씁니다(없으면 해당 테스트만 건너뜀).
const DB_CONTAINER = `supabase_db_${readFileSync('supabase/config.toml', 'utf8').match(/^project_id = "(.+)"/m)[1]}`;
const dockerOk = (() => {
  try { execFileSync('docker', ['exec', DB_CONTAINER, 'true'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const psql = (sql) => new Promise((resolve, reject) => {
  execFile('docker', ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    (err, out) => (err ? reject(err) : resolve(out)));
});

const at = (iso) => setClock(Date.parse(iso) - Date.now());

async function offering(type, idx = 0) {
  const { data: progs } = await db.from('programs').select('id').eq('type', type).order('title');
  const { data } = await db.from('offerings').select('*').eq('program_id', progs[0].id).order('starts_at');
  return data[idx];
}

async function failCode(promise) {
  const { data, error } = await promise;
  return error ? error.message : data;
}

async function soldOutSeats(o) {
  const { error } = await db.from('inventory_seats').update({ status: 'SOLD' }).eq('offering_id', o.id);
  expect(error).toBeNull();
}

// 정원제 회차를 확정 예약 1건(uid[2], qty)으로 매진시킵니다. 반환값은 예약 id
async function soldOutCapacity(o, qty) {
  await db.from('offerings').update({ capacity: qty }).eq('id', o.id);
  const { data: h, error: he } = await db.from('holds').insert({
    offering_id: o.id, user_id: uid[2], qty, status: 'CONSUMED', expires_at: new Date().toISOString(),
  }).select().single();
  expect(he).toBeNull();
  const { data: b, error: be } = await db.from('bookings').insert({
    booking_no: `T-WAIT-${o.id.slice(0, 8)}`, user_id: uid[2], offering_id: o.id, hold_id: h.id, total_amount: 0,
  }).select().single();
  expect(be).toBeNull();
  return b.id;
}

async function join(i, o, qty) {
  const { data, error } = await m[i].rpc('join_waitlist', { p_offering: o.id, p_qty: qty });
  expect(error).toBeNull();
  return data;
}

async function release(o, seatIds, qty) {
  const { error } = await db.rpc('release_inventory', { p_offering: o.id, p_seat_ids: seatIds, p_qty: qty });
  expect(error).toBeNull();
}

async function queue(o) {
  const { data } = await db.from('waitlist').select('*').eq('offering_id', o.id).order('created_at');
  return data;
}

async function seats(o, ids) {
  const { data } = await db.from('inventory_seats').select('seat_id, status, hold_id, waitlist_id')
    .eq('offering_id', o.id).in('seat_id', ids).order('seat_id');
  return data;
}

async function notes(userId, kind) {
  const { data } = await db.from('notifications').select('*').eq('user_id', userId).eq('kind', kind);
  return data;
}

async function nowMs() {
  const { data } = await db.rpc('app_now');
  return new Date(data).getTime();
}

beforeAll(async () => {
  m = await Promise.all(['member1', 'member2', 'member3'].map((n) => userClient(`${n}@demo.test`)));
  uid = (await Promise.all(m.map((c) => c.auth.getUser()))).map((r) => r.data.user.id);
});

beforeEach(async () => {
  await resetDb(BASE);
  await at(BASE);
});

describe('join_waitlist', () => {
  it('NOT_SOLD_OUT while seats remain; accepts once sold out', async () => {
    const o = await offering('PERFORMANCE');
    expect(await failCode(m[0].rpc('join_waitlist', { p_offering: o.id, p_qty: 2 }))).toBe('NOT_SOLD_OUT');
    await soldOutSeats(o);
    const w = await join(0, o, 2);
    expect(w.status).toBe('WAITING');
    expect(w.qty).toBe(2);
    expect(w.allocated_qty).toBe(0);
    expect(w.user_id).toBe(uid[0]);
  });

  it('ALREADY_WAITING, LIMIT_EXCEEDED (confirmed + waiting), INVALID_REQUEST', async () => {
    const o = await offering('PERFORMANCE');
    await soldOutSeats(o);
    await join(0, o, 1);
    expect(await failCode(m[0].rpc('join_waitlist', { p_offering: o.id, p_qty: 1 }))).toBe('ALREADY_WAITING');
    expect(await failCode(m[1].rpc('join_waitlist', { p_offering: o.id, p_qty: 5 }))).toBe('LIMIT_EXCEEDED');
    expect(await failCode(m[1].rpc('join_waitlist', { p_offering: o.id, p_qty: 0 }))).toBe('INVALID_REQUEST');
    // 이미 확정 3매가 있으면 2매 대기는 한도(4) 초과
    const { data: h } = await db.from('holds').insert({
      offering_id: o.id, user_id: uid[2], qty: 3, status: 'CONSUMED', expires_at: new Date().toISOString(),
    }).select().single();
    await db.from('bookings').insert({ booking_no: 'T-WL-1', user_id: uid[2], offering_id: o.id, hold_id: h.id, total_amount: 0 });
    expect(await failCode(m[2].rpc('join_waitlist', { p_offering: o.id, p_qty: 2 }))).toBe('LIMIT_EXCEEDED');
    await join(2, o, 1);
  });

  it('course: qty within limit 1; capacity offerings sold out by confirmed bookings', async () => {
    const c = await offering('COURSE');
    expect(await failCode(m[0].rpc('join_waitlist', { p_offering: c.id, p_qty: 1 }))).toBe('NOT_SOLD_OUT');
    await soldOutCapacity(c, 1);
    expect(await failCode(m[0].rpc('join_waitlist', { p_offering: c.id, p_qty: 2 }))).toBe('LIMIT_EXCEEDED');
    await join(0, c, 1);
  });

  it('Ruling R12: NOT_ON_SALE at D-2 or closer; D-3 still accepted', async () => {
    const o = await offering('PERFORMANCE'); // 12/11 KST
    await soldOutSeats(o);
    await at('2026-12-08T23:59:00+09:00'); // D-3
    await join(0, o, 1);
    await at('2026-12-09T00:00:01+09:00'); // D-2
    expect(await failCode(m[1].rpc('join_waitlist', { p_offering: o.id, p_qty: 1 }))).toBe('NOT_ON_SALE');
  });

  it('concurrent joins of one user: exactly one succeeds', async () => {
    const o = await offering('PERFORMANCE');
    await soldOutSeats(o);
    const res = await Promise.all(Array.from({ length: 8 }, () => m[0].rpc('join_waitlist', { p_offering: o.id, p_qty: 1 })));
    expect(res.filter((r) => !r.error)).toHaveLength(1);
    expect(new Set(res.filter((r) => r.error).map((r) => r.error.message))).toEqual(new Set(['ALREADY_WAITING']));
  });
});

describe('accumulation and promotion (performance)', () => {
  async function setup() {
    const o = await offering('PERFORMANCE');
    expect(new Date(Date.parse(o.starts_at) + 9 * H).toISOString().slice(0, 10)).toBe('2026-12-11'); // KST
    await soldOutSeats(o);
    await join(0, o, 2);
    await join(1, o, 1);
    return o;
  }

  it('1 seat released: head accumulates (allocated 1, WAITING), seat WAIT_ALLOCATED; 2nd untouched', async () => {
    const o = await setup();
    await release(o, [5], 1);
    const [w1, w2] = await queue(o);
    expect(w1.allocated_qty).toBe(1);
    expect(w1.status).toBe('WAITING');
    expect(w2.allocated_qty).toBe(0);
    expect(w2.status).toBe('WAITING');
    const [s] = await seats(o, [5]);
    expect(s.status).toBe('WAIT_ALLOCATED');
    expect(s.waitlist_id).toBe(w1.id);
    // 대기 배정 좌석은 일반 회원이 잡을 수 없습니다.
    expect(await failCode(m[2].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [5] }))).toBe('SEAT_TAKEN');
    expect(await notes(uid[0], 'WAIT_PROMOTED')).toHaveLength(0);
  });

  it('2 more released: head PROMOTED with 24h deadline + WAIT_PROMOTED; surplus promotes the 2nd', async () => {
    const o = await setup();
    await release(o, [5], 1);
    await release(o, [6, 7], 2);
    const [w1, w2] = await queue(o);
    const now = await nowMs();
    expect(w1.status).toBe('PROMOTED');
    expect(w1.allocated_qty).toBe(2);
    expect(Math.abs(new Date(w1.deadline_at).getTime() - (now + 24 * H))).toBeLessThan(5000);
    expect(await notes(uid[0], 'WAIT_PROMOTED')).toHaveLength(1);
    expect(w2.status).toBe('PROMOTED');
    expect(w2.allocated_qty).toBe(1);
    expect(await notes(uid[1], 'WAIT_PROMOTED')).toHaveLength(1);
    const ss = await seats(o, [5, 6, 7]);
    expect(ss.map((s) => s.status)).toEqual(['WAIT_ALLOCATED', 'WAIT_ALLOCATED', 'WAIT_ALLOCATED']);
    expect(ss.map((s) => s.waitlist_id)).toEqual([w1.id, w1.id, w2.id]);
  });

  it('deadline +1s: sweep expires promotions; seats go to the next waiter, else AVAILABLE', async () => {
    const o = await setup();
    await join(2, o, 2);
    await release(o, [5], 1);
    await release(o, [6, 7], 2);
    await at(new Date(Date.parse(BASE) + 24 * H + 1000).toISOString());
    // 누구나 호출할 수 있고, 여러 번 불러도 결과가 같습니다.
    expect((await m[2].rpc('sweep_offering', { p_offering: o.id })).error).toBeNull();
    expect((await m[1].rpc('sweep_offering', { p_offering: o.id })).error).toBeNull();
    const [w1, w2, w3] = await queue(o);
    expect(w1.status).toBe('EXPIRED');
    expect(w2.status).toBe('EXPIRED');
    expect(w3.status).toBe('PROMOTED');
    expect(w3.allocated_qty).toBe(2);
    const ss = await seats(o, [5, 6, 7]);
    expect(ss.map((s) => s.status)).toEqual(['WAIT_ALLOCATED', 'WAIT_ALLOCATED', 'AVAILABLE']);
    expect(ss.map((s) => s.waitlist_id)).toEqual([w3.id, w3.id, null]);
    expect(await notes(uid[0], 'WAIT_EXPIRED')).toHaveLength(1);
    expect(await notes(uid[1], 'WAIT_EXPIRED')).toHaveLength(1);
    expect(await notes(uid[2], 'WAIT_PROMOTED')).toHaveLength(1);
  });

  it('concurrent releases never double-allocate and keep FIFO', async () => {
    const o = await setup();
    await join(2, o, 2);
    await Promise.all([5, 6, 7, 8, 9, 10].map((id) =>
      db.rpc('release_inventory', { p_offering: o.id, p_seat_ids: [id], p_qty: 1 })));
    const [w1, w2, w3] = await queue(o);
    expect([w1.status, w2.status, w3.status]).toEqual(['PROMOTED', 'PROMOTED', 'PROMOTED']);
    expect([w1.allocated_qty, w2.allocated_qty, w3.allocated_qty]).toEqual([2, 1, 2]);
    const ss = await seats(o, [5, 6, 7, 8, 9, 10]);
    const byW = (id) => ss.filter((s) => s.waitlist_id === id).length;
    expect([byW(w1.id), byW(w2.id), byW(w3.id)]).toEqual([2, 1, 2]);
    expect(ss.filter((s) => s.status === 'AVAILABLE')).toHaveLength(1);
  });
});

describe('D-2 cutoff', () => {
  it('a cancellation at D-2 (12/09 KST) goes to general sale even with waiters', async () => {
    const o = await offering('PERFORMANCE');
    await soldOutSeats(o);
    await join(0, o, 1);
    await at('2026-12-09T10:00:00+09:00');
    await release(o, [5], 1);
    const [s] = await seats(o, [5]);
    expect(s.status).toBe('AVAILABLE');
    expect(s.waitlist_id).toBeNull();
    const [w] = await queue(o);
    expect(w.allocated_qty).toBe(0);
    expect(w.status).toBe('WAITING');
  });

  it('promotion deadline expiring inside D-2 releases to general sale (RELEASED, WAIT_EXPIRED)', async () => {
    const o = await offering('PERFORMANCE');
    await soldOutSeats(o);
    await join(0, o, 1);
    await join(1, o, 1);
    await at('2026-12-08T12:00:00+09:00');
    await release(o, [5], 1);
    const [p1] = await queue(o);
    expect(p1.status).toBe('PROMOTED');
    await at('2026-12-09T12:00:01+09:00');
    await db.rpc('sweep_offering', { p_offering: o.id });
    const [w1, w2] = await queue(o);
    expect(w1.status).toBe('RELEASED');
    expect(w2.status).toBe('WAITING');
    expect(w2.allocated_qty).toBe(0);
    const [s] = await seats(o, [5]);
    expect(s.status).toBe('AVAILABLE');
    expect(s.waitlist_id).toBeNull();
    expect(await notes(uid[0], 'WAIT_EXPIRED')).toHaveLength(1);
    expect(await notes(uid[1], 'WAIT_PROMOTED')).toHaveLength(0);
  });

  it('partially accumulated units are released when D-2 arrives', async () => {
    const o = await offering('PERFORMANCE');
    await soldOutSeats(o);
    await join(0, o, 2);
    await at('2026-12-08T10:00:00+09:00');
    await release(o, [5], 1);
    expect((await queue(o))[0].allocated_qty).toBe(1);
    await at('2026-12-09T00:00:01+09:00');
    await db.rpc('sweep_offering', { p_offering: o.id });
    const [w] = await queue(o);
    expect(w.status).toBe('RELEASED');
    const [s] = await seats(o, [5]);
    expect(s.status).toBe('AVAILABLE');
    expect(s.waitlist_id).toBeNull();
    expect(await notes(uid[0], 'WAIT_EXPIRED')).toHaveLength(1);
    // 다시 불러도 알림이 늘지 않습니다.
    await db.rpc('sweep_offering', { p_offering: o.id });
    expect(await notes(uid[0], 'WAIT_EXPIRED')).toHaveLength(1);
  });
});

describe('capacity offerings', () => {
  it('experience: released qty promotes waiters in order without double counting', async () => {
    const e = await offering('EXPERIENCE');
    const bookingId = await soldOutCapacity(e, 2);
    await join(0, e, 1);
    await join(1, e, 1);
    await db.from('bookings').update({ status: 'CANCELLED' }).eq('id', bookingId);
    await release(e, null, 2);
    const [w1, w2] = await queue(e);
    expect([w1.status, w2.status]).toEqual(['PROMOTED', 'PROMOTED']);
    expect(await failCode(m[2].rpc('hold_capacity', { p_offering: e.id, p_qty: 1 }))).toBe('SOLD_OUT');
    const { data: h, error } = await m[0].rpc('hold_for_promotion', { p_waitlist: w1.id });
    expect(error).toBeNull();
    expect(h.qty).toBe(1);
    const { data: rem } = await db.rpc('remaining_capacity', { p_offering: e.id });
    expect(rem).toBe(0);
    expect(await failCode(m[2].rpc('hold_capacity', { p_offering: e.id, p_qty: 1 }))).toBe('SOLD_OUT');
  });

  it('course: NOT_ON_SALE after the first lesson starts; cancellations are not allocated', async () => {
    const c = await offering('COURSE');
    const bookingId = await soldOutCapacity(c, 1);
    await join(0, c, 1);
    await at('2026-12-10T01:00:00+09:00');
    expect(await failCode(m[1].rpc('join_waitlist', { p_offering: c.id, p_qty: 1 }))).toBe('NOT_ON_SALE');
    await db.from('bookings').update({ status: 'CANCELLED' }).eq('id', bookingId);
    await release(c, null, 1);
    const [w] = await queue(c);
    expect(w.allocated_qty).toBe(0);
    expect(w.status).toBe('WAITING');
  });
});

describe('hold_for_promotion and cancel_waitlist', () => {
  async function promoted() {
    const o = await offering('PERFORMANCE');
    await soldOutSeats(o);
    await join(0, o, 1);
    await join(1, o, 1);
    await release(o, [5], 1);
    const [w1] = await queue(o);
    expect(w1.status).toBe('PROMOTED');
    return { o, w1 };
  }

  it('creates a hold that expires at the deadline; others get SEAT_TAKEN', async () => {
    const { o, w1 } = await promoted();
    expect(await failCode(m[1].rpc('hold_for_promotion', { p_waitlist: w1.id }))).toBe('NOT_OWNER');
    const { data: h, error } = await m[0].rpc('hold_for_promotion', { p_waitlist: w1.id });
    expect(error).toBeNull();
    expect(h.status).toBe('ACTIVE');
    expect(h.qty).toBe(1);
    expect(new Date(h.expires_at).getTime()).toBe(new Date(w1.deadline_at).getTime());
    const [s] = await seats(o, [5]);
    expect(s.status).toBe('HELD');
    expect(s.hold_id).toBe(h.id);
    expect(await failCode(m[2].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [5] }))).toBe('SEAT_TAKEN');
    // 다시 들어와도 같은 선점을 돌려줍니다.
    const { data: again } = await m[0].rpc('hold_for_promotion', { p_waitlist: w1.id });
    expect(again.id).toBe(h.id);
    // 10분이 지나도 기한 전이면 유지됩니다.
    await at(new Date(Date.parse(BASE) + 1 * H).toISOString());
    await db.rpc('sweep_offering', { p_offering: o.id });
    expect((await seats(o, [5]))[0].status).toBe('HELD');
  });

  it('a promotion hold expiring at the deadline passes the seat to the next waiter', async () => {
    const { o, w1 } = await promoted();
    await m[0].rpc('hold_for_promotion', { p_waitlist: w1.id });
    await at(new Date(Date.parse(BASE) + 24 * H + 1000).toISOString());
    await m[2].rpc('sweep_offering', { p_offering: o.id });
    const [x1, x2] = await queue(o);
    expect(x1.status).toBe('EXPIRED');
    expect(x2.status).toBe('PROMOTED');
    const [s] = await seats(o, [5]);
    expect(s.status).toBe('WAIT_ALLOCATED');
    expect(s.waitlist_id).toBe(x2.id);
    expect(s.hold_id).toBeNull();
    const { data: h } = await db.from('holds').select('status').eq('waitlist_id', w1.id).single();
    expect(h.status).toBe('EXPIRED');
  });

  it('a PAYING promotion hold at the deadline: sweep and cancel leave entry and seats untouched', async () => {
    const { o, w1 } = await promoted();
    const { data: h } = await m[0].rpc('hold_for_promotion', { p_waitlist: w1.id });
    await db.from('holds').update({ status: 'PAYING' }).eq('id', h.id);
    await at(new Date(Date.parse(BASE) + 24 * H + 1000).toISOString());
    await m[2].rpc('sweep_offering', { p_offering: o.id });
    expect(await failCode(m[0].rpc('cancel_waitlist', { p_id: w1.id }))).toBe('PAYMENT_IN_PROGRESS');
    const [x1, x2] = await queue(o);
    expect([x1.status, x2.status]).toEqual(['PROMOTED', 'WAITING']);
    const [s] = await seats(o, [5]);
    expect(s.status).toBe('HELD');
    expect(s.hold_id).toBe(h.id);
    expect(await notes(uid[0], 'WAIT_EXPIRED')).toHaveLength(0);
  });

  it.skipIf(!dockerOk)('race: payment moves the hold to PAYING (uncommitted) while sweep expires it -> no reroute', async () => {
    const { o, w1 } = await promoted();
    const { data: h } = await m[0].rpc('hold_for_promotion', { p_waitlist: w1.id });
    await at(new Date(Date.parse(BASE) + 24 * H + 1000).toISOString());
    const marker = `wl_race_${h.id.slice(0, 8)}`;
    const pay = psql(`/* ${marker} */ begin; update public.holds set status = 'PAYING' where id = '${h.id}'; select pg_sleep(3); commit;`);
    const payDone = pay.then(() => null, (e) => e); // 실패해도 처리되지 않은 거부가 남지 않게
    try {
      // 결제 트랜잭션이 선점 행을 잠근 채 pg_sleep 중일 때까지 기다립니다.
      let ready = false;
      for (let i = 0; i < 50 && !ready; i++) {
        const out = await psql(`select count(*) from pg_stat_activity a join pg_locks l on l.pid = a.pid
          where a.pid <> pg_backend_pid() and a.query like '%${marker}%' and a.wait_event = 'PgSleep'
            and l.relation = 'public.holds'::regclass and l.mode = 'RowExclusiveLock' and l.granted`);
        ready = /^\s*1\s*$/m.test(out);
        if (!ready) await new Promise((r) => setTimeout(r, 100));
      }
      expect(ready).toBe(true);
      const { error } = await m[2].rpc('sweep_offering', { p_offering: o.id });
      expect(error).toBeNull();
    } finally {
      const e = await payDone;
      expect(e).toBeNull();
    }
    const [x1, x2] = await queue(o);
    expect([x1.status, x2.status]).toEqual(['PROMOTED', 'WAITING']);
    const [s] = await seats(o, [5]);
    expect(s.status).toBe('HELD');
    expect(s.hold_id).toBe(h.id);
    expect(s.waitlist_id).toBe(w1.id);
  });

  it('release_hold of a promotion hold keeps the seat allocated to the waiter', async () => {
    const { o, w1 } = await promoted();
    const { data: h } = await m[0].rpc('hold_for_promotion', { p_waitlist: w1.id });
    expect((await m[0].rpc('release_hold', { p_hold: h.id })).error).toBeNull();
    const [s] = await seats(o, [5]);
    expect(s.status).toBe('WAIT_ALLOCATED');
    expect(s.waitlist_id).toBe(w1.id);
    const { data: h2, error } = await m[0].rpc('hold_for_promotion', { p_waitlist: w1.id });
    expect(error).toBeNull();
    expect(h2.id).not.toBe(h.id);
  });

  it('consuming the promotion hold completes the waitlist entry', async () => {
    const { w1 } = await promoted();
    const { data: h } = await m[0].rpc('hold_for_promotion', { p_waitlist: w1.id });
    await db.from('holds').update({ status: 'CONSUMED' }).eq('id', h.id);
    const { data: w } = await db.from('waitlist').select('status').eq('id', w1.id).single();
    expect(w.status).toBe('COMPLETED');
  });

  it('cancel_waitlist: owner only; allocated seats flow to the next waiter', async () => {
    const { o, w1 } = await promoted();
    expect(await failCode(m[1].rpc('cancel_waitlist', { p_id: w1.id }))).toBe('NOT_OWNER');
    await m[0].rpc('hold_for_promotion', { p_waitlist: w1.id });
    expect((await m[0].rpc('cancel_waitlist', { p_id: w1.id })).error).toBeNull();
    const [x1, x2] = await queue(o);
    expect(x1.status).toBe('CANCELLED');
    expect(x2.status).toBe('PROMOTED');
    const [s] = await seats(o, [5]);
    expect(s.waitlist_id).toBe(x2.id);
    expect(s.status).toBe('WAIT_ALLOCATED');
    const { data: h } = await db.from('holds').select('status').eq('waitlist_id', w1.id).single();
    expect(h.status).toBe('RELEASED');
  });

  it('release_inventory is internal only', async () => {
    const o = await offering('PERFORMANCE');
    const { error } = await m[0].rpc('release_inventory', { p_offering: o.id, p_seat_ids: [1], p_qty: 1 });
    expect(error).not.toBeNull();
  });
});
