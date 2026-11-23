-- 0002_clock_hold.sql: 검수용 시계, 선점(좌석/정원), 만료, 1인 한도
-- 정책 판단의 현재 시각은 항상 app_now()를 씁니다(SFR-025).

create or replace function public.app_now() returns timestamptz
language sql stable as $$
  select case
    when coalesce((select value from public.app_settings where key = 'clock_enabled'), 'false'::jsonb) = 'true'::jsonb
      then now() + make_interval(secs => coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'clock_offset_ms'), 0) / 1000.0)
    else now()
  end
$$;

-- 기준 시각의 KST 달력 날짜 - 오늘(app_now)의 KST 달력 날짜
create or replace function public.d_day(base timestamptz) returns int
language sql stable as $$
  select ((base at time zone 'Asia/Seoul')::date - (public.app_now() at time zone 'Asia/Seoul')::date)
$$;

-- 1인 한도. 값은 supabase/functions/_shared/policy/limits.js 의 LIMITS 와 같아야 합니다(테스트로 비교).
create or replace function public.product_limit(p_type text) returns int
language sql immutable as $$
  select case p_type when 'PERFORMANCE' then 4 when 'EXPERIENCE' then 4 when 'COURSE' then 1 end
$$;

create or replace function public.hold_error(p_code text) returns void
language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_code;
end $$;

-- 만료된 ACTIVE 선점을 EXPIRED로 바꾸고 좌석을 되돌립니다. PAYING은 건드리지 않습니다.
-- Task 5가 create or replace 로 대기 처리를 덧붙입니다.
create or replace function public.sweep_offering(p_offering uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  with expired as (
    update public.holds h
       set status = 'EXPIRED'
     where h.offering_id = p_offering and h.status = 'ACTIVE' and h.expires_at <= public.app_now()
    returning h.id
  )
  update public.inventory_seats s
     set status = 'AVAILABLE', hold_id = null
   where s.offering_id = p_offering and s.status = 'HELD' and s.hold_id in (select id from expired);
end $$;

-- 확정 수 + 유효 선점 수 + 대기 배정 수
create or replace function public.used_capacity(p_offering uuid) returns int
language sql stable security definer set search_path = public as $$
  select (coalesce((select sum(h.qty) from public.bookings b join public.holds h on h.id = b.hold_id
                    where b.offering_id = p_offering and b.status = 'CONFIRMED'), 0)
       + coalesce((select sum(qty) from public.holds
                    where offering_id = p_offering
                      and (status = 'PAYING' or (status = 'ACTIVE' and expires_at > public.app_now()))), 0)
       + coalesce((select sum(allocated_qty) from public.waitlist
                    where offering_id = p_offering and status in ('WAITING', 'PROMOTED')), 0))::int
$$;

create or replace function public.remaining_capacity(p_offering uuid) returns int
language sql stable security definer set search_path = public as $$
  select greatest(0, o.capacity - public.used_capacity(o.id)) from public.offerings o where o.id = p_offering
$$;

-- 사용자의 해당 회차 확정 + 유효 선점 수량(여러 탭 합산)
create or replace function public.user_held_qty(p_user uuid, p_offering uuid) returns int
language sql stable security definer set search_path = public as $$
  select (coalesce((select sum(h.qty) from public.bookings b join public.holds h on h.id = b.hold_id
                    where b.user_id = p_user and b.offering_id = p_offering and b.status = 'CONFIRMED'), 0)
       + coalesce((select sum(qty) from public.holds
                    where user_id = p_user and offering_id = p_offering
                      and (status = 'PAYING' or (status = 'ACTIVE' and expires_at > public.app_now()))), 0))::int
$$;

-- 공통 검증: 판매 중, 상품 유형, 한도. 호출자가 동시성 잠금을 먼저 잡아야 합니다.
create or replace function public.hold_precheck(p_user uuid, p_offering uuid, p_qty int, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_off public.offerings%rowtype;
  v_type text;
begin
  select * into v_off from public.offerings where id = p_offering;
  if not found then perform public.hold_error('NOT_ON_SALE'); end if;
  if v_off.status <> 'OPEN' or public.app_now() < v_off.sale_starts_at or public.app_now() >= v_off.sale_ends_at then
    perform public.hold_error('NOT_ON_SALE');
  end if;
  select type into v_type from public.programs where id = v_off.program_id;
  if (p_kind = 'SEAT' and v_type <> 'PERFORMANCE') or (p_kind = 'CAPACITY' and v_type = 'PERFORMANCE') then
    perform public.hold_error('INVALID_REQUEST');
  end if;
  if public.user_held_qty(p_user, p_offering) + p_qty > public.product_limit(v_type) then
    perform public.hold_error('LIMIT_EXCEEDED');
  end if;
end $$;

-- 좌석 선점. 좌석 id는 seats.id(int)입니다.
create or replace function public.hold_seats(p_offering uuid, p_seat_ids int[]) returns public.holds
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_seats int[];
  v_hold public.holds;
  v_changed int;
begin
  if v_uid is null then perform public.hold_error('UNAUTHENTICATED'); end if;
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

-- 정원제(체험, 정규 강좌) 선점
create or replace function public.hold_capacity(p_offering uuid, p_qty int) returns public.holds
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_cap int;
  v_hold public.holds;
begin
  if v_uid is null then perform public.hold_error('UNAUTHENTICATED'); end if;
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
  select * into v_h from public.holds where id = p_hold for update;
  if not found or v_h.user_id is distinct from v_uid then perform public.hold_error('NOT_OWNER'); end if;
  if v_h.status <> 'ACTIVE' then return; end if;
  update public.holds set status = 'RELEASED' where id = p_hold;
  update public.inventory_seats set status = 'AVAILABLE', hold_id = null
   where hold_id = p_hold and status = 'HELD';
end $$;

revoke all on function public.sweep_offering(uuid), public.used_capacity(uuid), public.user_held_qty(uuid, uuid),
  public.hold_precheck(uuid, uuid, int, text), public.hold_error(text),
  public.hold_seats(uuid, int[]), public.hold_capacity(uuid, int), public.release_hold(uuid),
  public.remaining_capacity(uuid) from public, anon, authenticated;
grant execute on function public.hold_seats(uuid, int[]), public.hold_capacity(uuid, int), public.release_hold(uuid),
  public.remaining_capacity(uuid), public.sweep_offering(uuid) to authenticated, service_role;
grant execute on function public.used_capacity(uuid) to service_role;
grant execute on function public.app_now(), public.d_day(timestamptz), public.product_limit(text) to anon, authenticated, service_role;
