// 메인과 프로그램 목록. 마크업과 클래스는 설계 확정본(user-list.html)과 같습니다.
import { now as clockNow } from '../../lib/clock.js';
import { dayKeyLabel, kstMonthKey, kstShortDateTime, monthKeyLabel, sortGrades } from '../../lib/format.js';
import { showSkeleton } from '../../components/skeleton.js';
import { emptyState } from '../../components/empty-state.js';
import {
  activeOfferings, periodText, priceText, programStatus,
  renderProgramCard, saleStatus, sortPrograms, statusMark, typeMark,
} from '../components/program-card.js';
import { posterImage } from '../components/poster-images.js';
import { pageTitle } from '../../lib/router.js';

const TYPES = [['ALL', '전체'], ['PERFORMANCE', '공연'], ['EXPERIENCE', '체험'], ['COURSE', '정규 강좌']];
// 유형별 바로가기는 아래 목록 필터와 같은 곳으로 가서 두지 않습니다(DESIGN.md). 내 예약만 첫 화면에서 바로 갑니다.
const TYPE_TITLE = { PERFORMANCE: '공연 목록', EXPERIENCE: '체험 목록', COURSE: '정규 강좌 목록' };
// 날짜 키(KST)와 제목. 날짜 표기는 format.js 로 만듭니다.
const NOTICES = [
  ['2026-11-20', '겨울 시즌 공연, 교육 프로그램 예약을 한곳에서 받습니다'],
  ['2026-11-16', '할인 증빙은 입장(수업) 당일 현장에서 확인합니다'],
  ['2026-11-09', '주차장 공사로 12월 한 달간 지하 2층만 이용할 수 있습니다'],
];
const BOARD_LIMIT = 6;
const LOW_LEFT = 5; // 이 수 이하로 남으면 「마감 임박」
const BOARD_EMPTY = '지금 예매할 수 있는 회차가 없습니다.';
const LOAD_ERROR = '프로그램 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';

function node(tag, className, value) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (value != null) n.textContent = value;
  return n;
}

// 프로그램이 걸쳐 있는 달(KST) 목록: 'YYYY-MM'
function monthsOf(program) {
  const list = activeOfferings(program);
  if (!list.length) return [];
  const last = list[list.length - 1];
  const end = program.type === 'COURSE' ? last.ends_at : last.starts_at;
  const ym = (iso) => kstMonthKey(iso).split('-').map(Number);
  let [y, m] = ym(list[0].starts_at);
  const [ey, em] = ym(end);
  const out = [];
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function pickFeatured(programs, statusOf) {
  return programs.find((p) => p.type === 'PERFORMANCE' && statusOf(p) === 'ON_SALE')
    ?? programs.find((p) => statusOf(p) === 'ON_SALE')
    ?? programs[0];
}

function renderFeature(host, program, status, next) {
  const href = `#/programs/${encodeURIComponent(program.id)}`;
  // 사진은 장식입니다. 제목과 정보는 글자로 함께 나옵니다.
  const photo = node('div', 'f-photo');
  const img = posterImage(program.poster_image);
  if (img.src) {
    const im = node('img');
    im.src = img.src;
    im.alt = '';
    im.decoding = 'async';
    im.fetchPriority = 'high';
    im.style.objectPosition = img.position;
    photo.append(im);
  } else {
    photo.classList.add('no-image');
  }

  const info = node('div', 'f-info');
  const marks = node('div', 'f-marks');
  marks.append(typeMark(program.type), statusMark(status));
  const title = node('h2');
  const titleLink = node('a', '', program.title);
  titleLink.href = href;
  title.append(titleLink);
  const parts = [marks, title];
  if (program.summary) parts.push(node('p', 'f-summary', program.summary));
  // 기간과 장소는 한 줄로, 가격은 시작 가격을 크게 두고 등급별 가격을 작게 덧붙입니다.
  const meta = node('p', 'f-meta num');
  meta.append(node('span', '', periodText(program, 'full')), node('span', '', `한빛아트센터 ${program.venue ?? ''}`.trim()));
  const price = node('p', 'f-price');
  price.append(node('b', 'num', priceText(program)));
  if (program.type === 'PERFORMANCE') {
    const grades = priceLines(program);
    if (grades !== priceText(program)) price.append(node('span', 'f-grades num', grades));
  }
  parts.push(meta, price);
  const action = node('div', 'f-action');
  const cta = node('a', 'btn btn-primary', program.type === 'PERFORMANCE' ? '예매하기' : '신청하기');
  cta.href = href;
  action.append(cta);
  if (next) action.append(node('p', 'f-next num', `가장 가까운 회차 ${kstShortDateTime(next.offering.starts_at)}, ${leftText(next)}`));
  parts.push(action);
  info.append(...parts);
  host.replaceChildren(photo, info);
}

/**
 * 예매 현황판 행. 판매 중과 매진(대기 가능) 회차만, 시작 시각 순(같으면 제목 순)으로 최대 limit 건.
 * @param {Record<string, number>} remaining 회차 id 별 잔여석(모르면 없음)
 */
export function boardRows(programs, now, remaining = {}, limit = BOARD_LIMIT) {
  const rows = [];
  for (const program of programs) {
    for (const offering of activeOfferings(program)) {
      const left = remaining[offering.id];
      const status = saleStatus(offering, now, left === 0);
      if (status === 'ON_SALE' || status === 'SOLD_OUT_WAITLIST') rows.push({ program, offering, status, left });
    }
  }
  rows.sort((a, b) => new Date(a.offering.starts_at) - new Date(b.offering.starts_at)
    || a.program.title.localeCompare(b.program.title, 'ko'));
  return rows.slice(0, limit);
}

function leftText({ status, left }) {
  if (status === 'SOLD_OUT_WAITLIST') return '매진, 대기 신청';
  if (typeof left !== 'number') return '예매 중';
  return left <= LOW_LEFT ? `마감 임박 ${left}석` : `잔여 ${left}석`;
}

function renderBoard(host, rows, listTitle, featured) {
  const head = node('div', 'board-head');
  head.append(node('h2', '', '지금 예매할 수 있는 회차'));
  const body = [];
  if (rows.length) {
    const ul = node('ul', 'board');
    ul.setAttribute('role', 'list');
    for (const r of rows) {
      const li = node('li');
      const a = node('a');
      a.href = `#/programs/${encodeURIComponent(r.program.id)}`;
      const line = node('span', 'b-line');
      line.append(typeMark(r.program.type));
      // 첫 화면 왼쪽의 대표 공연과 같은 프로그램이면 글자 라벨로 이어 줍니다.
      if (r.program === featured) {
        li.classList.add('is-featured');
        line.append(node('span', 'b-badge', '대표 공연'));
      }
      line.append(node('span', 'b-title', r.program.title));
      const main = node('span', 'b-main');
      main.append(line, node('span', 'b-when num', kstShortDateTime(r.offering.starts_at)));
      const left = node('span', 'b-left', leftText(r));
      if (r.status === 'SOLD_OUT_WAITLIST') left.classList.add('sold');
      else if (typeof r.left === 'number' && r.left <= LOW_LEFT) left.classList.add('low');
      const go = node('span', 'b-go', '›');
      go.setAttribute('aria-hidden', 'true');
      a.append(main, left, go);
      li.append(a);
      ul.append(li);
    }
    body.push(ul);
  } else {
    body.push(node('p', 'board-empty', BOARD_EMPTY));
  }
  const more = node('button', 'btn btn-secondary btn-sm board-more', '전체 프로그램 보기');
  more.type = 'button';
  more.addEventListener('click', () => {
    listTitle.scrollIntoView?.({ block: 'start' });
    listTitle.focus({ preventScroll: true });
  });
  host.replaceChildren(head, ...body, more);
}

// 공연은 등급별 가격을 모두 보여 줍니다. 예: R석 40,000원 / S석 30,000원
function priceLines(program) {
  const byGrade = new Map();
  for (const o of activeOfferings(program)) {
    for (const p of o.prices ?? []) if (p.grade && !byGrade.has(p.grade)) byGrade.set(p.grade, p.price);
  }
  if (!byGrade.size) return priceText(program);
  return sortGrades([...byGrade.keys()]).map((g) => `${g}석 ${byGrade.get(g).toLocaleString('en-US')}원`).join(' / ');
}

async function loadRemaining(api, programs) {
  const ids = programs.flatMap((p) => activeOfferings(p).map((o) => o.id));
  const out = {};
  // 잔여석을 못 읽은 회차는 매진으로 보지 않고 판매 상태만 보여 줍니다.
  await Promise.all(ids.map(async (id) => {
    try { out[id] = await api.remainingCapacity(id); } catch { /* 모르는 값으로 둡니다. */ }
  }));
  return out;
}

/**
 * @param {HTMLElement} el
 * @param {{api:object, query?:URLSearchParams, now?:()=>Date}} deps
 */
export async function renderPrograms(el, { api, query = new URLSearchParams(), now = clockNow }) {
  el.innerHTML = `<section class="hero">
    <div class="container">
      <div class="hero-head">
        <h1>무대와 배움이 가까운 곳에</h1>
        <p>공연, 체험, 정규 강좌 예약을 한곳에서</p>
        <a class="hero-mine" href="#/me/bookings">내 예약 확인</a>
      </div>
      <div class="hero-grid">
        <article class="hero-feature" data-feature></article>
        <aside class="board-panel" aria-labelledby="board-title" data-board></aside>
      </div>
    </div>
  </section>
  <section class="section" aria-labelledby="list-title">
    <div class="container">
      <div class="section-head"><div><h2 id="list-title" tabindex="-1">프로그램</h2></div></div>
      <div data-list></div>
    </div>
  </section>
  <section class="notice-strip" aria-labelledby="notice-title">
    <div class="container"><h2 id="notice-title">공지사항</h2><ul></ul></div>
  </section>`;

  const notices = el.querySelector('.notice-strip ul');
  for (const [dt, text] of NOTICES) {
    const li = node('li');
    const t = node('time', '', dayKeyLabel(dt, { plain: true }));
    t.dateTime = dt;
    li.append(t, node('span', '', text));
    notices.append(li);
  }

  const list = el.querySelector('[data-list]');
  const feature = el.querySelector('[data-feature]');
  const board = el.querySelector('[data-board]');

  let programs;
  let remaining;
  const release = showSkeleton(list, 'cards');
  try {
    programs = sortPrograms(await api.listPrograms());
    remaining = await loadRemaining(api, programs);
  } catch (e) {
    console.error(e);
    release();
    feature.remove();
    board.remove();
    const msg = node('p', 'form-error', LOAD_ERROR);
    msg.setAttribute('role', 'alert');
    const retry = node('button', 'btn btn-secondary btn-sm', '다시 시도');
    retry.type = 'button';
    retry.addEventListener('click', () => renderPrograms(el, { api, query, now }));
    list.replaceChildren(msg, retry);
    return;
  }

  release();
  const statusOf = (p) => programStatus(p, now(), remaining);
  let featured = null;
  if (programs.length) {
    featured = pickFeatured(programs, statusOf);
    renderFeature(feature, featured, statusOf(featured), boardRows([featured], now(), remaining, 1)[0]);
  } else {
    feature.remove();
  }
  renderBoard(board, boardRows(programs, now(), remaining), el.querySelector('#list-title'), featured);
  board.querySelector('h2').id = 'board-title';

  // 필터 상태
  const wanted = query.get('type');
  const months = [...new Set(programs.flatMap(monthsOf))].sort();
  const targets = [...new Set(programs.map((p) => p.audience).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  // GNB 2depth(이번 달 공연, 가족 체험)는 month, target 값으로 들어옵니다. 달은 목록에 없어도 그 달로 거릅니다(빈 상태 안내).
  const wantedMonth = /^\d{4}-\d{2}$/.test(query.get('month') ?? '') ? query.get('month') : '';
  if (wantedMonth && !months.includes(wantedMonth)) { months.push(wantedMonth); months.sort(); }
  const wantedTarget = targets.includes(query.get('target')) ? query.get('target') : '';
  const state = { type: TYPES.some(([k]) => k === wanted) ? wanted : 'ALL', month: wantedMonth, target: wantedTarget };

  const seg = node('div', 'seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', '유형');
  const count = node('span', 'count');
  const monthSel = selectBox('month', '기간', '전체 기간', months.map((m) => [m, monthKeyLabel(m)]));
  const targetSel = selectBox('target', '대상', '전체 대상', targets.map((t) => [t, t]));
  const right = node('div', 'right');
  right.append(count, ...monthSel.parts, ...targetSel.parts);
  const filters = node('div', 'filters');
  filters.append(seg, right);
  const results = node('div');
  list.replaceChildren(filters, results);

  const hero = el.querySelector('.hero');
  function draw() {
    for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.type === state.type));
    // 유형을 고른 목록은 문서 제목에 유형을 넣습니다(예: 공연 목록 | 한빛아트센터).
    if (TYPE_TITLE[state.type]) hero.dataset.title = TYPE_TITLE[state.type];
    else delete hero.dataset.title;
    if (el.isConnected && document.title) document.title = pageTitle(el);
    const shown = programs.filter((p) =>
      (state.type === 'ALL' || p.type === state.type)
      && (!state.month || monthsOf(p).includes(state.month))
      && (!state.target || p.audience === state.target));
    count.textContent = `총 ${shown.length}건`;
    if (!shown.length) {
      results.replaceChildren(emptyState({
        title: '조건에 맞는 프로그램이 없습니다.',
        body: '유형이나 기간, 대상을 바꿔 보세요.',
        label: '조건 초기화',
        onAction: () => {
          Object.assign(state, { type: 'ALL', month: '', target: '' });
          monthSel.select.value = '';
          targetSel.select.value = '';
          draw();
        },
      }));
      return;
    }
    const grid = node('ul', 'grid');
    grid.setAttribute('role', 'list');
    // 추천 프로그램은 바로 위 첫 화면에 이미 보이므로 목록에서는 맨 뒤에 둡니다(같은 포스터가 한 화면에 두 번 나오지 않게).
    const ordered = featured && shown.includes(featured) ? [...shown.filter((p) => p !== featured), featured] : shown;
    for (const p of ordered) grid.append(renderProgramCard(p, statusOf(p)));
    results.replaceChildren(grid);
  }

  for (const [key, label] of TYPES) {
    const b = node('button', '', label);
    b.type = 'button';
    b.dataset.type = key;
    b.addEventListener('click', () => { state.type = key; draw(); });
    seg.append(b);
  }
  monthSel.select.addEventListener('change', () => { state.month = monthSel.select.value; draw(); });
  targetSel.select.addEventListener('change', () => { state.target = targetSel.select.value; draw(); });
  monthSel.select.value = state.month;
  targetSel.select.value = state.target;
  draw();
}

function selectBox(id, label, allLabel, options) {
  const l = node('label', 'sr-only', label);
  l.htmlFor = id;
  const select = node('select', 'select');
  select.id = id;
  const all = node('option', '', allLabel);
  all.value = '';
  select.append(all);
  for (const [value, text] of options) {
    const o = node('option', '', text);
    o.value = value;
    select.append(o);
  }
  return { select, parts: [l, select] };
}
