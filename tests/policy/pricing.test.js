import { describe, it, expect } from 'vitest'
import { DISCOUNTS, DISCOUNT_LABELS, validateDiscounts, priceItems } from '@policy/pricing.js'

describe('priceItems', () => {
  it('totals mixed discounts', () => {
    const r = priceItems([
      { unitPrice: 40000, discountType: 'DISABLED' },
      { unitPrice: 40000, discountType: 'DISABLED_COMPANION' },
      { unitPrice: 40000, discountType: 'GENERAL' },
    ])
    expect(r.total).toBe(80000)
    expect(r.lines[0]).toEqual({ unitPrice: 40000, discountType: 'DISABLED', discountAmount: 20000, amount: 20000 })
  })
  it('floors multichild discount', () => {
    const r = priceItems([{ unitPrice: 33333, discountType: 'MULTICHILD' }])
    expect(r.lines[0].discountAmount).toBe(9999)
    expect(r.lines[0].amount).toBe(23334)
  })
  it('exposes rates and labels', () => {
    expect(DISCOUNTS.MULTICHILD).toBe(30)
    expect(DISCOUNT_LABELS.DISABLED_COMPANION).toBe('장애인 동반')
  })
})

describe('validateDiscounts', () => {
  it('rejects companion without primary', () => {
    expect(validateDiscounts(['DISABLED_COMPANION'], 'PERFORMANCE')).toEqual({
      ok: false,
      errors: ['동반 할인은 본인 할인과 함께 선택해 주세요.'],
    })
  })
  it('rejects two DISABLED', () => {
    const r = validateDiscounts(['DISABLED', 'DISABLED'], 'PERFORMANCE')
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('장애인 할인은 1매까지 적용할 수 있습니다.')
  })
  it('rejects two MERIT', () => {
    expect(validateDiscounts(['MERIT', 'MERIT'], 'EXPERIENCE').errors).toContain('국가유공자 할인은 1매까지 적용할 수 있습니다.')
  })
  it('allows unlimited MULTICHILD', () => {
    expect(validateDiscounts(['MULTICHILD', 'MULTICHILD', 'MULTICHILD', 'MULTICHILD'], 'PERFORMANCE').ok).toBe(true)
  })
  it('allows primary plus companions up to count', () => {
    expect(validateDiscounts(['DISABLED', 'DISABLED_COMPANION'], 'PERFORMANCE').ok).toBe(true)
    expect(validateDiscounts(['DISABLED', 'DISABLED_COMPANION', 'DISABLED_COMPANION'], 'PERFORMANCE').ok).toBe(false)
  })
  it('rejects companion for COURSE', () => {
    const r = validateDiscounts(['MERIT_COMPANION'], 'COURSE')
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('정규 강좌에는 동반 할인이 없습니다.')
  })
  it('rejects unknown type', () => {
    expect(validateDiscounts(['VIP'], 'PERFORMANCE')).toEqual({ ok: false, errors: ['알 수 없는 할인 유형입니다.'] })
  })
})
