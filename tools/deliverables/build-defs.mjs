// 테이블 정의서, 코드 정의서 XLSX: 실행 중인 로컬 DB의 구조(열, 키, 제약, 접근 정책)를 읽고
// 한글 설명은 docs/deliverables/*.md 에서 가져옵니다. 문서에 없는 열이나 DB와 다른 코드는 오류로 멈춥니다.
// 사용: cd tools/deliverables && node build-defs.mjs
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { tableAfter } from './qa-data.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const OUT = resolve(root, 'deliverables');
mkdirSync(OUT, { recursive: true });
const PROJECT = '한빛아트센터 공연·교육 프로그램 통합 예약 플랫폼 구축';
const DATE = '2026. 11. 24.';
const BASE_MIG = '0001_schema.sql ~ 0017_review_fixes.sql';

const q = (sql) => JSON.parse(execSync(`docker exec -i supabase_db_prototype psql -U postgres -tA`, { input: `select coalesce(json_agg(t), '[]') from (${sql}) t;` }).toString().trim());

const cols = q(`select c.table_name, c.column_name, c.ordinal_position, c.is_nullable, c.column_default,
  case when c.data_type in ('USER-DEFINED','ARRAY') then c.udt_name else c.data_type end as data_type
  from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name
  where c.table_schema='public' and t.table_type='BASE TABLE' order by c.table_name, c.ordinal_position`);
const cons = q(`select rel.relname as table_name, con.conname, con.contype, pg_get_constraintdef(con.oid) as def,
  (select array_agg(a.attname order by a.attnum) from pg_attribute a where a.attrelid=con.conrelid and a.attnum = any(con.conkey)) as cols,
  case when fns.nspname = 'public' then frel.relname else fns.nspname || '.' || frel.relname end as ref_table
  from pg_constraint con join pg_class rel on rel.oid=con.conrelid join pg_namespace n on n.oid=rel.relnamespace
  left join pg_class frel on frel.oid=con.confrelid left join pg_namespace fns on fns.oid=frel.relnamespace
  where n.nspname='public' order by rel.relname, con.contype, con.conname`);
const idx = q(`select tablename as table_name, indexname, indexdef from pg_indexes where schemaname='public' order by tablename, indexname`);
const rls = q(`select c.relname as table_name, c.relrowsecurity as rls, (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`);
const rlsBy = Object.fromEntries(rls.map((r) => [r.table_name, r]));

/* 문서(md) */
const tdMd = readFileSync(resolve(root, 'docs/deliverables/table-definition.md'), 'utf8').replace(/\r\n/g, '\n');
const tableList = tableAfter(tdMd, '## 목록');
const colDoc = {};
for (const [t] of tableList) colDoc[t] = Object.fromEntries(tableAfter(tdMd, `### ${t}\n`).map(([c, , key, desc]) => [c, { key, desc }]));
const cdMd = readFileSync(resolve(root, 'docs/deliverables/code-definition.md'), 'utf8').replace(/\r\n/g, '\n');
const codeRows = [];
let group = '', target = '';
for (const [g, tc, code, name, keep] of tableAfter(cdMd, '| 코드 그룹 |').length ? tableAfter(cdMd) : []) {
  if (g) group = g;
  if (tc) target = tc;
  codeRows.push({ group, target, code, name, keep: keep ?? '' });
}

/* 대조 */
const errors = [];
const dbTables = [...new Set(cols.map((c) => c.table_name))];
for (const t of dbTables) {
  if (!colDoc[t]) { errors.push(`정의서에 없는 테이블 ${t}`); continue; }
  for (const c of cols.filter((x) => x.table_name === t)) if (!colDoc[t][c.column_name]) errors.push(`정의서에 없는 열 ${t}.${c.column_name}`);
}
// CHECK 제약의 허용 값과 코드 정의서 대조
const checkValues = {};
for (const c of cons.filter((x) => x.contype === 'c')) {
  const vals = [...c.def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
  if (vals.length && c.cols?.length === 1) checkValues[`${c.table_name}.${c.cols[0]}`] = vals;
}
const codeCheck = (target, code) => {
  const keys = target.split(/,\s*/);
  const known = keys.filter((k) => checkValues[k]);
  if (!known.length) return '함수/정책 기준';
  return known.every((k) => checkValues[k].includes(code)) ? '일치' : '불일치';
};
for (const r of codeRows) if (codeCheck(r.target, r.code) === '불일치') errors.push(`코드 불일치 ${r.target} ${r.code}`);
for (const [k, vals] of Object.entries(checkValues)) {
  const listed = codeRows.filter((r) => r.target.split(/,\s*/).includes(k)).map((r) => r.code);
  if (!listed.length) continue;
  for (const v of vals) if (!listed.includes(v)) errors.push(`코드 정의서에 없는 값 ${k} ${v}`);
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

/* 공통 서식 */
const font = { name: '맑은 고딕', size: 9 };
const bold = { ...font, bold: true };
const line = { style: 'thin', color: { argb: 'FF9AA3AE' } };
const border = { top: line, left: line, bottom: line, right: line };
const headFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF0F4' } };
const groupFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F7F9' } };
const setup = (orientation, name, docNo) => ({
  pageSetup: { paperSize: 9, orientation, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '4:4', margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
  headerFooter: { oddHeader: `&L&8${PROJECT}&R&8${name} v1.0`, oddFooter: `&C&8- &P -&R&8${docNo}` },
});
function sheetHead(ws, title, span, docNo, basis) {
  ws.mergeCells(1, 1, 1, span);
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { name: '맑은 고딕', size: 16, bold: true, color: { argb: 'FF1D3557' } };
  ws.getRow(1).height = 30;
  ws.mergeCells(2, 1, 2, span);
  ws.getCell('A2').value = `사업명: ${PROJECT}    문서번호: ${docNo}    버전: v1.0    작성일: ${DATE}    기준: ${basis}`;
  ws.getCell('A2').font = { ...font, color: { argb: 'FF3A4250' } };
  ws.getRow(3).height = 6;
}
function headRow(ws, n, heads) {
  const r = ws.getRow(n);
  heads.forEach((h, i) => { const c = r.getCell(i + 1); c.value = h; c.font = { ...bold, color: { argb: 'FF3A4250' } }; c.fill = headFill; c.border = border; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  r.height = 22;
}
function body(row, center = []) {
  row.eachCell({ includeEmpty: true }, (c, i) => { c.font = font; c.border = border; c.alignment = { vertical: 'top', wrapText: true, horizontal: center.includes(i) ? 'center' : 'left' }; });
}
function history(wb, text) {
  const h = wb.addWorksheet('개정 이력');
  h.columns = [{ width: 8 }, { width: 14 }, { width: 70 }, { width: 12 }];
  [['버전', '일자', '개정 내용', '작성'], ['v1.0', DATE, text, '서비스 기획']].forEach((v, i) => { const r = h.addRow(v); r.eachCell((c) => { c.font = { ...font, bold: i === 0 }; c.border = border; if (i === 0) c.fill = headFill; c.alignment = { wrapText: true }; }); });
}

/* 테이블 정의서 */
const keyOf = (t, c) => {
  const k = [];
  for (const x of cons.filter((y) => y.table_name === t && y.cols?.includes(c))) {
    if (x.contype === 'p') k.push('PK');
    if (x.contype === 'u') k.push('UK');
    if (x.contype === 'f') k.push(`FK ${x.ref_table ?? ''}`.trim());
  }
  if (!k.some((v) => v.startsWith('FK')) && /FK auth\.users/.test(colDoc[t]?.[c]?.key ?? '')) k.push('FK auth.users');
  const rank = (v) => (v === 'PK' ? 0 : v === 'UK' ? 1 : 2);
  return [...new Set(k)].sort((a, b) => rank(a) - rank(b)).join(', ');
};
const TYPE = { 'timestamp with time zone': 'timestamptz', 'character varying': 'varchar', 'double precision': 'float8' };
// 맑은 고딕은 역슬래시를 원화 기호로 그리므로 설명의 \n 표기는 말로 바꿉니다.
const plainDesc = (s) => String(s ?? '').replace(/줄바꿈은 \\n/g, '줄바꿈 문자로 구분');
const GENERIC = { id: '식별자', created_at: '생성 일시', updated_at: '수정 일시' };
{
  const wb = new ExcelJS.Workbook();
  wb.creator = '서비스 기획'; wb.created = new Date('2026-11-24T19:00:00+09:00');
  const DOC = 'HB-PMO-DB-01';
  const ls = wb.addWorksheet('테이블 목록', { views: [{ state: 'frozen', ySplit: 4 }], ...setup('landscape', '테이블 정의서', DOC) });
  ls.columns = [{ width: 6 }, { width: 22 }, { width: 18 }, { width: 46 }, { width: 18 }, { width: 8 }, { width: 10 }, { width: 10 }];
  sheetHead(ls, '테이블 정의서 - 테이블 목록', 8, DOC, `PostgreSQL 17(Supabase 로컬), 마이그레이션 ${BASE_MIG}`);
  headRow(ls, 4, ['번호', '테이블명', '한글명', '설명', '보관 기간', '열 수', '행 접근 정책', '정책 수']);
  tableList.forEach(([t, ko, desc, keep], i) => {
    const r = ls.addRow([i + 1, t, ko, desc, keep, cols.filter((c) => c.table_name === t).length, rlsBy[t]?.rls ? '사용' : '미사용', Number(rlsBy[t]?.policies ?? 0)]);
    body(r, [1, 6, 7, 8]);
  });
  const note = ls.addRow([]);
  ls.mergeCells(note.number, 1, note.number, 8);
  note.getCell(1).value = '모든 테이블에 행 단위 접근 정책(RLS)을 켰습니다. 정책이 0개인 테이블은 화면에서 직접 읽고 쓸 수 없고, 권한을 확인하는 DB 함수(SECURITY DEFINER)로만 다룹니다.';
  note.getCell(1).font = { ...font, color: { argb: 'FF5B6470' } }; note.getCell(1).alignment = { wrapText: true }; note.height = 28;

  const cs = wb.addWorksheet('컬럼 정의', { views: [{ state: 'frozen', ySplit: 4 }], ...setup('landscape', '테이블 정의서', DOC) });
  cs.columns = [{ width: 6 }, { width: 22 }, { width: 24 }, { width: 14 }, { width: 7 }, { width: 24 }, { width: 22 }, { width: 56 }];
  sheetHead(cs, '테이블 정의서 - 컬럼 정의', 8, DOC, `PostgreSQL 17(Supabase 로컬), 마이그레이션 ${BASE_MIG}`);
  headRow(cs, 4, ['순번', '테이블명', '컬럼명', '데이터 타입', 'NULL', '기본값', '키', '설명']);
  for (const [t, ko] of tableList) {
    const g = cs.addRow([`${t} (${ko})`]);
    cs.mergeCells(g.number, 1, g.number, 8);
    g.getCell(1).font = bold; g.getCell(1).fill = groupFill; g.getCell(1).border = border;
    for (const c of cols.filter((x) => x.table_name === t)) {
      const d = colDoc[t][c.column_name];
      const def = (c.column_default ?? '').replace(/::[a-z ]+/g, '').replace(/^'(.*)'$/, '$1');
      const key = keyOf(t, c.column_name);
      const fk = key.split(', ').find((v) => v.startsWith('FK '));
      const desc = plainDesc(d?.desc) || GENERIC[c.column_name] || (fk ? `${fk.slice(3)} 참조` : '');
      const r = cs.addRow([c.ordinal_position, t, c.column_name, TYPE[c.data_type] ?? c.data_type, c.is_nullable === 'YES' ? 'Y' : 'N', def, key, desc]);
      body(r, [1, 5]);
    }
  }
  cs.autoFilter = { from: { row: 4, column: 1 }, to: { row: cs.rowCount, column: 8 } };

  const ct = wb.addWorksheet('제약 조건과 인덱스', { views: [{ state: 'frozen', ySplit: 4 }], ...setup('landscape', '테이블 정의서', DOC) });
  ct.columns = [{ width: 22 }, { width: 12 }, { width: 36 }, { width: 90 }];
  sheetHead(ct, '테이블 정의서 - 제약 조건과 인덱스', 4, DOC, `PostgreSQL 17(Supabase 로컬), 마이그레이션 ${BASE_MIG}`);
  headRow(ct, 4, ['테이블명', '구분', '이름', '정의']);
  const KIND = { p: '기본 키', u: '고유', f: '외래 키', c: '검사(CHECK)', x: '배제' };
  for (const c of cons) body(ct.addRow([c.table_name, KIND[c.contype] ?? c.contype, c.conname, c.def]), [2]);
  for (const i of idx) if (!cons.some((c) => c.conname === i.indexname)) body(ct.addRow([i.table_name, '인덱스', i.indexname, i.indexdef.replace(/ ON public\./, ' ON ')]), [2]);

  history(wb, `최초 작성. 로컬 DB(마이그레이션 ${BASE_MIG}) 구조를 읽어 생성하고 docs/deliverables/table-definition.md 설명과 대조(누락 0)`);
  await wb.xlsx.writeFile(resolve(OUT, '04_테이블정의서_v1.0.xlsx'));
}

/* 코드 정의서 */
{
  const wb = new ExcelJS.Workbook();
  wb.creator = '서비스 기획'; wb.created = new Date('2026-11-24T19:00:00+09:00');
  const DOC = 'HB-PMO-DB-02';
  const ws = wb.addWorksheet('코드 정의', { views: [{ state: 'frozen', ySplit: 4 }], ...setup('portrait', '코드 정의서', DOC) });
  ws.columns = [{ width: 6 }, { width: 16 }, { width: 30 }, { width: 22 }, { width: 22 }, { width: 14 }, { width: 14 }];
  sheetHead(ws, '코드 정의서', 7, DOC, `DB CHECK 제약과 정책 모듈, 마이그레이션 ${BASE_MIG}`);
  headRow(ws, 4, ['번호', '코드 그룹', '테이블.컬럼', '코드', '코드명', '보관', 'DB 대조']);
  let prev = '';
  codeRows.forEach((r, i) => {
    const row = ws.addRow([i + 1, r.group === prev ? '' : r.group, r.group === prev ? '' : r.target, r.code, r.name, r.keep, codeCheck(r.target, r.code)]);
    body(row, [1, 6, 7]);
    if (r.group !== prev) row.eachCell({ includeEmpty: true }, (c) => { c.border = { ...border, top: { style: 'medium', color: { argb: 'FF6B7480' } } }; });
    prev = r.group;
  });
  const sum = wb.addWorksheet('코드 그룹 요약', setup('portrait', '코드 정의서', DOC));
  sum.columns = [{ width: 20 }, { width: 34 }, { width: 10 }, { width: 30 }];
  sheetHead(sum, '코드 그룹 요약', 4, DOC, 'DB CHECK 제약 대조');
  headRow(sum, 4, ['코드 그룹', '테이블.컬럼', '코드 수', 'DB 대조']);
  for (const g of [...new Set(codeRows.map((r) => r.group))]) {
    const rs = codeRows.filter((r) => r.group === g);
    const states = [...new Set(rs.map((r) => codeCheck(r.target, r.code)))];
    body(sum.addRow([g, rs[0].target, rs.length, states.join(', ')]), [3]);
  }
  history(wb, `최초 작성. docs/deliverables/code-definition.md 를 DB CHECK 제약 허용 값과 대조해 생성(불일치 0)`);
  await wb.xlsx.writeFile(resolve(OUT, '04_코드정의서_v1.0.xlsx'));
}
console.log(JSON.stringify({ tables: tableList.length, columns: cols.length, constraints: cons.length, indexes: idx.length, codes: codeRows.length, checked: Object.keys(checkValues).length }));
