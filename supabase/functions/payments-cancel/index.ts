// payments-cancel: 예약 취소/환불 Edge Function (얇은 래퍼, 로직은 _shared/payments/cancel.js)
// 요청: POST { bookingId }                         회원 본인 취소(정책 환불)
//       POST { offeringId, mode: 'INSTITUTION' }   정산 담당 회차 일괄 취소(승인된 취소 요청 필요, 전액 환불)
//       헤더 Authorization: Bearer <사용자 JWT>
// 응답: 200 { status: 'CANCELLED', refundAmount, feeAmount, rule } | 200 { status: 'REJECTED', message }
//       200 { offeringId, cancelled: [...], failed: [{ bookingId, code, message }] }   (INSTITUTION)
//       4xx/5xx { code, message }
// 환경 변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY(자동 주입), ALLOWED_ORIGIN(쉼표로 여러 개)
// 현재 시각은 app_now()로 얻습니다. 결제는 모의 어댑터만 씁니다.

import { createClient } from 'npm:@supabase/supabase-js@2.119.2'
import { CANCEL_ERROR_MESSAGES, cancelBooking, cancelOffering } from '../_shared/payments/cancel.js'
import { createMockGateway } from '../_shared/payments/gateway.js'
import { createDbAdapter, createPgMockStore } from '../_shared/payments/supabase-adapter.js'

const ALLOWED = (Deno.env.get('ALLOWED_ORIGIN') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const HTTP_STATUS: Record<string, number> = {
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND_PAYMENT: 404,
  PAYMENT_NOT_FOUND: 404,
  OFFERING_NOT_FOUND: 404,
  CANCEL_NOT_APPROVED: 409,
  OFFERING_NOT_CANCELLED: 409,
  ALREADY_PROCESSED_PAYMENT: 409,
  INVALID_CANCEL_AMOUNT: 409,
  AMOUNT_MISMATCH: 409,
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

const fail = (code: string, status: number, cors: Record<string, string>) =>
  json({ code, message: (CANCEL_ERROR_MESSAGES as Record<string, string>)[code] ?? code }, status, cors)

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'))
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail('INVALID_REQUEST', 405, cors)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!token) return fail('UNAUTHENTICATED', 401, cors)
    const { data: auth, error: authError } = await admin.auth.getUser(token)
    if (authError || !auth?.user) return fail('UNAUTHENTICATED', 401, cors)

    let body: { bookingId?: unknown; offeringId?: unknown; mode?: unknown }
    try {
      body = await req.json()
    } catch {
      return fail('INVALID_REQUEST', 400, cors)
    }

    const db = createDbAdapter(admin)
    const { data: modeRow } = await admin.from('app_settings').select('value').eq('key', 'pg_mock_mode').maybeSingle()
    const pg = createMockGateway({
      store: createPgMockStore(admin),
      mode: modeRow?.value === 'DECLINE' ? 'DECLINE' : 'APPROVE',
    })
    const now = new Date(await db.rpc('app_now', {}))

    if (body?.mode === 'INSTITUTION') {
      if (typeof body.offeringId !== 'string' || !UUID_RE.test(body.offeringId)) return fail('INVALID_REQUEST', 400, cors)
      // 역할은 검증된 사용자의 profiles.role로 확인합니다(begin_offering_cancel도 다시 확인).
      const result = await cancelOffering({ db, pg, now }, { userId: auth.user.id, offeringId: body.offeringId })
      return json(result, 200, cors)
    }
    if (body?.mode !== undefined || typeof body?.bookingId !== 'string' || !UUID_RE.test(body.bookingId)) {
      return fail('INVALID_REQUEST', 400, cors)
    }
    const result = await cancelBooking({ db, pg, now }, { userId: auth.user.id, bookingId: body.bookingId, reason: 'USER' })
    return json(result, 200, cors)
  } catch (e) {
    const code = (e as { code?: string })?.code ?? 'INTERNAL'
    const status = HTTP_STATUS[code] ?? 500
    if (status === 500) {
      console.error('payments-cancel', e)
      return json({
        code: 'INTERNAL',
        message: '취소 처리 중 문제가 생겼습니다. 잠시 후 내 예약에서 상태를 확인하시고 다시 시도해 주세요.',
      }, 500, cors)
    }
    return fail(code, status, cors)
  }
})
