// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderPayment } from '../../src/user/pages/payment.js';
import { fakeApi, NOW, iso } from './checkout-fixtures.js';
import { ApiError } from '../../src/lib/api.js';

const oneSeat = () => fakeApi({
  getMyHold: vi.fn().mockResolvedValue({ id: 'h1', offering_id: 'o1', qty: 1, status: 'ACTIVE', expires_at: iso(10), seats: [{ seat_id: 7, row_label: 'B', seat_no: 4, grade: 'R' }] }),
  preparePayment: vi.fn().mockResolvedValue({ id: 'h1' }),
});

let el;
beforeEach(() => {
  sessionStorage.clear();
  document.body.innerHTML = '<main></main>';
  el = document.querySelector('main');
});
const run = async (api, go = vi.fn()) => {
  await renderPayment(el, { api, go, holdId: 'h1', now: () => NOW });
  return go;
};
const payBtn = () => el.querySelector('.summary [data-pay]');
const flush = () => new Promise((r) => setTimeout(r, 0));
const chooseMethod = (i) => { const r = el.querySelectorAll('input[name="pm"]')[i]; r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); };
const agreeAll = () => { const c = el.querySelector('.check.all input'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); };

describe('결제 단계', () => {
  it('결제 수단 세 가지와 약관이 보이고 처음에는 결제하기가 비활성이다', async () => {
    await run(oneSeat());
    const names = [...el.querySelectorAll('.method b')].map((b) => b.textContent);
    expect(names).toEqual(['신용/체크카드', '계좌이체', '간편결제']);
    expect(payBtn().textContent).toBe('40,000원 결제하기');
    expect(payBtn().getAttribute('aria-disabled')).toBe('true');
  });

  it('수단을 고르고 약관에 동의해야 활성화된다', async () => {
    await run(oneSeat());
    chooseMethod(1);
    expect(payBtn().getAttribute('aria-disabled')).toBe('true');
    agreeAll();
    expect(payBtn().getAttribute('aria-disabled')).not.toBe('true');
    const first = el.querySelectorAll('.agree .check:not(.all) input')[0];
    first.checked = false;
    first.dispatchEvent(new Event('change', { bubbles: true }));
    expect(payBtn().getAttribute('aria-disabled')).toBe('true');
  });

  it('결제하기를 누르면 준비를 한 번 부르고 성공 주소로 이동한다', async () => {
    const api = oneSeat();
    const go = await run(api);
    chooseMethod(0);
    agreeAll();
    payBtn().click();
    payBtn().click();
    await flush();
    expect(api.preparePayment).toHaveBeenCalledTimes(1);
    const [hold, items, amount, orderId] = api.preparePayment.mock.calls[0];
    expect(hold).toBe('h1');
    expect(items).toEqual([{ seatId: 7, discountType: 'GENERAL' }]);
    expect(amount).toBe(40000);
    expect(orderId).toMatch(/^HB-\d{8}-[A-Za-z0-9]{10}$/);
    expect(go).toHaveBeenCalledTimes(1);
    const target = go.mock.calls[0][0];
    expect(target).toMatch(/^#\/payment\/success\?/);
    const q = new URLSearchParams(target.split('?')[1]);
    expect(q.get('paymentKey')).toMatch(/^mock_[A-Za-z0-9]{20}$/);
    expect(q.get('orderId')).toBe(orderId);
    expect(q.get('amount')).toBe('40000');
  });

  it('보관한 할인을 반영한 금액으로 결제한다', async () => {
    sessionStorage.setItem('hb:discounts:h1', JSON.stringify(['DISABLED']));
    const api = oneSeat();
    await run(api);
    expect(payBtn().textContent).toBe('20,000원 결제하기');
    chooseMethod(0);
    agreeAll();
    payBtn().click();
    await flush();
    expect(api.preparePayment.mock.calls[0][1]).toEqual([{ seatId: 7, discountType: 'DISABLED' }]);
    expect(api.preparePayment.mock.calls[0][2]).toBe(20000);
  });

  it('준비가 실패하면 선점이 유지됨을 안내하고 할인 단계로 돌아가는 링크를 보인다', async () => {
    const api = oneSeat();
    api.preparePayment.mockRejectedValue(new ApiError('AMOUNT_MISMATCH', '금액이 달라 결제를 시작하지 못했습니다. 다시 시도해 주세요.'));
    const go = await run(api);
    chooseMethod(0);
    agreeAll();
    payBtn().click();
    await flush();
    expect(go).not.toHaveBeenCalled();
    expect(el.querySelector('[role="alert"]').textContent).toContain('금액이 달라');
    expect(el.textContent).toContain('선점은 남은 시간 동안 유지됩니다');
    expect(el.querySelector('a[href="#/booking/h1/discount"]')).not.toBeNull();
    expect(payBtn().getAttribute('aria-disabled')).not.toBe('true');
  });

  it('결제대행사 로고나 상표 문구를 쓰지 않는다', async () => {
    await run(oneSeat());
    expect(el.querySelector('.methods img, .methods svg image')).toBeNull();
    expect(el.textContent).not.toMatch(/토스|카카오|네이버|페이코|삼성|국민|신한|현대/);
  });

  it('보관한 할인이 규칙에 어긋나면 할인 단계로 보낸다', async () => {
    sessionStorage.setItem('hb:discounts:h1', JSON.stringify(['DISABLED_COMPANION']));
    const go = await run(oneSeat());
    expect(go).toHaveBeenCalledWith('#/booking/h1/discount');
  });
});

describe('취소 수수료 일정 문구', () => {
  it('유형에 맞는 당일 문구를 쓰고, 기간은 점 형식 범위로 보인다', async () => {
    const { cancelSchedule } = await import('../../src/user/components/checkout-shell.js');
    const course = cancelSchedule('2026-12-20T10:00:00Z', 'COURSE');
    expect(course[3]).toEqual(['취소 불가', '개강 당일(첫 수업 전)']);
    expect(course[1][1]).toBe('2026.12.13(일) - 12.16(수)');
    expect(cancelSchedule('2026-12-20T10:00:00Z', 'EXPERIENCE')[3][1]).toBe('체험 당일');
    expect(cancelSchedule('2026-12-20T10:00:00Z')[3][1]).toBe('공연 당일');
  });
});
