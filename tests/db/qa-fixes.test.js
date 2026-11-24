// QA 결함 D-08, D-09, D-11, D-14 (0016_qa_fixes.sql)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminClient, resetDb, setClock, userClient } from './helpers.js';

// 기준 base = 12/01 00:00 KST. 공연 회차는 12/11 19:30, 체험 회차는 12/06 14:00 입니다.
const BASE = '2026-12-01T00:00:00+09:00';
const H = 3600000;
const db = adminClient();
let m = [];
let uid = [];
let op;

const at = (iso) => setClock(Date.parse(iso) - Date.now());
async function ok(p) {
  const { data, error } = await p;
  expect(error).toBeNull();
  return data;
}
const setEnv = (env) => db.from('app_settings').upsert([{ key: 'env', value: env }]);

async function offering(type, idx = 0) {
  const { data: progs } = await db.from('programs').select('id').eq('type', type).order('title');
  const { data } = await db.from('offerings').select('*').eq('program_id', progs[0].id).order('starts_at');
  return data[idx];
}
async function queue(o) {
  return ok(db.from('waitlist').select('*').eq('offering_id', o.id).order('created_at'));
}
async function notes(userId, kind) {
  return ok(db.from('notifications').select('*').eq('user_id', userId).eq('kind', kind).order('created_at'));
}
async function soldOutCapacity(o, qty) {
  await ok(db.from('offerings').update({ capacity: qty }).eq('id', o.id));
  const h = await ok(db.from('holds').insert({ offering_id: o.id, user_id: uid[2], qty, status: 'CONSUMED', expires_at: new Date().toISOString() }).select().single());
  const b = await ok(db.from('bookings').insert({ booking_no: `T-QA-${o.id.slice(0, 8)}`, user_id: uid[2], offering_id: o.id, hold_id: h.id, total_amount: 0 }).select().single());
  return b.id;
}
const release = (o, seats, qty) => ok(db.rpc('release_inventory', { p_offering: o.id, p_seat_ids: seats, p_qty: qty }));

beforeAll(async () => {
  m = await Promise.all(['member1', 'member2', 'member3'].map((n) => userClient(`${n}@demo.test`)));
  uid = (await Promise.all(m.map((c) => c.auth.getUser()))).map((r) => r.data.user.id);
  op = await userClient('operator@demo.test');
});
beforeEach(async () => {
  await resetDb(BASE);
  await at(BASE);
});
afterAll(async () => {
  await setEnv('local');
  await resetDb(BASE);
});

describe('D-08 시연 데이터 초기화 일정', () => {
  const kst = (iso) => new Date(Date.parse(iso) + 9 * H).toISOString().slice(0, 16).replace('T', ' ');
  async function schedule() {
    const rows = await ok(db.from('offerings').select('starts_at, programs(title)').order('starts_at'));
    return rows.map((r) => `${r.programs.title} ${kst(r.starts_at)}`);
  }

  it('같은 날 10:00 과 23:50 에 초기화해도 KST 날짜와 시각이 같고, 시드의 고정 시각을 씁니다', async () => {
    await setEnv('local');
    await at('2026-12-01T10:00:00+09:00');
    await ok(op.rpc('admin_reset_demo'));
    const morning = await schedule();
    await at('2026-12-01T23:50:00+09:00');
    await ok(op.rpc('admin_reset_demo'));
    expect(await schedule()).toEqual(morning);
    expect(morning).toContain('겨울 실내악 시리즈 「현의 대화」 2026-12-11 19:30');
    // 처음 시드(seed.sql, KST 자정 기준)와 같은 일정입니다.
    await resetDb(BASE);
    expect(await schedule()).toEqual(morning);
  });
});

describe('D-09 기한 만료 처리가 다른 회원의 선점에 기대지 않음', () => {
  async function promotedPerformance() {
    const o = await offering('PERFORMANCE');
    await ok(db.from('inventory_seats').update({ status: 'SOLD' }).eq('offering_id', o.id));
    await ok(m[0].rpc('join_waitlist', { p_offering: o.id, p_qty: 2 }));
    await ok(m[1].rpc('join_waitlist', { p_offering: o.id, p_qty: 2 }));
    await release(o, [5, 6], 2);
    const [w1] = await queue(o);
    expect(w1.status).toBe('PROMOTED');
    return o;
  }

  it('처리할 것이 없으면 아무것도 바꾸지 않고 0 을 돌려줍니다', async () => {
    await promotedPerformance();
    expect(await ok(m[1].rpc('sweep_due_offerings'))).toBe(0);
  });

  it('기한이 지난 뒤 2순위가 자기 대기 목록을 열면(조회 경로) 1순위가 만료되고 2순위가 승격되며 알림이 쌓입니다', async () => {
    const o = await promotedPerformance();
    await at(new Date(Date.parse(BASE) + 24 * H + 60000).toISOString());
    // 다른 회원의 선점이나 결제 요청 없이, 화면이 부르는 조회 순서 그대로입니다.
    expect(await ok(m[1].rpc('sweep_due_offerings'))).toBe(1);
    const list = await ok(m[1].rpc('my_waitlist_overview'));
    expect(list[0]).toMatchObject({ status: 'PROMOTED', position: 1, allocated_qty: 2 });
    const [w1, w2] = await queue(o);
    expect(w1.status).toBe('EXPIRED');
    expect(w2.status).toBe('PROMOTED');
    expect(await notes(uid[0], 'WAIT_EXPIRED')).toHaveLength(1);
    expect(await notes(uid[1], 'WAIT_PROMOTED')).toHaveLength(1);
    // 여러 번 불러도 결과가 같습니다.
    expect(await ok(m[0].rpc('sweep_due_offerings'))).toBe(0);
    expect(await notes(uid[1], 'WAIT_PROMOTED')).toHaveLength(1);
  });

  it('D-2 가 되면 모으던 배정분도 조회만으로 일반 판매로 풀립니다', async () => {
    const o = await offering('PERFORMANCE');
    await ok(db.from('inventory_seats').update({ status: 'SOLD' }).eq('offering_id', o.id));
    await ok(m[0].rpc('join_waitlist', { p_offering: o.id, p_qty: 2 }));
    await release(o, [5], 1);
    await at('2026-12-09T09:00:00+09:00');
    expect(await ok(m[0].rpc('sweep_due_offerings'))).toBe(1);
    const [w1] = await queue(o);
    expect(w1.status).toBe('RELEASED');
    const seat = await ok(db.from('inventory_seats').select('status').eq('offering_id', o.id).eq('seat_id', 5).single());
    expect(seat.status).toBe('AVAILABLE');
  });

  it('비회원은 부를 수 없습니다', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const anon = createClient(process.env.API_URL, process.env.ANON_KEY, { auth: { persistSession: false } });
    expect((await anon.rpc('sweep_due_offerings')).error).not.toBeNull();
  });

  const container = `supabase_db_${readFileSync('supabase/config.toml', 'utf8').match(/^project_id = "(.+)"/m)[1]}`;
  const dockerOk = (() => { try { execFileSync('docker', ['exec', container, 'true'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  it.skipIf(!dockerOk)('pg_cron 이 있으면 1분마다 sweep_due_offerings 를 부르는 작업이 등록됩니다', () => {
    const out = execFileSync('docker', ['exec', container, 'psql', '-U', 'postgres', '-tAc',
      "select schedule || '|' || command from cron.job where jobname = 'sweep-due-offerings'"], { encoding: 'utf8' }).trim();
    expect(out).toBe('* * * * *|select public.sweep_due_offerings()');
  });
});

describe('D-11 알림 문구의 단위와 표현', () => {
  it('공연 승격 알림은 「매」, 체험 승격과 해제 알림은 「명」과 「회차」를 씁니다', async () => {
    const perf = await offering('PERFORMANCE');
    await ok(db.from('inventory_seats').update({ status: 'SOLD' }).eq('offering_id', perf.id));
    await ok(m[0].rpc('join_waitlist', { p_offering: perf.id, p_qty: 2 }));
    await release(perf, [5, 6], 2);
    const [pn] = await notes(uid[0], 'WAIT_PROMOTED');
    expect(pn.body).toContain('2매');
    expect(pn.body).not.toContain('매(명)');

    const exp = await offering('EXPERIENCE');
    const bookingId = await soldOutCapacity(exp, 2);
    await ok(m[1].rpc('join_waitlist', { p_offering: exp.id, p_qty: 2 }));
    await ok(db.from('bookings').update({ status: 'CANCELLED' }).eq('id', bookingId));
    await release(exp, null, 2);
    const [en] = await notes(uid[1], 'WAIT_PROMOTED');
    expect(en.body).toContain('2명');
    expect(en.body).not.toMatch(/매|공연|좌석/);
    await at(new Date(Date.parse(BASE) + 24 * H + 60000).toISOString());
    await ok(m[1].rpc('sweep_due_offerings'));
    const [ex] = await notes(uid[1], 'WAIT_EXPIRED');
    expect(ex.body).toContain('회차 2일 전');
    expect(ex.body).not.toMatch(/공연|좌석/);
  });

  it('정원제 예약 확정 알림은 「명」으로 씁니다', async () => {
    const exp = await offering('EXPERIENCE');
    const hold = await ok(m[0].rpc('hold_capacity', { p_offering: exp.id, p_qty: 2 }));
    const oid = `HB-20261201-Q${String(Date.now() % 1e9).padStart(9, '0')}`;
    await ok(m[0].rpc('prepare_payment', { p_hold: hold.id, p_items: [{ discountType: 'GENERAL' }, { discountType: 'GENERAL' }], p_amount: 20000, p_order_id: oid }));
    await ok(db.rpc('lock_for_confirm', { p_order_id: oid }));
    await ok(db.rpc('finalize_booking', { p_order_id: oid, p_payment_key: `pk_${oid}`, p_raw: { status: 'DONE', totalAmount: 20000 } }));
    const [n] = await notes(uid[0], 'PAYMENT_DONE');
    expect(n.body).toContain('2명 예약이 확정되었습니다');
    expect(n.body).not.toContain('매');
  });
});

describe('D-14 작업 이력 대상 표시', () => {
  it('회원 열람 기록은 가린 이름과 ID 끝 4자리로 회원을 구분합니다', async () => {
    await ok(op.rpc('admin_view_member', { p_user: uid[0] }));
    await ok(op.rpc('admin_view_member', { p_user: uid[1] }));
    const rows = await ok(op.rpc('staff_audit', { p_action: 'VIEW_PII' }));
    const labels = rows.map((r) => r.target_label);
    const { data: p } = await db.from('profiles').select('name').eq('id', uid[0]).single();
    expect(labels.some((l) => l.endsWith(`(${uid[0].slice(-4)})`))).toBe(true);
    expect(new Set(labels).size).toBe(2);
    for (const l of labels) {
      expect(l).toMatch(/\*/);
      expect(l).not.toContain(p.name);
    }
  });
});
