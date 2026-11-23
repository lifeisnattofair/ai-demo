// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showSkeleton } from '../../src/components/skeleton.js';
import { withBusy } from '../../src/components/button-busy.js';

beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = '<div id="h"></div><button id="b" class="btn">다음</button>'; });
afterEach(() => vi.useRealTimers());

describe('스켈레톤', () => {
  it('300ms 안에 끝나면 모양을 보이지 않고, 길어지면 보인다', () => {
    const host = document.getElementById('h');
    const release = showSkeleton(host, 'seat-map');
    expect(host.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('[role="status"]').textContent).toBe('불러오는 중');
    expect(host.querySelector('.sk-shape').hidden).toBe(true);
    vi.advanceTimersByTime(299);
    expect(host.querySelector('.sk-shape').hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(host.querySelector('.sk-shape').hidden).toBe(false);
    expect(host.querySelectorAll('.sk-row')).toHaveLength(10);
    release();
    expect(host.querySelector('.skeleton')).toBeNull();
    expect(host.hasAttribute('aria-busy')).toBe(false);
  });
});

describe('버튼 처리 중 상태', () => {
  it('처리 중 문구와 중복 클릭 차단 후 원래대로 돌아온다', async () => {
    vi.useRealTimers();
    const b = document.getElementById('b');
    let finish;
    const fn = vi.fn(() => new Promise((r) => { finish = r; }));
    const p = withBusy(b, fn);
    expect(b.textContent).toBe('처리 중');
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    await withBusy(b, fn);
    expect(fn).toHaveBeenCalledTimes(1);
    finish('ok');
    expect(await p).toBe('ok');
    expect(b.textContent).toBe('다음');
    expect(b.hasAttribute('aria-busy')).toBe(false);
    expect(b.hasAttribute('aria-disabled')).toBe(false);
  });

  it('실패해도 원래대로 돌아온다', async () => {
    vi.useRealTimers();
    const b = document.getElementById('b');
    await expect(withBusy(b, () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(b.textContent).toBe('다음');
  });
});
