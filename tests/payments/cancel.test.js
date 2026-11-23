import { describe, expect, it, vi } from 'vitest';
import { createMockGateway, memoryStore } from '../../supabase/functions/_shared/payments/gateway.js';
import {
  CANCEL_REJECT_MESSAGES, PENDING_PAYMENTS_MESSAGE, cancelBooking, cancelOffering,
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

// context 객체는 DB 행처럼 상태를 가집니다(begin_cancel이 cancelRule을 남김). 여러 시도에 같은 객체를 넘기면 재시도를 흉내 냅니다.
function fakeDb({ context = ctx(), contexts, claim = true, finalizeError, role = 'finance', offeringBookings = [], pendingPayments = 0 } = {}) {
  const calls = [];
  const find = (id) => (contexts ? contexts[id] : context);
  return {
    calls,
    count: (name) => calls.filter((c) => c.name === name).length,
    args: (name) => calls.find((c) => c.name === name)?.args,
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'cancel_context') {
        const c = find(args.p_booking);
        if (!c) throw new DbError('BOOKING_NOT_FOUND');
        if (c instanceof Error) throw c;
        return structuredClone(c);
      }
      if (name === 'begin_cancel') {
        if (claim) find(args.p_booking).cancelRule = args.p_rule ?? find(args.p_booking).cancelRule;
        return claim;
      }
      if (name === 'abort_cancel') return null;
      if (name === 'finalize_cancel') {
        if (finalizeError) throw finalizeError;
        return BOOKING;
      }
      if (name === 'begin_offering_cancel') return { offeringId: args.p_offering, bookingIds: offeringBookings, pendingPayments };
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

  // 첫 시도: D-7에 PG 36000 환불 뒤 finalize 실패. 같은 예약 행(context)으로 다시 시도합니다.
  async function failAfterPgCancel() {
    const pg = await paidGateway();
    const row = ctx();
    const db1 = fakeDb({ context: row, finalizeError: new DbError('boom') });
    await expect(cancelBooking({ db: db1, pg, now: kst('2026-12-04T10:00:00') }, { userId: USER, bookingId: 'b-1', reason: 'USER' }))
      .rejects.toBeTruthy();
    expect(db1.count('abort_cancel')).toBe(1);
    expect(db1.args('begin_cancel')).toEqual({ p_booking: 'b-1', p_rule: 'D7_4' });
    expect(row.cancelRule).toBe('D7_4');
    return { pg, row, tx: (await pg.get(KEY)).cancels[0].transactionKey };
  }

  it('retry after pg cancel succeeded but finalize failed reuses the pg cancel (no second refund)', async () => {
    const { pg, row, tx } = await failAfterPgCancel();
    const db2 = fakeDb({ context: row });
    const res = await cancelBooking({ db: db2, pg, now: kst('2026-12-04T10:05:00') }, { userId: USER, bookingId: 'b-1', reason: 'USER' });
    expect(res).toEqual({ status: 'CANCELLED', refundAmount: 36000, feeAmount: 4000, rule: 'D7_4' });
    expect(pg.cancel).toHaveBeenCalledTimes(1);
    expect(db2.args('begin_cancel')).toEqual({ p_booking: 'b-1', p_rule: null });
    expect(db2.args('finalize_cancel')).toMatchObject({ p_refund: 36000, p_fee: 4000, p_rule: 'D7_4', p_tx_key: tx });
    expect((await pg.get(KEY)).balanceAmount).toBe(4000);
  });

  it('retry on the same day still finalizes with the PG refund and the original rule (D7_4)', async () => {
    const { pg, row, tx } = await failAfterPgCancel();
    const db2 = fakeDb({ context: row });
    const res = await cancelBooking({ db: db2, pg, now: kst('2026-12-11T09:00:00') }, { userId: USER, bookingId: 'b-1', reason: 'USER' });
    expect(res).toEqual({ status: 'CANCELLED', refundAmount: 36000, feeAmount: 4000, rule: 'D7_4' });
    expect(pg.cancel).toHaveBeenCalledTimes(1);
    expect(db2.args('finalize_cancel')).toEqual({
      p_booking: 'b-1', p_refund: 36000, p_fee: 4000, p_rule: 'D7_4', p_reason: 'USER', p_tx_key: tx,
    });
  });

  it('retry while the offering is being cancelled still finalizes the money already refunded', async () => {
    const { pg, row } = await failAfterPgCancel();
    row.offeringStatus = 'CANCEL_REQUESTED';
    const db2 = fakeDb({ context: row });
    const res = await cancelBooking({ db: db2, pg, now: kst('2026-12-05T10:00:00') }, { userId: USER, bookingId: 'b-1', reason: 'USER' });
    expect(res).toMatchObject({ status: 'CANCELLED', refundAmount: 36000, rule: 'D7_4' });
  });

  it('institution cancel after a half-done user cancel refunds the remaining balance too', async () => {
    const { pg, row } = await failAfterPgCancel();
    row.offeringStatus = 'CANCELLED';
    const db2 = fakeDb({ context: row });
    const res = await cancelBooking({ db: db2, pg, now: kst('2026-12-10T10:00:00') }, { userId: FINANCE, bookingId: 'b-1', reason: 'INSTITUTION' });
    expect(res).toEqual({ status: 'CANCELLED', refundAmount: 40000, feeAmount: 0, rule: 'INSTITUTION_FULL' });
    expect(pg.cancel).toHaveBeenCalledTimes(2);
    expect(pg.cancel.mock.calls[1][1]).not.toHaveProperty('cancelAmount');
    expect((await pg.get(KEY)).status).toBe('CANCELED');
  });

  it('race: another attempt refunded at the PG after this one read its context -> no second refund', async () => {
    // 정규 강좌 1/2 이전(MID_BEFORE_1_2): 120000의 1/2 = 60000. 두 번 취소해도 잔액 검사를 통과하는 금액입니다.
    const lessons = Array.from({ length: 12 }, (_, i) => new Date(Date.parse('2026-12-10T10:00:00Z') + i * 7 * 86400000).toISOString());
    const row = ctx({ productType: 'COURSE', paidAmount: 120000, baseAt: lessons[0], lessonStarts: lessons });
    const pg = await paidGateway(120000);
    const db = fakeDb({ context: row });
    // 이 시도가 ctx(cancelRule 없음)를 읽은 직후 앞선 시도 A가 PG 취소를 마치고 확정에 실패해 클레임을 풀었습니다.
    const origRpc = db.rpc;
    db.rpc = async (name, args) => {
      const res = await origRpc(name, args);
      if (name === 'cancel_context' && db.count('cancel_context') === 1) {
        await pg.cancel(KEY, { cancelReason: '고객 취소', cancelAmount: 60000 });
      }
      return res;
    };
    pg.cancel.mockClear();
    const now = new Date(Date.parse(lessons[3]) + 3600000); // 4회 시작 -> MID_BEFORE_1_2
    const res = await cancelBooking({ db, pg, now }, { userId: USER, bookingId: 'b-1', reason: 'USER' });
    expect(pg.cancel).toHaveBeenCalledTimes(1); // A의 취소뿐
    expect(res).toEqual({ status: 'CANCELLED', refundAmount: 60000, feeAmount: 60000, rule: 'MID_BEFORE_1_2' });
    expect((await pg.get(KEY)).balanceAmount).toBe(60000);
    expect(db.args('finalize_cancel')).toMatchObject({ p_refund: 60000, p_fee: 60000, p_reason: 'USER' });
  });

  it('a PG-side cancel made outside this flow (no cancel_rule) is recorded instead of cancelling again', async () => {
    const pg = await paidGateway();
    await pg.cancel(KEY, { cancelReason: '결제대행사 취소' });
    pg.cancel.mockClear();
    const db = fakeDb();
    const res = await cancelBooking({ db, pg, now: kst('2026-12-04T10:00:00') }, { userId: USER, bookingId: 'b-1', reason: 'USER' });
    expect(pg.cancel).not.toHaveBeenCalled();
    expect(res).toEqual({ status: 'CANCELLED', refundAmount: 40000, feeAmount: 0, rule: 'D7_4' });
  });

  it('a user retry of a failed institution attempt is recorded with reason INSTITUTION', async () => {
    const pg = await paidGateway();
    const row = ctx({ offeringStatus: 'CANCELLED' });
    const db1 = fakeDb({ context: row, finalizeError: new DbError('boom') });
    await expect(cancelBooking({ db: db1, pg, now: kst('2026-12-10T10:00:00') }, { userId: FINANCE, bookingId: 'b-1', reason: 'INSTITUTION' }))
      .rejects.toBeTruthy();
    expect(row.cancelRule).toBe('INSTITUTION_FULL');
    const db2 = fakeDb({ context: row });
    const res = await cancelBooking({ db: db2, pg, now: kst('2026-12-10T10:00:00') }, { userId: USER, bookingId: 'b-1', reason: 'USER' });
    expect(res).toEqual({ status: 'CANCELLED', refundAmount: 40000, feeAmount: 0, rule: 'INSTITUTION_FULL' });
    expect(db2.args('finalize_cancel')).toMatchObject({ p_reason: 'INSTITUTION', p_rule: 'INSTITUTION_FULL' });
    expect(pg.cancel).toHaveBeenCalledTimes(1);
  });

  it('a started attempt that never reached the PG re-evaluates the current policy', async () => {
    const pg = await paidGateway();
    pg.cancel.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'NETWORK' }));
    const row = ctx();
    await expect(cancelBooking({ db: fakeDb({ context: row }), pg, now: kst('2026-12-04T10:00:00') }, { userId: USER, bookingId: 'b-1', reason: 'USER' }))
      .rejects.toBeTruthy();
    expect(row.cancelRule).toBe('D7_4');
    const db2 = fakeDb({ context: row });
    const res = await cancelBooking({ db: db2, pg, now: kst('2026-12-08T10:00:00') }, { userId: USER, bookingId: 'b-1', reason: 'USER' });
    expect(res).toMatchObject({ refundAmount: 28000, feeAmount: 12000, rule: 'D3_1' });
    expect(db2.args('begin_cancel')).toEqual({ p_booking: 'b-1', p_rule: 'D3_1' });
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
    expect(res.pending).toBe(0);
    expect(res).not.toHaveProperty('pendingMessage');
  });

  it('surfaces payments still in progress as pending so finance runs it again', async () => {
    const db = fakeDb({ offeringBookings: [], pendingPayments: 2 });
    const pg = await paidGateway();
    const res = await cancelOffering({ db, pg, now: new Date() }, { userId: FINANCE, offeringId: 'off-1' });
    expect(res).toEqual({
      offeringId: 'off-1', cancelled: [], failed: [], pending: 2, pendingMessage: PENDING_PAYMENTS_MESSAGE(2),
    });
    expect(res.pendingMessage).toBe('결제가 진행 중인 예약 2건이 남아 있습니다. 잠시 후 일괄 취소를 다시 실행해 주세요.');
  });

  it('non-finance users are FORBIDDEN before any DB change', async () => {
    const db = fakeDb({ role: 'operator' });
    const pg = await paidGateway();
    await expect(cancelOffering({ db, pg, now: new Date() }, { userId: 'op', offeringId: 'off-1' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.count('begin_offering_cancel')).toBe(0);
  });
});
