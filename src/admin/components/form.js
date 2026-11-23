// 등록/수정 화면의 라벨/입력 격자 한 줄과 검사 메시지 처리
import { escapeHtml } from '../../lib/format.js';

/**
 * @param {{label:string, name:string, field:string, required?:boolean, hint?:string, group?:boolean}} o
 *   group: 라디오 묶음처럼 for 로 이을 입력이 하나가 아닐 때(라벨 id 는 lbl-{name})
 */
export function formRow({ label, name, field, required = false, hint, group = false }) {
  const req = required ? '<span class="req" aria-hidden="true">*</span><span class="sr-only">(필수)</span>' : '';
  const lbl = group
    ? `<span class="fl" id="lbl-${name}">${escapeHtml(label)}${req}</span>`
    : `<label class="fl" id="lbl-${name}" for="f-${name}">${escapeHtml(label)}${req}</label>`;
  return `${lbl}<div class="ff" data-field="${name}">${field}`
    + `${hint ? `<p class="hint" id="h-${name}">${escapeHtml(hint)}</p>` : ''}<p class="err" id="e-${name}" hidden></p></div>`;
}

export function readForm(form, names) {
  const out = {};
  for (const n of names) out[n] = String(form.elements[n]?.value ?? '').trim();
  return out;
}

// 필드별 오류를 표시하고 첫 오류 칸으로 초점을 옮깁니다. 오류가 있으면 true.
export function showErrors(form, errs) {
  let first = null;
  for (const cell of form.querySelectorAll('.ff[data-field]')) {
    const name = cell.dataset.field;
    const msg = errs[name];
    const err = cell.querySelector('.err');
    err.hidden = !msg;
    err.textContent = msg ?? '';
    for (const input of cell.querySelectorAll('input, select, textarea')) {
      const described = [cell.querySelector('.hint')?.id, msg ? err.id : null].filter(Boolean).join(' ');
      if (described) input.setAttribute('aria-describedby', described);
      else input.removeAttribute('aria-describedby');
      if (msg) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    if (msg && !first) first = cell.querySelector('input:not([disabled]), select, textarea');
  }
  first?.focus();
  return Boolean(first) || Object.values(errs).some(Boolean);
}

// 화면 위 알림(오류는 alert, 완료는 status). 초점을 옮겨 낭독기가 읽게 합니다.
export function alertBox(host, message, tone = 'err') {
  const box = document.createElement('p');
  box.className = `form-alert${tone === 'ok' ? ' ok' : ''}`;
  box.setAttribute('role', tone === 'ok' ? 'status' : 'alert');
  box.tabIndex = -1;
  box.textContent = message;
  host.replaceChildren(box);
  box.focus();
}
