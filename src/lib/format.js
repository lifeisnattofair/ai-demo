// 화면 표시용 서식. 모든 일시는 Asia/Seoul 기준으로 보여 줍니다(DAR-004).

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const KST = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const EN_WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const pad2 = (s) => String(s).padStart(2, '0');

function kstParts(iso) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) throw new RangeError('올바르지 않은 일시입니다.');
  const p = {};
  for (const { type, value } of KST.formatToParts(d)) p[type] = value;
  return {
    year: p.year,
    month: pad2(Number(p.month)),
    day: pad2(Number(p.day)),
    weekday: WEEKDAYS[EN_WEEKDAY[p.weekday]],
    hour: p.hour,
    minute: p.minute,
  };
}

// 화면의 날짜/시간 표기는 0을 채운 점 형식 하나만 씁니다(직접 문자열을 만들지 않고 아래 함수만 씁니다).
//   전체 2026.12.01(화) | 시간 포함 2026.12.01(화) 19:30 | 짧게 12.01 | 기간 2026.12.12 - 12.13

export function won(n) {
  return `${Math.trunc(Number(n)).toLocaleString('en-US')}원`;
}

// 날짜 조각: { year:'2026', month:'12', day:'01', weekday:'화', hour, minute, key:'2026-12-01' }
export function kstDateParts(iso) {
  const t = kstParts(iso);
  return { ...t, key: `${t.year}-${t.month}-${t.day}` };
}

// 2026.12.01(화)
export function kstDate(iso) {
  const t = kstParts(iso);
  return `${t.year}.${t.month}.${t.day}(${t.weekday})`;
}

// 2026.12.01 (요일 없이, 공지 날짜처럼 짧은 목록용)
export function kstDatePlain(iso) {
  const t = kstParts(iso);
  return `${t.year}.${t.month}.${t.day}`;
}

// 2026.12.01(화) 19:30
export function kstDateTime(iso) {
  const t = kstParts(iso);
  return `${t.year}.${t.month}.${t.day}(${t.weekday}) ${t.hour}:${t.minute}`;
}

// 12.01
export function kstShortDate(iso) {
  const t = kstParts(iso);
  return `${t.month}.${t.day}`;
}

// 연도 없이 요일까지: 12.01(화) (모바일 하단 바처럼 시간을 따로 보일 때)
export function kstShortDateWd(iso) {
  const t = kstParts(iso);
  return `${t.month}.${t.day}(${t.weekday})`;
}

// 날짜 고르기 칸의 윗줄: 여러 달이면 '12월 화', 한 달이면 '화'
export function kstDayChipLabel(iso, { withMonth = false } = {}) {
  const t = kstParts(iso);
  return withMonth ? `${Number(t.month)}월 ${t.weekday}` : t.weekday;
}

// 연도를 줄인 일정(표, 알림): 12.01(화) 19:30
export function kstShortDateTime(iso) {
  const t = kstParts(iso);
  return `${t.month}.${t.day}(${t.weekday}) ${t.hour}:${t.minute}`;
}

// 19:30
export function kstTime(iso) {
  const t = kstParts(iso);
  return `${t.hour}:${t.minute}`;
}

// 달 필터 키 '2026-12'
export function kstMonthKey(iso) {
  const t = kstParts(iso);
  return `${t.year}-${t.month}`;
}

/**
 * 기간: 2026.12.12 - 12.13, 해가 바뀌면 2026.12.28 - 2027.01.03, 같은 날이면 2026.12.12
 * @param {{weekday?:boolean, short?:boolean}} [opts] weekday: 날짜마다 요일, short: 연도 없이 12.12 - 12.13
 */
export function dateRange(startIso, endIso, { weekday = false, short = false } = {}) {
  const s = kstParts(startIso);
  const e = kstParts(endIso ?? startIso);
  const wd = (t) => (weekday ? `(${t.weekday})` : '');
  const head = short ? `${s.month}.${s.day}${wd(s)}` : `${s.year}.${s.month}.${s.day}${wd(s)}`;
  if (s.year === e.year && s.month === e.month && s.day === e.day) return head;
  const tail = s.year === e.year || short ? `${e.month}.${e.day}${wd(e)}` : `${e.year}.${e.month}.${e.day}${wd(e)}`;
  return `${head} - ${tail}`;
}

// '2026-12' -> '2026년 12월' (기간 선택 상자의 항목)
export function monthKeyLabel(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key ?? ''));
  return m ? `${m[1]}년 ${Number(m[2])}월` : '';
}

export function formatPhone(digits) {
  const d = String(digits ?? '').replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// 입력 상자(datetime-local, date)와 주고받는 KST 값. 화면 표시용 문구가 아니라 입력 값 형식입니다.

// '2026-12-01T19:30' (KST)
export function toKstInput(iso) {
  if (iso == null || iso === '') return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const t = kstParts(d);
  return `${t.year}-${pad2(t.month)}-${pad2(t.day)}T${t.hour}:${t.minute}`;
}

// '2026-12-01T19:30' 또는 '2026-12-01' (KST) -> ISO(UTC). 형식이 틀리면 null.
export function fromKstInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// KST 달력 날짜 키 '2026-12-01'(기간 조회 비교용)
export function kstDayKey(iso) {
  return toKstInput(iso).slice(0, 10);
}

// 검수용 시계 오프셋(밀리초)을 문구로: 86400000 -> '1일 앞', -3600000 -> '1시간 뒤', 분 미만은 ''
export function clockOffsetText(ms) {
  const total = Math.floor(Math.abs(Number(ms) || 0) / 60000);
  if (!total) return '';
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  const parts = [d && `${d}일`, h && `${h}시간`, m && `${m}분`].filter(Boolean);
  return `${parts.join(' ')} ${ms > 0 ? '앞' : '뒤'}`;
}

// 날짜 키('2026-12-01') 계산. 기간 조회 입력 값용입니다.
const DAY_MS = 86400000;
const keyToUtc = (key) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
};
const utcToKey = (ms) => new Date(ms).toISOString().slice(0, 10);

export function addDays(dayKey, n) {
  const t = keyToUtc(dayKey);
  return Number.isNaN(t) ? '' : utcToKey(t + n * DAY_MS);
}

// 달 더하기. 없는 날(1/31 + 1달)은 그 달 마지막 날로 맞춥니다.
export function addMonths(dayKey, n) {
  const t = keyToUtc(dayKey);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n + 1, 0)).getUTCDate();
  return utcToKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, Math.min(d.getUTCDate(), last)));
}

// 두 날짜 키 사이의 날짜 키 목록(양 끝 포함). 순서가 거꾸로면 빈 목록.
export function dayKeysBetween(from, to) {
  const a = keyToUtc(from);
  const b = keyToUtc(to);
  if (Number.isNaN(a) || Number.isNaN(b) || a > b) return [];
  const out = [];
  for (let t = a; t <= b; t += DAY_MS) out.push(utcToKey(t));
  return out;
}

// 날짜 키를 표시용 문구로: 2026.12.01(화), short 면 12.01, plain 이면 2026.12.01
export function dayKeyLabel(dayKey, { short = false, plain = false } = {}) {
  const iso = fromKstInput(dayKey);
  if (!iso) return '';
  if (short) return kstShortDate(iso);
  return plain ? kstDatePlain(iso) : kstDate(iso);
}
