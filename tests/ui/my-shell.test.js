// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { mountMyPage } from '../../src/user/pages/my-shell.js';

describe('마이페이지 틀', () => {
  it('왼쪽 메뉴 이름은 제목 요소가 아니어서 h1 보다 앞선 제목이 없습니다', async () => {
    const el = document.createElement('main');
    document.body.replaceChildren(el);
    const api = { getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }), myCounts: vi.fn().mockResolvedValue({}) };
    const shell = await mountMyPage(el, { api, go: vi.fn(), active: 'bookings', next: '#/me/bookings' });
    shell.content.innerHTML = '<h1>예약 내역</h1><h2>예정</h2>';
    const levels = [...el.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => Number(h.tagName[1]));
    expect(levels[0]).toBe(1);
    const nav = el.querySelector('nav.side-nav');
    expect(nav.getAttribute('aria-label')).toBe('마이페이지');
    expect(nav.querySelector('.side-title').textContent).toBe('마이페이지');
  });
});
