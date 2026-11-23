-- 0010_admin.sql: 관리자 역할 확인, 프로그램/회차/가격 등록, 작업 이력, 개인정보 열람 기록
-- 담당자 화면은 테이블에 직접 쓰지 않고 이 함수들로만 바꿉니다(0011_rls.sql 이 직접 쓰기를 막음).
-- admin_* 는 바꾸거나 개인정보를 여는 함수이며 모두 admin_audit 에 기록합니다(SER-006).
-- staff_* 는 담당자 화면용 조회 함수이며 개인정보는 가린 값만 돌려줍니다(SER-005).
-- 잠금 순서는 다른 업무 함수와 같은 회차 -> 선점 -> 대기 -> 좌석입니다. 다시 실행해도 결과가 같습니다.

-- 호출자가 주어진 역할의 담당자인지. p_roles 가 null 이면 담당자 역할 전체로 봅니다.
-- 차단(탈퇴)된 계정은 아직 유효한 토큰이 있어도 담당자로 보지 않습니다.
create or replace function public.is_staff(p_roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p
      join auth.users u on u.id = p.id
     where p.id = auth.uid()
       and p.role = any(coalesce(p_roles, array['operator', 'finance']))
       and p.role in ('operator', 'finance')
       and (u.banned_until is null or u.banned_until <= now())
  )
$$;

-- 담당자 확인. 비로그인은 UNAUTHENTICATED, 역할이 다르면 FORBIDDEN. 호출자 id 를 돌려줍니다.
create or replace function public.require_staff(p_roles text[]) returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then perform public.hold_error('UNAUTHENTICATED'); end if;
  if not public.is_staff(p_roles) then perform public.hold_error('FORBIDDEN'); end if;
  return auth.uid();
end $$;

create or replace function public.admin_log(p_action text, p_target_type text, p_target_id text, p_detail jsonb)
returns void
language sql security definer set search_path = public as $$
  insert into public.admin_audit(actor_id, action, target_type, target_id, detail, at)
  values (auth.uid(), p_action, p_target_type, p_target_id, p_detail, public.app_now())
$$;

-- 두 행(jsonb)에서 값이 바뀐 열만 {열: {from, to}} 로 돌려줍니다.
create or replace function public.admin_diff(p_old jsonb, p_new jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(n.key, jsonb_build_object('from', p_old -> n.key, 'to', n.value)), '{}'::jsonb)
    from jsonb_each(p_new) n
   where (p_old -> n.key) is distinct from n.value
$$;

-- 개인정보 가림: 김지수 -> 김*수, 김수 -> 김*, 01012341234 -> 010-****-1234
create or replace function public.mask_name(p_name text) returns text
language sql immutable as $$
  select case
    when p_name is null or char_length(p_name) = 0 then null
    when char_length(p_name) = 1 then '*'
    when char_length(p_name) = 2 then left(p_name, 1) || '*'
    else left(p_name, 1) || repeat('*', char_length(p_name) - 2) || right(p_name, 1)
  end
$$;

create or replace function public.mask_phone(p_phone text) returns text
language sql immutable as $$
  select case
    when d is null or char_length(d) < 7 then null
    else left(d, 3) || '-' || repeat('*', char_length(d) - 7) || '-' || right(d, 4)
  end
  from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') d) t
$$;

-- jsonb 에서 일시를 읽습니다. 없으면 null, 형식이 틀리면 INVALID_SCHEDULE.
create or replace function public.admin_ts(p jsonb, p_key text) returns timestamptz
language plpgsql immutable as $$
begin
  if p is null or not (p ? p_key) or jsonb_typeof(p -> p_key) = 'null' then return null; end if;
  return (p ->> p_key)::timestamptz;
exception when others then
  perform public.hold_error('INVALID_SCHEDULE');
end $$;

-- ===== 프로그램 =====
-- p = {id?, type, title, summary, description, venue, audience, is_public, poster_image, poster_tone,
--      poster_series, poster_title, poster_sub, details}. id 가 있으면 수정이고, 넘긴 키만 바꿉니다.
create or replace function public.admin_upsert_program(p jsonb) returns public.programs
language plpgsql security definer set search_path = public as $$
declare
  v_old public.programs;
  v_new public.programs;
  v_id uuid;
  v_title text;
begin
  perform public.require_staff(array['operator']);
  if p is null or jsonb_typeof(p) <> 'object' then perform public.hold_error('INVALID_REQUEST'); end if;

  if p ? 'id' and jsonb_typeof(p -> 'id') <> 'null' then
    begin
      v_id := (p ->> 'id')::uuid;
    exception when others then
      perform public.hold_error('NOT_FOUND');
    end;
    select * into v_old from public.programs where id = v_id for update;
    if not found then perform public.hold_error('NOT_FOUND'); end if;
  end if;

  if p ? 'type' and (p ->> 'type') is distinct from 'PERFORMANCE' and (p ->> 'type') is distinct from 'EXPERIENCE'
     and (p ->> 'type') is distinct from 'COURSE' then
    perform public.hold_error('INVALID_TYPE');
  end if;
  if v_old.id is null and not (p ? 'type') then perform public.hold_error('INVALID_TYPE'); end if;
  if v_old.id is not null and p ? 'type' and (p ->> 'type') <> v_old.type
     and exists (select 1 from public.offerings where program_id = v_old.id) then
    perform public.hold_error('TYPE_LOCKED');  -- 회차 재고(좌석/정원)가 유형에 묶여 있습니다.
  end if;

  if v_old.id is null or p ? 'title' then
    v_title := btrim(coalesce(p ->> 'title', ''));
    if v_title = '' or char_length(v_title) > 100 then perform public.hold_error('INVALID_TITLE'); end if;
  end if;
  if p ? 'poster_tone' and (p ->> 'poster_tone') not in ('light', 'dark') then perform public.hold_error('INVALID_REQUEST'); end if;
  if p ? 'is_public' and jsonb_typeof(p -> 'is_public') <> 'boolean' then perform public.hold_error('INVALID_REQUEST'); end if;
  if p ? 'details' and jsonb_typeof(p -> 'details') <> 'object' then perform public.hold_error('INVALID_REQUEST'); end if;

  if v_old.id is null then
    insert into public.programs(type, title, summary, description, venue, audience, is_public,
                                poster_image, poster_tone, poster_series, poster_title, poster_sub, details)
    values (p ->> 'type', v_title, nullif(btrim(p ->> 'summary'), ''), nullif(btrim(p ->> 'description'), ''),
            nullif(btrim(p ->> 'venue'), ''), nullif(btrim(p ->> 'audience'), ''),
            coalesce((p ->> 'is_public')::boolean, false),
            nullif(p ->> 'poster_image', ''), coalesce(p ->> 'poster_tone', 'dark'),
            nullif(btrim(p ->> 'poster_series'), ''), nullif(btrim(p ->> 'poster_title'), ''), nullif(btrim(p ->> 'poster_sub'), ''),
            coalesce(p -> 'details', '{}'::jsonb))
    returning * into v_new;
    perform public.admin_log('PROGRAM_CREATE', 'program', v_new.id::text, jsonb_build_object('title', v_new.title, 'type', v_new.type));
  else
    update public.programs set
      type = case when p ? 'type' then p ->> 'type' else type end,
      title = case when p ? 'title' then v_title else title end,
      summary = case when p ? 'summary' then nullif(btrim(p ->> 'summary'), '') else summary end,
      description = case when p ? 'description' then nullif(btrim(p ->> 'description'), '') else description end,
      venue = case when p ? 'venue' then nullif(btrim(p ->> 'venue'), '') else venue end,
      audience = case when p ? 'audience' then nullif(btrim(p ->> 'audience'), '') else audience end,
      is_public = case when p ? 'is_public' then (p ->> 'is_public')::boolean else is_public end,
      poster_image = case when p ? 'poster_image' then nullif(p ->> 'poster_image', '') else poster_image end,
      poster_tone = case when p ? 'poster_tone' then p ->> 'poster_tone' else poster_tone end,
      poster_series = case when p ? 'poster_series' then nullif(btrim(p ->> 'poster_series'), '') else poster_series end,
      poster_title = case when p ? 'poster_title' then nullif(btrim(p ->> 'poster_title'), '') else poster_title end,
      poster_sub = case when p ? 'poster_sub' then nullif(btrim(p ->> 'poster_sub'), '') else poster_sub end,
      details = case when p ? 'details' then p -> 'details' else details end
    where id = v_old.id
    returning * into v_new;
    if public.admin_diff(to_jsonb(v_old), to_jsonb(v_new)) <> '{}'::jsonb then
      perform public.admin_log('PROGRAM_UPDATE', 'program', v_new.id::text,
        jsonb_build_object('changes', public.admin_diff(to_jsonb(v_old), to_jsonb(v_new))));
    end if;
  end if;
  return v_new;
end $$;

-- ===== 가격 =====
-- p_prices = [{grade, price}]. 공연은 R/S/A 세 등급, 체험/정규 강좌는 등급 없는(grade null) 하나.
-- 이미 확정된 예약 금액(booking_items, bookings)은 바뀌지 않습니다. 결제 준비 때 그 시점 가격을 저장하기 때문입니다.
-- 호출자(admin_upsert_offering 포함)가 담당자 확인을 하고, 회차 행은 여기서 잠급니다.
create or replace function public.admin_apply_prices(p_offering uuid, p_prices jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_type text;
  v_status text;
  v_old jsonb;
  v_new jsonb;
begin
  select o.status, p.type into v_status, v_type
    from public.offerings o join public.programs p on p.id = o.program_id where o.id = p_offering for update of o;
  if not found then perform public.hold_error('NOT_FOUND'); end if;
  if v_status <> 'OPEN' then perform public.hold_error('OFFERING_CLOSED'); end if;

  if p_prices is null or jsonb_typeof(p_prices) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_prices) e
                 where jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'price') is distinct from 'number'
                    or (e ->> 'price')::numeric <> floor((e ->> 'price')::numeric)
                    or (e ->> 'price')::numeric < 0 or (e ->> 'price')::numeric > 10000000) then
    perform public.hold_error('INVALID_PRICE');
  end if;
  if v_type = 'PERFORMANCE' then
    if jsonb_array_length(p_prices) <> 3
       or (select array_agg(e ->> 'grade' order by e ->> 'grade') from jsonb_array_elements(p_prices) e)
          is distinct from array['A', 'R', 'S'] then
      perform public.hold_error('INVALID_PRICE');
    end if;
  elsif jsonb_array_length(p_prices) <> 1 or (p_prices -> 0 ->> 'grade') is not null then
    perform public.hold_error('INVALID_PRICE');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('grade', grade, 'price', price) order by grade nulls first), '[]'::jsonb)
    into v_old from public.offering_prices where offering_id = p_offering;
  select jsonb_agg(jsonb_build_object('grade', e ->> 'grade', 'price', (e ->> 'price')::int) order by e ->> 'grade' nulls first)
    into v_new from jsonb_array_elements(p_prices) e;
  if v_old = v_new then return; end if;

  delete from public.offering_prices where offering_id = p_offering;
  insert into public.offering_prices(offering_id, grade, price)
  select p_offering, e ->> 'grade', (e ->> 'price')::int from jsonb_array_elements(p_prices) e;
  perform public.admin_log('PRICE_SET', 'offering', p_offering::text, jsonb_build_object('from', v_old, 'to', v_new));
end $$;

create or replace function public.admin_set_prices(p_offering uuid, p_prices jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff(array['operator']);
  perform public.admin_apply_prices(p_offering, p_prices);
end $$;

-- ===== 회차 =====
-- p = {id?, program_id, starts_at, ends_at, sale_starts_at, sale_ends_at, capacity, lessons?[], prices?[]}
-- 등록: 공연은 좌석 수가 정원이고 inventory_seats 를 만듭니다. 정규 강좌는 lessons(수업 시작 일시)가 필요하고
-- 시작 일시는 첫 수업입니다. 수정: 넘긴 키만 바꾸고, 정원은 판매 + 선점 + 대기 배정보다 작게 줄이지 못합니다.
create or replace function public.admin_upsert_offering(p jsonb) returns public.offerings
language plpgsql security definer set search_path = public as $$
declare
  v_old public.offerings;
  v_new public.offerings;
  v_id uuid;
  v_program uuid;
  v_type text;
  v_seats int;
  v_starts timestamptz;
  v_ends timestamptz;
  v_sale_s timestamptz;
  v_sale_e timestamptz;
  v_cap int;
  v_lessons timestamptz[];
  v_changes jsonb;
begin
  perform public.require_staff(array['operator']);
  if p is null or jsonb_typeof(p) <> 'object' then perform public.hold_error('INVALID_REQUEST'); end if;
  select count(*) into v_seats from public.seats;

  if p ? 'id' and jsonb_typeof(p -> 'id') <> 'null' then
    begin
      v_id := (p ->> 'id')::uuid;
    exception when others then
      perform public.hold_error('NOT_FOUND');
    end;
    -- 잠금 순서: 회차 먼저. 만료된 선점을 정리한 뒤 사용 수량을 셉니다.
    select * into v_old from public.offerings where id = v_id for update;
    if not found then perform public.hold_error('NOT_FOUND'); end if;
    if v_old.status <> 'OPEN' then perform public.hold_error('OFFERING_CLOSED'); end if;
    if p ? 'program_id' and (p ->> 'program_id') is distinct from v_old.program_id::text then
      perform public.hold_error('INVALID_REQUEST');
    end if;
    perform public.sweep_offering(v_id);
    v_program := v_old.program_id;
  else
    begin
      v_program := (p ->> 'program_id')::uuid;
    exception when others then
      perform public.hold_error('NOT_FOUND');
    end;
  end if;
  select type into v_type from public.programs where id = v_program;
  if not found then perform public.hold_error('NOT_FOUND'); end if;

  -- 수업 일정
  if p ? 'lessons' then
    if v_type <> 'COURSE' or jsonb_typeof(p -> 'lessons') <> 'array' then perform public.hold_error('INVALID_SCHEDULE'); end if;
    begin
      select array_agg(x::timestamptz order by x::timestamptz) into v_lessons from jsonb_array_elements_text(p -> 'lessons') x;
    exception when others then
      perform public.hold_error('INVALID_SCHEDULE');
    end;
    if v_lessons is null or cardinality(v_lessons) > 52
       or cardinality(v_lessons) <> (select count(distinct l) from unnest(v_lessons) l) then
      perform public.hold_error('INVALID_SCHEDULE');
    end if;
  elsif v_type = 'COURSE' and v_old.id is null then
    perform public.hold_error('INVALID_SCHEDULE');
  end if;

  v_starts := coalesce(public.admin_ts(p, 'starts_at'), v_old.starts_at);
  v_ends := coalesce(public.admin_ts(p, 'ends_at'), v_old.ends_at);
  v_sale_s := coalesce(public.admin_ts(p, 'sale_starts_at'), v_old.sale_starts_at);
  v_sale_e := coalesce(public.admin_ts(p, 'sale_ends_at'), v_old.sale_ends_at);
  if v_lessons is not null then v_starts := v_lessons[1]; end if;
  if v_starts is null or v_ends is null or v_sale_s is null or v_sale_e is null
     or v_ends <= v_starts or v_sale_e <= v_sale_s or v_sale_e > v_starts
     or (v_lessons is not null and v_ends <= v_lessons[cardinality(v_lessons)]) then
    perform public.hold_error('INVALID_SCHEDULE');
  end if;
  -- 새 회차나 일정을 바꾸는 회차는 지난 일시로 둘 수 없습니다.
  if (v_old.id is null or v_starts is distinct from v_old.starts_at) and v_starts <= public.app_now() then
    perform public.hold_error('INVALID_SCHEDULE');
  end if;

  -- 정원
  if p ? 'capacity' and (jsonb_typeof(p -> 'capacity') <> 'number'
     or (p ->> 'capacity')::numeric <> floor((p ->> 'capacity')::numeric)
     or (p ->> 'capacity')::numeric < 1 or (p ->> 'capacity')::numeric > 10000) then
    perform public.hold_error('INVALID_CAPACITY');
  end if;
  if v_type = 'PERFORMANCE' then
    if p ? 'capacity' and (p ->> 'capacity')::int <> v_seats then perform public.hold_error('INVALID_CAPACITY'); end if;
    v_cap := v_seats;
  else
    v_cap := coalesce((p ->> 'capacity')::int, v_old.capacity);
    if v_cap is null then perform public.hold_error('INVALID_CAPACITY'); end if;
  end if;

  if v_old.id is null then
    insert into public.offerings(program_id, starts_at, ends_at, capacity, sale_starts_at, sale_ends_at)
      values (v_program, v_starts, v_ends, v_cap, v_sale_s, v_sale_e)
      returning * into v_new;
    if v_type = 'PERFORMANCE' then
      insert into public.inventory_seats(offering_id, seat_id)
      select v_new.id, s.id from public.seats s
      on conflict do nothing;
    end if;
  else
    if v_cap < public.used_capacity(v_old.id) then perform public.hold_error('CAPACITY_BELOW_SOLD'); end if;
    -- 판매가 시작된 정규 강좌의 수업 일정은 환불 기준이므로 바꾸지 않습니다.
    if v_lessons is not null and public.used_capacity(v_old.id) > 0 then perform public.hold_error('LESSONS_LOCKED'); end if;
    update public.offerings set starts_at = v_starts, ends_at = v_ends, capacity = v_cap,
                                sale_starts_at = v_sale_s, sale_ends_at = v_sale_e
     where id = v_old.id
    returning * into v_new;
  end if;

  if v_lessons is not null then
    delete from public.course_lessons where offering_id = v_new.id;
    insert into public.course_lessons(offering_id, seq, starts_at)
    select v_new.id, ord::int, l from unnest(v_lessons) with ordinality t(l, ord);
  end if;

  if v_old.id is null then
    perform public.admin_log('OFFERING_CREATE', 'offering', v_new.id::text, jsonb_build_object(
      'program_id', v_program, 'starts_at', v_new.starts_at, 'capacity', v_new.capacity,
      'lessons', case when v_lessons is not null then cardinality(v_lessons) end));
  else
    v_changes := public.admin_diff(to_jsonb(v_old), to_jsonb(v_new));
    if v_lessons is not null then v_changes := v_changes || jsonb_build_object('lessons', cardinality(v_lessons)); end if;
    if v_changes <> '{}'::jsonb then
      perform public.admin_log('OFFERING_UPDATE', 'offering', v_new.id::text, jsonb_build_object('changes', v_changes));
    end if;
  end if;

  if p ? 'prices' then perform public.admin_apply_prices(v_new.id, p -> 'prices'); end if;
  return v_new;
end $$;

-- ===== 개인정보 =====
-- 회원 상세(이름, 휴대폰, 이메일 전체). 열람할 때마다 VIEW_PII 를 남깁니다.
create or replace function public.admin_view_member(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.require_staff(null);
  select jsonb_build_object('id', p.id, 'name', p.name, 'phone', p.phone, 'email', u.email,
                            'role', p.role, 'verified_at', p.verified_at)
    into v
    from public.profiles p left join auth.users u on u.id = p.id
   where p.id = p_user;
  if v is null then perform public.hold_error('NOT_FOUND'); end if;
  perform public.admin_log('VIEW_PII', 'profile', p_user::text, '{}'::jsonb);
  return v;
end $$;

-- 결제대행 승인 원본(정산 담당). 화면 테이블 조회로는 raw 열을 읽을 수 없습니다(0011).
create or replace function public.admin_payment_raw(p_payment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform public.require_staff(array['finance']);
  select raw into v from public.payments where id = p_payment;
  if not found then perform public.hold_error('NOT_FOUND'); end if;
  perform public.admin_log('VIEW_PAYMENT_RAW', 'payment', p_payment::text, '{}'::jsonb);
  return v;
end $$;

-- ===== 담당자 조회 =====
-- 회차별 판매(확정 수량), 선점(결제 중 + 유효 선점), 대기(진행 중 신청 수), 잔여
create or replace function public.staff_offering_stats(p_program uuid default null)
returns table (offering_id uuid, program_id uuid, sold int, held int, waiting int, remaining int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(null);
  return query
    select o.id, o.program_id,
      coalesce((select sum(h.qty) from public.bookings b join public.holds h on h.id = b.hold_id
                 where b.offering_id = o.id and b.status = 'CONFIRMED'), 0)::int,
      coalesce((select sum(h.qty) from public.holds h
                 where h.offering_id = o.id
                   and (h.status = 'PAYING' or (h.status = 'ACTIVE' and h.expires_at > public.app_now()))), 0)::int,
      (select count(*) from public.waitlist w where w.offering_id = o.id and w.status in ('WAITING', 'PROMOTED'))::int,
      public.remaining_capacity(o.id)
    from public.offerings o
    where p_program is null or o.program_id = p_program;
end $$;

-- 회차 예약자(가림 처리). 상세는 admin_view_member 로 엽니다.
create or replace function public.staff_offering_bookings(p_offering uuid)
returns table (booking_id uuid, booking_no text, status text, qty int, total_amount int, created_at timestamptz,
               user_id uuid, name_masked text, phone_masked text, seats text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(null);
  return query
    select b.id, b.booking_no, b.status, h.qty, b.total_amount, b.created_at, b.user_id,
           public.mask_name(pr.name), public.mask_phone(pr.phone),
           (select string_agg(s.grade || '석 ' || s.row_label || '열 ' || s.seat_no, ', ' order by s.row_label, s.seat_no)
              from public.booking_items bi join public.seats s on s.id = bi.seat_id where bi.booking_id = b.id)
      from public.bookings b
      join public.holds h on h.id = b.hold_id
      left join public.profiles pr on pr.id = b.user_id
     where b.offering_id = p_offering
     order by b.created_at desc, b.id;
end $$;

-- 대시보드 수치. 금액은 정산 담당에게만 돌려줍니다(운영 담당은 null).
create or replace function public.staff_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (public.app_now() at time zone 'Asia/Seoul')::date;
  v_fin boolean;
begin
  perform public.require_staff(null);
  v_fin := public.is_staff(array['finance']);
  return jsonb_build_object(
    'today', v_today,
    'open_offerings', (select count(*) from public.offerings where status = 'OPEN' and starts_at > public.app_now()),
    'today_bookings', (select count(*) from public.bookings
                        where status = 'CONFIRMED' and (created_at at time zone 'Asia/Seoul')::date = v_today),
    'waiting', (select count(*) from public.waitlist where status in ('WAITING', 'PROMOTED')),
    'cancel_requests', (select count(*) from public.offering_cancel_requests where status = 'REQUESTED'),
    'today_paid', case when v_fin then (select coalesce(sum(amount), 0) from public.payments
                        where (approved_at at time zone 'Asia/Seoul')::date = v_today) end,
    'today_refund', case when v_fin then (select coalesce(sum(refund_amount), 0) from public.refunds
                        where (created_at at time zone 'Asia/Seoul')::date = v_today) end,
    'upcoming', (select coalesce(jsonb_agg(x order by x->>'starts_at'), '[]'::jsonb) from (
        select jsonb_build_object('id', o.id, 'starts_at', o.starts_at, 'status', o.status, 'capacity', o.capacity,
                                  'remaining', public.remaining_capacity(o.id),
                                  'program', jsonb_build_object('id', pg.id, 'title', pg.title, 'type', pg.type)) x
          from public.offerings o join public.programs pg on pg.id = o.program_id
         where o.starts_at > public.app_now() and o.starts_at <= public.app_now() + interval '14 days'
         order by o.starts_at
         limit 10) t)
  );
end $$;

revoke all on function public.is_staff(text[]), public.require_staff(text[]), public.admin_log(text, text, text, jsonb),
  public.admin_diff(jsonb, jsonb), public.mask_name(text), public.mask_phone(text), public.admin_ts(jsonb, text),
  public.admin_upsert_program(jsonb), public.admin_apply_prices(uuid, jsonb), public.admin_set_prices(uuid, jsonb),
  public.admin_upsert_offering(jsonb), public.admin_view_member(uuid), public.admin_payment_raw(uuid),
  public.staff_offering_stats(uuid), public.staff_offering_bookings(uuid), public.staff_dashboard()
  from public, anon, authenticated;
-- is_staff 는 RLS 정책 안에서 호출자 권한으로 실행되므로 anon 도 실행할 수 있어야 합니다(자기 역할만 봄).
grant execute on function public.is_staff(text[]) to anon, authenticated, service_role;
grant execute on function public.admin_upsert_program(jsonb), public.admin_set_prices(uuid, jsonb),
  public.admin_upsert_offering(jsonb), public.admin_view_member(uuid), public.admin_payment_raw(uuid),
  public.staff_offering_stats(uuid), public.staff_offering_bookings(uuid), public.staff_dashboard()
  to authenticated, service_role;
