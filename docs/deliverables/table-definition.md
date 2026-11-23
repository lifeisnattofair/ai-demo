# 테이블 정의서

기준: `supabase/migrations/0001_schema.sql`. 일시는 timestamptz(UTC) 저장, 금액은 원 단위 정수입니다.
보관 기간 열에서 「5년」은 결제/환불 기록 5년 보관 대상(DAR-005)을 뜻합니다.

## 목록

| 테이블명 | 한글명 | 설명 | 보관 기간 |
|---|---|---|---|
| profiles | 회원 프로필 | 로그인 계정의 이름, 연락처, 역할 | 회원 탈퇴 시까지 |
| programs | 프로그램 | 공연, 체험, 정규 강좌의 소개 정보 | 상시 |
| offerings | 판매 단위 | 공연/체험은 회차, 정규 강좌는 과정 | 상시 |
| course_lessons | 강좌 회차 | 정규 강좌 과정의 주차별 일정 | 상시 |
| seats | 좌석 마스터 | A~J열 x 20석, 등급 R/S/A | 상시 |
| offering_prices | 판매 가격 | 판매 단위별, 등급별 가격 | 상시 |
| inventory_seats | 회차별 좌석 재고 | 판매 단위별 좌석 상태 | 판매 단위 종료 후 1년 |
| holds | 선점 | 좌석/정원 임시 확보(10분) | 1년 |
| bookings | 예약 | 확정/취소된 예약 | 5년 |
| booking_items | 예약 항목 | 매수별 좌석, 할인 유형, 금액 | 5년 |
| payments | 결제 | 모의 결제 승인 기록 | 5년 |
| refunds | 환불 | 환불액, 수수료, 적용 규칙 | 5년 |
| pg_mock_transactions | 모의 결제 거래 | 모의 결제 어댑터의 거래 기록 | 프로토타입 한정 |
| waitlist | 대기 신청 | 대기 순번, 승격, 결제 기한 | 1년 |
| notifications | 알림 | 문자 알림(모의) 발송 기록 | 1년 |
| admin_audit | 운영 감사 기록 | 운영/재무 담당자 처리 이력 | 5년 |
| app_settings | 앱 설정 | 환경, 시계, 모의 결제 모드 | 상시 |
| offering_cancel_requests | 판매 단위 취소 요청 | 운영 취소 요청과 재무 승인 | 5년 |

## 컬럼

### profiles
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | uuid | PK, FK auth.users | 계정 식별자 |
| name | text | | 이름 |
| phone | text | | 연락처 |
| role | text | | 역할 (member/operator/finance), 기본 member |
| verified_at | timestamptz | | 본인 확인 일시 |

### programs
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | uuid | PK | |
| type | text | | PERFORMANCE/EXPERIENCE/COURSE |
| title | text | | 프로그램명 |
| summary | text | | 한 줄 소개 |
| description | text | | 상세 설명 |
| venue | text | | 장소 |
| audience | text | | 관람/참여 대상 |
| poster_image | text | | 포스터 이미지 경로 |
| poster_tone | text | | 포스터 톤 (light/dark) |
| is_public | boolean | | 공개 여부, 기본 true |
| created_at | timestamptz | | 등록 일시 |

### offerings
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | uuid | PK | |
| program_id | uuid | FK programs | |
| starts_at | timestamptz | | 시작 일시 |
| ends_at | timestamptz | | 종료 일시 |
| capacity | int | | 정원 (좌석제는 200) |
| sale_starts_at | timestamptz | | 판매 시작 |
| sale_ends_at | timestamptz | | 판매 종료 |
| status | text | | OPEN/CANCEL_REQUESTED/CANCELLED |

### course_lessons
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| offering_id | uuid | PK, FK offerings | |
| seq | int | PK | 회차 번호 (1~12) |
| starts_at | timestamptz | | 수업 일시 (주 1회) |

### seats
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | int | PK | 1~200 |
| row_label | text | UK(row_label, seat_no) | 열 (A~J) |
| seat_no | int | UK | 좌석 번호 (1~20) |
| grade | text | | R(A~D열)/S(E~G열)/A(H~J열) |

### offering_prices
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| offering_id | uuid | UK, FK offerings | |
| grade | text | UK | 등급. 정원제는 null 한 행 |
| price | int | | 단가(원) |

### inventory_seats
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| offering_id | uuid | PK, FK offerings | |
| seat_id | int | PK, FK seats | |
| status | text | | AVAILABLE/HELD/PAYING/WAIT_ALLOCATED/SOLD |
| hold_id | uuid | FK holds | 선점 연결 |
| waitlist_id | uuid | FK waitlist | 대기 배정 연결 |

### holds
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | uuid | PK | |
| offering_id | uuid | FK offerings | |
| user_id | uuid | FK profiles | |
| qty | int | | 매수 |
| status | text | | ACTIVE/PAYING/CONSUMED/EXPIRED/RELEASED |
| order_id | text | UK | 결제 주문번호 |
| amount | int | | 결제 예정액 |
| items | jsonb | | 매수별 좌석, 할인 유형 |
| expires_at | timestamptz | | 선점 만료 일시 (승격 선점은 결제 기한) |
| waitlist_id | uuid | FK waitlist | 대기 승격 선점 연결 (0003_waitlist.sql) |
| created_at | timestamptz | | |

### bookings
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | uuid | PK | |
| booking_no | text | UK | 예약번호 |
| user_id | uuid | FK profiles | |
| offering_id | uuid | FK offerings | |
| hold_id | uuid | UK, FK holds | |
| status | text | | CONFIRMED/CANCELLED |
| total_amount | int | | 총 결제액 |
| created_at | timestamptz | | |
| cancelled_at | timestamptz | | 취소 일시 |

### booking_items
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | uuid | PK | |
| booking_id | uuid | FK bookings | |
| seat_id | int | FK seats | 정원제는 null |
| discount_type | text | | 할인 유형 코드 (증빙 정보는 저장하지 않음) |
| unit_price | int | | 단가 |
| discount_amount | int | | 할인액 |
| amount | int | | 항목 금액 |
| proof_checked | boolean | | 현장 증빙 확인 여부, 기본 false |

### payments
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | uuid | PK | |
| order_id | text | UK | 주문번호 |
| payment_key | text | UK | 결제 키 (모의) |
| booking_id | uuid | FK bookings | |
| user_id | uuid | FK profiles | |
| amount | int | | 결제액 |
| status | text | | DONE/CANCELED/PARTIAL_CANCELED |
| approved_at | timestamptz | | 승인 일시 |
| raw | jsonb | | 어댑터 응답 원문 |

### refunds
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | uuid | PK | |
| payment_id | uuid | FK payments | |
| booking_id | uuid | FK bookings | |
| refund_amount | int | | 환불액 (floor(결제액 x 환불비율)) |
| fee_amount | int | | 수수료 (결제액 - 환불액) |
| rule | text | | 적용한 환불 규칙 |
| reason | text | | USER/INSTITUTION/CONFLICT |
| pg_transaction_key | text | | 결제대행 취소 거래 키 |
| created_at | timestamptz | | |

### pg_mock_transactions
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| payment_key | text | PK | |
| order_id | text | UK | |
| amount | int | | 승인액 |
| balance_amount | int | | 취소 후 잔액 |
| status | text | | DONE/CANCELED/PARTIAL_CANCELED |
| cancels | jsonb | | 취소 내역 배열, 기본 [] |
| created_at | timestamptz | | |

### waitlist
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | uuid | PK | |
| offering_id | uuid | FK offerings | |
| user_id | uuid | FK profiles | |
| qty | int | | 신청 매수 |
| allocated_qty | int | | 배정된 매수, 기본 0 |
| status | text | | WAITING/PROMOTED/COMPLETED/EXPIRED/CANCELLED/RELEASED |
| promoted_at | timestamptz | | 승격 일시 |
| deadline_at | timestamptz | | 결제 기한 (승격 후 24시간) |
| created_at | timestamptz | | 신청 일시 (순번 기준) |

### notifications
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | uuid | PK | |
| user_id | uuid | FK profiles | |
| kind | text | | 알림 종류 |
| title | text | | 제목 |
| body | text | | 본문 |
| channel | text | | 발송 채널, 기본 SMS_MOCK |
| read_at | timestamptz | | 읽은 일시 |
| created_at | timestamptz | | |

### admin_audit
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | uuid | PK | |
| actor_id | uuid | FK profiles | 처리자 |
| action | text | | 처리 내용 |
| target_type | text | | 대상 종류 |
| target_id | text | | 대상 식별자 |
| detail | jsonb | | 상세 |
| at | timestamptz | | 처리 일시 |

### app_settings
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| key | text | PK | env, clock_enabled, clock_offset_ms, pg_mock_mode |
| value | jsonb | | 값. pg_mock_mode는 'APPROVE'/'DECLINE'(기본 APPROVE, qa 환경에서만 변경) |

### offering_cancel_requests
| 컬럼 | 타입 | 키 | 설명 |
|---|---|---|---|
| id | uuid | PK | |
| offering_id | uuid | FK offerings | |
| requested_by | uuid | FK profiles | 요청자 (운영) |
| reason | text | | 사유 |
| status | text | | REQUESTED/APPROVED/REJECTED |
| decided_by | uuid | FK profiles | 승인/반려자 (재무) |
| decided_at | timestamptz | | |
