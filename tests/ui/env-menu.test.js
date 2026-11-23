// @vitest-environment jsdom
// 환경별 관리자 메뉴(VITE_ENV)와 검수용 시계 띠
import { beforeEach, describe, expect, it } from 'vitest';
import { AVAILABLE, envAllows, findMenu, renderLayout, visibleMenu } from '../../src/admin/layout.js';
import { clockOffsetText } from '../../src/lib/format.js';

const labels = (role, env) => visibleMenu(role, env, AVAILABLE).flatMap((g) => (g.children ?? [g]).map((c) => c.label));
const user = { name: '김운영', email: 'op@demo.test' };

describe('환경별 메뉴', () => {
  it('demo 빌드에는 검수용 시계가 없고 시연 데이터 초기화가 있습니다', () => {
    expect(labels('operator', 'demo')).not.toContain('검수용 시계');
    expect(labels('operator', 'demo')).toContain('시연 데이터 초기화');
  });
  it('qa 빌드에는 검수용 시계가 있고 시연 데이터 초기화가 없습니다', () => {
    expect(labels('operator', 'qa')).toContain('검수용 시계');
    expect(labels('operator', 'qa')).not.toContain('시연 데이터 초기화');
  });
  it('local 에는 둘 다 있고 작업 이력은 모든 환경, 모든 담당자에게 보입니다', () => {
    expect(labels('operator', 'local')).toEqual(expect.arrayContaining(['검수용 시계', '시연 데이터 초기화', '작업 이력']));
    for (const env of ['local', 'qa', 'demo']) {
      for (const role of ['operator', 'finance']) expect(labels(role, env)).toContain('작업 이력');
    }
  });
  it('정산 담당에게는 시스템 설정 메뉴가 보이지 않습니다', () => {
    expect(labels('finance', 'local')).not.toContain('검수용 시계');
    expect(labels('finance', 'local')).not.toContain('시연 데이터 초기화');
  });
  it('주소로 직접 들어가는 경우도 환경이 맞는지 확인합니다', () => {
    const clock = findMenu('#/system/clock').item;
    expect(envAllows(clock, 'demo')).toBe(false);
    expect(envAllows(clock, 'qa')).toBe(true);
    const reset = findMenu('#/system/reset').item;
    expect(envAllows(reset, 'qa')).toBe(false);
    expect(envAllows(reset, 'demo')).toBe(true);
    expect(envAllows(findMenu('#/audit').item, 'demo')).toBe(true);
  });
});

describe('검수용 시계 문구', () => {
  it('오프셋을 앞/뒤 문구로 바꿉니다', () => {
    expect(clockOffsetText(86400000)).toBe('1일 앞');
    expect(clockOffsetText(600000)).toBe('10분 앞');
    expect(clockOffsetText(86400000 + 3600000 + 600000)).toBe('1일 1시간 10분 앞');
    expect(clockOffsetText(-3600000)).toBe('1시간 뒤');
    expect(clockOffsetText(0)).toBe('');
    expect(clockOffsetText(30000)).toBe('');
  });
});

describe('검수용 시계 띠', () => {
  let root;
  beforeEach(() => {
    document.body.innerHTML = '<div id="r"></div>';
    root = document.getElementById('r');
  });
  const band = () => root.querySelector('.clock-band');

  it('시계가 켜져 오프셋이 있으면 상단 띠에 표시하고 0 이면 숨깁니다', () => {
    const layout = renderLayout(root, { user, role: 'operator', current: '#/', env: 'qa' });
    expect(band().hidden).toBe(true);
    layout.setClock({ enabled: true, offsetMs: 86400000 });
    expect(band().hidden).toBe(false);
    expect(band().textContent.trim()).toBe('검수용 시계 사용 중: 실제보다 1일 앞');
    expect(band().getAttribute('role')).toBe('status');
    layout.setClock({ enabled: true, offsetMs: 0 });
    expect(band().hidden).toBe(true);
    layout.setClock({ enabled: false, offsetMs: 86400000 });
    expect(band().hidden).toBe(true);
    layout.destroy();
  });
});
