import { vi } from 'vitest';
import { messageFor } from '../../src/lib/api.js';

export const NOW = new Date('2026-11-23T03:00:00Z');
export const iso = (min) => new Date(NOW.getTime() + min * 60000).toISOString();

export function fakeApi(over = {}) {
  return {
    messageFor,
    getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }),
    getMyHold: vi.fn().mockResolvedValue({
      id: 'h1', offering_id: 'o1', qty: 3, status: 'ACTIVE', expires_at: iso(10),
      seats: [1, 2, 3].map((n) => ({ seat_id: n, row_label: 'A', seat_no: n, grade: 'R' })),
    }),
    getOffering: vi.fn().mockResolvedValue({
      id: 'o1', starts_at: iso(60 * 24 * 20), prices: [{ grade: 'R', price: 40000 }, { grade: 'S', price: 30000 }],
      program: { id: 'p1', type: 'PERFORMANCE', title: '실내악', venue: '소극장', poster_image: 'quartet', poster_tone: 'dark' },
    }),
    ...over,
  };
}
