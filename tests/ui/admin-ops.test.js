// @vitest-environment jsdom
// 관리자 운영 화면(Task 14): 예약 내역/증빙, 대기자, 결제/환불, 회차 취소 승인, 정산, 메뉴, 할인 적용 여부
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AVAILABLE, visibleMenu } from '../../src/admin/layout.js';
import { discountText, proofTargets, renderBookings } from '../../src/admin/pages/bookings.js';
import { renderWaitlist } from '../../src/admin/pages/waitlist.js';
import { renderPayments } from '../../src/admin/pages/payments.js';
import { needsRefundRun, renderCancelRequests, requestStatus } from '../../src/admin/pages/cancel-requests.js';
import { chartScale, renderSettlement, summarizeSettlement } from '../../src/admin/pages/settlement.js';
import { cancelRuleLines, renderProgramEdit } from '../../src/admin/pages/programs.js';
import { quickRange } from '../../src/admin/components/search-box.js';
import { addDays, addMonths, dayKeysBetween } from '../../src/lib/format.js';
import { discountOptions, loadDiscounts } from '../../src/user/components/checkout-data.js';
import { renderDiscount } from '../../src/user/pages/discount.js';
import { fakeApi, NOW as CHECKOUT_NOW } from './checkout-fixtures.js';

const NOW = new Date('2026-12-07T01:00:00Z'); // 12/07 10:00 KST
const now = () => NOW;
const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await flush(); };
const dialogButton = (label) => [...document.querySelectorAll('.dialog button')].find((b) => b.textContent === label);

let el;
beforeEach(() => {
  document.body.innerHTML = '<main></main>';
  el = document.querySelector('main');
  sessionStorage.clear();
});

describe('메뉴(available)', () => {
  it('정산 담당 메뉴에 예약 내역, 결제/환불 내역, 회차 취소 승인, 정산 현황이 보입니다', () => {
    const labels = visibleMenu('finance', 'local', AVAILABLE).flatMap((g) => (g.children ?? [g]).map((c) => c.label));
    expect(labels).toEqual(expect.arrayContaining(['예약 내역', '결제/환불 내역', '회차 취소 승인', '정산 현황']));
    expect(labels).not.toContain('대기자 관리');
  });
  it('운영 담당은 대기자 관리, 회차 취소 승인은 보이고 결제/환불, 정산은 보이지 않습니다', () => {
    const labels = visibleMenu('operator', 'local', AVAILABLE).flatMap((g) => (g.children ?? [g]).map((c) => c.label));
    expect(labels).toEqual(expect.arrayContaining(['예약 내역', '대기자 관리', '회차 취소 승인']));
    expect(labels).not.toContain('정산 현황');
    expect(labels).not.toContain('결제/환불 내역');
  });
});

describe('날짜 키 계산', () => {
  it('빠른 기간과 날짜 목록', () => {
    expect(addDays('2026-12-01', -1)).toBe('2026-11-30');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(quickRange('7d', '2026-12-07')).toEqual({ from: '2026-12-01', to: '2026-12-07' });
    expect(quickRange('1m', '2026-12-07')).toEqual({ from: '2026-11-08', to: '2026-12-07' });
    expect(dayKeysBetween('2026-11-30', '2026-12-02')).toEqual(['2026-11-30', '2026-12-01', '2026-12-02']);
  });
});

const bookingRows = () => [
  {
    booking_id: 'b1', booking_no: 'B00000001', status: 'CONFIRMED', created_at: '2026-12-06T12:00:00Z', user_id: 'u1',
    name_masked: '회***나', phone_masked: '010-****-0001', offering_id: 'o1', starts_at: '2026-12-11T10:00:00Z',
    program_id: 'p1', program_title: '현의 대화', program_type: 'PERFORMANCE', qty: 2, total_amount: 40000,
    seats: 'R석 A열 1, R석 A열 2', discounts: ['DISABLED', 'DISABLED_COMPANION'], proof: 'TODO',
    items: [
      { id: 'i1', discount_type: 'DISABLED', proof_checked: false },
      { id: 'i2', discount_type: 'DISABLED_COMPANION', proof_checked: true },
    ],
  },
  {
    booking_id: 'b2', booking_no: 'B00000002', status: 'CONFIRMED', created_at: '2026-12-05T12:00:00Z', user_id: 'u2',
    name_masked: '회**둘', phone_masked: '010-****-0002', offering_id: 'o1', starts_at: '2026-12-11T10:00:00Z',
    program_id: 'p1', program_title: '현의 대화', program_type: 'PERFORMANCE', qty: 1, total_amount: 40000,
    seats: 'R석 A열 3', discounts: [], proof: 'NONE', items: [{ id: 'i3', discount_type: 'GENERAL', proof_checked: false }],
  },
];

describe('예약 내역', () => {
  it('할인 문구와 증빙 대상 매수', () => {
    expect(discountText(['DISABLED', 'DISABLED_COMPANION'])).toBe('장애인, 장애인 동반');
    expect(discountText([])).toBe('');
    expect(proofTargets(bookingRows(), new Set(['b1', 'b2']))).toEqual([{ itemId: 'i1', bookingNo: 'B00000001' }]);
  });

  it('운영 담당: 가린 예약자, 증빙 상태 글자, 선택 후 증빙 확인 처리', async () => {
    const api = {
      bookings: vi.fn().mockResolvedValue(bookingRows()),
      markProof: vi.fn().mockResolvedValue(null),
      offerings: vi.fn().mockResolvedValue([]),
      viewMember: vi.fn(),
    };
    await renderBookings(el, { api, role: 'operator', now });
    await settle();
    expect(el.querySelector('.total b').textContent).toBe('2');
    expect(el.textContent).toContain('회***나');
    expect(el.textContent).toContain('010-****-0001');
    expect(el.querySelector('.proof.todo').textContent).toBe('확인 전');
    expect(el.textContent).toContain('장애인, 장애인 동반');
    // 기본 기간은 최근 7일
    expect(api.bookings).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-12-01', to: '2026-12-07' }));

    el.querySelector('input[type="checkbox"][aria-label="B00000001 선택"]').click();
    expect(el.querySelector('tbody tr').classList.contains('is-selected')).toBe(true);
    el.querySelector('[data-act="proof"]').click();
    await settle();
    dialogButton('확인 처리').click();
    await settle();
    expect(api.markProof).toHaveBeenCalledTimes(1);
    expect(api.markProof).toHaveBeenCalledWith('i1', true);
    expect(el.querySelector('.form-alert.ok').textContent).toContain('1매');
  });

  it('정산 담당: 선택 칸과 증빙 확인 버튼이 없습니다', async () => {
    const api = { bookings: vi.fn().mockResolvedValue(bookingRows()), offerings: vi.fn().mockResolvedValue([]) };
    await renderBookings(el, { api, role: 'finance', now });
    await settle();
    expect(el.querySelector('[data-act="proof"]')).toBeNull();
    expect(el.querySelector('tbody input[type="checkbox"]')).toBeNull();
    expect(el.querySelector('[data-act="csv"]')).not.toBeNull();
  });

  it('조회 결과가 없으면 빈 상태 화면', async () => {
    const api = { bookings: vi.fn().mockResolvedValue([]), offerings: vi.fn().mockResolvedValue([]) };
    await renderBookings(el, { api, role: 'operator', now });
    await settle();
    expect(el.querySelector('.empty-state').textContent).toContain('조건에 맞는 예약이 없습니다');
  });
});

describe('대기자 관리', () => {
  it('순번, 가린 이름, 상태를 글자로 보입니다', async () => {
    const api = {
      waitlist: vi.fn().mockResolvedValue([
        { waitlist_id: 'w1', offering_id: 'o1', starts_at: '2026-12-11T10:00:00Z', program_id: 'p1', program_title: '현의 대화', program_type: 'PERFORMANCE',
          name_masked: '회**둘', phone_masked: '010-****-0002', qty: 2, allocated_qty: 0, status: 'WAITING', position: 1, created_at: '2026-12-05T00:00:00Z' },
        { waitlist_id: 'w2', offering_id: 'o1', starts_at: '2026-12-11T10:00:00Z', program_id: 'p1', program_title: '현의 대화', program_type: 'PERFORMANCE',
          name_masked: '회**셋', phone_masked: '010-****-0003', qty: 1, allocated_qty: 1, status: 'PROMOTED', position: 2,
          created_at: '2026-12-05T01:00:00Z', deadline_at: '2026-12-08T01:00:00Z' },
      ]),
    };
    await renderWaitlist(el, { api, now });
    await settle();
    const rows = [...el.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('회**둘');
    expect(rows[0].querySelector('.chip:not([class*="type-"])').textContent).toBe('대기 중');
    expect(rows[1].querySelector('.chip:not([class*="type-"])').textContent).toBe('승격(결제 대기)');
  });
});

describe('결제/환불 내역', () => {
  it('결제대행 거래 번호와 상태를 보이고, 환불 탭으로 바꿉니다', async () => {
    const api = {
      payments: vi.fn().mockResolvedValue([{ payment_id: 'pay1', order_id: 'HB-20261201-AAAA', payment_key: 'pk_HB-1', booking_no: 'B1', program_id: 'p1',
        program_title: '현의 대화', program_type: 'PERFORMANCE', name_masked: '회***나', amount: 40000, status: 'PARTIAL_CANCELED',
        approved_at: '2026-12-01T01:00:00Z', refunded_amount: 36000 }]),
      refunds: vi.fn().mockResolvedValue([{ refund_id: 'r1', payment_key: 'pk_HB-1', booking_no: 'B1', program_id: 'p1', program_title: '현의 대화',
        program_type: 'PERFORMANCE', name_masked: '회***나', paid_amount: 40000, refund_amount: 36000, fee_amount: 4000, rule: 'D7_4', reason: 'USER',
        pg_transaction_key: 'tx_1', created_at: '2026-12-06T01:00:00Z' }]),
      paymentRaw: vi.fn(),
    };
    await renderPayments(el, { api, now });
    await settle();
    expect(el.textContent).toContain('pk_HB-1');
    expect(el.querySelector('tbody .chip').textContent).toBe('부분 취소');
    el.querySelector('[data-tab="refunds"]').click();
    await settle();
    expect(el.querySelector('[data-tab="refunds"]').getAttribute('aria-pressed')).toBe('true');
    expect(el.textContent).toContain('tx_1');
    expect(el.querySelector('tbody .chip').textContent).toBe('회원 취소');
  });
});

const requestRow = (over = {}) => ({
  id: 'req1', offering_id: 'o1', starts_at: '2026-12-11T10:00:00Z', offering_status: 'CANCEL_REQUESTED', program_id: 'p1',
  program_title: '현의 대화', program_type: 'PERFORMANCE', reason: '설비 점검', status: 'REQUESTED', requested_at: '2026-12-06T00:00:00Z',
  requested_by_name: '운영 담당', confirmed_count: 2, confirmed_amount: 120000, refunded_count: 0, refunded_amount: 0, pending_payments: 0, ...over,
});

describe('회차 취소 승인', () => {
  it('상태 문구와 환불 재실행 판단', () => {
    expect(requestStatus(requestRow()).text).toBe('승인 대기');
    expect(requestStatus(requestRow({ status: 'REJECTED' })).text).toBe('반려');
    const approved = requestRow({ status: 'APPROVED', offering_status: 'CANCELLED', confirmed_count: 0, refunded_count: 2 });
    expect(needsRefundRun(approved)).toBe(false);
    expect(requestStatus(approved).text).toBe('환불 완료');
    expect(needsRefundRun(requestRow({ status: 'APPROVED' }))).toBe(true);
  });

  it('정산 담당이 승인하면 결정 후 일괄 환불(payments-cancel INSTITUTION)을 부르고 결과를 알립니다', async () => {
    const api = {
      cancelRequests: vi.fn().mockResolvedValue([requestRow()]),
      decideOfferingCancel: vi.fn().mockResolvedValue({ id: 'req1', status: 'APPROVED' }),
      runInstitutionCancel: vi.fn().mockResolvedValue({ offeringId: 'o1', cancelled: [{}, {}], failed: [], pending: 0 }),
      offerings: vi.fn().mockResolvedValue([]),
    };
    await renderCancelRequests(el, { api, role: 'finance', now });
    await settle();
    expect(el.querySelector('form.cancel-form')).toBeNull();
    el.querySelector('[data-act="approve"]').click();
    await settle();
    expect(document.querySelector('.dialog').textContent).toContain('120,000원');
    dialogButton('승인하고 환불').click();
    await settle();
    expect(api.decideOfferingCancel).toHaveBeenCalledWith('req1', true);
    expect(api.runInstitutionCancel).toHaveBeenCalledWith('o1');
    expect(el.querySelector('.form-alert.ok').textContent).toContain('2건');
  });

  it('운영 담당은 요청 양식을 쓰고 승인 버튼이 없습니다', async () => {
    const api = {
      cancelRequests: vi.fn().mockResolvedValue([requestRow()]),
      offerings: vi.fn().mockResolvedValue([
        { id: 'o2', starts_at: '2026-12-20T10:00:00Z', status: 'OPEN', sale_starts_at: '2026-11-01T00:00:00Z', sale_ends_at: '2026-12-20T10:00:00Z', program: { title: '도자기', type: 'EXPERIENCE' } },
      ]),
      requestOfferingCancel: vi.fn().mockResolvedValue({ id: 'req2' }),
    };
    await renderCancelRequests(el, { api, role: 'operator', now });
    await settle();
    expect(el.querySelector('[data-act="approve"]')).toBeNull();
    const form = el.querySelector('form.cancel-form');
    form.querySelector('button[type="submit"]').click();
    await settle();
    expect(form.querySelector('[data-field="reason"] .err').hidden).toBe(false);
    form.elements.offering.value = 'o2';
    form.elements.reason.value = '강사 사정';
    form.querySelector('button[type="submit"]').click();
    await settle();
    dialogButton('취소 요청').click();
    await settle();
    expect(api.requestOfferingCancel).toHaveBeenCalledWith('o2', '강사 사정');
  });
});

const settlementRows = [
  { day: '2026-12-01', program_id: 'p1', program_title: '현의 대화', program_type: 'PERFORMANCE', paid_count: 2, paid_sum: 120000, refund_count: 0,
    user_refund_count: 0, institution_refund_count: 0, refund_sum: 0, fee_count: 0, fee_sum: 0, net_sum: 120000 },
  { day: '2026-12-06', program_id: 'p1', program_title: '현의 대화', program_type: 'PERFORMANCE', paid_count: 0, paid_sum: 0, refund_count: 1,
    user_refund_count: 1, institution_refund_count: 0, refund_sum: 36000, fee_count: 1, fee_sum: 4000, net_sum: -36000 },
  { day: '2026-12-03', program_id: 'p2', program_title: '도자기', program_type: 'EXPERIENCE', paid_count: 1, paid_sum: 10000, refund_count: 0,
    user_refund_count: 0, institution_refund_count: 0, refund_sum: 0, fee_count: 0, fee_sum: 0, net_sum: 10000 },
];

describe('정산 현황', () => {
  it('합계가 맞습니다: net = paid - refund, 빈 날은 0', () => {
    const s = summarizeSettlement(settlementRows, { from: '2026-12-01', to: '2026-12-07' });
    expect(s.totals).toMatchObject({ paid: 130000, paidCount: 3, refund: 36000, refundCount: 1, fee: 4000, net: 94000, userRefundCount: 1 });
    expect(s.days).toHaveLength(7);
    expect(s.days.map((d) => d.net)).toEqual([120000, 0, 10000, 0, 0, -36000, 0]);
    expect(s.programs.map((p) => [p.title, p.net])).toEqual([['현의 대화', 84000], ['도자기', 10000]]);
    expect(s.stats).toMatchObject({ max: { day: '2026-12-01', net: 120000 }, min: { day: '2026-12-06', net: -36000 } });
    expect(s.stats.avg).toBe(Math.round(94000 / 7));
    const only = summarizeSettlement(settlementRows, { from: '2026-12-01', to: '2026-12-07', program: 'p2' });
    expect(only.totals.net).toBe(10000);
  });

  it('그래프 눈금은 보기 좋은 값으로 올림합니다', () => {
    expect(chartScale(2178000)).toEqual({ max: 2400000, ticks: [2400000, 1600000, 800000, 0] });
    expect(chartScale(0)).toEqual({ max: 3, ticks: [3, 2, 1, 0] });
  });

  it('KPI, 막대(기간 일수만큼), 합계 행, CSV 내려받기(처리 중 표시)', async () => {
    const api = { settlement: vi.fn().mockResolvedValue(settlementRows) };
    URL.createObjectURL = vi.fn(() => 'blob:s');
    URL.revokeObjectURL = vi.fn();
    const clicks = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { clicks.push(this.download); });
    await renderSettlement(el, { api, now });
    await settle();
    expect(api.settlement).toHaveBeenCalledWith('2026-12-01', '2026-12-07');
    expect(el.querySelector('.kpi.net .k-value').textContent).toBe('94,000원');
    expect(el.querySelectorAll('.chart .plot .bar')).toHaveLength(7);
    expect(el.querySelector('.chart').getAttribute('aria-label')).toContain('120,000원');
    const foot = [...el.querySelectorAll('tfoot td')].map((td) => td.textContent);
    expect(foot).toEqual(['합계', '3', '130,000', '1', '36,000', '4,000', '94,000']);
    // 프로그램별 탭
    el.querySelector('[data-view="program"]').click();
    expect(el.querySelector('[data-view="program"]').getAttribute('aria-pressed')).toBe('true');
    expect([...el.querySelectorAll('.result tbody tr')].map((tr) => tr.cells[0].textContent)).toEqual(['현의 대화', '도자기']);
    const csvBtn = el.querySelector('[data-act="csv"]');
    csvBtn.click();
    expect(csvBtn.dataset.busy).toBe('true');
    await settle();
    expect(clicks).toEqual(['정산현황_프로그램별_20261201-20261207.csv']);
    const blob = URL.createObjectURL.mock.calls[0][0];
    const text = await blob.text();
    expect(text.split('\n')[0]).toContain('프로그램');
    expect(text.trim().split('\n').at(-1)).toBe('합계,3,130000,1,36000,4000,94000');
  });

  it('자료가 없으면 빈 상태 화면', async () => {
    await renderSettlement(el, { api: { settlement: vi.fn().mockResolvedValue([]) }, now });
    await settle();
    expect(el.querySelector('.empty-state').textContent).toContain('이 기간에 결제나 환불이 없습니다');
  });
});

describe('할인 적용 여부(R23)', () => {
  it('할인 미적용이면 일반만 고를 수 있고, 저장된 할인 선택도 일반으로 돌립니다', () => {
    expect(discountOptions('PERFORMANCE', false).map((o) => o.value)).toEqual(['GENERAL']);
    expect(discountOptions('PERFORMANCE').length).toBe(6);
    sessionStorage.setItem('hb:discounts:h9', JSON.stringify(['MULTICHILD']));
    expect(loadDiscounts('h9', 1, { discountEnabled: false })).toEqual(['GENERAL']);
    expect(loadDiscounts('h9', 1)).toEqual(['MULTICHILD']);
  });

  it('사용자 할인 단계에 일반만 보이고 안내 문구가 바뀝니다', async () => {
    const api = fakeApi({
      getOffering: vi.fn().mockResolvedValue({
        id: 'o1', starts_at: '2026-12-31T10:00:00Z', prices: [{ grade: 'R', price: 40000 }],
        program: { id: 'p1', type: 'PERFORMANCE', title: '실내악', venue: '소극장', poster_image: null, discount_enabled: false },
      }),
    });
    await renderDiscount(el, { api, go: vi.fn(), holdId: 'h1', now: () => CHECKOUT_NOW });
    const values = [...el.querySelectorAll('.ticket-row select option')].map((o) => o.value);
    expect([...new Set(values)]).toEqual(['GENERAL']);
    expect(el.textContent).toContain('이 프로그램은 할인을 적용하지 않습니다');
  });

  it('관리자 프로그램 양식: 할인 적용 선택과 유형별 취소 규정(읽기 전용)', async () => {
    expect(cancelRuleLines('COURSE')).toHaveLength(7);
    expect(cancelRuleLines('EXPERIENCE')).toHaveLength(4);
    const api = {
      program: vi.fn().mockResolvedValue({ id: 'p1', type: 'EXPERIENCE', title: '도자기', is_public: true, discount_enabled: false, poster_tone: 'light', offerings: [] }),
      saveProgram: vi.fn().mockResolvedValue({ id: 'p1' }),
    };
    await renderProgramEdit(el, { api, go: vi.fn(), id: 'p1' });
    await settle();
    expect(el.querySelector('input[name="discount_enabled"][value="N"]').checked).toBe(true);
    const rules = el.querySelector('.rule-list');
    expect(rules.textContent).toContain('수수료 10%');
    el.querySelector('input[name="type"][value="COURSE"]').click();
    expect(el.querySelector('.rule-list').textContent).toContain('수업 1/3 경과 전');
    el.querySelector('input[name="discount_enabled"][value="Y"]').click();
    el.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(api.saveProgram).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', discount_enabled: true }));
  });
});
