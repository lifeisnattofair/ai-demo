import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ID_ROW = /^\|\s*([A-Z]{3}-\d{3})\s*\|/gm;
const TRACE_HEADING = '## 요구사항 추적표';

function ids(md) {
  return [...md.matchAll(ID_ROW)].map((m) => m[1]);
}

// 요구사항 문서의 `| XXX-000 |` ID 중 계획서 「요구사항 추적표」 절에 없는 ID 목록.
export function findMissingIds(requirementsMd, planMd) {
  const at = planMd.indexOf(TRACE_HEADING);
  const table = at < 0 ? '' : planMd.slice(at);
  const have = new Set(ids(table));
  return [...new Set(ids(requirementsMd))].filter((id) => !have.has(id));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const read = (p) => readFileSync(new URL(`../docs/superpowers/${p}`, import.meta.url), 'utf8');
  const missing = findMissingIds(
    read('specs/2026-11-23-booking-platform-requirements.md'),
    read('plans/2026-11-23-booking-platform.md'),
  );
  if (missing.length > 0) {
    console.error(`추적표에 없는 요구사항: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('check:trace ok');
}
