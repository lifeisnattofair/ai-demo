import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMockGateway } from '../../supabase/functions/_shared/payments/gateway.js';
import { cancelBooking, cancelOffering } from '../../supabase/functions/_shared/payments/cancel.js';
import { handleWebhook } from '../../supabase/functions/_shared/payments/webhook.js';
import { createDbAdapter, createPgMockStore } from '../../supabase/functions/_shared/payments/supabase-adapter.js';
import { adminClient, resetDb, setClock, userClient } from './helpers.js';

// 기준 base = 12/01 00:00 KST. 공연 회차는 base+10일(12/11 00:00 KST), 체험은 base+5일, 정규 강좌 첫 회는 base+9일.
const BASE = '2026-12-01T00:00:00+09:00';
const db = adminClient();
const adapter = createDbAdapter(db);
const pg = createMockGateway({ store: createPgMockStore(db) });
let m = [];
let uid = [];
let financeId;
let operatorId;
let seq = 0;

// 다른 트랜잭션이 잠금을 쥐고 있는 상황을 만들려고 DB 컨테이너의 psql을 씁니다(없으면 해당 테스트만 건너뜀).
const DB_CONTAINER = `supabase_db_${readFileSync('supabase/config.toml', 'utf8').match(/^project_id = "(.+)"/m)[1]}`;
const dockerOk = (() => {
  try { execFileSync('docker', ['exec', DB_CONTAINER, 'true'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const psql = (sql) => new Promise((resolve, reject) => {
  execFile('docker', ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    (err, out) => (err ? reject(err) : resolve(out)));
});
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const at = (iso) => setClock(Date.parse(iso) - Date.now());
const orderId = () => `HB-20261201-C${String(Date.now() % 1e6).padStart(6, '0')}${String(seq++).padStart(3, '0')}`;

async function ok(promise) {
  const { data, error } = await promise;
  expect(error).toBeNull();
  return data;
}

async function failCode(promise) {
  const { data, error } = await promise;
  return error ? error.message : data;
}

async function offering(type, idx = 0) {
  const { data: progs } = await db.from('programs').select('id').eq('type', type).order('title');
  const { data } = await db.from('offerings').select('*').eq('program_id', progs[0].id).order('starts_at');
  return data[idx];
}

async function appNow() {
  return new Date(await ok(db.rpc('app_now')));
}

// 선점 -> prepare_payment -> lock -> 모의 결제 승인 -> finalize_booking (payments-confirm과 같은 순서)
async function book(client, o, { seatIds, qty, amount }) {
  const hold = seatIds
    ? await ok(client.rpc('hold_seats', { p_offering: o.id, p_seat_ids: seatIds }))
    : await ok(client.rpc('hold_capacity', { p_offering: o.id, p_qty: qty }));
  const oid = orderId();
  const items = seatIds ? seatIds.map((seatId) => ({ seatId, discountType: 'GENERAL' })) : Array.from({ length: qty }, () => ({ discountType: 'GENERAL' }));
  await ok(client.rpc('prepare_payment', { p_hold: hold.id, p_items: items, p_amount: amount, p_order_id: oid }));
  await ok(db.rpc('lock_for_confirm', { p_order_id: oid }));
  const paymentKey = `pk_${oid}`;
  const payment = await pg.confirm({ paymentKey, orderId: oid, amount });
  const booking = await ok(db.rpc('finalize_booking', { p_order_id: oid, p_payment_key: paymentKey, p_raw: payment }));
  return { booking, paymentKey };
}

async function sellOutSeats(o) {
  await ok(db.from('inventory_seats').update({ status: 'SOLD' }).eq('offering_id', o.id).eq('status', 'AVAILABLE'));
}

async function join(i, o, qty) {
  return ok(m[i].rpc('join_waitlist', { p_offering: o.id, p_qty: qty }));
}

const seat = async (o, id) => ok(db.from('inventory_seats').select('*').eq('offering_id', o.id).eq('seat_id', id).single());
const row = async (table, id) => ok(db.from(table).select('*').eq('id', id).single());
const notes = async (userId, kind) => ok(db.from('notifications').select('*').eq('user_id', userId).eq('kind', kind));
const refundsOf = async (bookingId) => ok(db.from('refunds').select('*').eq('booking_id', bookingId));
const paymentOf = async (bookingId) => ok(db.from('payments').select('*').eq('booking_id', bookingId).single());

beforeAll(async () => {
  m = await Promise.all(['member1', 'member2', 'member3'].map((n) => userClient(`${n}@demo.test`)));
  uid = (await Promise.all(m.map((c) => c.auth.getUser()))).map((r) => r.data.user.id);
  const { data: staff } = await db.from('profiles').select('id, role').in('role', ['finance', 'operator']);
  financeId = staff.find((s) => s.role === 'finance').id;
  operatorId = staff.find((s) => s.role === 'operator').id;
});

beforeEach(async () => {
  await resetDb(BASE);
  await at(BASE);
});

describe('cancel_context', () => {
  it('performance: base date = starts_at, payment key and owner', async () => {
    const o = await offering('PERFORMANCE');
    const { booking, paymentKey } = await book(m[0], o, { seatIds: [1], amount: 40000 });
    const c = await ok(db.rpc('cancel_context', { p_booking: booking.id }));
    expect(c).toMatchObject({
      productType: 'PERFORMANCE', paidAmount: 40000, paymentKey, status: 'CONFIRMED', ownerId: uid[0], lessonStarts: null,
    });
    expect(Date.parse(c.baseAt)).toBe(Date.parse(o.starts_at));
  });

  it('course: base date = first lesson, lessonStarts lists all 12 lessons', async () => {
    const o = await offering('COURSE');
    const { booking } = await book(m[0], o, { qty: 1, amount: 120000 });
    const c = await ok(db.rpc('cancel_context', { p_booking: booking.id }));
    expect(c.productType).toBe('COURSE');
    expect(c.lessonStarts).toHaveLength(12);
    expect(Date.parse(c.baseAt)).toBe(Date.parse(c.lessonStarts[0]));
  });

  it('is service-role only', async () => {
    const o = await offering('PERFORMANCE');
    const { booking } = await book(m[0], o, { seatIds: [1], amount: 40000 });
    expect(await failCode(m[0].rpc('cancel_context', { p_booking: booking.id }))).toMatch(/permission denied/);
    expect(await failCode(m[0].rpc('finalize_cancel', {
      p_booking: booking.id, p_refund: 40000, p_fee: 0, p_rule: 'D8_PLUS', p_reason: 'USER', p_tx_key: 'x',
    }))).toMatch(/permission denied/);
  });
});

describe('user cancellation', () => {
  it('cancelled performance seat goes to the waitlist head (Task 5 rule runs in the cancel flow)', async () => {
    const o = await offering('PERFORMANCE');
    const { booking, paymentKey } = await book(m[0], o, { seatIds: [1], amount: 40000 });
    await sellOutSeats(o);
    const w1 = await join(1, o, 1);
    const w2 = await join(2, o, 1);

    // 12/05 10:00 KST = D-6 -> 90% 환불
    await at('2026-12-05T10:00:00+09:00');
    const res = await cancelBooking({ db: adapter, pg, now: await appNow() }, { userId: uid[0], bookingId: booking.id, reason: 'USER' });
    expect(res).toEqual({ status: 'CANCELLED', refundAmount: 36000, feeAmount: 4000, rule: 'D7_4' });

    const b = await row('bookings', booking.id);
    expect(b.status).toBe('CANCELLED');
    expect(Date.parse(b.cancelled_at)).toBeGreaterThan(Date.parse('2026-12-05T00:00:00+09:00'));
    const s = await seat(o, 1);
    expect(s).toMatchObject({ status: 'WAIT_ALLOCATED', waitlist_id: w1.id, hold_id: null });
    expect((await row('waitlist', w1.id)).status).toBe('PROMOTED');
    expect((await row('waitlist', w2.id)).status).toBe('WAITING');
    expect(await notes(uid[1], 'WAIT_PROMOTED')).toHaveLength(1);

    const [r] = await refundsOf(booking.id);
    expect(r).toMatchObject({ refund_amount: 36000, fee_amount: 4000, rule: 'D7_4', reason: 'USER' });
    expect(r.pg_transaction_key).toMatch(/^mock_tx_/);
    expect((await paymentOf(booking.id)).status).toBe('PARTIAL_CANCELED');
    expect(await pg.get(paymentKey)).toMatchObject({ status: 'PARTIAL_CANCELED', balanceAmount: 4000 });
    const [n] = await notes(uid[0], 'BOOKING_CANCELLED');
    expect(n.body).toContain('36,000원');
  });

  it('double cancel is idempotent: one refund row, one pg cancel', async () => {
    const o = await offering('PERFORMANCE');
    const { booking, paymentKey } = await book(m[0], o, { seatIds: [1], amount: 40000 });
    const ctx = { db: adapter, pg, now: await appNow() };
    const input = { userId: uid[0], bookingId: booking.id, reason: 'USER' };
    const first = await cancelBooking(ctx, input);
    const second = await cancelBooking(ctx, input);
    expect(first).toEqual({ status: 'CANCELLED', refundAmount: 40000, feeAmount: 0, rule: 'D8_PLUS' });
    expect(second).toEqual(first);
    expect(await refundsOf(booking.id)).toHaveLength(1);
    expect((await pg.get(paymentKey)).cancels).toHaveLength(1);
    expect((await paymentOf(booking.id)).status).toBe('CANCELED');
    // 다시 finalize를 불러도 아무것도 바뀌지 않습니다.
    await ok(db.rpc('finalize_cancel', { p_booking: booking.id, p_refund: 40000, p_fee: 0, p_rule: 'D8_PLUS', p_reason: 'USER', p_tx_key: 'x' }));
    expect(await refundsOf(booking.id)).toHaveLength(1);
  });

  it('concurrent cancels: only one claim wins', async () => {
    const o = await offering('PERFORMANCE');
    const { booking } = await book(m[0], o, { seatIds: [1], amount: 40000 });
    const claims = await Promise.all(Array.from({ length: 5 }, () => ok(db.rpc('begin_cancel', { p_booking: booking.id, p_rule: 'D8_PLUS' }))));
    expect(claims.filter(Boolean)).toHaveLength(1);
    await ok(db.rpc('abort_cancel', { p_booking: booking.id }));
    expect(await ok(db.rpc('begin_cancel', { p_booking: booking.id, p_rule: 'D8_PLUS' }))).toBe(true);
  });

  it('begin_cancel records the rule, abort_cancel keeps it, a null rule keeps the earlier one', async () => {
    const o = await offering('PERFORMANCE');
    const { booking } = await book(m[0], o, { seatIds: [1], amount: 40000 });
    expect((await ok(db.rpc('cancel_context', { p_booking: booking.id }))).cancelRule).toBeNull();
    expect(await ok(db.rpc('begin_cancel', { p_booking: booking.id, p_rule: 'D7_4' }))).toBe(true);
    await ok(db.rpc('abort_cancel', { p_booking: booking.id }));
    expect((await ok(db.rpc('cancel_context', { p_booking: booking.id }))).cancelRule).toBe('D7_4');
    expect(await ok(db.rpc('begin_cancel', { p_booking: booking.id, p_rule: null }))).toBe(true);
    expect((await ok(db.rpc('cancel_context', { p_booking: booking.id }))).cancelRule).toBe('D7_4');
  });

  it('retry after PG refund + failed finalize, on the same day, records the PG refund under the first rule', async () => {
    const o = await offering('PERFORMANCE');
    const { booking, paymentKey } = await book(m[0], o, { seatIds: [1], amount: 40000 });
    await at('2026-12-05T10:00:00+09:00'); // D-6
    const failing = { ...adapter, rpc: (name, args) => (name === 'finalize_cancel' ? Promise.reject(new Error('boom')) : adapter.rpc(name, args)) };
    await expect(cancelBooking({ db: failing, pg, now: await appNow() }, { userId: uid[0], bookingId: booking.id, reason: 'USER' }))
      .rejects.toThrow('boom');
    expect((await row('bookings', booking.id)).status).toBe('CONFIRMED');

    await at('2026-12-11T00:10:00+09:00'); // 당일
    const res = await cancelBooking({ db: adapter, pg, now: await appNow() }, { userId: uid[0], bookingId: booking.id, reason: 'USER' });
    expect(res).toEqual({ status: 'CANCELLED', refundAmount: 36000, feeAmount: 4000, rule: 'D7_4' });
    const [r] = await refundsOf(booking.id);
    expect(r).toMatchObject({ refund_amount: 36000, fee_amount: 4000, rule: 'D7_4' });
    expect((await pg.get(paymentKey)).cancels).toHaveLength(1);
  });

  it('capacity offering: cancelled qty frees capacity', async () => {
    const o = await offering('EXPERIENCE');
    const { booking } = await book(m[0], o, { qty: 2, amount: 20000 });
    expect(await ok(db.rpc('used_capacity', { p_offering: o.id }))).toBe(2);
    const res = await cancelBooking({ db: adapter, pg, now: await appNow() }, { userId: uid[0], bookingId: booking.id, reason: 'USER' });
    expect(res).toMatchObject({ status: 'CANCELLED', refundAmount: 18000, feeAmount: 2000, rule: 'D7_4' }); // 12/01 -> 12/06 = D-5
    expect(await ok(db.rpc('used_capacity', { p_offering: o.id }))).toBe(0);
  });

  it('finalize_cancel rejects amounts that do not add up to the payment', async () => {
    const o = await offering('PERFORMANCE');
    const { booking } = await book(m[0], o, { seatIds: [1], amount: 40000 });
    expect(await failCode(db.rpc('finalize_cancel', {
      p_booking: booking.id, p_refund: 36000, p_fee: 0, p_rule: 'D7_4', p_reason: 'USER', p_tx_key: 'x',
    }))).toBe('AMOUNT_MISMATCH');
    expect(await failCode(db.rpc('finalize_cancel', {
      p_booking: booking.id, p_refund: 40000, p_fee: 0, p_rule: 'INSTITUTION_FULL', p_reason: 'INSTITUTION', p_tx_key: 'x',
    }))).toBe('OFFERING_NOT_CANCELLED');
    expect((await row('bookings', booking.id)).status).toBe('CONFIRMED');
  });
});

describe('institution bulk cancellation', () => {
  async function approve(o) {
    await ok(db.from('offering_cancel_requests').insert({
      offering_id: o.id, requested_by: operatorId, reason: '시설 점검', status: 'APPROVED', decided_by: financeId,
    }));
  }

  it('refunds every booking in full, closes the sale and skips the waitlist', async () => {
    const o = await offering('PERFORMANCE');
    const a = await book(m[0], o, { seatIds: [1, 2], amount: 80000 });
    const b = await book(m[1], o, { seatIds: [3], amount: 40000 });
    await sellOutSeats(o);
    const w = await join(2, o, 1);
    await approve(o);

    await at('2026-12-10T10:00:00+09:00'); // D-1(사용자라면 70%)이어도 전액
    const res = await cancelOffering({ db: adapter, pg, now: await appNow() }, { userId: financeId, offeringId: o.id });
    expect(res.failed).toEqual([]);
    expect(res.cancelled.map((c) => c.bookingId).sort()).toEqual([a.booking.id, b.booking.id].sort());
    for (const c of res.cancelled) expect(c).toMatchObject({ feeAmount: 0, rule: 'INSTITUTION_FULL' });

    expect((await row('offerings', o.id)).status).toBe('CANCELLED');
    for (const id of [1, 2, 3]) expect(await seat(o, id)).toMatchObject({ status: 'AVAILABLE', waitlist_id: null });
    expect((await row('waitlist', w.id)).status).toBe('CANCELLED');
    expect(await notes(uid[2], 'WAIT_PROMOTED')).toHaveLength(0);
    expect(await notes(uid[0], 'OFFERING_CANCELLED')).toHaveLength(1);
    expect(await notes(uid[1], 'OFFERING_CANCELLED')).toHaveLength(1);
    expect(await notes(uid[0], 'BOOKING_CANCELLED')).toHaveLength(0);
    const [r] = await refundsOf(a.booking.id);
    expect(r).toMatchObject({ refund_amount: 80000, fee_amount: 0, reason: 'INSTITUTION', rule: 'INSTITUTION_FULL' });
    expect((await paymentOf(a.booking.id)).status).toBe('CANCELED');
    expect(await pg.get(a.paymentKey)).toMatchObject({ status: 'CANCELED', balanceAmount: 0 });
    // 판매가 닫혔습니다.
    expect(await failCode(m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [1] }))).toBe('NOT_ON_SALE');

    // 다시 불러도 추가 환불이 없습니다.
    const again = await cancelOffering({ db: adapter, pg, now: await appNow() }, { userId: financeId, offeringId: o.id });
    expect(again).toMatchObject({ cancelled: [], failed: [] });
    expect(await refundsOf(a.booking.id)).toHaveLength(1);
  });

  it('requires finance role and an approved request', async () => {
    const o = await offering('PERFORMANCE');
    await book(m[0], o, { seatIds: [1], amount: 40000 });
    expect(await failCode(db.rpc('begin_offering_cancel', { p_offering: o.id, p_actor: operatorId }))).toBe('FORBIDDEN');
    expect(await failCode(db.rpc('begin_offering_cancel', { p_offering: o.id, p_actor: financeId }))).toBe('CANCEL_NOT_APPROVED');
    await ok(db.from('offering_cancel_requests').insert({ offering_id: o.id, requested_by: operatorId, status: 'REQUESTED' }));
    expect(await failCode(db.rpc('begin_offering_cancel', { p_offering: o.id, p_actor: financeId }))).toBe('CANCEL_NOT_APPROVED');
    expect((await row('offerings', o.id)).status).toBe('OPEN');
    await expect(cancelOffering({ db: adapter, pg, now: await appNow() }, { userId: operatorId, offeringId: o.id }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  // 선점 + prepare_payment까지(결제 승인 전)
  async function prepared(client, o, seatIds, amount) {
    const hold = await ok(client.rpc('hold_seats', { p_offering: o.id, p_seat_ids: seatIds }));
    const oid = orderId();
    await ok(client.rpc('prepare_payment', {
      p_hold: hold.id, p_items: seatIds.map((seatId) => ({ seatId, discountType: 'GENERAL' })), p_amount: amount, p_order_id: oid,
    }));
    return { hold, oid };
  }

  it('prepare_payment and lock_for_confirm reject an offering that is no longer OPEN (NOT_ON_SALE)', async () => {
    const o = await offering('PERFORMANCE');
    const h1 = await ok(m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [1] }));
    const p2 = await prepared(m[1], o, [2], 40000);
    await ok(db.from('offerings').update({ status: 'CANCEL_REQUESTED' }).eq('id', o.id));

    expect(await failCode(m[0].rpc('prepare_payment', {
      p_hold: h1.id, p_items: [{ seatId: 1, discountType: 'GENERAL' }], p_amount: 40000, p_order_id: orderId(),
    }))).toBe('NOT_ON_SALE');
    expect(await failCode(db.rpc('lock_for_confirm', { p_order_id: p2.oid }))).toBe('NOT_ON_SALE');
    expect((await row('holds', p2.hold.id)).status).toBe('ACTIVE');
    expect((await seat(o, 2)).status).toBe('HELD');

    // 승인 전 거절이므로 결제대행사 승인도 일어나지 않습니다.
    const { confirmPayment } = await import('../../supabase/functions/_shared/payments/confirm.js');
    await expect(confirmPayment({ db: { ...adapter, findBookingByOrder: async () => null }, pg }, {
      userId: uid[1], paymentKey: `pk_${p2.oid}`, orderId: p2.oid, amount: 40000,
    })).rejects.toMatchObject({ code: 'NOT_ON_SALE' });
    expect(await pg.get(`pk_${p2.oid}`).catch((e) => e.code)).toBe('NOT_FOUND_PAYMENT');
  });

  it('a payment in progress during bulk cancel is reported as pending, and a re-run refunds it once confirmed', async () => {
    const o = await offering('PERFORMANCE');
    const a = await book(m[0], o, { seatIds: [1], amount: 40000 });
    const p = await prepared(m[1], o, [2], 40000);
    await ok(db.rpc('lock_for_confirm', { p_order_id: p.oid })); // PAYING
    await approve(o);

    const first = await cancelOffering({ db: adapter, pg, now: await appNow() }, { userId: financeId, offeringId: o.id });
    expect(first.cancelled.map((c) => c.bookingId)).toEqual([a.booking.id]);
    expect(first.pending).toBe(1);
    expect(first.pendingMessage).toContain('1건');
    expect((await row('holds', p.hold.id)).status).toBe('PAYING');

    // 승인된 결제는 확정까지 갑니다(돈이 이미 나갔으므로).
    const paymentKey = `pk_${p.oid}`;
    const payment = await pg.confirm({ paymentKey, orderId: p.oid, amount: 40000 });
    const late = await ok(db.rpc('finalize_booking', { p_order_id: p.oid, p_payment_key: paymentKey, p_raw: payment }));
    expect(late.status).toBe('CONFIRMED');

    const second = await cancelOffering({ db: adapter, pg, now: await appNow() }, { userId: financeId, offeringId: o.id });
    expect(second).toMatchObject({ pending: 0, failed: [] });
    expect(second.cancelled).toEqual([{ bookingId: late.id, status: 'CANCELLED', refundAmount: 40000, feeAmount: 0, rule: 'INSTITUTION_FULL' }]);
    expect(await pg.get(paymentKey)).toMatchObject({ status: 'CANCELED' });
    expect(await seat(o, 2)).toMatchObject({ status: 'AVAILABLE', waitlist_id: null });
  });

  it('a failed payment on a cancelled offering is released, not re-activated', async () => {
    const o = await offering('PERFORMANCE');
    const p = await prepared(m[1], o, [2], 40000);
    await ok(db.rpc('lock_for_confirm', { p_order_id: p.oid }));
    await approve(o);
    await ok(db.rpc('begin_offering_cancel', { p_offering: o.id, p_actor: financeId }));
    await ok(db.rpc('unlock_after_failure', { p_order_id: p.oid })); // 만료 전이지만 회차가 취소됨
    expect((await row('holds', p.hold.id)).status).toBe('EXPIRED');
    expect(await seat(o, 2)).toMatchObject({ status: 'AVAILABLE', hold_id: null });
  });
});

describe('webhook', () => {
  it('re-queries pg and applies a changed status once', async () => {
    const o = await offering('PERFORMANCE');
    const { booking, paymentKey } = await book(m[0], o, { seatIds: [1], amount: 40000 });
    const body = { eventType: 'PAYMENT_STATUS_CHANGED', data: { paymentKey, status: 'CANCELED' } };
    expect(await handleWebhook({ db: adapter, pg }, body)).toEqual({ applied: false }); // pg는 아직 DONE
    await pg.cancel(paymentKey, { cancelReason: '결제대행사 취소' });
    expect(await handleWebhook({ db: adapter, pg }, body)).toEqual({ applied: true });
    expect(await handleWebhook({ db: adapter, pg }, body)).toEqual({ applied: false });
    expect((await paymentOf(booking.id)).status).toBe('CANCELED');
  });
});

describe('lock order (offering -> holds)', () => {
  it.skipIf(!dockerOk)('duplicate confirm (lock_for_confirm) racing finalize_booking on the same order does not deadlock', async () => {
    const o = await offering('PERFORMANCE');
    const hold = await ok(m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [1] }));
    const oid = orderId();
    await ok(m[0].rpc('prepare_payment', {
      p_hold: hold.id, p_items: [{ seatId: 1, discountType: 'GENERAL' }], p_amount: 40000, p_order_id: oid,
    }));
    await ok(db.rpc('lock_for_confirm', { p_order_id: oid }));
    const paymentKey = `pk_${oid}`;
    const payment = await pg.confirm({ paymentKey, orderId: oid, amount: 40000 });

    // 다른 트랜잭션이 회차 행을 잠근 동안 중복 확정 요청(lock_for_confirm)이 먼저, finalize_booking이 뒤에 줄을 섭니다.
    // 예전 순서(finalize가 선점을 먼저 잠그고 예약 insert의 FK가 회차를 잠금)면 잠금이 풀리는 순간 교착됩니다.
    const blocker = psql(`begin; select 1 from public.offerings where id = '${o.id}' for update; select pg_sleep(4); commit;`);
    await pause(1500);
    const dup = db.rpc('lock_for_confirm', { p_order_id: oid });
    await pause(400);
    const fin = db.rpc('finalize_booking', { p_order_id: oid, p_payment_key: paymentKey, p_raw: payment });
    const [d, f] = await Promise.all([dup, fin]);
    await blocker;

    expect(String(d.error?.message ?? '')).not.toMatch(/deadlock/i);
    expect(String(f.error?.message ?? '')).not.toMatch(/deadlock/i);
    expect(d.error?.message).toBe('PAYMENT_IN_PROGRESS');
    expect(f.error).toBeNull();
    expect(f.data.status).toBe('CONFIRMED');
    const bookings = await ok(db.from('bookings').select('id, status').eq('hold_id', hold.id));
    expect(bookings).toEqual([{ id: f.data.id, status: 'CONFIRMED' }]);
  }, 30000);
});
