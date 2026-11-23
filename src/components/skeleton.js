// 불러오는 동안 보여 주는 스켈레톤. 실제 화면 모양을 따라 그리고, 짧게 끝나면 깜빡이지 않도록 지연해서 보입니다.
// 화면 낭독기에는 aria-busy 와 「불러오는 중」 문구로 알립니다. 스타일은 .skeleton (src/styles/booking.css, 공용 정리는 15A).

const rows = (n, make) => Array.from({ length: n }, make).join('');

const KINDS = {
  // 좌석 배치도: 무대와 10개 열
  'seat-map': () => `<div class="sk-stage sk-block"></div>${rows(10, () => `<div class="sk-row">${rows(20, () => '<i class="sk-block"></i>')}</div>`)}`,
  cards: () => `<div class="sk-cards">${rows(6, () => '<div><div class="sk-poster sk-block"></div><div class="sk-line sk-block"></div><div class="sk-line short sk-block"></div></div>')}</div>`,
  detail: () => '<div class="sk-detail"><div class="sk-poster sk-block"></div><div><div class="sk-line sk-block"></div><div class="sk-line short sk-block"></div>'
    + `${rows(5, () => '<div class="sk-line sk-block"></div>')}</div></div>`,
  form: () => `<div class="sk-line sk-block"></div>${rows(3, () => '<div class="sk-form-row sk-block"></div>')}`,
  table: () => rows(8, () => '<div class="sk-line sk-block"></div>'),
  // 관리자 목록 표: 머리글 띠와 열이 있는 행
  'grid-table': () => `<div class="sk-grid"><div class="sk-th sk-block"></div>${rows(8, () => `<div class="sk-tr">${rows(6, () => '<i class="sk-block"></i>')}</div>`)}</div>`,
  // 관리자 대시보드 수치 카드
  kpis: () => `<div class="sk-kpis">${rows(4, () => '<div class="sk-block"></div>')}</div>`,
};

/**
 * @param {HTMLElement} el 스켈레톤을 넣을 요소
 * @param {'seat-map'|'cards'|'detail'|'table'|'form'|'grid-table'|'kpis'} kind
 * @param {{delayMs?:number}} [opts]
 * @returns {() => void} 불러오기가 끝나면 부릅니다(타이머, 스켈레톤, aria-busy 를 정리).
 */
export function showSkeleton(el, kind, { delayMs = 300 } = {}) {
  const box = document.createElement('div');
  box.className = `skeleton sk-${kind}`;
  const status = document.createElement('span');
  status.className = 'sr-only';
  status.setAttribute('role', 'status');
  status.textContent = '불러오는 중';
  const shape = document.createElement('div');
  shape.className = 'sk-shape';
  shape.setAttribute('aria-hidden', 'true');
  shape.hidden = true;
  shape.innerHTML = (KINDS[kind] ?? KINDS.table)();
  box.append(status, shape);

  el.setAttribute('aria-busy', 'true');
  el.append(box);
  const timer = setTimeout(() => { shape.hidden = false; }, delayMs);

  let released = false;
  return function release() {
    if (released) return;
    released = true;
    clearTimeout(timer);
    box.remove();
    el.removeAttribute('aria-busy');
  };
}
