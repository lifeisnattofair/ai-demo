# 문화예술회관 통합 예약 플랫폼 (가상 공공사업 데모)

가상의 공공 문화예술회관을 위한 통합 예약 플랫폼 프로토타입입니다. 공연 좌석 예매, 체험과 정규 강좌 신청, 좌석 선점과 만료, 할인과 모의 결제, 취소와 환불, 대기 신청과 승격, 관리자 화면(프로그램, 회차, 예약, 결제, 회차 취소, 정산)을 담았습니다. Superpowers 흐름(요구사항, 계획, 프로토타입, QA, 리뷰, 산출물)으로 진행하는 개인 프로젝트이고, 화면은 Vite와 순수 JavaScript로, 데이터와 인증은 Supabase(Postgres, Auth, Edge Functions)로 구성했습니다. 결제는 모의 어댑터라 외부 결제 키가 필요 없습니다.

## 구조

```
index.html, admin.html   사용자 화면과 관리자 화면 진입점
src/                     화면 코드(user, admin, lib)
supabase/migrations/     스키마, 정책 함수, RLS (0001~0015)
supabase/seed.sql        시연 계정과 시드 일정
supabase/functions/      Edge Functions(payments-confirm, payments-cancel, payments-webhook)와 정책/결제 공용 코드
tests/                   policy, payments, db, ui, scripts 테스트
scripts/                 비밀값 점검, 추적성 점검, 로컬 함수 실행 도우미
docs/                    요구사항, 설계, 계획, 산출물 정의서
```

## 로컬 실행

필요한 것: Node.js 24, Docker Desktop(실행 중).

1. `npm ci`
2. `npx supabase start` 로 로컬 Supabase를 띄웁니다. 마이그레이션과 `supabase/seed.sql`이 함께 적용됩니다.
3. `.env.example`을 `.env`로 복사하고 `npx supabase status -o env` 출력의 `API_URL`을 `VITE_SUPABASE_URL`에, `ANON_KEY`를 `VITE_SUPABASE_ANON_KEY`에 넣습니다. `VITE_ENV`는 `local` 그대로 둡니다. `.env`는 커밋하지 않습니다.
4. `npm run dev` 로 화면을 엽니다(기본 주소 `http://localhost:5173`, 관리자는 `/admin.html`).
5. 결제가 필요한 흐름을 시험하려면 다른 터미널에서 `npm run functions:serve` 를 실행합니다. 먼저 `supabase/functions/.env.example`을 `supabase/functions/.env`로 복사해 `ALLOWED_ORIGIN=http://localhost:5173`을 넣어 둡니다(이 파일도 커밋하지 않습니다. 비어 있으면 브라우저 요청이 CORS로 막힙니다).

`npx supabase functions serve`를 바로 쓰지 않고 `npm run functions:serve`를 쓰는 이유: Windows의 Docker Desktop은 E: 같은 공유되지 않은 드라이브의 폴더를 컨테이너 안에서 빈 폴더로 보여, 함수가 모두 BOOT_ERROR로 끝납니다. 이 도우미가 함수 폴더를 임시 폴더로 복사해 실행하므로 함수 소스를 고치면 다시 실행해야 합니다.

## 시연 계정

`supabase/seed.sql`이 만듭니다. 비밀번호는 모두 데모 전용 값 `Demo-1234!`입니다.

| 계정 | 역할 |
|---|---|
| member1@demo.test, member2@demo.test, member3@demo.test | 회원 |
| operator@demo.test | 운영 담당 |
| finance@demo.test | 정산 담당 |

공개 시연(`app_settings.env = demo`, `VITE_ENV = demo`)에서는 여러 사람이 이 계정을 함께 쓰므로 계정을 바꾸지 못하게 막습니다.

- 연락처(이름, 휴대폰 번호) 수정과 회원 탈퇴는 DB 함수가 거절합니다(`DEMO_ACCOUNT_LOCKED`, 안내: 「시연용 계정은 변경할 수 없습니다. 새 계정을 만들어 사용해 주세요.」).
- 비밀번호 변경은 Supabase Auth가 직접 처리해 DB에서 막을 수 없습니다. 그래서 내 정보 화면에서 이 계정의 비밀번호 변경, 연락처 수정, 탈퇴 버튼을 감추고 같은 안내를 보입니다. API를 직접 불러 비밀번호를 바꾸는 것까지 막지는 못합니다.
- 그래도 계정이 바뀌었으면 운영 담당의 시연 데이터 초기화(`admin_reset_demo`)가 다섯 계정의 차단, 이메일, 비밀번호(`Demo-1234!`), 로그인 수단, 이름과 휴대폰 번호, 역할을 시드 값으로 되돌립니다. 운영 담당 계정 자체가 잠겼다면 소유자가 SQL 편집기에서 `select public.restore_demo_accounts();`를 실행합니다.
- 직접 가입한 계정은 제한 없이 수정하고 탈퇴할 수 있습니다. 이메일 변경은 이 프로토타입 범위 밖이라 모든 계정에서 읽기 전용입니다.

## 결제 안내

모의 결제라 실제 승인과 출금이 없습니다. 결제 화면에서 카드사를 반드시 골라야 하고, 카드 번호는 아무 가상 값이나 써도 됩니다. 실사업으로 바꿀 때는 두 곳을 결제대행사용으로 교체합니다.

- 결제 어댑터 `supabase/functions/_shared/payments/gateway.js`
- DB 함수 `order_has_charge`(`supabase/migrations/0004_booking.sql`). 주문에 승인된 결제가 있는지 모의 결제 기록(`pg_mock_transactions`)을 읽어 판단하므로, 실제 결제 기록(예: `payments` 테이블이나 결제대행사 조회 결과를 저장한 표)을 읽도록 바꿔야 합니다. 이 함수가 틀리면 sweep이 승인된 결제 중 선점을 풀어 좌석을 다시 팔 수 있습니다.

## 검수용 시계와 시연 데이터 초기화

환경은 DB의 `app_settings.env`(local, qa, demo)와 화면 빌드의 `VITE_ENV`가 함께 정합니다.

| 환경 | 검수용 시계 | 시연 데이터 초기화 |
|---|---|---|
| local | 사용 | 사용 |
| qa | 사용(선점 만료, 환불 기준일, 대기 승격 기한을 시계를 옮겨 확인) | 사용 안 함 |
| demo | 꺼짐(저장된 값이 있어도 실제 시각) | 사용(운영 담당이 예약, 대기, 알림, 모의 결제 기록을 지우고 시드 일정을 다시 만듭니다) |

## 테스트

- `npm test`: 정책, 결제, 화면 단위 테스트
- `npm run test:db`: DB 테스트(로컬 Supabase가 떠 있어야 합니다)
- `npm run check:secrets`: 저장소에 결제 키나 서비스 키 모양의 값이 있는지 점검
- `npm run check:trace`: 요구사항정의서의 모든 요구사항 ID가 계획서의 추적표에 있는지 점검

## 배포 개요 (소유자가 직접 실행하는 단계)

아래는 저장소 소유자가 자신의 계정에서 실행하는 순서입니다. 이 저장소의 작업 과정에서는 실행하지 않았습니다.

1. Supabase 프로젝트를 만들고 `npx supabase link --project-ref <프로젝트 ref>` 후 `npx supabase db push` 로 마이그레이션을 올립니다. 시드(`supabase/seed.sql`)를 적용한 뒤, 대시보드의 SQL 편집기에서 환경을 `demo`로 바꿉니다.

   ```sql
   insert into public.app_settings(key, value) values ('env', '"demo"')
   on conflict (key) do update set value = excluded.value;
   select public.app_env();  -- demo 가 나와야 합니다
   ```

   주의: 마이그레이션의 기본값은 `local`이고, `local`에서는 검수용 시계(`admin_set_clock`)와 시연 데이터 초기화가 모두 켜져 있습니다. `VITE_ENV=demo` 빌드는 메뉴만 감출 뿐이라, 이 단계를 빠뜨리면 공개된 운영 담당 계정으로 누구나 RPC를 불러 시계를 옮길 수 있고 시연 계정 보호도 동작하지 않습니다.
2. Edge Functions 비밀값에 `ALLOWED_ORIGIN`(Pages 주소 예: `https://<계정>.github.io`)을 설정하고 `npx supabase functions deploy` 로 배포합니다. 모의 결제라 결제 비밀값은 필요 없습니다.
3. GitHub 저장소 Settings의 Secrets and variables에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 등록합니다.
4. Settings의 Pages 소스를 GitHub Actions로 바꾸고 `main`에 push하면 `.github/workflows/pages.yml`이 `npm test`와 `npm run check:secrets`를 통과한 뒤 `VITE_BASE=/ai-demo/`, `VITE_ENV=demo`로 빌드해 배포합니다.

무료 Supabase 프로젝트는 일정 기간 접속이 없으면 일시 정지될 수 있습니다. 시연 전에 대시보드에서 상태를 확인하고, 정지돼 있으면 복구한 뒤 사용합니다.

## 문서

- 요구사항정의서: `docs/superpowers/specs/2026-11-23-booking-platform-requirements.md`
- 설계: `docs/superpowers/specs/2026-11-23-booking-platform-design.md`
- 구현 계획과 요구사항 추적표: `docs/superpowers/plans/2026-11-23-booking-platform.md`
- 기획 점검표: `docs/superpowers/notes/planning-checklist.md`
- 디자인 시스템: `DESIGN.md`
- 안티 슬롭 감사: `anti-slop/audit-001-2026-11-24.md`
- 산출물: `deliverables/`(PDF, xlsx), `docs/deliverables/`(테이블 정의서, 코드 정의서)
