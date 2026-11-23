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

function kstParts(iso) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) throw new RangeError('올바르지 않은 일시입니다.');
  const p = {};
  for (const { type, value } of KST.formatToParts(d)) p[type] = value;
  return {
    year: p.year,
    month: String(Number(p.month)),
    day: String(Number(p.day)),
    weekday: WEEKDAYS[EN_WEEKDAY[p.weekday]],
    hour: p.hour,
    minute: p.minute,
  };
}

export function won(n) {
  return `${Math.trunc(Number(n)).toLocaleString('en-US')}원`;
}

export function kstDate(iso) {
  const t = kstParts(iso);
  return `${t.year}. ${t.month}. ${t.day}.(${t.weekday})`;
}

export function kstDateTime(iso) {
  const t = kstParts(iso);
  return `${t.year}. ${t.month}. ${t.day}.(${t.weekday}) ${t.hour}:${t.minute}`;
}

// 올해 안의 일정처럼 연도를 줄여 보일 때: 12. 3.(목) 14:00
export function kstShortDateTime(iso) {
  const t = kstParts(iso);
  return `${t.month}. ${t.day}.(${t.weekday}) ${t.hour}:${t.minute}`;
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
const pad2 = (s) => String(s).padStart(2, '0');

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

// 연도 없이 짧게: 12. 1.(화) (정산 그래프, 표의 날짜)
export function kstShortDate(iso) {
  const t = kstParts(iso);
  return `${t.month}. ${t.day}.(${t.weekday})`;
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

// 날짜 키를 표시용 문구로: 2026. 12. 1.(화), short 면 12. 1.(화)
export function dayKeyLabel(dayKey, { short = false } = {}) {
  const iso = fromKstInput(dayKey);
  if (!iso) return '';
  return short ? kstShortDate(iso) : kstDate(iso);
}
