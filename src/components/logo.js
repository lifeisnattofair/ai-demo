// 한빛아트센터 기호: 무대 입구(아치)와 그 안에 선 한 사람(점). 검정 한 색, 글자색(currentColor)을 따릅니다.
// viewBox를 도형 끝에 맞춰 두어, CSS에서 높이를 글자 실측 높이(0.9em)로 주면 글자 윗선, 아랫선과 정확히 맞습니다.
export const LOGO_PATH = 'M3 38V18a17 17 0 0 1 34 0v20h-8V18.5a9 9 0 0 0-18 0V38z';

export function logoMark(cls = 'logo-mark') {
  return `<svg class="${cls}" viewBox="3 1 34 37" aria-hidden="true" focusable="false">`
    + `<path fill="currentColor" d="${LOGO_PATH}"/><circle cx="20" cy="31" r="3.6" fill="currentColor"/></svg>`;
}
