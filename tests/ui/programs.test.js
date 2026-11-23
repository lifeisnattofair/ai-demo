// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saleStatus, STATUS_LABEL } from '../../src/user/components/program-card.js';
import { renderPrograms } from '../../src/user/pages/programs.js';
import { renderProgramDetail, cancellationRows } from '../../src/user/pages/program-detail.js';

const NOW = new Date('2026-11-23T03:00:00Z'); // 2026.11.23(월) 12:00 KST
const iso = (days, h = 10) => new Date(NOW.getTime() + days * 86400000 + (h - 12) * 3600000).toISOString();

function offering(id, startDays, over = {}) {
  return {
    id,
    starts_at: iso(startDays, 19),
    ends_at: iso(startDays, 21),
    capacity: 20,
    sale_starts_at: iso(-7),
    sale_ends_at: iso(startDays, 19),
    status: 'OPEN',
    prices: [{ grade: null, price: 10000 }],
    lessons: [],
    ...over,
  };
}

const SEAT_PRICES = [{ grade: 'R', price: 40000 }, { grade: 'S', price: 30000 }, { grade: 'A', price: 20000 }];

function lessons12(firstDays) {
  return Array.from({ length: 12 }, (_, i) => ({ seq: i + 1, starts_at: iso(firstDays + i * 7, 19) }));
}

function program(id, type, title, extra = {}) {
  return {
    id,
    type,
    title,
    summary: `${title} 한 줄 소개`,
    description: null,
    venue: '소극장',
    audience: '성인',
    poster_image: null,
    poster_tone: 'dark',
    poster_series: '시리즈',
    poster_title: '제목\n둘째 줄',
    poster_sub: '부제',
    details: { runtime: '100분', intro: ['소개 문단입니다.'], items_title: '프로그램', items: [{ name: '곡 하나', note: '약 20분' }], people: [{ name: '한지민', role: '바이올린' }], guide: '안내 문구입니다.' },
    offerings: [],
    ...extra,
  };
}

function fixture() {
  return [
    program('p1', 'PERFORMANCE', '겨울 실내악 시리즈 「현의 대화」', {
      poster_image: 'quartet',
      offerings: [
        offering('o1', 10, { capacity: 200, prices: SEAT_PRICES }),
        offering('o2', 11, { capacity: 200, prices: SEAT_PRICES }),
      ],
    }),
    program('p2', 'PERFORMANCE', '한빛 청소년 연극제 「우리들의 무대」', {
      audience: '중학생 이상',
      offerings: [offering('o3', 12, { capacity: 200, prices: SEAT_PRICES })],
    }),
    program('p3', 'EXPERIENCE', '가족 도자기 공방', {
      audience: '초등학생 동반 가족',
      details: { runtime: '약 2시간', intro: ['소개'], items_title: '진행 순서', items: [{ name: '흙 다루기', note: '30분' }], people: [], guide: '안내' },
      offerings: [offering('o4', 5), offering('o5', 12)] }),
    program('p4', 'EXPERIENCE', '무대 분장 체험', {
      details: { runtime: '약 2시간', intro: ['분장 소개'], items_title: '진행 순서', items: [], people: [], guide: '' },
      offerings: [offering('o6', 20, { sale_starts_at: iso(3) })],
    }),
    program('p5', 'COURSE', '시민 합창 교실 (12주)', {
      offerings: [offering('o7', 9, { capacity: 15, prices: [{ grade: null, price: 120000 }], ends_at: iso(9 + 77, 21), lessons: lessons12(9) })],
    }),
    program('p6', 'COURSE', '생활 수채화 (12주)', {
      poster_tone: 'light',
      offerings: [offering('o8', 9, { capacity: 15, prices: [{ grade: null, price: 120000 }], ends_at: iso(9 + 77, 21), lessons: lessons12(9) })],
    }),
  ];
}

function fakeApi(over = {}) {
  const data = fixture();
  return {
    listPrograms: vi.fn().mockResolvedValue(data),
    getProgram: vi.fn(async (id) => data.find((p) => p.id === id) ?? null),
    remainingCapacity: vi.fn(async (id) => (id === 'o3' ? 0 : 12)),
    messageFor: (c) => c,
    ...over,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const texts = (nodes) => [...nodes].map((n) => n.textContent.trim());

describe('saleStatus', () => {
  const o = { sale_starts_at: '2026-11-20T00:00:00Z', sale_ends_at: '2026-12-10T00:00:00Z', status: 'OPEN' };
  it('판매 시작 전은 UPCOMING', () => {
    expect(saleStatus(o, new Date('2026-11-19T00:00:00Z'), false)).toBe('UPCOMING');
  });
  it('판매 중은 ON_SALE, 매진이면 SOLD_OUT_WAITLIST', () => {
    expect(saleStatus(o, new Date('2026-11-25T00:00:00Z'), false)).toBe('ON_SALE');
    expect(saleStatus(o, new Date('2026-11-25T00:00:00Z'), true)).toBe('SOLD_OUT_WAITLIST');
  });
  it('판매 종료 후는 CLOSED, 매진이어도 CLOSED', () => {
    expect(saleStatus(o, new Date('2026-12-10T00:00:00Z'), false)).toBe('CLOSED');
    expect(saleStatus(o, new Date('2026-12-11T00:00:00Z'), true)).toBe('CLOSED');
  });
  it('열려 있지 않은 회차는 CLOSED', () => {
    expect(saleStatus({ ...o, status: 'CANCELLED' }, new Date('2026-11-25T00:00:00Z'), false)).toBe('CLOSED');
  });
  it('한국어 라벨', () => {
    expect(STATUS_LABEL).toEqual({
      UPCOMING: '예매 예정',
      ON_SALE: '예매 중',
      SOLD_OUT_WAITLIST: '매진(대기 가능)',
      CLOSED: '마감',
    });
  });
});

describe('프로그램 목록', () => {
  let el;
  beforeEach(() => {
    el = document.createElement('main');
    document.body.replaceChildren(el);
  });

  async function open(query = new URLSearchParams(), api = fakeApi()) {
    await renderPrograms(el, { api, query, now: () => NOW });
    return api;
  }

  it('프로그램 6건이 카드로 나오고 총 건수를 알려 줍니다', async () => {
    await open();
    expect(el.querySelectorAll('.grid .card')).toHaveLength(6);
    expect(el.querySelector('.filters .count').textContent).toBe('총 6건');
  });

  it('유형 「체험」을 선택하면 체험 카드 2개만 남습니다', async () => {
    await open();
    const btn = [...el.querySelectorAll('.seg button')].find((b) => b.textContent === '체험');
    btn.click();
    const cards = el.querySelectorAll('.grid .card');
    expect(cards).toHaveLength(2);
    expect(texts(el.querySelectorAll('.grid .card .type'))).toEqual(['체험', '체험']);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('.filters .count').textContent).toBe('총 2건');
  });

  it('주소의 type 값으로 처음부터 걸러집니다', async () => {
    await open(new URLSearchParams('type=COURSE'));
    expect(el.querySelectorAll('.grid .card')).toHaveLength(2);
    expect([...el.querySelectorAll('.seg button')].find((b) => b.getAttribute('aria-pressed') === 'true').textContent).toBe('정규 강좌');
  });

  it('상태는 색이 아니라 글자로 보입니다', async () => {
    await open();
    const labels = texts(el.querySelectorAll('.grid .card .status'));
    expect(labels).toContain('예매 중');
    expect(labels).toContain('매진(대기 가능)');
    expect(labels).toContain('예매 예정');
    for (const s of el.querySelectorAll('.grid .card .status')) expect(s.textContent.trim().length).toBeGreaterThan(0);
  });

  it('회차가 전부 매진이면 매진(대기 가능), 하나라도 남으면 예매 중', async () => {
    await open();
    const card = (title) => [...el.querySelectorAll('.grid .card')].find((c) => c.querySelector('h3').textContent === title);
    expect(card('한빛 청소년 연극제 「우리들의 무대」').querySelector('.status').textContent).toBe('매진(대기 가능)');
    expect(card('겨울 실내악 시리즈 「현의 대화」').querySelector('.status').textContent).toBe('예매 중');
  });

  it('카드는 상세 주소로 연결되고 가격과 기간이 보입니다', async () => {
    await open();
    const card = el.querySelector('.grid .card');
    expect(card.getAttribute('href')).toBe('#/programs/p1');
    expect(card.querySelector('.c-price').textContent).toBe('20,000원부터');
    expect(card.querySelector('.c-meta').textContent).toBe('2026.12.03 - 12.04 소극장');
    const course = [...el.querySelectorAll('.grid .card')].find((c) => c.querySelector('.type').textContent === '정규 강좌');
    expect(course.querySelector('.c-price').textContent).toBe('120,000원');
  });

  it('대상 필터로 걸러집니다', async () => {
    await open();
    const select = el.querySelector('#target');
    select.value = '중학생 이상';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(el.querySelectorAll('.grid .card')).toHaveLength(1);
  });

  it('조건에 맞는 프로그램이 없으면 안내 문구를 보입니다', async () => {
    await open();
    const month = el.querySelector('#month');
    const target = el.querySelector('#target');
    target.value = '중학생 이상';
    target.dispatchEvent(new Event('change', { bubbles: true }));
    [...el.querySelectorAll('.seg button')].find((b) => b.textContent === '체험').click();
    expect(el.querySelectorAll('.grid .card')).toHaveLength(0);
    expect(el.querySelector('.empty-state').textContent).toContain('조건에 맞는 프로그램이 없습니다');
    expect(month).not.toBeNull();
  });

  it('데이터 로딩에 실패하면 원인과 다음 행동을 안내합니다', async () => {
    const api = fakeApi({ listPrograms: vi.fn().mockRejectedValue(new Error('x')) });
    await open(new URLSearchParams(), api);
    expect(el.querySelector('[role="alert"]').textContent).toContain('다시 시도');
    expect(el.querySelector('.grid')).toBeNull();
  });

  it('카드 제목은 HTML 로 해석되지 않습니다', async () => {
    const data = fixture();
    data[0].title = '<img src=x onerror=alert(1)>';
    await open(new URLSearchParams(), fakeApi({ listPrograms: vi.fn().mockResolvedValue(data) }));
    expect(el.querySelector('.grid .card h3 img')).toBeNull();
  });
});

describe('프로그램 상세', () => {
  let el;
  beforeEach(() => {
    el = document.createElement('main');
    document.body.replaceChildren(el);
  });

  async function open(id, api = fakeApi()) {
    await renderProgramDetail(el, { api, id, now: () => NOW });
    await flush();
    return api;
  }

  it('제목, 장소, 대상, 가격이 나옵니다', async () => {
    await open('p1');
    expect(el.querySelector('h1').textContent).toBe('겨울 실내악 시리즈 「현의 대화」');
    const spec = el.querySelector('.spec').textContent;
    expect(spec).toContain('한빛아트센터 소극장');
    expect(spec).toContain('성인');
    expect(spec).toContain('R석40,000원');
    expect(spec).toContain('A석20,000원');
    expect(el.querySelector('.d-poster .poster')).not.toBeNull();
  });

  it('회차별 잔여석을 보여 주고 첫 판매 중 회차가 선택됩니다', async () => {
    const api = await open('p1');
    expect(api.remainingCapacity).toHaveBeenCalledWith('o1');
    const slots = el.querySelectorAll('.slot');
    expect(slots.length).toBeGreaterThanOrEqual(1);
    expect(slots[0].getAttribute('aria-checked')).toBe('true');
    expect(slots[0].textContent).toContain('잔여 12석');
  });

  it('좌석 선택 버튼은 선택한 회차의 예매 주소로 갑니다', async () => {
    await open('p1');
    const cta = el.querySelector('.cta-row.desktop a.btn-primary');
    expect(cta.textContent).toBe('좌석 선택');
    expect(cta.getAttribute('href')).toBe('#/booking/o1/select');
    expect(el.querySelector('.mobile-bar a.btn-primary').getAttribute('href')).toBe('#/booking/o1/select');
  });

  it('다른 날짜를 고르면 그 날의 회차가 나오고 주소가 바뀝니다', async () => {
    await open('p1');
    const dates = el.querySelectorAll('.date');
    expect(dates).toHaveLength(2);
    dates[1].click();
    expect(dates[1].getAttribute('aria-pressed')).toBe('true');
    el.querySelector('.slot').click();
    expect(el.querySelector('.cta-row.desktop a.btn-primary').getAttribute('href')).toBe('#/booking/o2/select');
  });

  it('매진 회차는 글자로 매진(대기 가능)을 알리고 대기 신청으로 안내합니다', async () => {
    await open('p2');
    const slot = el.querySelector('.slot');
    expect(slot.textContent).toContain('매진(대기 가능)');
    expect(el.querySelector('.cta-row.desktop a.btn-primary').textContent).toBe('대기 신청');
  });

  it('판매 전 회차는 버튼이 비활성이고 이유가 글자로 나옵니다', async () => {
    await open('p4');
    const btn = el.querySelector('.cta-row.desktop .btn-primary');
    expect(btn.hasAttribute('disabled')).toBe(true);
    expect(btn.textContent).toBe('예매 예정');
    expect(el.querySelector('.slot').textContent).toContain('예매 예정');
  });

  it('정규 강좌는 12회 일정을 모두 보여 줍니다', async () => {
    await open('p5');
    const rows = el.querySelectorAll('.lesson-list li');
    expect(rows).toHaveLength(12);
    expect(rows[0].textContent).toContain('1회');
    expect(rows[11].textContent).toContain('12회');
    expect(el.querySelector('.cta-row.desktop a.btn-primary').textContent).toBe('수강 신청');
  });

  it('취소 규정 표에 구간별 수수료와 환불액이 나옵니다', async () => {
    await open('p1');
    const rows = [...el.querySelectorAll('#refund .tbl tbody tr')].map((tr) => texts(tr.children));
    expect(rows).toEqual([
      ['관람일 8일 전까지', '없음', '40,000원'],
      ['관람일 7일 전 - 4일 전', '결제액의 10%', '36,000원'],
      ['관람일 3일 전 - 1일 전', '결제액의 30%', '28,000원'],
      ['관람 당일', '취소 불가', '-'],
    ]);
  });

  it('소개, 프로그램, 출연, 안내 구역과 탭이 있습니다', async () => {
    await open('p1');
    expect(texts(el.querySelectorAll('.tabs a'))).toEqual(['공연 소개', '프로그램', '출연', '취소/환불 규정', '관람 안내']);
    expect(el.querySelector('#intro').textContent).toContain('소개 문단입니다.');
    expect(el.querySelector('#cast').textContent).toContain('한지민');
  });

  it('출연 정보가 없으면 출연 탭도 없습니다', async () => {
    await open('p3');
    expect(texts(el.querySelectorAll('.tabs a'))).not.toContain('출연');
  });

  it('없는 프로그램은 안내 화면을 보입니다', async () => {
    await open('nope');
    expect(el.querySelector('h1').textContent).toBe('프로그램을 찾을 수 없습니다.');
    expect(el.querySelector('a[href="#/programs"]')).not.toBeNull();
  });

  it('잔여석 조회가 실패해도 화면은 나오고 회차는 선택할 수 있습니다', async () => {
    await open('p1', fakeApi({ remainingCapacity: vi.fn().mockRejectedValue(new Error('x')) }));
    expect(el.querySelector('.slot')).not.toBeNull();
    expect(el.querySelector('.cta-row.desktop a.btn-primary')).not.toBeNull();
  });
});

describe('cancellationRows', () => {
  it('공연과 체험은 관람일 기준 4구간', () => {
    const rows = cancellationRows('EXPERIENCE', 10000);
    expect(rows.map((r) => [r.when, r.fee, r.refund])).toEqual([
      ['체험일 8일 전까지', '없음', '10,000원'],
      ['체험일 7일 전 - 4일 전', '결제액의 10%', '9,000원'],
      ['체험일 3일 전 - 1일 전', '결제액의 30%', '7,000원'],
      ['체험 당일', '취소 불가', '-'],
    ]);
  });

  it('정규 강좌는 개강 전 3구간에 개강 후 규정이 더해집니다', () => {
    const rows = cancellationRows('COURSE', 120000, 12);
    expect(rows.map((r) => [r.when, r.fee, r.refund])).toEqual([
      ['개강일 8일 전까지', '없음', '120,000원'],
      ['개강일 7일 전 - 4일 전', '결제액의 10%', '108,000원'],
      ['개강일 3일 전 - 1일 전', '결제액의 30%', '84,000원'],
      ['개강 당일', '취소 불가', '-'],
      ['1회 - 3회 진행 후', '결제액의 1/3', '80,000원'],
      ['4회 - 5회 진행 후', '결제액의 1/2', '60,000원'],
      ['6회 이후', '환불 불가', '0원'],
    ]);
  });
});

describe('메인 화면 다듬기(15A)', () => {
  let el;
  beforeEach(() => {
    el = document.createElement('main');
    document.body.replaceChildren(el);
  });
  const open = (q = '') => renderPrograms(el, { api: fakeApi(), query: new URLSearchParams(q), now: () => NOW });

  it('주소의 month, target 값(GNB 2depth)으로 처음부터 걸러집니다', async () => {
    await open(`type=EXPERIENCE&target=${encodeURIComponent('초등학생 동반 가족')}`);
    expect(el.querySelector('#target').value).toBe('초등학생 동반 가족');
    expect(texts(el.querySelectorAll('.grid .card h3'))).toEqual(['가족 도자기 공방']);
    await open('type=PERFORMANCE&month=2026-12');
    expect(el.querySelector('#month').value).toBe('2026-12');
    expect(el.querySelectorAll('.grid .card')).toHaveLength(2);
  });

  it('목록에 없는 달이면 그 달을 선택지에 넣고 빈 상태와 조건 초기화를 보입니다', async () => {
    await open('type=PERFORMANCE&month=2027-06');
    expect(el.querySelector('#month').value).toBe('2027-06');
    expect(el.querySelector('#month option[value="2027-06"]').textContent).toBe('2027년 6월');
    const reset = el.querySelector('.empty-state button');
    expect(reset.textContent).toBe('조건 초기화');
    reset.click();
    expect(el.querySelectorAll('.grid .card')).toHaveLength(6);
  });

  it('모르는 대상 값은 무시합니다', async () => {
    await open('target=없는대상');
    expect(el.querySelector('#target').value).toBe('');
    expect(el.querySelectorAll('.grid .card')).toHaveLength(6);
  });

  it('제목 위 작은 라벨과 바로가기 화살표가 없고, 내 예약 바로가기는 새 주소로 갑니다', async () => {
    await open();
    expect(el.querySelector('.eyebrow')).toBeNull();
    expect(el.querySelector('.quick svg')).toBeNull();
    expect([...el.querySelectorAll('.quick a')].map((a) => a.getAttribute('href'))).toContain('#/me/bookings');
  });

  it('공지 날짜는 0을 채운 점 형식이고 오늘보다 늦지 않습니다', async () => {
    await open();
    const times = [...el.querySelectorAll('.notice-strip time')];
    expect(times.length).toBeGreaterThan(0);
    for (const t of times) {
      expect(t.textContent).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
      expect(t.dateTime <= '2026-11-23').toBe(true);
    }
  });
});
