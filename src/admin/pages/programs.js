// 프로그램 목록과 등록/수정(운영 담당). 조회 조건 -> 건수와 등록/CSV -> 목록 -> 편집(설계 5-9).
import { escapeHtml, kstDate, kstDateTime, kstShortDateTime, kstDayKey } from '../../lib/format.js';
import { exportCsv } from '../../lib/csv.js';
import { withBusy } from '../../components/button-busy.js';
import { now as clockNow } from '../../lib/clock.js';
import { renderSearchBox } from '../components/search-box.js';
import { renderDataTable, pageOf } from '../components/data-table.js';
import { TYPE_LABEL, TYPE_OPTIONS, loadInto, offeringState, pageHead, typeChip } from '../components/page.js';
import { formRow, readForm, showErrors, alertBox, noticeNear } from '../components/form.js';
import { RULE_TEXT } from '../../user/components/refund-preview.js';

// 취소 규정은 상품 유형별로 정해진 정책입니다(Ruling R23). 양식에서는 읽기 전용으로 보여 줍니다.
const BEFORE_START = ['D8_PLUS', 'D7_4', 'D3_1', 'SAME_DAY'];
const COURSE_AFTER = ['MID_BEFORE_1_3', 'MID_BEFORE_1_2', 'MID_AFTER_1_2'];
export function cancelRuleLines(type) {
  if (!type) return [];
  return (type === 'COURSE' ? [...BEFORE_START, ...COURSE_AFTER] : BEFORE_START).map((k) => RULE_TEXT[k]);
}
const ruleListHtml = (type) => (type
  ? `<ul class="rule-list">${cancelRuleLines(type).map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`
  : '<p class="hint">유형을 고르면 취소 규정이 나옵니다.</p>');

const DOWNLOAD_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';

export function filterPrograms(rows, f) {
  const q = (f.q ?? '').toLowerCase();
  return rows.filter((r) => (!f.type || r.type === f.type)
    && (!f.open || (f.open === 'Y') === r.is_public)
    && (!q || r.title.toLowerCase().includes(q)));
}

export async function renderPrograms(el, { api, query }) {
  const state = { filters: { type: '', open: '', q: query?.get('q') ?? '' }, page: 1, pageSize: 20, rows: [] };
  el.innerHTML = `${pageHead({ crumbs: ['프로그램관리', '프로그램 목록'], title: '프로그램 목록', help: '비공개 프로그램은 사용자 화면에 보이지 않습니다. 프로그램명을 누르면 수정할 수 있습니다.' })}
    <div class="sb-host"></div>
    <section class="result" aria-label="조회 결과">
      <div class="toolbar">
        <span class="total" aria-live="polite" hidden>총 <b class="num">0</b>건</span>
        <div class="tools">
          <button class="btn" type="button" data-act="csv">${DOWNLOAD_ICON}CSV 다운로드</button>
          <label class="sr-only" for="ps">페이지당 건수</label><select class="ctl" id="ps"><option value="20">20건씩</option><option value="50">50건씩</option></select>
          <a class="btn btn-primary" href="#/programs/new">프로그램 등록</a>
        </div>
      </div>
      <div class="tb-host"></div>
    </section>`;

  const tb = el.querySelector('.tb-host');
  const filtered = () => filterPrograms(state.rows, state.filters);
  const columns = [
    { key: 'no', label: '번호', type: 'number', align: 'c' },
    { key: 'type', label: '유형', type: 'chip', chip: (r) => typeChip(r.type) },
    { key: 'title', label: '프로그램명', align: 'l', format: (r) => {
      const a = document.createElement('a');
      a.className = 'link';
      a.href = `#/programs/${r.id}`;
      a.textContent = r.title;
      return a;
    } },
    { key: 'venue', label: '장소' },
    { key: 'count', label: '회차 수', type: 'number', format: (r) => r.offerings.length },
    { key: 'is_public', label: '공개', type: 'chip', chip: (r) => (r.is_public ? { text: '공개', tone: 'ok' } : { text: '비공개', tone: 'cancel' }) },
    { key: 'created_at', label: '등록일', format: (r) => kstDate(r.created_at) },
  ];

  function draw() {
    const rows = filtered();
    el.querySelector('.total').hidden = false;
    el.querySelector('.total b').textContent = rows.length.toLocaleString('en-US');
    const page = pageOf(rows, state.page, state.pageSize).map((r, i) => ({ ...r, no: rows.length - ((state.page - 1) * state.pageSize + i) }));
    renderDataTable(tb, {
      caption: '프로그램 목록', columns, rows: page, total: rows.length, page: state.page, pageSize: state.pageSize,
      onPage: (p) => { state.page = p; draw(); el.querySelector('.result').scrollIntoView({ block: 'start' }); },
      empty: state.rows.length ? '조건에 맞는 프로그램이 없습니다.' : '등록된 프로그램이 없습니다.',
      emptySub: state.rows.length ? '조회 조건을 바꾸거나 초기화해 주세요.' : undefined,
      emptyAction: state.rows.length ? undefined : { label: '프로그램 등록', href: '#/programs/new' },
    });
  }

  renderSearchBox(el.querySelector('.sb-host'), [
    { name: 'type', label: '유형', type: 'select', options: TYPE_OPTIONS },
    { name: 'open', label: '공개 여부', type: 'select', options: [{ value: '', label: '전체' }, { value: 'Y', label: '공개' }, { value: 'N', label: '비공개' }] },
    { name: 'q', label: '프로그램명', type: 'text', placeholder: '프로그램명 입력', value: state.filters.q },
  ], (v) => { state.filters = v; state.page = 1; draw(); });

  el.querySelector('#ps').addEventListener('change', (e) => { state.pageSize = Number(e.target.value); state.page = 1; draw(); });
  const csvBtn = el.querySelector('[data-act="csv"]');
  csvBtn.addEventListener('click', () => {
    exportCsv(`프로그램목록_${kstDayKey(clockNow()).replace(/-/g, '')}.csv`, [
      { key: 'type', label: '유형', value: (r) => TYPE_LABEL[r.type] },
      { key: 'title', label: '프로그램명' },
      { key: 'venue', label: '장소' },
      { key: 'count', label: '회차 수', value: (r) => r.offerings.length },
      { key: 'is_public', label: '공개', value: (r) => (r.is_public ? '공개' : '비공개') },
      { key: 'created_at', label: '등록일', value: (r) => kstDate(r.created_at) },
    ], filtered(), (m) => noticeNear(csvBtn, m));
  });

  const rows = await loadInto(tb, 'table', () => api.programs());
  if (!rows) return;
  state.rows = rows;
  draw();
}

const POSTERS = [
  { value: '', label: '사진 없음(무채색 바탕)' },
  { value: 'quartet', label: '현악 사중주' },
  { value: 'theater', label: '무대와 객석' },
  { value: 'pottery', label: '도자기 공방' },
  { value: 'makeup', label: '분장 도구' },
  { value: 'choir', label: '합창' },
  { value: 'watercolor', label: '수채화' },
];

// 프로그램 입력 검사(화면). 서버도 같은 규칙을 다시 검사합니다.
export function validateProgram(v) {
  const errs = {};
  if (!v.type) errs.type = '프로그램 유형을 선택해 주세요.';
  if (!v.title) errs.title = '프로그램명을 입력해 주세요.';
  else if (v.title.length > 100) errs.title = '프로그램명은 100자 안으로 입력해 주세요.';
  return errs;
}

export async function renderProgramEdit(el, { api, go, id }) {
  const isNew = !id;
  const title = isNew ? '프로그램 등록' : '프로그램 수정';
  el.innerHTML = `${pageHead({ crumbs: ['프로그램관리', '프로그램 목록', title], title })}<div class="form-host"></div>`;
  const host = el.querySelector('.form-host');
  const prog = isNew ? {} : await loadInto(host, 'form', () => api.program(id));
  if (prog === undefined) return;
  if (!isNew && !prog) {
    host.innerHTML = '<div class="page-message"><h2 class="page-title">프로그램을 찾을 수 없습니다.</h2><p>삭제되었거나 주소가 잘못되었습니다. 목록에서 다시 선택해 주세요.</p><a class="btn-secondary" href="#/programs">프로그램 목록</a></div>';
    return;
  }
  const locked = !isNew && prog.offerings.length > 0;
  const typeRadios = Object.entries(TYPE_LABEL).map(([k, label]) => `<label class="chk"><input type="radio" name="type" value="${k}"${prog.type === k ? ' checked' : ''}${locked ? ' disabled' : ''}>${label}</label>`).join('');
  const posterOpts = POSTERS.map((o) => `<option value="${o.value}"${(prog.poster_image ?? '') === o.value ? ' selected' : ''}>${o.label}</option>`).join('');
  const v = (k) => escapeHtml(prog[k] ?? '');

  host.innerHTML = `<div class="alert-host"></div>
    <form class="prog-form" novalidate>
      <section class="form-card" aria-labelledby="fs-basic"><h2 id="fs-basic">기본 정보</h2><div class="form-grid">
        ${formRow({ label: '유형', required: true, name: 'type', group: true, field: `<div class="radio-row" role="radiogroup" aria-labelledby="lbl-type">${typeRadios}</div>`,
          hint: locked ? '회차가 있어 유형을 바꿀 수 없습니다.' : '공연은 좌석제(200석), 체험과 정규 강좌는 정원제입니다.' })}
        ${formRow({ label: '프로그램명', required: true, name: 'title', field: `<input class="ctl full" id="f-title" name="title" maxlength="100" value="${v('title')}">` })}
        ${formRow({ label: '한 줄 소개', name: 'summary', field: `<input class="ctl full" id="f-summary" name="summary" maxlength="200" value="${v('summary')}">`, hint: '목록 카드에 보입니다.' })}
        ${formRow({ label: '상세 설명', name: 'description', field: `<textarea class="ctl full" id="f-description" name="description" rows="5">${v('description')}</textarea>` })}
        ${formRow({ label: '장소', name: 'venue', field: `<input class="ctl half" id="f-venue" name="venue" maxlength="50" value="${v('venue')}">` })}
        ${formRow({ label: '대상', name: 'audience', field: `<input class="ctl half" id="f-audience" name="audience" maxlength="50" value="${v('audience')}">`, hint: '예: 초등학생 이상' })}
        ${formRow({ label: '공개 여부', name: 'is_public', group: true, field: `<div class="radio-row" role="radiogroup" aria-labelledby="lbl-is_public">
            <label class="chk"><input type="radio" name="is_public" value="Y"${prog.is_public ? ' checked' : ''}>공개</label>
            <label class="chk"><input type="radio" name="is_public" value="N"${prog.is_public ? '' : ' checked'}>비공개</label></div>`,
          hint: '공개하면 사용자 화면 목록에 바로 나옵니다.' })}
        ${formRow({ label: '할인 적용', name: 'discount_enabled', group: true, field: `<div class="radio-row" role="radiogroup" aria-labelledby="lbl-discount_enabled">
            <label class="chk"><input type="radio" name="discount_enabled" value="Y"${prog.discount_enabled === false ? '' : ' checked'}>적용</label>
            <label class="chk"><input type="radio" name="discount_enabled" value="N"${prog.discount_enabled === false ? ' checked' : ''}>적용 안 함</label></div>`,
          hint: '적용 안 함이면 사용자 화면에서 일반 요금만 고를 수 있습니다. 이미 확정된 예약 금액은 바뀌지 않습니다.' })}
        ${formRow({ label: '취소 규정', name: 'cancel_rule', group: true, field: `<div class="rule-host">${ruleListHtml(prog.type)}</div>`,
          hint: '상품 유형별로 정해진 규정이 적용되며 바꿀 수 없습니다. 기관 사정으로 회차를 취소하면 전액 환불합니다.' })}
      </div></section>
      <section class="form-card" aria-labelledby="fs-poster"><h2 id="fs-poster">포스터</h2><div class="form-grid">
        ${formRow({ label: '사진', name: 'poster_image', field: `<select class="ctl half" id="f-poster_image" name="poster_image">${posterOpts}</select>` })}
        ${formRow({ label: '글자 색', name: 'poster_tone', group: true, field: `<div class="radio-row" role="radiogroup" aria-labelledby="lbl-poster_tone">
            <label class="chk"><input type="radio" name="poster_tone" value="light"${prog.poster_tone === 'light' ? ' checked' : ''}>밝은 사진용(어두운 글자)</label>
            <label class="chk"><input type="radio" name="poster_tone" value="dark"${prog.poster_tone === 'light' ? '' : ' checked'}>어두운 사진용(흰 글자)</label></div>` })}
        ${formRow({ label: '시리즈명', name: 'poster_series', field: `<input class="ctl half" id="f-poster_series" name="poster_series" maxlength="40" value="${v('poster_series')}">` })}
        ${formRow({ label: '포스터 제목', name: 'poster_title', field: `<textarea class="ctl half" id="f-poster_title" name="poster_title" rows="2">${v('poster_title')}</textarea>`, hint: '줄을 바꾸면 포스터에서도 줄이 바뀝니다.' })}
        ${formRow({ label: '부제', name: 'poster_sub', field: `<input class="ctl half" id="f-poster_sub" name="poster_sub" maxlength="60" value="${v('poster_sub')}">` })}
      </div></section>
      ${isNew ? '' : `<section class="result" aria-labelledby="fs-off"><div class="result-head"><h2 id="fs-off">회차</h2><a class="btn" href="#/offerings/new?program=${prog.id}">회차 등록</a></div><div class="off-host"></div></section>`}
      <div class="save-bar"><span class="state">${isNew ? '저장하면 회차를 등록할 수 있습니다.' : ''}</span>
        <div class="acts"><a class="btn" href="#/programs">목록</a><button class="btn btn-primary" type="submit">저장</button></div></div>
    </form>`;

  if (!isNew) {
    const nowMs = clockNow().getTime();
    const offs = [...prog.offerings].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    renderDataTable(host.querySelector('.off-host'), {
      caption: '이 프로그램의 회차', compact: true, rows: offs, total: offs.length, page: 1, pageSize: offs.length || 1, onPage: () => {},
      columns: [
        { key: 'starts_at', label: '회차 일시', format: (r) => {
          const a = document.createElement('a');
          a.className = 'link';
          a.href = `#/offerings/${r.id}`;
          a.textContent = kstDateTime(r.starts_at);
          return a;
        } },
        { key: 'sale', label: '판매 기간', format: (r) => `${kstShortDateTime(r.sale_starts_at)} - ${kstShortDateTime(r.sale_ends_at)}` },
        { key: 'capacity', label: '정원', type: 'number' },
        { key: 'status', label: '상태', type: 'chip', chip: (r) => offeringState(r, nowMs) },
      ],
      empty: '등록된 회차가 없습니다.', emptySub: '회차를 등록하면 사용자 화면에서 예약할 수 있습니다.',
    });
  }

  const form = host.querySelector('form');
  showErrors(form, {});
  const alertHost = host.querySelector('.alert-host');
  for (const r of form.querySelectorAll('input[name="type"]')) {
    r.addEventListener('change', () => { form.querySelector('.rule-host').innerHTML = ruleListHtml(r.value); });
  }
  const saveBtn = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = readForm(form, ['title', 'summary', 'description', 'venue', 'audience', 'poster_image', 'poster_series', 'poster_title', 'poster_sub']);
    val.type = locked ? prog.type : (form.querySelector('input[name="type"]:checked')?.value ?? '');
    val.is_public = form.querySelector('input[name="is_public"]:checked')?.value === 'Y';
    val.discount_enabled = form.querySelector('input[name="discount_enabled"]:checked')?.value !== 'N';
    val.poster_tone = form.querySelector('input[name="poster_tone"]:checked')?.value ?? 'dark';
    const errs = validateProgram(val);
    if (showErrors(form, errs)) { alertHost.replaceChildren(); return; }
    withBusy(saveBtn, async () => {
      try {
        const payload = { ...val };
        if (!isNew) payload.id = prog.id;
        if (locked) delete payload.type;
        const saved = await api.saveProgram(payload);
        if (isNew) {
          try { sessionStorage.setItem('admin-flash', '프로그램을 등록했습니다. 이제 회차를 등록할 수 있습니다.'); } catch { /* 저장소를 못 쓰면 안내 없이 이동합니다. */ }
          await go(`#/programs/${saved.id}`);
        } else {
          alertBox(alertHost, '저장했습니다. 사용자 화면에도 바로 반영됩니다.', 'ok');
        }
      } catch (err) {
        if (err.code === 'INVALID_TITLE') showErrors(form, { title: err.message });
        else if (err.code === 'INVALID_TYPE' || err.code === 'TYPE_LOCKED') showErrors(form, { type: err.message });
        else alertBox(alertHost, err.message);
      }
    });
  });
  let flash = null;
  try { flash = sessionStorage.getItem('admin-flash'); sessionStorage.removeItem('admin-flash'); } catch { /* 저장소를 못 쓰면 안내를 건너뜁니다. */ }
  if (flash) alertBox(alertHost, flash, 'ok');
}
