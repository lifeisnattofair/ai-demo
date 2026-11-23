// 조회 조건 상자: 라벨/입력 격자와 「초기화」 「조회」 버튼(설계 5-9, design/mockups/admin-bookings.html).
import { escapeHtml } from '../../lib/format.js';

let seq = 0;

/**
 * @typedef {{name:string, label:string, type:'text'|'select'|'date-range'|'checks', options?:{value:string,label:string}[],
 *   value?:any, placeholder?:string, wide?:boolean}} SearchField
 *   - date-range: value = {from, to} ('YYYY-MM-DD'), 이름은 `${name}From`, `${name}To` 로 돌려줍니다.
 *   - checks: value = 선택된 값 배열
 * @param {HTMLElement} el
 * @param {SearchField[]} fields
 * @param {(values:Object)=>void} onSearch
 * @returns {{values:()=>Object, set:(values:Object)=>void, reset:()=>void}}
 */
export function renderSearchBox(el, fields, onSearch) {
  const uid = `sb${++seq}`;
  const cell = (f) => {
    const id = `${uid}-${f.name}`;
    const slc = f.wide ? 'sl start' : 'sl';
    const opts = (f.options ?? []).map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
    switch (f.type) {
      case 'select':
        return `<label class="${slc}" for="${id}">${escapeHtml(f.label)}</label><div class="sf${f.wide ? ' wide' : ''}"><select class="ctl grow" id="${id}" name="${f.name}">${opts}</select></div>`;
      case 'date-range':
        return `<label class="${slc}" for="${id}">${escapeHtml(f.label)}</label><div class="sf${f.wide ? ' wide' : ''}">`
          + `<input class="ctl date" type="date" id="${id}" name="${f.name}From"><span aria-hidden="true">-</span>`
          + `<label class="sr-only" for="${id}-to">${escapeHtml(f.label)} 종료</label><input class="ctl date" type="date" id="${id}-to" name="${f.name}To"></div>`;
      case 'checks':
        return `<span class="${slc}" id="${id}">${escapeHtml(f.label)}</span><div class="sf${f.wide ? ' wide' : ''}" role="group" aria-labelledby="${id}">`
          + (f.options ?? []).map((o) => `<label class="chk"><input type="checkbox" name="${f.name}" value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</label>`).join('')
          + '</div>';
      default:
        return `<label class="${slc}" for="${id}">${escapeHtml(f.label)}</label><div class="sf${f.wide ? ' wide' : ''}"><input class="ctl grow" id="${id}" name="${f.name}" type="search" placeholder="${escapeHtml(f.placeholder ?? '')}" autocomplete="off"></div>`;
    }
  };

  el.innerHTML = `<form class="search-box" aria-label="조회 조건" novalidate>
      <div class="search-grid">${fields.map(cell).join('')}</div>
      <div class="search-actions"><button class="btn" type="button" data-act="reset">초기화</button><button class="btn btn-dark" type="submit">조회</button></div>
    </form>`;
  const form = el.querySelector('form');

  function set(values) {
    for (const f of fields) {
      const v = values?.[f.name];
      if (f.type === 'date-range') {
        form.elements[`${f.name}From`].value = v?.from ?? '';
        form.elements[`${f.name}To`].value = v?.to ?? '';
      } else if (f.type === 'checks') {
        const on = new Set(v ?? []);
        for (const c of form.querySelectorAll(`input[name="${f.name}"]`)) c.checked = on.has(c.value);
      } else {
        form.elements[f.name].value = v ?? (f.type === 'select' ? (f.options?.[0]?.value ?? '') : '');
      }
    }
  }

  function values() {
    const out = {};
    for (const f of fields) {
      if (f.type === 'date-range') {
        out[`${f.name}From`] = form.elements[`${f.name}From`].value;
        out[`${f.name}To`] = form.elements[`${f.name}To`].value;
      } else if (f.type === 'checks') {
        out[f.name] = [...form.querySelectorAll(`input[name="${f.name}"]:checked`)].map((c) => c.value);
      } else {
        out[f.name] = form.elements[f.name].value.trim();
      }
    }
    return out;
  }

  const initial = Object.fromEntries(fields.map((f) => [f.name, f.value]));
  set(initial);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    onSearch(values());
  });
  form.querySelector('[data-act="reset"]').addEventListener('click', () => {
    set(initial);
    onSearch(values());
  });

  return { values, set, reset: () => set(initial) };
}
