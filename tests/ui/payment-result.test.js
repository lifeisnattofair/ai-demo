// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderPaymentSuccess, renderPaymentFail, resetConfirmGuard } from '../../src/user/pages/payment-result.js';
import { ApiError, messageFor } from '../../src/lib/api.js';

let el;
beforeEach(() => {
  resetConfirmGuard();
  document.body.innerHTML = '<main></main>';
  el = document.querySelector('main');
});

const query = (o = {}) => new URLSearchParams({ paymentKey: 'mock_abcdefghij0123456789', orderId: 'HB-20261123-AbCdEfGh12', amount: '40000', ...o });
const booking = { id: 'b1', booking_no: 'B2611230001', offering_id: 'o1', total_amount: 40000, status: 'CONFIRMED' };
const api = (over = {}) => ({
  messageFor,
  confirmPayment: vi.fn().mockResolvedValue({ status: 'CONFIRMED', booking }),
  getOffering: vi.fn().mockResolvedValue({ id: 'o1', starts_at: '2026-12-12T10:30:00Z', program: { id: 'p1', type: 'PERFORMANCE', title: '실내악', venue: '소극장' } }),
  myBookingItems: vi.fn().mockResolvedValue([{ row_label: 'B', seat_no: 4, grade: 'R', discount_type: 'GENERAL', amount: 40000 }]),
  ...over,
});
const run = async (a, q = query(), go = vi.fn()) => {
  await renderPaymentSuccess(el, { api: a, go, query: q });
  return go;
};

describe('결제 성공 페이지', () => {
  it('쿼리 값으로 승인을 한 번 요청하고 예약 완료 내용을 보인다', async () => {
    const a = api();
    await run(a);
    expect(a.confirmPayment).toHaveBeenCalledTimes(1);
    expect(a.confirmPayment).toHaveBeenCalledWith('mock_abcdefghij0123456789', 'HB-20261123-AbCdEfGh12', 40000);
    expect(el.textContent).toContain('B2611230001');
    expect(el.textContent).toContain('실내악');
    expect(el.textContent).toContain('B열 4번');
    expect(el.textContent).toContain('40,000원');
    expect(el.querySelector('a[href="#/me/bookings"]')).not.toBeNull();
  });

  it('같은 주문으로 다시 그려도 승인을 다시 요청하지 않는다', async () => {
    const a = api();
    await Promise.all([run(a), run(a)]);
    await run(a);
    expect(a.confirmPayment).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain('B2611230001');
  });

  it('결과가 취소이면 사유와 좌석 다시 선택 버튼을 보인다', async () => {
    const a = api({
      confirmPayment: vi.fn().mockResolvedValue({ status: 'CANCELLED', reason: 'HOLD_EXPIRED', message: '좌석 선점 시간이 지나 결제가 진행되지 않았습니다. 좌석을 다시 선택해 주세요.' }),
    });
    sessionStorage.setItem('hb:order:HB-20261123-AbCdEfGh12', 'o1');
    const go = await run(a);
    expect(el.textContent).toContain('좌석 선점 시간이 지나 결제가 진행되지 않았습니다.');
    const btn = [...el.querySelectorAll('button, a')].find((b) => b.textContent === '좌석 다시 선택');
    expect(btn).toBeTruthy();
    btn.click();
    expect(go).toHaveBeenCalledWith('#/booking/o1/select');
  });

  it('서버 오류는 코드별 안내와 내 예약 링크를 보인다', async () => {
    const a = api({ confirmPayment: vi.fn().mockRejectedValue(new ApiError('PAYMENT_IN_PROGRESS')) });
    await run(a);
    expect(el.textContent).toContain(messageFor('PAYMENT_IN_PROGRESS'));
    expect(el.querySelector('a[href="#/me/bookings"]')).not.toBeNull();
  });

  it('알 수 없는 서버 오류는 원문 대신 정해 둔 안내와 결과 다시 확인 버튼을 보인다', async () => {
    const err = new ApiError('BOOT_ERROR', messageFor('BOOT_ERROR'));
    const confirmPayment = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce({ status: 'CONFIRMED', booking });
    const a = api({ confirmPayment });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(a);
    expect(el.textContent).toContain('결제 결과를 아직 확인하지 못했습니다. 잠시 후 내 예약에서 다시 확인해 주세요.');
    expect(el.textContent).not.toMatch(/Worker|boot/i);
    const again = [...el.querySelectorAll('button')].find((b) => b.textContent === '결과 다시 확인');
    expect(again).toBeTruthy();
    again.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(confirmPayment).toHaveBeenCalledTimes(2);
    expect(el.textContent).toContain('B2611230001');
    spy.mockRestore();
  });

  it('완료 화면의 둘러보기 버튼은 다음 행동을 말한다', async () => {
    await run(api());
    expect(el.textContent).not.toContain('프로그램 둘러보기');
  });

  it('쿼리가 모자라면 승인을 요청하지 않고 안내한다', async () => {
    const a = api();
    await run(a, new URLSearchParams({ orderId: 'x' }));
    expect(a.confirmPayment).not.toHaveBeenCalled();
    expect(el.textContent).toContain('결제 정보를 확인할 수 없습니다');
  });
});

describe('결제 실패 페이지', () => {
  it('선점이 유지됨을 안내하고 할인 단계로 돌아가는 링크를 둔다', () => {
    renderPaymentFail(el, { query: new URLSearchParams({ holdId: 'h1', code: 'USER_CANCEL' }) });
    expect(el.textContent).toContain('선점은 남은 시간 동안 유지됩니다');
    expect(el.querySelector('a[href="#/booking/h1/discount"]')).not.toBeNull();
  });
});
