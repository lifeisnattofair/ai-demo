# 코드 정의서

기준: `supabase/migrations/0001_schema.sql`~`0017_review_fixes.sql`의 check 제약과 DB 함수가 실제로 쓰는 값, 정책 모듈(`supabase/functions/_shared/policy`). 결제/환불 기록은 5년 보관 대상(DAR-005)입니다.

| 코드 그룹 | 테이블.컬럼 | 코드 | 한글명 | 보관 |
|---|---|---|---|---|
| 회원 역할 | profiles.role | member | 회원 | |
| | | operator | 운영 담당 | |
| | | finance | 정산 담당 | |
| 프로그램 유형 | programs.type | PERFORMANCE | 공연 | |
| | | EXPERIENCE | 체험 | |
| | | COURSE | 정규 강좌 | |
| 포스터 톤 | programs.poster_tone | light | 밝은 톤 | |
| | | dark | 어두운 톤 | |
| 판매 단위 상태 | offerings.status | OPEN | 판매 중 | |
| | | CANCEL_REQUESTED | 취소 요청 | |
| | | CANCELLED | 취소됨 | |
| 좌석 등급 | seats.grade, offering_prices.grade | R | R석 | |
| | | S | S석 | |
| | | A | A석 | |
| 재고 상태 | inventory_seats.status | AVAILABLE | 예매 가능 | |
| | | HELD | 선점됨 | |
| | | PAYING | 결제 중 | |
| | | WAIT_ALLOCATED | 대기 배정 | |
| | | SOLD | 판매됨 | |
| 선점 상태 | holds.status | ACTIVE | 선점 중 | |
| | | PAYING | 결제 진행 | |
| | | CONSUMED | 사용됨 | |
| | | EXPIRED | 만료 | |
| | | RELEASED | 해제 | |
| 예약 상태 | bookings.status | CONFIRMED | 예약 확정 | 5년 보관 대상 |
| | | CANCELLED | 예약 취소 | 5년 보관 대상 |
| 결제 상태 | payments.status, pg_mock_transactions.status | DONE | 결제 완료 | 5년 보관 대상 |
| | | CANCELED | 전액 취소 | 5년 보관 대상 |
| | | PARTIAL_CANCELED | 부분 취소 | 5년 보관 대상 |
| 환불 사유 | refunds.reason | USER | 이용자 취소 | 5년 보관 대상 |
| | | INSTITUTION | 기관 사정 취소 | 5년 보관 대상 |
| | | CONFLICT | 일정 충돌 취소 | 5년 보관 대상 |
| 대기 상태 | waitlist.status | WAITING | 대기 중 | |
| | | PROMOTED | 승격됨(결제 대기) | |
| | | COMPLETED | 결제 완료 | |
| | | EXPIRED | 기한 만료 | |
| | | CANCELLED | 신청 취소 | |
| | | RELEASED | 해제 | |
| 취소 요청 상태 | offering_cancel_requests.status | REQUESTED | 요청됨 | 5년 보관 대상 |
| | | APPROVED | 승인 | 5년 보관 대상 |
| | | REJECTED | 반려 | 5년 보관 대상 |
| 알림 종류 | notifications.kind | PAYMENT_DONE | 결제 완료(예약 확정) | |
| | | BOOKING_CANCELLED | 예약 취소(환불 안내) | |
| | | OFFERING_CANCELLED | 회차 취소(전액 환불, 대기 종료) | |
| | | WAIT_PROMOTED | 대기 승격(결제 가능) | |
| | | WAIT_EXPIRED | 대기 배정 해제/기한 만료 | |
| 알림 채널 | notifications.channel | SMS_MOCK | 문자(모의) | |
| 모의 결제 모드 | app_settings.pg_mock_mode | APPROVE | 승인 | |
| | | DECLINE | 거절 | |
| 환경 | app_settings.env | local / qa / demo | 로컬 / 검증 / 시연 | |
| 할인 유형 | booking_items.discount_type | GENERAL | 일반 (할인 없음, 0%) | 5년 보관 대상 |
| | | DISABLED | 장애인 (50%) | 5년 보관 대상 |
| | | DISABLED_COMPANION | 장애인 동반 (50%) | 5년 보관 대상 |
| | | MERIT | 국가유공자 (50%) | 5년 보관 대상 |
| | | MERIT_COMPANION | 국가유공자 동반 (50%) | 5년 보관 대상 |
| | | MULTICHILD | 다자녀 (30%) | 5년 보관 대상 |
| 환불 규칙 | refunds.rule, bookings.cancel_rule | D8_PLUS | 기준일 8일 전까지 (100%) | 5년 보관 대상 |
| | | D7_4 | 기준일 7~4일 전 (90%) | 5년 보관 대상 |
| | | D3_1 | 기준일 3~1일 전 (70%) | 5년 보관 대상 |
| | | SAME_DAY | 당일 (취소 불가) | |
| | | MID_BEFORE_1_3 | 정규 강좌 진행 1/3 경과 전 (2/3) | 5년 보관 대상 |
| | | MID_BEFORE_1_2 | 정규 강좌 진행 1/2 경과 전 (1/2) | 5년 보관 대상 |
| | | MID_AFTER_1_2 | 정규 강좌 진행 1/2 경과 후 (환불 없음) | 5년 보관 대상 |
| | | INSTITUTION_FULL | 기관 사정 취소 (전액) | 5년 보관 대상 |
| 작업 이력 종류 | admin_audit.action | PROGRAM_CREATE / PROGRAM_UPDATE | 프로그램 등록 / 수정 | |
| | | OFFERING_CREATE / OFFERING_UPDATE | 회차 등록 / 수정 | |
| | | PRICE_SET | 가격 설정 | |
| | | PROOF_CHECK | 할인 증빙 확인 | |
| | | VIEW_PII | 개인정보 열람 | |
| | | VIEW_PAYMENT_RAW | 결제 원본 열람 | |
| | | OFFERING_CANCEL_REQUEST | 회차 취소 요청 | |
| | | OFFERING_CANCEL_APPROVE / OFFERING_CANCEL_REJECT | 회차 취소 승인 / 반려 | |
| | | OFFERING_CANCEL | 회차 취소 처리(일괄 환불) | |
| | | CLOCK_SET | 검수용 시계 변경 | |
| | | RESET_DEMO | 시연 데이터 초기화 | |
| 작업 이력 대상 | admin_audit.target_type | program / offering / offering_cancel_request | 프로그램 / 회차 / 회차 취소 요청 | |
| | | profile / payment / booking_item | 회원 / 결제 / 예약 매수 | |
| | | app_settings / system | 설정 / 시스템 | |

참고
- 할인 유형의 DB 기본값(`booking_items.discount_type default 'NONE'`)은 쓰이지 않습니다. 예약 확정(finalize_booking)이 항상 할인 유형을 넣고, 할인 없음은 `GENERAL` 입니다. 예전 자료의 `NONE` 은 조회 화면에서 할인 없음으로 다룹니다.
- 알림 종류와 작업 이력 종류는 check 제약이 없고, 위 값은 DB 함수가 넣는 값 전체입니다.
