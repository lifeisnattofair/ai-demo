// 좌석 목록. 배치도를 쓰기 어려운 경우를 위한 대체 수단입니다(SFR-005).
// 열, 번호, 등급을 표로 보여 주고 체크박스로 고릅니다. 선택 상태는 배치도와 같은 Set 을 씁니다.
import { messageFor } from '../../lib/api.js';
import { GRADE_NAME, groupByRow, seatLabel, seatState, showSeatMessage, toggleSeat } from './seat-map.js';
import { won } from '../../lib/format.js';

function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * @param {HTMLElement} el
 * @param {{seats:object[], statusById:object|Map, selected:Set<number>, max:number, prices?:object}} state prices: {R:40000,...}
 * @param {(seat:object, isSelected:boolean) => void} onToggle
 */
export function renderSeatList(el, state, onToggle) {
  const st = { ...state };
  const boxes = new Map(); // seat.id -> {input, cell}
  const bySeat = new Map(state.seats.map((s) => [s.id, s]));

  const wrap = node('div', 'seat-list');
  wrap.tabIndex = -1;
  const table = node('table', 'tbl');
  table.append(node('caption', 'sr-only', '좌석 목록'));
  const head = node('tr');
  [['선택', ''], ['열', ''], ['번호', 'r'], ['등급', ''], ['가격', 'r'], ['상태', '']].forEach(([t, c]) => {
    const th = node('th', c, t);
    th.scope = 'col';
    head.append(th);
  });
  const thead = node('thead');
  thead.append(head);
  const body = node('tbody');
  table.append(thead, body);
  wrap.append(table);

  for (const [, list] of groupByRow(st.seats)) {
    for (const seat of list) {
      const tr = node('tr');
      const input = node('input');
      input.type = 'checkbox';
      input.dataset.seatId = String(seat.id);
      const pick = node('td');
      // 체크 상자 둘레까지 눌러지도록 44px 영역으로 감쌉니다.
      const hit = node('label', 'cb');
      hit.append(input);
      pick.append(hit);
      const status = node('td');
      tr.append(
        pick,
        node('td', '', `${seat.row_label}열`),
        node('td', 'r', String(seat.seat_no)),
        node('td', '', GRADE_NAME[seat.grade] ?? seat.grade),
        node('td', 'r', st.prices?.[seat.grade] != null ? won(st.prices[seat.grade]) : ''),
        status,
      );
      body.append(tr);
      boxes.set(seat.id, { input, status });
    }
  }
  el.replaceChildren(wrap);

  const STATUS_TEXT = { selected: '선택됨', available: '선택 가능', unavailable: '선택할 수 없음' };
  function paint() {
    for (const [id, { input, status }] of boxes) {
      const seat = bySeat.get(id);
      const s = seatState(seat, st.statusById, st.selected);
      input.checked = s === 'selected';
      input.disabled = s === 'unavailable';
      input.setAttribute('aria-label', seatLabel(seat, s));
      status.textContent = STATUS_TEXT[s];
    }
  }

  body.addEventListener('change', (e) => {
    const input = e.target.closest('input[type="checkbox"]');
    if (!input) return;
    const seat = bySeat.get(Number(input.dataset.seatId));
    const result = toggleSeat(seat, st);
    if (result === 'limit') {
      input.checked = false;
      showSeatMessage(el, messageFor('LIMIT_EXCEEDED'));
      return;
    }
    if (result === 'blocked') {
      input.checked = false;
      return;
    }
    showSeatMessage(el, '');
    paint();
    onToggle?.(seat, st.selected.has(seat.id));
  });

  paint();
  return {
    update(patch = {}) {
      Object.assign(st, patch);
      paint();
    },
    message: (text) => showSeatMessage(el, text),
  };
}
