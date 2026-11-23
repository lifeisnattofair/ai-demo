// 1인 한도: 공연 회차당 4매, 체험 회차당 4명, 정규 강좌 1건

export const LIMITS = { PERFORMANCE: 4, EXPERIENCE: 4, COURSE: 1 }

export function checkLimit({ productType, existingQty, requestedQty }) {
  const max = LIMITS[productType]
  const remaining = Math.max(0, max - existingQty)
  return { ok: requestedQty <= remaining, max, remaining }
}
