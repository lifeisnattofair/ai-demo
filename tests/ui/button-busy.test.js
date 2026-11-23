// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withBusy, isBusy } from '../../src/components/button-busy.js';

beforeEach(() => { document.body.innerHTML = '<button id="b" class="btn">다음</button>'; });
const btn = () => document.getElementById('b');
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('버튼 처리 중 상태', () => {
  it('처리 중에는 스피너, 「처리 중」 문구, aria-disabled 를 보이고 끝나면 원래대로 돌아온다', async () => {
    const b = btn();
    let finish;
    const p = withBusy(b, () => new Promise((r) => { finish = r; }));
    expect(b.textContent).toBe('처리 중');
    expect(b.querySelector('.spinner')).not.toBeNull();
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(isBusy(b)).toBe(true);
    finish('ok');
    expect(await p).toBe('ok');
    expect(b.textContent).toBe('다음');
    expect(b.hasAttribute('aria-busy')).toBe(false);
    expect(b.hasAttribute('aria-disabled')).toBe(false);
    expect(isBusy(b)).toBe(false);
  });

  it('처리 중 두 번째 클릭은 무시하고, 뒤따르는 처리(다시 그리기)도 실행하지 않는다', async () => {
    const b = btn();
    let finish;
    const fn = vi.fn(() => new Promise((r) => { finish = r; }));
    const after = vi.fn();
    b.addEventListener('click', async () => { await withBusy(b, fn); after(); });
    b.click();
    b.click();
    b.click();
    expect(fn).toHaveBeenCalledTimes(1);
    finish();
    await flush();
    await flush();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('실패해도 버튼을 원래대로 돌리고 오류를 넘긴다', async () => {
    const b = btn();
    await expect(withBusy(b, () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(b.textContent).toBe('다음');
    expect(isBusy(b)).toBe(false);
    expect(b.hasAttribute('aria-disabled')).toBe(false);
  });

  it('처음부터 있던 aria-disabled 값은 그대로 돌려 둔다', async () => {
    const b = btn();
    b.setAttribute('aria-disabled', 'false');
    await withBusy(b, async () => 1);
    expect(b.getAttribute('aria-disabled')).toBe('false');
  });

  it('처리 중에는 버튼 너비를 유지해 주변 배치가 흔들리지 않는다', async () => {
    const b = btn();
    Object.defineProperty(b, 'offsetWidth', { value: 120, configurable: true });
    let finish;
    const p = withBusy(b, () => new Promise((r) => { finish = r; }));
    expect(b.style.minWidth).toBe('120px');
    finish();
    await p;
    expect(b.style.minWidth).toBe('');
  });
});
