// 선점 남은 시간 표시. 화면 낭독기에는 분(60분 이상이면 시간)이 바뀔 때만 알립니다(초 단위 갱신은 읽지 않습니다).
export const EXPIRED_MESSAGE = '선점 시간이 지나 좌석이 해제되었습니다. 다시 선택해 주세요.';

const pad = (n) => String(n).padStart(2, '0');

/**
 * @param {HTMLElement} el 타이머를 그릴 요소(role="timer" 가 붙습니다)
 * @param {Date} expiresAt 선점 만료 시각(서버가 준 값)
 * @param {() => Date} now 현재 시각(화면용 보정 시계)
 * @param {() => void} onExpire 만료 시 한 번만 호출
 * @returns {() => void} 타이머를 멈추는 함수
 */
export function startHoldTimer(el, expiresAt, now, onExpire) {
  el.setAttribute('role', 'timer');
  el.setAttribute('aria-live', 'off');
  el.classList.remove('expired');

  const label = document.createElement('span');
  label.textContent = '남은 선점 시간';
  const clock = document.createElement('b');
  clock.className = 'num';
  clock.setAttribute('aria-hidden', 'true');
  const live = document.createElement('span');
  live.className = 'sr-only';
  live.setAttribute('aria-live', 'polite');
  el.replaceChildren(label, document.createTextNode(' '), clock, live);

  let timerId = null;
  let done = false;
  let lastSpoken = null;

  function stop() {
    done = true;
    if (timerId != null) clearInterval(timerId);
    timerId = null;
    document.removeEventListener('visibilitychange', tick);
  }

  function expire() {
    stop();
    el.classList.add('expired');
    el.removeAttribute('aria-live');
    const msg = document.createElement('span');
    msg.setAttribute('role', 'status');
    msg.textContent = EXPIRED_MESSAGE;
    el.replaceChildren(msg);
    onExpire?.();
  }

  function tick() {
    if (done) return;
    // 화면이 바뀌어 요소가 떨어져 나갔으면 더 돌지 않습니다.
    if (!el.isConnected && timerId != null) {
      stop();
      return;
    }
    const left = Math.ceil((expiresAt.getTime() - now().getTime()) / 1000);
    if (left <= 0) {
      expire();
      return;
    }
    // 60분 이상(대기 승격 결제의 24시간 선점)은 「23시간 59분」처럼, 60분 미만은 mm:ss 로 보입니다(QA D-12).
    const long = left >= 3600;
    clock.textContent = long
      ? `${Math.floor(left / 3600)}시간 ${pad(Math.floor((left % 3600) / 60))}분`
      : `${pad(Math.floor(left / 60))}:${pad(left % 60)}`;
    const spoken = long ? `${Math.ceil(left / 3600)}시간 이내` : `${Math.ceil(left / 60)}분 이내`;
    if (spoken !== lastSpoken) {
      lastSpoken = spoken;
      live.textContent = `남은 선점 시간 ${spoken}`;
    }
  }

  tick();
  if (!done) {
    timerId = setInterval(tick, 1000);
    // 탭이 백그라운드에서 멈춰 있다가 돌아오면 바로 맞춥니다.
    document.addEventListener('visibilitychange', tick);
  }
  return stop;
}
