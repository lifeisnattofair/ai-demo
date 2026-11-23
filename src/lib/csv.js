// CSV 만들기와 내려받기(엑셀에서 열어도 한글이 깨지지 않도록 UTF-8 BOM 포함). 버튼 이름은 「CSV 다운로드」로 통일합니다.
// columns = [{key, label, value?(row)}]
// 수식 주입 방지: 문자열이 = + - @ 탭 CR 로 시작하면 앞에 ' 를 붙여 글자로 읽히게 합니다.
// 숫자 값은 그대로 두어 음수도 숫자로 남습니다.

const BOM = String.fromCharCode(0xfeff);
const FORMULA_START = /^[=+\-@\t\r]/;

const cell = (v) => {
  let s = v == null ? '' : String(v);
  if (typeof v === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(columns, rows) {
  const head = columns.map((c) => cell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(c.value ? c.value(r) : r[c.key])).join(','));
  return BOM + [head, ...body].join('\n');
}

export const NO_ROWS_MESSAGE = '내려받을 내역이 없습니다. 조회 조건을 바꿔 다시 조회한 뒤 내려받아 주세요.';

/**
 * 행이 있으면 CSV 로 내려받고 true, 0건이면 머리글만 있는 파일을 만들지 않고 onEmpty(안내 문구)를 부른 뒤 false.
 */
export function exportCsv(filename, columns, rows, onEmpty) {
  if (!rows?.length) {
    onEmpty?.(NO_ROWS_MESSAGE);
    return false;
  }
  downloadCsv(filename, toCsv(columns, rows));
  return true;
}

export function downloadCsv(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
