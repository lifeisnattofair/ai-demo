import { describe, it, expect } from 'vitest'
import { kstDate, dDay } from '@policy/time.js'

describe('time', () => {
  it('kstDate converts to KST calendar date', () => {
    expect(kstDate('2026-12-09T16:00:00Z')).toBe('2026-12-10')
    expect(kstDate(new Date('2026-12-09T14:59:00Z'))).toBe('2026-12-09')
  })
  it('dDay switches at KST midnight', () => {
    const base = '2026-12-10T19:00:00+09:00'
    expect(dDay(base, '2026-12-09T23:59:00+09:00')).toBe(1)
    expect(dDay(base, '2026-12-10T00:01:00+09:00')).toBe(0)
  })
})
