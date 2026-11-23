// 할인 유형, 금액 계산, 선택 규칙 검증 (의존성 없음)

export const DISCOUNTS = {
  GENERAL: 0,
  DISABLED: 50,
  DISABLED_COMPANION: 50,
  MERIT: 50,
  MERIT_COMPANION: 50,
  MULTICHILD: 30,
}

export const DISCOUNT_LABELS = {
  GENERAL: '일반',
  DISABLED: '장애인',
  DISABLED_COMPANION: '장애인 동반',
  MERIT: '국가유공자',
  MERIT_COMPANION: '국가유공자 동반',
  MULTICHILD: '다자녀',
}

const COMPANIONS = ['DISABLED_COMPANION', 'MERIT_COMPANION']

const isKnown = (t) => Object.prototype.hasOwnProperty.call(DISCOUNTS, t)

export function validateDiscounts(types, productType) {
  const errors = []
  const add = (m) => {
    if (!errors.includes(m)) errors.push(m)
  }

  if (types.some((t) => !isKnown(t))) {
    return { ok: false, errors: ['알 수 없는 할인 유형입니다.'] }
  }

  const count = (k) => types.filter((t) => t === k).length

  if (productType === 'COURSE' && types.some((t) => COMPANIONS.includes(t))) {
    add('정규 강좌에는 동반 할인이 없습니다.')
  }
  if (count('DISABLED') > 1) add('장애인 할인은 1매까지 적용할 수 있습니다.')
  if (count('MERIT') > 1) add('국가유공자 할인은 1매까지 적용할 수 있습니다.')
  if (productType !== 'COURSE') {
    if (count('DISABLED_COMPANION') > count('DISABLED') || count('MERIT_COMPANION') > count('MERIT')) {
      add('동반 할인은 본인 할인과 함께 선택해 주세요.')
    }
  }

  return { ok: errors.length === 0, errors }
}

export function priceItems(items) {
  const lines = items.map(({ unitPrice, discountType }) => {
    const rate = isKnown(discountType) ? DISCOUNTS[discountType] : 0
    const discountAmount = Math.floor((unitPrice * rate) / 100)
    return { unitPrice, discountType, discountAmount, amount: unitPrice - discountAmount }
  })
  const total = lines.reduce((sum, l) => sum + l.amount, 0)
  return { lines, total }
}
