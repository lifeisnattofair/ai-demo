import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DISCOUNTS } from '../../supabase/functions/_shared/policy/pricing.js';
import { adminClient, resetDb, setClock, userClient } from './helpers.js';

const db = adminClient();
const MIN = 60 * 1000;
let m = [];
let uid = [];
let seq = 0;

const orderId = () => `HB-20261123-T${String(Date.now() % 1e6).padStart(6, '0')}${String(seq++).padStart(3, '0')}`;

async function offering(type, idx = 0) {
  const { data: progs } = await db.from('programs').select('id').eq('type', type).order('title');
  const { data } = await db.from('offerings').select('*').eq('program_id', progs[0].id).order('starts_at');
  return data[idx];
}

async function failCode(promise) {
  const { data, error } = await promise;
  return error ? error.message : data;
}

async function ok(promise) {
  const { data, error } = await promise;
  expect(error).toBeNull();
  return data;
}

const general = (seatIds) => seatIds.map((seatId) => ({ seatId, discountType: 'GENERAL' }));

// 좌석 선점 -> prepare_payment(사용자) -> lock_for_confirm -> finalize_booking(서비스 키)
async function bookSeats(client, o, seatIds, amount) {
  const hold = await ok(client.rpc('hold_seats', { p_offering: o.id, p_seat_ids: seatIds }));
  const oid = orderId();
  await ok(client.rpc('prepare_payment', { p_hold: hold.id, p_items: general(seatIds), p_amount: amount, p_order_id: oid }));
  await ok(db.rpc('lock_for_confirm', { p_order_id: oid }));
  const booking = await ok(db.rpc('finalize_booking', {
    p_order_id: oid, p_payment_key: `pk_${oid}`, p_raw: { status: 'DONE', totalAmount: amount },
  }));
  return { hold, oid, booking };
}

beforeAll(async () => {
  m = await Promise.all(['member1', 'member2'].map((n) => userClient(`${n}@demo.test`)));
  uid = (await Promise.all(m.map((c) => c.auth.getUser()))).map((r) => r.data.user.id);
});

beforeEach(async () => {
  await resetDb(new Date(Date.now() + 24 * 60 * MIN).toISOString());
});

describe('prepare_payment', () => {
  it('stores server-side unit prices from offering_prices, order id and amount', async () => {
    const o = await offering('PERFORMANCE');
    // 좌석 1(A열, R 40000), 81(E열, S 30000)
    const hold = await ok(m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [1, 81] }));
    const oid = orderId();
    const h = await ok(m[0].rpc('prepare_payment', {
      p_hold: hold.id,
      p_items: [{ seatId: 1, discountType: 'DISABLED', unitPrice: 1 }, { seatId: 81, discountType: 'DISABLED_COMPANION' }],
      p_amount: 35000,
      p_order_id: oid,
    }));
    expect(h.order_id).toBe(oid);
    expect(h.amount).toBe(35000);
    expect(h.items).toEqual([
      { seat_id: 1, unitPrice: 40000, discountType: 'DISABLED' },
      { seat_id: 81, unitPrice: 30000, discountType: 'DISABLED_COMPANION' },
    ]);
  });

  it('capacity offering uses the grade-less price', async () => {
    const o = await offering('EXPERIENCE');
    const hold = await ok(m[0].rpc('hold_capacity', { p_offering: o.id, p_qty: 2 }));
    const h = await ok(m[0].rpc('prepare_payment', {
      p_hold: hold.id, p_items: [{ discountType: 'GENERAL' }, { discountType: 'MULTICHILD' }],
      p_amount: 17000, p_order_id: orderId(),
    }));
    expect(h.items).toEqual([
      { seat_id: null, unitPrice: 10000, discountType: 'GENERAL' },
      { seat_id: null, unitPrice: 10000, discountType: 'MULTICHILD' },
    ]);
  });

  it('rejects amount that differs from server total', async () => {
    const o = await offering('PERFORMANCE');
    const hold = await ok(m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [1, 2] }));
    expect(await failCode(m[0].rpc('prepare_payment', {
      p_hold: hold.id, p_items: general([1, 2]), p_amount: 1000, p_order_id: orderId(),
    }))).toBe('AMOUNT_MISMATCH');
  });

  it('rejects invalid discount combos, foreign seats, bad order ids and other owners', async () => {
    const o = await offering('PERFORMANCE');
    const hold = await ok(m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [1, 2] }));
    const call = (client, over) => failCode(client.rpc('prepare_payment', {
      p_hold: hold.id, p_items: general([1, 2]), p_amount: 80000, p_order_id: orderId(), ...over,
    }));
    expect(await call(m[0], { p_items: [{ seatId: 1, discountType: 'DISABLED' }, { seatId: 2, discountType: 'DISABLED' }], p_amount: 40000 }))
      .toBe('INVALID_DISCOUNT');
    expect(await call(m[0], { p_items: [{ seatId: 1, discountType: 'GENERAL' }, { seatId: 2, discountType: 'MERIT_COMPANION' }], p_amount: 60000 }))
      .toBe('INVALID_DISCOUNT');
    expect(await call(m[0], { p_items: [{ seatId: 1, discountType: 'VIP' }, { seatId: 2, discountType: 'GENERAL' }] }))
      .toBe('INVALID_DISCOUNT');
    expect(await call(m[0], { p_items: general([1, 3]) })).toBe('INVALID_REQUEST');
    expect(await call(m[0], { p_items: general([1]), p_amount: 40000 })).toBe('INVALID_REQUEST');
    expect(await call(m[0], { p_order_id: 'HB-2026-1' })).toBe('INVALID_REQUEST');
    expect(await call(m[1], {})).toBe('NOT_OWNER');
  });

  it('course has no companion discount', async () => {
    const o = await offering('COURSE');
    const hold = await ok(m[0].rpc('hold_capacity', { p_offering: o.id, p_qty: 1 }));
    expect(await failCode(m[0].rpc('prepare_payment', {
      p_hold: hold.id, p_items: [{ discountType: 'DISABLED_COMPANION' }], p_amount: 60000, p_order_id: orderId(),
    }))).toBe('INVALID_DISCOUNT');
  });

  it('discount_rate matches policy DISCOUNTS', async () => {
    for (const [type, rate] of Object.entries(DISCOUNTS)) {
      expect(await ok(db.rpc('discount_rate', { p_type: type }))).toBe(rate);
    }
  });

  it('lock/finalize/unlock are not callable by members', async () => {
    const o = await offering('PERFORMANCE');
    const hold = await ok(m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [1] }));
    const oid = orderId();
    await ok(m[0].rpc('prepare_payment', { p_hold: hold.id, p_items: general([1]), p_amount: 40000, p_order_id: oid }));
    for (const [fn, args] of [
      ['lock_for_confirm', { p_order_id: oid }],
      ['finalize_booking', { p_order_id: oid, p_payment_key: 'pk', p_raw: {} }],
      ['unlock_after_failure', { p_order_id: oid }],
    ]) {
      const { error } = await m[0].rpc(fn, args);
      expect(error).not.toBeNull();
    }
  });
});

describe('lock_for_confirm / finalize_booking', () => {
  it('prepare -> lock -> finalize: seats SOLD, one booking, booking_no B + 8 digits', async () => {
    const o = await offering('PERFORMANCE');
    const { hold, oid, booking } = await bookSeats(m[0], o, [1, 2], 80000);
    expect(booking.booking_no).toMatch(/^B\d{8}$/);
    expect(booking).toMatchObject({ user_id: uid[0], offering_id: o.id, hold_id: hold.id, status: 'CONFIRMED', total_amount: 80000 });

    const { data: seats } = await db.from('inventory_seats').select('status').eq('offering_id', o.id).in('seat_id', [1, 2]);
    expect(seats.map((s) => s.status)).toEqual(['SOLD', 'SOLD']);
    const { data: bookings } = await db.from('bookings').select('id').eq('hold_id', hold.id);
    expect(bookings).toHaveLength(1);
    const { data: h } = await db.from('holds').select('status').eq('id', hold.id).single();
    expect(h.status).toBe('CONSUMED');
    const { data: items } = await db.from('booking_items').select('seat_id, discount_type, unit_price, discount_amount, amount')
      .eq('booking_id', booking.id).order('seat_id');
    expect(items).toEqual([
      { seat_id: 1, discount_type: 'GENERAL', unit_price: 40000, discount_amount: 0, amount: 40000 },
      { seat_id: 2, discount_type: 'GENERAL', unit_price: 40000, discount_amount: 0, amount: 40000 },
    ]);
    const { data: pay } = await db.from('payments').select('*').eq('order_id', oid).single();
    expect(pay).toMatchObject({ payment_key: `pk_${oid}`, booking_id: booking.id, user_id: uid[0], amount: 80000, status: 'DONE' });
    expect(pay.approved_at).not.toBeNull();
    const { data: notes } = await db.from('notifications').select('kind, title, body').eq('user_id', uid[0]).eq('kind', 'PAYMENT_DONE');
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain(booking.booking_no);
    expect(notes[0].body).not.toMatch(/[·—]/);
  });

  it('lock moves hold and seats to PAYING; finalize is idempotent per order', async () => {
    const o = await offering('PERFORMANCE');
    const hold = await ok(m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [5] }));
    const oid = orderId();
    await ok(m[0].rpc('prepare_payment', { p_hold: hold.id, p_items: general([5]), p_amount: 40000, p_order_id: oid }));
    const locked = await ok(db.rpc('lock_for_confirm', { p_order_id: oid }));
    expect(locked.status).toBe('PAYING');
    const { data: seat } = await db.from('inventory_seats').select('status').eq('offering_id', o.id).eq('seat_id', 5).single();
    expect(seat.status).toBe('PAYING');
    expect(await failCode(db.rpc('lock_for_confirm', { p_order_id: oid }))).toBe('PAYMENT_IN_PROGRESS');

    const args = { p_order_id: oid, p_payment_key: 'pk_x', p_raw: { totalAmount: 40000 } };
    const b1 = await ok(db.rpc('finalize_booking', args));
    const b2 = await ok(db.rpc('finalize_booking', args));
    expect(b2.id).toBe(b1.id);
    expect(await failCode(db.rpc('lock_for_confirm', { p_order_id: oid }))).toBe('ALREADY_CONFIRMED');
    expect(await failCode(db.rpc('lock_for_confirm', { p_order_id: 'HB-20261123-NOSUCHORD1' }))).toBe('ORDER_NOT_FOUND');
  });

  it('finalize refuses a hold that is not PAYING or a mismatched pg amount', async () => {
    const o = await offering('PERFORMANCE');
    const hold = await ok(m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [6] }));
    const oid = orderId();
    await ok(m[0].rpc('prepare_payment', { p_hold: hold.id, p_items: general([6]), p_amount: 40000, p_order_id: oid }));
    expect(await failCode(db.rpc('finalize_booking', { p_order_id: oid, p_payment_key: 'pk', p_raw: {} })))
      .toBe('HOLD_NOT_PAYING');
    await ok(db.rpc('lock_for_confirm', { p_order_id: oid }));
    expect(await failCode(db.rpc('finalize_booking', { p_order_id: oid, p_payment_key: 'pk', p_raw: { totalAmount: 1 } })))
      .toBe('AMOUNT_MISMATCH');
    const { data: h } = await db.from('holds').select('status').eq('id', hold.id).single();
    expect(h.status).toBe('PAYING');
  });

  it('capacity booking counts toward capacity and has seat_id null items', async () => {
    const o = await offering('EXPERIENCE');
    const hold = await ok(m[0].rpc('hold_capacity', { p_offering: o.id, p_qty: 2 }));
    const oid = orderId();
    await ok(m[0].rpc('prepare_payment', {
      p_hold: hold.id, p_items: [{ discountType: 'GENERAL' }, { discountType: 'GENERAL' }], p_amount: 20000, p_order_id: oid,
    }));
    await ok(db.rpc('lock_for_confirm', { p_order_id: oid }));
    const b = await ok(db.rpc('finalize_booking', { p_order_id: oid, p_payment_key: 'pk_c', p_raw: { totalAmount: 20000 } }));
    const { data: items } = await db.from('booking_items').select('seat_id').eq('booking_id', b.id);
    expect(items).toEqual([{ seat_id: null }, { seat_id: null }]);
    expect(await ok(db.rpc('remaining_capacity', { p_offering: o.id }))).toBe(o.capacity - 2);
  });

  it('AC-3: A holds, clock +11m, B holds and confirms the same seat, A lock -> HOLD_EXPIRED', async () => {
    const o = await offering('PERFORMANCE');
    const holdA = await ok(m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [7] }));
    const oidA = orderId();
    await ok(m[0].rpc('prepare_payment', { p_hold: holdA.id, p_items: general([7]), p_amount: 40000, p_order_id: oidA }));

    await setClock(11 * MIN);
    const { booking } = await bookSeats(m[1], o, [7], 40000);
    expect(booking.user_id).toBe(uid[1]);

    expect(await failCode(db.rpc('lock_for_confirm', { p_order_id: oidA }))).toBe('HOLD_EXPIRED');
    const { data: seat } = await db.from('inventory_seats').select('status, hold_id').eq('offering_id', o.id).eq('seat_id', 7).single();
    expect(seat.status).toBe('SOLD');
    expect(seat.hold_id).toBe(booking.hold_id);
    const { data: bookings } = await db.from('bookings').select('user_id').eq('offering_id', o.id);
    expect(bookings.map((b) => b.user_id)).toEqual([uid[1]]);
  });

  it('lock on an expired ACTIVE hold (not yet swept) -> HOLD_EXPIRED', async () => {
    const o = await offering('PERFORMANCE');
    const hold = await ok(m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [8] }));
    const oid = orderId();
    await ok(m[0].rpc('prepare_payment', { p_hold: hold.id, p_items: general([8]), p_amount: 40000, p_order_id: oid }));
    await setClock(11 * MIN);
    expect(await failCode(db.rpc('lock_for_confirm', { p_order_id: oid }))).toBe('HOLD_EXPIRED');
  });
});

describe('unlock_after_failure', () => {
  async function lockedHold(seatIds) {
    const o = await offering('PERFORMANCE');
    const hold = await ok(m[0].rpc('hold_seats', { p_offering: o.id, p_seat_ids: seatIds }));
    const oid = orderId();
    await ok(m[0].rpc('prepare_payment', { p_hold: hold.id, p_items: general(seatIds), p_amount: 40000 * seatIds.length, p_order_id: oid }));
    await ok(db.rpc('lock_for_confirm', { p_order_id: oid }));
    return { o, hold, oid };
  }

  it('returns PAYING to ACTIVE and seats to HELD before expiry', async () => {
    const { o, hold, oid } = await lockedHold([9]);
    await ok(db.rpc('unlock_after_failure', { p_order_id: oid }));
    const { data: h } = await db.from('holds').select('status').eq('id', hold.id).single();
    expect(h.status).toBe('ACTIVE');
    const { data: seat } = await db.from('inventory_seats').select('status, hold_id').eq('offering_id', o.id).eq('seat_id', 9).single();
    expect(seat).toEqual({ status: 'HELD', hold_id: hold.id });
    // 다시 결제를 시도할 수 있습니다.
    expect((await ok(db.rpc('lock_for_confirm', { p_order_id: oid }))).status).toBe('PAYING');
  });

  it('past expires_at -> EXPIRED and seats AVAILABLE; no-op when not PAYING', async () => {
    const { o, hold, oid } = await lockedHold([11]);
    await setClock(11 * MIN);
    await ok(db.rpc('unlock_after_failure', { p_order_id: oid }));
    const { data: h } = await db.from('holds').select('status').eq('id', hold.id).single();
    expect(h.status).toBe('EXPIRED');
    const { data: seat } = await db.from('inventory_seats').select('status, hold_id').eq('offering_id', o.id).eq('seat_id', 11).single();
    expect(seat).toEqual({ status: 'AVAILABLE', hold_id: null });
    await ok(db.rpc('unlock_after_failure', { p_order_id: oid }));
    await ok(db.rpc('unlock_after_failure', { p_order_id: 'HB-20261123-NOSUCHORD1' }));
  });
});

describe('promotion holds', () => {
  // 승격 상태(배정 좌석 1석, 결제 기한 24시간)를 직접 만든 뒤 승격 선점을 잡습니다.
  async function promotedLocked(seatId) {
    const o = await offering('PERFORMANCE');
    const { data: now } = await db.rpc('app_now');
    const w = await ok(db.from('waitlist').insert({
      offering_id: o.id, user_id: uid[0], qty: 1, allocated_qty: 1, status: 'PROMOTED',
      promoted_at: now, deadline_at: new Date(Date.parse(now) + 24 * 60 * MIN).toISOString(),
    }).select().single());
    await ok(db.from('inventory_seats').update({ status: 'WAIT_ALLOCATED', waitlist_id: w.id })
      .eq('offering_id', o.id).eq('seat_id', seatId));
    const hold = await ok(m[0].rpc('hold_for_promotion', { p_waitlist: w.id }));
    const oid = orderId();
    await ok(m[0].rpc('prepare_payment', { p_hold: hold.id, p_items: general([seatId]), p_amount: 40000, p_order_id: oid }));
    await ok(db.rpc('lock_for_confirm', { p_order_id: oid }));
    return { o, w, hold, oid };
  }

  it('finalize completes the promoted waitlist entry', async () => {
    const { o, w, oid } = await promotedLocked(12);
    await ok(db.rpc('finalize_booking', { p_order_id: oid, p_payment_key: 'pk_w', p_raw: { totalAmount: 40000 } }));
    const { data: wl } = await db.from('waitlist').select('status').eq('id', w.id).single();
    expect(wl.status).toBe('COMPLETED');
    const { data: seat } = await db.from('inventory_seats').select('status, waitlist_id').eq('offering_id', o.id).eq('seat_id', 12).single();
    expect(seat).toEqual({ status: 'SOLD', waitlist_id: null });
  });

  it('PAYING promotion hold survives the deadline sweep', async () => {
    const { o, w } = await promotedLocked(13);
    await setClock(25 * 60 * MIN);
    await ok(db.rpc('sweep_offering', { p_offering: o.id }));
    const { data: wl } = await db.from('waitlist').select('status').eq('id', w.id).single();
    expect(wl.status).toBe('PROMOTED');
  });

  it('unlock past the deadline hands the seat back to the waitlist logic', async () => {
    const { o, w, hold, oid } = await promotedLocked(14);
    await setClock(25 * 60 * MIN);
    await ok(db.rpc('unlock_after_failure', { p_order_id: oid }));
    const { data: h } = await db.from('holds').select('status').eq('id', hold.id).single();
    expect(h.status).toBe('EXPIRED');
    const { data: wl } = await db.from('waitlist').select('status').eq('id', w.id).single();
    expect(wl.status).toBe('EXPIRED');
    const { data: seat } = await db.from('inventory_seats').select('status, hold_id, waitlist_id')
      .eq('offering_id', o.id).eq('seat_id', 14).single();
    expect(seat).toEqual({ status: 'AVAILABLE', hold_id: null, waitlist_id: null });
  });

  it('unlock before the deadline keeps the promotion hold usable', async () => {
    const { o, hold, oid } = await promotedLocked(15);
    await ok(db.rpc('unlock_after_failure', { p_order_id: oid }));
    const { data: h } = await db.from('holds').select('status').eq('id', hold.id).single();
    expect(h.status).toBe('ACTIVE');
    const { data: seat } = await db.from('inventory_seats').select('status').eq('offering_id', o.id).eq('seat_id', 15).single();
    expect(seat.status).toBe('HELD');
  });
});
