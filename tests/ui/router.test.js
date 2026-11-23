// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRouter } from '../../src/lib/router.js';

describe('createRouter', () => {
  let el;
  beforeEach(() => {
    el = document.createElement('main');
    window.location.hash = '';
  });

  it('#/programs/abc 는 핸들러에 {id:"abc"}를 넘깁니다', async () => {
    const handler = vi.fn();
    const router = createRouter({ '#/programs/:id': handler }, el);
    await router.go('#/programs/abc');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual({ id: 'abc' });
    expect(handler.mock.calls[0][1]).toBe(el);
  });

  it('없는 경로는 404 문구를 보여 줍니다', async () => {
    const router = createRouter({ '#/': vi.fn() }, el);
    await router.go('#/nowhere');
    expect(el.textContent).toContain('페이지를 찾을 수 없습니다.');
  });

  it('쿼리 문자열은 경로 비교에서 빼고 세 번째 인자로 넘깁니다', async () => {
    const handler = vi.fn();
    const router = createRouter({ '#/login': handler }, el);
    await router.go('#/login?next=%23%2Faccount');
    expect(handler.mock.calls[0][2].get('next')).toBe('#/account');
  });

  it('start()는 현재 해시를 렌더링하고 hashchange를 따라갑니다', async () => {
    const home = vi.fn();
    const detail = vi.fn();
    const router = createRouter({ '#/': home, '#/programs/:id': detail }, el);
    router.start();
    await new Promise((r) => setTimeout(r, 10));
    expect(home).toHaveBeenCalledTimes(1);
    window.location.hash = '#/programs/z9';
    await new Promise((r) => setTimeout(r, 30));
    expect(detail).toHaveBeenCalledWith({ id: 'z9' }, el, expect.anything());
  });

  it('핸들러가 던지면 안내 문구를 보여 줍니다', async () => {
    const router = createRouter({ '#/': () => { throw new Error('x'); } }, el);
    await router.go('#/');
    expect(el.textContent).toContain('요청을 처리하지 못했습니다.');
  });

  it('잘못된 퍼센트 인코딩 주소는 404 화면을 보여 줍니다', async () => {
    const handler = vi.fn();
    el.textContent = '이전 화면';
    const router = createRouter({ '#/programs/:id': handler }, el);
    await router.go('#/programs/%E0%A4%A');
    expect(handler).not.toHaveBeenCalled();
    expect(el.textContent).toContain('페이지를 찾을 수 없습니다.');
  });

  it('화면이 바뀌면 문서 제목을 바꾸고 본문으로 초점을 옮깁니다', async () => {
    document.body.append(el);
    el.tabIndex = -1;
    const router = createRouter({ '#/x': (_p, e) => { e.innerHTML = '<h1>내 정보</h1>'; } }, el);
    await router.go('#/x');
    expect(document.title).toBe('내 정보 | 한빛아트센터');
    expect(document.activeElement).toBe(el);
    el.remove();
  });
});
