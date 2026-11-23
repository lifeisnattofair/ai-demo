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
 * @param {{title:string, message:string, detail?:string, confirmLabel?:string, cancelLabel?:string, danger?:boolean}} opts
 * @returns {Promise<boolean>} 확인하면 true, 닫거나 취소하면 false
 */
export function confirmDialog({ title, message, detail, confirmLabel = '확인', cancelLabel = '닫기', danger = false }) {
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
    desc.append(node('p', null, message));
    if (detail) desc.append(node('p', 'dialog-detail', detail));

    const actions = node('div', 'dialog-actions');
    const cancel = node('button', 'btn btn-secondary', cancelLabel);
    cancel.type = 'button';
    const ok = node('button', `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`, confirmLabel);
    ok.type = 'button';
    actions.append(cancel, ok);
    box.append(h, desc, actions);
    backdrop.append(box);

    let closed = false;
    function close(result) {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      document.body.classList.remove('dialog-open');
      if (opener && typeof opener.focus === 'function' && opener.isConnected) opener.focus();
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
    cancel.focus();
  });
}
