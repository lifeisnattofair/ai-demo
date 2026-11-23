import { describe, it, expect } from 'vitest'
import { LIMITS, checkLimit } from '@policy/limits.js'

describe('checkLimit', () => {
  it('has limits', () => {
    expect(LIMITS).toEqual({ PERFORMANCE: 4, EXPERIENCE: 4, COURSE: 1 })
  })
  it('rejects over limit', () => {
    expect(checkLimit({ productType: 'PERFORMANCE', existingQty: 3, requestedQty: 2 })).toEqual({ ok: false, max: 4, remaining: 1 })
  })
  it('accepts exact limit', () => {
    expect(checkLimit({ productType: 'EXPERIENCE', existingQty: 2, requestedQty: 2 })).toEqual({ ok: true, max: 4, remaining: 2 })
  })
  it('course single', () => {
    expect(checkLimit({ productType: 'COURSE', existingQty: 0, requestedQty: 1 }).ok).toBe(true)
    expect(checkLimit({ productType: 'COURSE', existingQty: 1, requestedQty: 1 })).toEqual({ ok: false, max: 1, remaining: 0 })
  })
})
