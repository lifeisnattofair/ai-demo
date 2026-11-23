// 관리자 RPC(0010_admin.sql): 역할 확인, 프로그램/회차/가격 등록, 작업 이력, 개인정보 열람 기록
import { createClient } from '@supabase/supabase-js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminClient, resetDb, userClient } from './helpers.js';

const db = adminClient();
const DAY = 24 * 60 * 60 * 1000;
const BASE = new Date(Date.now() + DAY).toISOString();
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = createClient(process.env.API_URL, process.env.ANON_KEY, opts);
let m = [];
let uid = [];
let op;
let fin;
let operatorId;
let seq = 0;

const orderId = () => `HB-20261123-A${String(Date.now() % 1e6).padStart(6, '0')}${String(seq++).padStart(3, '0')}`;
const iso = (ms) => new Date(Date.parse(BASE) + ms).toISOString();

async function ok(promise) {
  const { data, error } = await promise;
  expect(error).toBeNull();
  return data;
}
async function code(promise) {
  const { error } = await promise;
  return error?.message ?? null;
}

async function offering(type, idx = 0) {
  const { data: progs } = await db.from('programs').select('id').eq('type', type).order('title');
  const { data } = await db.from('offerings').select('*').eq('program_id', progs[0].id).order('starts_at');
  return data[idx];
}

// 정원제 예약 확정(선점 -> 결제 준비 -> 잠금 -> 확정)
async function bookCapacity(client, o, qty, unit = 10000) {
  const hold = await ok(client.rpc('hold_capacity', { p_offering: o.id, p_qty: qty }));
  const oid = orderId();
  const items = Array.from({ length: qty }, () => ({ discountType: 'GENERAL' }));
  await ok(client.rpc('prepare_payment', { p_hold: hold.id, p_items: items, p_amount: unit * qty, p_order_id: oid }));
  await ok(db.rpc('lock_for_confirm', { p_order_id: oid }));
  return ok(db.rpc('finalize_booking', { p_order_id: oid, p_payment_key: `pk_${oid}`, p_raw: { status: 'DONE', totalAmount: unit * qty } }));
}

const audits = async (action) => ok(db.from('admin_audit').select('*').eq('action', action).order('at'));

const newProgram = (over = {}) => ({
  type: 'EXPERIENCE', title: '어린이 판화 체험', summary: '판화를 찍어 보는 체험', venue: '창작공방', audience: '초등학생', is_public: true, ...over,
});

beforeAll(async () => {
  m = await Promise.all(['member1', 'member2'].map((n) => userClient(`${n}@demo.test`)));
  uid = (await Promise.all(m.map((c) => c.auth.getUser()))).map((r) => r.data.user.id);
  op = await userClient('operator@demo.test');
  fin = await userClient('finance@demo.test');
  operatorId = (await op.auth.getUser()).data.user.id;
});

beforeEach(async () => {
  await resetDb(BASE);
});

describe('is_staff', () => {
  it('역할 목록에 내 역할이 있는지 돌려줍니다', async () => {
    expect(await ok(op.rpc('is_staff', { p_roles: ['operator'] }))).toBe(true);
    expect(await ok(op.rpc('is_staff', { p_roles: ['finance'] }))).toBe(false);
    expect(await ok(fin.rpc('is_staff', { p_roles: ['operator', 'finance'] }))).toBe(true);
    expect(await ok(fin.rpc('is_staff', { p_roles: null }))).toBe(true);
    expect(await ok(m[0].rpc('is_staff', { p_roles: ['operator', 'finance'] }))).toBe(false);
    expect(await ok(anon.rpc('is_staff', { p_roles: ['operator'] }))).toBe(false);
  });
});

describe('admin_upsert_program', () => {
  it('운영 담당이 등록하고 수정하면 작업 이력에 누가, 무엇을 바꿨는지 남습니다', async () => {
    const p = await ok(op.rpc('admin_upsert_program', { p: newProgram() }));
    expect(p).toMatchObject({ type: 'EXPERIENCE', title: '어린이 판화 체험', is_public: true });
    const [created] = await audits('PROGRAM_CREATE');
    expect(created).toMatchObject({ actor_id: operatorId, target_type: 'program', target_id: p.id });

    const u = await ok(op.rpc('admin_upsert_program', { p: { id: p.id, title: '어린이 판화 교실', is_public: false } }));
    expect(u).toMatchObject({ id: p.id, title: '어린이 판화 교실', is_public: false, venue: '창작공방' });
    const [updated] = await audits('PROGRAM_UPDATE');
    expect(updated.detail.changes.title).toEqual({ from: '어린이 판화 체험', to: '어린이 판화 교실' });
    expect(updated.detail.changes.venue).toBeUndefined();
  });

  it('필수 값이 없거나 형식이 틀리면 거절합니다', async () => {
    expect(await code(op.rpc('admin_upsert_program', { p: newProgram({ title: '  ' }) }))).toBe('INVALID_TITLE');
    expect(await code(op.rpc('admin_upsert_program', { p: newProgram({ type: 'CONCERT' }) }))).toBe('INVALID_TYPE');
    expect(await code(op.rpc('admin_upsert_program', { p: { id: '00000000-0000-4000-8000-0000000000ff', title: 'x' } }))).toBe('NOT_FOUND');
  });

  it('회차가 있는 프로그램은 유형을 바꿀 수 없습니다', async () => {
    const o = await offering('EXPERIENCE');
    expect(await code(op.rpc('admin_upsert_program', { p: { id: o.program_id, type: 'COURSE' } }))).toBe('TYPE_LOCKED');
  });

  it('정산 담당과 회원은 FORBIDDEN, 비로그인은 UNAUTHENTICATED', async () => {
    expect(await code(fin.rpc('admin_upsert_program', { p: newProgram() }))).toBe('FORBIDDEN');
    expect(await code(m[0].rpc('admin_upsert_program', { p: newProgram() }))).toBe('FORBIDDEN');
    expect(await code(anon.rpc('admin_upsert_program', { p: newProgram() }))).toMatch(/UNAUTHENTICATED|permission denied/);
  });
});

describe('admin_upsert_offering', () => {
  it('공연 회차를 등록하면 좌석 200석 재고와 등급별 가격이 만들어집니다', async () => {
    const p = await ok(op.rpc('admin_upsert_program', { p: newProgram({ type: 'PERFORMANCE', title: '송년 음악회' }) }));
    const o = await ok(op.rpc('admin_upsert_offering', { p: {
      program_id: p.id, starts_at: iso(30 * DAY), ends_at: iso(30 * DAY + 2 * 3600e3),
      sale_starts_at: iso(-DAY), sale_ends_at: iso(30 * DAY),
      prices: [{ grade: 'R', price: 50000 }, { grade: 'S', price: 40000 }, { grade: 'A', price: 30000 }],
    } }));
    expect(o.capacity).toBe(200);
    const { count } = await db.from('inventory_seats').select('*', { count: 'exact', head: true }).eq('offering_id', o.id);
    expect(count).toBe(200);
    const prices = await ok(db.from('offering_prices').select('grade, price').eq('offering_id', o.id).order('grade'));
    expect(prices).toEqual([{ grade: 'A', price: 30000 }, { grade: 'R', price: 50000 }, { grade: 'S', price: 40000 }]);
    expect((await audits('OFFERING_CREATE'))[0]).toMatchObject({ target_type: 'offering', target_id: o.id });
    expect((await audits('PRICE_SET'))).toHaveLength(1);
  });

  it('등록한 회차가 사용자용 remaining_capacity와 목록에 바로 나옵니다(AC-6)', async () => {
    const p = await ok(op.rpc('admin_upsert_program', { p: newProgram() }));
    const o = await ok(op.rpc('admin_upsert_offering', { p: {
      program_id: p.id, starts_at: iso(14 * DAY), ends_at: iso(14 * DAY + 7200e3), capacity: 12,
      sale_starts_at: iso(-DAY), sale_ends_at: iso(14 * DAY), prices: [{ grade: null, price: 15000 }],
    } }));
    expect(await ok(anon.rpc('remaining_capacity', { p_offering: o.id }))).toBe(12);
    const listed = await ok(anon.from('programs').select('id, offerings(id, capacity, prices:offering_prices(grade, price))').eq('id', p.id).single());
    expect(listed.offerings).toEqual([{ id: o.id, capacity: 12, prices: [{ grade: null, price: 15000 }] }]);
  });

  it('정규 강좌는 수업 일정을 함께 저장하고 시작 일시는 첫 수업입니다', async () => {
    const p = await ok(op.rpc('admin_upsert_program', { p: newProgram({ type: 'COURSE', title: '도예 기초 (4주)' }) }));
    const lessons = [0, 1, 2, 3].map((w) => iso((20 + 7 * w) * DAY));
    const o = await ok(op.rpc('admin_upsert_offering', { p: {
      program_id: p.id, starts_at: lessons[0], ends_at: iso(41 * DAY + 7200e3), capacity: 10,
      sale_starts_at: iso(-DAY), sale_ends_at: lessons[0], lessons, prices: [{ grade: null, price: 80000 }],
    } }));
    const rows = await ok(db.from('course_lessons').select('seq, starts_at').eq('offering_id', o.id).order('seq'));
    expect(rows.map((r) => Date.parse(r.starts_at))).toEqual(lessons.map((l) => Date.parse(l)));
    expect(await code(op.rpc('admin_upsert_offering', { p: {
      program_id: p.id, starts_at: lessons[0], ends_at: iso(41 * DAY), capacity: 10,
      sale_starts_at: iso(-DAY), sale_ends_at: lessons[0], lessons: [],
    } }))).toBe('INVALID_SCHEDULE');
  });

  it('일정 순서가 맞지 않으면 INVALID_SCHEDULE, 정원이 0 이하면 INVALID_CAPACITY', async () => {
    const o = await offering('EXPERIENCE');
    const base = { program_id: o.program_id, starts_at: iso(14 * DAY), ends_at: iso(14 * DAY + 7200e3), capacity: 10, sale_starts_at: iso(-DAY), sale_ends_at: iso(14 * DAY) };
    expect(await code(op.rpc('admin_upsert_offering', { p: { ...base, ends_at: iso(13 * DAY) } }))).toBe('INVALID_SCHEDULE');
    expect(await code(op.rpc('admin_upsert_offering', { p: { ...base, sale_ends_at: iso(15 * DAY) } }))).toBe('INVALID_SCHEDULE');
    expect(await code(op.rpc('admin_upsert_offering', { p: { ...base, capacity: 0 } }))).toBe('INVALID_CAPACITY');
    expect(await code(op.rpc('admin_upsert_offering', { p: { ...base, starts_at: iso(-2 * DAY), ends_at: iso(-2 * DAY + 3600e3), sale_ends_at: iso(-2 * DAY), sale_starts_at: iso(-3 * DAY) } }))).toBe('INVALID_SCHEDULE');
  });

  it('rejects capacity below sold+held', async () => {
    const o = await offering('EXPERIENCE');
    await bookCapacity(m[0], o, 3);
    await ok(m[1].rpc('hold_capacity', { p_offering: o.id, p_qty: 2 }));
    expect(await code(op.rpc('admin_upsert_offering', { p: { id: o.id, capacity: 4 } }))).toBe('CAPACITY_BELOW_SOLD');
    const u = await ok(op.rpc('admin_upsert_offering', { p: { id: o.id, capacity: 5 } }));
    expect(u.capacity).toBe(5);
    expect(await ok(anon.rpc('remaining_capacity', { p_offering: o.id }))).toBe(0);
    const [log] = await audits('OFFERING_UPDATE');
    expect(log.detail.changes.capacity).toEqual({ from: 20, to: 5 });
  });

  it('공연 정원은 좌석 수로 고정이고, 취소된 회차는 고칠 수 없습니다', async () => {
    const perf = await offering('PERFORMANCE');
    expect(await code(op.rpc('admin_upsert_offering', { p: { id: perf.id, capacity: 150 } }))).toBe('INVALID_CAPACITY');
    const exp = await offering('EXPERIENCE');
    await ok(db.from('offerings').update({ status: 'CANCELLED' }).eq('id', exp.id));
    expect(await code(op.rpc('admin_upsert_offering', { p: { id: exp.id, capacity: 30 } }))).toBe('OFFERING_CLOSED');
  });

  it('정산 담당은 FORBIDDEN', async () => {
    const o = await offering('EXPERIENCE');
    expect(await code(fin.rpc('admin_upsert_offering', { p: { id: o.id, capacity: 30 } }))).toBe('FORBIDDEN');
  });
});

describe('admin_set_prices', () => {
  it('price change keeps existing booking amounts', async () => {
    const o = await offering('EXPERIENCE');
    const booking = await bookCapacity(m[0], o, 2);
    await ok(op.rpc('admin_set_prices', { p_offering: o.id, p_prices: [{ grade: null, price: 15000 }] }));
    const items = await ok(db.from('booking_items').select('unit_price, amount').eq('booking_id', booking.id));
    expect(items).toEqual([{ unit_price: 10000, amount: 10000 }, { unit_price: 10000, amount: 10000 }]);
    expect((await ok(db.from('bookings').select('total_amount').eq('id', booking.id).single())).total_amount).toBe(20000);
    expect(await ok(db.from('offering_prices').select('grade, price').eq('offering_id', o.id))).toEqual([{ grade: null, price: 15000 }]);
    const [log] = await audits('PRICE_SET');
    expect(log.detail).toMatchObject({ from: [{ grade: null, price: 10000 }], to: [{ grade: null, price: 15000 }] });
  });

  it('가격 0원은 거절하고 1원은 받습니다(결제 확인이 0원 결제를 받지 않음)', async () => {
    const exp = await offering('EXPERIENCE');
    expect(await code(op.rpc('admin_set_prices', { p_offering: exp.id, p_prices: [{ grade: null, price: 0 }] }))).toBe('INVALID_PRICE');
    const perf = await offering('PERFORMANCE');
    expect(await code(op.rpc('admin_set_prices', { p_offering: perf.id, p_prices: [{ grade: 'R', price: 1000 }, { grade: 'S', price: 0 }, { grade: 'A', price: 1000 }] }))).toBe('INVALID_PRICE');
    await ok(op.rpc('admin_set_prices', { p_offering: exp.id, p_prices: [{ grade: null, price: 1 }] }));
    expect(await ok(db.from('offering_prices').select('grade, price').eq('offering_id', exp.id))).toEqual([{ grade: null, price: 1 }]);
  });

  it('공연은 R/S/A 세 등급이 모두 있어야 하고 금액은 1 이상의 정수입니다', async () => {
    const perf = await offering('PERFORMANCE');
    expect(await code(op.rpc('admin_set_prices', { p_offering: perf.id, p_prices: [{ grade: 'R', price: 1000 }] }))).toBe('INVALID_PRICE');
    expect(await code(op.rpc('admin_set_prices', { p_offering: perf.id, p_prices: [{ grade: 'R', price: 1 }, { grade: 'S', price: -1 }, { grade: 'A', price: 1 }] }))).toBe('INVALID_PRICE');
    const exp = await offering('EXPERIENCE');
    expect(await code(op.rpc('admin_set_prices', { p_offering: exp.id, p_prices: [{ grade: null, price: 10.5 }] }))).toBe('INVALID_PRICE');
    expect(await code(fin.rpc('admin_set_prices', { p_offering: exp.id, p_prices: [{ grade: null, price: 1 }] }))).toBe('FORBIDDEN');
  });
});

describe('개인정보 표시(SER-005, SER-006)', () => {
  it('회차 예약자 목록은 이름과 휴대폰을 가리고, 상세 열람은 VIEW_PII로 남습니다', async () => {
    const o = await offering('EXPERIENCE');
    const booking = await bookCapacity(m[0], o, 1);
    const list = await ok(op.rpc('staff_offering_bookings', { p_offering: o.id }));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ booking_id: booking.id, name_masked: '회***나', phone_masked: '010-****-0001', qty: 1 });
    expect(JSON.stringify(list)).not.toContain('회원 하나');

    const detail = await ok(fin.rpc('admin_view_member', { p_user: uid[0] }));
    expect(detail).toMatchObject({ name: '회원 하나', phone: '010-0000-0001', email: 'member1@demo.test' });
    const [log] = await audits('VIEW_PII');
    expect(log).toMatchObject({ target_type: 'profile', target_id: uid[0] });
    expect(await code(m[1].rpc('admin_view_member', { p_user: uid[0] }))).toBe('FORBIDDEN');
    expect(await code(m[1].rpc('staff_offering_bookings', { p_offering: o.id }))).toBe('FORBIDDEN');
  });

  it('결제 원본은 정산 담당만 함수로 보고, 열람 기록이 남습니다', async () => {
    const o = await offering('EXPERIENCE');
    const booking = await bookCapacity(m[0], o, 1);
    const pay = await ok(db.from('payments').select('id').eq('booking_id', booking.id).single());
    const raw = await ok(fin.rpc('admin_payment_raw', { p_payment: pay.id }));
    expect(raw).toMatchObject({ status: 'DONE' });
    expect((await audits('VIEW_PAYMENT_RAW'))[0]).toMatchObject({ target_type: 'payment', target_id: pay.id });
    expect(await code(op.rpc('admin_payment_raw', { p_payment: pay.id }))).toBe('FORBIDDEN');
  });
});

describe('staff 조회 함수', () => {
  it('회차별 판매/선점/잔여 집계와 대시보드 수치', async () => {
    const o = await offering('EXPERIENCE');
    await bookCapacity(m[0], o, 3);
    await ok(m[1].rpc('hold_capacity', { p_offering: o.id, p_qty: 2 }));
    const stats = await ok(op.rpc('staff_offering_stats', {}));
    expect(stats.find((s) => s.offering_id === o.id)).toMatchObject({ sold: 3, held: 2, waiting: 0, remaining: 15 });
    const dashOp = await ok(op.rpc('staff_dashboard', {}));
    expect(dashOp).toMatchObject({ today_bookings: 1, open_offerings: 10 });
    expect(dashOp.today_paid).toBeNull();
    const dashFin = await ok(fin.rpc('staff_dashboard', {}));
    expect(dashFin.today_paid).toBe(30000);
    expect(await code(m[0].rpc('staff_dashboard', {}))).toBe('FORBIDDEN');
  });
});
