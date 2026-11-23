-- 0011_rls.sql: 행 단위 접근 정책(SER-002)
-- 원칙
--   1) 모든 public 테이블에 RLS 를 켜고 정책이 없으면 거부합니다.
--   2) 화면(anon, authenticated)은 테이블에 직접 쓰지 못합니다. 쓰기는 security definer 함수만 합니다.
--      (함수 소유자는 테이블 소유자라 RLS 를 거치지 않으며, 각 함수가 auth.uid()/역할을 스스로 확인합니다.)
--   3) 비회원은 공개 프로그램 목록(programs, offerings, offering_prices, course_lessons, seats)만 읽습니다.
--      좌석 상태는 offering_seat_map(0007) 으로만 봅니다.
--   4) 회원은 본인 행만, 담당자는 역할에 맞는 행만 읽습니다. 다른 사람 프로필(개인정보)은 담당자도 직접 읽지 못하고
--      staff_*(가림)/admin_view_member(전체 + VIEW_PII 기록)로만 봅니다.
--   5) app_settings, pg_mock_transactions 는 화면에서 읽지도 쓰지도 못합니다(service_role 과 함수만).
-- 다시 실행해도 같은 결과가 되도록 drop policy if exists 후 만듭니다.

-- ===== 함수: RLS 아래에서도 동작하도록 =====
-- app_settings 를 읽으므로 소유자 권한으로 실행합니다(본문은 0002 와 같음).
create or replace function public.app_now() returns timestamptz
language sql stable security definer set search_path = public as $$
  select case
    when coalesce((select value from public.app_settings where key = 'clock_enabled'), 'false'::jsonb) = 'true'::jsonb
      then now() + make_interval(secs => coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'clock_offset_ms'), 0) / 1000.0)
    else now()
  end
$$;

create or replace function public.d_day(base timestamptz) returns int
language sql stable security definer set search_path = public as $$
  select ((base at time zone 'Asia/Seoul')::date - (public.app_now() at time zone 'Asia/Seoul')::date)
$$;

-- ===== R17: 탈퇴/차단 계정은 회원 쓰기 함수를 쓰지 못합니다 =====
-- 본문은 각 함수의 최신 정의(0002, 0003, 0004)와 같고 assert_active_member 호출만 더했습니다.

create or replace function public.hold_seats(p_offering uuid, p_seat_ids int[]) returns public.holds
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_seats int[];
  v_hold public.holds;
  v_changed int;
begin
  if v_uid is null then perform public.hold_error('UNAUTHENTICATED'); end if;
  perform public.assert_active_member(v_uid);
  select array_agg(distinct x) into v_seats from unnest(coalesce(p_seat_ids, '{}')) x;
  if v_seats is null then perform public.hold_error('INVALID_REQUEST'); end if;

  -- 같은 사용자의 여러 탭이 한도를 동시에 우회하지 못하게 사용자+회차 단위로 직렬화
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || p_offering::text, 0));
  perform public.sweep_offering(p_offering);
  perform public.hold_precheck(v_uid, p_offering, cardinality(v_seats), 'SEAT');

  insert into public.holds(offering_id, user_id, qty, status, expires_at)
    values (p_offering, v_uid, cardinality(v_seats), 'ACTIVE', public.app_now() + interval '10 minutes')
    returning * into v_hold;

  -- 조건부 update: AVAILABLE인 행만 바뀌므로 동시에 같은 좌석을 잡아도 한 쪽만 성공
  update public.inventory_seats
     set status = 'HELD', hold_id = v_hold.id
   where offering_id = p_offering and seat_id = any(v_seats) and status = 'AVAILABLE';
  get diagnostics v_changed = row_count;
  if v_changed <> cardinality(v_seats) then
    perform public.hold_error('SEAT_TAKEN');  -- 예외로 트랜잭션 전체 롤백
  end if;
  return v_hold;
end $$;

create or replace function public.hold_capacity(p_offering uuid, p_qty int) returns public.holds
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_cap int;
  v_hold public.holds;
begin
  if v_uid is null then perform public.hold_error('UNAUTHENTICATED'); end if;
  perform public.assert_active_member(v_uid);
  if p_qty is null or p_qty <= 0 then perform public.hold_error('INVALID_REQUEST'); end if;

  -- 회차 행 잠금으로 정원 계산(과 사용자 한도 계산)을 직렬화
  select capacity into v_cap from public.offerings where id = p_offering for update;
  if not found then perform public.hold_error('NOT_ON_SALE'); end if;
  perform public.sweep_offering(p_offering);
  perform public.hold_precheck(v_uid, p_offering, p_qty, 'CAPACITY');
  if public.used_capacity(p_offering) + p_qty > v_cap then
    perform public.hold_error('SOLD_OUT');
  end if;

  insert into public.holds(offering_id, user_id, qty, status, expires_at)
    values (p_offering, v_uid, p_qty, 'ACTIVE', public.app_now() + interval '10 minutes')
    returning * into v_hold;
  return v_hold;
end $$;

create or replace function public.release_hold(p_hold uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_h public.holds%rowtype;
begin
  perform public.assert_active_member(v_uid);
  select * into v_h from public.holds where id = p_hold for update;
  if not found or v_h.user_id is distinct from v_uid then perform public.hold_error('NOT_OWNER'); end if;
  if v_h.status <> 'ACTIVE' then return; end if;
  update public.holds set status = 'RELEASED' where id = p_hold;
  if v_h.waitlist_id is not null then
    update public.inventory_seats set status = 'WAIT_ALLOCATED', hold_id = null
     where hold_id = p_hold and status = 'HELD';
  else
    update public.inventory_seats set status = 'AVAILABLE', hold_id = null
     where hold_id = p_hold and status = 'HELD';
  end if;
end $$;

create or replace function public.join_waitlist(p_offering uuid, p_qty int) returns public.waitlist
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_off public.offerings%rowtype;
  v_type text;
  v_sold_out boolean;
  v_w public.waitlist;
begin
  if v_uid is null then perform public.hold_error('UNAUTHENTICATED'); end if;
  perform public.assert_active_member(v_uid);
  if p_qty is null or p_qty <= 0 then perform public.hold_error('INVALID_REQUEST'); end if;

  select * into v_off from public.offerings where id = p_offering for update;
  if not found then perform public.hold_error('NOT_ON_SALE'); end if;
  perform public.sweep_offering(p_offering);
  select type into v_type from public.programs where id = v_off.program_id;

  if v_off.status <> 'OPEN' or public.app_now() < v_off.sale_starts_at or public.app_now() >= v_off.sale_ends_at
     or public.app_now() >= coalesce((select min(starts_at) from public.course_lessons where offering_id = p_offering), v_off.starts_at)
     or public.d_day(v_off.starts_at) <= 2  -- Ruling R12: D-2 이내에는 승격이 없으므로 신청도 받지 않습니다.
  then
    perform public.hold_error('NOT_ON_SALE');
  end if;
  if exists (select 1 from public.waitlist where offering_id = p_offering and user_id = v_uid
               and status in ('WAITING', 'PROMOTED')) then
    perform public.hold_error('ALREADY_WAITING');
  end if;
  if public.user_held_qty(v_uid, p_offering) + p_qty > public.product_limit(v_type) then
    perform public.hold_error('LIMIT_EXCEEDED');
  end if;

  if v_type = 'PERFORMANCE' then
    v_sold_out := not exists (select 1 from public.inventory_seats where offering_id = p_offering and status = 'AVAILABLE');
  else
    v_sold_out := public.used_capacity(p_offering) >= v_off.capacity;
  end if;
  if not v_sold_out then perform public.hold_error('NOT_SOLD_OUT'); end if;

  insert into public.waitlist(offering_id, user_id, qty) values (p_offering, v_uid, p_qty)
    returning * into v_w;
  return v_w;
end $$;

create or replace function public.cancel_waitlist(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_w public.waitlist%rowtype;
begin
  perform public.assert_active_member(v_uid);
  select * into v_w from public.waitlist where id = p_id;
  if not found or v_w.user_id is distinct from v_uid then perform public.hold_error('NOT_OWNER'); end if;
  perform 1 from public.offerings where id = v_w.offering_id for update;
  perform public.sweep_offering(v_w.offering_id);
  select * into v_w from public.waitlist where id = p_id;
  if v_w.status not in ('WAITING', 'PROMOTED') then return; end if;
  if not public.waitlist_close(p_id, 'CANCELLED', 'RELEASED') then
    perform public.hold_error('PAYMENT_IN_PROGRESS');
  end if;
end $$;

create or replace function public.hold_for_promotion(p_waitlist uuid) returns public.holds
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_w public.waitlist%rowtype;
  v_type text;
  v_hold public.holds;
  v_changed int;
begin
  if v_uid is null then perform public.hold_error('UNAUTHENTICATED'); end if;
  perform public.assert_active_member(v_uid);
  select * into v_w from public.waitlist where id = p_waitlist;
  if not found or v_w.user_id is distinct from v_uid then perform public.hold_error('NOT_OWNER'); end if;
  perform 1 from public.offerings where id = v_w.offering_id for update;
  perform public.sweep_offering(v_w.offering_id);
  select * into v_w from public.waitlist where id = p_waitlist for update;
  if v_w.status <> 'PROMOTED' or v_w.deadline_at <= public.app_now() then
    perform public.hold_error('NOT_PROMOTED');
  end if;

  select * into v_hold from public.holds
   where waitlist_id = p_waitlist
     and (status = 'PAYING' or (status = 'ACTIVE' and expires_at > public.app_now()))
   order by created_at desc limit 1;
  if found then return v_hold; end if;

  select p.type into v_type from public.offerings o join public.programs p on p.id = o.program_id
   where o.id = v_w.offering_id;
  if public.user_held_qty(v_uid, v_w.offering_id) + v_w.allocated_qty > public.product_limit(v_type) then
    perform public.hold_error('LIMIT_EXCEEDED');
  end if;

  insert into public.holds(offering_id, user_id, qty, status, expires_at, waitlist_id)
    values (v_w.offering_id, v_uid, v_w.allocated_qty, 'ACTIVE', v_w.deadline_at, p_waitlist)
    returning * into v_hold;

  if v_type = 'PERFORMANCE' then
    update public.inventory_seats set status = 'HELD', hold_id = v_hold.id
     where offering_id = v_w.offering_id and waitlist_id = p_waitlist and status = 'WAIT_ALLOCATED';
    get diagnostics v_changed = row_count;
    if v_changed <> v_w.allocated_qty then perform public.hold_error('SEAT_TAKEN'); end if;
  end if;
  return v_hold;
end $$;

create or replace function public.prepare_payment(p_hold uuid, p_items jsonb, p_amount int, p_order_id text)
returns public.holds
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_h public.holds%rowtype;
  v_type text;
  v_types text[];
  v_n int;
  v_items jsonb;
  v_total int;
  v_res public.holds;
begin
  if v_uid is null then perform public.hold_error('UNAUTHENTICATED'); end if;
  perform public.assert_active_member(v_uid);
  select * into v_h from public.holds where id = p_hold;
  if not found or v_h.user_id is distinct from v_uid then perform public.hold_error('NOT_OWNER'); end if;
  -- 잠금 순서: 회차 -> 선점. 판매 중(OPEN)이 아니면(회차 취소 요청/취소) 결제로 넘어가지 않습니다.
  if (select status from public.offerings where id = v_h.offering_id for update) is distinct from 'OPEN' then
    perform public.hold_error('NOT_ON_SALE');
  end if;
  select * into v_h from public.holds where id = p_hold for update;
  if v_h.status <> 'ACTIVE' or v_h.expires_at <= public.app_now() then perform public.hold_error('HOLD_EXPIRED'); end if;
  if p_order_id is null or p_order_id !~ '^HB-[0-9]{8}-[A-Za-z0-9]{10}$' then
    perform public.hold_error('INVALID_REQUEST');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) <> v_h.qty
     or exists (select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e) <> 'object') then
    perform public.hold_error('INVALID_REQUEST');
  end if;

  select p.type into v_type
    from public.offerings o join public.programs p on p.id = o.program_id where o.id = v_h.offering_id;

  -- 할인 선택 규칙(pricing.js validateDiscounts와 같음)
  select array_agg(coalesce(e->>'discountType', 'GENERAL') order by ord) into v_types
    from jsonb_array_elements(p_items) with ordinality t(e, ord);
  if cardinality(public.validate_discounts(v_types, v_type)) > 0 then
    perform public.hold_error('INVALID_DISCOUNT');
  end if;

  if v_type = 'PERFORMANCE' then
    -- 요청 좌석이 이 선점의 좌석과 정확히 같아야 합니다.
    if exists (select 1 from jsonb_array_elements(p_items) e
                where coalesce(e->>'seatId', e->>'seat_id', '') !~ '^[0-9]{1,9}$') then
      perform public.hold_error('INVALID_REQUEST');
    end if;
    select count(*) into v_n from (
      select distinct coalesce(e->>'seatId', e->>'seat_id')::int s from jsonb_array_elements(p_items) e
      intersect
      select seat_id from public.inventory_seats where hold_id = v_h.id and status = 'HELD'
    ) t;
    if v_n <> v_h.qty then perform public.hold_error('INVALID_REQUEST'); end if;

    select jsonb_agg(jsonb_build_object('seat_id', r.seat_id, 'unitPrice', op.price, 'discountType', r.dt) order by r.ord),
           sum(op.price - op.price * public.discount_rate(r.dt) / 100), count(op.price)
      into v_items, v_total, v_n
      from (select ord, coalesce(e->>'seatId', e->>'seat_id')::int seat_id, coalesce(e->>'discountType', 'GENERAL') dt
              from jsonb_array_elements(p_items) with ordinality t(e, ord)) r
      join public.seats s on s.id = r.seat_id
      left join public.offering_prices op on op.offering_id = v_h.offering_id and op.grade = s.grade;
  else
    if exists (select 1 from jsonb_array_elements(p_items) e
                where coalesce(e->>'seatId', e->>'seat_id') is not null) then
      perform public.hold_error('INVALID_REQUEST');
    end if;
    select jsonb_agg(jsonb_build_object('seat_id', null, 'unitPrice', op.price, 'discountType', r.dt) order by r.ord),
           sum(op.price - op.price * public.discount_rate(r.dt) / 100), count(op.price)
      into v_items, v_total, v_n
      from (select ord, coalesce(e->>'discountType', 'GENERAL') dt
              from jsonb_array_elements(p_items) with ordinality t(e, ord)) r
      left join public.offering_prices op on op.offering_id = v_h.offering_id and op.grade is null;
  end if;
  if v_n is distinct from v_h.qty then perform public.hold_error('INVALID_REQUEST'); end if;  -- 가격 미등록
  if p_amount is distinct from v_total then perform public.hold_error('AMOUNT_MISMATCH'); end if;

  begin
    update public.holds set order_id = p_order_id, items = v_items, amount = v_total
     where id = v_h.id
    returning * into v_res;
  exception when unique_violation then
    perform public.hold_error('INVALID_REQUEST');  -- 다른 선점이 쓰는 주문번호
  end;
  return v_res;
end $$;

-- ===== 테이블 권한: 화면 역할은 읽기만 =====
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
-- 앞으로 만드는 테이블도 같은 기본값을 갖게 합니다(Task 14, 15 의 테이블/뷰).
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;

-- 화면에서 열지 않는 테이블
revoke all on public.app_settings, public.pg_mock_transactions from anon, authenticated;

-- 결제 원본(raw)은 열 권한에서 뺍니다. 정산 담당은 admin_payment_raw 로만 봅니다.
revoke select on public.payments from anon, authenticated;
grant select (id, order_id, payment_key, booking_id, user_id, amount, status, approved_at) on public.payments to authenticated;

-- ===== RLS 켜기 =====
alter table public.profiles enable row level security;
alter table public.programs enable row level security;
alter table public.offerings enable row level security;
alter table public.course_lessons enable row level security;
alter table public.seats enable row level security;
alter table public.offering_prices enable row level security;
alter table public.holds enable row level security;
alter table public.waitlist enable row level security;
alter table public.inventory_seats enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_items enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.pg_mock_transactions enable row level security;
alter table public.notifications enable row level security;
alter table public.admin_audit enable row level security;
alter table public.app_settings enable row level security;
alter table public.offering_cancel_requests enable row level security;

-- ===== 공개 목록 =====
drop policy if exists programs_read on public.programs;
create policy programs_read on public.programs for select to anon, authenticated
  using (is_public or (select public.is_staff(null)));

-- 회차는 보이는 프로그램의 회차만. 아래 가격/수업 일정은 보이는 회차를 따라갑니다(정책이 연쇄 적용).
drop policy if exists offerings_read on public.offerings;
create policy offerings_read on public.offerings for select to anon, authenticated
  using (exists (select 1 from public.programs p where p.id = program_id));

drop policy if exists offering_prices_read on public.offering_prices;
create policy offering_prices_read on public.offering_prices for select to anon, authenticated
  using (exists (select 1 from public.offerings o where o.id = offering_id));

drop policy if exists course_lessons_read on public.course_lessons;
create policy course_lessons_read on public.course_lessons for select to anon, authenticated
  using (exists (select 1 from public.offerings o where o.id = offering_id));

drop policy if exists seats_read on public.seats;
create policy seats_read on public.seats for select to anon, authenticated using (true);

-- ===== 본인 행 / 역할별 행 =====
drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists holds_read on public.holds;
create policy holds_read on public.holds for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff(array['operator'])));

drop policy if exists waitlist_read on public.waitlist;
create policy waitlist_read on public.waitlist for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff(array['operator'])));

drop policy if exists inventory_seats_read on public.inventory_seats;
create policy inventory_seats_read on public.inventory_seats for select to authenticated
  using ((select public.is_staff(array['operator'])));

drop policy if exists bookings_read on public.bookings;
create policy bookings_read on public.bookings for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff(array['operator', 'finance'])));

drop policy if exists booking_items_read on public.booking_items;
create policy booking_items_read on public.booking_items for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id));

drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff(array['finance'])));

drop policy if exists refunds_read on public.refunds;
create policy refunds_read on public.refunds for select to authenticated
  using ((select public.is_staff(array['finance']))
         or exists (select 1 from public.bookings b where b.id = booking_id and b.user_id = (select auth.uid())));

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists admin_audit_read on public.admin_audit;
create policy admin_audit_read on public.admin_audit for select to authenticated
  using ((select public.is_staff(null)));

drop policy if exists offering_cancel_requests_read on public.offering_cancel_requests;
create policy offering_cancel_requests_read on public.offering_cancel_requests for select to authenticated
  using ((select public.is_staff(null)));

-- app_settings, pg_mock_transactions: 정책 없음(거부). service_role 과 security definer 함수만 씁니다.
