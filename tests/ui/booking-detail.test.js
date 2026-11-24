// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderBookingDetail } from '../../src/user/pages/booking-detail.js';
import { renderMyBookings } from '../../src/user/pages/my-bookings.js';
import { renderWaitlist } from '../../src/user/pages/waitlist.js';
import { renderNotifications } from '../../src/user/pages/notifications.js';
import { messageFor, ApiError } from '../../src/lib/api.js';

const NOW = new Date('2026-11-23T03:00:00Z'); // 12:00 KST
const DAY = 86400000;
const at = (days, hours = 0) => new Date(NOW.getTime() + days * DAY + hours * 3600000).toISOString();
const now = () => NOW;

let el;
beforeEach(() => {
  document.body.innerHTML = '<main tabindex="-1"></main>';
  el = document.querySelector('main');
});

function booking(over = {}) {
  return {
    id: 'b1', booking_no: 'B2611230001', status: 'CONFIRMED', total_amount: 40000, created_at: at(-1), cancelled_at: null,
    offering: { id: 'o1', starts_at: at(5), ends_at: at(5, 2), status: 'OPEN' },
    program: { id: 'p1', type: 'PERFORMANCE', title: '겨울 실내악', venue: '소극장', poster_image: 'quartet', poster_tone: 'dark' },
    lesson_starts: null,
    items: [{ row_label: 'E', seat_no: 9, grade: 'S', discount_type: 'GENERAL', amount: 40000 }],
    payment: { approved_at: at(-1), amount: 40000, status: 'DONE' },
    refund: null,
    ...over,
  };
}

const course = (over = {}) => booking({
  id: 'b2', booking_no: 'B2611230002', total_amount: 120000,
  offering: { id: 'o2', starts_at: at(-30), ends_at: at(60), status: 'OPEN' },
  program: { id: 'p2', type: 'COURSE', title: '시민 합창 교실', venue: '연습실', poster_image: 'choir', poster_tone: 'dark' },
  lesson_starts: Array.from({ length: 12 }, (_, i) => at(-30 + i * 7)),
  items: [{ row_label: null, seat_no: null, grade: null, discount_type: 'GENERAL', amount: 120000 }],
  payment: { approved_at: at(-40), amount: 120000, status: 'DONE' },
  ...over,
});

function api(over = {}) {
  return {
    messageFor,
    getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }),
    myBooking: vi.fn().mockResolvedValue(booking()),
    myBookings: vi.fn().mockResolvedValue([booking()]),
    myWaitlist: vi.fn().mockResolvedValue([]),
    myCounts: vi.fn().mockResolvedValue({ upcoming: 1, waitlist: 0, unread: 0 }),
    cancelBooking: vi.fn().mockResolvedValue({ status: 'CANCELLED', refundAmount: 36000, feeAmount: 4000, rule: 'D7_4' }),
    cancelWaitlist: vi.fn().mockResolvedValue(undefined),
    holdForPromotion: vi.fn().mockResolvedValue({ id: 'h9' }),
    myNotifications: vi.fn().mockResolvedValue([]),
    markNotificationRead: vi.fn().mockResolvedValue(undefined),
    markAllNotificationsRead: vi.fn().mockResolvedValue(0),
    ...over,
  };
}

const button = (label) => [...el.ownerDocument.querySelectorAll('button, a.btn')].find((b) => b.textContent.trim() === label);
const detail = async (a, over = {}) => {
  const go = vi.fn();
  await renderBookingDetail(el, { api: a, go, id: 'b1', now, ...over });
  return go;
};

describe('예약 상세와 취소 환불 미리보기', () => {
  it('D-5 이면 환불액과 수수료를 안내하고 확인하면 취소를 한 번 요청한다', async () => {
    const a = api();
    await detail(a);
    expect(el.textContent).toContain('지금 취소하면 36,000원이 환불됩니다(취소 수수료 4,000원).');
    expect(el.textContent).toContain('B2611230001');
    button('예약 취소').click();
    const dlg = document.querySelector('[role="dialog"]');
    expect(dlg).not.toBeNull();
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dlg.getAttribute('aria-labelledby')).textContent).toContain('예약을 취소');
    expect(a.cancelBooking).not.toHaveBeenCalled();
    [...dlg.querySelectorAll('button')].find((b) => b.textContent === '예약 취소하기').click();
    await vi.waitFor(() => expect(a.cancelBooking).toHaveBeenCalledTimes(1));
    expect(a.cancelBooking).toHaveBeenCalledWith('b1');
    await vi.waitFor(() => expect(el.textContent).toContain('예약이 취소되었습니다'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // 다시 그린 뒤 초점은 결과 안내로 가고, 초점으로 읽히므로 알림 역할은 붙이지 않는다
    await vi.waitFor(() => expect(document.activeElement?.classList.contains('my-notice')).toBe(true));
    expect(document.activeElement.textContent).toContain('예약이 취소되었습니다');
    expect(document.activeElement.hasAttribute('role')).toBe(false);
  });

  it('취소를 누르면 서버 시각을 다시 맞추고 바뀐 구간의 금액으로 확인한다(QA D-01)', async () => {
    // 화면을 열 때는 D-9(수수료 없음), 취소를 누르는 사이에 D-5 구간으로 넘어간 경우
    let t = new Date(NOW.getTime() - 4 * DAY);
    const sync = vi.fn(async () => { t = NOW; });
    const a = api();
    await detail(a, { now: () => t, sync });
    expect(el.textContent).toContain('40,000원이 환불됩니다(취소 수수료 없음)');
    button('예약 취소').click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    expect(sync).toHaveBeenCalledTimes(1);
    const dlg = document.querySelector('[role="dialog"]');
    expect(dlg.textContent).toContain('36,000원이 환불됩니다(취소 수수료 4,000원)');
    expect(el.textContent).toContain('지금 취소하면 36,000원이 환불됩니다(취소 수수료 4,000원).');
    expect(el.textContent).not.toContain('40,000원이 환불됩니다');
  });

  it('확인 대화상자를 닫으면 취소를 요청하지 않는다(Esc)', async () => {
    const a = api();
    await detail(a);
    button('예약 취소').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(a.cancelBooking).not.toHaveBeenCalled();
  });

  it('Esc 나 닫기로 닫으면 초점이 「예약 취소」 버튼으로 돌아간다(QA D-15)', async () => {
    // 서버 시각을 맞추는 사이 초점이 다른 곳(main)으로 옮겨진 경우도 버튼으로 돌아와야 합니다.
    const sync = vi.fn(async () => { el.focus(); });
    await detail(api(), { sync });
    const btn = button('예약 취소');
    btn.focus();
    btn.click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(btn);
    await new Promise((r) => setTimeout(r, 0));
    btn.click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    button('닫기').click();
    expect(document.activeElement).toBe(btn);
  });

  it('금액이 바뀌어 환불 안내를 다시 그렸으면 새 「예약 취소」 버튼으로 초점을 돌려준다(QA D-15)', async () => {
    let t = new Date(NOW.getTime() - 4 * DAY);
    const sync = vi.fn(async () => { t = NOW; });
    await detail(api(), { now: () => t, sync });
    const old = button('예약 취소');
    old.focus();
    old.click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const fresh = button('예약 취소');
    expect(fresh).not.toBe(old);
    expect(old.isConnected).toBe(false);
    expect(document.activeElement).toBe(fresh);
  });

  it('시각을 맞추는 사이 두 번 눌러도 확인 대화상자는 하나만 열리고 취소는 한 번만 요청한다(리뷰 I-3)', async () => {
    let done;
    const sync = vi.fn(() => new Promise((r) => { done = r; }));
    const a = api();
    await detail(a, { sync });
    const btn = button('예약 취소');
    btn.click();
    btn.click();
    done();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(sync).toHaveBeenCalledTimes(1);
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === '예약 취소하기').click();
    await vi.waitFor(() => expect(a.cancelBooking).toHaveBeenCalledTimes(1));
    btn.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(a.cancelBooking).toHaveBeenCalledTimes(1);
  });

  it('다시 그린 환불 안내가 취소 불가로 바뀌면 초점을 안내로 옮긴다(리뷰 M-1)', async () => {
    // 화면을 열 때는 D-5, 누르는 사이 공연 당일이 된 경우
    let t = NOW;
    const sync = vi.fn(async () => { t = new Date(NOW.getTime() + 5 * DAY); });
    await detail(api(), { now: () => t, sync });
    const btn = button('예약 취소');
    btn.focus();
    btn.click();
    await vi.waitFor(() => expect(document.activeElement?.classList.contains('my-notice')).toBe(true));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('대화상자는 Tab 이동이 안에서만 돈다', async () => {
    await detail(api());
    button('예약 취소').click();
    const dlg = document.querySelector('[role="dialog"]');
    const btns = [...dlg.querySelectorAll('button')];
    btns[btns.length - 1].focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(dlg.contains(document.activeElement)).toBe(true);
    btns[0].focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(btns[btns.length - 1]);
  });

  it('당일에는 취소 버튼을 막고 사유를 보인다', async () => {
    const a = api({ myBooking: vi.fn().mockResolvedValue(booking({ offering: { id: 'o1', starts_at: at(0, 6), ends_at: at(0, 8), status: 'OPEN' } })) });
    await detail(a);
    expect(el.textContent).toContain('관람(개강) 당일에는 취소할 수 없습니다.');
    const b = button('예약 취소');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    b.click();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(a.cancelBooking).not.toHaveBeenCalled();
  });

  it('정규 강좌 1/2 경과 후에는 환불 금액 없음 경고를 보이되 취소는 할 수 있다', async () => {
    const lessons = Array.from({ length: 12 }, (_, i) => at(-42 + i * 7)); // 7회 지남
    const a = api({ myBooking: vi.fn().mockResolvedValue(course({ lesson_starts: lessons })) });
    await detail(a, { id: 'b2' });
    expect(el.textContent).toContain('지금 취소하면 환불 금액이 없습니다.');
    expect(button('예약 취소').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('서버가 거절하면 사유를 알림으로 보이고 예약은 유지한다', async () => {
    const a = api({ cancelBooking: vi.fn().mockResolvedValue({ status: 'REJECTED', message: '관람(개강) 당일에는 취소할 수 없습니다.' }) });
    await detail(a);
    button('예약 취소').click();
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === '예약 취소하기').click();
    await vi.waitFor(() => expect(el.querySelector('[role="alert"]')?.textContent).toContain('당일에는 취소할 수 없습니다'));
    expect(button('예약 취소')).toBeDefined();
  });

  it('취소 요청이 실패하면 안내 문구를 보인다', async () => {
    const a = api({ cancelBooking: vi.fn().mockRejectedValue(new ApiError('UNKNOWN')) });
    await detail(a);
    button('예약 취소').click();
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === '예약 취소하기').click();
    await vi.waitFor(() => expect(el.querySelector('[role="alert"]')?.textContent).toContain('요청을 처리하지 못했습니다'));
  });

  it('취소된 예약은 환불 내역을 보이고 취소 버튼이 없다', async () => {
    const a = api({ myBooking: vi.fn().mockResolvedValue(booking({ status: 'CANCELLED', cancelled_at: at(0), refund: { refund_amount: 36000, fee_amount: 4000, rule: 'D7_4' } })) });
    await detail(a);
    expect(button('예약 취소')).toBeUndefined();
    expect(el.textContent).toContain('환불 36,000원');
    expect(el.textContent).toContain('예약 취소');
  });

  it('없는 예약이면 안내와 목록 링크를 보인다', async () => {
    await detail(api({ myBooking: vi.fn().mockResolvedValue(null) }));
    expect(el.textContent).toContain('예약을 찾을 수 없습니다');
    expect(el.querySelector('a[href="#/me/bookings"]')).not.toBeNull();
  });

  it('로그인하지 않았으면 로그인으로 보낸다', async () => {
    const go = await detail(api({ getSession: vi.fn().mockResolvedValue(null) }));
    expect(go).toHaveBeenCalledWith(expect.stringContaining('#/login?next='));
  });
});

describe('내 예약 목록', () => {
  it('예정, 지난 예약, 취소 탭으로 나눈다', async () => {
    const list = [
      booking({ id: 'a', booking_no: 'N-UPCOMING' }),
      booking({ id: 'b', booking_no: 'N-PAST', offering: { id: 'o', starts_at: at(-3), ends_at: at(-3, 2), status: 'OPEN' } }),
      booking({ id: 'c', booking_no: 'N-CANCELLED', status: 'CANCELLED', refund: { refund_amount: 1, fee_amount: 0, rule: 'D8_PLUS' } }),
    ];
    const a = api({ myBookings: vi.fn().mockResolvedValue(list) });
    await renderMyBookings(el, { api: a, go: vi.fn(), query: new URLSearchParams(), now });
    const tabs = [...el.querySelectorAll('.sub-tabs a')].map((t) => t.textContent.replace(/\s+/g, ' ').trim());
    expect(tabs).toEqual(['예정 1', '지난 예약 1', '취소 1']);
    expect(el.textContent).toContain('N-UPCOMING');
    expect(el.textContent).not.toContain('N-PAST');
    await renderMyBookings(el, { api: a, go: vi.fn(), query: new URLSearchParams('tab=past'), now });
    expect(el.textContent).toContain('N-PAST');
    await renderMyBookings(el, { api: a, go: vi.fn(), query: new URLSearchParams('tab=cancelled'), now });
    expect(el.textContent).toContain('N-CANCELLED');
  });

  it('비어 있으면 빈 상태 화면과 프로그램 링크를 보인다', async () => {
    await renderMyBookings(el, { api: api({ myBookings: vi.fn().mockResolvedValue([]) }), go: vi.fn(), query: new URLSearchParams(), now });
    expect(el.querySelector('.empty-state')).not.toBeNull();
    expect(el.querySelector('.empty-state a[href="#/programs"]')).not.toBeNull();
  });

  it('승격된 대기가 있으면 결제 안내 카드를 위에 보인다', async () => {
    const w = [{ id: 'w1', qty: 2, allocated_qty: 2, status: 'PROMOTED', deadline_at: at(1), position: 1, offering: { id: 'o3', starts_at: at(10) }, program: { id: 'p3', type: 'PERFORMANCE', title: '우리들의 무대' } }];
    const a = api({ myWaitlist: vi.fn().mockResolvedValue(w) });
    await renderMyBookings(el, { api: a, go: vi.fn(), query: new URLSearchParams(), now });
    expect(el.querySelector('.wait-card').textContent).toContain('우리들의 무대');
    expect(button('결제하기')).toBeDefined();
  });
});

describe('대기 목록', () => {
  const promoted = { id: 'w1', qty: 3, allocated_qty: 2, status: 'PROMOTED', deadline_at: '2026-12-03T05:00:00Z', position: 1, offering: { id: 'o3', starts_at: '2026-12-19T06:00:00Z' }, program: { id: 'p3', type: 'PERFORMANCE', title: '우리들의 무대' } };
  const waiting = { id: 'w2', qty: 2, allocated_qty: 0, status: 'WAITING', deadline_at: null, position: 4, offering: { id: 'o4', starts_at: '2026-12-20T06:00:00Z' }, program: { id: 'p4', type: 'EXPERIENCE', title: '도자기 체험' } };

  it('순번, 신청 수량, 배정 수량을 보이고 승격 건은 결제 기한을 보인다', async () => {
    const a = api({ myWaitlist: vi.fn().mockResolvedValue([promoted, waiting]) });
    await renderWaitlist(el, { api: a, go: vi.fn(), now });
    const text = el.textContent.replace(/\s+/g, ' ');
    expect(text).toContain('결제 기한: 12.03(목) 14:00까지');
    expect(text).toMatch(/순번\s*1번째/);
    expect(text).toMatch(/신청 수량\s*3매/);
    expect(text).toMatch(/배정 수량\s*2매/);
    expect(text).toMatch(/순번\s*4번째/);
    expect(text).toMatch(/신청 수량\s*2명/);
  });

  it('결제하기는 선점을 만들고 할인 단계로 이동한다', async () => {
    const a = api({ myWaitlist: vi.fn().mockResolvedValue([promoted]) });
    const go = vi.fn();
    await renderWaitlist(el, { api: a, go, now });
    button('결제하기').click();
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith('#/booking/h9/discount'));
    expect(a.holdForPromotion).toHaveBeenCalledWith('w1');
  });

  it('결제하기가 실패하면 안내를 보인다', async () => {
    const a = api({ myWaitlist: vi.fn().mockResolvedValue([promoted]), holdForPromotion: vi.fn().mockRejectedValue(new ApiError('NOT_PROMOTED')) });
    await renderWaitlist(el, { api: a, go: vi.fn(), now });
    button('결제하기').click();
    await vi.waitFor(() => expect(el.querySelector('[role="alert"]')?.textContent).toContain('대기 순번이 아직 오지 않았습니다'));
  });

  it('대기 취소는 확인 뒤에 요청하고 목록을 다시 불러온다', async () => {
    const my = vi.fn().mockResolvedValueOnce([waiting]).mockResolvedValue([]);
    const a = api({ myWaitlist: my });
    await renderWaitlist(el, { api: a, go: vi.fn(), now });
    button('대기 취소').click();
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === '대기 취소하기').click();
    await vi.waitFor(() => expect(a.cancelWaitlist).toHaveBeenCalledWith('w2'));
    await vi.waitFor(() => expect(el.querySelector('.empty-state')).not.toBeNull());
  });

  it('비어 있으면 빈 상태 화면을 보인다', async () => {
    await renderWaitlist(el, { api: api(), go: vi.fn(), now });
    expect(el.querySelector('.empty-state')).not.toBeNull();
  });
});

describe('알림함', () => {
  const list = [
    { id: 'n1', kind: 'PROMOTED', title: '대기 좌석이 배정되었습니다', body: '24시간 안에 결제해 주세요.', channel: 'SMS_MOCK', read_at: null, created_at: '2026-12-03T05:00:00Z' },
    { id: 'n2', kind: 'PAYMENT_DONE', title: '결제가 완료되었습니다', body: null, channel: 'SMS_MOCK', read_at: '2026-12-03T06:00:00Z', created_at: '2026-12-02T05:00:00Z' },
  ];

  it('채널을 문자(모의)로 표시하고 안 읽은 알림을 구분한다', async () => {
    await renderNotifications(el, { api: api({ myNotifications: vi.fn().mockResolvedValue(list) }), go: vi.fn(), now });
    expect(el.textContent).toContain('문자(모의)');
    expect(el.textContent).not.toContain('SMS_MOCK');
    expect(el.querySelectorAll('.noti.unread')).toHaveLength(1);
    expect(el.querySelector('.noti.unread').textContent).toContain('안 읽음');
    expect(el.textContent).toContain('2026.12.03(목) 14:00');
  });

  it('읽음 처리를 요청하고 표시를 바꾼다', async () => {
    const a = api({ myNotifications: vi.fn().mockResolvedValue(list) });
    await renderNotifications(el, { api: a, go: vi.fn(), now });
    button('읽음 처리').click();
    await vi.waitFor(() => expect(a.markNotificationRead).toHaveBeenCalledWith('n1'));
    await vi.waitFor(() => expect(el.querySelectorAll('.noti.unread')).toHaveLength(0));
  });

  it('모두 읽음', async () => {
    const a = api({ myNotifications: vi.fn().mockResolvedValue(list) });
    await renderNotifications(el, { api: a, go: vi.fn(), now });
    button('모두 읽음 처리').click();
    await vi.waitFor(() => expect(a.markAllNotificationsRead).toHaveBeenCalledTimes(1));
  });

  it('비어 있으면 빈 상태 화면을 보인다', async () => {
    await renderNotifications(el, { api: api(), go: vi.fn(), now });
    expect(el.querySelector('.empty-state')).not.toBeNull();
  });
});

describe('예약 카드 할인 표시 (QA D-03)', () => {
  it('할인 내역은 좌석과 따로 할인 항목으로 보인다', async () => {
    const a = api({ myBooking: vi.fn().mockResolvedValue(booking({
      items: [
        { row_label: 'D', seat_no: 5, grade: 'R', discount_type: 'DISABLED', amount: 20000 },
        { row_label: 'D', seat_no: 6, grade: 'R', discount_type: 'DISABLED_COMPANION', amount: 20000 },
      ],
    })) });
    await detail(a);
    const rows = [...el.querySelectorAll('.bk-meta > *')].map((r) => r.textContent.replace(/\s+/g, ' ').trim());
    expect(rows.some((t) => t.startsWith('좌석') && !t.includes('('))).toBe(true);
    expect(rows.some((t) => t.startsWith('할인') && t.includes('장애인 1'))).toBe(true);
  });
});
