// 결제 웹훅 처리 (의존성 없음, Node/Deno 공용)
//
// 본문은 믿지 않습니다. PAYMENT_STATUS_CHANGED일 때 본문의 paymentKey로 pg.get을 다시 불러
// 결제대행사가 돌려준 상태가 payments.status와 다를 때만 갱신합니다. 같은 본문이 여러 번 와도 한 번만 반영됩니다.
//
// db 어댑터 계약
//   db.findPaymentByKey(paymentKey) -> payments 행 | null
//   db.rpc('apply_payment_status', { p_payment_key, p_status, p_expected }) -> boolean  // 기대 상태일 때만 바꿈

const STATUSES = new Set(['DONE', 'CANCELED', 'PARTIAL_CANCELED'])
const NOT_APPLIED = Object.freeze({ applied: false })

export async function handleWebhook({ db, pg }, body) {
  if (!body || typeof body !== 'object' || body.eventType !== 'PAYMENT_STATUS_CHANGED') return { ...NOT_APPLIED }
  const paymentKey = body.data?.paymentKey ?? body.paymentKey
  if (typeof paymentKey !== 'string' || paymentKey.length === 0 || paymentKey.length > 200) return { ...NOT_APPLIED }

  let payment
  try {
    payment = await pg.get(paymentKey)
  } catch (e) {
    if ((e?.code ?? e?.message) === 'NOT_FOUND_PAYMENT') return { ...NOT_APPLIED }
    throw e
  }
  if (!STATUSES.has(payment.status)) return { ...NOT_APPLIED }

  const row = await db.findPaymentByKey(paymentKey)
  if (!row || row.status === payment.status) return { ...NOT_APPLIED }

  const applied = await db.rpc('apply_payment_status', {
    p_payment_key: paymentKey, p_status: payment.status, p_expected: row.status,
  })
  return { applied: applied === true }
}
