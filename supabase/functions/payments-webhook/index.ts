// payments-webhook: 결제대행사 웹훅 수신 (얇은 래퍼, 로직은 _shared/payments/webhook.js)
// 요청: POST { eventType: 'PAYMENT_STATUS_CHANGED', data: { paymentKey, status, ... } }  (사용자 JWT 없음)
// 본문은 믿지 않고 pg.get으로 상태를 다시 확인해 payments.status가 다를 때만 갱신합니다(멱등).
// 응답: 200 { applied: boolean } | 400 { code } | 500 { code }
// 사용자 JWT가 없으므로 supabase/config.toml에서 verify_jwt = false로 둡니다.
// 환경 변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY(자동 주입). 결제는 모의 어댑터만 씁니다.

import { createClient } from 'npm:@supabase/supabase-js@2.119.2'
import { createMockGateway } from '../_shared/payments/gateway.js'
import { handleWebhook } from '../_shared/payments/webhook.js'
import { createDbAdapter, createPgMockStore } from '../_shared/payments/supabase-adapter.js'

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ code: 'INVALID_REQUEST' }, 405)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ code: 'INVALID_REQUEST' }, 400)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  try {
    const pg = createMockGateway({ store: createPgMockStore(admin) })
    const result = await handleWebhook({ db: createDbAdapter(admin), pg }, body)
    return json(result, 200)
  } catch (e) {
    // 5xx를 돌려주면 결제대행사가 다시 보냅니다(처리는 멱등).
    console.error('payments-webhook', e)
    return json({ code: 'INTERNAL' }, 500)
  }
})
