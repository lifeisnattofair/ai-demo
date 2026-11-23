// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadCsv, exportCsv, NO_ROWS_MESSAGE, toCsv } from '../../src/lib/csv.js';

describe('toCsv', () => {
  it('둘째 줄이 "A, ""B""" (쉼표/따옴표 이스케이프)', () => {
    const out = toCsv([{ key: 't', label: '제목' }], [{ t: 'A, "B"' }]);
    expect(out.split('\n')[1]).toBe('"A, ""B"""');
  });

  it('UTF-8 BOM 으로 시작하고 첫 줄은 머리글입니다', () => {
    const out = toCsv([{ key: 'a', label: '일자' }, { key: 'b', label: '금액', value: (r) => r.b * 2 }], [{ a: '2026-12-01', b: 1000 }]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.slice(1).split('\n')).toEqual(['일자,금액', '2026-12-01,2000']);
  });

  it('수식으로 시작하는 문자열은 앞에 \' 를 붙이고, 숫자(음수 포함)는 그대로 둡니다', () => {
    const cols = [{ key: 'a', label: 'a' }];
    const line = (v) => toCsv(cols, [{ a: v }]).split('\n')[1];
    expect(line('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
    expect(line('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(line('+1')).toBe("'+1");
    expect(line('-2+3')).toBe("'-2+3");
    expect(line('\tx')).toBe("'\tx");
    expect(line('\rx')).toBe('"\'\rx"');
    expect(line(-36000)).toBe('-36000');
    expect(line(0)).toBe('0');
    expect(line('회***나')).toBe('회***나');
  });

  it('줄바꿈이 든 값과 빈 값을 처리합니다', () => {
    const out = toCsv([{ key: 'a', label: 'a' }, { key: 'b', label: 'b' }], [{ a: '첫 줄\n둘째 줄', b: null }]);
    expect(out.slice(1).split('\n').slice(1).join('\n')).toBe('"첫 줄\n둘째 줄",');
  });
});

describe('downloadCsv', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Blob 주소로 a[download] 를 눌러 내려받습니다', () => {
    const create = vi.fn(() => 'blob:x');
    URL.createObjectURL = create;
    URL.revokeObjectURL = vi.fn();
    const clicks = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { clicks.push({ href: this.href, download: this.download }); });
    downloadCsv('정산.csv', toCsv([{ key: 'a', label: 'a' }], []));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(clicks).toEqual([{ href: 'blob:x', download: '정산.csv' }]);
    expect(document.querySelector('a[download]')).toBeNull();
  });
});

describe('exportCsv', () => {
  afterEach(() => vi.restoreAllMocks());

  it('0건이면 내려받지 않고 안내 문구를 넘깁니다', () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    const onEmpty = vi.fn();
    expect(exportCsv('a.csv', [{ key: 'a', label: 'a' }], [], onEmpty)).toBe(false);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(onEmpty).toHaveBeenCalledWith(NO_ROWS_MESSAGE);
    expect(NO_ROWS_MESSAGE.startsWith('내려받을 내역이 없습니다.')).toBe(true);
  });

  it('행이 있으면 내려받습니다', () => {
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const onEmpty = vi.fn();
    expect(exportCsv('a.csv', [{ key: 'a', label: 'a' }], [{ a: 1 }], onEmpty)).toBe(true);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(onEmpty).not.toHaveBeenCalled();
  });
});
