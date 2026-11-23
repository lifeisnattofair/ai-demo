// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startHoldTimer } from '../../src/user/components/hold-timer.js';

const EXPIRED_MSG = '선점 시간이 지나 좌석이 해제되었습니다. 다시 선택해 주세요.';
const T0 = new Date('2026-11-23T03:00:00Z');

let el;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  document.body.innerHTML = '<div id="t"></div>';
  el = document.getElementById('t');
});
afterEach(() => vi.useRealTimers());

const now = () => new Date(Date.now());
const text = () => el.textContent.replace(/\s+/g, ' ').trim();

describe('선점 타이머', () => {
  it('처음에는 남은 선점 시간 10:00 을 보여 주고 1초마다 줄어든다', () => {
    startHoldTimer(el, new Date(T0.getTime() + 600000), now, () => {});
    expect(text()).toContain('남은 선점 시간 10:00');
    vi.advanceTimersByTime(1000);
    expect(text()).toContain('남은 선점 시간 09:59');
    vi.advanceTimersByTime(59000);
    expect(text()).toContain('남은 선점 시간 09:00');
  });

  it('화면 낭독 알림(aria-live polite)은 분이 바뀔 때만 갱신된다', () => {
    startHoldTimer(el, new Date(T0.getTime() + 600000), now, () => {});
    const live = el.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    const first = live.textContent;
    vi.advanceTimersByTime(30000);
    expect(live.textContent).toBe(first);
    vi.advanceTimersByTime(30000);
    expect(live.textContent).not.toBe(first);
    expect(el.getAttribute('aria-live')).toBe('off');
  });

  it('10분이 지나면 onExpire 를 한 번만 부르고 해제 안내를 보여 준다', () => {
    const onExpire = vi.fn();
    startHoldTimer(el, new Date(T0.getTime() + 600000), now, onExpire);
    vi.advanceTimersByTime(599000);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(text()).toContain(EXPIRED_MSG);
    vi.advanceTimersByTime(60000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('이미 지난 시각으로 시작하면 바로 만료 처리한다', () => {
    const onExpire = vi.fn();
    startHoldTimer(el, new Date(T0.getTime() - 1000), now, onExpire);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(text()).toContain(EXPIRED_MSG);
  });

  it('stop 을 부르면 더 이상 갱신하지 않고 만료도 부르지 않는다', () => {
    const onExpire = vi.fn();
    const stop = startHoldTimer(el, new Date(T0.getTime() + 5000), now, onExpire);
    stop();
    vi.advanceTimersByTime(10000);
    expect(onExpire).not.toHaveBeenCalled();
  });
});
