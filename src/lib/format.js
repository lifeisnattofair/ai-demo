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
