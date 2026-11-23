// 관리자 운영(0012_admin_ops.sql): 정산 집계, 회차 취소 요청/승인과 일괄 환불, 예약/대기/결제 조회, 증빙 확인, 할인 적용 여부
import { createClient } from '@supabase/supabase-js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMockGateway } from '../../supabase/functions/_shared/payments/gateway.js';
import { cancelBooking, cancelOffering } from '../../supabase/functions/_shared/payments/cancel.js';
import { createDbAdapter, createPgMockStore } from '../../supabase/functions/_shared/payments/supabase-adapter.js';
import { adminClient, resetDb, setClock, userClient } from './helpers.js';

// base = 12/01 00:00 KST. 공연 회차는 base+10일(12/11), 체험은 base+5일(12/06).
const BASE = '2026-12-01T00:00:00+09:00';
const db = adminClient();
const adapter = createDbAdapter(db);
const pg = createMockGateway({ store: createPgMockStore(db) });
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = createClient(process.env.API_URL, process.env.ANON_KEY, opts);
let m = [];
let uid = [];
let op;
let fin;
let financeId;
let seq = 0;

const at = (iso) => setClock(Date.parse(iso) - Date.now());
const orderId = () => `HB-20261201-S${String(Date.now() % 1e6).padStart(6, '0')}${String(seq++).padStart(3, '0')}`;

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

async function appNow() {
  return new Date(await ok(db.rpc('app_now')));
}

// 선점 -> 결제 준비 -> 잠금 -> 모의 결제 승인 -> 확정(payments-confirm 과 같은 순서)
async function book(client, o, { seatIds, qty, amount, discounts }) {
  const hold = seatIds
    ? await ok(client.rpc('hold_seats', { p_offering: o.id, p_seat_ids: seatIds }))
    : await ok(client.rpc('hold_capacity', { p_offering: o.id, p_qty: qty }));
  const oid = orderId();
  const n = seatIds ? seatIds.length : qty;
  const items = Array.from({ length: n }, (_, i) => ({
    ...(seatIds ? { seatId: seatIds[i] } : {}), discountType: discounts?.[i] ?? 'GENERAL',
  }));
  await ok(client.rpc('prepare_payment', { p_hold: hold.id, p_items: items, p_amount: amount, p_order_id: oid }));
  await ok(db.rpc('lock_for_confirm', { p_order_id: oid }));
  const paymentKey = `pk_${oid}`;
  const payment = await pg.confirm({ paymentKey, orderId: oid, amount });
  const booking = await ok(db.rpc('finalize_booking', { p_order_id: oid, p_payment_key: paymentKey, p_raw: payment }));
  return { booking, paymentKey };
}

const sum = (rows, k) => rows.reduce((a, r) => a + Number(r[k]), 0);
const audits = async (action) => ok(db.from('admin_audit').select('*').eq('action', action).order('at'));

beforeAll(async () => {
  m = await Promise.all(['member1', 'member2', 'member3'].map((n) => userClient(`${n}@demo.test`)));
  uid = (await Promise.all(m.map((c) => c.auth.getUser()))).map((r) => r.data.user.id);
  op = await userClient('operator@demo.test');
  fin = await userClient('finance@demo.test');
  financeId = (await fin.auth.getUser()).data.user.id;
});

beforeEach(async () => {
  await resetDb(BASE);
  await at(BASE);
});

describe('settlement_daily (AC-6)', () => {
  it('결제 80000/40000, 그중 40000을 D-5에 취소(환불 36000)하면 paid 120000, refund 36000, fee 4000, net 84000', async () => {
    const o = await offering('PERFORMANCE');
    await book(m[0], o, { seatIds: [1, 2], amount: 80000 });
    const b = await book(m[1], o, { seatIds: [3], amount: 40000 });

    await at('2026-12-06T10:00:00+09:00'); // 12/11 회차의 D-5
    const res = await cancelBooking({ db: adapter, pg, now: await appNow() }, { userId: uid[1], bookingId: b.booking.id, reason: 'USER' });
    expect(res).toMatchObject({ status: 'CANCELLED', refundAmount: 36000, feeAmount: 4000 });

    const rows = await ok(db.from('settlement_daily').select('*').eq('program_id', o.program_id));
    expect({ paid: sum(rows, 'paid_sum'), refund: sum(rows, 'refund_sum'), fee: sum(rows, 'fee_sum'), net: sum(rows, 'net_sum') })
      .toEqual({ paid: 120000, refund: 36000, fee: 4000, net: 84000 });
    // 결제는 승인일(12/01), 환불은 취소일(12/06)에 잡힙니다(KST 날짜).
    const byDay = Object.fromEntries(rows.map((r) => [r.day, r]));
    expect(byDay['2026-12-01']).toMatchObject({ paid_sum: 120000, paid_count: 2, refund_sum: 0, net_sum: 120000 });
    expect(byDay['2026-12-06']).toMatchObject({ paid_sum: 0, refund_sum: 36000, refund_count: 1, fee_sum: 4000, net_sum: -36000 });

    // 화면은 정산 담당 전용 함수로 읽습니다(프로그램명 포함, 기간 조건).
    const viaRpc = await ok(fin.rpc('staff_settlement', { p_from: '2026-12-01', p_to: '2026-12-31' }));
    expect(sum(viaRpc, 'net_sum')).toBe(84000);
    expect(viaRpc.every((r) => typeof r.program_title === 'string')).toBe(true);
    expect(await ok(fin.rpc('staff_settlement', { p_from: '2026-12-02', p_to: '2026-12-05' }))).toEqual([]);
    expect(await code(op.rpc('staff_settlement', { p_from: '2026-12-01', p_to: '2026-12-31' }))).toBe('FORBIDDEN');
  });

  it('기관 취소 환불은 환불액에 들어가고 수수료에는 들어가지 않습니다', async () => {
    const o = await offering('EXPERIENCE');
    await book(m[0], o, { qty: 2, amount: 20000 });
    await ok(op.rpc('admin_request_offering_cancel', { p_offering: o.id, p_reason: '강사 사정' }));
    const [req] = await ok(op.rpc('staff_cancel_requests'));
    await ok(fin.rpc('admin_decide_offering_cancel', { p_req: req.id, p_approve: true }));
    await cancelOffering({ db: adapter, pg, now: await appNow() }, { userId: financeId, offeringId: o.id });
    const rows = await ok(db.from('settlement_daily').select('*').eq('program_id', o.program_id));
    expect({ paid: sum(rows, 'paid_sum'), refund: sum(rows, 'refund_sum'), fee: sum(rows, 'fee_sum'), net: sum(rows, 'net_sum') })
      .toEqual({ paid: 20000, refund: 20000, fee: 0, net: 0 });
  });
});

describe('회차 취소 요청/승인(SFR-023)', () => {
  it('operator 요청 -> finance 승인 -> 해당 회차 예약 전부 CANCELLED, refunds.reason INSTITUTION, 알림 OFFERING_CANCELLED', async () => {
    const o = await offering('PERFORMANCE');
    const a = await book(m[0], o, { seatIds: [1, 2], amount: 80000 });
    const b = await book(m[1], o, { seatIds: [3], amount: 40000 });

    const req = await ok(op.rpc('admin_request_offering_cancel', { p_offering: o.id, p_reason: '공연장 설비 점검' }));
    expect(req).toMatchObject({ offering_id: o.id, status: 'REQUESTED', reason: '공연장 설비 점검' });
    expect((await ok(db.from('offerings').select('status').eq('id', o.id).single())).status).toBe('CANCEL_REQUESTED');
    // 요청 중에는 회원이 새로 예매하지 못합니다.
    expect(await code(m[2].rpc('hold_seats', { p_offering: o.id, p_seat_ids: [10] }))).toBe('NOT_ON_SALE');

    const list = await ok(fin.rpc('staff_cancel_requests'));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: req.id, status: 'REQUESTED', confirmed_count: 2, confirmed_amount: 120000 });

    const decided = await ok(fin.rpc('admin_decide_offering_cancel', { p_req: req.id, p_approve: true }));
    expect(decided).toMatchObject({ id: req.id, status: 'APPROVED', decided_by: financeId });
    // 화면은 승인 뒤 payments-cancel(INSTITUTION)을 부릅니다. 같은 오케스트레이션을 직접 실행합니다.
    const res = await cancelOffering({ db: adapter, pg, now: await appNow() }, { userId: financeId, offeringId: o.id });
    expect(res.failed).toEqual([]);
    expect(res.cancelled).toHaveLength(2);

    const bookings = await ok(db.from('bookings').select('status').eq('offering_id', o.id));
    expect(bookings.map((x) => x.status)).toEqual(['CANCELLED', 'CANCELLED']);
    const refunds = await ok(db.from('refunds').select('reason, refund_amount, fee_amount').in('booking_id', [a.booking.id, b.booking.id]));
    expect(refunds.every((r) => r.reason === 'INSTITUTION' && r.fee_amount === 0)).toBe(true);
    expect(sum(refunds, 'refund_amount')).toBe(120000);
    for (const u of [uid[0], uid[1]]) {
      expect(await ok(db.from('notifications').select('id').eq('user_id', u).eq('kind', 'OFFERING_CANCELLED'))).toHaveLength(1);
    }
    expect((await ok(db.from('offerings').select('status').eq('id', o.id).single())).status).toBe('CANCELLED');
    expect((await audits('OFFERING_CANCEL_REQUEST'))[0]).toMatchObject({ target_type: 'offering', target_id: o.id });
    expect((await audits('OFFERING_CANCEL_APPROVE'))[0]).toMatchObject({ target_type: 'offering_cancel_request', target_id: req.id });
    const [after] = await ok(fin.rpc('staff_cancel_requests'));
    expect(after).toMatchObject({ status: 'APPROVED', offering_status: 'CANCELLED', confirmed_count: 0, refunded_count: 2 });
  });

  it('finance가 아닌 사람이 승인하면 FORBIDDEN, finance가 아닌 사람이 요청하면 FORBIDDEN', async () => {
    const o = await offering('PERFORMANCE');
    const req = await ok(op.rpc('admin_request_offering_cancel', { p_offering: o.id, p_reason: '시설 점검' }));
    expect(await code(op.rpc('admin_decide_offering_cancel', { p_req: req.id, p_approve: true }))).toBe('FORBIDDEN');
    expect(await code(m[0].rpc('admin_decide_offering_cancel', { p_req: req.id, p_approve: true }))).toBe('FORBIDDEN');
    expect(await code(fin.rpc('admin_request_offering_cancel', { p_offering: o.id, p_reason: 'x' }))).toBe('FORBIDDEN');
    expect(await code(anon.rpc('admin_request_offering_cancel', { p_offering: o.id, p_reason: 'x' }))).not.toBeNull();
    expect((await ok(db.from('offering_cancel_requests').select('status').eq('id', req.id).single())).status).toBe('REQUESTED');
  });

  it('반려하면 회차가 다시 판매 중(OPEN)이 되고, 같은 요청은 두 번 결정하지 못합니다', async () => {
    const o = await offering('EXPERIENCE');
    const req = await ok(op.rpc('admin_request_offering_cancel', { p_offering: o.id, p_reason: '강사 사정' }));
    expect(await code(op.rpc('admin_request_offering_cancel', { p_offering: o.id, p_reason: '중복' }))).toBe('OFFERING_CLOSED');
    const rejected = await ok(fin.rpc('admin_decide_offering_cancel', { p_req: req.id, p_approve: false }));
    expect(rejected.status).toBe('REJECTED');
    expect((await ok(db.from('offerings').select('status').eq('id', o.id).single())).status).toBe('OPEN');
    expect(await code(fin.rpc('admin_decide_offering_cancel', { p_req: req.id, p_approve: true }))).toBe('ALREADY_DECIDED');
    await ok(m[0].rpc('hold_capacity', { p_offering: o.id, p_qty: 1 }));
    expect((await audits('OFFERING_CANCEL_REJECT'))).toHaveLength(1);
    // 반려된 요청만 있으면 일괄 환불을 시작할 수 없습니다.
    expect(await code(db.rpc('begin_offering_cancel', { p_offering: o.id, p_actor: financeId }))).toBe('CANCEL_NOT_APPROVED');
  });

  it('사유가 없으면 INVALID_REASON', async () => {
    const o = await offering('EXPERIENCE');
    expect(await code(op.rpc('admin_request_offering_cancel', { p_offering: o.id, p_reason: '  ' }))).toBe('INVALID_REASON');
    expect(await code(op.rpc('admin_request_offering_cancel', { p_offering: o.id, p_reason: 'x'.repeat(501) }))).toBe('INVALID_REASON');
  });
});

describe('예약 내역과 증빙 확인(SFR-021)', () => {
  it('예약 목록은 이름/휴대폰을 가리고 할인, 증빙 상태, 좌석을 돌려주며 조건으로 거릅니다', async () => {
    const o = await offering('PERFORMANCE');
    const a = await book(m[0], o, { seatIds: [1, 2], amount: 40000, discounts: ['DISABLED', 'DISABLED_COMPANION'] });
    await book(m[1], o, { seatIds: [3], amount: 40000 });

    const all = await ok(op.rpc('staff_bookings', {}));
    expect(all).toHaveLength(2);
    const row = all.find((r) => r.booking_id === a.booking.id);
    expect(row).toMatchObject({
      booking_no: a.booking.booking_no, name_masked: '회***나', phone_masked: '010-****-0001', qty: 2, total_amount: 40000,
      status: 'CONFIRMED', proof: 'TODO', seats: 'R석 A열 1, R석 A열 2',
    });
    expect(row.discounts).toEqual(['DISABLED', 'DISABLED_COMPANION']);
    expect(row.items).toHaveLength(2);
    expect(JSON.stringify(all)).not.toContain('회원 하나');
    expect(all.find((r) => r.booking_id !== a.booking.id).proof).toBe('NONE');

    expect(await ok(op.rpc('staff_bookings', { p_field: 'name', p_q: '회원 하나' }))).toHaveLength(1);
    expect(await ok(op.rpc('staff_bookings', { p_field: 'booking_no', p_q: a.booking.booking_no }))).toHaveLength(1);
    expect(await ok(op.rpc('staff_bookings', { p_field: 'phone4', p_q: '0002' }))).toHaveLength(1);
    // 검색어의 % _ \ 는 글자 그대로 비교합니다(와일드카드 아님).
    for (const q of ['%', '_', '회원%', '\\']) {
      expect(await ok(op.rpc('staff_bookings', { p_field: 'name', p_q: q })), q).toEqual([]);
    }
    expect(await ok(op.rpc('staff_bookings', { p_field: 'booking_no', p_q: '%' }))).toEqual([]);
    expect(await ok(op.rpc('staff_bookings', { p_field: 'booking_no', p_q: a.booking.booking_no.toLowerCase() }))).toHaveLength(1);
    expect(await ok(op.rpc('staff_bookings', { p_discount: 'DISABLED' }))).toHaveLength(1);
    expect(await ok(op.rpc('staff_bookings', { p_statuses: ['CANCELLED'] }))).toEqual([]);
    expect(await ok(op.rpc('staff_bookings', { p_from: '2026-12-02', p_to: '2026-12-03' }))).toEqual([]);
    expect(await ok(fin.rpc('staff_bookings', { p_offering: o.id }))).toHaveLength(2);
    expect(await code(m[0].rpc('staff_bookings', {}))).toBe('FORBIDDEN');
  });

  it('admin_mark_proof: 운영 담당이 할인 매수의 현장 증빙 확인을 기록하고, 모두 확인되면 DONE', async () => {
    const o = await offering('PERFORMANCE');
    const a = await book(m[0], o, { seatIds: [1, 2], amount: 40000, discounts: ['DISABLED', 'DISABLED_COMPANION'] });
    const [row] = await ok(op.rpc('staff_bookings', {}));
    const [i1, i2] = row.items;
    await ok(op.rpc('admin_mark_proof', { p_item: i1.id, p_checked: true }));
    expect((await ok(op.rpc('staff_bookings', {})))[0].proof).toBe('TODO');
    await ok(op.rpc('admin_mark_proof', { p_item: i2.id, p_checked: true }));
    expect((await ok(op.rpc('staff_bookings', {})))[0].proof).toBe('DONE');
    // 같은 값이면 이력을 다시 남기지 않습니다.
    await ok(op.rpc('admin_mark_proof', { p_item: i2.id, p_checked: true }));
    const logs = await audits('PROOF_CHECK');
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ target_type: 'booking_item', target_id: i1.id });
    expect(logs[0].detail).toMatchObject({ booking_no: a.booking.booking_no, checked: true });
    await ok(op.rpc('admin_mark_proof', { p_item: i1.id, p_checked: false }));
    expect((await ok(db.from('booking_items').select('proof_checked').eq('id', i1.id).single())).proof_checked).toBe(false);

    expect(await code(fin.rpc('admin_mark_proof', { p_item: i1.id, p_checked: true }))).toBe('FORBIDDEN');
    expect(await code(op.rpc('admin_mark_proof', { p_item: '00000000-0000-4000-8000-0000000000ee', p_checked: true }))).toBe('NOT_FOUND');
    const plain = await book(m[1], o, { seatIds: [3], amount: 40000 });
    const plainItem = await ok(db.from('booking_items').select('id').eq('booking_id', plain.booking.id).single());
    expect(await code(op.rpc('admin_mark_proof', { p_item: plainItem.id, p_checked: true }))).toBe('NO_DISCOUNT');
  });
});

describe('대기자, 결제/환불 내역', () => {
  it('staff_waitlist: 운영 담당은 회차별 순번과 가린 이름을 봅니다', async () => {
    const o = await offering('EXPERIENCE');
    await ok(db.from('offerings').update({ capacity: 1 }).eq('id', o.id));
    await book(m[0], o, { qty: 1, amount: 10000 });
    await ok(m[1].rpc('join_waitlist', { p_offering: o.id, p_qty: 1 }));
    await ok(m[2].rpc('join_waitlist', { p_offering: o.id, p_qty: 1 }));
    const rows = await ok(op.rpc('staff_waitlist', { p_offering: o.id }));
    expect(rows.map((r) => [r.position, r.name_masked, r.status])).toEqual([[1, '회**둘', 'WAITING'], [2, '회**셋', 'WAITING']]);
    expect(await code(fin.rpc('staff_waitlist', {}))).toBe('FORBIDDEN');
  });

  it('staff_payments / staff_refunds: 정산 담당이 결제대행 거래 번호와 환불 내역을 봅니다', async () => {
    const o = await offering('PERFORMANCE');
    const a = await book(m[0], o, { seatIds: [1], amount: 40000 });
    await at('2026-12-06T10:00:00+09:00');
    await cancelBooking({ db: adapter, pg, now: await appNow() }, { userId: uid[0], bookingId: a.booking.id, reason: 'USER' });

    const pays = await ok(fin.rpc('staff_payments', { p_from: '2026-12-01', p_to: '2026-12-31' }));
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({
      payment_key: a.paymentKey, booking_no: a.booking.booking_no, amount: 40000, status: 'PARTIAL_CANCELED',
      refunded_amount: 36000, name_masked: '회***나',
    });
    expect(Object.keys(pays[0])).not.toContain('raw');
    const refs = await ok(fin.rpc('staff_refunds', { p_from: '2026-12-06', p_to: '2026-12-06' }));
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ refund_amount: 36000, fee_amount: 4000, reason: 'USER', payment_key: a.paymentKey });
    expect(refs[0].pg_transaction_key).toBeTruthy();
    expect(await ok(fin.rpc('staff_refunds', { p_from: '2026-12-01', p_to: '2026-12-05' }))).toEqual([]);
    expect(await code(op.rpc('staff_payments', {}))).toBe('FORBIDDEN');
    expect(await code(op.rpc('staff_refunds', {}))).toBe('FORBIDDEN');
  });
});

describe('할인 적용 여부(R23, SFR-019)', () => {
  it('discount_enabled=false 인 프로그램은 일반(GENERAL)만 결제 준비가 됩니다', async () => {
    const o = await offering('EXPERIENCE');
    const p = await ok(op.rpc('admin_upsert_program', { p: { id: o.program_id, discount_enabled: false } }));
    expect(p.discount_enabled).toBe(false);
    expect((await audits('PROGRAM_UPDATE'))[0].detail.changes.discount_enabled).toEqual({ from: true, to: false });
    expect((await ok(anon.from('programs').select('discount_enabled').eq('id', o.program_id).single())).discount_enabled).toBe(false);

    const hold = await ok(m[0].rpc('hold_capacity', { p_offering: o.id, p_qty: 1 }));
    expect(await code(m[0].rpc('prepare_payment', {
      p_hold: hold.id, p_items: [{ discountType: 'MULTICHILD' }], p_amount: 7000, p_order_id: orderId(),
    }))).toBe('INVALID_DISCOUNT');
    await ok(m[0].rpc('prepare_payment', {
      p_hold: hold.id, p_items: [{ discountType: 'GENERAL' }], p_amount: 10000, p_order_id: orderId(),
    }));
    expect(await code(op.rpc('admin_upsert_program', { p: { id: o.program_id, discount_enabled: 'no' } }))).toBe('INVALID_REQUEST');
  });

  it('새 프로그램은 할인 적용이 기본이고, 할인을 켠 프로그램은 할인 결제가 됩니다', async () => {
    const p = await ok(op.rpc('admin_upsert_program', { p: { type: 'EXPERIENCE', title: '할인 기본값 확인' } }));
    expect(p.discount_enabled).toBe(true);
    const o = await offering('EXPERIENCE');
    const hold = await ok(m[0].rpc('hold_capacity', { p_offering: o.id, p_qty: 1 }));
    await ok(m[0].rpc('prepare_payment', {
      p_hold: hold.id, p_items: [{ discountType: 'MULTICHILD' }], p_amount: 7000, p_order_id: orderId(),
    }));
  });
});

describe('회차 등록에는 가격이 필요합니다', () => {
  it('새 회차를 prices 없이 저장하면 INVALID_REQUEST(PRICES_REQUIRED)', async () => {
    const o = await offering('EXPERIENCE');
    const base = {
      program_id: o.program_id, starts_at: '2026-12-20T10:00:00+09:00', ends_at: '2026-12-20T12:00:00+09:00', capacity: 10,
      sale_starts_at: '2026-11-30T10:00:00+09:00', sale_ends_at: '2026-12-20T10:00:00+09:00',
    };
    const { error } = await op.rpc('admin_upsert_offering', { p: base });
    expect(error.message).toBe('INVALID_REQUEST');
    expect(error.details).toBe('PRICES_REQUIRED');
    const { count } = await db.from('offerings').select('*', { count: 'exact', head: true }).eq('program_id', o.program_id);
    expect(count).toBe(2);
    await ok(op.rpc('admin_upsert_offering', { p: { ...base, prices: [{ grade: null, price: 12000 }] } }));
    // 기존 회차 수정은 가격 없이도 됩니다.
    await ok(op.rpc('admin_upsert_offering', { p: { id: o.id, capacity: 25 } }));
  });
});
