// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { filterPrograms, validateProgram } from '../../src/admin/pages/programs.js';
import { filterOfferings, validateOffering, weeklyLessons } from '../../src/admin/pages/offerings.js';
import { offeringState } from '../../src/admin/components/page.js';
import { fromKstInput, kstDayKey, toKstInput } from '../../src/lib/format.js';
import { toCsv } from '../../src/lib/csv.js';

describe('KST 입력 값', () => {
  it('datetime-local 값과 ISO 를 KST 기준으로 바꿉니다', () => {
    expect(toKstInput('2026-12-01T10:30:00Z')).toBe('2026-12-01T19:30');
    expect(fromKstInput('2026-12-01T19:30')).toBe('2026-12-01T10:30:00.000Z');
    expect(fromKstInput('2026-12-02')).toBe('2026-12-01T15:00:00.000Z');
    expect(fromKstInput('12/01')).toBeNull();
    expect(kstDayKey('2026-12-01T16:00:00Z')).toBe('2026-12-02');
  });
});

describe('프로그램 목록과 입력 검사', () => {
  const rows = [
    { id: 1, type: 'COURSE', title: '시민 합창 교실', is_public: true },
    { id: 2, type: 'PERFORMANCE', title: '현의 대화', is_public: false },
  ];
  it('유형, 공개 여부, 이름으로 거릅니다', () => {
    expect(filterPrograms(rows, { type: 'COURSE' }).map((r) => r.id)).toEqual([1]);
    expect(filterPrograms(rows, { open: 'N' }).map((r) => r.id)).toEqual([2]);
    expect(filterPrograms(rows, { q: '합창' }).map((r) => r.id)).toEqual([1]);
  });
  it('유형과 이름은 필수입니다', () => {
    expect(validateProgram({ type: '', title: '' })).toEqual({ type: expect.any(String), title: expect.any(String) });
    expect(validateProgram({ type: 'COURSE', title: '가'.repeat(101) }).title).toContain('100자');
  });
});

describe('회차 입력 검사', () => {
  const nowMs = Date.parse('2026-12-01T00:00:00Z');
  const base = {
    program_id: 'p', starts_at: '2026-12-10T10:00:00Z', ends_at: '2026-12-10T12:00:00Z',
    sale_starts_at: '2026-12-01T00:00:00Z', sale_ends_at: '2026-12-10T10:00:00Z', capacity: 20, prices: [{ grade: null, price: 10000 }],
  };
  it('올바른 값은 통과합니다', () => {
    expect(validateOffering(base, { type: 'EXPERIENCE', isNew: true, nowMs })).toEqual({});
  });
  it('일정 순서, 지난 일시, 판매 기간, 정원, 가격을 검사합니다', () => {
    const v = (over, o = {}) => validateOffering({ ...base, ...over }, { type: 'EXPERIENCE', isNew: true, nowMs, ...o });
    expect(v({ ends_at: '2026-12-10T09:00:00Z' })).toHaveProperty('ends_at');
    expect(v({ starts_at: '2026-11-30T10:00:00Z' })).toHaveProperty('starts_at');
    expect(v({ sale_ends_at: '2026-12-11T00:00:00Z' })).toHaveProperty('sale_ends_at');
    expect(v({ capacity: 0 })).toHaveProperty('capacity');
    expect(v({ capacity: 4 }, { minCapacity: 5 }).capacity).toContain('5명');
    expect(v({ prices: [{ grade: null, price: -1 }] })).toHaveProperty('price_N');
    expect(validateOffering({ ...base, capacity: NaN }, { type: 'PERFORMANCE', isNew: true, nowMs })).toEqual({});
  });
  it('정규 강좌 수업은 주 1회로 만들고 종료는 마지막 수업보다 늦어야 합니다', () => {
    const lessons = weeklyLessons('2026-12-10T10:00:00Z', 3);
    expect(lessons).toEqual(['2026-12-10T10:00:00.000Z', '2026-12-17T10:00:00.000Z', '2026-12-24T10:00:00.000Z']);
    const e = validateOffering({ ...base, lessonCount: 3, lastLesson: lessons[2] }, { type: 'COURSE', isNew: true, nowMs });
    expect(e.ends_at).toContain('마지막 수업');
  });
  it('상태와 기간으로 회차를 거릅니다', () => {
    const rows = [
      { ...base, id: 'a', program_id: 'p', program: { type: 'EXPERIENCE' }, status: 'OPEN' },
      { ...base, id: 'b', program_id: 'q', program: { type: 'COURSE' }, status: 'CANCELLED', starts_at: '2026-12-20T10:00:00Z' },
    ];
    expect(offeringState(rows[0], nowMs).text).toBe('판매 중');
    expect(filterOfferings(rows, { state: 'CANCELLED' }, nowMs).map((r) => r.id)).toEqual(['b']);
    expect(filterOfferings(rows, { dateFrom: '2026-12-15' }, nowMs).map((r) => r.id)).toEqual(['b']);
    expect(filterOfferings(rows, { program: 'p' }, nowMs).map((r) => r.id)).toEqual(['a']);
  });
});

describe('toCsv', () => {
  it('BOM 을 붙이고 쉼표와 따옴표를 감쌉니다', () => {
    const out = toCsv([{ key: 't', label: '제목' }], [{ t: 'A, "B"' }]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.slice(1).split('\n')[1]).toBe('"A, ""B"""');
  });
});
