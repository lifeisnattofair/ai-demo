# ai-demo 포트폴리오 요약 (포트폴리오 세션 참고용)

원본 기록: `portfolio/README.md`(단계별), `portfolio/numbers.md`(수치), `portfolio/shots/`(캡처). 단계마다 갱신합니다.

## 프로젝트
(가상) 한빛아트센터 공연·교육 프로그램 통합 예약 플랫폼 — Superpowers 흐름(요구사항 → 계획 → TDD 구현 → QA → 리뷰 → 산출물)으로 진행하는 개인 프로젝트.

## 현황 (2026-11-23)
- **1단계 요구사항 정의 (brainstorming)**: 완료 (사용자 승인)
  - 산출물: `docs/superpowers/specs/2026-11-23-booking-platform-requirements.md`(RFP 형식, 요구사항 64개), `docs/superpowers/specs/2026-11-23-booking-platform-design.md`, `docs/superpowers/notes/planning-checklist.md`(기획 점검표 15항목)
  - 핵심 결정: 단계적 대체(1차 교육 + 자체 공연, 대관은 2차), 회원 전용, 정규 강좌 평생교육 환불 기준, 대기 승격 24시간, 할인 증빙은 현장 확인(민감정보 미수집)
  - 기술 판단: AI 기본 조합(Next.js, React, Tailwind) 대신 Vite + 바닐라 JS + KRDS, GitHub Pages + Supabase(PostgreSQL). 실사업 전환표(전자정부 표준프레임워크 + MariaDB/Tibero) 포함
  - 검토자(builder check) 질문 6개 → AI 판단 3건, 사용자 결정 3건 반영
- **1.5단계 디자인 콘셉트**: 완료. 사용자 화면은 「포스터가 색, UI는 무채색 + 행동 색 하나」, 관리자 화면은 공공 관리자 표준 틀(좌측 메뉴, 조회 → 목록 → 상세). 설계 문서 5-9절
- **2단계 구현 계획 (writing-plans)**: 작성 완료, 사용자 검토 대기
  - 산출물: `docs/superpowers/plans/2026-11-23-booking-platform.md`(Task 18개, 요구사항 추적표 64행)

## AI at Work 페이지용 포인트(누적)
- AI가 질문 8개로 범위/정책 빈칸을 짚음 → 기획 점검표로 정리
- 별도 검토 에이전트가 「이 문서로 바로 만들 수 있나」를 점검해 1원 단위 반올림, 경계값(정확히 1/3), 시연 환경 충돌 같은 구현 직전 빈칸을 찾음
- 관리자 레퍼런스를 AI가 마케팅 사이트 위주로 골랐다가 「사용자 페이지 같다」는 피드백으로 공공 관리자 표준 틀로 수정
- 구현 계획에서 요구사항 64개를 모두 Task, 테스트, QA에 연결하고, 누락을 자동 점검하는 스크립트(`check:trace`)까지 계획에 포함
