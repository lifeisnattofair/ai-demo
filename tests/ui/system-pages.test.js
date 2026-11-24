// @vitest-environment jsdom
// 관리자 시스템 화면: 검수용 시계, 시연 데이터 초기화, 작업 이력
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSystemClock } from '../../src/admin/pages/system-clock.js';
import { renderSystemReset } from '../../src/admin/pages/system-reset.js';
import { actionLabel, renderAudit } from '../../src/admin/pages/audit.js';
import { ApiError } from '../../src/lib/api.js';

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await flush(); };
const dialogButton = (label) => [...document.querySelectorAll('.dialog button')].find((b) => b.textContent === label);
const NOW = new Date('2026-12-07T01:00:00Z');

let el;
beforeEach(() => {
  document.body.innerHTML = '<main></main>';
  el = document.querySelector('main');
});

describe('검수용 시계 화면', () => {
  const mk = (offsetMs = 0) => {
    const state = { env: 'qa', enabled: offsetMs !== 0, offsetMs, now: new Date(NOW.getTime() + offsetMs).toISOString() };
    return {
      state,
      api: {
        clock: vi.fn(async () => ({ ...state })),
        setClock: vi.fn(async (ms) => { state.offsetMs = ms; state.enabled = true; state.now = new Date(NOW.getTime() + ms).toISOString(); return { ...state }; }),
      },
    };
  };
  const btn = (label) => [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === label);

  it('현재 기준 시각과 네 개 버튼을 보입니다', async () => {
    const { api } = mk();
    await renderSystemClock(el, { api });
    expect(el.querySelector('h1').textContent).toBe('검수용 시계');
    expect(el.querySelector('.clock-now').textContent).toContain('2026.12.07(월) 10:00');
    for (const l of ['+10분', '+1일', '+7일', '초기화']) expect(btn(l), l).toBeTruthy();
    // +1일과 같은 값을 더하던 +24시간 버튼은 두지 않습니다(QA D-04)
    expect(btn('+24시간')).toBeFalsy();
  });

  it('+10분과 +1일을 누르면 지금 오프셋에 더해 저장하고 띠를 갱신합니다', async () => {
    const { api } = mk();
    const onClock = vi.fn();
    await renderSystemClock(el, { api, onClock });
    btn('+10분').click();
    await settle();
    expect(api.setClock).toHaveBeenLastCalledWith(600000);
    btn('+1일').click();
    await settle();
    expect(api.setClock).toHaveBeenLastCalledWith(600000 + 86400000);
    expect(onClock).toHaveBeenLastCalledWith(expect.objectContaining({ offsetMs: 600000 + 86400000 }));
    expect(el.querySelector('.clock-state').textContent).toContain('실제보다 1일 10분 앞');
    expect(el.querySelector('[role="status"].form-alert')).toBeTruthy();
  });

  it('+7일은 환불 구간을 넘기는 7일을 더하고 초기화는 0 으로 되돌립니다', async () => {
    const { api } = mk(86400000);
    await renderSystemClock(el, { api });
    btn('+7일').click();
    await settle();
    expect(api.setClock).toHaveBeenLastCalledWith(8 * 86400000);
    btn('초기화').click();
    await settle();
    expect(api.setClock).toHaveBeenLastCalledWith(0);
    expect(el.querySelector('.clock-state').textContent).toContain('실제 시각과 같습니다');
  });

  it('저장에 실패하면 안내를 보이고 값은 그대로입니다', async () => {
    const { api } = mk();
    api.setClock.mockRejectedValueOnce(new ApiError('NOT_ALLOWED_IN_ENV', '이 환경에서는 쓸 수 없는 기능입니다. 환경을 확인해 주세요.'));
    await renderSystemClock(el, { api });
    btn('+1일').click();
    await settle();
    expect(el.querySelector('[role="alert"]').textContent).toContain('이 환경에서는 쓸 수 없는');
    expect(btn('+1일').disabled).toBe(false);
  });
});

describe('시연 데이터 초기화 화면', () => {
  it('확인 대화상자의 문구를 보이고, 닫으면 아무것도 지우지 않습니다', async () => {
    const api = { resetDemo: vi.fn(async () => ({})) };
    renderSystemReset(el, { api });
    expect(el.querySelector('h1').textContent).toBe('시연 데이터 초기화');
    el.querySelector('[data-act="reset"]').click();
    await settle();
    const dlg = document.querySelector('[role="dialog"]');
    expect(dlg.textContent).toContain('모든 예약, 대기, 알림이 지워지고 처음 상태로 돌아갑니다.');
    expect(dlg.getAttribute('aria-labelledby')).toBeTruthy();
    dialogButton('닫기').click();
    await settle();
    expect(api.resetDemo).not.toHaveBeenCalled();
  });

  it('확인하면 초기화하고 완료 안내를 보입니다', async () => {
    const api = { resetDemo: vi.fn(async () => ({})) };
    renderSystemReset(el, { api });
    el.querySelector('[data-act="reset"]').click();
    await settle();
    dialogButton('초기화').click();
    await settle();
    expect(api.resetDemo).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[role="status"]').textContent).toContain('시연 데이터를 처음 상태로 되돌렸습니다.');
    expect(el.querySelector('[data-act="reset"]').getAttribute('aria-busy')).toBeNull();
  });

  it('실패하면 원인과 다음 행동을 보입니다', async () => {
    const api = { resetDemo: vi.fn(async () => { throw new ApiError('NOT_ALLOWED_IN_ENV', '이 환경에서는 쓸 수 없는 기능입니다. 환경을 확인해 주세요.'); }) };
    renderSystemReset(el, { api });
    el.querySelector('[data-act="reset"]').click();
    await settle();
    dialogButton('초기화').click();
    await settle();
    expect(el.querySelector('[role="alert"]').textContent).toContain('환경을 확인해 주세요');
  });
});

describe('작업 이력 화면', () => {
  const rows = [
    { id: 'a1', at: '2026-12-07T00:30:00Z', actor_id: 'u1', actor_name_masked: '김*영', actor_role: 'operator', action: 'CLOCK_SET', target_type: 'app_settings', target_id: 'clock_offset_ms', detail: { from: 0, to: 600000 } },
    { id: 'a2', at: '2026-12-06T00:30:00Z', actor_id: 'u2', actor_name_masked: '박*산', actor_role: 'finance', action: 'VIEW_PAYMENT_RAW', target_type: 'payment', target_id: '1234567890abcdef', detail: { note: '<img src=x onerror=alert(1)>' } },
  ];

  it('작업 일시, 작업자(가림), 작업 종류, 대상을 표로 보입니다', async () => {
    const api = { audit: vi.fn(async () => rows) };
    await renderAudit(el, { api, now: () => NOW });
    await settle();
    expect(el.querySelector('h1').textContent).toBe('작업 이력');
    const text = el.querySelector('table').textContent;
    expect(text).toContain('2026.12.07(월) 09:30');
    expect(text).toContain('김*영');
    expect(text).toContain('운영 담당');
    expect(text).toContain('검수용 시계 변경');
    expect(text).toContain('결제 원본 열람');
    expect(actionLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('상세 JSON 은 들여쓰기해서 글자 그대로 보입니다(태그로 해석하지 않음)', async () => {
    const api = { audit: vi.fn(async () => rows) };
    await renderAudit(el, { api, now: () => NOW });
    await settle();
    const pres = [...el.querySelectorAll('table pre')];
    expect(pres[0].textContent).toBe(JSON.stringify(rows[0].detail, null, 2));
    expect(pres[1].textContent).toContain('<img src=x onerror=alert(1)>');
    expect(el.querySelector('table img')).toBeNull();
  });

  it('작업 종류, 작업자, 기간으로 다시 조회합니다', async () => {
    const api = { audit: vi.fn(async () => rows) };
    await renderAudit(el, { api, now: () => NOW });
    await settle();
    const form = el.querySelector('form');
    form.elements.kind.value = 'CLOCK_SET';
    form.elements.actor.value = 'u1';
    form.elements.periodFrom.value = '2026-12-01';
    form.elements.periodTo.value = '2026-12-07';
    form.requestSubmit();
    await settle();
    expect(api.audit).toHaveBeenLastCalledWith({
      from: '2026-11-30T15:00:00.000Z', to: '2026-12-07T15:00:00.000Z', actor: 'u1', action: 'CLOCK_SET',
    });
  });

  it('기간 입력은 조회 상자 한 줄 전체를 씁니다(예약 내역과 같은 배치)', async () => {
    await renderAudit(el, { api: { audit: vi.fn(async () => rows) }, now: () => NOW });
    await settle();
    const cell = el.querySelector('[data-range-for="period"]');
    expect(cell.classList.contains('wide')).toBe(true);
    expect(cell.previousElementSibling.classList.contains('start')).toBe(true);
  });

  it('이력이 없으면 빈 상태를 보입니다', async () => {
    const api = { audit: vi.fn(async () => []) };
    await renderAudit(el, { api, now: () => NOW });
    await settle();
    expect(el.querySelector('.empty-state')).toBeTruthy();
  });
});
