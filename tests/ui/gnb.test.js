// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { gnbMenus, headerHtml, mountHeader, footerHtml } from '../../src/user/components/header.js';

const NOW = new Date('2026-11-23T03:00:00Z'); // 2026.11.23(월) 12:00 KST
// 사용자 화면 라우터(src/user/main.js)가 처리하는 주소 모양
const ROUTES = [/^#\/programs\?/, /^#\/guide\/(refund|visit|course)$/];

const key = (el, k, opts = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));

function fakeApi() {
  return { getSession: vi.fn().mockResolvedValue(null), getProfile: vi.fn(), onAuthChange: vi.fn(), signOut: vi.fn() };
}

describe('GNB 메뉴 구성', () => {
  it('4개 1depth 와 2depth 링크는 모두 실제 화면으로 갑니다', () => {
    const menus = gnbMenus(NOW);
    expect(menus.map((m) => m.label)).toEqual(['공연', '체험', '정규 강좌', '이용 안내']);
    const links = menus.flatMap((m) => m.items);
    expect(links.length).toBeGreaterThanOrEqual(8);
    for (const { href, label } of links) {
      expect(label.trim()).not.toBe('');
      expect(ROUTES.some((re) => re.test(href)), href).toBe(true);
    }
    expect(links.some((l) => l.label.includes('대관'))).toBe(false);
  });

  it('이번 달, 다음 달 공연은 한국 시간 기준 달 필터를 씁니다(연말에는 다음 해로 넘어감)', () => {
    const perf = gnbMenus(NOW)[0].items;
    expect(perf.map((i) => i.href)).toEqual([
      '#/programs?type=PERFORMANCE',
      '#/programs?type=PERFORMANCE&month=2026-11',
      '#/programs?type=PERFORMANCE&month=2026-12',
    ]);
    const dec = gnbMenus(new Date('2026-12-31T16:00:00Z'))[0].items; // 2027.01.01 01:00 KST
    expect(dec[1].href).toContain('month=2027-01');
    const dec2 = gnbMenus(new Date('2026-12-10T03:00:00Z'))[0].items;
    expect(dec2[2].href).toContain('month=2027-01');
  });

  it('가족 체험은 대상 필터, 이용 안내는 환불 규정과 오시는 길로 갑니다', () => {
    const [, exp, course, guide] = gnbMenus(NOW);
    expect(exp.items[1].href).toBe(`#/programs?type=EXPERIENCE&target=${encodeURIComponent('초등학생 동반 가족')}`);
    expect(course.items.map((i) => i.href)).toEqual(['#/programs?type=COURSE', '#/guide/course']);
    expect(guide.items.map((i) => i.href)).toEqual(['#/guide/refund', '#/guide/visit']);
  });

  it('푸터에도 이용 안내 링크가 있습니다', () => {
    const div = document.createElement('div');
    div.innerHTML = footerHtml();
    const hrefs = [...div.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['#/guide/refund', '#/guide/visit']));
  });
});

describe('GNB 2depth 메뉴 동작', () => {
  let host;
  beforeEach(async () => {
    document.body.innerHTML = '<header class="site-header"></header><main><a href="#/x" id="out">밖</a></main>';
    host = document.querySelector('.site-header');
    await mountHeader(host, { api: fakeApi(), now: () => NOW });
  });
  const tops = () => [...host.querySelectorAll('.gnb .gnb-top')];
  const panelOf = (btn) => document.getElementById(btn.getAttribute('aria-controls'));

  it('1depth 는 aria-expanded/aria-controls 를 가진 버튼이고 처음에는 닫혀 있습니다', () => {
    expect(tops()).toHaveLength(4);
    for (const b of tops()) {
      expect(b.tagName).toBe('BUTTON');
      expect(b.getAttribute('aria-expanded')).toBe('false');
      expect(panelOf(b).hidden).toBe(true);
    }
  });

  it('Enter/Space(클릭)로 열고, 다시 누르면 닫힙니다. 하나를 열면 다른 메뉴는 닫힙니다', () => {
    const [a, b] = tops();
    a.click();
    expect(a.getAttribute('aria-expanded')).toBe('true');
    expect(panelOf(a).hidden).toBe(false);
    b.click();
    expect(a.getAttribute('aria-expanded')).toBe('false');
    expect(b.getAttribute('aria-expanded')).toBe('true');
    b.click();
    expect(b.getAttribute('aria-expanded')).toBe('false');
  });

  it('아래 화살표는 메뉴를 열고 첫 링크로, 위/아래 화살표는 링크 사이를 움직입니다', () => {
    const [a] = tops();
    a.focus();
    key(a, 'ArrowDown');
    const links = [...panelOf(a).querySelectorAll('a')];
    expect(a.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(links[0]);
    key(links[0], 'ArrowDown');
    expect(document.activeElement).toBe(links[1]);
    key(links[1], 'ArrowUp');
    expect(document.activeElement).toBe(links[0]);
    key(links[0], 'ArrowUp');
    expect(document.activeElement).toBe(links[links.length - 1]);
  });

  it('Esc 는 메뉴를 닫고 초점을 1depth 버튼으로 돌려 둡니다', () => {
    const [a] = tops();
    a.focus();
    key(a, 'ArrowDown');
    key(document.activeElement, 'Escape');
    expect(a.getAttribute('aria-expanded')).toBe('false');
    expect(panelOf(a).hidden).toBe(true);
    expect(document.activeElement).toBe(a);
  });

  it('좌우 화살표는 1depth 사이를 움직이고, 열린 상태면 옆 메뉴를 엽니다', () => {
    const [a, b, , d] = tops();
    a.focus();
    key(a, 'ArrowRight');
    expect(document.activeElement).toBe(b);
    key(b, 'ArrowLeft');
    key(a, 'ArrowLeft');
    expect(document.activeElement).toBe(d);
    a.click();
    const first = panelOf(a).querySelector('a');
    first.focus();
    key(first, 'ArrowRight');
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(a.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(b);
  });

  it('메뉴 밖을 누르거나 초점이 밖으로 나가면 닫힙니다', () => {
    const [a] = tops();
    a.click();
    document.getElementById('out').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(a.getAttribute('aria-expanded')).toBe('false');
    a.click();
    a.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.getElementById('out') }));
    expect(a.getAttribute('aria-expanded')).toBe('false');
  });

  it('마우스를 올려 열린 메뉴는 이어서 눌러도 닫히지 않고, 한 번 더 누르면 닫힙니다', () => {
    const mm = window.matchMedia;
    window.matchMedia = () => ({ matches: true });
    try {
      const [a] = tops();
      a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      expect(a.getAttribute('aria-expanded')).toBe('true');
      a.click();
      expect(a.getAttribute('aria-expanded')).toBe('true');
      a.click();
      expect(a.getAttribute('aria-expanded')).toBe('false');
    } finally {
      window.matchMedia = mm;
    }
  });

  it('2depth 링크를 고르면 메뉴가 닫힙니다', () => {
    const [a] = tops();
    a.click();
    const link = panelOf(a).querySelector('a');
    link.addEventListener('click', (e) => e.preventDefault());
    link.click();
    expect(a.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('모바일 전체 메뉴 아코디언', () => {
  it('전체 메뉴 안에서 1depth 버튼이 하위 목록을 펼치고 접습니다', async () => {
    document.body.innerHTML = '<header class="site-header"></header>';
    const host = document.querySelector('.site-header');
    await mountHeader(host, { api: fakeApi(), now: () => NOW });
    const menuBtn = host.querySelector('.menu-btn');
    menuBtn.click();
    expect(menuBtn.getAttribute('aria-expanded')).toBe('true');
    const acc = [...host.querySelectorAll('.m-menu .m-acc')];
    expect(acc).toHaveLength(4);
    const list = document.getElementById(acc[0].getAttribute('aria-controls'));
    expect(list.hidden).toBe(true);
    acc[0].click();
    expect(acc[0].getAttribute('aria-expanded')).toBe('true');
    expect(list.hidden).toBe(false);
    expect([...list.querySelectorAll('a')].length).toBe(3);
    acc[0].click();
    expect(list.hidden).toBe(true);
    key(host.querySelector('.m-menu'), 'Escape');
    expect(menuBtn.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menuBtn);
  });

  it('headerHtml 은 로그인 여부와 관계없이 같은 GNB 를 그립니다', () => {
    const a = document.createElement('div');
    a.innerHTML = headerHtml({ loggedIn: true, name: '김한빛' }, gnbMenus(NOW));
    expect(a.querySelectorAll('.gnb .gnb-top')).toHaveLength(4);
    expect(a.textContent).toContain('김한빛 님');
  });
});

describe('이용 안내 화면', () => {
  it.each([
    ['renderGuideRefund', '취소/환불 규정', ['결제액의 10%', '결제액의 30%', '결제액의 2/3', '환불 없음']],
    ['renderGuideVisit', '관람 안내/오시는 길', ['한빛시 문화로 120', '휠체어석', '주차']],
    ['renderGuideCourse', '수강 신청 안내', ['1인 1건', '동반 할인 없음']],
  ])('%s 는 제목과 실제 내용을 보입니다', async (fn, title, words) => {
    const mod = await import('../../src/user/pages/guide.js');
    const el = document.createElement('main');
    mod[fn](el);
    expect(el.querySelector('h1').textContent).toBe(title);
    for (const w of words) expect(el.textContent).toContain(w);
    expect(el.querySelector('.guide-tabs [aria-current="page"]').textContent).toBe(title);
    expect(el.textContent).not.toMatch(/[·—]/);
    for (const a of el.querySelectorAll('a')) expect(a.getAttribute('href')).toMatch(/^#\//);
  });
});
