// 예매 단계 표시. 마크업과 클래스는 설계 확정본(user-seat.html)의 .steps 와 같습니다.
export const STEP_LABELS = ['회차 선택', '좌석/인원 선택', '할인 선택', '결제', '예매 완료'];

/**
 * @param {HTMLElement} el 비어 있는 <ol> 요소
 * @param {1|2|3|4|5} current 현재 단계
 */
export function bookingSteps(el, current) {
  el.classList.add('steps');
  el.setAttribute('aria-label', '예매 단계');
  const items = STEP_LABELS.map((label, i) => {
    const li = document.createElement('li');
    li.textContent = label;
    if (i + 1 < current) li.classList.add('done');
    if (i + 1 === current) li.setAttribute('aria-current', 'step');
    return li;
  });
  el.replaceChildren(...items);
}
