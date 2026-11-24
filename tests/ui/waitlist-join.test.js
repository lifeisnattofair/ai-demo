// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderSelect } from '../../src/user/pages/select.js';
import { renderWaitlist } from '../../src/user/pages/waitlist.js';
import { ApiError, messageFor } from '../../src/lib/api.js';

// 2026-11-23 12:00 KST. 회차는 10일 뒤라 D-2 마감 전입니다.
const NOW = new Date('2026-11-23T03:00:00Z');
const iso = (d) => new Date(NOW.getTime() + d * 86400000).toISOString();

const soldSeats = () => Array.from({ length: 20 }, (_, i) => ({ seat_id: i + 1, row_label: 'A', seat_no: i + 1, grade: 'R', status: 'SOLD' }));

function offering(type, startsIn = 10) {
  return {
    id: 'o1', starts_at: iso(startsIn), ends_at: iso(startsIn), capacity: 20, sale_starts_at: iso(-5), sale_ends_at: iso(startsIn), status: 'OPEN',
    prices: type === 'PERFORMANCE' ? [{ grade: 'R', price: 40000 }] : [{ grade: null, price: 10000 }],
    program: { id: 'p1', type, title: '현의 대화', venue: '소극장', poster_image: 'quartet', poster_tone: 'dark' },
  };
}

function fakeApi(type = 'PERFORMANCE', over = {}) {
  return {
    messageFor,
    getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }),
    getProfile: vi.fn().mockResolvedValue({ id: 'u1', verified_at: '2026-11-20T00:00:00Z' }),
    getOffering: vi.fn().mockResolvedValue(offering(type)),
    myOfferingQty: vi.fn().mockResolvedValue(0),
    myActiveHold: vi.fn().mockResolvedValue(null),
    offeringSeatMap: vi.fn().mockResolvedValue(soldSeats()),
    remainingCapacity: vi.fn().mockResolvedValue(0),
    myWaitlist: vi.fn().mockResolvedValue([]),
    joinWaitlist: vi.fn().mockResolvedValue({ id: 'w1', qty: 2, status: 'WAITING' }),
    ...over,
  };
}

let el;
beforeEach(() => {
  document.body.innerHTML = '<main></main>';
  el = document.querySelector('main');
});
const flush = () => new Promise((r) => setTimeout(r, 0));
const run = async (api, go = vi.fn(), startsIn) => {
  if (startsIn != null) api.getOffering.mockResolvedValue(offering((await api.getOffering()).program.type, startsIn));
  await renderSelect(el, { api, go, offeringId: 'o1', now: () => NOW });
  return go;
};

describe('매진 회차의 대기 신청', () => {
  it('로그인하지 않았으면 로그인 화면으로 보낸다', async () => {
    const go = await run(fakeApi('PERFORMANCE', { getSession: vi.fn().mockResolvedValue(null) }));
    expect(go).toHaveBeenCalledWith(`#/login?next=${encodeURIComponent('#/booking/o1/select')}`);
  });

  it('매진된 공연은 매수와 규칙 안내, 대기 신청 버튼이 있는 신청 화면이 된다', async () => {
    const api = fakeApi();
    const go = await run(api);
    expect(el.querySelector('h2').textContent).toBe('대기 신청');
    expect(el.querySelector('[data-qty]').textContent).toBe('1매');
    const rules = el.querySelector('.wait-rules').textContent;
    expect(rules).toContain('24시간');
    expect(rules).toContain('순번');
    expect(rules).toContain('취소된 좌석');
    el.querySelector('[data-step="1"]').click();
    expect(el.querySelector('[data-qty]').textContent).toBe('2매');
    expect(el.querySelector('.summary').textContent).toContain('2매');
    el.querySelector('.summary [data-join]').click();
    await flush();
    expect(api.joinWaitlist).toHaveBeenCalledWith('o1', 2);
    expect(go).toHaveBeenCalledWith('#/me/waitlist?joined=w1');
  });

  it('수량은 남은 1인 한도까지만 늘어나고 넘기면 안내한다', async () => {
    await run(fakeApi('EXPERIENCE', { myOfferingQty: vi.fn().mockResolvedValue(1) }));
    const plus = el.querySelector('[data-step="1"]');
    for (let i = 0; i < 5; i += 1) plus.click();
    expect(el.querySelector('[data-qty]').textContent).toBe('3명');
    expect(plus.getAttribute('aria-disabled')).toBe('true');
    expect(el.querySelector('[role="alert"]').textContent).toBe(messageFor('LIMIT_EXCEEDED'));
  });

  it('정규 강좌는 본인 1명으로 고정해 신청한다', async () => {
    const api = fakeApi('COURSE');
    await run(api);
    expect(el.querySelector('[data-step]')).toBeNull();
    expect(el.textContent).toContain('본인 1명');
    expect(el.querySelector('.wait-rules').textContent).not.toContain('취소된 좌석');
    el.querySelector('.summary [data-join]').click();
    await flush();
    expect(api.joinWaitlist).toHaveBeenCalledWith('o1', 1);
  });

  it('신청 중에는 버튼이 처리 중이 되고, 서버 오류는 정해 둔 안내로 보인다', async () => {
    let fail;
    const api = fakeApi('PERFORMANCE', { joinWaitlist: vi.fn(() => new Promise((_, rej) => { fail = rej; })) });
    const go = await run(api);
    const btn = el.querySelector('.summary [data-join]');
    btn.click();
    btn.click();
    await flush();
    expect(btn.textContent).toBe('처리 중');
    expect(api.joinWaitlist).toHaveBeenCalledTimes(1);
    fail(new ApiError('ALREADY_WAITING'));
    await flush();
    expect(el.querySelector('[role="alert"]').textContent).toBe('이미 대기 신청한 회차입니다.');
    expect(btn.textContent).toBe('대기 신청하기');
    expect(go).not.toHaveBeenCalled();
  });

  it('이미 대기 중인 회차는 순번과 대기 신청 목록 링크를 보인다', async () => {
    const api = fakeApi('PERFORMANCE', {
      myWaitlist: vi.fn().mockResolvedValue([{ id: 'w9', status: 'WAITING', position: 2, qty: 2, offering: { id: 'o1' } }]),
    });
    await run(api);
    expect(el.querySelector('[data-join]')).toBeNull();
    expect(el.textContent).toContain('2번째');
    expect(el.querySelector('a[href="#/me/waitlist"]')).not.toBeNull();
  });

  it('회차 2일 전부터는 대기 신청 마감을 알리고 신청 버튼을 두지 않는다', async () => {
    const api = fakeApi('EXPERIENCE');
    await run(api, vi.fn(), 1);
    expect(el.querySelector('[data-join]')).toBeNull();
    expect(el.textContent).toContain('대기 신청이 마감');
    expect(el.textContent).not.toContain('공연');
  });
});

describe('대기 신청 목록의 신청 완료 안내', () => {
  it('방금 신청한 건의 순번을 안내한다', async () => {
    const api = {
      getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }),
      myCounts: vi.fn().mockResolvedValue({ upcoming: 0, waitlist: 1, unread: 0 }),
      myWaitlist: vi.fn().mockResolvedValue([{
        id: 'w1', status: 'WAITING', position: 3, qty: 2, allocated_qty: 0, deadline_at: null,
        offering: { id: 'o1', starts_at: iso(10) }, program: { id: 'p1', type: 'PERFORMANCE', title: '현의 대화' },
      }]),
    };
    await renderWaitlist(el, { api, go: vi.fn(), query: new URLSearchParams('joined=w1') });
    const notice = el.querySelector('.my-notice');
    expect(notice.textContent).toBe('대기 신청을 마쳤습니다. 「현의 대화」 대기 순번은 3번째입니다.');
  });
});
