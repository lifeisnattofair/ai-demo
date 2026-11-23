// supabase-js(서비스 키) 클라이언트로 만든 db 어댑터와 모의 결제 store (Node/Deno 공용, 서버 전용)
// cancel.js, webhook.js, gateway.js의 어댑터 계약을 따릅니다. 클라이언트는 호출자가 만들어 넘깁니다.

export function createDbAdapter(admin) {
  return {
    async rpc(name, args) {
      const { data, error } = await admin.rpc(name, args)
      // SQL 오류 메시지가 곧 오류 코드입니다(errcode P0001).
      if (error) throw Object.assign(new Error(error.message), { code: error.message })
      return data
    },
    async getRole(userId) {
      const { data, error } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
      if (error) throw error
      return data?.role ?? null
    },
    async findPaymentByKey(paymentKey) {
      const { data, error } = await admin.from('payments').select('*').eq('payment_key', paymentKey).maybeSingle()
      if (error) throw error
      return data ?? null
    },
  }
}

// pg_mock_transactions 읽기/쓰기 store (gateway.js의 store 계약)
export function createPgMockStore(admin) {
  const table = () => admin.from('pg_mock_transactions')
  return {
    async get(paymentKey) {
      const { data, error } = await table().select('*').eq('payment_key', paymentKey).maybeSingle()
      if (error) throw error
      return data
    },
    async insert(row) {
      const { error } = await table().insert(row)
      if (!error) return true
      if (error.code === '23505') return false // payment_key 또는 order_id 중복
      throw error
    },
    async update(paymentKey, patch, expected = {}) {
      let q = table().update(patch).eq('payment_key', paymentKey)
      for (const [col, val] of Object.entries(expected)) q = q.eq(col, val)
      const { data, error } = await q.select('payment_key')
      if (error) throw error
      return (data ?? []).length > 0
    },
  }
}
