// 결제대행 어댑터 계약과 모의 어댑터 (의존성 없음, Node/Deno 공용)
//
// Gateway = {
//   confirm({ paymentKey, orderId, amount }) -> Payment
//   cancel(paymentKey, { cancelReason, cancelAmount? }) -> Payment   // cancelAmount 생략 시 남은 금액 전액
//   get(paymentKey) -> Payment
// }
// Payment = { paymentKey, orderId, status: 'DONE'|'CANCELED'|'PARTIAL_CANCELED',
//             totalAmount, balanceAmount, cancels: [{ transactionKey, cancelAmount, cancelReason }] }
// 오류는 { code, message }를 가진 PgError를 던집니다.
//
// 모의 어댑터는 외부 호출 없이 store(pg_mock_transactions 읽기/쓰기 어댑터)만 씁니다.
// store = {
//   get(paymentKey) -> row | null
//   insert(row) -> boolean             // payment_key 또는 order_id가 이미 있으면 false
//   update(paymentKey, patch, expected) -> boolean   // expected 필드가 모두 같을 때만 바꿈(낙관적 잠금)
// }
// row = { payment_key, order_id, amount, balance_amount, status, cancels }

export const PG_ERROR_MESSAGES = {
  REJECT_CARD_PAYMENT: '카드 승인이 거절되었습니다. 다른 결제 수단으로 다시 시도해 주세요.',
  ALREADY_PROCESSED_PAYMENT: '이미 처리된 결제입니다. 결제 내역을 확인해 주세요.',
  NOT_FOUND_PAYMENT: '결제 정보를 찾을 수 없습니다. 결제를 다시 진행해 주세요.',
  INVALID_CANCEL_AMOUNT: '취소할 수 있는 금액을 넘었습니다. 남은 결제 금액을 확인해 주세요.',
}

export class PgError extends Error {
  constructor(code, message = PG_ERROR_MESSAGES[code] ?? code) {
    super(message)
    this.name = 'PgError'
    this.code = code
  }
}

const toPayment = (r) => ({
  paymentKey: r.payment_key,
  orderId: r.order_id,
  status: r.status,
  totalAmount: r.amount,
  balanceAmount: r.balance_amount,
  cancels: (r.cancels ?? []).map((c) => ({ ...c })),
})

const newTransactionKey = () => `mock_tx_${crypto.randomUUID().replaceAll('-', '')}`

export function createMockGateway({ store, mode = 'APPROVE' }) {
  async function load(paymentKey) {
    const row = await store.get(paymentKey)
    if (!row) throw new PgError('NOT_FOUND_PAYMENT')
    return row
  }

  return {
    async confirm({ paymentKey, orderId, amount }) {
      if (mode === 'DECLINE') throw new PgError('REJECT_CARD_PAYMENT')
      const row = {
        payment_key: paymentKey,
        order_id: orderId,
        amount,
        balance_amount: amount,
        status: 'DONE',
        cancels: [],
      }
      if (!(await store.insert(row))) throw new PgError('ALREADY_PROCESSED_PAYMENT')
      return toPayment(row)
    },

    async cancel(paymentKey, { cancelReason, cancelAmount } = {}) {
      const row = await load(paymentKey)
      if (row.balance_amount <= 0) throw new PgError('ALREADY_PROCESSED_PAYMENT')
      const amount = cancelAmount ?? row.balance_amount
      if (!Number.isInteger(amount) || amount <= 0 || amount > row.balance_amount) {
        throw new PgError('INVALID_CANCEL_AMOUNT')
      }
      const balance = row.balance_amount - amount
      const patch = {
        balance_amount: balance,
        status: balance === 0 ? 'CANCELED' : 'PARTIAL_CANCELED',
        cancels: [...(row.cancels ?? []), { transactionKey: newTransactionKey(), cancelAmount: amount, cancelReason }],
      }
      // 같은 결제를 동시에 취소하면 한 쪽만 반영됩니다.
      if (!(await store.update(paymentKey, patch, { balance_amount: row.balance_amount }))) {
        throw new PgError('ALREADY_PROCESSED_PAYMENT')
      }
      return toPayment({ ...row, ...patch })
    },

    async get(paymentKey) {
      return toPayment(await load(paymentKey))
    },
  }
}

// 테스트용 메모리 store
export function memoryStore() {
  const rows = new Map()
  return {
    async get(paymentKey) {
      const r = rows.get(paymentKey)
      return r ? structuredClone(r) : null
    },
    async insert(row) {
      if (rows.has(row.payment_key)) return false
      for (const r of rows.values()) if (r.order_id === row.order_id) return false
      rows.set(row.payment_key, structuredClone(row))
      return true
    },
    async update(paymentKey, patch, expected = {}) {
      const r = rows.get(paymentKey)
      if (!r) return false
      if (Object.entries(expected).some(([k, v]) => r[k] !== v)) return false
      Object.assign(r, structuredClone(patch))
      return true
    },
  }
}
