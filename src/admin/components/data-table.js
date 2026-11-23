// 목록 표: 숫자/금액 열은 오른쪽 정렬과 천 단위 구분, 상태는 글자가 있는 칩, 아래에 페이지 이동.
// 행이 없으면 빈 상태 화면을 그립니다.

/**
 * @typedef {{key:string, label:string, type?:'text'|'number'|'money'|'chip', align?:'l'|'r'|'c',
 *   format?:(row:Object)=>string|Node, chip?:(row:Object)=>{text:string, tone:string}|null, srLabel?:string,
 *   header?:()=>Node}} Column   header: 머리글 칸에 글자 대신 넣을 요소(예: 전체 선택 체크박스)
 * @param {HTMLElement} el
 * @param {{columns:Column[], rows:Object[], total:number, page:number, pageSize:number, onPage:(p:number)=>void,
 *   caption?:string, compact?:boolean, empty?:string, emptySub?:string, emptyAction?:{label:string, href:string},
 *   rowClass?:(row:Object)=>string, foot?:Array<string|number|null>}} opts
 *   foot: 합계 행(열 순서대로 값, null 은 빈 칸)
 */
export function renderDataTable(el, { columns, rows, total, page, pageSize, onPage, caption = '목록', compact = false, empty = '조건에 맞는 자료가 없습니다.', emptySub, emptyAction, rowClass, foot }) {
  el.replaceChildren();
  if (!rows.length) {
    const box = document.createElement('div');
    box.className = 'empty-state';
    box.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>';
    const p = document.createElement('p');
    p.textContent = empty;
    box.append(p);
    if (emptySub) {
      const s = document.createElement('p');
      s.className = 'sub';
      s.textContent = emptySub;
      box.append(s);
    }
    if (emptyAction) {
      const a = document.createElement('a');
      a.className = 'btn btn-primary';
      a.href = emptyAction.href;
      a.textContent = emptyAction.label;
      box.append(a);
    }
    el.append(box);
    return;
  }

  const align = (c) => c.align ?? (c.type === 'number' || c.type === 'money' ? 'r' : 'c');
  const wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = compact ? 'grid-table compact' : 'grid-table';
  const cap = document.createElement('caption');
  cap.className = 'sr-only';
  cap.textContent = caption;
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const c of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    if (align(c) !== 'c') th.className = align(c);
    if (c.header) th.append(c.header());
    else th.textContent = c.label;
    hr.append(th);
  }
  thead.append(hr);

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    const rc = rowClass?.(row);
    if (rc) tr.className = rc;
    for (const c of columns) {
      const td = document.createElement('td');
      if (align(c) !== 'c') td.className = align(c);
      let v;
      if (c.type === 'chip') {
        const chip = c.chip?.(row);
        if (chip) {
          v = document.createElement('span');
          v.className = `chip ${chip.tone}`;
          v.textContent = chip.text;
        } else v = '-';
      } else if (c.format) v = c.format(row);
      else v = row[c.key];
      if ((c.type === 'number' || c.type === 'money') && typeof v === 'number') v = v.toLocaleString('en-US');
      if (v instanceof Node) td.append(v);
      else td.textContent = v == null || v === '' ? '-' : String(v);
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(cap, thead, tbody);
  if (foot) {
    const tfoot = document.createElement('tfoot');
    const fr = document.createElement('tr');
    columns.forEach((c, i) => {
      const td = document.createElement('td');
      if (align(c) !== 'c') td.className = align(c);
      const v = foot[i];
      td.textContent = v == null ? '' : (typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
      fr.append(td);
    });
    tfoot.append(fr);
    table.append(tfoot);
  }
  wrap.append(table);
  el.append(wrap);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return;
  const nav = document.createElement('nav');
  nav.className = 'pager';
  nav.setAttribute('aria-label', '페이지');
  const link = (label, target, aria) => {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = label;
    if (aria) a.setAttribute('aria-label', aria);
    a.addEventListener('click', (e) => { e.preventDefault(); onPage(target); });
    return a;
  };
  if (page > 1) nav.append(link('‹', page - 1, '이전 페이지'));
  // 현재 쪽 앞뒤로 최대 10쪽
  const start = Math.max(1, Math.min(page - 4, pages - 9));
  const end = Math.min(pages, start + 9);
  for (let i = start; i <= end; i++) {
    if (i === page) {
      const s = document.createElement('span');
      s.setAttribute('aria-current', 'page');
      s.textContent = String(i);
      nav.append(s);
    } else nav.append(link(String(i), i));
  }
  if (page < pages) nav.append(link('›', page + 1, '다음 페이지'));
  el.append(nav);
}

// 목록의 한 쪽 자르기(서버 쪽 개수가 적은 목록은 화면에서 나눕니다)
export function pageOf(rows, page, pageSize) {
  return rows.slice((page - 1) * pageSize, page * pageSize);
}
