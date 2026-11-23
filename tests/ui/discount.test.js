// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderDiscount } from '../../src/user/pages/discount.js';
import { fakeApi, NOW, iso } from './checkout-fixtures.js';

let el;
beforeEach(() => {
  sessionStorage.clear();
  document.body.innerHTML = '<main></main>';
  el = document.querySelector('main');
});
const run = async (api, go = vi.fn()) => {
  await renderDiscount(el, { api, go, holdId: 'h1', now: () => NOW });
  return go;
};
const pick = (i, v) => {
  const s = el.querySelectorAll('select')[i];
  s.value = v;
  s.dispatchEvent(new Event('change', { bubbles: true }));
};
const total = () => el.querySelector('.sum-total b').textContent;
const next = () => el.querySelector('.summary [data-next]');

describe('할인 선택', () => {
  it('티켓마다 좌석 이름과 선택 상자가 있고 처음 합계는 정가다', async () => {
    await run(fakeApi());
    expect(el.querySelectorAll('.ticket-row').length).toBe(3);
    expect(el.textContent).toContain('A열 1번');
    expect(total()).toBe('120,000원');
  });

  it('3매 중 장애인 1매, 장애인 동반 1매를 고르면 합계가 할인 반영 금액이 되고 증빙 안내가 보인다', async () => {
    await run(fakeApi());
    pick(0, 'DISABLED');
    pick(1, 'DISABLED_COMPANION');
    expect(total()).toBe('80,000원');
    expect(el.textContent).toContain('현장에서 증빙을 확인합니다. 증빙이 없으면 차액을 현장에서 결제합니다.');
    expect(el.querySelectorAll('.ticket-row')[0].querySelector('s').textContent).toBe('40,000원');
    expect(next().getAttribute('aria-disabled')).not.toBe('true');
  });

  it('동반만 고르면 다음이 비활성이고 오류 문구가 보인다', async () => {
    const go = await run(fakeApi());
    pick(0, 'DISABLED_COMPANION');
    expect(next().getAttribute('aria-disabled')).toBe('true');
    const alert = el.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('동반 할인은 본인 할인과 함께 선택해 주세요.');
    // 다른 줄을 바꿔도 같은 오류면 같은 알림을 두어 되풀이해 읽지 않는다
    pick(1, 'GENERAL');
    expect(el.querySelector('[role="alert"]')).toBe(alert);
    next().click();
    await new Promise((r) => setTimeout(r, 0));
    expect(go).not.toHaveBeenCalled();
  });

  it('다음을 누르면 선택을 보관하고 결제 단계로 간다', async () => {
    const go = await run(fakeApi());
    pick(0, 'MULTICHILD');
    next().click();
    await new Promise((r) => setTimeout(r, 0));
    expect(go).toHaveBeenCalledWith('#/booking/h1/pay');
    expect(JSON.parse(sessionStorage.getItem('hb:discounts:h1'))).toEqual(['MULTICHILD', 'GENERAL', 'GENERAL']);
  });

  it('정규 강좌에는 동반 할인 선택지가 없고 줄 이름은 순번이다', async () => {
    await run(fakeApi({
      getMyHold: vi.fn().mockResolvedValue({ id: 'h1', offering_id: 'o1', qty: 1, status: 'ACTIVE', expires_at: iso(10), seats: [] }),
      getOffering: vi.fn().mockResolvedValue({ id: 'o1', starts_at: iso(9999), prices: [{ grade: null, price: 90000 }], program: { id: 'p', type: 'COURSE', title: '강좌', venue: '교육실', poster_image: null } }),
    }));
    const values = [...el.querySelectorAll('select option')].map((o) => o.value);
    expect(values).not.toContain('DISABLED_COMPANION');
    expect(values).not.toContain('MERIT_COMPANION');
    expect(el.textContent).toContain('1번째 인원');
  });

  it('선점이 없거나 만료되었으면 좌석 다시 선택 안내를 보인다', async () => {
    await run(fakeApi({ getMyHold: vi.fn().mockResolvedValue(null) }));
    expect(el.textContent).toContain('선점 정보를 찾을 수 없습니다');
    await run(fakeApi({ getMyHold: vi.fn().mockResolvedValue({ id: 'h1', offering_id: 'o1', qty: 1, status: 'ACTIVE', expires_at: iso(-1), seats: [] }) }));
    expect(el.textContent).toContain('선점 시간이 지났습니다');
    expect(el.querySelector('a[href="#/booking/o1/select"]')).not.toBeNull();
  });

  it('결제를 마친 선점(CONSUMED)으로 뒤로 돌아오면 만료 대신 예매 완료와 내 예약 링크를 보인다', async () => {
    await run(fakeApi({ getMyHold: vi.fn().mockResolvedValue({ id: 'h1', offering_id: 'o1', qty: 1, status: 'CONSUMED', expires_at: iso(-1), seats: [] }) }));
    expect(el.querySelector('h1').textContent).toBe('이미 예매가 완료되었습니다.');
    expect(el.textContent).not.toContain('선점 시간이 지났습니다');
    expect(el.querySelector('a[href="#/me/bookings"]').textContent).toBe('내 예약 보기');
  });

  it('로그인하지 않았으면 로그인으로 보낸다', async () => {
    const go = await run(fakeApi({ getSession: vi.fn().mockResolvedValue(null) }));
    expect(go).toHaveBeenCalledWith(`#/login?next=${encodeURIComponent('#/booking/h1/discount')}`);
  });
});
