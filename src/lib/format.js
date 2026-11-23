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

export function formatPhone(digits) {
  const d = String(digits ?? '').replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
