// KST calendar-day helpers. Dependency-free ESM shared by browser, Deno and Vitest.
// `now` is always passed in by the caller; never read the clock here.

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function toDate(at) {
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) throw new Error('invalid date: ' + String(at))
  return d
}

/** @returns {string} 'YYYY-MM-DD' in Asia/Seoul */
export function kstDate(at) {
  return fmt.format(toDate(at))
}

function dayNumber(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86400000
}

/** KST calendar date of baseAt minus KST calendar date of now, in days. */
export function dDay(baseAt, now) {
  return dayNumber(kstDate(baseAt)) - dayNumber(kstDate(now))
}
