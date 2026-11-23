// 좌석 배치도. 마크업과 클래스는 설계 확정본(user-seat.html)의 .hall 과 같습니다.
// 좌석은 버튼이며 방향키로 옮겨 다닙니다(Tab 은 배치도 안에서 한 곳에만 멈춥니다).
import { messageFor } from '../../lib/api.js';

export const GRADE_NAME = { R: 'R석', S: 'S석', A: 'A석' };

export function statusOf(statusById, id) {
  const s = statusById instanceof Map ? statusById.get(id) : statusById?.[id];
  return s ?? 'AVAILABLE';
}

/** 'selected' | 'available' | 'unavailable' */
export function seatState(seat, statusById, selected) {
  if (selected.has(seat.id)) return 'selected';
  return statusOf(statusById, seat.id) === 'AVAILABLE' ? 'available' : 'unavailable';
}

const STATE_TEXT = { selected: '선택됨', available: '선택 가능', unavailable: '선택할 수 없음' };

export function seatName(seat) {
  return `${seat.row_label}열 ${seat.seat_no}번 ${GRADE_NAME[seat.grade] ?? seat.grade}`;
}

export function seatLabel(seat, state) {
  return `${seatName(seat)} ${STATE_TEXT[state]}`;
}

/**
 * 선택을 바꿉니다. 선택할 수 없는 좌석이거나 한도를 넘기면 바꾸지 않습니다.
 * @returns {'toggled'|'blocked'|'limit'}
 */
export function toggleSeat(seat, ctx) {
  const state = seatState(seat, ctx.statusById, ctx.selected);
  if (state === 'unavailable') return 'blocked';
  if (state === 'selected') {
    ctx.selected.delete(seat.id);
    return 'toggled';
  }
  if (ctx.selected.size >= ctx.max) return 'limit';
  ctx.selected.add(seat.id);
  return 'toggled';
}

/** 한도 안내를 el 맨 앞에 보여 주거나(message 있음) 지웁니다. */
export function showSeatMessage(el, message) {
  let box = el.querySelector(':scope > .seat-msg');
  if (!message) {
    box?.remove();
    return;
  }
  if (!box) {
    box = document.createElement('p');
    box.className = 'form-error seat-msg';
    box.setAttribute('role', 'alert');
    el.prepend(box);
  }
  box.textContent = message;
}

export function groupByRow(seats) {
  const rows = new Map();
  for (const s of seats) {
    if (!rows.has(s.row_label)) rows.set(s.row_label, []);
    rows.get(s.row_label).push(s);
  }
  return [...rows.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([label, list]) => [label, list.sort((a, b) => a.seat_no - b.seat_no)]);
}

function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * @param {HTMLElement} el
 * @param {{seats:{id:number,row_label:string,seat_no:number,grade:string}[], statusById:object|Map, selected:Set<number>, max:number}} state
 * @param {(seat:object, isSelected:boolean) => void} onToggle 선택이 실제로 바뀐 뒤 호출
 * @returns {{update:(patch:object)=>void, focusFirst:()=>void}}
 */
export function renderSeatMap(el, state, onToggle) {
  const st = { ...state };
  const buttons = new Map(); // seat.id -> button
  const grid = []; // 열별 버튼 배열(방향키 이동용)
  const bySeat = new Map(state.seats.map((s) => [s.id, s]));

  const hall = node('div', 'hall');
  hall.append(node('div', 'stage', 'STAGE'));
  const scroller = node('div', 'hall-scroll');
  const rowsBox = node('div', 'rows');
  scroller.append(rowsBox);
  hall.append(scroller, node('p', 'scroll-hint', '좌석도는 좌우로 밀어서 볼 수 있습니다.'));
  const foot = node('div', 'hall-foot');
  foot.append(node('span', '', '출입구'), node('span', '', '출입구'));
  hall.append(foot);

  for (const [label, list] of groupByRow(st.seats)) {
    const row = node('div', 'row');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `${label}열`);
    const lead = node('span', 'lbl', label);
    lead.setAttribute('aria-hidden', 'true');
    row.append(lead);
    const line = [];
    list.forEach((seat, i) => {
      // 4 + 12 + 4 블록 사이의 통로
      if (list.length === 20 && (i === 4 || i === 16)) row.append(node('span', 'gap'));
      const b = node('button', `seat ${seat.grade.toLowerCase()}`);
      b.type = 'button';
      b.dataset.seatId = String(seat.id);
      b.tabIndex = -1;
      buttons.set(seat.id, b);
      line.push(b);
      row.append(b);
    });
    const tail = node('span', 'lbl', label);
    tail.setAttribute('aria-hidden', 'true');
    row.append(tail);
    grid.push(line);
    rowsBox.append(row);
  }

  el.replaceChildren(hall);

  function paint() {
    for (const [id, b] of buttons) {
      const seat = bySeat.get(id);
      const s = seatState(seat, st.statusById, st.selected);
      b.classList.toggle('sel', s === 'selected');
      b.classList.toggle('sold', s === 'unavailable');
      b.setAttribute('aria-label', seatLabel(seat, s));
      if (s === 'unavailable') b.setAttribute('aria-disabled', 'true');
      else b.removeAttribute('aria-disabled');
      if (s === 'unavailable') b.removeAttribute('aria-pressed');
      else b.setAttribute('aria-pressed', String(s === 'selected'));
    }
  }

  // Tab 이 멈추는 좌석 하나. 선택한 좌석이 있으면 그 좌석, 없으면 선택 가능한 첫 좌석입니다.
  let tabStop = null;
  function setTabStop(b) {
    if (tabStop === b) return;
    if (tabStop) tabStop.tabIndex = -1;
    tabStop = b;
    if (b) b.tabIndex = 0;
  }
  function initialTabStop() {
    const all = grid.flat();
    return all.find((b) => b.classList.contains('sel'))
      ?? all.find((b) => !b.hasAttribute('aria-disabled'))
      ?? all[0] ?? null;
  }

  function activate(seat) {
    const result = toggleSeat(seat, st);
    if (result === 'limit') {
      showSeatMessage(el, messageFor('LIMIT_EXCEEDED'));
      return;
    }
    if (result === 'blocked') return;
    showSeatMessage(el, '');
    paint();
    onToggle?.(seat, st.selected.has(seat.id));
  }

  function locate(b) {
    for (let r = 0; r < grid.length; r += 1) {
      const c = grid[r].indexOf(b);
      if (c !== -1) return [r, c];
    }
    return [-1, -1];
  }

  function move(b, dr, dc) {
    const [r, c] = locate(b);
    if (r === -1) return;
    const nr = Math.min(grid.length - 1, Math.max(0, r + dr));
    const nc = Math.min(grid[nr].length - 1, Math.max(0, c + dc));
    const target = grid[nr][nc];
    setTabStop(target);
    target.focus();
  }

  rowsBox.addEventListener('click', (e) => {
    const b = e.target.closest('button.seat');
    if (!b) return;
    setTabStop(b);
    activate(bySeat.get(Number(b.dataset.seatId)));
  });

  rowsBox.addEventListener('keydown', (e) => {
    const b = e.target.closest('button.seat');
    if (!b) return;
    const [r, c] = locate(b);
    const last = (grid[r]?.length ?? 1) - 1;
    const steps = {
      ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0],
      Home: [0, -c], End: [0, last - c],
    };
    if (steps[e.key]) {
      e.preventDefault();
      move(b, ...steps[e.key]);
    } else if (e.key === ' ' || e.key === 'Enter') {
      // 직접 처리하고 브라우저의 click 합성은 막아 두 번 바뀌지 않게 합니다.
      e.preventDefault();
      activate(bySeat.get(Number(b.dataset.seatId)));
    }
  });
  rowsBox.addEventListener('keyup', (e) => {
    if (e.key === ' ' && e.target.closest('button.seat')) e.preventDefault();
  });

  paint();
  setTabStop(initialTabStop());

  // 좁은 화면에서는 무대 중앙이 먼저 보이게 합니다.
  const center = () => { scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2; };
  center();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(center);

  return {
    update(patch = {}) {
      Object.assign(st, patch);
      paint();
      if (!tabStop || tabStop.hasAttribute('aria-disabled')) setTabStop(initialTabStop());
    },
    message: (text) => showSeatMessage(el, text),
    focusFirst() {
      (tabStop ?? initialTabStop())?.focus();
    },
  };
}
