// 1단계 산출물 생성: 요구사항정의서 PDF, 기획 점검표 PDF, 요구사항 추적표 XLSX
// 사용: cd tools/deliverables && npm run build
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';
import ExcelJS from 'exceljs';
import puppeteer from 'puppeteer-core';
import { loadQa, normalizeResult } from './qa-data.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const OUT = resolve(root, 'deliverables');
const HTML_OUT = resolve(OUT, 'html');
const SHOTS = resolve(root, 'portfolio/shots/deliverables');
for (const d of [OUT, HTML_OUT, SHOTS]) mkdirSync(d, { recursive: true });

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROJECT = '한빛아트센터 공연·교육 프로그램 통합 예약 플랫폼 구축';
const ISSUER = '(가상) 한빛시 문화재단 한빛아트센터';
const css = readFileSync(resolve(here, 'template.css'), 'utf8');
const pagedPath = pathToFileURL(resolve(here, 'node_modules/pagedjs/dist/paged.polyfill.js')).href;

// 범위 표기(D-7~D-4)의 ~가 취소선으로 바뀌지 않게 escape
const read = (p) => readFileSync(resolve(root, p), 'utf8').replace(/~/g, '\\~');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => marked.parseInline(String(s ?? ''));
const tokensOf = (md) => marked.lexer(md);
const cellText = (c) => (typeof c === 'string' ? c : c.text);
const plain = (s) => String(s ?? '').replace(/\\~/g, '~').replace(/\*\*/g, '');

function page({ title, docName, docNo, body, extraCss = '' }) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${css}${extraCss}</style>
<script>window.PagedConfig = { auto: true, after: () => { window.__pagedDone = true; } };</script>
<script src="${pagedPath}"></script></head><body>
${body.replace('<!--RUN-->', `<span class="run-project">${esc(PROJECT)}</span><span class="run-docname">${esc(docName)}</span><span class="run-docno">${esc(docNo)}</span>`)}</body></html>`;
}

function docTable(tok, { numericCols = [], centerCols = [] } = {}) {
  const head = tok.header.map((h, i) => `<th class="${numericCols.includes(i) ? 'num' : ''}">${inline(cellText(h))}</th>`).join('');
  const rows = tok.rows.map((r) => '<tr>' + r.map((c, i) => {
    const cls = numericCols.includes(i) ? 'num' : centerCols.includes(i) ? 'center' : '';
    return `<td class="${cls}">${inline(cellText(c))}</td>`;
  }).join('') + '</tr>').join('');
  const numbered = cellText(tok.header[0]) === '#';
  const area = cellText(tok.header[1] ?? '') === '영역';
  return `<table class="doc${numbered ? ' numbered' : ''}${area ? ' area' : ''}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

/* ---------------- 요구사항정의서 ---------------- */
const CATEGORY = { SFR: '기능 요구사항', PER: '성능 요구사항', SER: '보안 요구사항', DAR: '데이터 요구사항', SIR: '인터페이스 요구사항', QUR: '품질 요구사항', COR: '제약사항' };
const OUTPUTS = {
  SFR: '화면 설계서, 프로그램 소스, 단위/통합 테스트 결과서',
  PER: '성능 목표 정의(PER-004는 동시성 시험 결과서)',
  SER: '보안 점검 결과, 테스트 결과서',
  DAR: '테이블 정의서, 코드 정의서',
  SIR: '인터페이스 정의서, 테스트 결과서',
  QUR: '접근성 점검 결과, 테스트 결과서, 요구사항 추적표',
  COR: '사업 수행 계획서, 산출물 목록',
};

function flowDiagram() {
  const lane = (actor, steps, sub) => `<div class="lane"><div class="actor">${actor}</div><div class="steps">${steps.map((s) => `<span class="step">${s}</span>`).join('<span class="arrow">→</span>')}</div></div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
  return `<div class="flow">
${lane('사용자(회원)', ['프로그램 목록', '상세, 회차', '좌석/인원', '할인', '결제', '예약 확인', '취소, 환불'], '매진 시: 대기 신청 → 승격 알림 → 24시간 안에 결제')}
${lane('운영 담당', ['프로그램 관리', '회차, 정원, 좌석 등급', '예약 내역', '회차 취소 요청'])}
${lane('정산 담당', ['결제, 환불 내역', '회차 취소 승인(일괄 환불)', '정산 현황(CSV)'])}
${lane('외부 연계', ['결제대행 어댑터(승인, 취소, 조회, 웹훅)', '회원 인증'], '프로토타입은 모의 결제 어댑터를 사용하며, 실사업 시 결제대행사 어댑터로 교체')}
</div>`;
}

function buildRequirements() {
  const md = read('docs/superpowers/specs/2026-11-23-booking-platform-requirements.md');
  const body = md.split(/\n---\n/).slice(1).join('\n---\n');
  const toks = tokensOf(body);

  // 검수 기준(AC) 표
  const acMap = {};
  for (const t of toks) if (t.type === 'table' && cellText(t.header[0]) === '번호') for (const r of t.rows) acMap[cellText(r[0])] = cellText(r[1]);

  const toc = [];
  let html = '';
  let firstChapter = true;
  let idn = 0;
  const reqRows = [];
  for (const t of toks) {
    if (t.type === 'hr' || t.type === 'space') continue;
    if (t.type === 'heading') {
      const id = `h${++idn}`;
      const text = t.text;
      if (t.depth === 2) { toc.push({ lvl: 2, text, id }); html += `<h2 class="chapter${firstChapter ? ' first' : ''}" id="${id}">${inline(text)}</h2>`; firstChapter = false; }
      else if (t.depth === 3) { toc.push({ lvl: 3, text, id }); html += `<h3 id="${id}">${inline(text)}</h3>`; }
      else html += `<h4>${inline(text)}</h4>`;
      continue;
    }
    if (t.type === 'paragraph' && /^\*\*\d+-\d+\./.test(t.raw.trim())) { html += `<h4>${inline(t.raw.trim().replace(/^\*\*|\*\*$/g, ''))}</h4>`; continue; }
    if (t.type === 'code') { html += flowDiagram(); continue; }
    if (t.type === 'table') {
      const first = cellText(t.rows[0]?.[0] ?? '');
      if (/^[A-Z]{3}-\d{3}$/.test(first)) {
        for (const r of t.rows) {
          const [id, name, detail, ac] = r.map(cellText);
          const pre = id.slice(0, 3);
          reqRows.push({ id, name, detail, ac: ac ?? '' });
          const acText = (ac ?? '').split(/,\s*/).filter(Boolean).map((a) => acMap[a] ? `${a} ${acMap[a]}` : a).join('<br>');
          const parts = detail.split(/(?<=[다음함됨음])\.\s+|\.\s+(?=[가-힣A-Z])/).filter(Boolean);
          const detailHtml = parts.length > 1 ? `<ul>${parts.map((p) => `<li>${inline(p.replace(/\.$/, ''))}</li>`).join('')}</ul>` : inline(detail);
          html += `<table class="req"><tbody>
<tr class="id"><th>요구사항 고유번호</th><td class="split">${id}</td><th>요구사항 분류</th><td>${CATEGORY[pre]}</td></tr>
<tr><th>요구사항 명칭</th><td colspan="3">${inline(name)}</td></tr>
<tr><th>세부 내용</th><td colspan="3">${detailHtml}</td></tr>
<tr><th>검수 기준</th><td colspan="3">${acText || (pre === 'COR' ? '사업 수행 전 과정에서 준수 여부 확인' : '-')}</td></tr>
<tr><th>산출 정보</th><td colspan="3">${OUTPUTS[pre]}</td></tr>
</tbody></table>`;
        }
      } else {
        const h0 = cellText(t.header[0]);
        html += docTable(t, { numericCols: h0 === '분류' ? [2] : [], centerCols: h0 === '번호' || h0 === '취소 시점' ? [0] : [] });
      }
      continue;
    }
    if (t.type === 'blockquote') continue;
    html += marked.parser([t]);
  }

  const tocHtml = `<section class="front toc"><h2 class="front-title">목 차</h2><ol>${toc.map((e) => `<li class="l${e.lvl}"><a href="#${e.id}">${inline(e.text)}</a><span class="leader"></span><a class="pg" href="#${e.id}"></a></li>`).join('')}</ol></section>`;
  const history = `<section class="front"><h2 class="front-title">개정 이력</h2>
<table class="doc"><thead><tr><th>버전</th><th>일자</th><th>개정 내용</th><th>작성</th><th>검토/승인</th></tr></thead><tbody>
<tr><td class="center">v0.9</td><td class="center">2026. 11. 23.</td><td>최초 작성(요구사항 협의 결과 반영)</td><td class="center">서비스 기획</td><td class="center">-</td></tr>
<tr><td class="center">v1.0</td><td class="center">2026. 11. 23.</td><td>설계 검토 의견 반영(대기 승격 수량, 시연 환경 분리, 금액 처리 기준), SFR-026 추가</td><td class="center">서비스 기획</td><td class="center">발주기관 승인</td></tr>
<tr><td class="center">v1.1</td><td class="center">2026. 11. 23.</td><td>결제 연계를 결제대행 어댑터 구조로 변경하고 프로토타입은 모의 어댑터 적용(SFR-010, SIR-001~003, COR-002)</td><td class="center">서비스 기획</td><td class="center">발주기관 승인</td></tr>
<tr><td class="center">v1.2</td><td class="center">2026. 11. 24.</td><td>QA 결과 반영: 회원 정보 수정 범위(SFR-002), 대기 신청 수량 상한과 D-2 마감(SFR-015, SFR-016), 시연 데이터 초기화의 시연 계정 복구(SFR-026)</td><td class="center">서비스 기획</td><td class="center">-</td></tr>
</tbody></table></section>`;
  const cover = `<section class="cover"><!--RUN-->
<div class="docno">문서번호 HB-PMO-REQ-01</div>
<div class="title-block"><div class="project">${esc(PROJECT)}</div><h1>요구사항정의서</h1><div class="subtitle">제안요청 내용 및 상세 요구사항</div></div>
<table class="meta"><tbody>
<tr><th>문서 버전</th><td>v1.2</td><th>작성일</th><td>2026. 11. 24.</td></tr>
<tr><th>발주기관</th><td colspan="3">${esc(ISSUER)}</td></tr>
<tr><th>작성</th><td>서비스 기획</td><th>보안 등급</th><td>일반</td></tr>
</tbody></table>
<div class="issuer">한빛시 문화재단</div></section>`;
  return { html: page({ title: '요구사항정의서', docName: '요구사항정의서 v1.2', docNo: 'HB-PMO-REQ-01', body: cover + history + tocHtml + html }), reqRows, acMap };
}

/* ---------------- 기획 점검표 ---------------- */
function buildChecklist() {
  const md = read('docs/superpowers/notes/planning-checklist.md');
  const toks = tokensOf(md);
  let html = '';
  for (const t of toks) {
    if (t.type === 'heading' && t.depth === 1) continue;
    if (t.type === 'paragraph' && t.raw.startsWith('사업:')) continue;
    if (t.type === 'heading') { html += `<h3>${inline(t.text)}</h3>`; continue; }
    if (t.type === 'table') { html += docTable(t, { centerCols: cellText(t.header[0]) === '#' ? [0] : [] }); continue; }
    if (t.type === 'space') continue;
    html += marked.parser([t]);
  }
  const head = `<!--RUN--><header class="sheet-head"><div><div class="project">${esc(PROJECT)}</div><h1>기획 점검표</h1><div class="sub">요구사항 정의 단계 질의 및 결정 기록</div></div>
<table class="meta"><tbody><tr><th>문서번호</th><td>HB-PMO-CHK-01</td><th>버전</th><td>v1.0</td></tr><tr><th>작성일</th><td>2026. 11. 23.</td><th>단계</th><td>요구사항 정의</td></tr></tbody></table></header>`;
  const extra = `@page { size: A4 landscape; margin: 20mm 14mm 16mm 14mm; }
.sheet-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 10mm; padding-bottom: 4mm; border-bottom: 0.8pt solid var(--ink); margin-bottom: 5mm; }
.sheet-head .project { font-size: 9pt; color: var(--ink-2); font-weight: 700; }
.sheet-head h1 { font-size: 20pt; margin: 1.5mm 0 0; color: var(--navy); }
.sheet-head .sub { font-size: 9pt; color: var(--muted); }
.sheet-head table.meta { border-collapse: collapse; font-size: 8.5pt; }
.sheet-head table.meta th, .sheet-head table.meta td { border: 0.5pt solid var(--rule); padding: 1.2mm 2.6mm; }
.sheet-head table.meta th { background: var(--head); color: var(--ink-2); }
table.doc { font-size: 8.4pt; } table.numbered td:first-child { width: 8mm; } table.area td:nth-child(2) { width: 17mm; }
h3 { margin-top: 6mm; }`;
  return page({ title: '기획 점검표', docName: '기획 점검표 v1.0', docNo: 'HB-PMO-CHK-01', body: head + html, extraCss: extra });
}

/* ---------------- 요구사항 추적표 (XLSX) ---------------- */
async function buildTrace(reqRows, acMap) {
  const plan = read('docs/superpowers/plans/2026-11-23-booking-platform.md');
  const traceMd = plan.split('## 요구사항 추적표')[1];
  const table = tokensOf(traceMd).find((t) => t.type === 'table');
  const byId = Object.fromEntries(reqRows.map((r) => [r.id, r]));
  const rows = table.rows.map((r) => r.map(cellText).map((s) => plain(s).replace(/`/g, '')));

  // QA 단계(2026-11-24) 결과로 진행 상태를 정합니다. 연결된 케이스가 모두 PASS 또는 자동 확인이면 검수 완료입니다.
  const qa = loadQa(root);
  const statusOf = (ids) => {
    const list = ids.split(/,\s*/).filter(Boolean);
    if (!list.length) return '계획';
    const res = list.map((q) => normalizeResult(qa.results.get(q)?.result).key);
    if (res.includes('FAIL')) return '결함';
    if (res.every((x) => x === 'PASS' || x === '자동 확인')) return '검수 완료';
    if (res.some((x) => x === 'PASS' || x === 'PASS(일부)' || x === '자동 확인')) return '부분 검수';
    if (res.includes('BLOCKED')) return '검수 보류';
    return '미검수';
  };
  const wb = new ExcelJS.Workbook();
  wb.creator = '서비스 기획';
  wb.created = new Date('2026-11-24T18:00:00+09:00');
  const font = { name: '맑은 고딕', size: 9 };
  const border = { top: { style: 'thin', color: { argb: 'FF9AA3AE' } }, left: { style: 'thin', color: { argb: 'FF9AA3AE' } }, bottom: { style: 'thin', color: { argb: 'FF9AA3AE' } }, right: { style: 'thin', color: { argb: 'FF9AA3AE' } } };
  const headFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF0F4' } };

  const ws = wb.addWorksheet('요구사항 추적표', { views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }], pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '4:4', margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } }, headerFooter: { oddHeader: `&L&8${PROJECT}&R&8요구사항 추적표 v1.1`, oddFooter: '&C&8- &P -&R&8HB-PMO-TRC-01' } });
  const cols = [
    { h: '번호', w: 6 }, { h: '분류', w: 14 }, { h: '요구사항 ID', w: 11 }, { h: '요구사항 명칭', w: 24 }, { h: '세부 내용', w: 52 },
    { h: '검수 기준', w: 12 }, { h: '구현 Task', w: 10 }, { h: '자동 검증(테스트)', w: 34 }, { h: '수동 검증', w: 18 }, { h: 'QA 케이스 ID', w: 13 }, { h: '진행 상태', w: 10 },
  ];
  ws.columns = cols.map((c) => ({ width: c.w }));
  ws.mergeCells(1, 1, 1, cols.length);
  ws.getCell('A1').value = '요구사항 추적표';
  ws.getCell('A1').font = { name: '맑은 고딕', size: 16, bold: true, color: { argb: 'FF1D3557' } };
  ws.getRow(1).height = 30;
  ws.mergeCells(2, 1, 2, cols.length);
  ws.getCell('A2').value = `사업명: ${PROJECT}    문서번호: HB-PMO-TRC-01    버전: v1.1    작성일: 2026. 11. 24.    기준 문서: 요구사항정의서 v1.2, QA 테스트 케이스 v1.0`;
  ws.getCell('A2').font = { ...font, color: { argb: 'FF3A4250' } };
  ws.getRow(3).height = 6;
  const hr = ws.getRow(4);
  cols.forEach((c, i) => { const cell = hr.getCell(i + 1); cell.value = c.h; cell.font = { ...font, bold: true, color: { argb: 'FF3A4250' } }; cell.fill = headFill; cell.border = border; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  hr.height = 22;

  rows.forEach((r, i) => {
    const [id, name, task, auto, manual, ac, qaIds = ''] = r;
    const pre = id.slice(0, 3);
    const req = byId[id];
    const row = ws.addRow([i + 1, CATEGORY[pre], id, name, plain(req?.detail), ac, task, auto, manual, qaIds.split(/,\s*/).join('\n'), statusOf(qaIds)]);
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      cell.font = font; cell.border = border;
      cell.alignment = { vertical: 'top', wrapText: true, horizontal: [1, 3, 6, 7, 10, 11].includes(c) ? 'center' : 'left' };
    });
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: cols.length } };

  // 분류별 요약
  const sum = wb.addWorksheet('분류별 요약', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 } });
  sum.columns = [{ width: 22 }, { width: 10 }, { width: 12 }, { width: 14 }, { width: 14 }];
  sum.mergeCells('A1:E1');
  sum.getCell('A1').value = '분류별 요약';
  sum.getCell('A1').font = { name: '맑은 고딕', size: 14, bold: true, color: { argb: 'FF1D3557' } };
  const sh = sum.getRow(3);
  ['분류', '코드', '요구사항 수', '자동 검증 연결', '수동 검증만'].forEach((h, i) => { const c = sh.getCell(i + 1); c.value = h; c.font = { ...font, bold: true }; c.fill = headFill; c.border = border; c.alignment = { horizontal: 'center' }; });
  const last = 4 + rows.length;
  Object.entries(CATEGORY).forEach(([code, label], i) => {
    const r = sum.getRow(4 + i);
    r.values = [label, code,
      { formula: `COUNTIF('요구사항 추적표'!B5:B${last},"${label}")` },
      { formula: `COUNTIFS('요구사항 추적표'!B5:B${last},"${label}",'요구사항 추적표'!H5:H${last},"<>-")` },
      { formula: `COUNTIFS('요구사항 추적표'!B5:B${last},"${label}",'요구사항 추적표'!H5:H${last},"-",'요구사항 추적표'!I5:I${last},"QA*")` }];
    r.eachCell((c, n) => { c.font = font; c.border = border; c.alignment = { horizontal: n <= 2 ? 'left' : 'right' }; });
  });
  const tr = sum.getRow(11);
  tr.values = ['합계', '', { formula: 'SUM(C4:C10)' }, { formula: 'SUM(D4:D10)' }, { formula: 'SUM(E4:E10)' }];
  tr.eachCell({ includeEmpty: true }, (c, n) => { c.font = { ...font, bold: true }; c.border = border; c.fill = headFill; c.alignment = { horizontal: n <= 2 ? 'left' : 'right' }; });

  // 검수 기준
  const acs = wb.addWorksheet('검수 기준');
  acs.columns = [{ width: 8 }, { width: 90 }];
  const ah = acs.getRow(1); ['번호', '검수 항목'].forEach((h, i) => { const c = ah.getCell(i + 1); c.value = h; c.font = { ...font, bold: true }; c.fill = headFill; c.border = border; });
  Object.entries(acMap).forEach(([k, v]) => { const r = acs.addRow([k, plain(v)]); r.eachCell((c) => { c.font = font; c.border = border; c.alignment = { wrapText: true, vertical: 'top' }; }); });

  // 개정 이력
  const hist = wb.addWorksheet('개정 이력');
  hist.columns = [{ width: 8 }, { width: 14 }, { width: 60 }, { width: 12 }];
  [['버전', '일자', '개정 내용', '작성'], ['v1.0', '2026. 11. 23.', '최초 작성(구현 계획 Task 0~16, 8A와 요구사항 64개 연결)', '서비스 기획'], ['v1.1', '2026. 11. 24.', 'QA 케이스 ID 연결(88건), 진행 상태를 QA 결과로 갱신', '서비스 기획']].forEach((v, i) => { const r = hist.addRow(v); r.eachCell((c) => { c.font = { ...font, bold: i === 0 }; c.border = border; if (i === 0) c.fill = headFill; }); });

  const file = resolve(OUT, '02_요구사항추적표_v1.1.xlsx');
  await wb.xlsx.writeFile(file);
  return { file, count: rows.length };
}

/* ---------------- 렌더링 ---------------- */
async function renderPdf(browser, html, name, shotPages = []) {
  const htmlFile = resolve(HTML_OUT, `${name}.html`);
  writeFileSync(htmlFile, html);
  const pg = await browser.newPage();
  await pg.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
  await pg.waitForFunction('window.__pagedDone === true', { timeout: 120000 });
  await pg.pdf({ path: resolve(OUT, `${name}.pdf`), preferCSSPageSize: true, printBackground: true });
  const pages = await pg.$$('.pagedjs_page');
  await pg.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1.5 });
  if (process.env.REVIEW_DIR) for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: resolve(process.env.REVIEW_DIR, `${name}_${String(i + 1).padStart(2, '0')}.png`), type: 'png' });
  for (const n of shotPages) {
    if (!pages[n - 1]) continue;
    await pages[n - 1].screenshot({ path: resolve(SHOTS, `${name}_p${String(n).padStart(2, '0')}.webp`), type: 'webp', quality: 82 });
  }
  const count = pages.length;
  await pg.close();
  return count;
}

const req = buildRequirements();
const checklist = buildChecklist();
const trace = await buildTrace(req.reqRows, req.acMap);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--allow-file-access-from-files'] });
try {
  const reqPages = await renderPdf(browser, req.html, '01_요구사항정의서_v1.2', [1, 2, 3, 6, 9]);
  const chkPages = await renderPdf(browser, checklist, '01_기획점검표_v1.0', [1, 2, 3]);
  console.log(JSON.stringify({ reqPages, chkPages, traceRows: trace.count, reqCount: req.reqRows.length }));
} finally {
  await browser.close();
}
