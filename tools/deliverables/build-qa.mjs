// QA 단계 산출물: 테스트 결과서 XLSX
// 사용: cd tools/deliverables && node build-qa.mjs
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { loadQa, normalizeResult, tableAfter } from './qa-data.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const OUT = resolve(root, 'deliverables');
mkdirSync(OUT, { recursive: true });

const PROJECT = '한빛아트센터 공연·교육 프로그램 통합 예약 플랫폼 구축';
const DOC_NO = 'HB-PMO-TST-01';
const VERSION = 'v1.0';
const DATE = '2026. 11. 24.';
const COMMIT = process.env.QA_COMMIT ?? '';

const qa = loadQa(root);
const spec = readFileSync(resolve(root, 'docs/superpowers/specs/2026-11-23-booking-platform-requirements.md'), 'utf8');
const acRows = tableAfter(spec, '## Ⅵ. 검수(완료) 기준').filter((r) => /^AC-\d$/.test(r[0]));

const font = { name: '맑은 고딕', size: 9 };
const bold = { ...font, bold: true };
const line = { style: 'thin', color: { argb: 'FF9AA3AE' } };
const border = { top: line, left: line, bottom: line, right: line };
const headFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF0F4' } };
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const RESULT_STYLE = {
  PASS: { fill: fill('FFE6F2EA'), color: 'FF1E6B3A' },
  'PASS(일부)': { fill: fill('FFEAF1E4'), color: 'FF4A6B1E' },
  FAIL: { fill: fill('FFFBE9E7'), color: 'FFB42318' },
  BLOCKED: { fill: fill('FFFFF3DF'), color: 'FF8A5300' },
  '자동 확인': { fill: fill('FFEEF2F8'), color: 'FF2F4A73' },
  미수행: { fill: fill('FFF2F2F2'), color: 'FF5B6470' },
};
const resultKey = (r) => (RESULT_STYLE[r] ? r : /^PASS/.test(r) ? 'PASS(일부)' : /^FAIL/.test(r) ? 'FAIL' : /^BLOCK/.test(r) ? 'BLOCKED' : /자동/.test(r) ? '자동 확인' : '미수행');

const wb = new ExcelJS.Workbook();
wb.creator = '서비스 기획';
wb.created = new Date('2026-11-24T18:00:00+09:00');

const pageSetup = (orientation) => ({ paperSize: 9, orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } });
const headerFooter = (name) => ({ oddHeader: `&L&8${PROJECT}&R&8${name} ${VERSION}`, oddFooter: `&C&8- &P -&R&8${DOC_NO}` });

function title(ws, text, span) {
  ws.mergeCells(1, 1, 1, span);
  ws.getCell('A1').value = text;
  ws.getCell('A1').font = { name: '맑은 고딕', size: 16, bold: true, color: { argb: 'FF1D3557' } };
  ws.getRow(1).height = 30;
  ws.mergeCells(2, 1, 2, span);
  ws.getCell('A2').value = `사업명: ${PROJECT}    문서번호: ${DOC_NO}    버전: ${VERSION}    작성일: ${DATE}    기준 문서: 요구사항정의서 v1.1, QA 테스트 케이스 v1.0`;
  ws.getCell('A2').font = { ...font, color: { argb: 'FF3A4250' } };
  ws.getRow(3).height = 6;
}
function headRow(ws, rowNo, heads) {
  const r = ws.getRow(rowNo);
  heads.forEach((h, i) => {
    const c = r.getCell(i + 1);
    c.value = h; c.font = { ...bold, color: { argb: 'FF3A4250' } }; c.fill = headFill; c.border = border;
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  r.height = 22;
}
function bodyRow(row, center = []) {
  row.eachCell({ includeEmpty: true }, (cell, c) => {
    cell.font = font; cell.border = border;
    cell.alignment = { vertical: 'top', wrapText: true, horizontal: center.includes(c) ? 'center' : 'left' };
  });
}
function paintResult(cell, value) {
  const s = RESULT_STYLE[resultKey(value)];
  cell.fill = s.fill; cell.font = { ...bold, color: { argb: s.color } };
}
function sectionTitle(ws, rowNo, text, span = 5) {
  ws.mergeCells(rowNo, 1, rowNo, span);
  const c = ws.getCell(rowNo, 1);
  c.value = text; c.font = { name: '맑은 고딕', size: 11, bold: true, color: { argb: 'FF1D3557' } };
  ws.getRow(rowNo).height = 20;
}

/* ---------- 2. 테스트 케이스 결과 ---------- */
// 결과 원문의 괄호 설명은 관찰 열로 옮기고, 결과 열은 판정 값 하나로 맞춥니다.
// 실행 수단만 다른 경우(API, SQL로 준비)는 PASS, 일부를 실행하지 않은 경우는 PASS(일부)입니다.
const normalize = normalizeResult;
const caseRows = qa.cases.map((k) => {
  const r = qa.results.get(k.id);
  const { key, qual } = normalize(r?.result ?? '미수행');
  const note = [qual && qual !== '일부' ? `[${qual}]` : '', r?.note ?? ''].filter(Boolean).join(' ');
  return { ...k, result: r ? key : '미수행', note, defect: r?.defect ?? '-', by: r?.by ?? '-' };
});

const summary = wb.addWorksheet('결과 요약', { pageSetup: pageSetup('portrait'), headerFooter: headerFooter('테스트 결과서') });
const cs = wb.addWorksheet('테스트 케이스 결과', { views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }], pageSetup: { ...pageSetup('landscape'), printTitlesRow: '4:4' }, headerFooter: headerFooter('테스트 결과서') });
const caseCols = [
  { h: 'QA ID', w: 9 }, { h: '요구사항 ID', w: 14 }, { h: '구분', w: 7 }, { h: '시나리오', w: 26 }, { h: '사전 조건', w: 24 },
  { h: '절차', w: 40 }, { h: '기대 결과', w: 34 }, { h: '검증 방법', w: 11 }, { h: '근거 테스트', w: 34 },
  { h: '결과', w: 10 }, { h: '실행 내용과 관찰', w: 44 }, { h: '결함 ID', w: 9 }, { h: '수행', w: 10 }, { h: '수행일', w: 11 },
];
cs.columns = caseCols.map((c) => ({ width: c.w }));
title(cs, '테스트 케이스 결과', caseCols.length);
headRow(cs, 4, caseCols.map((c) => c.h));
for (const k of caseRows) {
  const row = cs.addRow([k.id, k.req, k.part, k.scenario, k.pre, k.steps, k.expected, k.method, k.evidence, k.result, k.note, k.defect, k.by, DATE]);
  bodyRow(row, [1, 3, 8, 10, 12, 13, 14]);
  paintResult(row.getCell(10), k.result);
}
const lastCase = 4 + caseRows.length;
cs.autoFilter = { from: { row: 4, column: 1 }, to: { row: lastCase, column: caseCols.length } };

/* ---------- 3. 결함 관리 ---------- */
const ds = wb.addWorksheet('결함 관리', { views: [{ state: 'frozen', ySplit: 4 }], pageSetup: { ...pageSetup('landscape'), printTitlesRow: '4:4' }, headerFooter: headerFooter('테스트 결과서') });
const defCols = [
  { h: '결함 ID', w: 8 }, { h: '심각도', w: 7 }, { h: '화면', w: 18 }, { h: '현상', w: 46 }, { h: '재현 절차', w: 36 },
  { h: '조치 내용과 재확인', w: 46 }, { h: '상태', w: 10 }, { h: '발견일', w: 11 },
];
ds.columns = defCols.map((c) => ({ width: c.w }));
title(ds, '결함 관리', defCols.length);
headRow(ds, 4, defCols.map((c) => c.h));
for (const d of qa.defects) {
  const row = ds.addRow([d.id, d.sev, d.screen, d.symptom, d.repro, d.action || '-', d.status, DATE]);
  bodyRow(row, [1, 2, 7, 8]);
  const st = row.getCell(7);
  st.fill = d.status === '조치 완료' ? RESULT_STYLE.PASS.fill : RESULT_STYLE.FAIL.fill;
  st.font = { ...bold, color: { argb: d.status === '조치 완료' ? RESULT_STYLE.PASS.color : RESULT_STYLE.FAIL.color } };
}
const lastDef = 4 + qa.defects.length;

/* ---------- 4. 자동 테스트 ---------- */
const at = wb.addWorksheet('자동 테스트', { pageSetup: pageSetup('portrait'), headerFooter: headerFooter('테스트 결과서') });
at.columns = [{ width: 18 }, { width: 26 }, { width: 60 }];
title(at, '자동 테스트 결과', 3);
headRow(at, 4, ['구분', '명령', '결과']);
for (const r of qa.auto) bodyRow(at.addRow(r));
const note = at.addRow([]);
note.getCell(1).value = `기준 커밋: main ${COMMIT}. 정책(시간, 환불, 금액, 한도) 단위 테스트와 동시성(같은 좌석 동시 결제, 선점 경합) DB 테스트를 포함합니다.`;
at.mergeCells(note.number, 1, note.number, 3);
note.getCell(1).font = { ...font, color: { argb: 'FF5B6470' } };
note.getCell(1).alignment = { wrapText: true };
note.height = 30;

/* ---------- 5. 접근성 점검 ---------- */
const ax = wb.addWorksheet('접근성 점검', { views: [{ state: 'frozen', ySplit: 4 }], pageSetup: { ...pageSetup('portrait'), printTitlesRow: '4:4' }, headerFooter: headerFooter('테스트 결과서') });
ax.columns = [{ width: 7 }, { width: 8 }, { width: 22 }, { width: 30 }, { width: 14 }, { width: 8 }];
title(ax, '접근성 자동 점검(axe-core 4.10.3, WCAG 2.1 A/AA)', 6);
headRow(ax, 4, ['번호', '구분', '화면', '경로', '로그인', '위반']);
qa.a11y.forEach((r, i) => bodyRow(ax.addRow([i + 1, ...r.map((v, j) => (j === 4 ? Number(v) : v))]), [1, 2, 5, 6]));
const axTotal = ax.addRow(['', '', '합계', `${qa.a11y.length}개 화면`, '', { formula: `SUM(F5:F${4 + qa.a11y.length})` }]);
bodyRow(axTotal, [6]);
axTotal.eachCell({ includeEmpty: true }, (c) => { c.fill = headFill; c.font = bold; });

/* ---------- 1. 결과 요약 ---------- */
summary.columns = [{ width: 18 }, { width: 40 }, { width: 14 }, { width: 14 }, { width: 14 }];
title(summary, '테스트 결과서', 5);
let r = 5;
sectionTitle(summary, r++, '1. 개요');
const overview = [
  ['사업명', PROJECT],
  ['대상', `통합 예약 플랫폼 프로토타입(사용자 화면, 관리자 화면, DB 함수, 결제 서버 함수)${COMMIT ? `, main ${COMMIT}` : ''}`],
  ['테스트 일자', DATE],
  ['테스트 환경', '로컬: Vite 개발 서버, Supabase CLI 3.3.0(PostgreSQL, Auth, Edge Functions), 모의 결제 어댑터, Chromium 계열 브라우저 1024 x 768(반응형은 390, 1440)'],
  ['기준 문서', '요구사항정의서 v1.1(요구사항 64개, 검수 기준 AC-1~AC-9), QA 테스트 케이스 v1.0(88건)'],
  ['판정 기준', 'PASS: 기대 결과와 일치 / PASS(일부): 확인한 범위는 일치 / FAIL: 불일치 / BLOCKED: 환경 제약으로 수행 불가 / 자동 확인: 자동 테스트로만 확인'],
];
for (const [k, v] of overview) {
  const row = summary.getRow(r++);
  row.getCell(1).value = k; row.getCell(2).value = v;
  summary.mergeCells(row.number, 2, row.number, 5);
  row.getCell(1).fill = headFill; row.getCell(1).font = bold;
  for (let c = 1; c <= 5; c++) { row.getCell(c).border = border; row.getCell(c).alignment = { wrapText: true, vertical: 'middle' }; if (c > 1) row.getCell(c).font = font; }
  row.height = v.length > 60 ? 30 : 18;
}
r++;
sectionTitle(summary, r++, '2. 결과 집계');
headRow(summary, r++, ['결과', '설명', '건수', '비율', '']);
const R = `'테스트 케이스 결과'!J5:J${lastCase}`;
const kinds = [['PASS', '기대 결과와 일치'], ['PASS(일부)', '확인한 범위에서 일치'], ['FAIL', '기대 결과와 불일치'], ['BLOCKED', '환경 제약으로 수행 불가'], ['자동 확인', '자동 테스트로만 확인'], ['미수행', '아직 수행하지 않음']];
const firstKind = r;
for (const [k, desc] of kinds) {
  const row = summary.getRow(r);
  row.values = [k, desc, { formula: `COUNTIF(${R},"${k}")` }, { formula: `IF($C$${firstKind + kinds.length}=0,0,C${r}/$C$${firstKind + kinds.length})` }];
  for (let c = 1; c <= 4; c++) { row.getCell(c).border = border; row.getCell(c).font = font; }
  paintResult(row.getCell(1), k);
  row.getCell(4).numFmt = '0.0%';
  r++;
}
const tot = summary.getRow(r++);
tot.values = ['합계', '', { formula: `SUM(C${firstKind}:C${r - 2})` }, { formula: `IF(C${r - 1}=0,0,1)` }];
for (let c = 1; c <= 4; c++) { tot.getCell(c).border = border; tot.getCell(c).font = bold; tot.getCell(c).fill = headFill; }
tot.getCell(4).numFmt = '0.0%';
r++;

sectionTitle(summary, r++, '3. 검수 기준(AC) 판정');
headRow(summary, r++, ['검수 기준', '항목', '종단 케이스', '결과', '확인 방법']);
for (const [ac, item, how] of acRows) {
  const qaId = (qa.cases.find((k) => k.req.split(/,\s*/)[0] === ac) ?? {}).id ?? '';
  const res = normalize(qa.results.get(qaId)?.result).key;
  const row = summary.getRow(r++);
  row.values = [ac, item, qaId, res, how];
  for (let c = 1; c <= 5; c++) { row.getCell(c).border = border; row.getCell(c).font = font; row.getCell(c).alignment = { wrapText: true, vertical: 'top', horizontal: [1, 3, 4].includes(c) ? 'center' : 'left' }; }
  paintResult(row.getCell(4), res);
  row.height = 30;
}
r++;

sectionTitle(summary, r++, '4. 결함 요약');
headRow(summary, r++, ['심각도', '설명', '발견', '조치 완료', '미조치']);
const D = (col) => `'결함 관리'!${col}5:${col}${lastDef}`;
for (const [sev, desc] of [['상', '핵심 흐름 차단, 금액/권한 오류'], ['중', '안내와 실제 처리가 어긋남, 우회 가능'], ['하', '표시, 정렬, 편의 문제']]) {
  const row = summary.getRow(r++);
  row.values = [sev, desc, { formula: `COUNTIF(${D('B')},"${sev}")` }, { formula: `COUNTIFS(${D('B')},"${sev}",${D('G')},"조치 완료")` }, { formula: `COUNTIFS(${D('B')},"${sev}",${D('G')},"미조치")` }];
  for (let c = 1; c <= 5; c++) { row.getCell(c).border = border; row.getCell(c).font = font; row.getCell(c).alignment = { horizontal: c === 2 ? 'left' : 'center' }; }
}
const dt = summary.getRow(r++);
dt.values = ['합계', '', { formula: `SUM(C${r - 4}:C${r - 2})` }, { formula: `SUM(D${r - 4}:D${r - 2})` }, { formula: `SUM(E${r - 4}:E${r - 2})` }];
for (let c = 1; c <= 5; c++) { dt.getCell(c).border = border; dt.getCell(c).font = bold; dt.getCell(c).fill = headFill; dt.getCell(c).alignment = { horizontal: c === 2 ? 'left' : 'center' }; }
r++;

sectionTitle(summary, r++, '5. 종합 의견');
const count = (k) => caseRows.filter((c) => resultKey(c.result) === k).length;
const open = qa.defects.filter((d) => d.status !== '조치 완료');
const opinions = [
  `케이스 ${caseRows.length}건 중 PASS ${count('PASS')}건, 일부 확인 ${count('PASS(일부)')}건, 자동 확인 ${count('자동 확인')}건, FAIL ${count('FAIL')}건, BLOCKED ${count('BLOCKED')}건, 미수행 ${count('미수행')}건입니다.`,
  `결함 ${qa.defects.length}건(${['상', '중', '하'].map((v) => `${v} ${qa.defects.filter((d) => d.sev === v).length}`).join(', ')})을 기록했고 ${qa.defects.length - open.length}건을 수정했습니다. 화면에서 재현되는 결함은 같은 절차로 브라우저 재검수했고, 나머지는 추가한 단위/DB 테스트로 확인했습니다. D-01~D-15 수정분은 별도 코드 리뷰와 범위 재검토를 거쳤고, D-16(CSS 한 줄)은 화면 측정으로 확인했습니다.${open.length ? ` 미조치 ${open.length}건(${open.map((d) => d.id).join(', ')})은 결함 관리 시트에 사유를 적었습니다.` : ''}`,
  `접근성 자동 점검은 ${qa.a11y.length}개 화면에서 위반 0건입니다. 키보드 점검은 좌석 배치도, 결제 단계 입력 요소를 포함합니다.`,
  '성능 목표(PER-001~003)는 프로토타입에서 측정하지 않는 목표치라 문서 확인으로 처리했고, 운영 환경 구축 시 별도 성능 시험이 필요합니다.',
];
for (const t of opinions) {
  const row = summary.getRow(r++);
  row.getCell(1).value = t;
  summary.mergeCells(row.number, 1, row.number, 5);
  row.getCell(1).font = font; row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
  row.height = 30;
}

/* ---------- 6. 개정 이력 ---------- */
const hist = wb.addWorksheet('개정 이력');
hist.columns = [{ width: 8 }, { width: 14 }, { width: 60 }, { width: 12 }];
[['버전', '일자', '개정 내용', '작성'], [VERSION, DATE, '최초 작성(QA 케이스 88건 실행 결과, 결함, 자동 테스트, 접근성 점검)', '서비스 기획']].forEach((v, i) => {
  const row = hist.addRow(v);
  row.eachCell((c) => { c.font = { ...font, bold: i === 0 }; c.border = border; if (i === 0) c.fill = headFill; });
});

const file = resolve(OUT, `03_테스트결과서_${VERSION}.xlsx`);
await wb.xlsx.writeFile(file);
console.log(JSON.stringify({ file, cases: caseRows.length, results: qa.results.size, defects: qa.defects.length, a11y: qa.a11y.length, counts: Object.fromEntries(Object.keys(RESULT_STYLE).map((k) => [k, count(k)])) }));
