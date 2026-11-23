import { describe, expect, it, vi } from 'vitest';
import { createMockGateway, memoryStore } from '../../supabase/functions/_shared/payments/gateway.js';
import { handleWebhook } from '../../supabase/functions/_shared/payments/webhook.js';

const KEY = 'pk_test_1';

// payments 행 하나를 흉내 내는 db. apply_payment_status는 기대 상태가 같을 때만 바꿉니다.
function fakeDb(status = 'DONE') {
  const row = { payment_key: KEY, status };
  const calls = [];
  return {
    row,
    calls,
    async findPaymentByKey(key) {
      return key === KEY ? { ...row } : null;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (name !== 'apply_payment_status') throw new Error(`unexpected rpc ${name}`);
      if (args.p_payment_key !== KEY || row.status !== args.p_expected) return false;
      row.status = args.p_status;
      return true;
    },
  };
}

async function gateway({ cancel = false } = {}) {
  const pg = createMockGateway({ store: memoryStore() });
  await pg.confirm({ paymentKey: KEY, orderId: 'HB-20261123-AbCdE12345', amount: 40000 });
  if (cancel) await pg.cancel(KEY, { cancelReason: '고객 취소' });
  vi.spyOn(pg, 'get');
  return pg;
}

const event = (status) => ({ eventType: 'PAYMENT_STATUS_CHANGED', createdAt: '2026-11-23T10:00:00', data: { paymentKey: KEY, status } });

describe('handleWebhook', () => {
  it('same body twice: first applied, second no-op', async () => {
    const db = fakeDb('DONE');
    const pg = await gateway({ cancel: true });
    expect(await handleWebhook({ db, pg }, event('CANCELED'))).toEqual({ applied: true });
    expect(db.row.status).toBe('CANCELED');
    expect(await handleWebhook({ db, pg }, event('CANCELED'))).toEqual({ applied: false });
    expect(db.calls.length).toBe(1);
    expect(pg.get).toHaveBeenCalledTimes(2);
  });

  it('does not trust the body: CANCELED in body but pg says DONE -> no update', async () => {
    const db = fakeDb('DONE');
    const pg = await gateway();
    expect(await handleWebhook({ db, pg }, event('CANCELED'))).toEqual({ applied: false });
    expect(pg.get).toHaveBeenCalledWith(KEY);
    expect(db.row.status).toBe('DONE');
    expect(db.calls.length).toBe(0);
  });

  it('uses the pg status even when the body says something else', async () => {
    const db = fakeDb('DONE');
    const pg = await gateway({ cancel: true });
    expect(await handleWebhook({ db, pg }, event('DONE'))).toEqual({ applied: true });
    expect(db.calls[0].args).toEqual({ p_payment_key: KEY, p_status: 'CANCELED', p_expected: 'DONE' });
  });

  it('ignores other event types, malformed bodies and unknown payments', async () => {
    const db = fakeDb('DONE');
    const pg = await gateway({ cancel: true });
    expect(await handleWebhook({ db, pg }, { eventType: 'DEPOSIT_CALLBACK', data: { paymentKey: KEY } })).toEqual({ applied: false });
    expect(await handleWebhook({ db, pg }, null)).toEqual({ applied: false });
    expect(await handleWebhook({ db, pg }, { eventType: 'PAYMENT_STATUS_CHANGED', data: {} })).toEqual({ applied: false });
    expect(await handleWebhook({ db, pg }, { eventType: 'PAYMENT_STATUS_CHANGED', data: { paymentKey: 'nope' } })).toEqual({ applied: false });
    expect(pg.get).toHaveBeenCalledTimes(1); // 'nope' 조회만(NOT_FOUND)
    expect(db.calls.length).toBe(0);
  });
});
