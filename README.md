# 문화예술회관 통합 예약 플랫폼 (가상 공공사업 데모)

Superpowers 흐름(요구사항 → 계획 → 프로토타입 → QA → 리뷰 → 산출물)으로 진행하는 개인 프로젝트입니다.

- `docs/superpowers/specs/` 요구사항정의서/설계 문서
- `docs/superpowers/plans/` 구현 계획(요구사항 추적표)
- `docs/superpowers/notes/` 기획 점검표(브레인스토밍 질문 목록) 등

## 로컬 시연 계정

`npx supabase start` 후 `supabase/seed.sql`이 계정을 만듭니다. 비밀번호는 모두 데모 전용 값 `Demo-1234!`입니다.

| 계정 | 역할 |
|---|---|
| member1@demo.test, member2@demo.test, member3@demo.test | 회원 |
| operator@demo.test | 운영 담당 |
| finance@demo.test | 재무 담당 |
