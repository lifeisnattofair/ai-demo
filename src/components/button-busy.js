// 요청 처리 중 버튼 상태(사용자, 관리자 공용): 스피너와 「처리 중」 문구를 보이고 중복 클릭을 막습니다.
// 스타일은 src/styles/motion.css 의 .btn[data-busy] 와 .spinner 입니다.

// 이미 처리 중일 때 돌려주는 약속. 끝나지 않으므로 `await withBusy(...)` 뒤의 처리(다시 그리기 등)가 두 번 돌지 않습니다.
const NEVER = new Promise(() => {});

/** 처리 중인 버튼인지. 확인 대화상자를 여는 처리처럼 withBusy 앞에서 막아야 할 때 씁니다. */
export function isBusy(button) {
  return button?.dataset?.busy === 'true';
}

/**
 * @param {HTMLElement} button
 * @param {() => Promise<any>} promiseFn 처리 함수. 끝나면(성공이든 실패든) 버튼이 원래대로 돌아옵니다.
 * @returns {Promise<any>} promiseFn 의 결과. 이미 처리 중이면 끝나지 않는 약속을 돌려줘 뒤따르는 처리를 멈춥니다.
 */
export async function withBusy(button, promiseFn) {
  if (isBusy(button)) return NEVER;
  const original = [...button.childNodes];
  const wasDisabled = button.getAttribute('aria-disabled');
  const width = button.offsetWidth;
  button.dataset.busy = 'true';
  button.setAttribute('aria-busy', 'true');
  button.setAttribute('aria-disabled', 'true');
  // 문구가 짧아져도 버튼 너비를 유지해 옆 요소가 움직이지 않게 합니다.
  if (width) button.style.minWidth = `${width}px`;

  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  spinner.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = '처리 중';
  button.replaceChildren(spinner, label);

  try {
    return await promiseFn();
  } finally {
    delete button.dataset.busy;
    button.removeAttribute('aria-busy');
    if (wasDisabled == null) button.removeAttribute('aria-disabled');
    else button.setAttribute('aria-disabled', wasDisabled);
    button.style.minWidth = '';
    button.replaceChildren(...original);
  }
}
