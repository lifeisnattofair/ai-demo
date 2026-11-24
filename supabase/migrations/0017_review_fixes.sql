-- 0017_review_fixes.sql: D-07 ~ D-15 수정 리뷰 반영(I-1, I-2, M-2, M-3, M-4)
-- 여러 번 적용해도 같은 결과가 나오도록 create or replace 와 on conflict 로 씁니다.

-- I-1: 대기 수량이 회차 정원(공연은 회차 좌석 수)을 넘으면 받지 않습니다.
-- 순번대로 배정하므로 정원보다 많이 기다리는 1순위는 승격될 수 없고 뒤 순번까지 막습니다.
-- 본문은 0011 의 join_waitlist 와 같고 정원 검사만 더했습니다.
create or replace function public.join_waitlist(p_offering uuid, p_qty int) returns public.waitlist
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_off public.offerings%rowtype;
  v_type text;
  v_sold_out boolean;
  v_cap int;
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
    select count(*) into v_cap from public.inventory_seats where offering_id = p_offering;
  else
    v_cap := v_off.capacity;
  end if;
  if p_qty > v_cap then perform public.hold_error('WAITLIST_OVER_CAPACITY'); end if;

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

-- 기한 만료 처리 본체(내부 전용). 회차마다 따로 처리해 한 회차가 실패해도 다른 회차의 처리는 남깁니다(M-2).
-- 오래된 결제 중 선점은 sweep_offering 과 같이 PG 승인 기록이 없는 것만 대상으로 봅니다(M-3).
create or replace function public.sweep_due_offerings_run() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_n int := 0;
begin
  for v_id in
    select x.offering_id from (
      select w.offering_id from public.waitlist w
       where w.status = 'PROMOTED' and w.deadline_at <= public.app_now()
         and not exists (select 1 from public.holds h where h.waitlist_id = w.id and h.status = 'PAYING')
      union
      select w.offering_id from public.waitlist w join public.offerings o on o.id = w.offering_id
       where w.status = 'WAITING' and w.allocated_qty > 0 and public.d_day(o.starts_at) <= 2
      union
      select h.offering_id from public.holds h
       where h.status = 'PAYING' and public.paying_is_stale(h.paying_since) and not public.order_has_charge(h.order_id)
    ) x
    order by x.offering_id
  loop
    begin
      perform public.sweep_offering(v_id);
      v_n := v_n + 1;
    exception when others then
      raise warning 'sweep_due_offerings: 회차 % 처리 실패: %', v_id, sqlerrm;
    end;
  end loop;
  return v_n;
end $$;

-- 화면 조회 경로용. 다른 회원 RPC 와 같이 로그인한 활성 계정(회원, 담당자)만 부릅니다(M-4).
create or replace function public.sweep_due_offerings() returns int
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then perform public.hold_error('UNAUTHENTICATED'); end if;
  perform public.assert_active_member(auth.uid());
  return public.sweep_due_offerings_run();
end $$;

-- pg_cron 전용(postgres 로 실행). app_settings.sweep_cron_paused 가 true 면 건너뜁니다(DB 시험 격리, I-2).
create or replace function public.sweep_due_offerings_cron() returns int
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'sweep_cron_paused'), false) then
    return 0;
  end if;
  return public.sweep_due_offerings_run();
end $$;

insert into public.app_settings(key, value) values ('sweep_cron_paused', 'false') on conflict (key) do nothing;

revoke all on function public.sweep_due_offerings_run(), public.sweep_due_offerings_cron() from public, anon, authenticated;
grant execute on function public.sweep_due_offerings_cron() to service_role;
revoke all on function public.sweep_due_offerings() from public, anon, authenticated;
grant execute on function public.sweep_due_offerings() to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('sweep-due-offerings', '* * * * *', 'select public.sweep_due_offerings_cron()');
    exception when others then
      raise notice 'pg_cron 예약을 건너뜁니다: %', sqlerrm;
    end;
  end if;
end $$;
