import { describe, expect, it } from 'vitest';
import { createMockGateway, memoryStore } from '../../supabase/functions/_shared/payments/gateway.js';

async function rejection(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error('expected rejection');
}

const req = (n = 1, amount = 40000) => ({ paymentKey: `pk_${n}`, orderId: `HB-20261123-ORDER0000${n}`, amount });

describe('createMockGateway', () => {
  it('confirm then get -> DONE with full balance', async () => {
    const pg = createMockGateway({ store: memoryStore() });
    const res = await pg.confirm(req());
    expect(res).toMatchObject({
      paymentKey: 'pk_1', orderId: 'HB-20261123-ORDER00001', status: 'DONE',
      totalAmount: 40000, balanceAmount: 40000, cancels: [],
    });
    const got = await pg.get('pk_1');
    expect(got.status).toBe('DONE');
    expect(got.balanceAmount).toBe(40000);
  });

  it('second confirm with same paymentKey -> ALREADY_PROCESSED_PAYMENT', async () => {
    const pg = createMockGateway({ store: memoryStore() });
    await pg.confirm(req());
    const e = await rejection(pg.confirm(req()));
    expect(e.code).toBe('ALREADY_PROCESSED_PAYMENT');
    expect(typeof e.message).toBe('string');
  });

  it('same orderId with another paymentKey -> ALREADY_PROCESSED_PAYMENT', async () => {
    const pg = createMockGateway({ store: memoryStore() });
    await pg.confirm(req());
    const e = await rejection(pg.confirm({ ...req(), paymentKey: 'pk_other' }));
    expect(e.code).toBe('ALREADY_PROCESSED_PAYMENT');
  });

  it('partial cancel 36000 -> PARTIAL_CANCELED, balance 4000', async () => {
    const pg = createMockGateway({ store: memoryStore() });
    await pg.confirm(req());
    const res = await pg.cancel('pk_1', { cancelReason: '부분 환불', cancelAmount: 36000 });
    expect(res.status).toBe('PARTIAL_CANCELED');
    expect(res.balanceAmount).toBe(4000);
    expect(res.cancels).toHaveLength(1);
    expect(res.cancels[0].cancelAmount).toBe(36000);
    expect(typeof res.cancels[0].transactionKey).toBe('string');
    expect((await pg.get('pk_1')).balanceAmount).toBe(4000);
  });

  it('cancel larger than balance -> INVALID_CANCEL_AMOUNT', async () => {
    const pg = createMockGateway({ store: memoryStore() });
    await pg.confirm(req());
    await pg.cancel('pk_1', { cancelReason: '부분 환불', cancelAmount: 36000 });
    const e = await rejection(pg.cancel('pk_1', { cancelReason: '부분 환불', cancelAmount: 5000 }));
    expect(e.code).toBe('INVALID_CANCEL_AMOUNT');
    expect((await pg.get('pk_1')).balanceAmount).toBe(4000);
  });

  it('cancelAmount omitted -> full CANCELED', async () => {
    const pg = createMockGateway({ store: memoryStore() });
    await pg.confirm(req());
    const res = await pg.cancel('pk_1', { cancelReason: '예약 확정 실패' });
    expect(res.status).toBe('CANCELED');
    expect(res.balanceAmount).toBe(0);
    expect(res.cancels[0].cancelAmount).toBe(40000);
  });

  it('full cancel after partial cancel cancels the rest', async () => {
    const pg = createMockGateway({ store: memoryStore() });
    await pg.confirm(req());
    await pg.cancel('pk_1', { cancelReason: '부분 환불', cancelAmount: 36000 });
    const res = await pg.cancel('pk_1', { cancelReason: '전액 환불' });
    expect(res).toMatchObject({ status: 'CANCELED', balanceAmount: 0 });
    expect(res.cancels.map((c) => c.cancelAmount)).toEqual([36000, 4000]);
  });

  it('unknown paymentKey -> NOT_FOUND_PAYMENT for get and cancel', async () => {
    const pg = createMockGateway({ store: memoryStore() });
    expect((await rejection(pg.get('nope'))).code).toBe('NOT_FOUND_PAYMENT');
    expect((await rejection(pg.cancel('nope', { cancelReason: 'x' }))).code).toBe('NOT_FOUND_PAYMENT');
  });

  it("mode 'DECLINE' -> confirm throws REJECT_CARD_PAYMENT and stores nothing", async () => {
    const store = memoryStore();
    const pg = createMockGateway({ store, mode: 'DECLINE' });
    const e = await rejection(pg.confirm(req()));
    expect(e.code).toBe('REJECT_CARD_PAYMENT');
    expect(await store.get('pk_1')).toBeNull();
  });
});
