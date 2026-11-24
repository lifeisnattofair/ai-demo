// 확인 대화상자(모달). window.confirm 대신 씁니다.
// 제목과 설명이 연결되고(aria-labelledby/aria-describedby), 초점이 대화상자 안에서만 돌며, Esc 와 바깥 클릭으로 닫힙니다.
// 닫으면 열기 전의 초점 위치로 돌아갑니다. 스타일은 .dialog (src/styles/mypage.css).

let seq = 0;

function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * @param {{title:string, message:string|string[], detail?:string, rows?:Array<[string,string]>, confirmLabel?:string, cancelLabel?:string|null, danger?:boolean, returnFocus?:HTMLElement|(() => HTMLElement|null)}} opts
 *   rows 는 이름/값 목록(dl)으로 보입니다. cancelLabel 이 null 이면 확인 버튼 하나만 둡니다(정보 보기).
 *   returnFocus 는 닫은 뒤 초점을 돌려줄 요소입니다(열기 전 초점 위치보다 먼저 씁니다). 대화상자를 연 버튼을 넘깁니다.
 * @returns {Promise<boolean>} 확인하면 true, 닫거나 취소하면 false
 */
export function confirmDialog({ title, message, detail, rows, confirmLabel = '확인', cancelLabel = '닫기', danger = false, returnFocus = null }) {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const id = `dlg-${++seq}`;

    const backdrop = node('div', 'dialog-backdrop');
    const box = node('div', 'dialog');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', `${id}-title`);
    box.setAttribute('aria-describedby', `${id}-desc`);
    box.tabIndex = -1;

    const h = node('h2', 'dialog-title', title);
    h.id = `${id}-title`;
    const desc = node('div', 'dialog-body');
    desc.id = `${id}-desc`;
    // message 가 배열이면 문단마다 나눠 보입니다(약관 본문 등).
    for (const m of [].concat(message)) desc.append(node('p', null, m));
    if (rows?.length) {
      const dl = node('dl', 'dialog-rows');
      for (const [k, v] of rows) dl.append(node('dt', null, k), node('dd', null, v ?? '-'));
      desc.append(dl);
    }
    if (detail) desc.append(node('p', 'dialog-detail', detail));

    const actions = node('div', 'dialog-actions');
    const cancel = node('button', 'btn btn-secondary', cancelLabel);
    cancel.type = 'button';
    const ok = node('button', `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`, confirmLabel);
    ok.type = 'button';
    if (cancelLabel == null) actions.append(ok);
    else actions.append(cancel, ok);
    box.append(h, desc, actions);
    backdrop.append(box);

    let closed = false;
    function close(result) {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      document.body.classList.remove('dialog-open');
      const asked = typeof returnFocus === 'function' ? returnFocus() : returnFocus;
      const target = asked?.isConnected ? asked : opener;
      if (target && typeof target.focus === 'function' && target.isConnected) target.focus();
      resolve(result);
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...box.querySelectorAll(FOCUSABLE)];
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!box.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    cancel.addEventListener('click', () => close(false));
    ok.addEventListener('click', () => close(true));
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(false); });
    document.addEventListener('keydown', onKey, true);

    document.body.append(backdrop);
    document.body.classList.add('dialog-open');
    // 실수로 확정하지 않도록 처음 초점은 닫기 버튼에 둡니다.
    if (cancelLabel == null) ok.focus();
    else cancel.focus();
  });
}
