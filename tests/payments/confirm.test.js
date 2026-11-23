import { describe, expect, it, vi } from 'vitest';
import { createMockGateway, memoryStore } from '../../supabase/functions/_shared/payments/gateway.js';
import {
  CANCEL_MESSAGES, ORDER_ID_RE, confirmPayment, createOrderId,
} from '../../supabase/functions/_shared/payments/confirm.js';

const USER = 'user-a';
const ORDER = 'HB-20261123-AbCdE12345';
const KEY = 'pk_test_1';
const BOOKING = { id: 'booking-1', booking_no: 'B12345678', user_id: USER, total_amount: 80000, status: 'CONFIRMED' };

const HOLD = {
  id: 'hold-1', user_id: USER, status: 'ACTIVE', order_id: ORDER, amount: 80000, qty: 2,
  items: [
    { seat_id: 1, unitPrice: 40000, discountType: 'GENERAL' },
    { seat_id: 2, unitPrice: 40000, discountType: 'GENERAL' },
  ],
};

class DbError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fakeDb({ hold = HOLD, lockError, finalizeError, existing = null } = {}) {
  const calls = [];
  return {
    calls,
    count: (name) => calls.filter((c) => c.name === name).length,
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'lock_for_confirm') {
        if (lockError) throw new DbError(lockError);
        return { ...hold, status: 'PAYING' };
      }
      if (name === 'finalize_booking') {
        if (finalizeError) throw finalizeError;
        return BOOKING;
      }
      if (name === 'unlock_after_failure') return null;
      throw new Error(`unexpected rpc ${name}`);
    },
    findBookingByOrder: vi.fn(async () => existing),
  };
}

function spyPg(opts = {}) {
  const pg = createMockGateway({ store: memoryStore(), ...opts });
  for (const m of ['confirm', 'cancel', 'get']) vi.spyOn(pg, m);
  return pg;
}

const input = (amount = 80000) => ({ userId: USER, paymentKey: KEY, orderId: ORDER, amount });

describe('confirmPayment', () => {
  it('confirms when hold amount 80000 = requested 80000', async () => {
    const db = fakeDb();
    const pg = spyPg();
    const res = await confirmPayment({ db, pg }, input());
    expect(res).toEqual({ status: 'CONFIRMED', booking: BOOKING });
    expect(pg.confirm).toHaveBeenCalledTimes(1);
    expect(pg.confirm).toHaveBeenCalledWith({ paymentKey: KEY, orderId: ORDER, amount: 80000 });
    expect(db.count('finalize_booking')).toBe(1);
    const fin = db.calls.find((c) => c.name === 'finalize_booking').args;
    expect(fin).toMatchObject({ p_order_id: ORDER, p_payment_key: KEY });
    expect(fin.p_raw).toMatchObject({ status: 'DONE', totalAmount: 80000 });
    expect(db.count('unlock_after_failure')).toBe(0);
    // 순서: lock -> confirm -> finalize
    expect(db.calls.map((c) => c.name)).toEqual(['lock_for_confirm', 'finalize_booking']);
  });

  it('recomputes with discounts from hold.items', async () => {
    const hold = {
      ...HOLD, amount: 40000,
      items: [
        { seat_id: 1, unitPrice: 40000, discountType: 'DISABLED' },
        { seat_id: 2, unitPrice: 40000, discountType: 'DISABLED_COMPANION' },
      ],
    };
    const db = fakeDb({ hold });
    const pg = spyPg();
    expect((await confirmPayment({ db, pg }, input(40000))).status).toBe('CONFIRMED');
  });

  it('AMOUNT_MISMATCH: requested 1000 != server 80000 -> no pg.confirm, unlock', async () => {
    const db = fakeDb();
    const pg = spyPg();
    const res = await confirmPayment({ db, pg }, input(1000));
    expect(res).toEqual({
      status: 'CANCELLED', reason: 'AMOUNT_MISMATCH',
      message: '결제 금액이 예약 금액과 달라 결제를 진행하지 않았습니다. 다시 시도해 주세요.',
    });
    expect(pg.confirm).not.toHaveBeenCalled();
    expect(db.count('unlock_after_failure')).toBe(1);
    expect(db.count('finalize_booking')).toBe(0);
  });

  it('AMOUNT_MISMATCH when stored hold.amount differs from recomputed total', async () => {
    const db = fakeDb({ hold: { ...HOLD, amount: 1000 } });
    const pg = spyPg();
    const res = await confirmPayment({ db, pg }, input(1000));
    expect(res.reason).toBe('AMOUNT_MISMATCH');
    expect(pg.confirm).not.toHaveBeenCalled();
  });

  it('HOLD_EXPIRED: lock fails -> no pg.confirm, nothing to cancel', async () => {
    const db = fakeDb({ lockError: 'HOLD_EXPIRED' });
    const pg = spyPg();
    const res = await confirmPayment({ db, pg }, input());
    expect(res).toEqual({
      status: 'CANCELLED', reason: 'HOLD_EXPIRED',
      message: '좌석 선점 시간이 지나 결제가 진행되지 않았습니다. 좌석을 다시 선택해 주세요.',
    });
    expect(pg.confirm).not.toHaveBeenCalled();
    expect(pg.cancel).not.toHaveBeenCalled();
    expect(db.count('unlock_after_failure')).toBe(0);
  });

  it('cancels payment when finalize fails', async () => {
    const db = fakeDb({ finalizeError: new DbError('SEAT_STATE_INVALID') });
    const pg = spyPg();
    const res = await confirmPayment({ db, pg }, input());
    expect(pg.confirm).toHaveBeenCalledTimes(1);
    expect(pg.cancel).toHaveBeenCalledTimes(1);
    expect(pg.cancel).toHaveBeenCalledWith(KEY, { cancelReason: '예약 확정 실패' });
    expect(db.count('unlock_after_failure')).toBe(1);
    expect(res).toMatchObject({ status: 'CANCELLED', reason: 'FINALIZE_FAILED', message: CANCEL_MESSAGES.FINALIZE_FAILED });
    expect((await pg.get(KEY)).status).toBe('CANCELED');
  });

  it('finalize error but booking actually committed -> CONFIRMED, no cancel', async () => {
    const db = fakeDb({ finalizeError: new Error('network') });
    db.findBookingByOrder.mockResolvedValueOnce(null).mockResolvedValueOnce(BOOKING);
    const pg = spyPg();
    const res = await confirmPayment({ db, pg }, input());
    expect(res).toEqual({ status: 'CONFIRMED', booking: BOOKING });
    expect(pg.cancel).not.toHaveBeenCalled();
    expect(db.count('unlock_after_failure')).toBe(0);
  });

  it('confirm is idempotent for same orderId', async () => {
    const db = fakeDb({ existing: BOOKING });
    const pg = spyPg();
    const res = await confirmPayment({ db, pg }, input());
    expect(res).toEqual({ status: 'CONFIRMED', booking: BOOKING });
    expect(pg.confirm).not.toHaveBeenCalled();
    expect(pg.get).not.toHaveBeenCalled();
    expect(db.calls).toHaveLength(0);
  });

  it('ALREADY_CONFIRMED from lock (race) returns the existing booking', async () => {
    const db = fakeDb({ lockError: 'ALREADY_CONFIRMED' });
    db.findBookingByOrder.mockResolvedValueOnce(null).mockResolvedValueOnce(BOOKING);
    const pg = spyPg();
    const res = await confirmPayment({ db, pg }, input());
    expect(res).toEqual({ status: 'CONFIRMED', booking: BOOKING });
    expect(pg.confirm).not.toHaveBeenCalled();
  });

  it('ALREADY_PROCESSED_PAYMENT -> pg.get then finalize', async () => {
    const db = fakeDb();
    const pg = spyPg();
    await pg.confirm({ paymentKey: KEY, orderId: ORDER, amount: 80000 });
    pg.confirm.mockClear();
    const res = await confirmPayment({ db, pg }, input());
    expect(pg.confirm).toHaveBeenCalledTimes(1);
    expect(pg.get).toHaveBeenCalledWith(KEY);
    expect(db.count('finalize_booking')).toBe(1);
    expect(res.status).toBe('CONFIRMED');
  });

  it('ALREADY_PROCESSED_PAYMENT for a different amount is not finalized', async () => {
    const db = fakeDb();
    const pg = spyPg();
    await pg.confirm({ paymentKey: KEY, orderId: ORDER, amount: 50000 });
    await expect(confirmPayment({ db, pg }, input())).rejects.toMatchObject({ code: 'ALREADY_PROCESSED_PAYMENT' });
    expect(db.count('finalize_booking')).toBe(0);
    expect(db.count('unlock_after_failure')).toBe(1);
  });

  it('card declined -> unlock and rethrow REJECT_CARD_PAYMENT, no finalize', async () => {
    const db = fakeDb();
    const pg = spyPg({ mode: 'DECLINE' });
    await expect(confirmPayment({ db, pg }, input())).rejects.toMatchObject({ code: 'REJECT_CARD_PAYMENT' });
    expect(db.count('unlock_after_failure')).toBe(1);
    expect(db.count('finalize_booking')).toBe(0);
    expect(pg.cancel).not.toHaveBeenCalled();
  });

  it('PAYMENT_IN_PROGRESS from lock is rethrown without touching pg', async () => {
    const db = fakeDb({ lockError: 'PAYMENT_IN_PROGRESS' });
    const pg = spyPg();
    await expect(confirmPayment({ db, pg }, input())).rejects.toMatchObject({ code: 'PAYMENT_IN_PROGRESS' });
    expect(pg.confirm).not.toHaveBeenCalled();
    expect(db.count('unlock_after_failure')).toBe(0);
  });

  it('another user cannot confirm the hold -> NOT_OWNER, unlock, no pg', async () => {
    const db = fakeDb();
    const pg = spyPg();
    await expect(confirmPayment({ db, pg }, { ...input(), userId: 'user-b' }))
      .rejects.toMatchObject({ code: 'NOT_OWNER' });
    expect(pg.confirm).not.toHaveBeenCalled();
    expect(db.count('unlock_after_failure')).toBe(1);
  });

  it('idempotent lookup does not leak another user booking', async () => {
    const db = fakeDb({ existing: BOOKING });
    const pg = spyPg();
    await expect(confirmPayment({ db, pg }, { ...input(), userId: 'user-b' }))
      .rejects.toMatchObject({ code: 'NOT_OWNER' });
  });

  it('rejects malformed input before any call', async () => {
    const db = fakeDb();
    const pg = spyPg();
    for (const bad of [
      { ...input(), orderId: 'bad' },
      { ...input(), amount: 1.5 },
      { ...input(), amount: 0 },
      { ...input(), paymentKey: '' },
    ]) {
      await expect(confirmPayment({ db, pg }, bad)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(db.calls).toHaveLength(0);
    expect(pg.confirm).not.toHaveBeenCalled();
  });
});

describe('createOrderId', () => {
  it('HB-YYYYMMDD- + 10 alphanumerics, date in KST', () => {
    const id = createOrderId(new Date('2026-11-23T16:30:00Z')); // KST 11/24 01:30
    expect(id).toMatch(ORDER_ID_RE);
    expect(id.startsWith('HB-20261124-')).toBe(true);
    expect(id).toHaveLength(22);
    expect(id).toMatch(/^[A-Za-z0-9_-]{6,64}$/);
  });

  it('is random per call', () => {
    const now = new Date('2026-11-23T00:00:00Z');
    expect(createOrderId(now)).not.toBe(createOrderId(now));
  });
});
