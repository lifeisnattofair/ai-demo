import { describe, it, expect } from 'vitest';
import { won, kstDateTime, kstDate, formatPhone } from '../../src/lib/format.js';

describe('format', () => {
  it('won', () => {
    expect(won(1234567)).toBe('1,234,567원');
    expect(won(40000)).toBe('40,000원');
    expect(won(0)).toBe('0원');
  });
  it('kstDateTime', () => {
    expect(kstDateTime('2026-12-10T10:00:00Z')).toBe('2026. 12. 10.(목) 19:00');
  });
  it('kstDateTime 날짜 경계는 한국 시간 기준입니다', () => {
    expect(kstDateTime('2026-12-31T15:30:00Z')).toBe('2027. 1. 1.(금) 00:30');
  });
  it('kstDate', () => {
    expect(kstDate('2026-12-10T10:00:00Z')).toBe('2026. 12. 10.(목)');
  });
  it('formatPhone', () => {
    expect(formatPhone('01012345678')).toBe('010-1234-5678');
    expect(formatPhone('0111234567')).toBe('011-123-4567');
  });
});
