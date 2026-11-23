// 불러오는 동안 보여 주는 스켈레톤(사용자, 관리자 공용). 실제 화면 모양을 따라 그리고,
// 300ms 안에 끝나면 아무것도 그리지 않아 깜빡이지 않습니다. 요소에는 바로 aria-busy 를 두고,
// 모양이 나타날 때 화면 낭독용 「불러오는 중」 문구를 함께 넣습니다. 스타일은 src/styles/motion.css 의 .skeleton 입니다.

const rows = (n, make) => Array.from({ length: n }, make).join('');
const B = 'sk-block';

const table = () => `<div class="sk-grid"><div class="sk-th ${B}"></div>${rows(8, () => `<div class="sk-tr">${rows(6, () => `<i class="${B}"></i>`)}</div>`)}</div>`;

const KINDS = {
  // 목록 카드: 포스터와 두 줄
  cards: () => `<div class="sk-cards">${rows(6, () => `<div><div class="sk-poster ${B}"></div><div class="sk-line ${B}"></div><div class="sk-line short ${B}"></div></div>`)}</div>`,
  // 상세: 왼쪽 포스터, 오른쪽 제목과 정보 줄
  detail: () => `<div class="sk-detail"><div class="sk-poster ${B}"></div><div><div class="sk-title ${B}"></div><div class="sk-line short ${B}"></div>`
    + `${rows(5, () => `<div class="sk-line ${B}"></div>`)}<div class="sk-btn ${B}"></div></div></div>`,
  // 좌석 배치도: 무대와 10개 열
  'seat-map': () => `<div class="sk-stage ${B}"></div>${rows(10, () => `<div class="sk-row">${rows(20, () => `<i class="${B}"></i>`)}</div>`)}`,
  // 표: 머리글 띠와 열이 있는 행(관리자 목록 표)
  table,
  // 입력 양식, 요약 상자
  form: () => `<div class="sk-line short ${B}"></div>${rows(3, () => `<div class="sk-form-row ${B}"></div>`)}`,
  // 세로 목록(내 예약, 대기, 알림): 작은 썸네일과 세 줄
  list: () => rows(3, () => `<div class="sk-item"><div class="sk-thumb ${B}"></div><div><div class="sk-line short ${B}"></div><div class="sk-title ${B}"></div><div class="sk-line ${B}"></div></div></div>`),
  // 수치 카드 4개
  kpis: () => `<div class="sk-kpis">${rows(4, () => `<div class="${B}"></div>`)}</div>`,
  // 막대 그래프
  chart: () => `<div class="sk-chart">${rows(10, (_, i) => `<i class="${B}" style="height:${30 + ((i * 37) % 60)}%"></i>`)}</div>`,
};
// 예전 이름(Task 13 관리자 표)
KINDS['grid-table'] = table;

export const SKELETON_KINDS = Object.keys(KINDS);

const counts = new WeakMap();

/**
 * @param {HTMLElement} el 스켈레톤을 넣을 요소
 * @param {'cards'|'detail'|'seat-map'|'table'|'form'|'list'|'kpis'|'chart'} kind
 * @param {{delayMs?:number}} [opts]
 * @returns {() => void} 불러오기가 끝나면 부릅니다(타이머, 스켈레톤, aria-busy 정리). 여러 번 불러도 됩니다.
 */
export function showSkeleton(el, kind, { delayMs = 300 } = {}) {
  const make = KINDS[kind] ?? KINDS.table;
  let box = null;
  counts.set(el, (counts.get(el) ?? 0) + 1);
  el.setAttribute('aria-busy', 'true');

  const timer = setTimeout(() => {
    box = document.createElement('div');
    box.className = `skeleton sk-${KINDS[kind] ? kind : 'table'}`;
    const status = document.createElement('span');
    status.className = 'sr-only';
    status.textContent = '불러오는 중';
    const shape = document.createElement('div');
    shape.className = 'sk-shape';
    shape.setAttribute('aria-hidden', 'true');
    shape.innerHTML = make();
    box.append(status, shape);
    el.append(box);
  }, delayMs);

  let released = false;
  return function release() {
    if (released) return;
    released = true;
    clearTimeout(timer);
    box?.remove();
    const left = (counts.get(el) ?? 1) - 1;
    counts.set(el, left);
    if (left <= 0) el.removeAttribute('aria-busy');
  };
}
