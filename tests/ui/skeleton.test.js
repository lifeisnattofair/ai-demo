// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showSkeleton, SKELETON_KINDS } from '../../src/components/skeleton.js';

beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = '<div id="h"><p>이전 내용</p></div>'; });
afterEach(() => vi.useRealTimers());
const host = () => document.getElementById('h');

describe('스켈레톤', () => {
  it('300ms 안에 해제하면 스켈레톤이 DOM에 나타나지 않는다', () => {
    const release = showSkeleton(host(), 'cards');
    expect(host().getAttribute('aria-busy')).toBe('true');
    vi.advanceTimersByTime(299);
    expect(host().querySelector('.skeleton')).toBeNull();
    release();
    vi.advanceTimersByTime(1000);
    expect(host().querySelector('.skeleton')).toBeNull();
    expect(host().hasAttribute('aria-busy')).toBe(false);
  });

  it('300ms 후에는 모양과 「불러오는 중」 문구가 나타나고 aria-busy="true"다', () => {
    const release = showSkeleton(host(), 'seat-map');
    vi.advanceTimersByTime(300);
    const box = host().querySelector('.skeleton');
    expect(box).not.toBeNull();
    expect(host().getAttribute('aria-busy')).toBe('true');
    expect(box.querySelector('.sr-only').textContent).toBe('불러오는 중');
    expect(box.querySelector('.sk-shape').getAttribute('aria-hidden')).toBe('true');
    expect(box.querySelectorAll('.sk-row')).toHaveLength(10);
    release();
    expect(host().querySelector('.skeleton')).toBeNull();
    expect(host().hasAttribute('aria-busy')).toBe(false);
  });

  it.each(['cards', 'detail', 'seat-map', 'table', 'form', 'list', 'kpis', 'chart'])('%s 모양을 그린다', (kind) => {
    expect(SKELETON_KINDS).toContain(kind);
    showSkeleton(host(), kind, { delayMs: 0 });
    vi.advanceTimersByTime(0);
    const box = host().querySelector('.skeleton');
    expect(box.classList.contains(`sk-${kind}`)).toBe(true);
    expect(box.querySelectorAll('.sk-block').length).toBeGreaterThan(0);
  });

  it('table 은 머리글 띠와 열이 있는 행을 그린다(관리자 표 모양)', () => {
    showSkeleton(host(), 'table', { delayMs: 0 });
    vi.advanceTimersByTime(0);
    expect(host().querySelector('.sk-th')).not.toBeNull();
    expect(host().querySelectorAll('.sk-tr').length).toBe(8);
  });

  it('모르는 kind 는 table 모양으로 그리고, 해제는 여러 번 불러도 안전하다', () => {
    const release = showSkeleton(host(), 'nope', { delayMs: 0 });
    vi.advanceTimersByTime(0);
    expect(host().querySelector('.sk-tr')).not.toBeNull();
    release();
    release();
    expect(host().querySelector('.skeleton')).toBeNull();
  });

  it('같은 요소에 스켈레톤이 둘이면 마지막 것을 해제할 때 aria-busy 를 지운다', () => {
    const a = showSkeleton(host(), 'kpis', { delayMs: 0 });
    const b = showSkeleton(host(), 'chart', { delayMs: 0 });
    a();
    expect(host().getAttribute('aria-busy')).toBe('true');
    b();
    expect(host().hasAttribute('aria-busy')).toBe(false);
  });
});
