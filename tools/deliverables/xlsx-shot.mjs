// XLSX 시트를 스프레드시트 화면처럼 HTML로 그려 캡처합니다(포트폴리오용).
// 사용: node xlsx-shot.mjs <xlsx> <시트 이름> <out.webp> [최대 행 수=40]
import { writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
import puppeteer from 'puppeteer-core';

const [, , file, sheetName, out, maxRowsArg = '40'] = process.argv;
const MAX_ROWS = Number(maxRowsArg);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(resolve(file));
const ws = wb.getWorksheet(sheetName);
if (!ws) throw new Error(`no sheet ${sheetName}`);

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
const argb = (c) => (c && c.argb ? `#${c.argb.slice(2)}` : null);
const colCount = Math.min(ws.columnCount, 16);
const widths = Array.from({ length: colCount }, (_, i) => Math.round((ws.getColumn(i + 1).width ?? 9) * 7.2 + 10));

// 병합 범위: 왼쪽 위 칸에 colspan/rowspan, 나머지는 건너뜀
const skip = new Set();
const span = new Map();
for (const range of ws.model.merges ?? []) {
  const [a, b] = range.split(':');
  const s = ws.getCell(a); const e = ws.getCell(b);
  span.set(`${s.row}:${s.col}`, { cs: e.col - s.col + 1, rs: e.row - s.row + 1 });
  for (let r = s.row; r <= e.row; r++) for (let c = s.col; c <= e.col; c++) if (r !== s.row || c !== s.col) skip.add(`${r}:${c}`);
}

// 수식 칸은 엑셀이 계산한 값이 파일에 없으므로, 이 도구가 쓰는 COUNTIF/COUNTIFS/SUM 정도만 직접 계산합니다.
function valueOf(cell) {
  const v = cell.value;
  if (v && typeof v === 'object' && 'formula' in v) return v.result ?? evalFormula(v.formula, cell);
  if (v && typeof v === 'object' && 'richText' in v) return v.richText.map((t) => t.text).join('');
  return v;
}
function rangeVals(ref) {
  const [sheetPart, rng] = ref.includes('!') ? ref.split('!') : [null, ref];
  const sh = sheetPart ? wb.getWorksheet(sheetPart.replace(/^'|'$/g, '')) : ws;
  const [a, b] = rng.replace(/\$/g, '').split(':');
  const s = sh.getCell(a); const e = sh.getCell(b ?? a);
  const vals = [];
  for (let r = s.row; r <= e.row; r++) for (let c = s.col; c <= e.col; c++) vals.push(valueOf(sh.getCell(r, c)));
  return vals;
}
const match = (v, crit) => {
  if (crit === '<>-') return String(v ?? '') !== '-';
  if (crit.endsWith('*')) return String(v ?? '').startsWith(crit.slice(0, -1));
  return String(v ?? '') === crit;
};
function evalFormula(f, cell) {
  let m;
  if ((m = f.match(/^COUNTIF\((.+?),"(.*)"\)$/))) return rangeVals(m[1]).filter((v) => match(v, m[2])).length;
  if ((m = f.match(/^COUNTIFS\((.+)\)$/))) {
    const parts = m[1].match(/('[^']+'!\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?\d+|[A-Z]+\d+:[A-Z]+\d+),"([^"]*)"/g).map((p) => p.match(/^(.+),"(.*)"$/).slice(1));
    const cols = parts.map(([r, c]) => [rangeVals(r), c]);
    return cols[0][0].filter((_, i) => cols.every(([vals, c]) => match(vals[i], c))).length;
  }
  if ((m = f.match(/^SUM\((.+)\)$/))) return rangeVals(m[1]).reduce((a, v) => a + (Number(v) || 0), 0);
  if ((m = f.match(/^IF\(\$?C\$?(\d+)=0,0,C(\d+)\/\$?C\$?(\d+)\)$/))) {
    const tot = Number(valueOf(ws.getCell(`C${m[1]}`))) || 0;
    return tot ? (Number(valueOf(ws.getCell(`C${m[2]}`))) || 0) / tot : 0;
  }
  if ((m = f.match(/^IF\(C(\d+)=0,0,1\)$/))) return (Number(valueOf(ws.getCell(`C${m[1]}`))) || 0) ? 1 : 0;
  return '';
}
const fmt = (v, cell) => {
  if (typeof v === 'number' && cell.numFmt === '0.0%') return `${(v * 100).toFixed(1)}%`;
  if (typeof v === 'number') return v.toLocaleString('en-US');
  return v;
};

const letters = (n) => { let s = ''; for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
let rows = '';
const last = Math.min(ws.rowCount, MAX_ROWS);
for (let r = 1; r <= last; r++) {
  const row = ws.getRow(r);
  const h = row.height ? Math.round(row.height * 1.33) : null;
  let tds = `<th class="rh">${r}</th>`;
  for (let c = 1; c <= colCount; c++) {
    if (skip.has(`${r}:${c}`)) continue;
    const cell = row.getCell(c);
    const sp = span.get(`${r}:${c}`);
    const st = [];
    const fill = cell.fill?.fgColor && argb(cell.fill.fgColor);
    if (fill) st.push(`background:${fill}`);
    if (cell.font?.bold) st.push('font-weight:700');
    if (cell.font?.size) st.push(`font-size:${Math.round(cell.font.size * 1.33)}px`);
    if (cell.font?.color?.argb) st.push(`color:${argb(cell.font.color)}`);
    const al = cell.alignment ?? {};
    if (al.horizontal) st.push(`text-align:${al.horizontal}`);
    if (al.vertical === 'middle') st.push('vertical-align:middle');
    if (cell.border?.top) st.push('border:1px solid #9aa3ae');
    tds += `<td${sp ? ` colspan="${sp.cs}" rowspan="${sp.rs}"` : ''} style="${st.join(';')}">${esc(fmt(valueOf(cell), cell))}</td>`;
  }
  rows += `<tr${h ? ` style="height:${h}px"` : ''}>${tds}</tr>`;
}
const head = `<tr><th class="corner"></th>${widths.map((_, i) => `<th class="ch">${letters(i)}</th>`).join('')}</tr>`;
const tabs = wb.worksheets.map((s) => `<span class="${s.name === sheetName ? 'on' : ''}">${esc(s.name)}</span>`).join('');
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><style>
body{margin:0;background:#fff;font-family:'Malgun Gothic','맑은 고딕',sans-serif;font-size:12px;color:#222}
.bar{height:30px;background:#f3f3f3;border-bottom:1px solid #d4d4d4;display:flex;align-items:center;padding:0 10px;color:#444;font-size:12px}
.bar b{display:inline-block;width:60px;border:1px solid #c8c8c8;background:#fff;padding:2px 6px;margin-right:8px;font-weight:400}
table{border-collapse:collapse;table-layout:fixed}
td{border:1px solid #e1e1e1;padding:3px 5px;vertical-align:top;white-space:normal;word-break:keep-all;overflow-wrap:anywhere;line-height:1.35}
th{background:#f3f3f3;border:1px solid #d4d4d4;font-weight:400;color:#555;font-size:11px}
.ch{height:20px}.rh{width:34px;text-align:center}.corner{width:34px}
.tabs{display:flex;gap:2px;padding:0 40px;border-top:1px solid #d4d4d4;background:#f3f3f3;height:28px;align-items:flex-end}
.tabs span{padding:4px 14px;color:#444}.tabs .on{background:#fff;border:1px solid #d4d4d4;border-top:0;color:#1d6b38;font-weight:700;border-bottom:2px solid #1d6b38}
</style><div class="bar"><b>A1</b>${esc(sheetName)}</div>
<table><colgroup><col style="width:34px">${widths.map((w) => `<col style="width:${w}px">`).join('')}</colgroup>${head}${rows}</table>
<div class="tabs">${tabs}</div></html>`;

const dir = mkdtempSync(join(tmpdir(), 'xlsx-shot-'));
const htmlFile = join(dir, 'sheet.html');
writeFileSync(htmlFile, html);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  const width = 34 + widths.reduce((a, b) => a + b, 0) + 2;
  await page.setViewport({ width: Math.max(900, Math.min(width, 2200)), height: 900, deviceScaleFactor: 1.5 });
  await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
  await page.screenshot({ path: resolve(out), fullPage: true, type: 'webp', quality: 82 });
} finally {
  await browser.close();
}
console.log(out);
