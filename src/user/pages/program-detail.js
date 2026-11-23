// 프로그램 상세. 마크업과 클래스는 설계 확정본(user-detail.html)과 같습니다.
import { refundForBeforeStart, refundForCourse } from '@policy/refund.js';
import { now as clockNow } from '../../lib/clock.js';
import { kstDate, kstDateParts, kstDateTime, kstDayChipLabel, kstShortDateWd, kstTime, won } from '../../lib/format.js';
import { showSkeleton } from '../../components/skeleton.js';
import {
  activeOfferings, periodText, posterProps, saleStatus, STATUS_LABEL, statusMark, typeMark,
} from '../components/program-card.js';
import { renderPoster, TYPE_LABEL } from '../components/poster.js';

const DAY = 86400000;
const HOUR = 3600000;
const LOAD_ERROR = '프로그램 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';

const WORDS = {
  PERFORMANCE: { day: '관람일', today: '관람 당일', unit: '석', buy: '예매', cta: '좌석 선택', intro: '공연 소개', guide: '관람 안내', tabs: '공연 정보', timeLabel: '관람 시간', pick: '관람일과 회차' },
  EXPERIENCE: { day: '체험일', today: '체험 당일', unit: '명', buy: '신청', cta: '신청하기', intro: '체험 소개', guide: '이용 안내', tabs: '체험 정보', timeLabel: '소요 시간', pick: '체험일과 회차' },
  COURSE: { day: '개강일', today: '개강 당일', unit: '명', buy: '신청', cta: '수강 신청', intro: '강좌 소개', guide: '수강 안내', tabs: '강좌 정보', timeLabel: '수업 시간', pick: '신청 안내' },
};
const LIMIT = { PERFORMANCE: '회차당 1인 4매', EXPERIENCE: '회차당 1인 4명', COURSE: '1인 1건(12회 과정 전체)' };
const FEE_TEXT = {
  D8_PLUS: '없음',
  D7_4: '결제액의 10%',
  D3_1: '결제액의 30%',
  SAME_DAY: '취소 불가',
  MID_BEFORE_1_3: '결제액의 1/3',
  MID_BEFORE_1_2: '결제액의 1/2',
  MID_AFTER_1_2: '환불 불가',
};

function node(tag, className, value) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (value != null) n.textContent = value;
  return n;
}

/**
 * 취소 규정 표의 행. 금액은 환불 정책 함수(공용)로 계산합니다.
 * @returns {{when:string, fee:string, refund:string}[]}
 */
export function cancellationRows(type, price, lessonCount = 12) {
  const w = WORDS[type];
  const base = new Date('2030-03-15T12:00:00+09:00');
  const before = [
    [10, `${w.day} 8일 전까지`],
    [5, `${w.day} 7일 전 - 4일 전`],
    [2, `${w.day} 3일 전 - 1일 전`],
    [0, w.today],
  ];
  const rows = before.map(([d, when]) => {
    const r = refundForBeforeStart(price, base, new Date(base.getTime() - d * DAY));
    return { when, fee: FEE_TEXT[r.rule], refund: r.cancellable ? won(r.refundAmount) : '-' };
  });
  if (type !== 'COURSE') return rows;

  // 개강 후: 수업 진행 횟수에 따라 같은 규정이 적용되는 구간을 묶습니다.
  const lessons = Array.from({ length: lessonCount }, (_, i) => new Date(base.getTime() + i * 7 * DAY));
  const groups = [];
  for (let k = 1; k <= lessonCount; k += 1) {
    const r = refundForCourse(price, lessons, new Date(lessons[k - 1].getTime() + HOUR));
    const last = groups[groups.length - 1];
    if (last && last.rule === r.rule) last.to = k;
    else groups.push({ rule: r.rule, from: k, to: k, refund: r.refundAmount });
  }
  for (const g of groups) {
    const when = g.rule === 'MID_AFTER_1_2' ? `${g.from}회 이후`
      : g.from === g.to ? `${g.from}회 진행 후` : `${g.from}회 - ${g.to}회 진행 후`;
    rows.push({ when, fee: FEE_TEXT[g.rule], refund: won(g.refund) });
  }
  return rows;
}

function refundTable(type, price, lessonCount) {
  const table = node('table', 'tbl');
  table.append(node('caption', 'sr-only', '취소 시점별 수수료'));
  const head = node('tr');
  [['취소 시점', ''], ['취소 수수료', ''], [`${won(price)} ${WORDS[type].buy} 시 환불액`, 'r']].forEach(([t, c]) => {
    const th = node('th', c, t);
    th.scope = 'col';
    head.append(th);
  });
  const thead = node('thead');
  thead.append(head);
  table.append(thead);
  const body = node('tbody');
  for (const r of cancellationRows(type, price, lessonCount)) {
    const tr = node('tr');
    tr.append(node('td', '', r.when), node('td', '', r.fee), node('td', 'r', r.refund));
    body.append(tr);
  }
  table.append(body);
  return table;
}

const INFO_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>';

function notFound(el) {
  const wrap = node('section', 'container page-message');
  const a = node('a', 'btn btn-secondary', '프로그램 목록');
  a.href = '#/programs';
  wrap.append(
    node('h1', 'page-title', '프로그램을 찾을 수 없습니다.'),
    node('p', '', '주소가 바뀌었거나 판매가 끝난 프로그램일 수 있습니다. 목록에서 다시 찾아 주세요.'),
    a,
  );
  el.replaceChildren(wrap);
}

function loadFailed(el, retry) {
  const wrap = node('section', 'container page-message');
  const msg = node('p', 'form-error', LOAD_ERROR);
  msg.setAttribute('role', 'alert');
  const b = node('button', 'btn btn-secondary', '다시 시도');
  b.type = 'button';
  b.addEventListener('click', retry);
  wrap.append(node('h1', 'page-title', '프로그램 정보를 불러오지 못했습니다.'), msg, b);
  el.replaceChildren(wrap);
}

function dateParts(iso) {
  const t = kstDateParts(iso);
  return { key: t.key, iso, label: kstDate(iso), m: Number(t.month), d: Number(t.day), wd: t.weekday };
}
const hhmm = kstTime;

/**
 * @param {HTMLElement} el
 * @param {{api:object, id:string, now?:()=>Date}} deps
 */
export async function renderProgramDetail(el, { api, id, now = clockNow }) {
  const loading = node('div', 'container detail-loading');
  el.replaceChildren(loading);
  const release = showSkeleton(loading, 'detail');

  let program;
  try {
    program = await api.getProgram(id);
  } catch (e) {
    console.error(e);
    release();
    loadFailed(el, () => renderProgramDetail(el, { api, id, now }));
    return;
  }
  if (!program) {
    release();
    notFound(el);
    return;
  }

  const type = program.type;
  const w = WORDS[type];
  const offerings = activeOfferings(program);
  const details = program.details ?? {};

  // 회차별 잔여석. 못 읽은 회차는 값 없이 둡니다.
  const remaining = {};
  await Promise.all(offerings.map(async (o) => {
    try { remaining[o.id] = await api.remainingCapacity(o.id); } catch { /* 모르는 값으로 둡니다. */ }
  }));
  const statusOf = (o) => saleStatus(o, now(), remaining[o.id] === 0);

  const frag = document.createDocumentFragment();

  // 위치
  const crumb = node('nav', 'crumb');
  crumb.setAttribute('aria-label', '현재 위치');
  const ol = node('ol');
  const li = (child) => { const x = node('li'); x.append(child); return x; };
  const link = (href, t) => { const a = node('a', '', t); a.href = href; return a; };
  const here = node('li', '', (program.poster_title || program.title).replace(/\n/g, ' '));
  here.setAttribute('aria-current', 'page');
  ol.append(li(link('#/', '홈')), li(link(`#/programs?type=${type}`, TYPE_LABEL[type])), here);
  crumb.append(ol);
  const topWrap = node('div', 'container');
  topWrap.append(crumb);

  // 위쪽: 포스터 + 요약
  const detail = node('div', 'detail');
  const posterBox = node('div', 'd-poster');
  renderPoster(posterBox, posterProps(program, 'short'), { priority: true });
  const info = node('div');
  const tags = node('div', 'd-tags');
  tags.append(typeMark(type));
  const topStatus = (() => {
    for (const s of ['ON_SALE', 'SOLD_OUT_WAITLIST', 'UPCOMING']) if (offerings.some((o) => statusOf(o) === s)) return s;
    return 'CLOSED';
  })();
  tags.append(statusMark(topStatus));
  info.append(tags, node('h1', '', program.title));
  if (program.summary) info.append(node('p', 'lead', program.summary));

  // 사양 목록
  const spec = node('dl', 'spec');
  const row = (k, v) => {
    spec.append(node('dt', '', k));
    const dd = node('dd');
    if (v instanceof Node) dd.append(v); else dd.textContent = v;
    spec.append(dd);
  };
  row('기간', (() => { const d = node('span', 'num', periodText(program, 'full')); return d; })());
  const cap = type === 'PERFORMANCE' && offerings[0] ? ` (${offerings[0].capacity}석)` : '';
  row('장소', `한빛아트센터 ${program.venue ?? ''}${cap}`.trim());
  if (details.runtime) row(w.timeLabel, details.runtime);
  if (program.audience) row('대상', program.audience);
  const priceBox = node('div', 'price-list num');
  const grades = new Map();
  let single = null;
  for (const o of offerings) {
    for (const p of o.prices ?? []) {
      if (p.grade) { if (!grades.has(p.grade)) grades.set(p.grade, p.price); } else single = Math.max(single ?? 0, p.price);
    }
  }
  if (grades.size) {
    for (const [g, p] of grades) {
      const s = node('span');
      s.append(node('b', '', `${g}석`), document.createTextNode(won(p)));
      priceBox.append(s);
    }
  } else if (single != null) {
    const s = node('span');
    s.append(node('b', '', type === 'COURSE' ? '수강료' : '1인'), document.createTextNode(won(single)));
    priceBox.append(s);
  }
  row('가격', priceBox);
  const discount = node('div');
  discount.append(
    document.createTextNode(type === 'COURSE'
      ? '장애인, 국가유공자 50%, 다자녀 가정 30%(동반 할인 없음)'
      : '장애인, 국가유공자 50%(동반 1인 포함), 다자녀 가정 30%'),
    document.createElement('br'),
    node('span', 'sub', `증빙은 ${type === 'PERFORMANCE' ? '공연' : type === 'EXPERIENCE' ? '체험' : '수업'} 당일 현장에서 확인합니다.`),
  );
  row('할인', discount);
  row(`${w.buy} 한도`, LIMIT[type]);
  info.append(spec);

  // 날짜와 회차 고르기
  const pick = node('section', 'block');
  pick.setAttribute('aria-labelledby', 'pick-title');
  const pickTitle = node('h2', '', w.pick);
  pickTitle.id = 'pick-title';
  pick.append(pickTitle);

  const order = ['ON_SALE', 'SOLD_OUT_WAITLIST', 'UPCOMING', 'CLOSED'];
  const firstChoice = [...offerings].sort((a, b) => order.indexOf(statusOf(a)) - order.indexOf(statusOf(b)))[0];
  let selected = firstChoice ?? null;

  const slotsBox = node('div', 'slots');
  slotsBox.setAttribute('role', 'radiogroup');
  slotsBox.setAttribute('aria-label', '회차');
  const dateBox = node('div', 'dates');
  dateBox.setAttribute('role', 'group');
  dateBox.setAttribute('aria-label', type === 'PERFORMANCE' ? '관람일' : '체험일');

  const ctaDesktop = node('div', 'cta-row desktop');
  const bar = node('div', 'mobile-bar');
  const barInfo = node('div', 'mb-info');

  function leftText(o) {
    const s = statusOf(o);
    const left = node('span', 's-left');
    if (s === 'ON_SALE' && typeof remaining[o.id] === 'number') {
      left.append(document.createTextNode('잔여 '), node('b', '', String(remaining[o.id])), document.createTextNode(w.unit));
    } else {
      left.textContent = STATUS_LABEL[s];
    }
    return left;
  }

  function ctaFor(o) {
    if (!o) {
      const b = node('button', 'btn btn-primary', STATUS_LABEL.CLOSED);
      b.type = 'button';
      b.disabled = true;
      return b;
    }
    const s = statusOf(o);
    if (s === 'ON_SALE' || s === 'SOLD_OUT_WAITLIST') {
      const a = node('a', 'btn btn-primary', s === 'ON_SALE' ? w.cta : '대기 신청');
      a.href = `#/booking/${encodeURIComponent(o.id)}/select`;
      return a;
    }
    const b = node('button', 'btn btn-primary', STATUS_LABEL[s]);
    b.type = 'button';
    b.disabled = true;
    return b;
  }

  function drawCta() {
    const refundLink = node('a', 'btn btn-secondary', '취소/환불 규정');
    refundLink.href = `#/programs/${encodeURIComponent(program.id)}`;
    refundLink.dataset.target = 'refund';
    ctaDesktop.replaceChildren(ctaFor(selected), refundLink);
    if (selected) {
      const d = dateParts(selected.starts_at);
      const seq = offerings.filter((o) => dateParts(o.starts_at).key === d.key).indexOf(selected) + 1;
      const s = statusOf(selected);
      const left = s === 'ON_SALE' && typeof remaining[selected.id] === 'number'
        ? ` 잔여 ${remaining[selected.id]}${w.unit}` : ` ${STATUS_LABEL[s]}`;
      barInfo.replaceChildren(
        document.createTextNode(type === 'COURSE' ? `${kstShortDateWd(selected.starts_at)} 개강` : `${kstShortDateWd(selected.starts_at)} ${seq}회차`),
        node('b', '', `${hhmm(selected.starts_at)}${left}`),
      );
    } else {
      barInfo.replaceChildren(document.createTextNode('선택할 수 있는 회차가 없습니다.'));
    }
    bar.replaceChildren(barInfo, ctaFor(selected));
  }

  function select(o, slotButtons) {
    selected = o;
    for (const [id2, b] of slotButtons) {
      b.setAttribute('aria-checked', String(id2 === o.id));
      b.tabIndex = id2 === o.id ? 0 : -1;
    }
    drawCta();
  }

  function drawSlots(dateKey) {
    const list = type === 'COURSE' ? offerings : offerings.filter((o) => dateParts(o.starts_at).key === dateKey);
    const buttons = new Map();
    slotsBox.replaceChildren();
    list.forEach((o, i) => {
      const b = node('button', 'slot');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(selected?.id === o.id));
      b.tabIndex = selected?.id === o.id ? 0 : -1;
      const time = type === 'COURSE'
        ? `${kstDate(o.starts_at)} ${hhmm(o.starts_at)} 개강`
        : hhmm(o.starts_at);
      const sub = type === 'COURSE'
        ? `총 ${o.lessons?.length || 12}회, 매주 ${dateParts(o.starts_at).wd}요일`
        : `${i + 1}회차`;
      b.append(node('span', 's-time', time), node('span', 's-sub', sub), leftText(o));
      b.addEventListener('click', () => select(o, buttons));
      b.addEventListener('keydown', (e) => {
        const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        const next = list[(i + step + list.length) % list.length];
        select(next, buttons);
        buttons.get(next.id).focus();
      });
      buttons.set(o.id, b);
      slotsBox.append(b);
    });
    // 날짜를 바꾸면 그 날의 첫 회차를 고릅니다. 이미 그 날의 회차를 골랐으면 그대로 둡니다.
    if (list.length && !list.includes(selected)) select(list[0], buttons);
  }

  if (type !== 'COURSE' && offerings.length) {
    const days = [];
    for (const o of offerings) {
      const d = dateParts(o.starts_at);
      if (!days.some((x) => x.key === d.key)) days.push(d);
    }
    const multiMonth = new Set(days.map((d) => d.m)).size > 1;
    let currentKey = dateParts(selected.starts_at).key;
    const dateButtons = days.map((d) => {
      const b = node('button', 'date');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(d.key === currentKey));
      b.setAttribute('aria-label', d.label);
      b.append(node('small', '', kstDayChipLabel(d.iso, { withMonth: multiMonth })), node('b', '', d.d));
      b.addEventListener('click', () => {
        currentKey = d.key;
        dateButtons.forEach((x, i) => x.setAttribute('aria-pressed', String(days[i].key === currentKey)));
        drawSlots(currentKey);
      });
      return b;
    });
    dateBox.append(...dateButtons);
    pick.append(dateBox);
    drawSlots(currentKey);
  } else {
    drawSlots(null);
  }
  if (!offerings.length) pick.append(node('p', 'list-note', '지금 선택할 수 있는 회차가 없습니다. 다른 프로그램을 확인해 주세요.'));
  pick.append(slotsBox);
  drawCta();
  pick.append(ctaDesktop);
  info.append(pick);
  detail.append(posterBox, info);

  // 아래쪽: 탭과 본문
  const tabsNav = node('nav', 'tabs');
  tabsNav.setAttribute('aria-label', w.tabs);
  const prose = node('div', 'prose');
  const tabs = [];
  function section(idName, label, build) {
    const box = node('section', 'p-sec');
    box.id = idName;
    box.append(node('h3', '', label));
    build(box);
    prose.append(box);
    tabs.push([idName, label]);
  }

  const intro = Array.isArray(details.intro) ? details.intro : [];
  section('intro', w.intro, (box) => {
    if (!intro.length && program.description) box.append(node('p', '', program.description));
    for (const t of intro) box.append(node('p', '', t));
  });

  const items = Array.isArray(details.items) ? details.items : [];
  if (items.length) {
    section('program', details.items_title || '프로그램', (box) => {
      const ul = node('ul', 'program-list');
      for (const it of items) {
        const l = node('li', '', it.name);
        if (it.note) l.append(node('span', '', it.note));
        ul.append(l);
      }
      box.append(ul);
    });
  }

  const people = Array.isArray(details.people) ? details.people : [];
  if (people.length) {
    section('cast', '출연', (box) => {
      const ul = node('ul', 'cast');
      for (const p of people) {
        const l = node('li');
        l.append(node('b', '', p.name), node('span', '', p.role));
        ul.append(l);
      }
      box.append(ul);
    });
  }

  if (type === 'COURSE') {
    const lessons = [...(offerings[0]?.lessons ?? [])].sort((a, b) => a.seq - b.seq);
    if (lessons.length) {
      section('schedule', '수업 일정', (box) => {
        const ol2 = node('ol', 'lesson-list');
        for (const l of lessons) {
          const item = node('li');
          item.append(node('b', '', `${l.seq}회`), node('span', 'num', kstDateTime(l.starts_at)));
          ol2.append(item);
        }
        box.append(ol2);
      });
    }
  }

  const prices = offerings.flatMap((o) => (o.prices ?? []).map((p) => p.price));
  if (prices.length) {
    const lessonCount = offerings[0]?.lessons?.length || 12;
    section('refund', '취소/환불 규정', (box) => {
      box.append(refundTable(type, Math.max(...prices), lessonCount));
      const unit = type === 'PERFORMANCE' ? '공연' : type === 'EXPERIENCE' ? '체험' : '강좌';
      box.append(node('p', 'fine', `취소는 [내 예약]에서 직접 하실 수 있으며, 환불은 결제 수단으로 3 - 5영업일 안에 처리됩니다. 기관 사정으로 ${unit}이 취소되면 전액 환불합니다.`));
    });
  }

  if (details.guide) {
    section('guide', w.guide, (box) => {
      const note = node('div', 'note');
      note.insertAdjacentHTML('afterbegin', INFO_ICON);
      note.append(node('p', '', details.guide));
      box.append(note);
    });
  }

  for (const [idName, label] of tabs) {
    const a = node('a', '', label);
    a.href = `#/programs/${encodeURIComponent(program.id)}`;
    a.dataset.target = idName;
    a.setAttribute('aria-current', String(idName === tabs[0][0]));
    tabsNav.append(a);
  }

  const container = node('div', 'container');
  container.append(detail, tabsNav, prose);
  frag.append(topWrap, container, bar);
  release();
  el.replaceChildren(frag);

  // 같은 화면 안에서 위치만 옮깁니다(해시 라우터라 #id 주소는 쓰지 않습니다).
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  container.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-target]');
    if (!a) return;
    e.preventDefault();
    const target = el.querySelector(`#${a.dataset.target}`);
    target?.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    for (const t of tabsNav.children) t.setAttribute('aria-current', String(t.dataset.target === a.dataset.target));
  });

  if (typeof IntersectionObserver === 'function') {
    const io = new IntersectionObserver((entries) => {
      const hit = entries.filter((x) => x.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!hit) return;
      for (const t of tabsNav.children) t.setAttribute('aria-current', String(t.dataset.target === hit.target.id));
    }, { rootMargin: '-130px 0px -70% 0px' });
    for (const [idName] of tabs) io.observe(el.querySelector(`#${idName}`));
  }
}
