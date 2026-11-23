# 코드 정의서

기준: `supabase/migrations/0001_schema.sql`의 check 제약. 결제/환불 기록은 5년 보관 대상(DAR-005)입니다.

| 코드 그룹 | 테이블.컬럼 | 코드 | 한글명 | 보관 |
|---|---|---|---|---|
| 회원 역할 | profiles.role | member | 회원 | |
| | | operator | 운영 담당 | |
| | | finance | 재무 담당 | |
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
| 알림 채널 | notifications.channel | SMS_MOCK | 문자(모의) | |
| 모의 결제 모드 | app_settings.pg_mock_mode | APPROVE | 승인 | |
| | | DECLINE | 거절 | |
| 환경 | app_settings.env | local / qa / demo | 로컬 / 검증 / 시연 | |
| 할인 유형 | booking_items.discount_type | NONE | 할인 없음 | 5년 보관 대상 |
| | | DISABLED | 장애인 (50%) | 5년 보관 대상 |
| | | DISABLED_COMPANION | 장애인 동반 (50%) | 5년 보관 대상 |
| | | MERIT | 국가유공자 (50%) | 5년 보관 대상 |
| | | MERIT_COMPANION | 국가유공자 동반 (50%) | 5년 보관 대상 |
| | | MULTICHILD | 다자녀 (30%) | 5년 보관 대상 |
