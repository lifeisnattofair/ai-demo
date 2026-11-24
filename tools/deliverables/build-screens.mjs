// 화면 설계서 PDF(HB-PMO-UI-01) 생성
// 사용: cd tools/deliverables && node screens-capture.mjs && node build-screens.mjs
//   - 캡처(screens-capture.mjs)는 로컬 앱과 Supabase 가 떠 있어야 하고, 결과를 deliverables/html/05_screens 에 둡니다.
//   - 이 스크립트는 그 캡처와 표시 번호 위치(markers.json), 화면 정의(screens-spec.mjs)로 PDF 를 만듭니다.
//   - REVIEW_DIR=폴더 를 주면 쪽마다 PNG 를 남깁니다(검토용).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { ROLE, SCREEN_LIST, SCREENS } from './screens-spec.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const OUT = resolve(root, 'deliverables');
const HTML_OUT = resolve(OUT, 'html');
const SHOT_DIR = resolve(HTML_OUT, '05_screens');
const SHOTS = resolve(root, 'portfolio/shots/deliverables');
for (const d of [OUT, HTML_OUT, SHOTS]) mkdirSync(d, { recursive: true });

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROJECT = '한빛아트센터 공연·교육 프로그램 통합 예약 플랫폼 구축';
const ISSUER = '(가상) 한빛시 문화재단 한빛아트센터';
const DOC_NO = 'HB-PMO-UI-01';
const VERSION = 'v1.1';
const DATE = '2026. 11. 24.';
const NAME = `05_화면설계서_${VERSION}`;
const css = readFileSync(resolve(here, 'template.css'), 'utf8');
const pagedPath = pathToFileURL(resolve(here, 'node_modules/pagedjs/dist/paged.polyfill.js')).href;
const markers = JSON.parse(readFileSync(resolve(SHOT_DIR, 'markers.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const byId = Object.fromEntries(SCREEN_LIST.map((s) => [s.id, s]));
const usersText = (u) => u.split(',').map((k) => ROLE[k]).join(', ');

function page({ title, docName, docNo, body, extraCss = '' }) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${css}${extraCss}</style>
<script>window.PagedConfig = { auto: true, after: () => { window.__pagedDone = true; } };</script>
<script src="${pagedPath}"></script></head><body>
${body.replace('<!--RUN-->', `<span class="run-project">${esc(PROJECT)}</span><span class="run-docname">${esc(docName)}</span><span class="run-docno">${esc(docNo)}</span>`)}</body></html>`;
}

/* ---------------- 표지, 개정 이력, 개요, 목차 ---------------- */
const cover = `<section class="cover"><!--RUN-->
<div class="docno">문서번호 ${DOC_NO}</div>
<div class="title-block"><div class="project">${esc(PROJECT)}</div><h1>화면 설계서</h1><div class="subtitle">사용자, 관리자 화면 목록과 화면 흐름, 공통 규칙, 화면별 설계</div></div>
<table class="meta"><tbody>
<tr><th>문서 버전</th><td>${VERSION}</td><th>작성일</th><td>${DATE}</td></tr>
<tr><th>발주기관</th><td colspan="3">${esc(ISSUER)}</td></tr>
<tr><th>작성</th><td>서비스 기획</td><th>보안 등급</th><td>일반</td></tr>
</tbody></table>
<div class="issuer">한빛시 문화재단</div></section>`;

const userCount = SCREEN_LIST.filter((s) => s.id.startsWith('UI-U')).length;
const adminCount = SCREEN_LIST.length - userCount;
const front = `<section class="front">
<h2 class="front-title">개정 이력</h2>
<table class="doc hist"><thead><tr><th>버전</th><th>일자</th><th>개정 내용</th><th>작성</th><th>검토/승인</th></tr></thead><tbody>
<tr><td class="center">v1.0</td><td class="center">2026. 11. 24.</td><td>최초 작성. 사용자 ${userCount}개, 관리자 ${adminCount}개 화면 정의, 화면 흐름과 공통 규칙, 주요 ${SCREENS.length}개 화면 상세 설계(프로토타입 화면 기준)</td><td class="center">서비스 기획</td><td class="center">발주기관 검토</td></tr>
<tr><td class="center">${VERSION}</td><td class="center">${DATE}</td><td>메인 화면(UI-U01) 개편 반영(대표 공연, 예매 현황판, 운영 정보 띠). 기관 로고, 본문 17px, 관리자 주요 수치 목록형(UI-A02, UI-A11) 반영을 위해 전 화면 재캡처</td><td class="center">서비스 기획</td><td class="center">발주기관 검토</td></tr>
</tbody></table>
<h2 class="front-title sub">문서 개요</h2>
<table class="doc overview"><tbody>
<tr><th>목적</th><td>요구사항정의서 v1.2(HB-PMO-REQ-01)의 기능 요구사항을 화면 단위로 나누어 화면 구성, 표시 내용, 동작, 처리 규칙, 오류와 빈 상태 안내를 정합니다. 개발, 테스트, 검수의 화면 기준 문서입니다.</td></tr>
<tr><th>범위</th><td>사용자 화면(공연 예매, 체험과 정규 강좌 신청, 대기, 마이페이지, 회원)과 관리자 화면(운영 담당, 정산 담당 업무). 결제대행 결제창과 본인확인기관 화면은 연계 지점만 표시합니다.</td></tr>
<tr><th>화면 기준</th><td>로컬 검수 환경의 프로토타입 화면을 시연 계정과 시연 데이터로 조작해 캡처했습니다(2026.11.24, PC 1440px 너비, 모바일 390 x 844). 캡처의 날짜와 금액은 시연 데이터 값입니다.</td></tr>
<tr><th>화면 ID</th><td>UI-U(사용자), UI-A(관리자) + 두 자리 번호. 경로는 해시 주소(#/...)이며 관리자 화면은 admin.html 아래에 있습니다.</td></tr>
<tr><th>표시 번호</th><td>화면별 설계의 캡처 위 빨간 원 번호는 오른쪽 설명 표의 번호와 같고, 가는 빨간 테두리는 그 항목의 영역입니다.</td></tr>
<tr><th>관련 문서</th><td>요구사항정의서 v1.2, 요구사항 추적표 v1.1(HB-PMO-TRC-01), 테스트 결과서 v1.0, DESIGN.md(디자인 기준)</td></tr>
</tbody></table></section>`;

/* ---------------- 1. 화면 목록 ---------------- */
function screenListHtml() {
  const roleCols = ['G', 'M', 'O', 'F'];
  const rows = SCREEN_LIST.map((s) => {
    const us = s.users.split(',');
    return `<tr><td class="center id">${s.id}</td><td>${esc(s.name)}</td><td class="path">${esc(s.path)}</td>${roleCols.map((r) => `<td class="center mark">${us.includes(r) ? '●' : ''}</td>`).join('')}<td class="reqs">${esc(s.reqs)}</td><td class="center pg">${s.detail ? `<a class="pgref" href="#s-${s.id}"></a>` : '-'}</td></tr>`;
  }).join('');
  return `<h2 class="chapter first" id="c1">1. 화면 목록</h2>
<p class="lead">사용자 ${userCount}개, 관리자 ${adminCount}개 화면입니다. 「설계 쪽」이 있는 화면은 4장에 화면별 설계를 두었고, 없는 화면은 같은 틀의 변형으로 4장의 관련 화면 비고에 적었습니다.</p>
<table class="doc slist"><thead><tr><th rowspan="2">화면 ID</th><th rowspan="2">화면명</th><th rowspan="2">경로</th><th colspan="4">사용자</th><th rowspan="2">관련 요구사항</th><th rowspan="2">설계 쪽</th></tr>
<tr>${roleCols.map((r) => `<th class="role">${ROLE[r]}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

/* ---------------- 2. 화면 흐름 ---------------- */
// 격자 흐름도: cells 는 {r, c, node|arrow|down|up|note}. 노드 열은 홀수, 화살표 열은 짝수입니다.
function flowGrid(nCols, cells, { rows = [] } = {}) {
  const cols = Array.from({ length: nCols * 2 - 1 }, (_, i) => (i % 2 === 0 ? 'minmax(0, 1fr)' : '12mm')).join(' ');
  const rowTpl = rows.length ? `grid-template-rows: ${rows.join(' ')};` : '';
  const html = cells.map((x) => {
    const pos = `grid-row:${x.r}${x.rs ? ` / span ${x.rs}` : ''};grid-column:${x.c}${x.cs ? ` / span ${x.cs}` : ''};`;
    if (x.node) {
      const [id, name, sub] = x.node;
      return `<div class="fn${x.tone ? ` ${x.tone}` : ''}" style="${pos}">${id ? `<span class="fid">${id}</span>` : ''}<b>${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
    }
    if (x.arrow !== undefined) return `<div class="fa" style="${pos}"><span>${esc(x.arrow)}</span></div>`;
    if (x.back !== undefined) return `<div class="fa back" style="${pos}"><span>${esc(x.back)}</span></div>`;
    if (x.down !== undefined) return `<div class="fd" style="${pos}"><span>${esc(x.down)}</span></div>`;
    if (x.up !== undefined) return `<div class="fd up" style="${pos}"><span>${esc(x.up)}</span></div>`;
    if (x.lane) return `<div class="flane" style="${pos}">${esc(x.lane)}</div>`;
    if (x.note) return `<div class="fnote" style="${pos}">${esc(x.note)}</div>`;
    return '';
  }).join('');
  return `<div class="fgrid" style="grid-template-columns:${cols};${rowTpl}">${html}</div>`;
}

function flowsHtml() {
  const N = (c) => c * 2 - 1; // 노드 열 번호 -> 격자 열
  const A = (c) => c * 2; // 노드 c 와 c+1 사이 화살표 열
  // 그림 1: 예매 기본 흐름
  const f1 = flowGrid(8, [
    { r: 1, c: N(1), node: ['UI-U01', '홈, 프로그램 목록', '유형, 기간, 대상'] },
    { r: 1, c: A(1), arrow: '카드' },
    { r: 1, c: N(2), node: ['UI-U02', '프로그램 상세', '날짜, 회차 선택'] },
    { r: 1, c: A(2), arrow: '다음' },
    { r: 1, c: N(3), node: ['UI-U03/U04', '좌석, 인원 선택', '1인 한도 4/4/1'] },
    { r: 1, c: A(3), arrow: '선점' },
    { r: 1, c: N(4), node: ['UI-U06', '할인 선택', '매수별 할인'] },
    { r: 1, c: A(4), arrow: '다음' },
    { r: 1, c: N(5), node: ['UI-U07', '결제', '수단, 약관 동의'] },
    { r: 1, c: A(5), arrow: '승인' },
    { r: 1, c: N(6), node: ['UI-U08', '결제 결과', '예약번호'] },
    { r: 1, c: A(6), arrow: '' },
    { r: 1, c: N(7), node: ['UI-U10', '내 예약', '예정, 지난, 취소'] },
    { r: 1, c: A(7), arrow: '' },
    { r: 1, c: N(8), node: ['UI-U11', '예약 상세, 취소', '환불 미리보기'] },
    { r: 2, c: N(2), down: '비회원' },
    { r: 2, c: N(3), up: '같은 회차로 복귀' },
    { r: 2, c: N(4), up: '돌아가기(선점 유지)' },
    { r: 2, c: N(5), down: '실패, 사용자 취소' },
    { r: 2, c: N(8), down: '취소 확정' },
    { r: 3, c: N(2), cs: 3, node: ['UI-U16', '로그인', '연락처 입력 미완료 계정은 UI-U15 3단계로'], tone: 'sub' },
    { r: 3, c: N(4), cs: 3, node: ['UI-U09', '결제 실패', '사유 안내, 선점은 남은 시간 동안 유지'], tone: 'sub' },
    { r: 3, c: N(6), cs: 3, node: ['', '선점 만료(10분)', '할인, 결제 단계에서 만료되면 좌석, 인원 선택으로'], tone: 'warn' },
    { r: 3, c: N(8), node: ['UI-U13', '알림함', '취소, 환불 알림'], tone: 'sub' },
  ], { rows: ['auto', '13mm', 'auto'] });

  // 그림 2: 매진, 대기 흐름
  const f2 = flowGrid(7, [
    { r: 1, c: N(1), node: ['UI-U02', '프로그램 상세', '매진 회차 「대기 신청」'] },
    { r: 1, c: A(1), arrow: '' },
    { r: 1, c: N(2), node: ['UI-U05', '대기 신청', '수량(한도, 정원 안)'] },
    { r: 1, c: A(2), arrow: '신청' },
    { r: 1, c: N(3), node: ['UI-U12', '대기 신청 목록', '순번, 대기 중'] },
    { r: 1, c: A(3), arrow: '충족' },
    { r: 1, c: N(4), node: ['', '자동 승격', '공연은 취소 좌석 그대로 배정'], tone: 'sys' },
    { r: 1, c: A(4), arrow: '알림' },
    { r: 1, c: N(5), node: ['UI-U13 / U10', '알림함, 승격 안내', '결제 기한 24시간'] },
    { r: 1, c: A(5), arrow: '결제' },
    { r: 1, c: N(6), node: ['UI-U06 > U07', '할인, 결제', '배정 수량 선점'] },
    { r: 1, c: A(6), arrow: '' },
    { r: 1, c: N(7), node: ['UI-U08', '결제 결과', '대기 완료'] },
    { r: 2, c: N(4), down: '기한 경과' },
    { r: 3, c: N(3), cs: 3, node: ['', '24시간 안에 결제하지 않음', '다음 순번으로 넘어감(1분 주기 처리)'], tone: 'warn' },
    { r: 3, c: N(5), cs: 3, node: ['', '기준일 D-2 이내', '취소분, 만료분은 일반 판매로 전환, 대기 신청 마감'], tone: 'warn' },
  ], { rows: ['auto', '13mm', 'auto'] });

  // 그림 3: 관리자 업무 흐름(역할별 레인)
  const f3 = flowGrid(6, [
    { r: 1, c: 1, rs: 1, lane: '운영 담당' },
    { r: 1, c: N(2), node: ['UI-A03/A04', '프로그램 등록', '유형, 공개, 할인 적용'] },
    { r: 1, c: A(2), arrow: '' },
    { r: 1, c: N(3), node: ['UI-A06', '회차 등록', '일시, 정원, 등급 가격, 판매 기간'] },
    { r: 1, c: A(3), arrow: '판매' },
    { r: 1, c: N(4), node: ['UI-A07 / A08', '예약 내역, 대기자', '증빙 확인, 순번'] },
    { r: 1, c: A(4), arrow: '취소' },
    { r: 1, c: N(5), node: ['UI-A10', '회차 취소 요청', '사유 입력, 새 예매 차단'] },
    { r: 1, c: A(5), arrow: '' },
    { r: 1, c: N(6), node: ['UI-A12', '작업 이력', '변경, 열람, 취소 기록'], tone: 'sub' },
    { r: 2, c: N(5), down: '승인 대기' },
    { r: 3, c: 1, lane: '정산 담당' },
    { r: 3, c: N(2), node: ['UI-A11', '정산 현황', '일별, 프로그램별, CSV'] },
    { r: 3, c: A(2), back: '' },
    { r: 3, c: N(3), node: ['UI-A09', '결제/환불 내역', '기관 취소 환불 확인'] },
    { r: 3, c: A(3), back: '' },
    { r: 3, c: N(4), node: ['', '일괄 환불', '확정 예약 전액, 대상자 알림'], tone: 'sys' },
    { r: 3, c: A(4), back: '승인' },
    { r: 3, c: N(5), node: ['UI-A10', '회차 취소 승인', '승인 또는 반려'] },
    { r: 4, c: N(5), down: '반려' },
    { r: 5, c: N(4), cs: 3, node: ['', '반려하면 회차가 다시 판매 중', '운영 담당 화면 목록에 「반려」 표시'], tone: 'sub' },
  ], { rows: ['auto', '13mm', 'auto', '11mm', 'auto'] });

  return `<h2 class="chapter" id="c2">2. 화면 흐름</h2>
<h3 id="c2-1">2-1. 예매 기본 흐름(사용자)</h3>
<p class="lead">모든 예약은 로그인한 회원만 할 수 있습니다. 좌석, 인원 선택에서 다음 단계로 넘어갈 때 10분 선점을 만들고, 할인, 결제 단계는 같은 머리말과 남은 선점 시간을 고정해 보입니다.</p>
${f1}
<h3 id="c2-2">2-2. 매진, 대기 승격 흐름(사용자)</h3>
${f2}
<div class="pg-break"></div>
<h3 id="c2-3">2-3. 회차 운영과 기관 사정 취소 흐름(관리자)</h3>
<p class="lead">운영 담당이 요청하고 정산 담당이 승인하는 2인 처리입니다. 요청 중에는 그 회차의 새 예매와 결제를 막고, 승인하면 확정 예약 전부를 결제 금액 그대로 환불하며 대상자에게 알림을 보냅니다.</p>
${f3}
<table class="doc legend-t"><thead><tr><th>표기</th><th>뜻</th></tr></thead><tbody>
<tr><td><span class="fn mini">화면</span></td><td>화면(위 작은 글자는 화면 ID)</td></tr>
<tr><td><span class="fn mini sys">처리</span></td><td>서버가 자동으로 하는 처리(승격, 일괄 환불)</td></tr>
<tr><td><span class="fn mini warn">조건</span></td><td>시간 조건에 따른 분기(선점 만료, 결제 기한, D-2)</td></tr>
<tr><td><span class="fn mini sub">보조</span></td><td>분기에서 이어지는 보조 화면</td></tr>
</tbody></table>`;
}

/* ---------------- 3. 공통 규칙 ---------------- */
function menuTree() {
  const G = [
    ['대시보드', [['대시보드', '#/', 1, 1, '전체']]],
    ['프로그램관리', [['프로그램 목록', '#/programs', 1, 0, '전체'], ['회차/좌석 관리', '#/offerings', 1, 0, '전체']]],
    ['예약관리', [['예약 내역', '#/bookings', 1, 1, '전체'], ['대기자 관리', '#/waitlist', 1, 0, '전체']]],
    ['결제/정산', [['결제/환불 내역', '#/payments', 0, 1, '전체'], ['회차 취소 승인', '#/cancel-requests', 1, 1, '전체(운영 담당은 요청, 정산 담당은 승인)'], ['정산 현황', '#/settlement', 0, 1, '전체']]],
    ['시스템', [['작업 이력', '#/audit', 1, 1, '전체'], ['검수용 시계', '#/system/clock', 1, 0, '검수, 로컬 환경'], ['시연 데이터 초기화', '#/system/reset', 1, 0, '공개 시연, 로컬 환경']]],
  ];
  const dot = (v) => (v ? '●' : '');
  const rows = G.map(([g, items]) => items.map(([m, path, o, f, env], i) => `<tr>${i === 0 ? `<td class="k" rowspan="${items.length}">${g}</td>` : ''}<td>${m}</td><td class="path">${path}</td><td class="c">${dot(o)}</td><td class="c">${dot(f)}</td><td>${env}</td></tr>`).join('')).join('');
  return `<table class="doc rules menu"><thead><tr><th>1depth 묶음</th><th>2depth 메뉴</th><th>경로</th><th>운영 담당</th><th>정산 담당</th><th>노출 환경</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function rulesHtml() {
  const t = (head, rows, cls = '') => `<table class="doc ${cls}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="k"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const sw = (hex) => `<span class="sw" style="background:${hex}"></span>${hex}`;
  return `<h2 class="chapter" id="c3">3. 공통 규칙</h2>
<p class="lead">아래 값은 프로토타입 소스(src/styles/tokens.css, user.css, admin.css, motion.css, src/lib/format.js, 공통 컴포넌트)와 DESIGN.md 에서 옮긴 것입니다. 사용자 화면은 KRDS 구조 위에 「포스터가 색을 맡고 UI는 물러나는」 편집형, 관리자 화면은 공공 관리자 표준 틀입니다.</p>
<h3 id="c3-1">3-1. 레이아웃 격자와 중단점</h3>
${t(['구분', 'PC (1440)', '태블릿 (768)', '모바일 (390)'], [
    ['본문 폭, 여백', '최대 1,280px 가운데 정렬, 좌우 여백 40px', '좌우 여백 4vw(약 31px)', '좌우 여백 16px'],
    ['프로그램 목록', '포스터 카드 3열(가로 간격 32px, 세로 48px)', '2열(860px 이하)', '2열, 필터는 세로로 쌓고 유형 버튼은 가로 스크롤(560px 이하)'],
    ['프로그램 상세', '포스터와 정보 2단, 포스터 따라옴', '포스터 240px + 정보 2단, 예매 버튼은 화면 아래 고정 바', '1단(포스터 최대 240px), 아래 고정 바'],
    ['예매 단계', '본문 + 오른쪽 요약 360px(1100px 이하 320px), 요약 고정', '1단, 요약은 본문 아래, 다음 단계 버튼은 아래 고정 바', '1단, 남은 선점 시간은 머리말 아래 띠, 좌석은 「좌석 목록」 기본'],
    ['마이페이지', '왼쪽 메뉴 220px + 본문', '메뉴가 밑줄 탭으로 바뀜(860px 이하)', '밑줄 탭, 카드 정보 1단'],
    ['관리자', '상단 바 56px + 좌측 메뉴 232px + 본문(여백 24/32px), 주요 수치 4열', '좌측 메뉴는 「메뉴」 버튼으로 여는 서랍(900px 이하), 조회 조건 1열, 통합 검색 숨김', '주요 수치 2열, 상단 바는 역할과 이름 숨김(560px 이하)'],
  ], 'rules')}
<p class="note">CSS 중단점: 사용자 1100, 860, 560px / 관리자 1180, 900, 560px. 모든 화면은 PC 1440px, 모바일 390px에서 가로 넘침이 없어야 합니다(QUR-003).</p>
<h3 id="c3-2">3-2. 헤더와 GNB(사용자)</h3>
${t(['영역', '규칙'], [
    ['헤더', '높이 72px, 화면 위에 고정(sticky). 왼쪽 로고(한빛아트센터, 한빛시 문화재단) - GNB - 오른쪽 회원 메뉴'],
    ['GNB 1depth', '공연, 체험, 정규 강좌, 이용 안내. 지금 있는 메뉴와 열린 메뉴는 아래 2px 선으로 표시'],
    ['GNB 2depth', '공연: 전체 공연, 이번 달 공연, 다음 달 공연 / 체험: 전체 체험, 가족 체험 / 정규 강좌: 전체 강좌, 수강 신청 안내 / 이용 안내: 취소/환불 규정, 관람 안내/오시는 길. 모든 2depth 는 실제 목록 필터나 안내 화면으로 연결'],
    ['키보드', 'Enter, Space 로 열고 닫음, 아래 화살표로 열고 첫 링크로 이동, 위아래 화살표는 링크 사이, 좌우 화살표는 1depth 사이, Esc 는 닫고 1depth 버튼으로 초점 복귀'],
    ['모바일', '860px 이하에서 GNB 대신 「전체 메뉴」 버튼(44px)과 아코디언 메뉴, 아래에 내 예약, 내 정보, 로그아웃'],
    ['회원 메뉴', '비회원: 로그인, 회원 가입 / 회원: 내 예약, 이름 님(내 정보), 로그아웃'],
  ], 'rules')}
<h3 id="c3-3">3-3. 관리자 좌측 메뉴 트리</h3>
${menuTree()}
<p class="note">역할이나 환경에 맞지 않는 메뉴는 그리지 않고, 하위 메뉴가 모두 빠진 묶음은 숨깁니다. 주소로 직접 들어오면 「이 메뉴를 쓸 권한이 없습니다」 또는 「이 환경에서는 쓸 수 없는 메뉴입니다」와 「대시보드로 이동」을 보입니다. 묶음 아이콘은 5개 묶음 머리에만 씁니다. 30분 동안 쓰지 않으면 자동 로그아웃합니다.</p>
<h3 id="c3-4">3-4. 색과 버튼 상태</h3>
${t(['요소', '기본', '마우스 올림(hover)', '누름(active)', '초점(focus)', '사용 불가(disabled)', '처리 중(busy)'], [
    ['주 버튼 btn-primary', `${sw('#256ef4')} 흰 글자, 높이 48px`, `${sw('#0b50d0')}`, `${sw('#083891')}, 1px 아래로`, '2px #256ef4 바깥선, 간격 2px', '회색 바탕 #cdd1d5, aria-disabled="true", 커서 not-allowed', '스피너 + 「처리 중」, 너비 유지, aria-busy, 중복 클릭 무시'],
    ['보조 버튼 btn-secondary', '흰 바탕, #cdd1d5 테두리', '#f4f5f6 바탕, 테두리 진하게', '#e6e8ea 바탕, 1px 아래로', '같음', '흰 바탕, 흐린 글자 #58616a', '같음'],
    ['글자 버튼 btn-text', '#0b50d0 글자, 높이 44px', '#ecf2fe 바탕, 밑줄', '#083891', '같음', '-', '-'],
    ['위험 버튼', '#de3412 계열(회원 탈퇴, 시연 데이터 초기화, 회차 취소 승인 확인)', '진하게 #9d230b', '#7d1c08', '같음', '-', '같음'],
    ['좌석, 카드', '등급 색 R #3b4f6b, S #7a8ea8, A #b9c5d3, 판매 완료 #dfe2e5', '2px 위로 뜸', '제자리', '같음', '판매, 선점 좌석 not-allowed', '-'],
  ], 'rules states')}
<p class="note">행동 색은 KRDS primary #256ef4 하나만 씁니다. 상태 칩(확정, 취소, 대기, 승격 등)과 경고에만 다른 색을 쓰고 항상 글자를 함께 씁니다. 전환은 색, 배경, 테두리만 160ms, 움직임은 세로 이동 한 종류이며 「동작 줄이기」 설정이면 모두 끕니다. 누를 수 있는 요소는 최소 44px(기본 버튼 48px)입니다.</p>
<h3 id="c3-5">3-5. 불러오기(스켈레톤)와 처리 중</h3>
${t(['항목', '규칙'], [
    ['스켈레톤', '300ms 안에 끝나면 그리지 않아 깜빡이지 않음. 실제 화면 모양을 따라 그림: 목록 카드(cards), 상세(detail), 좌석 배치도(seat-map), 표(table), 양식(form), 세로 목록(list), 수치 카드(kpis), 막대 그래프(chart)'],
    ['접근성', '불러오는 영역에 바로 aria-busy="true", 모양이 나타날 때 화면 낭독용 「불러오는 중」 문구'],
    ['처리 중 버튼', '서버 요청 동안 스피너와 「처리 중」, 버튼 너비 유지, 같은 동작의 다른 버튼(모바일 아래 바)도 함께 잠금'],
  ], 'rules')}
<h3 id="c3-6">3-6. 빈 상태와 오류 안내 문구</h3>
${t(['상황', '안내(제목 / 다음 행동)'], [
    ['목록 결과 없음', '「조건에 맞는 프로그램이 없습니다.」 / 「조건 초기화」, 관리자 「조건에 맞는 예약이 없습니다.」 / 「기간을 넓히거나 조회 조건을 초기화해 주세요.」'],
    ['마이페이지 빈 목록', '「예정된 예약이 없습니다.」, 「대기 신청한 내역이 없습니다.」, 「받은 알림이 없습니다.」 / 「예매할 공연, 강좌 찾기」'],
    ['불러오기 실패', '「프로그램 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.」 / 「다시 시도」, 관리자 「목록을 불러오지 못했습니다.」 + 원인 / 「다시 시도」'],
    ['한도 초과', '「1인 예약 한도를 넘었습니다. 남은 수량 안에서 선택해 주세요.」'],
    ['선점 만료', '「선점 시간이 지나 좌석이 해제되었습니다. 다시 선택해 주세요.」 / 「좌석 다시 선택」'],
    ['좌석 충돌', '「방금 다른 분이 선택한 좌석입니다. 다른 좌석을 선택해 주세요.」'],
    ['매진', '「매진되었습니다. 대기 신청을 하실 수 있습니다.」'],
    ['결제 실패', '「결제가 완료되지 않았습니다.」 + 사유, 「선점은 남은 시간 동안 유지됩니다.」 / 「할인 선택으로 돌아가기」'],
    ['내려받기 0건', '「내려받을 내역이 없습니다. 조회 조건을 바꿔 다시 조회한 뒤 내려받아 주세요.」'],
  ], 'rules')}
<p class="note">오류 문구는 원인과 다음 행동을 함께 쓰고, 서버 내부 정보(오류 원문, 코드)는 화면에 보이지 않고 콘솔에만 남깁니다(SER-008, QUR-007). 입력 오류는 칸 아래에 쓰고 첫 오류 칸으로 초점을 옮깁니다.</p>
<h3 id="c3-7">3-7. 날짜, 금액, 개인정보 표기</h3>
${t(['항목', '형식', '예'], [
    ['날짜(전체)', '연.월.일(요일), 0 채움 점 형식', '2026.12.01(화)'],
    ['일시', '날짜 + 24시간 시각', '2026.12.01(화) 19:30'],
    ['짧은 날짜, 일정', '월.일 / 월.일(요일) 시각', '12.01 / 12.01(화) 19:30'],
    ['기간', '시작 - 끝(같은 해면 끝의 연도 생략, 하이픈 앞뒤 띄움)', '2026.12.12 - 12.13'],
    ['시간대', '저장은 UTC, 표시와 D-day 판단은 한국 표준시(KST) 달력 날짜(DAR-004)', '관람 12.10, 취소 12.03 은 D-7'],
    ['금액', '원 단위 정수, 천 단위 쉼표, 숫자 뒤 「원」. 표에서는 오른쪽 정렬, 고정폭 숫자', '40,000원'],
    ['금액 계산', '할인액은 매수별 원 미만 버림, 환불액 = 결제액 x 환불 비율의 원 미만 버림, 수수료 = 결제액 - 환불액(DAR-003)', '12,345원 D-7: 환불 11,110원, 수수료 1,235원'],
    ['휴대폰', '010-0000-0000 하이픈 형식', '010-1234-5678'],
    ['개인정보 가림(관리자 목록)', '이름은 첫 글자와 끝 글자만, 2글자면 끝 글자 가림. 휴대폰은 앞 3자리와 뒤 4자리만(SER-005)', '김*수, 이*, 010-****-5678'],
    ['관리자 날짜 입력', '브라우저 기본 날짜 입력(DESIGN.md 허용 예외), 입력 밖은 점 형식', '2026-11-18 입력, 2026.11.18 표시'],
  ], 'rules fmt')}
<h3 id="c3-8">3-8. 접근성(KWCAG 2.2, QUR-001)</h3>
${t(['항목', '규칙'], [
    ['건너뛰기', '첫 Tab 에 「본문으로 건너뛰기」, 누르면 본문으로 초점 이동'],
    ['초점 표시', '모든 누르는 요소에 2px #256ef4 바깥선(focus-visible). 화면을 옮기면 맨 위에서 시작'],
    ['키보드만으로 예약', '좌석 배치도는 화살표 이동, Enter 선택, Space 해제, Tab 은 배치도 안에서 한 곳에만 멈춤. 같은 선택을 「좌석 목록」 표(체크 상자)로도 제공'],
    ['알림 읽기', '오류는 role="alert", 결과와 건수 변화는 role="status" 또는 aria-live="polite". 같은 안내는 되풀이해 만들지 않음. 남은 선점 시간은 분이 바뀔 때만 읽음'],
    ['대체 텍스트', '포스터 장식 사진은 빈 대체 텍스트, 그래프는 같은 내용을 글로 담은 aria-label, 아이콘만 있는 버튼은 aria-label(예: 「R석 E열 6번 선택 해제」)'],
    ['대비와 색', '본문 글자 대비 4.5:1 이상(보조 글자 #58616a 는 흰 바탕 6.3:1), 포스터 글자는 사진 위아래 막으로 4.5:1 유지, 색만으로 상태를 전하지 않음'],
    ['누름 영역', '최소 44 x 44px. 좌석 배치도 좌석(18-22px)은 허용 예외이며 768px 이하에서 44px 좌석 목록을 기본으로 엶'],
  ], 'rules')}`;
}

/* ---------------- 4. 화면별 설계 ---------------- */
function screenPage(s) {
  const meta = byId[s.id];
  const m = markers[s.id];
  if (!m) throw new Error(`${s.id} 캡처 없음: node screens-capture.mjs 를 먼저 실행하세요.`);
  const img = (f) => `05_screens/${f}`;
  const pc = m.pc;
  const marks = pc.markers.map((k) => {
    if (!k.found) return '';
    const R = 14; // px(원본 좌표 기준 반지름 근사). 원은 요소 왼쪽 위 모서리 바깥쪽으로 조금 비켜 둡니다.
    const cx = Math.min(Math.max(k.x - 8, R), pc.w - R);
    const cy = Math.min(Math.max(k.y - 6, R), pc.h - R);
    const box = k.noBox ? '' : `<i class="mbox" style="left:${(k.x / pc.w) * 100}%;top:${(k.y / pc.h) * 100}%;width:${(Math.min(k.w, pc.w - k.x) / pc.w) * 100}%;height:${(Math.min(k.h, pc.h - k.y) / pc.h) * 100}%"></i>`;
    return `${box}<b class="mk" style="left:${(cx / pc.w) * 100}%;top:${(cy / pc.h) * 100}%">${k.n}</b>`;
  }).join('');
  const hasSide = Boolean(m.mobile);
  const hasInset = Boolean(m.inset);
  const pcFig = `<figure class="shot pc"><div class="frame" style="aspect-ratio:${pc.w} / ${pc.h}"><img src="${img(pc.file)}" alt="">${marks}</div><figcaption>PC 1440</figcaption></figure>`;
  const mobileFig = hasSide ? `<figure class="shot mo"><div class="frame" style="aspect-ratio:${m.mobile.w} / ${m.mobile.h}"><img src="${img(m.mobile.file)}" alt=""></div><figcaption>모바일 390</figcaption></figure>` : '';
  const insetFig = hasInset ? `<figure class="shot inset"><div class="frame" style="aspect-ratio:${m.inset.w} / ${m.inset.h}"><img src="${img(m.inset.file)}" alt=""></div><figcaption>${esc(m.inset.label)}</figcaption></figure>` : '';
  const rows = s.items.map((it, i) => `<tr><td class="n"><b class="mk inline">${i + 1}</b></td><td class="t">${esc(it.title)}</td><td>${esc(it.desc)}</td></tr>`).join('');
  return `<section class="screen" id="s-${s.id}">
<table class="shead"><tbody>
<tr><th>화면 ID</th><td class="sid">${s.id}</td><th>화면명</th><td class="sname">${esc(meta.name)}</td><th>사용자</th><td>${esc(usersText(meta.users))}</td></tr>
<tr><th>경로</th><td colspan="3" class="path">${esc(meta.path)}</td><th>관련 요구사항</th><td>${esc(meta.reqs)}</td></tr>
</tbody></table>
<h3 class="sr" id="t-${s.id}">${s.id} ${esc(meta.name)}</h3>
<div class="sbody${hasSide ? ' with-mo' : ''}${hasInset ? ' with-inset' : ''}">
  <div class="shots">${pcFig}${mobileFig}${insetFig}</div>
  <table class="doc desc"><thead><tr><th>번호</th><th>항목</th><th>설명(표시 내용, 동작, 처리 규칙, 오류/빈 상태)</th></tr></thead><tbody>${rows}</tbody></table>
</div>
${s.note ? `<p class="snote"><b>비고</b>${esc(s.note)}</p>` : ''}
</section>`;
}

function screensHtml() {
  const users = SCREENS.filter((s) => s.id.startsWith('UI-U'));
  const admins = SCREENS.filter((s) => s.id.startsWith('UI-A'));
  return `<h2 class="chapter" id="c4">4. 화면별 설계</h2>
<p class="lead">주요 ${SCREENS.length}개 화면(사용자 ${users.length}, 관리자 ${admins.length})의 실제 화면과 항목별 설계입니다. 캡처는 PC 1440px 너비 기준이며, 모바일에서 배치가 크게 바뀌는 화면은 390px 캡처를 함께 두었습니다.</p>
<table class="doc s4"><thead><tr><th>구분</th><th>화면</th></tr></thead><tbody>
<tr><td class="k">사용자</td><td>${users.map((s) => `${s.id} ${esc(byId[s.id].name)}`).join(', ')}</td></tr>
<tr><td class="k">관리자</td><td>${admins.map((s) => `${s.id} ${esc(byId[s.id].name)}`).join(', ')}</td></tr>
</tbody></table>
${SCREENS.map(screenPage).join('\n')}`;
}

function tocHtml() {
  const e = [
    [2, '1. 화면 목록', 'c1'], [2, '2. 화면 흐름', 'c2'], [3, '2-1. 예매 기본 흐름(사용자)', 'c2-1'], [3, '2-2. 매진, 대기 승격 흐름(사용자)', 'c2-2'], [3, '2-3. 회차 운영과 기관 사정 취소 흐름(관리자)', 'c2-3'],
    [2, '3. 공통 규칙', 'c3'], [3, '3-1. 레이아웃 격자와 중단점', 'c3-1'], [3, '3-2. 헤더와 GNB(사용자)', 'c3-2'], [3, '3-3. 관리자 좌측 메뉴 트리', 'c3-3'], [3, '3-4. 색과 버튼 상태', 'c3-4'],
    [3, '3-5. 불러오기(스켈레톤)와 처리 중', 'c3-5'], [3, '3-6. 빈 상태와 오류 안내 문구', 'c3-6'], [3, '3-7. 날짜, 금액, 개인정보 표기', 'c3-7'], [3, '3-8. 접근성(KWCAG 2.2, QUR-001)', 'c3-8'],
    [2, '4. 화면별 설계', 'c4'],
  ];
  const left = e.map(([l, t, id]) => `<li class="l${l}"><a href="#${id}">${esc(t)}</a><span class="leader"></span><a class="pg" href="#${id}"></a></li>`).join('');
  const right = SCREENS.map((s) => `<li class="l3"><a href="#s-${s.id}">${s.id} ${esc(byId[s.id].name)}</a><span class="leader"></span><a class="pg" href="#s-${s.id}"></a></li>`).join('');
  return `<section class="front toc"><h2 class="front-title">목 차</h2><div class="toc-cols"><ol>${left}</ol><ol class="scr">${right}</ol></div></section>`;
}

const extraCss = `
@page { size: A4 landscape; margin: 17mm 14mm 13mm 14mm; }
.cover { height: 178mm; }
.cover .title-block { margin-top: 34mm; }
.cover .issuer { margin-top: 9mm; }
h2.front-title.sub { margin-top: 8mm; }
table.hist td:nth-child(3) { width: 55%; }
table.overview th { width: 26mm; text-align: left; white-space: nowrap; }
.lead { color: var(--ink-2); margin: 0 0 3mm; }
.pg-break { break-after: page; }
h3 { margin: 5mm 0 2.5mm; }

/* 목차 */
.toc-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12mm; }
.toc li { margin: 1.1mm 0; font-size: 9pt; }
.toc li.l2 { margin-top: 2.6mm; }
.toc ol.scr li.l3 { padding-left: 0; }

/* 화면 목록 */
table.slist { font-size: 8.2pt; }
table.slist td { padding: 1.2mm 2mm; vertical-align: middle; }
table.slist td.id { font-weight: 700; color: var(--navy); }
table.slist td.path { font-size: 7.8pt; color: var(--ink-2); word-break: break-all; }
table.slist td.mark { color: var(--navy); width: 13mm; }
table.slist th.role { font-size: 7.8pt; }
table.slist td.reqs { font-size: 7.8pt; }
table.slist td.pg { width: 12mm; }
a.pgref { color: inherit; text-decoration: none; }
a.pgref::after { content: target-counter(attr(href url), page); }

/* 흐름도 */
.fgrid { display: grid; align-items: stretch; margin: 2mm 0 4mm; padding: 4mm; border: 0.5pt solid var(--rule-soft); background: #fbfcfd; break-inside: avoid; }
.fn { border: 0.7pt solid #5c6b80; background: #fff; border-radius: 1.2mm; padding: 1.6mm 2mm; display: flex; flex-direction: column; justify-content: center; min-height: 15mm; }
.fn .fid { font-size: 6.6pt; color: #5c6b80; font-weight: 700; letter-spacing: 0.02em; }
.fn b { font-size: 8.6pt; color: var(--ink); line-height: 1.35; }
.fn small { font-size: 7pt; color: var(--muted); line-height: 1.35; margin-top: 0.5mm; }
.fn.sys { background: #eef3fb; border-color: #3d6fb6; }
.fn.warn { background: #fff7e8; border-color: #b07a12; border-style: dashed; }
.fn.sub { background: #f4f5f6; border-color: #9aa3ae; }
.fn.mini { display: inline-flex; min-height: 0; padding: 0.6mm 3mm; font-size: 7.6pt; }
.fa { position: relative; display: flex; align-items: center; justify-content: center; }
.fa::before { content: ""; position: absolute; left: 0.8mm; right: 1.6mm; top: 50%; border-top: 0.8pt solid #44505f; }
.fa::after { content: ""; position: absolute; right: 0.6mm; top: 50%; transform: translateY(-50%); border: 1.3mm solid transparent; border-left: 1.8mm solid #44505f; border-right: 0; }
.fa.back::after { right: auto; left: 0.4mm; border-left: 0; border-right: 1.8mm solid #44505f; border-top-color: transparent; border-bottom-color: transparent; }
.fa.back::before { left: 1.8mm; right: 0.8mm; }
.fa span { position: relative; top: -2.6mm; font-size: 6.4pt; color: var(--ink-2); background: #fbfcfd; padding: 0 0.4mm; white-space: nowrap; z-index: 1; }
.fd { position: relative; display: flex; align-items: center; justify-content: flex-start; }
.fd::before { content: ""; position: absolute; left: 50%; top: 0.6mm; bottom: 2mm; border-left: 0.8pt solid #44505f; }
.fd::after { content: ""; position: absolute; left: 50%; bottom: 0.4mm; transform: translateX(-50%); border: 1.2mm solid transparent; border-top: 1.8mm solid #44505f; border-bottom: 0; }
.fd.up::after { bottom: auto; top: 0.2mm; border-top: 0; border-bottom: 1.8mm solid #44505f; }
.fd.up::before { top: 2mm; bottom: 0.6mm; }
.fd span { position: relative; left: calc(50% + 1.6mm); font-size: 6.6pt; color: var(--ink-2); white-space: nowrap; }
.flane { display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 8.6pt; color: var(--navy); background: var(--head); border: 0.5pt solid var(--rule); }
table.legend-t { width: auto; font-size: 8pt; }
table.legend-t td { vertical-align: middle; }

/* 공통 규칙 표 */
table.rules { font-size: 8.2pt; }
table.rules td { padding: 1.3mm 2mm; }
table.rules td.k { font-weight: 700; color: var(--ink-2); white-space: nowrap; background: #fafbfc; }
table.menu td.c { text-align: center; color: var(--navy); width: 20mm; } table.menu td.path { color: var(--ink-2); } table.rules tr, table.rules { break-inside: avoid; }
table.states td { font-size: 7.8pt; }
.sw { display: inline-block; width: 3mm; height: 3mm; border-radius: 0.6mm; margin-right: 1mm; vertical-align: -0.4mm; border: 0.3pt solid rgba(0,0,0,.2); }
.note { margin: -2mm 0 3mm; }
table.s4 td.k { width: 20mm; font-weight: 700; }

/* 화면별 설계 */
section.screen { break-before: page; height: 179mm; display: flex; flex-direction: column; }
h3.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; margin: 0; }
table.shead { width: 100%; border-collapse: collapse; font-size: 8.4pt; margin-bottom: 2.6mm; }
table.shead th, table.shead td { border: 0.5pt solid var(--rule); padding: 1.2mm 2mm; text-align: left; vertical-align: middle; }
table.shead th { background: var(--head); color: var(--ink-2); white-space: nowrap; width: 20mm; }
table.shead td.sid { font-weight: 700; color: var(--navy); width: 22mm; }
table.shead td.sname { font-weight: 700; }
table.shead td.path { font-size: 8pt; color: var(--ink-2); }
.sbody { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 98mm; gap: 4.5mm; align-items: start; }
.shots { display: flex; gap: 3mm; align-items: flex-start; flex-wrap: wrap; height: 100%; align-content: flex-start; }
.shot { margin: 0; display: flex; flex-direction: column; }
.shot .frame { position: relative; border: 0.5pt solid #b9c0ca; background: #fff; overflow: hidden; }
.shot .frame img { display: block; width: 100%; height: 100%; }
.shot figcaption { font-size: 6.8pt; color: var(--muted); margin-top: 0.8mm; }
.with-mo .shot.mo .frame { width: 35mm; }
/* 이미지 상자 크기: 너비 우선, 높이 제한을 넘으면 높이에 맞춤 */
.shot.pc .frame, .shot.inset .frame { width: min(var(--wmax), calc(var(--hmax) * var(--ar))); }
.mk { position: absolute; transform: translate(-50%, -50%); width: 4.4mm; height: 4.4mm; border-radius: 50%; background: #d7261e; color: #fff; font: 700 7pt/4.4mm "Malgun Gothic", sans-serif; text-align: center; box-shadow: 0 0 0 0.5pt #fff; z-index: 3; }
.mk.inline { position: static; display: inline-block; transform: none; }
.mbox { position: absolute; border: 0.9pt solid rgba(215, 38, 30, 0.85); border-radius: 0.6mm; z-index: 2; }
table.desc { font-size: 7.8pt; margin: 0; }
table.desc th { padding: 1.2mm 1.6mm; }
table.desc td { padding: 1.2mm 1.8mm; line-height: 1.5; }
table.desc td.n { width: 8mm; text-align: center; vertical-align: top; }
table.desc td.t { width: 21mm; font-weight: 700; color: var(--ink-2); }
p.snote { margin: 2mm 0 0; font-size: 7.8pt; color: var(--ink-2); border-top: 0.5pt solid var(--rule-soft); padding-top: 1.6mm; }
p.snote b { color: var(--navy); margin-right: 2mm; }
`;

// 이미지 상자 크기를 비율로 정합니다(CSS 변수).
function sizeVars(html) {
  return html.replace(/<div class="frame" style="aspect-ratio:(\d+) \/ (\d+)">/g, (all, w, h) => `<div class="frame" style="aspect-ratio:${w} / ${h};--ar:${(w / h).toFixed(5)}">`);
}

function buildHtml() {
  const body = cover + front + tocHtml() + screenListHtml() + flowsHtml() + rulesHtml() + screensHtml();
  return page({ title: '화면 설계서', docName: `화면 설계서 ${VERSION}`, docNo: DOC_NO, body: sizeVars(body), extraCss: extraCss + `
.shot.pc .frame { --wmax: 164mm; --hmax: 138mm; }
.with-mo .shot.pc .frame { --wmax: 124mm; --hmax: 138mm; }
.with-inset .shot.pc .frame { --wmax: 164mm; --hmax: 96mm; }
.shot.inset .frame { --wmax: 164mm; --hmax: 36mm; }
` });
}

async function renderPdf(browser, html, name, shotPages = []) {
  const htmlFile = resolve(HTML_OUT, `${name}.html`);
  writeFileSync(htmlFile, html);
  const pg = await browser.newPage();
  await pg.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
  await pg.waitForFunction('window.__pagedDone === true', { timeout: 180000 });
  await pg.pdf({ path: resolve(OUT, `${name}.pdf`), preferCSSPageSize: true, printBackground: true });
  const pages = await pg.$$('.pagedjs_page');
  await pg.setViewport({ width: 1754, height: 1240, deviceScaleFactor: 1.5 });
  if (process.env.REVIEW_DIR) for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: resolve(process.env.REVIEW_DIR, `${name}_${String(i + 1).padStart(2, '0')}.png`), type: 'png' });
  for (const n of shotPages) {
    if (!pages[n - 1]) continue;
    await pages[n - 1].screenshot({ path: resolve(SHOTS, `${name}_p${String(n).padStart(2, '0')}.webp`), type: 'webp', quality: 82 });
  }
  // 화면별 설계 쪽 번호(포트폴리오 캡처 고르기용)
  const map = await pg.evaluate(() => [...document.querySelectorAll('.pagedjs_page')].map((p, i) => ({ n: i + 1, id: p.querySelector('section.screen')?.id ?? null, h: p.querySelector('h2')?.textContent ?? null })));
  await pg.close();
  return { count: pages.length, map };
}

const shotPages = (process.env.SHOT_PAGES ?? '').split(',').filter(Boolean).map(Number);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--allow-file-access-from-files'] });
try {
  const r = await renderPdf(browser, buildHtml(), NAME, shotPages);
  console.log(JSON.stringify({ pages: r.count, screens: SCREENS.length, map: r.map.filter((x) => x.id || x.h).map((x) => `${x.n}:${x.id ?? x.h}`) }));
} finally {
  await browser.close();
}
