import { describe, it, expect } from 'vitest';
import {
  won, kstDateTime, kstDate, kstDatePlain, kstShortDate, kstShortDateTime, kstTime, kstMonthKey,
  kstDateParts, dateRange, dayKeyLabel, monthKeyLabel, formatPhone,
} from '../../src/lib/format.js';

describe('format', () => {
  it('won', () => {
    expect(won(1234567)).toBe('1,234,567원');
    expect(won(40000)).toBe('40,000원');
    expect(won(0)).toBe('0원');
  });
  it('kstDateTime 은 0을 채운 점 형식입니다', () => {
    expect(kstDateTime('2026-12-10T10:00:00Z')).toBe('2026.12.10(목) 19:00');
    expect(kstDateTime('2026-12-01T10:30:00Z')).toBe('2026.12.01(화) 19:30');
  });
  it('kstDateTime 날짜 경계는 한국 시간 기준입니다', () => {
    expect(kstDateTime('2026-12-31T15:30:00Z')).toBe('2027.01.01(금) 00:30');
  });
  it('kstDate, kstDatePlain', () => {
    expect(kstDate('2026-12-10T10:00:00Z')).toBe('2026.12.10(목)');
    expect(kstDate('2026-12-01T00:00:00Z')).toBe('2026.12.01(화)');
    expect(kstDatePlain('2026-12-01T00:00:00Z')).toBe('2026.12.01');
  });
  it('짧은 형식: 12.01, 12.01(화) 19:30, 19:30', () => {
    expect(kstShortDate('2026-12-01T10:30:00Z')).toBe('12.01');
    expect(kstShortDateTime('2026-12-01T10:30:00Z')).toBe('12.01(화) 19:30');
    expect(kstTime('2026-12-01T10:30:00Z')).toBe('19:30');
  });
  it('kstMonthKey, kstDateParts', () => {
    expect(kstMonthKey('2026-12-31T15:30:00Z')).toBe('2027-01');
    expect(kstDateParts('2026-12-01T10:30:00Z')).toMatchObject({ year: '2026', month: '12', day: '01', weekday: '화', key: '2026-12-01' });
  });
  it('dateRange: 같은 해, 다른 해, 같은 날', () => {
    expect(dateRange('2026-12-12T01:00:00Z', '2026-12-13T01:00:00Z')).toBe('2026.12.12 - 12.13');
    expect(dateRange('2026-12-28T01:00:00Z', '2027-01-03T01:00:00Z')).toBe('2026.12.28 - 2027.01.03');
    expect(dateRange('2026-12-12T01:00:00Z', '2026-12-12T09:00:00Z')).toBe('2026.12.12');
    expect(dateRange('2026-12-12T01:00:00Z', '2026-12-13T01:00:00Z', { weekday: true })).toBe('2026.12.12(토) - 12.13(일)');
    expect(dateRange('2026-12-12T01:00:00Z', '2026-12-13T01:00:00Z', { short: true })).toBe('12.12 - 12.13');
    expect(dateRange('2026-12-12T01:00:00Z', '2026-12-12T09:00:00Z', { short: true })).toBe('12.12');
  });
  it('dayKeyLabel, monthKeyLabel', () => {
    expect(dayKeyLabel('2026-12-01')).toBe('2026.12.01(화)');
    expect(dayKeyLabel('2026-12-01', { short: true })).toBe('12.01');
    expect(dayKeyLabel('2026-12-01', { plain: true })).toBe('2026.12.01');
    expect(dayKeyLabel('nope')).toBe('');
    expect(monthKeyLabel('2026-02')).toBe('2026년 2월');
  });
  it('formatPhone', () => {
    expect(formatPhone('01012345678')).toBe('010-1234-5678');
    expect(formatPhone('0111234567')).toBe('011-123-4567');
  });
});
