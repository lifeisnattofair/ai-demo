// 조회 조건 상자: 라벨/입력 격자와 「초기화」 「조회」 버튼(설계 5-9, design/mockups/admin-bookings.html).
import { addDays, addMonths, escapeHtml } from '../../lib/format.js';

let seq = 0;

// 빠른 기간 버튼. 끝은 오늘, 시작은 그만큼 앞선 날입니다(양 끝 포함).
export const QUICK_RANGES = [
  { key: 'today', label: '오늘' },
  { key: '7d', label: '7일' },
  { key: '1m', label: '1개월' },
  { key: '3m', label: '3개월' },
];

export function quickRange(key, today) {
  switch (key) {
    case 'today': return { from: today, to: today };
    case '7d': return { from: addDays(today, -6), to: today };
    case '1m': return { from: addDays(addMonths(today, -1), 1), to: today };
    case '3m': return { from: addDays(addMonths(today, -3), 1), to: today };
    default: return null;
  }
}

/**
 * @typedef {{name:string, label:string, type:'text'|'select'|'date-range'|'checks', options?:{value:string,label:string}[],
 *   value?:any, placeholder?:string, wide?:boolean, today?:string, fieldOptions?:{value:string,label:string}[]}} SearchField
 *   - date-range: value = {from, to} ('YYYY-MM-DD'), 이름은 `${name}From`, `${name}To` 로 돌려줍니다.
 *     today('YYYY-MM-DD')가 있으면 빠른 기간 버튼(오늘, 7일, 1개월, 3개월)을 붙입니다.
 *   - checks: value = 선택된 값 배열
 *   - text + fieldOptions: 입력 앞에 검색 항목 선택 상자를 두고 그 값을 `${name}Field` 로 돌려줍니다.
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
    const sf = `sf${f.wide ? ' wide' : ''}`;
    const opts = (f.options ?? []).map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
    switch (f.type) {
      case 'select':
        return `<label class="${slc}" for="${id}">${escapeHtml(f.label)}</label><div class="${sf}"><select class="ctl grow" id="${id}" name="${f.name}">${opts}</select></div>`;
      case 'date-range':
        return `<label class="${slc}" for="${id}">${escapeHtml(f.label)}</label><div class="${sf}" data-range-for="${f.name}">`
          + `<input class="ctl date" type="date" id="${id}" name="${f.name}From"><span aria-hidden="true">-</span>`
          + `<label class="sr-only" for="${id}-to">${escapeHtml(f.label)} 종료</label><input class="ctl date" type="date" id="${id}-to" name="${f.name}To">`
          + (f.today ? `<span class="range-btns" role="group" aria-label="빠른 기간">${QUICK_RANGES.map((q) => `<button type="button" data-range="${q.key}" aria-pressed="false">${q.label}</button>`).join('')}</span>` : '')
          + '</div>';
      case 'checks':
        return `<span class="${slc}" id="${id}">${escapeHtml(f.label)}</span><div class="${sf}" role="group" aria-labelledby="${id}">`
          + (f.options ?? []).map((o) => `<label class="chk"><input type="checkbox" name="${f.name}" value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</label>`).join('')
          + '</div>';
      default:
        return `<label class="${slc}" for="${id}">${escapeHtml(f.label)}</label><div class="${sf}">`
          + (f.fieldOptions ? `<select class="ctl" name="${f.name}Field" aria-label="${escapeHtml(f.label)} 항목">${f.fieldOptions.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('')}</select>` : '')
          + `<input class="ctl grow" id="${id}" name="${f.name}" type="search" placeholder="${escapeHtml(f.placeholder ?? '')}" autocomplete="off"></div>`;
    }
  };

  el.innerHTML = `<form class="search-box" aria-label="조회 조건" novalidate>
      <div class="search-grid">${fields.map(cell).join('')}</div>
      <div class="search-actions"><button class="btn" type="button" data-act="reset">초기화</button><button class="btn btn-dark" type="submit">조회</button></div>
    </form>`;
  const form = el.querySelector('form');

  // 입력된 기간과 같은 빠른 기간 버튼을 눌린 상태로 둡니다.
  function syncRange(f) {
    if (!f.today) return;
    const from = form.elements[`${f.name}From`].value;
    const to = form.elements[`${f.name}To`].value;
    for (const b of form.querySelectorAll(`[data-range-for="${f.name}"] [data-range]`)) {
      const r = quickRange(b.dataset.range, f.today);
      b.setAttribute('aria-pressed', String(Boolean(r && r.from === from && r.to === to)));
    }
  }

  function set(values) {
    for (const f of fields) {
      const v = values?.[f.name];
      if (f.type === 'date-range') {
        form.elements[`${f.name}From`].value = v?.from ?? '';
        form.elements[`${f.name}To`].value = v?.to ?? '';
        syncRange(f);
      } else if (f.type === 'checks') {
        const on = new Set(v ?? []);
        for (const c of form.querySelectorAll(`input[name="${f.name}"]`)) c.checked = on.has(c.value);
      } else {
        form.elements[f.name].value = v ?? (f.type === 'select' ? (f.options?.[0]?.value ?? '') : '');
        if (f.fieldOptions) form.elements[`${f.name}Field`].value = values?.[`${f.name}Field`] ?? f.fieldOptions[0].value;
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
        if (f.fieldOptions) out[`${f.name}Field`] = form.elements[`${f.name}Field`].value;
      }
    }
    return out;
  }

  const initial = Object.fromEntries(fields.map((f) => [f.name, f.value]));
  set(initial);

  for (const f of fields.filter((x) => x.type === 'date-range' && x.today)) {
    for (const b of form.querySelectorAll(`[data-range-for="${f.name}"] [data-range]`)) {
      b.addEventListener('click', () => {
        const r = quickRange(b.dataset.range, f.today);
        form.elements[`${f.name}From`].value = r.from;
        form.elements[`${f.name}To`].value = r.to;
        syncRange(f);
      });
    }
    for (const name of [`${f.name}From`, `${f.name}To`]) form.elements[name].addEventListener('change', () => syncRange(f));
  }

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
