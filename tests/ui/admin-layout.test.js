// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MENU, renderLayout, visibleMenu } from '../../src/admin/layout.js';
import { renderSearchBox } from '../../src/admin/components/search-box.js';
import { renderDataTable } from '../../src/admin/components/data-table.js';

const user = { name: '재무 담당', email: 'finance@demo.test', lastSignInAt: '2026-12-07T00:12:00Z' };
const labels = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent.trim());

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
});

describe('MENU', () => {
  it('설계 5-9의 메뉴 구성 그대로입니다', () => {
    expect(MENU.map((g) => g.label)).toEqual(['대시보드', '프로그램관리', '예약관리', '결제/정산', '시스템']);
    expect(MENU[0]).toMatchObject({ label: '대시보드', path: '#/', roles: ['operator', 'finance'] });
    expect(MENU[1].children.map((c) => c.label)).toEqual(['프로그램 목록', '회차/좌석 관리']);
    expect(MENU[2].children.map((c) => c.label)).toEqual(['예약 내역', '대기자 관리']);
    expect(MENU[3].children.map((c) => c.label)).toEqual(['결제/환불 내역', '회차 취소 승인', '정산 현황']);
    expect(MENU[4].children.map((c) => c.label)).toEqual(['작업 이력', '검수용 시계', '시연 데이터 초기화']);
  });

  it('환경에 따라 검수용 시계와 시연 데이터 초기화를 나눠 보입니다', () => {
    const sys = (env) => visibleMenu('operator', env).find((g) => g.label === '시스템').children.map((c) => c.label);
    expect(sys('qa')).toEqual(['작업 이력', '검수용 시계']);
    expect(sys('demo')).toEqual(['작업 이력', '시연 데이터 초기화']);
    expect(sys('local')).toEqual(['작업 이력', '검수용 시계', '시연 데이터 초기화']);
  });
});

describe('renderLayout', () => {
  it('role finance이면 「프로그램관리」가 없고 「결제/정산」이 있습니다', () => {
    const root = document.getElementById('root');
    renderLayout(root, { user, role: 'finance', current: '#/settlement', env: 'local' });
    const heads = labels(root, '.sidebar .s-head');
    expect(heads).not.toContain('프로그램관리');
    expect(heads).toContain('결제/정산');
    expect(root.querySelector('.topbar .role').textContent).toBe('정산 담당');
    expect(root.querySelector('.topbar .who').textContent).toContain('재무 담당');
  });

  it('현재 메뉴에 aria-current="page"가 붙고, 경로가 바뀌면 옮겨 갑니다', () => {
    const root = document.getElementById('root');
    const layout = renderLayout(root, { user, role: 'operator', current: '#/programs/abc', env: 'local' });
    const current = () => [...root.querySelectorAll('.sidebar [aria-current="page"]')].map((a) => a.textContent.trim());
    expect(current()).toEqual(['프로그램 목록']);
    layout.setCurrent('#/offerings');
    expect(current()).toEqual(['회차/좌석 관리']);
    layout.setCurrent('#/');
    expect(current()).toEqual(['대시보드']);
    expect(layout.content).toBeInstanceOf(HTMLElement);
  });

  it('메뉴 묶음을 접고 펼칩니다', () => {
    const root = document.getElementById('root');
    renderLayout(root, { user, role: 'operator', current: '#/', env: 'local' });
    const head = [...root.querySelectorAll('.sidebar button.s-head')].find((b) => b.textContent.includes('예약관리'));
    const list = document.getElementById(head.getAttribute('aria-controls'));
    expect(head.getAttribute('aria-expanded')).toBe('true');
    head.click();
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(list.hidden).toBe(true);
    head.click();
    expect(list.hidden).toBe(false);
  });

  it('건수 배지는 숫자와 단위를 함께 씁니다', () => {
    const root = document.getElementById('root');
    const layout = renderLayout(root, { user, role: 'operator', current: '#/', env: 'local' });
    layout.setCounts({ '#/waitlist': 7 });
    const cnt = root.querySelector('a[href="#/waitlist"] .cnt');
    expect(cnt.textContent).toContain('7');
    expect(cnt.querySelector('.sr-only').textContent).toBe('건');
  });

  it('자동 로그아웃 타이머를 연장하고, 시간이 다 되면 로그아웃합니다', () => {
    vi.useFakeTimers();
    let t = 0;
    const onLogout = vi.fn();
    const root = document.getElementById('root');
    const layout = renderLayout(root, { user, role: 'operator', current: '#/', env: 'local', onLogout, now: () => t, idleMs: 60_000 });
    const timer = root.querySelector('.session .num');
    expect(timer.textContent).toBe('01:00');
    t = 30_000; vi.advanceTimersByTime(1000);
    expect(timer.textContent).toBe('00:30');
    root.querySelector('.session button').click();
    expect(timer.textContent).toBe('01:00');
    t = 95_000; vi.advanceTimersByTime(1000);
    expect(onLogout).toHaveBeenCalledTimes(1);
    layout.destroy();
    vi.useRealTimers();
  });

  it('좁은 화면 메뉴 버튼은 메뉴를 열고 Esc로 닫습니다', () => {
    const root = document.getElementById('root');
    renderLayout(root, { user, role: 'operator', current: '#/', env: 'local' });
    const toggle = root.querySelector('.menu-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('.shell').classList.contains('nav-open')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('renderSearchBox', () => {
  it('「조회」는 입력값으로, 「초기화」는 처음 값으로 되돌려 조회합니다', () => {
    const root = document.getElementById('root');
    const onSearch = vi.fn();
    renderSearchBox(root, [
      { name: 'type', label: '유형', type: 'select', options: [{ value: '', label: '전체' }, { value: 'COURSE', label: '정규 강좌' }] },
      { name: 'q', label: '프로그램명', type: 'text', placeholder: '프로그램명 입력' },
    ], onSearch);
    expect(labels(root, '.search-grid .sl')).toEqual(['유형', '프로그램명']);
    root.querySelector('select[name="type"]').value = 'COURSE';
    root.querySelector('input[name="q"]').value = '합창';
    [...root.querySelectorAll('.search-actions button')].find((b) => b.textContent === '조회').click();
    expect(onSearch).toHaveBeenLastCalledWith({ type: 'COURSE', q: '합창' });
    [...root.querySelectorAll('.search-actions button')].find((b) => b.textContent === '초기화').click();
    expect(onSearch).toHaveBeenLastCalledWith({ type: '', q: '' });
    expect(root.querySelector('input[name="q"]').value).toBe('');
  });
});

describe('renderDataTable', () => {
  const columns = [
    { key: 'title', label: '프로그램' },
    { key: 'capacity', label: '정원', type: 'number' },
    { key: 'status', label: '상태', type: 'chip', chip: (r) => ({ text: r.status === 'OPEN' ? '판매 중' : '취소', tone: r.status === 'OPEN' ? 'ok' : 'cancel' }) },
  ];

  it('숫자 열은 오른쪽 정렬, 상태는 글자가 있는 칩, 현재 페이지 표시와 이동', () => {
    const root = document.getElementById('root');
    const onPage = vi.fn();
    renderDataTable(root, {
      columns, rows: [{ title: '가', capacity: 1200, status: 'OPEN' }, { title: '나', capacity: 5, status: 'CANCELLED' }],
      total: 45, page: 1, pageSize: 20, onPage, caption: '회차 목록',
    });
    const th = root.querySelectorAll('thead th');
    expect(th[1].classList.contains('r')).toBe(true);
    const firstRow = root.querySelectorAll('tbody tr')[0].querySelectorAll('td');
    expect(firstRow[1].classList.contains('r')).toBe(true);
    expect(firstRow[1].textContent).toBe('1,200');
    expect(firstRow[2].querySelector('.chip.ok').textContent).toBe('판매 중');
    expect(root.querySelector('.pager [aria-current="page"]').textContent).toBe('1');
    expect(labels(root, '.pager a:not([aria-label])')).toEqual(['2', '3']);
    root.querySelector('.pager a[aria-label="다음 페이지"]').click();
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it('행이 없으면 빈 상태 화면을 보입니다', () => {
    const root = document.getElementById('root');
    renderDataTable(root, { columns, rows: [], total: 0, page: 1, pageSize: 20, onPage: () => {}, empty: '조건에 맞는 회차가 없습니다.' });
    expect(root.querySelector('table')).toBeNull();
    expect(root.querySelector('.empty-state').textContent).toContain('조건에 맞는 회차가 없습니다.');
  });
});
