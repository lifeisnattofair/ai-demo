# 통합 예약 플랫폼 프로토타입 구현 계획 (요구사항 추적표 포함)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**: (가상) 한빛아트센터 공연/교육 통합 예약 플랫폼 프로토타입을 만듭니다. 검수 기준 AC-1~AC-9를 충족하는 사용자 화면과 관리자 화면, Supabase DB/Edge Functions를 포함합니다.

**Architecture**
- **화면**: Vite로 빌드하는 정적 화면입니다. `index.html`이 사용자 화면, `admin.html`이 관리자 화면이고, 둘 다 해시 라우팅을 씁니다.
- **데이터 처리**: 브라우저가 Supabase(Auth, PostgreSQL)에 직접 접속합니다.
  - 상태를 바꾸는 작업(선점, 확정, 대기, 관리자 작업)은 모두 `security definer` DB 함수(RPC)로 처리합니다. 권한 확인과 트랜잭션도 이 함수 안에서 합니다.
  - 결제 승인, 취소, 웹훅만 Edge Functions가 처리합니다.
- **정책 로직의 위치**
  - 금액/시간 정책(환불, 할인, 한도 상수)은 의존성 없는 ESM 모듈 `supabase/functions/_shared/policy/`에 둡니다. 화면(Vite 별칭 `@policy`), Edge Functions(Deno 상대 경로), Vitest가 이 모듈을 함께 씁니다.
  - 재고/대기 상태 전이는 SQL 함수 한 곳에만 구현합니다.

**Tech Stack**
- 런타임/빌드: Node 24, Vite 8.3.8, Vitest 5.1.1(+ jsdom)
- Supabase: `@supabase/supabase-js` 2.119.2, Supabase CLI(npm 패키지 `supabase`, 로컬 실행은 Docker)
- UI: KRDS(`krds-uiux` 1.1.0), Pretendard GOV
- 결제: 토스페이먼츠 결제위젯 v2(`https://js.tosspayments.com/v2/standard`)
- 서버 함수: Deno(Edge Functions)

**Spec**
- `docs/superpowers/specs/2026-11-23-booking-platform-requirements.md`: 요구사항 ID 64개, 검수 기준 AC-n
- `docs/superpowers/specs/2026-11-23-booking-platform-design.md`: 설계. 5-3 중복 방지, 5-4 대기, 5-5 금액/시간, 5-7 환경, 5-9 디자인 콘셉트

## Global Constraints

- 결제는 토스페이먼츠 **테스트 키**만 씁니다. 코드와 문서 어디에도 `live_` 키를 두지 않습니다(COR-002).
- 키는 환경 변수로만 다룹니다. 화면용은 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TOSS_CLIENT_KEY`, `VITE_ENV`(`local|qa|demo`)입니다. 함수용 비밀값은 `TOSS_SECRET_KEY`이고, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 자동으로 넣습니다. `.env`는 커밋하지 않고, `.env.example`에는 이름만 적습니다(COR-003, SER-003).
- 금액은 원 단위 정수입니다. 환불액은 `floor(결제액 × 환불비율)`, 수수료는 `결제액 − 환불액`, 할인액은 `floor(단가 × 할인율)`입니다(DAR-003).
- 일시는 `timestamptz`(UTC)로 저장합니다. D-day는 `Asia/Seoul` 달력 날짜 차이로 계산합니다(DAR-004).
- 현재 시각은 반드시 `app_now()`(SQL)나 인자로 받은 `now`(JS)로 얻습니다. `now()`나 `Date.now()`를 정책 판단에 직접 쓰지 않습니다(SFR-025).
- 선점은 10분, 대기 승격 결제 기한은 24시간입니다. 기준일 D-2 이내면 대기 승격 없이 일반 판매로 돌립니다.
- 1인 한도: 공연 회차당 4매, 체험 회차당 4명, 정규 강좌 1건입니다.
- 할인율
  - 장애인 50%(`DISABLED` ≤ 1, `DISABLED_COMPANION` ≤ `DISABLED` 수)
  - 국가유공자 50%(`MERIT` ≤ 1, `MERIT_COMPANION` ≤ `MERIT` 수)
  - 다자녀 30%(`MULTICHILD` 매수 제한 없음)
  - 매수마다 한 가지만 적용합니다. 정규 강좌에는 동반 할인이 없습니다.
- 민감정보(장애/보훈 여부 증빙)는 수집하지 않습니다. 할인 유형 코드만 저장합니다(SER-004).
- 문구에는 긴 줄표(—) 대신 하이픈(-)을 씁니다.
- 문구에는 가운뎃점(·)을 꼭 필요한 곳(정식 사업명 등)에만 씁니다. 나열은 쉼표, 짝 개념은 /, 표 구분은 | 로 씁니다. 화면 문구와 산출물 모두에 적용합니다.
- UI 문구는 한국어 존댓말로 씁니다. 오류 안내는 「원인 + 다음 행동」 형식입니다(QUR-007). 색으로만 정보를 전달하지 않습니다(QUR-001).
- 실제 기관명, 실제 공연 포스터, 실제 개인정보는 쓰지 않습니다. 포스터는 무료 사진(상업적 이용 가능) 또는 생성 이미지에 타이포그래피를 얹어 만들고, 출처를 `src/assets/images/CREDITS.md`에 남깁니다(COR-001).
- 화면 품질: 바로 출시 가능한 완성도로 만듭니다. 「목업」 「예시」 같은 설명 문구나 설명용 UI는 넣지 않습니다. 도형이나 카드 옆에 포인트 색 두꺼운 선(강조 막대)은 쓰지 않습니다. 장식 요소는 용도, 가독성, 심미성을 따져 하나씩 정합니다(설계 5-9).
- git 작성자는 `lifeisnattofair`(저장소 로컬 설정)입니다. push/배포는 사용자가 요청할 때만 합니다.

## 사용자 준비물 (실행 전 확인)

| 항목 | 필요한 시점 | 비고 |
|---|---|---|
| Docker 실행 | Task 3부터 | 로컬 Supabase(`npx supabase start`)용. 설치 확인됨(29.9.2) |
| 토스페이먼츠 개발자센터 테스트 키(클라이언트 키/시크릿 키) | Task 6, 11 | 사용자가 직접 발급해 `.env`와 `supabase/functions/.env`에 넣음. AI는 키 값을 다루지 않음 |
| Supabase 프로젝트 2개(검수용/시연용) | Task 16(배포 구성) 이후 | 로컬 개발에는 필요 없음 |

## Review Focus

1. **결제 성공 화면에서 새로고침하거나 뒤로 가기**: `payments-confirm`이 같은 `orderId`로 두 번 호출됩니다. 두 번째 호출은 이미 만들어진 예약을 그대로 돌려줘야 하고, 이중 승인이나 오류가 나면 안 됩니다. → Task 6의 `confirm is idempotent for same orderId`
2. **KST 자정 경계 취소**: 관람일 전날 23:59 KST와 당일 00:01 KST(UTC 14:59 / 15:01)에서 결과가 달라야 합니다(D-1은 70% 환불, D-0은 취소 불가). → Task 1의 `dDay switches at KST midnight`
3. **토스 승인은 성공했는데 DB 확정이 실패**: 결제를 반드시 전액 취소하고 「결제가 취소되었습니다」라고 안내해야 합니다. → Task 6의 `cancels payment when finalize fails`
4. **같은 회원이 탭 두 개로 동시에 선점**: 유효한 선점과 확정 수량을 합쳐 한도를 지켜야 합니다. 3매를 확정한 뒤 다른 탭에서 2매를 선점하면 거절해야 합니다. → Task 4의 `limit counts active holds and confirmed across tabs`
5. **관리자가 판매 중인 회차의 정원을 판매 수량보다 작게 줄임**: 거절해야 합니다. 가격 변경은 이미 확정된 예약 금액에 영향을 주지 않아야 합니다. → Task 13의 `rejects capacity below sold+held`, `price change keeps existing booking amounts`

---

## 파일 구조

```
package.json, vite.config.js, vitest.config.js, .env.example, index.html, admin.html
scripts/check-secrets.mjs          비밀값 패턴 점검 (AC-9)
scripts/check-trace.mjs            요구사항 ID ↔ 추적표 대조 (AC-8)
supabase/config.toml
supabase/migrations/0001_schema.sql        테이블, 제약, 코드(check)
supabase/migrations/0002_clock_hold.sql    app_now, 선점/만료
supabase/migrations/0003_waitlist.sql      대기/재고 반환
supabase/migrations/0004_booking.sql       결제 잠금, 확정, 취소 기록
supabase/migrations/0005_admin.sql         관리자 RPC/작업 이력/정산 뷰/초기화
supabase/migrations/0006_rls.sql           RLS 정책
supabase/seed.sql                           가상 프로그램, 좌석, 계정 시드 (함수 seed_demo(base timestamptz))
supabase/functions/_shared/policy/time.js, refund.js, pricing.js, limits.js
supabase/functions/_shared/payments/toss.js      토스 API 클라이언트(fetch 주입)
supabase/functions/_shared/payments/confirm.js   승인 처리 로직(의존성 주입)
supabase/functions/_shared/payments/cancel.js    취소/환불 로직
supabase/functions/_shared/payments/webhook.js   웹훅 처리 로직
supabase/functions/payments-confirm/index.ts, payments-cancel/index.ts, payments-webhook/index.ts   얇은 Deno 래퍼
src/lib/supabase.js, api.js, format.js, router.js, clock.js
src/styles/tokens.css (KRDS 토큰 재선언), user.css, admin.css
src/user/main.js, pages/*.js, components/*.js
src/admin/main.js, layout.js, pages/*.js
src/assets/images/              무료 사진 원본(내려받기는 사용자 확인 후), CREDITS.md에 출처와 라이선스 기록
src/user/components/poster.js   사진 + 타이포그래피 포스터 컴포넌트
design/mockups/                 디자인 시안(반응형 HTML, Task 8A)
tests/policy/*.test.js         정책 단위 테스트(Node)
tests/db/*.test.js             DB 통합 테스트(로컬 Supabase)
tests/payments/*.test.js       결제 로직 단위 테스트(가짜 토스/가짜 DB)
tests/ui/*.test.js             화면 핵심 동작(jsdom)
docs/deliverables/table-definition.md, code-definition.md   데이터 산출물 (DAR-001, DAR-002)
.github/workflows/pages.yml    GitHub Pages 배포 워크플로(실행은 사용자 요청 시)
```

**공통 테스트 도우미** (Task 3에서 만들고 이후 계속 씁니다): `tests/db/helpers.js`
- `adminClient()`: 서비스 키 클라이언트
- `userClient(email)`: 시드 회원으로 로그인한 클라이언트
- `resetDb(baseIso)`: `seed_demo(base)` 호출
- `setClock(offsetMs)`: `app_settings.clock_offset_ms` 설정

---

### Task 0: 프로젝트 골격과 비밀값 점검

**Files**
- Create: `package.json`, `vite.config.js`, `vitest.config.js`, `.env.example`, `index.html`, `admin.html`, `src/user/main.js`, `src/admin/main.js`, `scripts/check-secrets.mjs`
- Test: `tests/scripts/check-secrets.test.js`

**Interfaces**
- Produces
  - npm 스크립트: `dev`, `build`, `test`(Vitest, `tests/db` 제외), `test:db`(`tests/db`만), `check:secrets`. `check:trace`는 Task 16에서 추가합니다.
  - Vite 별칭 `@policy` → `supabase/functions/_shared/policy`
  - `scanForSecrets(files: {path:string, content:string}[]) -> {path:string, line:number, pattern:string}[]`

- [ ] **Step 1: 실패하는 테스트 작성** `tests/scripts/check-secrets.test.js`
  - `scanForSecrets([{path:'a.js', content:'const k="test_sk_abc123"'}])`는 결과 1건, `pattern === 'toss-secret'`
  - `live_gck_`, `live_sk_`도 감지하고, `eyJ`로 시작하는 JWT 형태(서비스 키)도 감지합니다.
  - `.env.example`처럼 값 없이 `TOSS_SECRET_KEY=`만 있는 줄은 결과 0건입니다.
- [ ] **Step 2: 실행해서 실패 확인**: `npx vitest run tests/scripts` → FAIL(모듈 없음)
- [ ] **Step 3: 구현**
  - `package.json`: `"type":"module"`, 의존성(Global의 정확한 버전), devDependency에 `supabase`, `jsdom`
  - `scripts/check-secrets.mjs`: `git ls-files` 목록을 읽어 `scanForSecrets`를 실행합니다. 결과가 있으면 종료 코드 1입니다. 패턴은 `test_sk_`, `live_(gck|gsk|ck|sk)_`, `eyJ[A-Za-z0-9_-]{20,}\.`입니다.
  - 빌드 입력은 `index.html`과 `admin.html` 두 개입니다. `base`는 `process.env.VITE_BASE ?? '/'`로 둡니다(Pages는 `/ai-demo/`).
  - KRDS CSS와 Pretendard GOV는 `index.html`과 `admin.html`에서 불러옵니다.
- [ ] **Step 4: 통과 확인**: `npm test`가 PASS, `npm run build` 성공(`dist/index.html`, `dist/admin.html` 생성), `npm run check:secrets` 종료 코드 0
- [ ] **Step 5: 커밋**: `chore: Vite/Vitest 골격과 비밀값 점검 스크립트`

### Task 1: 정책 - KST 날짜와 환불 계산

**Files**
- Create: `supabase/functions/_shared/policy/time.js`, `refund.js`
- Test: `tests/policy/time.test.js`, `tests/policy/refund.test.js`

**Interfaces**
- Produces
  - `kstDate(at: Date|string) -> 'YYYY-MM-DD'`
  - `dDay(baseAt: Date|string, now: Date|string) -> number`: 기준일 KST 날짜 − 현재 KST 날짜(일)
  - `refundForBeforeStart(paidAmount:number, baseAt, now) -> RefundResult`
  - `refundForCourse(paidAmount:number, lessonStarts:(Date|string)[], now) -> RefundResult`
  - `calcRefund({productType:'PERFORMANCE'|'EXPERIENCE'|'COURSE', paidAmount, baseAt, lessonStarts?, now}) -> RefundResult`
  - `RefundResult = {cancellable:boolean, refundAmount:number, feeAmount:number, rule:'D8_PLUS'|'D7_4'|'D3_1'|'SAME_DAY'|'MID_BEFORE_1_3'|'MID_BEFORE_1_2'|'MID_AFTER_1_2'}`

- [ ] **Step 1: 실패하는 테스트 작성**
  - `dDay switches at KST midnight`: 기준 `2026-12-10T19:00:00+09:00`
    - now `2026-12-09T23:59:00+09:00` → 1
    - now `2026-12-10T00:01:00+09:00` → 0
  - 수수료 구간: 결제액 40000, 기준일 12/10
    - 12/02 → `D8_PLUS`, 환불 40000, 수수료 0
    - 12/03 → `D7_4`, 환불 36000
    - 12/06 → `D7_4`, 환불 36000
    - 12/07 → `D3_1`, 환불 28000
    - 12/09 → `D3_1`, 환불 28000
    - 12/10 → `SAME_DAY`, `cancellable:false`, 환불 0
  - 원 미만 버림: 12345, D-7 → 환불 11110, 수수료 1235
  - 정규 강좌: 결제액 120000, 주 1회 12회차(첫 회 `2026-12-01T19:00+09:00`)
    - 첫 회 이전(11/20) → 표 적용, `D8_PLUS`, 환불 120000
    - 개강 당일 첫 회 전(12/01 10:00) → `SAME_DAY`, 취소 불가
    - 3회 시작 후 → `MID_BEFORE_1_3`, 환불 80000
    - 4회 시작 후(정확히 1/3) → `MID_BEFORE_1_2`, 환불 60000
    - 5회 시작 후 → `MID_BEFORE_1_2`, 환불 60000
    - 6회 시작 후(정확히 1/2) → `MID_AFTER_1_2`, `cancellable:true`, 환불 0, 수수료 120000
- [ ] **Step 2: 실행해서 실패 확인**: `npx vitest run tests/policy` → FAIL
- [ ] **Step 3: 구현**
  - 비율은 분수 `{num, den}`로 다룹니다(100/100, 90/100, 70/100, 2/3, 1/2, 0/1). 환불액은 `Math.floor(paid*num/den)`입니다.
  - 시작한 회차 수는 「`lessonStart <= now`인 개수」입니다. 판정은 `started*3 < total` → 2/3, `started*2 < total` → 1/2, 그 밖은 0입니다.
  - KST 변환은 `Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'})`로 합니다.
- [ ] **Step 4: 통과 확인**: `npx vitest run tests/policy` → PASS
- [ ] **Step 5: 커밋**: `feat(policy): KST D-day와 환불 계산`

### Task 2: 정책 - 할인/금액과 1인 한도

**Files**
- Create: `supabase/functions/_shared/policy/pricing.js`, `limits.js`
- Test: `tests/policy/pricing.test.js`, `tests/policy/limits.test.js`

**Interfaces**
- Produces
  - `DISCOUNTS = {GENERAL:0, DISABLED:50, DISABLED_COMPANION:50, MERIT:50, MERIT_COMPANION:50, MULTICHILD:30}`(퍼센트), `DISCOUNT_LABELS`(한국어 이름)
  - `validateDiscounts(types:string[], productType) -> {ok:boolean, errors:string[]}`
  - `priceItems(items:{unitPrice:number, discountType:string}[]) -> {lines:{unitPrice, discountType, discountAmount, amount}[], total:number}`
  - `LIMITS = {PERFORMANCE:4, EXPERIENCE:4, COURSE:1}`, `checkLimit({productType, existingQty, requestedQty}) -> {ok, max, remaining}`

- [ ] **Step 1: 실패하는 테스트 작성**
  - `priceItems([{unitPrice:40000,discountType:'DISABLED'},{unitPrice:40000,discountType:'DISABLED_COMPANION'},{unitPrice:40000,discountType:'GENERAL'}])` → total 80000
  - `MULTICHILD` 30%: 단가 33333 → 할인액 9999, 금액 23334
  - `validateDiscounts(['DISABLED_COMPANION'],'PERFORMANCE')` → ok false, 오류 `'동반 할인은 본인 할인과 함께 선택해 주세요.'`
  - `validateDiscounts(['DISABLED','DISABLED'],…)` → ok false
  - `['MULTICHILD','MULTICHILD','MULTICHILD','MULTICHILD']` → ok true
  - `validateDiscounts(['MERIT_COMPANION'],'COURSE')` → ok false, `'정규 강좌에는 동반 할인이 없습니다.'`
  - `checkLimit({productType:'PERFORMANCE', existingQty:3, requestedQty:2})` → ok false, remaining 1
  - `checkLimit({productType:'COURSE', existingQty:0, requestedQty:1})` → ok true
- [ ] **Step 2: 실행해서 실패 확인**
- [ ] **Step 3: 구현**: 위 시그니처대로 작성합니다. 오류 문구는 테스트에 적힌 문장을 그대로 씁니다.
- [ ] **Step 4: 통과 확인**: `npx vitest run tests/policy` → PASS
- [ ] **Step 5: 커밋**: `feat(policy): 할인 금액 계산과 1인 한도`

### Task 3: DB 스키마, 코드, 시드와 데이터 산출물

**Files**
- Create: `supabase/config.toml`(`npx supabase init`), `supabase/migrations/0001_schema.sql`, `supabase/seed.sql`, `tests/db/helpers.js`, `docs/deliverables/table-definition.md`, `code-definition.md`
- Test: `tests/db/schema.test.js`

**Interfaces**
- Produces (테이블. 이후 모든 Task가 이 이름을 씁니다)
  - `profiles(id uuid pk → auth.users, name, phone, role text check in ('member','operator','finance'), verified_at)`
  - `programs(id, type check in ('PERFORMANCE','EXPERIENCE','COURSE'), title, summary, description, venue, audience, poster_image text, poster_tone text check in ('light','dark'), is_public bool, created_at)`
  - `offerings(id, program_id, starts_at, ends_at, capacity int, sale_starts_at, sale_ends_at, status check in ('OPEN','CANCEL_REQUESTED','CANCELLED'))`: 판매 단위. 공연/체험은 회차, 정규 강좌는 과정
  - `course_lessons(offering_id, seq, starts_at, pk(offering_id, seq))`
  - `seats(id, row_label, seat_no, grade check in ('R','S','A'), pk id, unique(row_label, seat_no))`
  - `offering_prices(offering_id, grade text null, price int)`: 정원제는 grade null 한 행
  - `inventory_seats(offering_id, seat_id, status check in ('AVAILABLE','HELD','PAYING','WAIT_ALLOCATED','SOLD'), hold_id null, waitlist_id null, primary key(offering_id, seat_id))`
  - `holds(id, offering_id, user_id, qty, status check in ('ACTIVE','PAYING','CONSUMED','EXPIRED','RELEASED'), order_id text unique null, amount int null, items jsonb null, expires_at, created_at)`
  - `bookings(id, booking_no text unique, user_id, offering_id, hold_id unique, status check in ('CONFIRMED','CANCELLED'), total_amount, created_at, cancelled_at)`
  - `booking_items(id, booking_id, seat_id null, discount_type, unit_price, discount_amount, amount, proof_checked bool default false)`
  - `payments(id, order_id unique, payment_key unique, booking_id null, user_id, amount, status check in ('DONE','CANCELED','PARTIAL_CANCELED'), approved_at, raw jsonb)`
  - `refunds(id, payment_id, booking_id, refund_amount, fee_amount, rule, reason check in ('USER','INSTITUTION','CONFLICT'), toss_transaction_key, created_at)`
  - `waitlist(id, offering_id, user_id, qty, allocated_qty int default 0, status check in ('WAITING','PROMOTED','COMPLETED','EXPIRED','CANCELLED','RELEASED'), promoted_at, deadline_at, created_at)`
  - `notifications(id, user_id, kind, title, body, channel text default 'SMS_MOCK', read_at, created_at)`
  - `admin_audit(id, actor_id, action, target_type, target_id, detail jsonb, at)`
  - `app_settings(key text pk, value jsonb)`: 키는 `clock_enabled`, `clock_offset_ms`, `env`
  - `offering_cancel_requests(id, offering_id, requested_by, reason, status check in ('REQUESTED','APPROVED','REJECTED'), decided_by, decided_at)`
  - `seed_demo(base timestamptz) returns void`: 거래성 테이블을 비우고 시드를 다시 넣습니다.
  - 테스트 도우미: `adminClient()`, `userClient(email)`, `resetDb(baseIso)`, `setClock(offsetMs)`

- [ ] **Step 1: 실패하는 테스트 작성** `tests/db/schema.test.js`(`resetDb('2026-12-01T00:00:00+09:00')` 이후)
  - `seats`는 200행입니다. A~J열 × 20석이고, A~D는 R, E~G는 S, H~J는 A 등급입니다.
  - `programs`: 유형별 2개씩 6개입니다(공연 2, 체험 2, 정규 강좌 2).
  - 정규 강좌 과정마다 `course_lessons` 12행이 있습니다(주 1회).
  - 공연 회차마다 `inventory_seats` 200행이 있고 모두 `AVAILABLE`입니다.
  - 시드 계정: `member1~3@demo.test`, `operator@demo.test`, `finance@demo.test`. 역할이 각각 맞아야 합니다.
  - `inventory_seats`에 같은 `(offering_id, seat_id)`를 삽입하면 고유 제약 오류가 납니다.
- [ ] **Step 2: 실행해서 실패 확인**: `npx supabase start`(Docker) → `npm run test:db` → FAIL
- [ ] **Step 3: 구현**
  - 스키마와 `seed_demo`를 작성합니다.
  - 가격: 공연은 R 40000 / S 30000 / A 20000, 체험은 10000원/정원 20, 정규 강좌는 120000원/정원 15입니다.
  - 일정은 모두 `base` 기준 상대값입니다. 공연 회차 base+10일/base+20일, 체험 base+5일/base+12일, 정규 강좌 첫 회 base+9일입니다.
  - 가상 프로그램 이름은 빌더가 정합니다. 실제 기관/인물 이름은 쓰지 않습니다.
  - 시드 계정 비밀번호는 `supabase/seed.sql` 안의 데모 전용 값으로 두고, README 시연 안내에 같은 값을 적습니다.
  - 산출물 두 문서를 마이그레이션에서 옮겨 씁니다.
    - 테이블 정의서: 테이블명, 한글명, 컬럼, 타입, 키, 설명, 보관 기간
    - 코드 정의서: check 값과 한글명. 결제/환불 기록은 「5년 보관 대상」으로 표시합니다(DAR-005).
- [ ] **Step 4: 통과 확인**: `npm run test:db -- schema` → PASS
- [ ] **Step 5: 커밋**: `feat(db): 스키마/시드와 테이블/코드 정의서`

### Task 4: DB - 검수용 시계, 선점, 만료, 한도

**Files**
- Create: `supabase/migrations/0002_clock_hold.sql`
- Test: `tests/db/hold.test.js`

**Interfaces**
- Consumes: Task 3 테이블
- Produces (RPC. 모두 `auth.uid()` 기준)
  - `app_now() returns timestamptz`: `clock_enabled`가 true이면 `now() + clock_offset_ms`
  - `d_day(base timestamptz) returns int`: KST 날짜 차이
  - `sweep_offering(p_offering uuid) returns void`: 만료된 ACTIVE 선점을 EXPIRED로 바꾸고 좌석을 AVAILABLE로 되돌립니다. PAYING은 건드리지 않습니다. 대기 처리(Task 5)도 여기서 호출합니다.
  - `hold_seats(p_offering uuid, p_seat_ids uuid[]) returns holds`
  - `hold_capacity(p_offering uuid, p_qty int) returns holds`
  - `release_hold(p_hold uuid) returns void`
  - `remaining_capacity(p_offering uuid) returns int`
  - 오류 코드(`raise exception using errcode='P0001', message=`): `SEAT_TAKEN`, `SOLD_OUT`, `LIMIT_EXCEEDED`, `NOT_ON_SALE`, `NOT_OWNER`

- [ ] **Step 1: 실패하는 테스트 작성**
  - `hold_seats`로 2석을 잡으면 holds `ACTIVE`, `expires_at = app_now()+10분`이고 두 좌석이 `HELD`입니다.
  - **동시성(PER-004, AC-3)**: 회원 3명이 같은 좌석으로 `hold_seats`를 `Promise.all` 20회 호출하면 성공 1건, 나머지는 `SEAT_TAKEN`입니다.
  - 정원 20인 체험에 20개 클라이언트가 각 2명씩 동시에 `hold_capacity`를 호출하면 성공 수량 합계가 20 이하입니다.
  - `setClock(10분+1초)` 후 `sweep_offering`을 호출하면 선점이 `EXPIRED`가 되고 좌석은 `AVAILABLE`로 돌아갑니다. 이후 다른 회원이 같은 좌석을 선점할 수 있습니다(AC-4).
  - `limit counts active holds and confirmed across tabs`: 3매 확정(테스트에서 직접 삽입) + 2매 선점 시도 → `LIMIT_EXCEEDED`. 1매는 성공합니다.
  - 판매 기간이 아니면 `NOT_ON_SALE`입니다.
  - `clock_enabled=false`이면 offset이 있어도 `app_now()`가 `now()`와 1초 이내로 같습니다.
- [ ] **Step 2: 실행해서 실패 확인**
- [ ] **Step 3: 구현**
  - 정원제는 `select … from offerings where id=$1 for update`로 회차 행을 잠근 뒤, `확정 수 + 유효 선점 수 + 대기 배정 수 + 요청 ≤ capacity`를 확인합니다.
  - 좌석은 `update inventory_seats set status='HELD' … where status='AVAILABLE' and seat_id = any($2)`로 바꾸고, 바뀐 행 수가 요청 수와 다르면 예외를 던져 롤백합니다.
  - 한도 상수는 SQL 함수 `product_limit(type)`에 둡니다. 값은 `LIMITS`와 같아야 하고, 테스트에서 두 값을 비교합니다.
- [ ] **Step 4: 통과 확인**: `npm run test:db -- hold` → PASS
- [ ] **Step 5: 커밋**: `feat(db): 선점, 만료, 한도와 검수용 시계`

### Task 5: DB - 대기 신청, 승격, 만료

**Files**
- Create: `supabase/migrations/0003_waitlist.sql`
- Test: `tests/db/waitlist.test.js`

**Interfaces**
- Consumes: `app_now`, `d_day`, `sweep_offering`
- Produces
  - `join_waitlist(p_offering uuid, p_qty int) returns waitlist`: 매진일 때만 받습니다(아니면 `NOT_SOLD_OUT`). 한도는 기존 확정 + 대기 수량으로 계산합니다. 같은 회차에 진행 중인 대기가 있으면 `ALREADY_WAITING`입니다.
  - `cancel_waitlist(p_id uuid) returns void`
  - `release_inventory(p_offering uuid, p_seat_ids uuid[], p_qty int) returns void`: 취소로 풀린 재고를 반환합니다. 내부 호출 전용입니다.
  - `hold_for_promotion(p_waitlist uuid) returns holds`: 승격자가 결제하러 들어올 때 배정분으로 선점을 만듭니다. `expires_at = deadline_at`
  - 알림 종류: `WAIT_PROMOTED`, `WAIT_EXPIRED`

- [ ] **Step 1: 실패하는 테스트 작성**(기준 base = 12/01 00:00 KST, 공연 회차 12/11, 매진 상태로 준비)
  - 대기 1순위 2매, 2순위 1매일 때 1석이 취소되면: 1순위 `allocated_qty=1`, 상태 `WAITING`, 좌석은 `WAIT_ALLOCATED`. 2순위는 그대로입니다.
  - 이어서 2석이 더 취소되면: 1순위 `PROMOTED`, `deadline_at=app_now()+24h`, 알림 `WAIT_PROMOTED` 1건. 남은 1석은 2순위로 가서 2순위도 `PROMOTED`입니다.
  - 승격 후 24시간+1초가 지나고 `sweep_offering`을 호출하면, 1순위가 `EXPIRED`가 되고 배정 좌석은 다음 대기자에게 갑니다. 없으면 `AVAILABLE`입니다.
  - 기준일 D-2 이내(12/09 KST)의 취소는 대기자가 있어도 좌석을 `AVAILABLE`로 돌립니다.
  - 기한 만료 시점이 D-2 이내면 다음 순위로 넘기지 않고 `AVAILABLE`로 돌립니다. 모으던 중(WAITING, allocated>0)인 배정분도 D-2가 되면 풀립니다. 대기 상태는 `RELEASED`, 알림은 `WAIT_EXPIRED`입니다.
  - 정규 강좌는 첫 회 시작 이후 `join_waitlist`가 `NOT_ON_SALE`이고, 취소분은 대기에 배정하지 않습니다(개강 후 추가 모집 없음).
  - `hold_for_promotion`으로 만든 선점은 일반 회원이 그 좌석을 잡지 못하게 합니다(`SEAT_TAKEN`).
- [ ] **Step 2: 실행해서 실패 확인**
- [ ] **Step 3: 구현**: 배정은 `created_at` 순으로 FIFO입니다. 공연은 풀린 좌석 ID를 순서대로 배정하고 `inventory_seats.waitlist_id`에 기록합니다. 정원제는 `allocated_qty`만 늘립니다.
- [ ] **Step 4: 통과 확인**: `npm run test:db -- waitlist` → PASS
- [ ] **Step 5: 커밋**: `feat(db): 대기 신청/누적 배정, 승격, 만료`

### Task 6: 결제 승인 (payments-confirm)

**Files**
- Create: `supabase/migrations/0004_booking.sql`, `supabase/functions/_shared/payments/toss.js`, `confirm.js`, `supabase/functions/payments-confirm/index.ts`, `supabase/functions/.env.example`
- Test: `tests/payments/confirm.test.js`, `tests/db/booking.test.js`

**Interfaces**
- Consumes: `priceItems`, `validateDiscounts`(Task 2), holds(Task 4)
- Produces
  - SQL `prepare_payment(p_hold uuid, p_items jsonb, p_amount int, p_order_id text) returns holds`: 소유자 확인 후 `order_id`, `items`, `amount`를 기록합니다. 화면이 결제위젯을 열기 전에 호출합니다.
  - SQL `lock_for_confirm(p_order_id text) returns holds`: ACTIVE이고 만료 전이면 PAYING으로 바꿉니다. 아니면 `HOLD_EXPIRED`입니다.
  - SQL `finalize_booking(p_order_id text, p_payment_key text, p_raw jsonb) returns bookings`: 좌석 SOLD, 선점 CONSUMED, 예약, 항목, 결제 행 생성, 승격 대기 COMPLETED, 알림 `PAYMENT_DONE`까지 한 트랜잭션으로 처리합니다.
  - SQL `unlock_after_failure(p_order_id text) returns void`: PAYING을 ACTIVE로 되돌립니다(만료 시각이 지났으면 EXPIRED).
  - `createToss({secretKey, fetch}) -> {confirm({paymentKey, orderId, amount}), cancel(paymentKey, {cancelReason, cancelAmount?}), get(paymentKey)}`
    - Basic 인증 `base64(secretKey + ':')`, 기본 URL `https://api.tosspayments.com/v1/payments`
  - `confirmPayment({db, toss}, {userId, paymentKey, orderId, amount}) -> {status:'CONFIRMED', booking} | {status:'CANCELLED', reason:'HOLD_EXPIRED'|'AMOUNT_MISMATCH'|'FINALIZE_FAILED', message:string}`
    - `db`는 RPC를 부르는 얇은 어댑터입니다(`db.rpc(name, args)`, `db.findBookingByOrder(orderId)`).
  - 주문번호 형식: `HB-YYYYMMDD-` + 영숫자 10자리(토스 규칙 6~64자 준수)

- [ ] **Step 1: 실패하는 테스트 작성**
  - `tests/payments/confirm.test.js`(가짜 db/toss)
    - 정상: 선점 금액 80000 = 요청 금액 80000 → `toss.confirm` 1회, `finalize_booking` 1회, 상태 `CONFIRMED`
    - `AMOUNT_MISMATCH`: 요청 금액 1000 ≠ 서버 재계산 80000 → `toss.confirm`을 호출하지 않습니다. 메시지는 `'결제 금액이 예약 금액과 달라 결제를 진행하지 않았습니다. 다시 시도해 주세요.'`
    - `HOLD_EXPIRED`: `lock_for_confirm`이 실패하면 `toss.confirm`을 호출하지 않습니다(위젯 인증만 된 상태라 승인 전이므로 취소할 것이 없음). 메시지는 `'좌석 선점 시간이 지나 결제가 진행되지 않았습니다. 좌석을 다시 선택해 주세요.'`
    - `cancels payment when finalize fails`: toss.confirm 성공 후 `finalize_booking`이 예외를 던지면 `toss.cancel(paymentKey,{cancelReason:'예약 확정 실패'})` 1회, `unlock_after_failure` 1회, 상태 `CANCELLED`
    - `confirm is idempotent for same orderId`: `findBookingByOrder`가 예약을 돌려주면 toss를 호출하지 않고 같은 예약을 돌려줍니다.
    - 토스가 `ALREADY_PROCESSED_PAYMENT`를 응답하면 `toss.get`으로 상태를 확인한 뒤 `finalize_booking`을 진행합니다.
  - `tests/db/booking.test.js`
    - `prepare_payment` → `lock_for_confirm` → `finalize_booking` 후 좌석 SOLD, 예약 1건, `booking_no` 형식 `B` + 8자리입니다.
    - **AC-3 시나리오**: 회원 A 선점 → 시계 +11분 → 회원 B가 같은 좌석을 선점/확정 → A의 `lock_for_confirm`이 `HOLD_EXPIRED`입니다.
- [ ] **Step 2: 실행해서 실패 확인**: `npx vitest run tests/payments` → FAIL
- [ ] **Step 3: 구현**
  - 금액 재계산은 `holds.items`(prepare 때 저장한 단가/할인)로 `priceItems`를 다시 실행해 비교합니다.
  - 순서는 `lock_for_confirm` → 금액 비교 → `toss.confirm` → `finalize_booking`입니다. 금액이 다르면 `unlock_after_failure`를 부릅니다.
  - Deno 래퍼는 요청 JWT에서 사용자를 확인하고, 서비스 키 클라이언트로 db 어댑터를 만듭니다. CORS 허용 도메인은 환경 변수 `ALLOWED_ORIGIN`으로 받습니다.
- [ ] **Step 4: 통과 확인**: `npx vitest run tests/payments`와 `npm run test:db -- booking` → PASS
- [ ] **Step 5: 커밋**: `feat(payments): 결제 승인, 재검증, 실패 시 자동 취소`

### Task 7: 결제 취소/환불과 웹훅

**Files**
- Create: `supabase/functions/_shared/payments/cancel.js`, `webhook.js`, `supabase/functions/payments-cancel/index.ts`, `payments-webhook/index.ts`. 마이그레이션 `0004_booking.sql`에 함수를 추가합니다.
- Test: `tests/payments/cancel.test.js`, `tests/payments/webhook.test.js`, `tests/db/cancel.test.js`

**Interfaces**
- Consumes: `calcRefund`(Task 1), `createToss`(Task 6), `release_inventory`(Task 5)
- Produces
  - SQL `cancel_context(p_booking uuid) returns jsonb`: `{productType, paidAmount, baseAt, lessonStarts, paymentKey, status, ownerId}`
  - SQL `finalize_cancel(p_booking uuid, p_refund int, p_fee int, p_rule text, p_reason text, p_tx_key text) returns bookings`: 예약 CANCELLED, 환불 기록, 결제 상태 변경, 재고 반환(`release_inventory`), 알림 `BOOKING_CANCELLED`
  - `cancelBooking({db, toss, now}, {userId, bookingId, reason:'USER'|'INSTITUTION'}) -> {status:'CANCELLED', refundAmount, feeAmount, rule} | {status:'REJECTED', message}`
    - `reason='INSTITUTION'`이면 정책과 관계없이 전액 환불하고, rule은 `'INSTITUTION_FULL'`입니다.
  - `handleWebhook({db, toss}, body) -> {applied:boolean}`
    - `eventType==='PAYMENT_STATUS_CHANGED'`일 때만 처리합니다. 본문은 믿지 않고 `toss.get(paymentKey)`로 상태를 다시 확인한 뒤, `payments.status`가 다를 때만 갱신합니다.
  - Edge `payments-cancel` 요청 본문: `{bookingId}`(회원 본인) 또는 `{offeringId, mode:'INSTITUTION'}`(정산 담당만. 승인된 취소 요청이 있어야 함)

- [ ] **Step 1: 실패하는 테스트 작성**
  - `cancel.test.js`
    - D-7 공연 40000원 → `toss.cancel(paymentKey,{cancelReason:'고객 취소', cancelAmount:36000})`, 결과 `{refundAmount:36000, feeAmount:4000, rule:'D7_4'}`
    - 당일 → `REJECTED`, 메시지 `'관람(개강) 당일에는 취소할 수 없습니다.'`, toss 호출 없음
    - 1/2 경과 강좌 → `cancelAmount`를 넘기지 않습니다(환불 0이라 토스 취소 없음). `finalize_cancel`의 `p_refund=0`, 예약 CANCELLED
    - 남의 예약 → `REJECTED`, `'본인 예약만 취소할 수 있습니다.'`
    - `INSTITUTION` → 전액 `cancelAmount` 생략(전액 취소)
  - `webhook.test.js`
    - 같은 본문 2회 → 첫 번째 `applied:true`, 두 번째 `applied:false`
    - 본문 status가 `CANCELED`여도 `toss.get`이 `DONE`이면 갱신하지 않습니다.
  - `tests/db/cancel.test.js`: 취소하면 좌석이 대기 1순위에게 배정됩니다(Task 5 규칙이 취소 흐름에서 실제로 호출되는지 확인).
- [ ] **Step 2: 실행해서 실패 확인**
- [ ] **Step 3: 구현**: 기관 일괄 취소는 해당 회차의 CONFIRMED 예약마다 `cancelBooking(…,'INSTITUTION')`을 순차 실행합니다. 실패 건은 목록으로 돌려주고 나머지는 계속 진행합니다. 일괄 취소로 풀린 재고는 대기에 배정하지 않고, 회차가 CANCELLED이므로 판매도 닫습니다.
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋**: `feat(payments): 취소, 환불, 기관 일괄 환불/웹훅 멱등 처리`

### Task 8A: 디자인 시안 (사용자 확인 게이트)

구현 화면(Task 8~15)보다 먼저 만듭니다. **사용자가 시안을 확정하기 전에는 Task 8 이후를 진행하지 않습니다.**

**Files**
- Create: `design/mockups/user-list.html`, `user-detail.html`, `user-seat.html`, `user-checkout.html`, `user-mybooking.html`, `admin-bookings.html`, `admin-settlement.html`, `design/mockups/assets/`(시안용 사진, CSS)

**Interfaces**
- Produces: 확정한 디자인 토큰(색, 글자 크기 단계, 간격, 모서리, 그림자)을 `design/mockups/tokens.css`에 정리합니다. Task 8의 `src/styles/tokens.css`는 이 값을 그대로 옮깁니다.

- [ ] **Step 1: 사진 확보**: 프로그램 6개에 맞는 무료 사진 후보(Unsplash, Pexels 등 상업적 이용 가능 라이선스)를 찾아 링크와 라이선스를 사용자에게 보여 주고, 내려받기 승인을 받습니다. 맞는 사진이 없으면 생성 이미지 프롬프트를 제안합니다(사용자가 직접 생성해도 됩니다).
- [ ] **Step 2: 시안 작성**: 설계 5-9의 콘셉트와 「시안, 화면 품질 기준」을 따라 반응형 HTML 시안을 만듭니다. KRDS 컴포넌트를 바탕으로 하고, 실제 서비스처럼 현실적인 가상 데이터로 채웁니다.
- [ ] **Step 3: 자체 점검**: 1440×900, 390×844로 캡처해 확인합니다. 확인 항목은 가로 넘침 없음, 강조 막대와 설명용 문구 없음, 가운뎃점은 필요한 곳에만 있음입니다. 캡처는 `portfolio/shots/mockups/`에 webp로 저장합니다.
- [ ] **Step 4: 사용자 확인**: 시안을 보여 드리고 피드백을 반영합니다. 확정되면 `tokens.css`를 고정합니다.
- [ ] **Step 5: 커밋**: `design: 사용자, 관리자 화면 시안과 디자인 토큰`

### Task 8: 화면 공통 - KRDS 토큰, 라우터, 인증/회원

**Files**
- Create: `src/styles/tokens.css`, `user.css`, `src/lib/supabase.js`, `api.js`, `format.js`, `router.js`, `clock.js`, `src/user/pages/auth.js`, `account.js`, `src/user/components/header.js`. 마이그레이션 `0001` 보강(`complete_mock_verification` RPC)
- Test: `tests/ui/router.test.js`, `tests/ui/format.test.js`, `tests/ui/auth.test.js`

**Interfaces**
- Consumes: `design/mockups/tokens.css`(Task 8A 확정본)
- Produces
  - `createRouter(routes:{[pattern:string]:(params, el)=>void|Promise<void>}, el:HTMLElement) -> {start(), go(path)}`: 패턴 예 `'#/programs/:id'`
  - `won(n:number) -> '40,000원'`, `kstDateTime(iso) -> '2026. 12. 10.(목) 19:00'`
  - `api`: 모든 RPC 래퍼(`api.holdSeats`, `api.holdCapacity`, `api.releaseHold`, `api.preparePayment`, `api.joinWaitlist`, `api.cancelWaitlist`, `api.holdForPromotion`, `api.myBookings`, `api.confirmPayment`(Edge), `api.cancelBooking`(Edge) …). 오류 코드를 한국어 안내로 바꾸는 `api.messageFor(code)`
  - `messageFor` 문구: `SEAT_TAKEN` → `'방금 다른 분이 선택한 좌석입니다. 다른 좌석을 선택해 주세요.'`, `LIMIT_EXCEEDED` → `'1인 예약 한도를 넘었습니다. 남은 매수 안에서 선택해 주세요.'`, `SOLD_OUT` → `'매진되었습니다. 대기 신청을 하실 수 있습니다.'`
  - SQL `complete_mock_verification(p_name text, p_phone text) returns profiles`: 모의 본인인증. `verified_at` 기록(SIR-006)
- [ ] **Step 1: 실패하는 테스트 작성**
  - 라우터: `#/programs/abc` → 핸들러 params `{id:'abc'}`, 없는 경로 → 404 화면 문구 `'페이지를 찾을 수 없습니다.'`
  - `won(1234567) === '1,234,567원'`
  - 가입 폼(jsdom): 비밀번호 `abc12345` 통과, `abcdefgh` → `'비밀번호는 영문과 숫자를 함께 8자 이상 입력해 주세요.'`. 필수 동의 미체크 시 제출 버튼 비활성
- [ ] **Step 2: 실행해서 실패 확인**
- [ ] **Step 3: 구현**
  - 토큰: KRDS 대표 색 변수를 행동 색으로 다시 선언합니다. 화면 바탕은 무채색입니다(설계 5-9).
  - 가입 흐름: 이메일/비밀번호 → 약관/개인정보 동의(필수/선택) → 모의 본인인증(이름/휴대폰 입력, 「인증 완료」) → 회원 정보
  - 비밀번호 재설정: Supabase `resetPasswordForEmail`
  - 회원 탈퇴: 예정 예약이 있으면 `'진행 중인 예약이 있어 탈퇴할 수 없습니다. 예약을 취소한 뒤 다시 시도해 주세요.'`
  - 로그인 실패 반복 시 지연은 Supabase Auth 기본 속도 제한을 씁니다(SER-001). 설정 값은 `config.toml`에 명시합니다.
- [ ] **Step 4: 통과 확인**: `npm test` PASS, `npm run dev`로 가입/로그인 수동 확인
- [ ] **Step 5: 커밋**: `feat(ui): KRDS 토큰, 라우터, 회원 가입과 모의 본인인증`

### Task 9: 사용자 - 프로그램 목록/상세와 사진 포스터

**Files**
- Create: `src/user/components/poster.js`, `src/user/pages/programs.js`, `program-detail.js`, `src/user/components/program-card.js`
- Test: `tests/ui/poster.test.js`, `tests/ui/programs.test.js`

**Interfaces**
- Produces
  - `renderPoster(el, {image:string, tone:'light'|'dark', title, subtitle, type, periodText})`: 세로 3:4 포스터. 사진은 `<img alt="">`(장식)로 두고, 제목과 기간은 실제 텍스트로 얹습니다. 타이포그래피 배치는 Task 8A 시안을 따릅니다.
  - `saleStatus(offering, now, soldOut:boolean) -> 'UPCOMING'|'ON_SALE'|'SOLD_OUT_WAITLIST'|'CLOSED'`(한국어 라벨: 예매 예정/예매 중/매진(대기 가능)/마감)
- [ ] **Step 1: 실패하는 테스트 작성**
  - 포스터에 제목, 기간, 유형 라벨이 텍스트로 있습니다. 이미지 로딩에 실패해도 무채색 바탕에 같은 타이포그래피가 남습니다(빈 상자 금지).
  - `saleStatus`: 판매 시작 전 → UPCOMING, 판매 중이고 매진 → SOLD_OUT_WAITLIST, 판매 종료 후 → CLOSED
  - 목록 필터(jsdom): 유형 「체험」 선택 시 체험 카드 2개만 남습니다. 상태 라벨은 텍스트로 표시합니다(색만으로 표시하지 않음).
- [ ] **Step 2: 실행해서 실패 확인**
- [ ] **Step 3: 구현**
  - 목록: 세로형 포스터 카드 격자, 유형, 기간, 대상 필터
  - 상세: 큰 포스터와 편집형 제목, 장소, 대상, 가격, 취소 규정 표(Global의 수수료 구간), 회차 목록과 잔여석(`remaining_capacity`). 정규 강좌는 12회 일정 전체를 보여 줍니다.
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋**: `feat(user): 프로그램 목록/상세와 사진 포스터`

### Task 10: 사용자 - 좌석/인원 선택과 선점 타이머

**Files**
- Create: `src/user/pages/select.js`, `src/user/components/seat-map.js`, `seat-list.js`, `hold-timer.js`, `booking-steps.js`
- Test: `tests/ui/seat-map.test.js`, `tests/ui/hold-timer.test.js`

**Interfaces**
- Consumes: `api.holdSeats`, `api.holdCapacity`, `api.releaseHold`, `checkLimit`, `LIMITS`
- Produces
  - `renderSeatMap(el, {seats, statusById, selected:Set, max}, onToggle)`: SVG 그리드. 각 좌석은 `button` 역할에 `aria-label='E열 7번 S석 선택 가능'`, 방향키로 이동합니다.
  - `renderSeatList(el, …)`: 열, 번호, 등급 표와 체크박스(대체 수단, SFR-005)
  - `startHoldTimer(el, expiresAt:Date, now:()=>Date, onExpire)`: `'남은 선점 시간 09:59'`, `aria-live="polite"`는 1분 단위로만 알림
  - `bookingSteps(el, current:1..5)`: 회차 → 좌석/인원 → 할인 → 결제 → 완료
- [ ] **Step 1: 실패하는 테스트 작성**
  - 좌석 버튼에 포커스 후 → 키 → 다음 좌석으로 포커스, Space → 선택
  - SOLD 좌석은 `aria-disabled="true"`이고 선택되지 않습니다.
  - 한도 4매에 기존 1매가 있으면 4번째 선택 시 `'1인 예약 한도를 넘었습니다. 남은 매수 안에서 선택해 주세요.'`
  - 타이머: 가짜 시계로 10분 경과 시 `onExpire` 1회, 화면에 `'선점 시간이 지나 좌석이 해제되었습니다. 다시 선택해 주세요.'`
- [ ] **Step 2: 실행해서 실패 확인**
- [ ] **Step 3: 구현**
  - 선택 요약(좌석, 금액 합계)과 타이머는 화면 하단 고정 영역에 둡니다(모바일 포함, 설계 5-9).
  - 「다음」을 누르면 `hold*`를 호출합니다. 실패하면 `messageFor` 문구를 보여 주고 좌석 상태를 다시 불러옵니다.
  - 체험은 인원 −/+, 정규 강좌는 「본인 1명 신청」 고정입니다.
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋**: `feat(user): 좌석 배치도/대체 목록/인원 선택과 선점 타이머`

### Task 11: 사용자 - 할인 선택과 토스 결제

**Files**
- Create: `src/user/pages/discount.js`, `payment.js`, `payment-result.js`
- Test: `tests/ui/discount.test.js`, `tests/ui/payment-result.test.js`

**Interfaces**
- Consumes: `priceItems`, `validateDiscounts`, `DISCOUNT_LABELS`, `api.preparePayment`, `api.confirmPayment`
- Produces: 라우트 `#/booking/:holdId/discount`, `#/booking/:holdId/pay`, `#/payment/success`, `#/payment/fail`
- [ ] **Step 1: 실패하는 테스트 작성**
  - 3매 중 1매 「장애인」, 1매 「장애인 동반」을 고르면 합계가 할인 반영 금액으로 바뀝니다. 「현장에서 증빙을 확인합니다. 증빙이 없으면 차액을 현장에서 결제합니다.」 안내가 보입니다.
  - 동반만 고르면 「다음」이 비활성이고 `validateDiscounts` 오류 문구가 표시됩니다.
  - 성공 페이지(jsdom, 가짜 api): 쿼리 `paymentKey, orderId, amount`로 `confirmPayment`를 1회 호출합니다. 결과 `CANCELLED`이면 사유 메시지와 「좌석 다시 선택」 버튼을 보여 줍니다.
- [ ] **Step 2: 실행해서 실패 확인**
- [ ] **Step 3: 구현**
  - `prepare_payment`로 주문번호와 금액을 확정한 뒤 결제위젯을 렌더링합니다. `customerKey`는 회원 id, `successUrl`/`failUrl`은 `location.origin + base + '#/payment/success'`입니다.
  - 실패/사용자 취소 시 선점이 유지됐다고 안내하고 할인 단계로 돌아갑니다(SFR-010).
- [ ] **Step 4: 통과 확인**: 로컬에서 테스트 키로 실제 테스트 결제 1회(사용자 키 필요). 실패하면 원인을 기록합니다.
- [ ] **Step 5: 커밋**: `feat(user): 할인 선택/토스 결제위젯/결제 결과`

### Task 12: 사용자 - 내 예약, 취소, 대기, 알림함

**Files**
- Create: `src/user/pages/my-bookings.js`, `booking-detail.js`, `waitlist.js`, `notifications.js`
- Test: `tests/ui/booking-detail.test.js`

**Interfaces**
- Consumes: `calcRefund`(미리보기), `api.cancelBooking`, `api.joinWaitlist`, `api.cancelWaitlist`, `api.holdForPromotion`(SQL `hold_for_promotion`, Task 5)
- Produces: 라우트 `#/me/bookings`, `#/me/bookings/:id`, `#/me/waitlist`, `#/me/notifications`
- [ ] **Step 1: 실패하는 테스트 작성**
  - 상세(가짜 now = D-5): `'지금 취소하면 36,000원이 환불됩니다(취소 수수료 4,000원).'` 확인 대화상자 → 확인 시 `cancelBooking` 1회
  - 당일: 취소 버튼 비활성, `'관람(개강) 당일에는 취소할 수 없습니다.'`
  - 정규 강좌 1/2 경과 후: `'지금 취소하면 환불 금액이 없습니다.'` 경고 문구를 보여 주되 취소는 할 수 있습니다.
  - 대기 목록: 순번, 신청 수량, 배정 수량을 표시합니다. 상태 `PROMOTED`이면 `'결제 기한: 12. 3.(목) 14:00까지'`와 「결제하기」(→ `hold_for_promotion` → 할인 단계)
- [ ] **Step 2: 실행해서 실패 확인**
- [ ] **Step 3: 구현**: 목록 탭은 예정, 지난, 취소 세 가지입니다. 알림함은 읽음 처리를 하고 채널을 「문자(모의)」로 표시합니다.
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋**: `feat(user): 내 예약/취소 환불 미리보기, 대기, 알림함`

### Task 13: 관리자 - 레이아웃, 권한, 프로그램, 회차, 좌석 관리

**Files**
- Create: `supabase/migrations/0005_admin.sql`, `0006_rls.sql`, `src/styles/admin.css`, `src/admin/layout.js`, `src/admin/pages/dashboard.js`, `programs.js`, `offerings.js`, `src/admin/components/search-box.js`, `data-table.js`
- Test: `tests/db/admin.test.js`, `tests/db/rls.test.js`, `tests/ui/admin-layout.test.js`

**Interfaces**
- Produces
  - SQL `is_staff(p_roles text[]) returns bool`
  - `admin_upsert_program(p jsonb) returns programs`
  - `admin_upsert_offering(p jsonb) returns offerings`(정원 검증, 공연이면 `inventory_seats` 생성)
  - `admin_set_prices(p_offering uuid, p_prices jsonb)`
  - 모든 admin_* 함수는 `admin_audit`에 기록합니다.
  - `MENU = [{label:'대시보드', path:'#/', roles:['operator','finance']}, {label:'프로그램관리', children:[…]}, …]`(설계 5-9의 메뉴 구성 그대로)
  - `renderLayout(el, {user, role, current})`: 상단 바, 좌측 메뉴(역할 필터, 접기/펼치기), 경로 표시
  - `renderSearchBox(el, fields, onSearch)`: 조회 조건 상자. 「초기화」 「조회」 버튼
  - `renderDataTable(el, {columns, rows, total, page, pageSize, onPage})`: 숫자 열 오른쪽 정렬, 상태 칩(글자 포함), 페이지 이동
- [ ] **Step 1: 실패하는 테스트 작성**
  - `rejects capacity below sold+held`: 판매 3 + 선점 2인 체험 회차의 정원을 4로 바꾸면 `CAPACITY_BELOW_SOLD`
  - `price change keeps existing booking amounts`: 가격을 바꿔도 기존 `booking_items.amount`는 그대로입니다.
  - RLS(SER-002): 회원은 남의 `bookings`를 조회하면 0행, `profiles` 전체 조회 불가. finance는 `admin_upsert_program`이 `FORBIDDEN`. operator는 결제 원본 `raw`를 조회할 수 없습니다.
  - 레이아웃(jsdom): role `finance`이면 메뉴에 「프로그램관리」가 없고 「결제/정산」이 있습니다. 현재 메뉴에 `aria-current="page"`
  - 등록한 회차가 사용자용 `remaining_capacity`로 바로 조회됩니다(AC-6).
- [ ] **Step 2: 실행해서 실패 확인**
- [ ] **Step 3: 구현**
  - 화면 패턴은 「조회 조건 → 건수와 등록/엑셀 버튼 → 목록 → 상세/편집」입니다(설계 5-9).
  - 개인정보는 목록에서 가림 처리합니다(`김*수`, `010-****-1234`). 상세에서만 전체를 보여 주고, 열람할 때 `admin_audit`에 `VIEW_PII`를 기록합니다(SER-005, SER-006).
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋**: `feat(admin): 관리자 레이아웃/역할 메뉴, 프로그램, 회차, 좌석 관리`

### Task 14: 관리자 - 예약, 대기, 결제, 환불, 회차 취소/정산

**Files**
- Create: `src/admin/pages/bookings.js`, `waitlist.js`, `payments.js`, `cancel-requests.js`, `settlement.js`, `src/lib/csv.js`. 마이그레이션 `0005`에 뷰와 함수를 추가합니다.
- Test: `tests/db/settlement.test.js`, `tests/ui/csv.test.js`

**Interfaces**
- Produces
  - 뷰 `settlement_daily(day date(KST), program_id, paid_sum, refund_sum, fee_sum, net_sum)`
    - `net_sum = paid_sum − refund_sum`, `fee_sum`은 USER 취소의 `fee_amount` 합계
  - `admin_mark_proof(p_item uuid, p_checked bool)`
  - `admin_request_offering_cancel(p_offering uuid, p_reason text)`(operator)
  - `admin_decide_offering_cancel(p_req uuid, p_approve bool)`(finance. 승인하면 화면이 Edge `payments-cancel` INSTITUTION을 호출)
  - `toCsv(columns, rows) -> string`: UTF-8 BOM 포함, 쉼표/따옴표 이스케이프
- [ ] **Step 1: 실패하는 테스트 작성**
  - 결제 80000/40000, 그중 40000을 D-5에 취소(환불 36000)하면 `paid_sum 120000, refund_sum 36000, fee_sum 4000, net_sum 84000`(AC-6)
  - 회차 취소: operator 요청 → finance 승인 → 해당 회차 예약 전부 CANCELLED, `refunds.reason='INSTITUTION'`, 대상자 알림 `OFFERING_CANCELLED`
  - finance가 아닌 사람이 승인하면 `FORBIDDEN`
  - `toCsv([{key:'t',label:'제목'}],[{t:'A, "B"'}])`의 둘째 줄이 `"A, ""B"""`
- [ ] **Step 2: 실행해서 실패 확인**
- [ ] **Step 3: 구현**
  - 예약 내역: 조회 조건(기간, 프로그램, 상태, 예약번호/예약자), 증빙 확인 체크
  - 결제/환불: 토스 거래 번호 표시
  - 정산: 일별/프로그램별 탭, 합계 행, CSV 내려받기
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋**: `feat(admin): 예약, 대기, 결제, 환불 내역, 회차 취소 승인, 정산/CSV`

### Task 15: 관리자 - 검수용 시계/시연 데이터 초기화/작업 이력, 환경 분리

**Files**
- Create: `src/admin/pages/system-clock.js`, `system-reset.js`, `audit.js`. 마이그레이션 `0005`에 `admin_set_clock`, `admin_reset_demo`를 추가합니다.
- Test: `tests/db/system.test.js`, `tests/ui/env-menu.test.js`

**Interfaces**
- Produces
  - `admin_set_clock(p_offset_ms bigint)`: `app_settings.env='qa'`일 때만 동작합니다. 아니면 `NOT_ALLOWED_IN_ENV`
  - `admin_reset_demo()`: `env='demo'`일 때만 동작합니다. `seed_demo(app_now())`를 실행하고 감사 기록을 남깁니다.
  - 메뉴 표시 규칙: `VITE_ENV==='qa'` → 「검수용 시계」, `VITE_ENV==='demo'` → 「시연 데이터 초기화」, `local` → 둘 다
- [ ] **Step 1: 실패하는 테스트 작성**
  - env `demo`에서 `admin_set_clock` → `NOT_ALLOWED_IN_ENV`, 그리고 `app_now()`가 offset을 무시합니다(설계 5-7 증명 방법).
  - env `qa`에서 `admin_reset_demo` → `NOT_ALLOWED_IN_ENV`
  - 초기화 후 예약 0건, 시드 회차 일정이 `app_now()` 기준으로 다시 생성됩니다.
  - `VITE_ENV=demo` 빌드의 메뉴에 「검수용 시계」가 없습니다.
- [ ] **Step 2: 실행해서 실패 확인**
- [ ] **Step 3: 구현**
  - 시계 화면: 현재 기준 시각, 「+10분」 「+1일」 「+24시간」 「초기화」 버튼, 적용 시 상단에 `'검수용 시계 사용 중: 실제보다 1일 앞'` 띠를 표시합니다.
  - 초기화 화면: 확인 대화상자에 `'모든 예약, 대기, 알림이 지워지고 처음 상태로 돌아갑니다.'`를 띄웁니다.
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋**: `feat(admin): 검수용 시계/시연 데이터 초기화/작업 이력과 환경 분리`

### Task 16: 배포 구성/시연 안내/추적성 점검

**Files**
- Create: `.github/workflows/pages.yml`, `scripts/check-trace.mjs`. `README.md`를 수정합니다.
- Test: `tests/scripts/check-trace.test.js`

**Interfaces**
- Produces: `findMissingIds(requirementsMd:string, planMd:string) -> string[]`: 요구사항 문서의 `| XXX-000 |` ID 가운데 이 계획의 「요구사항 추적표」에 없는 ID 목록
- [ ] **Step 1: 실패하는 테스트 작성**
  - 요구사항에 `SFR-001`, `SFR-002`가 있고 추적표에 `SFR-001`만 있으면 `['SFR-002']`
  - 실제 파일 대상 `npm run check:trace` → 빈 목록, 종료 코드 0
- [ ] **Step 2: 실행해서 실패 확인**
- [ ] **Step 3: 구현**
  - 워크플로: `main` push 시 `VITE_*` 값을 GitHub Secrets에서 받아 빌드하고 Pages에 배포합니다. `VITE_BASE=/ai-demo/`, `VITE_ENV=demo`. **이 단계에서는 파일만 만들고 push하지 않습니다.**
  - README
    - 로컬 실행: `npx supabase start` → `.env` 작성 → `npm run dev`
    - 시연 계정
    - 테스트 결제 안내: 토스 테스트 환경이라 실제 승인/출금이 없고, 결제창 안내에 따라 테스트 결제를 진행합니다.
    - 무료 프로젝트 일시 정지 가능성 안내
    - Edge Functions 배포 명령(`npx supabase functions deploy`, `npx supabase secrets set TOSS_SECRET_KEY=…`)
- [ ] **Step 4: 통과 확인**: `npm test && npm run test:db && npm run check:secrets && npm run check:trace && npm run build` 모두 성공
- [ ] **Step 5: 커밋**: `chore: Pages 워크플로/시연 안내/추적성 점검`

---

## 요구사항 추적표

검증 열의 「QA」는 다음 단계(QA 문서/크롬 검수)에서 QA 케이스 ID로 바뀝니다. 테스트 파일명은 위 Task에 정의돼 있습니다.

| 요구사항 ID | 명칭 | 구현 Task | 자동 검증 | 수동 검증 | AC |
|---|---|---|---|---|---|
| SFR-001 | 회원 가입/로그인 | 8 | tests/ui/auth | QA | AC-1 |
| SFR-002 | 회원 정보 | 8 | - | QA | AC-1 |
| SFR-003 | 프로그램 목록 | 9 | tests/ui/programs | QA | AC-1 |
| SFR-004 | 프로그램 상세/회차 선택 | 9 | tests/ui/programs | QA | AC-1 |
| SFR-005 | 공연 좌석 선택 | 10 | tests/ui/seat-map | QA | AC-1, AC-7 |
| SFR-006 | 교육 인원/과정 신청 | 10 | tests/db/hold | QA | AC-1 |
| SFR-007 | 선점과 만료 | 4, 10 | tests/db/hold, tests/ui/hold-timer | QA | AC-4 |
| SFR-008 | 1인 한도 검증 | 2, 4, 10 | tests/policy/limits, tests/db/hold | QA | AC-1 |
| SFR-009 | 할인 선택/금액 계산 | 2, 11 | tests/policy/pricing, tests/ui/discount | QA | AC-1 |
| SFR-010 | 결제 | 11 | tests/ui/payment-result | QA(테스트 결제) | AC-1 |
| SFR-011 | 결제 승인/동시 결제 처리 | 6 | tests/payments/confirm, tests/db/booking | QA | AC-3 |
| SFR-012 | 예약 확인 | 12 | tests/ui/booking-detail | QA | AC-1 |
| SFR-013 | 예약 취소/환불(기준일 전) | 1, 7, 12 | tests/policy/refund, tests/payments/cancel | QA | AC-1 |
| SFR-014 | 정규 강좌 중도 취소 | 1, 7, 12 | tests/policy/refund, tests/payments/cancel | QA | AC-2 |
| SFR-015 | 대기 신청 | 5, 12 | tests/db/waitlist | QA | AC-5 |
| SFR-016 | 대기 승격/결제 기한 | 5, 12 | tests/db/waitlist, tests/db/cancel | QA | AC-5 |
| SFR-017 | 알림함 | 5, 6, 7, 12 | tests/db/waitlist | QA | AC-5 |
| SFR-018 | 관리자 로그인/역할 | 13 | tests/ui/admin-layout, tests/db/rls | QA | AC-6 |
| SFR-019 | 프로그램 관리 | 13 | tests/db/admin | QA | AC-6 |
| SFR-020 | 회차, 정원, 좌석 관리 | 13 | tests/db/admin | QA | AC-6 |
| SFR-021 | 예약 내역 관리 | 14 | - | QA | AC-6 |
| SFR-022 | 결제/환불 내역 | 14 | - | QA | AC-6 |
| SFR-023 | 회차 취소/일괄 환불 | 7, 14 | tests/payments/cancel, tests/db/settlement | QA | AC-6 |
| SFR-024 | 정산 현황 | 14 | tests/db/settlement, tests/ui/csv | QA | AC-6 |
| SFR-025 | 검수용 시계 | 4, 15 | tests/db/hold, tests/db/system | QA | AC-4, AC-5 |
| SFR-026 | 시연 데이터 초기화 | 15 | tests/db/system | QA | AC-6 |
| PER-001 | 응답 시간 | - | - | 목표치(미측정) | - |
| PER-002 | 동시 접속 | - | - | 목표치(미측정) | - |
| PER-003 | 결제 승인 처리 | - | - | 목표치(미측정) | - |
| PER-004 | 선점/확정 정합성 | 4, 6 | tests/db/hold(동시 20회), tests/db/booking | - | AC-3 |
| SER-001 | 인증 | 8 | tests/ui/auth | QA | AC-1 |
| SER-002 | 접근 통제 | 13 | tests/db/rls | QA | AC-6 |
| SER-003 | 비밀값 관리 | 0, 6 | tests/scripts/check-secrets | - | AC-9 |
| SER-004 | 개인정보 최소 수집 | 3 | tests/db/schema | 테이블 정의서 검토 | AC-9 |
| SER-005 | 개인정보 표시 제한 | 13 | - | QA | AC-6 |
| SER-006 | 관리자 작업 이력 | 13, 15 | tests/db/admin | QA | AC-6 |
| SER-007 | 결제 위변조 방지 | 6, 7 | tests/payments/confirm, tests/payments/webhook | - | AC-3 |
| SER-008 | 시큐어 코딩 | 8~15 | - | 리뷰 단계 점검 | - |
| DAR-001 | 데이터 모델 | 3 | tests/db/schema | 테이블 정의서 | - |
| DAR-002 | 코드 정의 | 3 | tests/db/schema | 코드 정의서 | - |
| DAR-003 | 금액 처리 | 1, 2 | tests/policy/refund, tests/policy/pricing | - | AC-1, AC-2 |
| DAR-004 | 시간 기준 | 1, 4 | tests/policy/time, tests/db/hold | - | AC-1, AC-2 |
| DAR-005 | 보관 기간 | 3 | - | 테이블 정의서 | - |
| DAR-006 | 초기 데이터 | 3, 15 | tests/db/schema, tests/db/system | - | AC-6 |
| SIR-001 | 결제위젯 | 11 | - | QA(테스트 결제) | AC-1 |
| SIR-002 | 결제 승인 API | 6 | tests/payments/confirm | QA | AC-1, AC-3 |
| SIR-003 | 결제 취소 API | 7 | tests/payments/cancel | QA | AC-1, AC-2 |
| SIR-004 | 결제 웹훅 | 7 | tests/payments/webhook | - | AC-3 |
| SIR-005 | 회원 인증 | 8 | tests/ui/auth | QA | AC-1 |
| SIR-006 | 본인인증(모의) | 8 | - | QA | AC-1 |
| QUR-001 | 웹 접근성 | 8~15 | tests/ui/seat-map | QA(자동 점검 + 키보드) | AC-7 |
| QUR-002 | 디자인 시스템 | 8A, 8, 13 | - | QA | - |
| QUR-003 | 반응형 | 8~15 | - | QA(1440/390) | - |
| QUR-004 | 브라우저 지원 | - | - | QA | - |
| QUR-005 | 정책 로직 검증 | 1, 2 | tests/policy/* | - | AC-1, AC-2, AC-4, AC-5 |
| QUR-006 | 요구사항 추적성 | 16 | tests/scripts/check-trace | - | AC-8 |
| QUR-007 | 오류 안내 | 8, 10, 11, 12 | tests/ui/* 문구 단언 | QA | - |
| COR-001 | 가상 데이터 | 3, 9 | tests/ui/poster | 시드 검토 | - |
| COR-002 | 결제 테스트 모드 | 0 | tests/scripts/check-secrets(`live_`) | - | AC-9 |
| COR-003 | 키 관리 | 0 | tests/scripts/check-secrets | - | AC-9 |
| COR-004 | 호스팅 | 16 | - | 배포 시 확인 | - |
| COR-005 | 기술 구성 | 0 | - | 리뷰 | - |
| COR-006 | 실사업 전환 기준 | - | - | 설계 문서 4장 | - |
| COR-007 | 개발 방식 | 전체 | - | 포트폴리오 기록 | - |
