import { describe, expect, it, vi } from 'vitest';
import { createMockGateway, memoryStore } from '../../supabase/functions/_shared/payments/gateway.js';
import {
  CANCEL_REJECT_MESSAGES, cancelBooking, cancelOffering,
} from '../../supabase/functions/_shared/payments/cancel.js';

const USER = 'user-a';
const OTHER = 'user-b';
const FINANCE = 'finance-1';
const KEY = 'pk_test_1';
const ORDER = 'HB-20261123-AbCdE12345';
// 공연 기준일 12/11 19:00 KST
const PERF_AT = '2026-12-11T10:00:00.000Z';
const kst = (s) => new Date(`${s}+09:00`);

function ctx(over = {}) {
  return {
    productType: 'PERFORMANCE', paidAmount: 40000, baseAt: PERF_AT, lessonStarts: null,
    paymentKey: KEY, status: 'CONFIRMED', ownerId: USER, offeringId: 'off-1', offeringStatus: 'OPEN', refund: null,
    ...over,
  };
}

const BOOKING = { id: 'b-1', status: 'CANCELLED' };

class DbError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fakeDb({ context = ctx(), contexts, claim = true, finalizeError, role = 'finance', offeringBookings = [] } = {}) {
  const calls = [];
  return {
    calls,
    count: (name) => calls.filter((c) => c.name === name).length,
    args: (name) => calls.find((c) => c.name === name)?.args,
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'cancel_context') {
        const c = contexts ? contexts[args.p_booking] : context;
        if (!c) throw new DbError('BOOKING_NOT_FOUND');
        if (c instanceof Error) throw c;
        return structuredClone(c);
      }
      if (name === 'begin_cancel') return claim;
      if (name === 'abort_cancel') return null;
      if (name === 'finalize_cancel') {
        if (finalizeError) throw finalizeError;
        return BOOKING;
      }
      if (name === 'begin_offering_cancel') return { offeringId: args.p_offering, bookingIds: offeringBookings };
      throw new Error(`unexpected rpc ${name}`);
    },
    getRole: vi.fn(async () => role),
  };
}

async function paidGateway(amount = 40000, key = KEY, order = ORDER) {
  const pg = createMockGateway({ store: memoryStore() });
  await pg.confirm({ paymentKey: key, orderId: order, amount });
  for (const m of ['confirm', 'cancel', 'get']) vi.spyOn(pg, m);
  return pg;
}

describe('cancelBooking (USER)', () => {
  it('D-7 performance 40000 refunds 36000 with fee 4000 (D7_4)', async () => {
    const db = fakeDb();
    const pg = await paidGateway();
    const res = await cancelBooking({ db, pg, now: kst('2026-12-04T10:00:00') }, { userId: USER, bookingId: 'b-1', reason: 'USER' });
    expect(res).toMatchObject({ status: 'CANCELLED', refundAmount: 36000, feeAmount: 4000, rule: 'D7_4' });
    expect(pg.cancel).toHaveBeenCalledTimes(1);
    expect(pg.cancel).toHaveBeenCalledWith(KEY, { cancelReason: '고객 취소', cancelAmount: 36000 });
    const fin = db.args('finalize_cancel');
    expect(fin).toMatchObject({ p_booking: 'b-1', p_refund: 36000, p_fee: 4000, p_rule: 'D7_4', p_reason: 'USER' });
    expect(fin.p_tx_key).toMatch(/^mock_tx_/);
    expect((await pg.get(KEY)).balanceAmount).toBe(4000);
    // 순서: context -> claim -> finalize
    expect(db.calls.map((c) => c.name)).toEqual(['cancel_context', 'begin_cancel', 'finalize_cancel']);
  });

  it('same day is REJECTED without any pg call', async () => {
    const db = fakeDb();
    const pg = await paidGateway();
    const res = await cancelBooking({ db, pg, now: kst('2026-12-11T09:00:00') }, { userId: USER, bookingId: 'b-1', reason: 'USER' });
    expect(res).toEqual({ status: 'REJECTED', message: '관람(개강) 당일에는 취소할 수 없습니다.' });
    expect(pg.cancel).not.toHaveBeenCalled();
    expect(pg.get).not.toHaveBeenCalled();
    expect(db.count('begin_cancel')).toBe(0);
    expect(db.count('finalize_cancel')).toBe(0);
  });

  it('course past half refunds 0: no pg cancel, finalize with p_refund=0', async () => {
    // 12회 중 6회 시작 -> MID_AFTER_1_2
    const lessons = Array.from({ length: 12 }, (_, i) => new Date(Date.parse('2026-12-10T10:00:00Z') + i * 7 * 86400000).toISOString());
    const db = fakeDb({ context: ctx({ productType: 'COURSE', paidAmount: 120000, baseAt: lessons[0], lessonStarts: lessons }) });
    const pg = await paidGateway(120000);
    const now = new Date(Date.parse(lessons[5]) + 3600000);
    const res = await cancelBooking({ db, pg, now }, { userId: USER, bookingId: 'b-1', reason: 'USER' });
    expect(res).toMatchObject({ status: 'CANCELLED', refundAmount: 0, feeAmount: 120000, rule: 'MID_AFTER_1_2' });
    expect(pg.cancel).not.toHaveBeenCalled();
    expect(db.args('finalize_cancel')).toMatchObject({ p_refund: 0, p_fee: 120000, p_rule: 'MID_AFTER_1_2', p_tx_key: null });
  });

  it("another user's booking is REJECTED", async () => {
    const db = fakeDb({ context: ctx({ ownerId: OTHER }) });
    const pg = await paidGateway();
    const res = await cancelBooking({ db, pg, now: kst('2026-12-01T10:00:00') }, { userId: USER, bookingId: 'b-1', reason: 'USER' });
    expect(res).toEqual({ status: 'REJECTED', message: '본인 예약만 취소할 수 있습니다.' });
    expect(pg.cancel).not.toHaveBeenCalled();
    expect(db.count('finalize_cancel')).toBe(0);
  });

  it('missing booking is REJECTED with a not-found message', async () => {
    const db = fakeDb({ contexts: {} });
    const pg = await paidGateway();
    const res = await cancelBooking({ db, pg, now: kst('2026-12-01T10:00:00') }, { userId: USER, bookingId: 'nope', reason: 'USER' });
    expect(res).toEqual({ status: 'REJECTED', message: CANCEL_REJECT_MESSAGES.BOOKING_NOT_FOUND });
  });

  it('already cancelled booking returns the recorded refund without calling pg (idempotent)', async () => {
    const db = fakeDb({ context: ctx({ status: 'CANCELLED', refund: { refundAmount: 36000, feeAmount: 4000, rule: 'D7_4' } }) });
    const pg = await paidGateway();
    const res = await cancelBooking({ db, pg, now: kst('2026-12-04T10:00:00') }, { userId: USER, bookingId: 'b-1', reason: 'USER' });
    expect(res).toEqual({ status: 'CANCELLED', refundAmount: 36000, feeAmount: 4000, rule: 'D7_4' });
    expect(pg.cancel).not.toHaveBeenCalled();
    expect(db.count('finalize_cancel')).toBe(0);
  });

  it('a concurrent cancel in progress is REJECTED and does not touch pg', async () => {
    const db = fakeDb({ claim: false });
    const pg = await paidGateway();
    const res = await cancelBooking({ db, pg, now: kst('2026-12-04T10:00:00') }, { userId: USER, bookingId: 'b-1', reason: 'USER' });
    expect(res).toEqual({ status: 'REJECTED', message: CANCEL_REJECT_MESSAGES.CANCEL_IN_PROGRESS });
    expect(pg.cancel).not.toHaveBeenCalled();
  });

  it('retry after pg cancel succeeded but finalize failed reuses the pg cancel (no second refund)', async () => {
    const pg = await paidGateway();
    const db1 = fakeDb({ finalizeError: new DbError('boom') });
    const now = kst('2026-12-04T10:00:00');
    await expect(cancelBooking({ db: db1, pg, now }, { userId: USER, bookingId: 'b-1', reason: 'USER' })).rejects.toBeTruthy();
    expect(db1.count('abort_cancel')).toBe(1);
    const tx = (await pg.get(KEY)).cancels[0].transactionKey;

    const db2 = fakeDb();
    const res = await cancelBooking({ db: db2, pg, now }, { userId: USER, bookingId: 'b-1', reason: 'USER' });
    expect(res).toMatchObject({ status: 'CANCELLED', refundAmount: 36000, feeAmount: 4000 });
    expect(pg.cancel).toHaveBeenCalledTimes(1);
    expect(db2.args('finalize_cancel')).toMatchObject({ p_refund: 36000, p_fee: 4000, p_tx_key: tx });
    expect((await pg.get(KEY)).balanceAmount).toBe(4000);
  });

  it('pg cancel failure releases the claim and rethrows', async () => {
    const db = fakeDb();
    const pg = await paidGateway();
    pg.cancel.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'INVALID_CANCEL_AMOUNT' }));
    await expect(cancelBooking({ db, pg, now: kst('2026-12-04T10:00:00') }, { userId: USER, bookingId: 'b-1', reason: 'USER' }))
      .rejects.toMatchObject({ code: 'INVALID_CANCEL_AMOUNT' });
    expect(db.count('abort_cancel')).toBe(1);
    expect(db.count('finalize_cancel')).toBe(0);
  });

  it('user cancel is REJECTED while the offering is being cancelled by the institution', async () => {
    const db = fakeDb({ context: ctx({ offeringStatus: 'CANCEL_REQUESTED' }) });
    const pg = await paidGateway();
    const res = await cancelBooking({ db, pg, now: kst('2026-12-01T10:00:00') }, { userId: USER, bookingId: 'b-1', reason: 'USER' });
    expect(res).toEqual({ status: 'REJECTED', message: CANCEL_REJECT_MESSAGES.OFFERING_CANCELLING });
    expect(pg.cancel).not.toHaveBeenCalled();
  });
});

describe('cancelBooking (INSTITUTION)', () => {
  it('refunds in full even on the same day, omitting cancelAmount', async () => {
    const db = fakeDb({ context: ctx({ offeringStatus: 'CANCELLED' }) });
    const pg = await paidGateway();
    const res = await cancelBooking({ db, pg, now: kst('2026-12-11T09:00:00') }, { userId: FINANCE, bookingId: 'b-1', reason: 'INSTITUTION' });
    expect(res).toMatchObject({ status: 'CANCELLED', refundAmount: 40000, feeAmount: 0, rule: 'INSTITUTION_FULL' });
    expect(pg.cancel).toHaveBeenCalledTimes(1);
    const [key, opts] = pg.cancel.mock.calls[0];
    expect(key).toBe(KEY);
    expect(opts).not.toHaveProperty('cancelAmount');
    expect(opts.cancelReason).toBe('기관 사정 취소');
    expect(db.args('finalize_cancel')).toMatchObject({ p_refund: 40000, p_fee: 0, p_rule: 'INSTITUTION_FULL', p_reason: 'INSTITUTION' });
    expect((await pg.get(KEY)).status).toBe('CANCELED');
  });
});

describe('cancelOffering', () => {
  it('cancels every confirmed booking in order, collects failures and keeps going', async () => {
    const pg = createMockGateway({ store: memoryStore() });
    await pg.confirm({ paymentKey: 'k1', orderId: 'o1', amount: 40000 });
    await pg.confirm({ paymentKey: 'k3', orderId: 'o3', amount: 30000 });
    vi.spyOn(pg, 'cancel');
    const contexts = {
      b1: ctx({ paymentKey: 'k1', offeringStatus: 'CANCELLED' }),
      b2: ctx({ paymentKey: 'missing', offeringStatus: 'CANCELLED' }),
      b3: ctx({ paymentKey: 'k3', paidAmount: 30000, ownerId: OTHER, offeringStatus: 'CANCELLED' }),
    };
    const db = fakeDb({ contexts, offeringBookings: ['b1', 'b2', 'b3'] });
    const res = await cancelOffering({ db, pg, now: kst('2026-12-11T09:00:00') }, { userId: FINANCE, offeringId: 'off-1' });
    expect(db.args('begin_offering_cancel')).toEqual({ p_offering: 'off-1', p_actor: FINANCE });
    expect(res.offeringId).toBe('off-1');
    expect(res.cancelled.map((c) => c.bookingId)).toEqual(['b1', 'b3']);
    expect(res.cancelled[1]).toMatchObject({ refundAmount: 30000, feeAmount: 0, rule: 'INSTITUTION_FULL' });
    expect(res.failed).toEqual([{ bookingId: 'b2', code: 'NOT_FOUND_PAYMENT', message: expect.any(String) }]);
    expect(pg.cancel).toHaveBeenCalledTimes(2);
  });

  it('non-finance users are FORBIDDEN before any DB change', async () => {
    const db = fakeDb({ role: 'operator' });
    const pg = await paidGateway();
    await expect(cancelOffering({ db, pg, now: new Date() }, { userId: 'op', offeringId: 'off-1' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.count('begin_offering_cancel')).toBe(0);
  });
});
