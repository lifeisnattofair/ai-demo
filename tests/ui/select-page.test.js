// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderSelect } from '../../src/user/pages/select.js';
import { ApiError, messageFor } from '../../src/lib/api.js';

const NOW = new Date('2026-11-23T03:00:00Z');
const iso = (d) => new Date(NOW.getTime() + d * 86400000).toISOString();

function seatRows(takenIds = []) {
  const out = [];
  let id = 1;
  for (const row of 'ABCDEFGHIJ') {
    for (let n = 1; n <= 20; n += 1) {
      out.push({ seat_id: id, row_label: row, seat_no: n, grade: row <= 'D' ? 'R' : row <= 'G' ? 'S' : 'A', status: takenIds.includes(id) ? 'SOLD' : 'AVAILABLE' });
      id += 1;
    }
  }
  return out;
}

function fakeApi(over = {}) {
  return {
    messageFor,
    getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }),
    getProfile: vi.fn().mockResolvedValue({ id: 'u1', verified_at: '2026-11-20T00:00:00Z' }),
    getOffering: vi.fn().mockResolvedValue({
      id: 'o1', starts_at: iso(10), ends_at: iso(10), capacity: 200, sale_starts_at: iso(-5), sale_ends_at: iso(10), status: 'OPEN',
      prices: [{ grade: 'R', price: 40000 }, { grade: 'S', price: 30000 }, { grade: 'A', price: 20000 }],
      program: { id: 'p1', type: 'PERFORMANCE', title: '실내악', venue: '소극장', poster_image: 'quartet', poster_tone: 'dark' },
    }),
    myOfferingQty: vi.fn().mockResolvedValue(0),
    myActiveHold: vi.fn().mockResolvedValue(null),
    offeringSeatMap: vi.fn().mockResolvedValue(seatRows()),
    remainingCapacity: vi.fn().mockResolvedValue(10),
    holdSeats: vi.fn().mockResolvedValue({ id: 'h1', expires_at: iso(0) }),
    holdCapacity: vi.fn().mockResolvedValue({ id: 'h2', expires_at: iso(0) }),
    releaseHold: vi.fn().mockResolvedValue(null),
    ...over,
  };
}

let el;
beforeEach(() => {
  document.body.innerHTML = '<main></main>';
  el = document.querySelector('main');
});
const flush = () => new Promise((r) => setTimeout(r, 0));
const run = async (api, go = vi.fn(), extra = {}) => {
  await renderSelect(el, { api, go, offeringId: 'o1', now: () => NOW, ...extra });
  return go;
};

describe('좌석 선택 화면', () => {
  it('로그인하지 않았으면 로그인 화면으로 보내고 돌아올 주소를 남긴다', async () => {
    const go = await run(fakeApi({ getSession: vi.fn().mockResolvedValue(null) }));
    expect(go).toHaveBeenCalledWith(`#/login?next=${encodeURIComponent('#/booking/o1/select')}`);
  });

  it('연락처 입력을 마치지 못한 계정은 선점 전에 연락처 입력 단계로 보낸다', async () => {
    const api = fakeApi({ getProfile: vi.fn().mockResolvedValue(null) });
    const go = await run(api);
    expect(go).toHaveBeenCalledWith(`#/signup/contact?next=${encodeURIComponent('#/booking/o1/select')}`);
    expect(api.getOffering).not.toHaveBeenCalled();
  });

  it('좌석을 고르면 요약에 좌석과 합계가 보이고 다음을 누르면 선점 후 할인 선택으로 간다', async () => {
    const api = fakeApi();
    const go = await run(api);
    el.querySelector('[aria-label="E열 9번 S석"]').click();
    el.querySelector('[aria-label="E열 10번 S석"]').click();
    expect(el.querySelector('.seat-chips').textContent).toContain('S석 E열 9번');
    expect(el.querySelector('.sum-total b').textContent).toBe('60,000원');
    el.querySelector('.summary [data-next]').click();
    await flush();
    expect(api.holdSeats).toHaveBeenCalledWith('o1', [89, 90]);
    expect(go).toHaveBeenCalledWith('#/booking/h1/discount');
  });

  it('선점 실패 시 안내 문구를 보여 주고 좌석 상태를 다시 불러온다', async () => {
    const api = fakeApi({ holdSeats: vi.fn().mockRejectedValue(new ApiError('SEAT_TAKEN')) });
    const go = await run(api);
    el.querySelector('[aria-label="E열 9번 S석"]').click();
    api.offeringSeatMap.mockResolvedValue(seatRows([89]));
    el.querySelector('.summary [data-next]').click();
    await flush();
    expect(el.querySelector('[role="alert"]').textContent).toBe('방금 다른 분이 선택한 좌석입니다. 다른 좌석을 선택해 주세요.');
    expect(api.offeringSeatMap).toHaveBeenCalledTimes(2);
    expect(el.querySelector('button.seat[aria-label^="E열 9번"]').getAttribute('aria-disabled')).toBe('true');
    expect(el.querySelector('.seat-chips')).toBeNull();
    expect(go).not.toHaveBeenCalled();
  });

  it('이미 확정한 매수만큼 선택 가능 매수가 줄어든다', async () => {
    await run(fakeApi({ myOfferingQty: vi.fn().mockResolvedValue(1) }));
    for (const n of [1, 2, 3, 4]) el.querySelector(`[aria-label="E열 ${n}번 S석"]`).click();
    expect(el.querySelector('.seat-chips').children).toHaveLength(3);
    expect(el.querySelector('[role="alert"]').textContent).toBe('1인 예약 한도를 넘었습니다. 남은 매수 안에서 선택해 주세요.');
  });

  it('한도 안내는 배치도와 좌석 목록에서 넘어도 화면에 한 번만 나온다', async () => {
    await run(fakeApi({ myOfferingQty: vi.fn().mockResolvedValue(3) }));
    el.querySelector('[aria-label="E열 1번 S석"]').click();
    el.querySelector('[aria-label="E열 2번 S석"]').click();
    el.querySelector('[data-view="list"]').click();
    el.querySelector('input[aria-label="E열 3번 S석"]').click();
    const alerts = [...el.querySelectorAll('[role="alert"]')].filter((a) => a.textContent.includes('한도'));
    expect(alerts).toHaveLength(1);
    expect(el.querySelector('.booking-live [role="alert"]')).toBe(alerts[0]);
  });

  it('넓은 화면은 배치도, 768px 이하 좁은 화면은 좌석 목록을 먼저 보이고 전환은 그대로 된다', async () => {
    await run(fakeApi());
    expect(el.querySelector('[data-view="map"]').getAttribute('aria-pressed')).toBe('true');
    document.body.innerHTML = '<main></main>';
    el = document.querySelector('main');
    await run(fakeApi(), vi.fn(), { compact: () => true });
    const listBtn = el.querySelector('[data-view="list"]');
    expect(listBtn.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('input[aria-label="E열 3번 S석"]').closest('[hidden]')).toBeNull();
    expect(el.querySelector('[aria-label="E열 3번 S석"].seat, button[aria-label="E열 3번 S석"]').closest('[hidden]')).not.toBeNull();
    el.querySelector('[data-view="map"]').click();
    expect(el.querySelector('button[aria-label="E열 3번 S석"]').closest('[hidden]')).toBeNull();
  });

  it('좌석 이름에는 선택 상태를 붙이지 않고 aria-pressed 로만 알린다(두 번 읽지 않게)', async () => {
    await run(fakeApi());
    const b = el.querySelector('[aria-label="E열 9번 S석"]');
    b.click();
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.getAttribute('aria-label')).toBe('E열 9번 S석');
  });

  it('체험은 인원을 늘려 선점하고, 한도를 넘기면 안내한다', async () => {
    const base = fakeApi();
    const o = await base.getOffering();
    const api = fakeApi({
      getOffering: vi.fn().mockResolvedValue({ ...o, prices: [{ grade: null, price: 10000 }], program: { ...o.program, type: 'EXPERIENCE' } }),
    });
    const go = await run(api);
    const plus = el.querySelector('[data-step="1"]');
    for (let i = 0; i < 5; i += 1) plus.click();
    expect(el.querySelector('[data-qty]').textContent).toBe('4명');
    expect(el.querySelector('[role="alert"]').textContent).toContain('1인 예약 한도');
    el.querySelector('.summary [data-next]').click();
    await flush();
    expect(api.holdCapacity).toHaveBeenCalledWith('o1', 4);
    expect(go).toHaveBeenCalledWith('#/booking/h2/discount');
  });

  it('정규 강좌는 본인 1명 신청으로 고정된다', async () => {
    const base = fakeApi();
    const o = await base.getOffering();
    const api = fakeApi({
      getOffering: vi.fn().mockResolvedValue({ ...o, prices: [{ grade: null, price: 120000 }], program: { ...o.program, type: 'COURSE' } }),
    });
    await run(api);
    expect(el.textContent).toContain('본인 1명 신청');
    expect(el.querySelector('[data-step]')).toBeNull();
    el.querySelector('.summary [data-next]').click();
    await flush();
    expect(api.holdCapacity).toHaveBeenCalledWith('o1', 1);
  });

  it('이미 지난 선점은 이어가지 않고 선택 화면을 그린다(만료 재표시 반복 방지)', async () => {
    const api = fakeApi({ myActiveHold: vi.fn().mockResolvedValue({ id: 'h9', qty: 2, expires_at: new Date(NOW.getTime() - 1000).toISOString() }) });
    await run(api);
    expect(el.querySelector('.timer')).toBeNull();
    expect(el.querySelector('[data-release]')).toBeNull();
    expect(api.myActiveHold).toHaveBeenCalledTimes(1);
    expect(el.querySelectorAll('button.seat')).toHaveLength(200);
  });

  it('선점 실패 뒤 잔여 수량과 한도를 다시 반영한다', async () => {
    const base = fakeApi();
    const o = await base.getOffering();
    const api = fakeApi({
      getOffering: vi.fn().mockResolvedValue({ ...o, prices: [{ grade: null, price: 10000 }], program: { ...o.program, type: 'EXPERIENCE' } }),
      holdCapacity: vi.fn().mockRejectedValue(new ApiError('SOLD_OUT')),
    });
    await run(api);
    const plus = el.querySelector('[data-step="1"]');
    plus.click(); plus.click(); plus.click();
    expect(el.querySelector('[data-qty]').textContent).toBe('4명');
    api.remainingCapacity.mockResolvedValue(2);
    el.querySelector('.summary [data-next]').click();
    await flush();
    expect(el.querySelector('[data-qty-sub]').textContent).toContain('잔여 2명');
    expect(el.querySelector('[data-qty]').textContent).toBe('2명');
    expect(plus.getAttribute('aria-disabled')).toBe('true');
  });

  it('선점 해제 버튼은 처리 중 상태가 되고 중복 요청하지 않는다', async () => {
    let finish;
    const api = fakeApi({
      myActiveHold: vi.fn().mockResolvedValue({ id: 'h9', qty: 2, expires_at: new Date(NOW.getTime() + 600000).toISOString() }),
      releaseHold: vi.fn(() => new Promise((r) => { finish = r; })),
    });
    await run(api);
    const btn = el.querySelector('[data-release]');
    btn.click();
    btn.click();
    await flush();
    expect(btn.textContent).toBe('처리 중');
    expect(api.releaseHold).toHaveBeenCalledTimes(1);
    finish();
    await flush();
  });
});
