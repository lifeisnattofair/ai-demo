import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminClient, resetDb, setClock, userClient } from './helpers.js';

const BASE = '2026-12-01T00:00:00+09:00';
const db = adminClient();
let m = [];
let uid = [];

async function ok(promise) {
  const { data, error } = await promise;
  expect(error).toBeNull();
  return data;
}

async function offering(type) {
  const { data: progs } = await db.from('programs').select('id').eq('type', type).order('title');
  const { data } = await db.from('offerings').select('*').eq('program_id', progs[0].id).order('starts_at');
  return data[0];
}

// 결제 없이 확정 예약 한 건을 직접 넣습니다(조회 함수만 확인하면 됩니다).
async function insertBooking(userId, o, no) {
  const { data: h } = await db.from('holds').insert({ offering_id: o.id, user_id: userId, qty: 1, status: 'CONSUMED', expires_at: new Date().toISOString() }).select().single();
  const { data: b, error } = await db.from('bookings').insert({ booking_no: no, user_id: userId, offering_id: o.id, hold_id: h.id, total_amount: 40000 }).select().single();
  expect(error).toBeNull();
  return b;
}

beforeAll(async () => {
  m = await Promise.all(['member1', 'member2'].map((n) => userClient(`${n}@demo.test`)));
  uid = (await Promise.all(m.map((c) => c.auth.getUser()))).map((r) => r.data.user.id);
});

beforeEach(async () => {
  await resetDb(BASE);
  await setClock(Date.parse(BASE) - Date.now());
});

describe('my_bookings_overview', () => {
  it('본인 예약만 돌려주고 남의 예약은 한 건 지정해도 보이지 않는다', async () => {
    const o = await offering('PERFORMANCE');
    const mine = await insertBooking(uid[0], o, 'T-MY-1');
    const theirs = await insertBooking(uid[1], o, 'T-MY-2');
    const list = await ok(m[0].rpc('my_bookings_overview'));
    expect(list.map((b) => b.id)).toEqual([mine.id]);
    expect(list[0]).toMatchObject({ booking_no: 'T-MY-1', status: 'CONFIRMED', program: { type: 'PERFORMANCE' }, lesson_starts: null });
    expect(await ok(m[0].rpc('my_bookings_overview', { p_booking: theirs.id }))).toEqual([]);
  });

  it('정규 강좌는 수업 시작 목록을 담는다', async () => {
    const o = await offering('COURSE');
    const b = await insertBooking(uid[0], o, 'T-MY-C');
    const [row] = await ok(m[0].rpc('my_bookings_overview', { p_booking: b.id }));
    expect(row.lesson_starts.length).toBeGreaterThan(1);
  });
});

describe('알림', () => {
  it('읽음 처리는 본인 알림에만 적용된다', async () => {
    const { data: n } = await db.from('notifications').insert([{ user_id: uid[0], kind: 'X', title: 'a' }, { user_id: uid[1], kind: 'X', title: 'b' }]).select();
    const mine = n.find((r) => r.user_id === uid[0]);
    const theirs = n.find((r) => r.user_id === uid[1]);
    expect((await ok(m[0].rpc('my_notifications'))).map((r) => r.id)).toEqual([mine.id]);
    expect((await ok(m[0].rpc('my_counts'))).unread).toBe(1);
    await ok(m[0].rpc('mark_notification_read', { p_id: theirs.id }));
    const { data: other } = await db.from('notifications').select('read_at').eq('id', theirs.id).single();
    expect(other.read_at).toBeNull();
    await ok(m[0].rpc('mark_notification_read', { p_id: mine.id }));
    expect((await ok(m[0].rpc('my_counts'))).unread).toBe(0);
  });

  it('모두 읽음은 본인 알림만 바꾼다', async () => {
    await db.from('notifications').insert([{ user_id: uid[0], kind: 'X', title: 'a' }, { user_id: uid[1], kind: 'X', title: 'b' }]);
    expect(await ok(m[0].rpc('mark_all_notifications_read'))).toBe(1);
    expect((await ok(m[1].rpc('my_counts'))).unread).toBe(1);
  });
});

describe('my_waitlist_overview', () => {
  it('순번은 먼저 신청한 진행 중 대기 수 + 1', async () => {
    const o = await offering('PERFORMANCE');
    await db.from('waitlist').insert([{ offering_id: o.id, user_id: uid[1], qty: 2 }]);
    await db.from('waitlist').insert([{ offering_id: o.id, user_id: uid[0], qty: 3 }]);
    const [w] = await ok(m[0].rpc('my_waitlist_overview'));
    expect(w).toMatchObject({ qty: 3, status: 'WAITING', position: 2, program: { type: 'PERFORMANCE' } });
    expect((await ok(m[0].rpc('my_counts'))).waitlist).toBe(1);
  });
});
