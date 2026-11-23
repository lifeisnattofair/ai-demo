// 요청 처리 중 버튼 상태: 스피너와 「처리 중」 문구를 보이고 중복 클릭을 막습니다.
// 스타일은 .btn[data-busy] (src/styles/user.css) 를 씁니다.

/**
 * @param {HTMLElement} button
 * @param {() => Promise<any>} promiseFn 처리 함수. 끝나면(성공이든 실패든) 버튼이 원래대로 돌아옵니다.
 * @returns {Promise<any>} promiseFn 의 결과. 이미 처리 중이면 undefined 로 바로 끝납니다.
 */
export async function withBusy(button, promiseFn) {
  if (button.dataset.busy === 'true') return undefined;
  const original = [...button.childNodes];
  const wasDisabled = button.getAttribute('aria-disabled');
  button.dataset.busy = 'true';
  button.setAttribute('aria-busy', 'true');
  button.setAttribute('aria-disabled', 'true');

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
    button.replaceChildren(...original);
  }
}
