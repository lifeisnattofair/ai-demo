// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderSeatMap } from '../../src/user/components/seat-map.js';
import { renderSeatList } from '../../src/user/components/seat-list.js';
import { bookingSteps } from '../../src/user/components/booking-steps.js';
import { checkLimit } from '@policy/limits.js';

const LIMIT_MSG = '1인 예약 한도를 넘었습니다. 남은 매수 안에서 선택해 주세요.';

function hall() {
  const seats = [];
  let id = 1;
  for (const row of 'ABCDEFGHIJ') {
    for (let n = 1; n <= 20; n += 1) {
      seats.push({ id: id++, row_label: row, seat_no: n, grade: row <= 'D' ? 'R' : row <= 'G' ? 'S' : 'A' });
    }
  }
  return seats;
}
const idOf = (seats, row, no) => seats.find((s) => s.row_label === row && s.seat_no === no).id;
const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

let el;
let seats;
beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  el = document.getElementById('host');
  seats = hall();
});

describe('좌석 배치도', () => {
  it('좌석마다 열, 번호, 등급, 상태를 읽어 주는 버튼이 된다', () => {
    renderSeatMap(el, { seats, statusById: {}, selected: new Set(), max: 4 }, () => {});
    const b = el.querySelector('[aria-label="E열 7번 S석 선택 가능"]');
    expect(b).not.toBeNull();
    expect(b.tagName).toBe('BUTTON');
    expect(el.querySelectorAll('button.seat')).toHaveLength(200);
  });

  it('좌석에 포커스를 두고 오른쪽 방향키를 누르면 다음 좌석으로 초점이 옮겨진다', () => {
    renderSeatMap(el, { seats, statusById: {}, selected: new Set(), max: 4 }, () => {});
    const e7 = el.querySelector('[aria-label="E열 7번 S석 선택 가능"]');
    e7.focus();
    key(e7, 'ArrowRight');
    expect(document.activeElement.getAttribute('aria-label')).toBe('E열 8번 S석 선택 가능');
    key(document.activeElement, 'ArrowLeft');
    expect(document.activeElement.getAttribute('aria-label')).toBe('E열 7번 S석 선택 가능');
    key(document.activeElement, 'ArrowDown');
    expect(document.activeElement.getAttribute('aria-label')).toBe('F열 7번 S석 선택 가능');
    key(document.activeElement, 'ArrowUp');
    expect(document.activeElement.getAttribute('aria-label')).toBe('E열 7번 S석 선택 가능');
  });

  it('Tab 이 닿는 좌석은 한 곳뿐이다(이동은 방향키)', () => {
    renderSeatMap(el, { seats, statusById: {}, selected: new Set(), max: 4 }, () => {});
    expect(el.querySelectorAll('button.seat[tabindex="0"]')).toHaveLength(1);
  });

  it('Space 로 선택하고 다시 누르면 해제한다', () => {
    const selected = new Set();
    const onToggle = vi.fn();
    renderSeatMap(el, { seats, statusById: {}, selected, max: 4 }, onToggle);
    const b = el.querySelector('[aria-label="E열 7번 S석 선택 가능"]');
    b.focus();
    key(b, ' ');
    expect(selected.has(idOf(seats, 'E', 7))).toBe(true);
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.getAttribute('aria-label')).toBe('E열 7번 S석 선택됨');
    expect(onToggle).toHaveBeenCalledTimes(1);
    key(b, ' ');
    expect(selected.size).toBe(0);
    expect(b.getAttribute('aria-pressed')).toBe('false');
  });

  it('판매된 좌석은 aria-disabled 이고 선택되지 않는다', () => {
    const selected = new Set();
    const onToggle = vi.fn();
    const sold = idOf(seats, 'A', 3);
    renderSeatMap(el, { seats, statusById: { [sold]: 'SOLD' }, selected, max: 4 }, onToggle);
    const b = el.querySelector('[aria-label="A열 3번 R석 선택할 수 없음"]');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    b.click();
    key(b, ' ');
    expect(selected.size).toBe(0);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('선점 중인 좌석도 선택할 수 없다', () => {
    const selected = new Set();
    const held = idOf(seats, 'B', 2);
    renderSeatMap(el, { seats, statusById: { [held]: 'HELD' }, selected, max: 4 }, () => {});
    const b = el.querySelector('[aria-label="B열 2번 R석 선택할 수 없음"]');
    b.click();
    expect(selected.size).toBe(0);
  });

  it('한도 4매에 기존 1매가 있으면 4번째 선택 시 한도 안내를 보여 주고 선택하지 않는다', () => {
    const { remaining } = checkLimit({ productType: 'PERFORMANCE', existingQty: 1, requestedQty: 4 });
    expect(remaining).toBe(3);
    const selected = new Set();
    renderSeatMap(el, { seats, statusById: {}, selected, max: remaining }, () => {});
    for (const n of [1, 2, 3]) el.querySelector(`[aria-label="E열 ${n}번 S석 선택 가능"]`).click();
    expect(selected.size).toBe(3);
    expect(el.querySelector('[role="alert"]')).toBeNull();
    el.querySelector('[aria-label="E열 4번 S석 선택 가능"]').click();
    expect(selected.size).toBe(3);
    expect(el.querySelector('[role="alert"]').textContent).toBe(LIMIT_MSG);
  });

  it('update 로 판매 상태를 다시 반영한다', () => {
    const selected = new Set([idOf(seats, 'E', 7)]);
    const map = renderSeatMap(el, { seats, statusById: {}, selected, max: 4 }, () => {});
    selected.delete(idOf(seats, 'E', 7));
    map.update({ statusById: { [idOf(seats, 'E', 7)]: 'SOLD' } });
    const b = el.querySelector('button.seat[aria-label^="E열 7번"]');
    expect(b.getAttribute('aria-label')).toBe('E열 7번 S석 선택할 수 없음');
    expect(b.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('좌석 목록(대체 수단)', () => {
  it('열, 번호, 등급 표와 체크박스를 보여 주고 선택 상태를 공유한다', () => {
    const selected = new Set();
    const onToggle = vi.fn();
    renderSeatList(el, { seats, statusById: { [idOf(seats, 'A', 1)]: 'SOLD' }, selected, max: 2 }, onToggle);
    expect(el.querySelectorAll('tbody tr')).toHaveLength(200);
    const cb = el.querySelector('input[aria-label="E열 7번 S석 선택 가능"]');
    expect(cb.type).toBe('checkbox');
    cb.click();
    expect(selected.has(idOf(seats, 'E', 7))).toBe(true);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(el.querySelector('input[aria-label="A열 1번 R석 선택할 수 없음"]').disabled).toBe(true);
  });

  it('한도를 넘기면 체크가 되돌아가고 안내가 나온다', () => {
    const selected = new Set();
    renderSeatList(el, { seats, statusById: {}, selected, max: 1 }, () => {});
    el.querySelector('input[aria-label="E열 1번 S석 선택 가능"]').click();
    const second = el.querySelector('input[aria-label="E열 2번 S석 선택 가능"]');
    second.click();
    expect(second.checked).toBe(false);
    expect(selected.size).toBe(1);
    expect(el.querySelector('[role="alert"]').textContent).toBe(LIMIT_MSG);
  });
});

describe('예매 단계', () => {
  it('현재 단계에 aria-current 를 달고 앞 단계는 완료로 표시한다', () => {
    const ol = document.createElement('ol');
    bookingSteps(ol, 2);
    const items = [...ol.querySelectorAll('li')];
    expect(items.map((x) => x.textContent)).toEqual(['회차 선택', '좌석/인원 선택', '할인 선택', '결제', '예매 완료']);
    expect(items[0].classList.contains('done')).toBe(true);
    expect(items[1].getAttribute('aria-current')).toBe('step');
    expect(items[2].hasAttribute('aria-current')).toBe(false);
  });
});
