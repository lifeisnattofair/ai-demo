import { beforeAll, describe, expect, it } from 'vitest';
import { adminClient, resetDb, userClient } from './helpers.js';

const BASE = '2026-12-01T00:00:00+09:00';
const db = adminClient();

beforeAll(async () => {
  await resetDb(BASE);
});

async function rows(table, cols = '*') {
  const { data, error } = await db.from(table).select(cols).limit(5000);
  expect(error).toBeNull();
  return data;
}

describe('schema and seed', () => {
  it('seats: 200 rows, A-J x 20, grades by row', async () => {
    const seats = await rows('seats');
    expect(seats).toHaveLength(200);
    for (const s of seats) {
      const expected = 'ABCD'.includes(s.row_label) ? 'R' : 'EFG'.includes(s.row_label) ? 'S' : 'A';
      expect(s.grade).toBe(expected);
    }
    expect(new Set(seats.map((s) => s.row_label)).size).toBe(10);
  });

  it('programs: 2 per type', async () => {
    const programs = await rows('programs');
    expect(programs).toHaveLength(6);
    for (const t of ['PERFORMANCE', 'EXPERIENCE', 'COURSE']) {
      expect(programs.filter((p) => p.type === t)).toHaveLength(2);
    }
  });

  it('each course offering has 12 weekly lessons', async () => {
    const programs = await rows('programs');
    const courseIds = programs.filter((p) => p.type === 'COURSE').map((p) => p.id);
    const offerings = (await rows('offerings')).filter((o) => courseIds.includes(o.program_id));
    expect(offerings).toHaveLength(2);
    for (const o of offerings) {
      const lessons = (await rows('course_lessons')).filter((l) => l.offering_id === o.id).sort((a, b) => a.seq - b.seq);
      expect(lessons).toHaveLength(12);
      for (let i = 1; i < 12; i++) {
        expect(new Date(lessons[i].starts_at) - new Date(lessons[i - 1].starts_at)).toBe(7 * 86400000);
      }
      expect(new Date(lessons[0].starts_at).getTime()).toBe(new Date(BASE).getTime() + 9 * 86400000);
    }
  });

  it('each performance offering has 200 AVAILABLE inventory seats', async () => {
    const programs = await rows('programs');
    const perfIds = programs.filter((p) => p.type === 'PERFORMANCE').map((p) => p.id);
    const offerings = (await rows('offerings')).filter((o) => perfIds.includes(o.program_id));
    expect(offerings.length).toBeGreaterThan(0);
    for (const o of offerings) {
      const { data, error } = await db.from('inventory_seats').select('status').eq('offering_id', o.id).limit(1000);
      expect(error).toBeNull();
      expect(data).toHaveLength(200);
      expect(data.every((r) => r.status === 'AVAILABLE')).toBe(true);
    }
  });

  it('prices and schedule follow the brief', async () => {
    const programs = await rows('programs');
    const type = Object.fromEntries(programs.map((p) => [p.id, p.type]));
    const offerings = await rows('offerings');
    const prices = await rows('offering_prices');
    const base = new Date(BASE).getTime();
    const days = (o) => (new Date(o.starts_at).getTime() - base) / 86400000;
    for (const o of offerings) {
      const pr = prices.filter((p) => p.offering_id === o.id);
      if (type[o.program_id] === 'PERFORMANCE') {
        expect([10, 20]).toContain(days(o));
        expect(Object.fromEntries(pr.map((p) => [p.grade, p.price]))).toEqual({ R: 40000, S: 30000, A: 20000 });
      } else if (type[o.program_id] === 'EXPERIENCE') {
        expect([5, 12]).toContain(days(o));
        expect(o.capacity).toBe(20);
        expect(pr).toEqual([expect.objectContaining({ grade: null, price: 10000, offering_id: o.id })]);
      } else {
        expect(days(o)).toBe(9);
        expect(o.capacity).toBe(15);
        expect(pr).toEqual([expect.objectContaining({ grade: null, price: 120000, offering_id: o.id })]);
      }
    }
  });

  it('seed accounts exist with matching roles and can sign in', async () => {
    const expected = {
      'member1@demo.test': 'member',
      'member2@demo.test': 'member',
      'member3@demo.test': 'member',
      'operator@demo.test': 'operator',
      'finance@demo.test': 'finance',
    };
    const { data: users, error } = await db.auth.admin.listUsers({ perPage: 100 });
    expect(error).toBeNull();
    const profiles = await rows('profiles');
    for (const [email, role] of Object.entries(expected)) {
      const u = users.users.find((x) => x.email === email);
      expect(u, email).toBeTruthy();
      expect(profiles.find((p) => p.id === u.id)?.role).toBe(role);
    }
    const c = await userClient('member1@demo.test');
    const { data } = await c.auth.getUser();
    expect(data.user.email).toBe('member1@demo.test');
  });

  it('settings defaults', async () => {
    const s = Object.fromEntries((await rows('app_settings')).map((r) => [r.key, r.value]));
    expect(s.env).toBe('local');
    expect(s.clock_enabled).toBe(true);
    expect(s.pg_mock_mode).toBe('APPROVE');
  });

  it('inventory_seats rejects a duplicate (offering_id, seat_id)', async () => {
    const { data } = await db.from('inventory_seats').select('offering_id, seat_id').limit(1);
    const { error } = await db.from('inventory_seats').insert(data[0]);
    expect(error?.code).toBe('23505');
  });

  it('seed_demo keeps accounts when re-run', async () => {
    await resetDb(BASE);
    expect(await rows('profiles')).toHaveLength(5);
    expect(await rows('programs')).toHaveLength(6);
  });
});
