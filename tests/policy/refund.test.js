import { describe, it, expect } from 'vitest'
import { refundForBeforeStart, refundForCourse, calcRefund } from '@policy/refund.js'

const base = '2026-12-10T19:00:00+09:00'
const at = (d) => `2026-${d}T12:00:00+09:00`

describe('refundForBeforeStart', () => {
  it.each([
    ['12-02', 'D8_PLUS', 40000, true],
    ['12-03', 'D7_4', 36000, true],
    ['12-06', 'D7_4', 36000, true],
    ['12-07', 'D3_1', 28000, true],
    ['12-09', 'D3_1', 28000, true],
    ['12-10', 'SAME_DAY', 0, false],
  ])('now %s -> %s', (d, rule, refund, cancellable) => {
    const r = refundForBeforeStart(40000, base, at(d))
    expect(r).toEqual({ cancellable, refundAmount: refund, feeAmount: 40000 - refund, rule })
  })
  it('floors fractional won', () => {
    const r = refundForBeforeStart(12345, base, at('12-03'))
    expect(r.refundAmount).toBe(11110)
    expect(r.feeAmount).toBe(1235)
  })
})

describe('refundForCourse', () => {
  const starts = Array.from({ length: 12 }, (_, i) => {
    const d = new Date('2026-12-01T19:00:00+09:00')
    d.setUTCDate(d.getUTCDate() + 7 * i)
    return d.toISOString()
  })
  it('before first lesson uses the table', () => {
    const r = refundForCourse(120000, starts, '2026-11-20T10:00:00+09:00')
    expect(r).toMatchObject({ rule: 'D8_PLUS', refundAmount: 120000, cancellable: true })
  })
  it('opening day before first lesson is SAME_DAY', () => {
    const r = refundForCourse(120000, starts, '2026-12-01T10:00:00+09:00')
    expect(r).toMatchObject({ rule: 'SAME_DAY', cancellable: false, refundAmount: 0 })
  })
  it.each([
    [3, 'MID_BEFORE_1_3', 80000, true],
    [4, 'MID_BEFORE_1_2', 60000, true],
    [5, 'MID_BEFORE_1_2', 60000, true],
    [6, 'MID_AFTER_1_2', 0, true],
  ])('after %i lessons started -> %s', (n, rule, refund, cancellable) => {
    const now = new Date(new Date(starts[n - 1]).getTime() + 60000).toISOString()
    const r = refundForCourse(120000, starts, now)
    expect(r).toEqual({ cancellable, refundAmount: refund, feeAmount: 120000 - refund, rule })
  })
})

describe('calcRefund', () => {
  it('dispatches by product type', () => {
    expect(calcRefund({ productType: 'PERFORMANCE', paidAmount: 40000, baseAt: base, now: at('12-02') }).rule).toBe('D8_PLUS')
    expect(calcRefund({ productType: 'EXPERIENCE', paidAmount: 40000, baseAt: base, now: at('12-07') }).refundAmount).toBe(28000)
    const lessonStarts = ['2026-12-01T19:00:00+09:00', '2026-12-08T19:00:00+09:00']
    expect(calcRefund({ productType: 'COURSE', paidAmount: 1000, lessonStarts, now: '2026-11-01T00:00:00+09:00' }).rule).toBe('D8_PLUS')
  })
  it('rejects unknown type', () => {
    expect(() => calcRefund({ productType: 'X', paidAmount: 1, baseAt: base, now: base })).toThrow()
  })
})
