import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { findMissingIds } from '../../scripts/check-trace.mjs';

describe('findMissingIds', () => {
  it('추적표에 없는 요구사항 ID를 돌려줍니다', () => {
    const req = '| SFR-001 | 가입 |\n| SFR-002 | 정보 |';
    const plan = '## 요구사항 추적표\n| SFR-001 | 가입 | 8 |';
    expect(findMissingIds(req, plan)).toEqual(['SFR-002']);
  });
  it('모두 있으면 빈 목록입니다', () => {
    const req = '| SFR-001 | a |';
    const plan = '## 요구사항 추적표\n| SFR-001 | a |';
    expect(findMissingIds(req, plan)).toEqual([]);
  });
  it('추적표 앞쪽 본문에 나온 ID는 추적표로 치지 않습니다', () => {
    const req = '| SFR-001 | a |';
    const plan = '| SFR-001 | 본문 |\n## 요구사항 추적표\n';
    expect(findMissingIds(req, plan)).toEqual(['SFR-001']);
  });
});

describe('npm run check:trace', () => {
  it('실제 문서에서 종료 코드 0', () => {
    const out = execFileSync(process.execPath, ['scripts/check-trace.mjs'], { encoding: 'utf8' });
    expect(out).toContain('check:trace ok');
  });
});
