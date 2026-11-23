// payments-confirm: 결제 승인 Edge Function (얇은 래퍼, 로직은 _shared/payments/confirm.js)
// 요청: POST { paymentKey, orderId, amount }  헤더 Authorization: Bearer <사용자 JWT>
// 응답: 200 { status: 'CONFIRMED', booking } | 200 { status: 'CANCELLED', reason, message } | 4xx/5xx { code, message }
// 환경 변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY(자동 주입), ALLOWED_ORIGIN(쉼표로 여러 개)
// 결제는 모의 어댑터만 씁니다. 외부 결제대행사 호출은 없습니다.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2'
import { CONFIRM_ERROR_MESSAGES, confirmPayment } from '../_shared/payments/confirm.js'
import { createMockGateway } from '../_shared/payments/gateway.js'

const ALLOWED = (Deno.env.get('ALLOWED_ORIGIN') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const HTTP_STATUS: Record<string, number> = {
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  REJECT_CARD_PAYMENT: 402,
  NOT_OWNER: 403,
  ORDER_NOT_FOUND: 404,
  NOT_FOUND_PAYMENT: 404,
  PAYMENT_IN_PROGRESS: 409,
  NOT_ON_SALE: 409,
  ALREADY_PROCESSED_PAYMENT: 409,
}

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  }
  if (origin && ALLOWED.includes(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}

const json = (body: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } })

function dbAdapter(admin: SupabaseClient) {
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      const { data, error } = await admin.rpc(name, args)
      // SQL 오류 메시지가 곧 오류 코드입니다(errcode P0001).
      if (error) throw Object.assign(new Error(error.message), { code: error.message })
      return data
    },
    async findBookingByOrder(orderId: string) {
      const { data, error } = await admin
        .from('payments')
        .select('booking:bookings(*)')
        .eq('order_id', orderId)
        .maybeSingle()
      if (error) throw error
      return (data?.booking as Record<string, unknown> | null) ?? null
    },
  }
}

// pg_mock_transactions 읽기/쓰기 store (gateway.js의 store 계약)
function pgMockStore(admin: SupabaseClient) {
  const table = () => admin.from('pg_mock_transactions')
  return {
    async get(paymentKey: string) {
      const { data, error } = await table().select('*').eq('payment_key', paymentKey).maybeSingle()
      if (error) throw error
      return data
    },
    async insert(row: Record<string, unknown>) {
      const { error } = await table().insert(row)
      if (!error) return true
      if (error.code === '23505') return false // payment_key 또는 order_id 중복
      throw error
    },
    async update(paymentKey: string, patch: Record<string, unknown>, expected: Record<string, unknown> = {}) {
      let q = table().update(patch).eq('payment_key', paymentKey)
      for (const [col, val] of Object.entries(expected)) q = q.eq(col, val)
      const { data, error } = await q.select('payment_key')
      if (error) throw error
      return (data ?? []).length > 0
    },
  }
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') {
    return json({ code: 'INVALID_REQUEST', message: CONFIRM_ERROR_MESSAGES.INVALID_REQUEST }, 405, cors)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const unauthenticated = () =>
      json({ code: 'UNAUTHENTICATED', message: CONFIRM_ERROR_MESSAGES.UNAUTHENTICATED }, 401, cors)
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!token) return unauthenticated()
    const { data: auth, error: authError } = await admin.auth.getUser(token)
    if (authError || !auth?.user) return unauthenticated()

    let body: { paymentKey?: unknown; orderId?: unknown; amount?: unknown }
    try {
      body = await req.json()
    } catch {
      return json({ code: 'INVALID_REQUEST', message: CONFIRM_ERROR_MESSAGES.INVALID_REQUEST }, 400, cors)
    }

    const { data: modeRow } = await admin.from('app_settings').select('value').eq('key', 'pg_mock_mode').maybeSingle()
    const pg = createMockGateway({
      store: pgMockStore(admin),
      mode: modeRow?.value === 'DECLINE' ? 'DECLINE' : 'APPROVE',
    })

    const result = await confirmPayment(
      { db: dbAdapter(admin), pg },
      { userId: auth.user.id, paymentKey: body.paymentKey, orderId: body.orderId, amount: body.amount },
    )
    return json(result, 200, cors)
  } catch (e) {
    const code = (e as { code?: string })?.code ?? 'INTERNAL'
    const status = HTTP_STATUS[code] ?? 500
    const message = status === 500
      ? '결제 처리 중 문제가 생겼습니다. 잠시 후 예매 내역을 확인하시고 다시 시도해 주세요.'
      : (CONFIRM_ERROR_MESSAGES as Record<string, string>)[code] ?? (e as Error).message
    if (status === 500) console.error('payments-confirm', e)
    return json({ code: status === 500 ? 'INTERNAL' : code, message }, status, cors)
  }
})
