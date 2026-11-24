// QA 문서(md)에서 케이스, 실행 결과, 결함, 접근성 점검 표를 읽어 산출물 생성에 넘깁니다.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const clean = (s) => String(s ?? '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/`/g, '')
  .replace(/\*\*/g, '')
  .trim();

/** heading 다음에 나오는 첫 표의 본문 행(머리행, 구분행 제외) */
export function tableAfter(md, heading = null) {
  let text = md;
  if (heading) {
    const at = md.indexOf(heading);
    if (at < 0) return [];
    text = md.slice(at + heading.length);
  }
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().startsWith('|'));
  if (start < 0) return [];
  const rows = [];
  for (let i = start; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    if (i === start || /^\|\s*:?-{2,}/.test(lines[i].trim())) continue;
    rows.push(cellsOf(lines[i]).map(clean));
  }
  return rows;
}

/**
 * 결과 원문(예: 「PASS(시계는 SQL)」)을 판정 값 하나로 맞춥니다.
 * 실행 수단만 다른 경우는 PASS, 일부를 실행하지 않은 경우는 PASS(일부)입니다.
 * @returns {{key:string, qual:string}}
 */
export function normalizeResult(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { key: '미수행', qual: '' };
  const m = text.match(/^([^(]+?)\s*(?:\((.*)\))?$/);
  const head = (m?.[1] ?? text).trim();
  const qual = m?.[2] ?? '';
  let key = /^PASS/.test(head) ? 'PASS' : /^FAIL/.test(head) ? 'FAIL' : /^BLOCK/.test(head) ? 'BLOCKED' : /자동/.test(head) ? '자동 확인' : '미수행';
  if (key === 'PASS' && (qual === '일부' || /미실행|미확인|일부|기준|화면 미/.test(qual))) key = 'PASS(일부)';
  return { key, qual: qual === '일부' ? '' : qual };
}

export function loadQa(root) {
  const read = (p) => (existsSync(resolve(root, p)) ? readFileSync(resolve(root, p), 'utf8') : '');
  const casesMd = read('docs/qa/2026-11-24-qa-cases.md');
  const cases = tableAfter(casesMd, '## 테스트 케이스').map(([id, req, part, scenario, pre, steps, expected, method, evidence]) => ({
    id, req, part, scenario, pre, steps, expected, method, evidence,
  }));
  const reqToQa = Object.fromEntries(tableAfter(casesMd, '### 요구사항 ID와 QA ID').map(([r, q]) => [r, q]));

  // 에이전트 결과가 리드 결과보다 나중에 실행된 것(일부 수행 건을 마저 확인)이므로 같은 ID는 에이전트 결과를 씁니다.
  const results = new Map();
  const add = (file, by) => {
    for (const [id, result, note, defect] of tableAfter(read(file))) {
      if (!/^QA-\d{3}$/.test(id)) continue;
      const prev = results.get(id);
      results.set(id, { result, note: prev && by !== prev.by ? `${prev.note}\n${note}` : note, defect: [prev?.defect, defect].filter((d) => d && d !== '-').join(', ') || '-', by });
    }
  };
  add('docs/qa/2026-11-24-qa-lead-results.md', '리드 검수');
  add('docs/qa/2026-11-24-qa-browser-results.md', 'QA 에이전트');
  add('docs/qa/2026-11-24-qa-retest.md', '재검수');

  const working = tableAfter(read('docs/qa/defects-working.md')).map(([id, sev, screen, symptom, repro, action]) => ({
    id, sev, screen, symptom, repro, action, status: action ? '조치 완료' : '미조치',
  }));
  const agentMd = read('docs/qa/2026-11-24-qa-browser-results.md');
  const agentDefects = tableAfter(agentMd, '## 2. 결함').filter((r) => /^D-\d+/.test(r[0])).map(([id, sev, screen, symptom, repro, action = '']) => ({
    id, sev, screen, symptom, repro, action, status: action ? '조치 완료' : '미조치',
  }));
  const a11y = tableAfter(read('docs/qa/2026-11-24-a11y.md'));
  const auto = tableAfter(read('docs/qa/2026-11-24-qa-lead-results.md'), '## 자동 점검');
  return { cases, reqToQa, results, defects: [...working, ...agentDefects], a11y, auto };
}
