-- 0012_admin_ops.sql: 관리자 운영 기능
--   예약 내역/증빙 확인(운영), 대기자 조회(운영), 결제/환불 내역(정산), 회차 취소 요청(운영)/승인(정산), 정산 집계(정산)
--   할인 적용 여부(programs.discount_enabled, Ruling R23), 회차 등록 시 가격 필수
-- 역할(Ruling R22): 결제/환불/정산/취소 승인은 정산 담당(finance)만, 예약/증빙/대기/취소 요청은 운영 담당(operator).
-- 예약 내역은 두 역할 모두 읽습니다(0011 bookings 정책과 같음).
-- admin_* 는 바꾸는 함수라 admin_audit 에 남기고, staff_* 는 조회 함수라 개인정보는 가린 값만 돌려줍니다(0010 과 같은 규칙).
-- 잠금 순서: 회차 -> 취소 요청 -> 예약 -> 예약 매수. 다시 실행해도 결과가 같습니다.

-- ===== 스키마 =====
alter table public.programs add column if not exists discount_enabled boolean not null default true;
alter table public.offering_cancel_requests add column if not exists requested_at timestamptz not null default now();
create index if not exists offering_cancel_requests_offering_idx on public.offering_cancel_requests(offering_id, status);
create index if not exists payments_approved_idx on public.payments(approved_at);
create index if not exists refunds_created_idx on public.refunds(created_at);

-- ===== 할인 적용 여부(R23): 할인을 끈 프로그램은 일반(GENERAL)만 =====
-- 본문은 0011 의 정의와 같고, 프로그램의 discount_enabled 확인만 더했습니다.
create or replace function public.prepare_payment(p_hold uuid, p_items jsonb, p_amount int, p_order_id text)
returns public.holds
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_h public.holds%rowtype;
  v_type text;
  v_discount boolean;
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

  select p.type, p.discount_enabled into v_type, v_discount
    from public.offerings o join public.programs p on p.id = o.program_id where o.id = v_h.offering_id;

  -- 할인 선택 규칙(pricing.js validateDiscounts와 같음)
  select array_agg(coalesce(e->>'discountType', 'GENERAL') order by ord) into v_types
    from jsonb_array_elements(p_items) with ordinality t(e, ord);
  if cardinality(public.validate_discounts(v_types, v_type)) > 0 then
    perform public.hold_error('INVALID_DISCOUNT');
  end if;
  -- 할인을 적용하지 않는 프로그램(R23)
  if not v_discount and exists (select 1 from unnest(v_types) x where x <> 'GENERAL') then
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

-- 프로그램 등록/수정. 본문은 0010 과 같고 discount_enabled(boolean) 키를 더했습니다.
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
  if p ? 'discount_enabled' and jsonb_typeof(p -> 'discount_enabled') <> 'boolean' then perform public.hold_error('INVALID_REQUEST'); end if;
  if p ? 'details' and jsonb_typeof(p -> 'details') <> 'object' then perform public.hold_error('INVALID_REQUEST'); end if;

  if v_old.id is null then
    insert into public.programs(type, title, summary, description, venue, audience, is_public, discount_enabled,
                                poster_image, poster_tone, poster_series, poster_title, poster_sub, details)
    values (p ->> 'type', v_title, nullif(btrim(p ->> 'summary'), ''), nullif(btrim(p ->> 'description'), ''),
            nullif(btrim(p ->> 'venue'), ''), nullif(btrim(p ->> 'audience'), ''),
            coalesce((p ->> 'is_public')::boolean, false), coalesce((p ->> 'discount_enabled')::boolean, true),
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
      discount_enabled = case when p ? 'discount_enabled' then (p ->> 'discount_enabled')::boolean else discount_enabled end,
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

-- 회차 등록/수정. 본문은 0010 과 같고, 새 회차는 가격(prices)을 함께 받아야 합니다.
-- 가격이 없으면 INVALID_REQUEST 이고 details 에 PRICES_REQUIRED 를 담습니다(화면이 안내 문구를 고름).
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

  -- 가격 없는 회차는 결제 준비에서 막히므로 등록 때 받습니다.
  if v_old.id is null and (not (p ? 'prices') or jsonb_typeof(p -> 'prices') <> 'array' or jsonb_array_length(p -> 'prices') = 0) then
    raise exception using errcode = 'P0001', message = 'INVALID_REQUEST', detail = 'PRICES_REQUIRED',
      hint = '새 회차는 가격(prices)을 함께 보내야 합니다.';
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

-- ===== 예약 내역(운영/정산 조회) =====
-- 예약 단위 목록. 이름/휴대폰은 가리고, 검색은 서버에서 원래 값으로 합니다(가린 값만 돌려줌).
-- p_field: 'name'(예약자명 포함) | 'booking_no'(예약번호 포함) | 'phone4'(휴대폰 뒤 4자리), p_q 가 비면 검색하지 않음
-- p_discount: 'DISABLED'(장애인/동반) | 'MERIT'(국가유공자/동반) | 'MULTICHILD'
-- proof: NONE(할인 매수 없음) | TODO(확인 전 매수 있음) | DONE(모두 확인)
create or replace function public.staff_bookings(
  p_from date default null, p_to date default null, p_program uuid default null, p_offering uuid default null,
  p_statuses text[] default null, p_discount text default null, p_field text default null, p_q text default null)
returns table (booking_id uuid, booking_no text, status text, created_at timestamptz, cancelled_at timestamptz,
               user_id uuid, name_masked text, phone_masked text, offering_id uuid, starts_at timestamptz,
               program_id uuid, program_title text, program_type text, qty int, total_amount int, seats text,
               discounts text[], items jsonb, proof text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  perform public.require_staff(null);
  return query
    select b.id, b.booking_no, b.status, b.created_at, b.cancelled_at, b.user_id,
           public.mask_name(pr.name), public.mask_phone(pr.phone),
           o.id, o.starts_at, pg.id, pg.title, pg.type, h.qty, b.total_amount,
           (select string_agg(s.grade || '석 ' || s.row_label || '열 ' || s.seat_no, ', ' order by s.row_label, s.seat_no)
              from public.booking_items bi join public.seats s on s.id = bi.seat_id where bi.booking_id = b.id),
           coalesce((select array_agg(bi.discount_type order by bi.discount_type) from (
               select distinct bi2.discount_type from public.booking_items bi2
                where bi2.booking_id = b.id and bi2.discount_type not in ('GENERAL', 'NONE')) bi), '{}'::text[]),
           (select coalesce(jsonb_agg(jsonb_build_object('id', bi.id, 'seat_id', bi.seat_id, 'discount_type', bi.discount_type,
                                                        'amount', bi.amount, 'proof_checked', bi.proof_checked)
                                      order by bi.seat_id nulls last, bi.id), '[]'::jsonb)
              from public.booking_items bi where bi.booking_id = b.id),
           case
             when not exists (select 1 from public.booking_items bi where bi.booking_id = b.id
                                and bi.discount_type not in ('GENERAL', 'NONE')) then 'NONE'
             when exists (select 1 from public.booking_items bi where bi.booking_id = b.id
                            and bi.discount_type not in ('GENERAL', 'NONE') and not bi.proof_checked) then 'TODO'
             else 'DONE'
           end
      from public.bookings b
      join public.holds h on h.id = b.hold_id
      join public.offerings o on o.id = b.offering_id
      join public.programs pg on pg.id = o.program_id
      left join public.profiles pr on pr.id = b.user_id
     where (p_from is null or (b.created_at at time zone 'Asia/Seoul')::date >= p_from)
       and (p_to is null or (b.created_at at time zone 'Asia/Seoul')::date <= p_to)
       and (p_program is null or pg.id = p_program)
       and (p_offering is null or o.id = p_offering)
       and (p_statuses is null or cardinality(p_statuses) = 0 or b.status = any(p_statuses))
       and (p_discount is null or p_discount = '' or exists (
             select 1 from public.booking_items bi where bi.booking_id = b.id
                and bi.discount_type = any(case p_discount
                  when 'DISABLED' then array['DISABLED', 'DISABLED_COMPANION']
                  when 'MERIT' then array['MERIT', 'MERIT_COMPANION']
                  else array[p_discount] end)))
       and (v_q is null or case coalesce(p_field, 'name')
             when 'booking_no' then b.booking_no ilike '%' || v_q || '%'
             when 'phone4' then right(regexp_replace(coalesce(pr.phone, ''), '\D', '', 'g'), 4) = v_q
             else coalesce(pr.name, '') ilike '%' || v_q || '%'
           end)
     order by b.created_at desc, b.id;
end $$;

-- 할인 매수의 현장 증빙 확인 기록(운영 담당). 증빙 파일은 받지 않고 확인 여부만 남깁니다(SER-004).
create or replace function public.admin_mark_proof(p_item uuid, p_checked boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_item public.booking_items%rowtype;
  v_b public.bookings%rowtype;
begin
  perform public.require_staff(array['operator']);
  if p_checked is null then perform public.hold_error('INVALID_REQUEST'); end if;
  select * into v_item from public.booking_items where id = p_item;
  if not found then perform public.hold_error('NOT_FOUND'); end if;
  select * into v_b from public.bookings where id = v_item.booking_id for update;
  select * into v_item from public.booking_items where id = p_item for update;
  if v_item.discount_type in ('GENERAL', 'NONE') then perform public.hold_error('NO_DISCOUNT'); end if;
  if v_b.status <> 'CONFIRMED' then perform public.hold_error('BOOKING_CANCELLED'); end if;
  if v_item.proof_checked = p_checked then return; end if;
  update public.booking_items set proof_checked = p_checked where id = p_item;
  perform public.admin_log('PROOF_CHECK', 'booking_item', p_item::text, jsonb_build_object(
    'booking_id', v_b.id, 'booking_no', v_b.booking_no, 'discount_type', v_item.discount_type, 'checked', p_checked));
end $$;

-- ===== 대기자(운영 조회) =====
-- 진행 중(WAITING, PROMOTED) 신청에는 회차별 순번을 붙입니다(신청 순).
create or replace function public.staff_waitlist(p_offering uuid default null)
returns table (waitlist_id uuid, offering_id uuid, starts_at timestamptz, program_id uuid, program_title text,
               program_type text, user_id uuid, name_masked text, phone_masked text, qty int, allocated_qty int,
               status text, "position" int, created_at timestamptz, promoted_at timestamptz, deadline_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(array['operator']);
  return query
    select w.id, o.id, o.starts_at, pg.id, pg.title, pg.type, w.user_id,
           public.mask_name(pr.name), public.mask_phone(pr.phone), w.qty, w.allocated_qty, w.status,
           case when w.status in ('WAITING', 'PROMOTED') then
             (row_number() over (partition by w.offering_id, (w.status in ('WAITING', 'PROMOTED')) order by w.created_at, w.id))::int
           end,
           w.created_at, w.promoted_at, w.deadline_at
      from public.waitlist w
      join public.offerings o on o.id = w.offering_id
      join public.programs pg on pg.id = o.program_id
      left join public.profiles pr on pr.id = w.user_id
     where p_offering is null or w.offering_id = p_offering
     order by o.starts_at, w.offering_id, (w.status not in ('WAITING', 'PROMOTED')), w.created_at, w.id;
end $$;

-- ===== 결제/환불 내역(정산 조회) =====
-- 기간은 결제 승인일/환불일(KST 날짜). 결제 원본(raw)은 돌려주지 않습니다(admin_payment_raw 로만).
create or replace function public.staff_payments(p_from date default null, p_to date default null)
returns table (payment_id uuid, order_id text, payment_key text, booking_id uuid, booking_no text, booking_status text,
               program_id uuid, program_title text, program_type text, starts_at timestamptz,
               name_masked text, amount int, status text, approved_at timestamptz, refunded_amount int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(array['finance']);
  return query
    select p.id, p.order_id, p.payment_key, b.id, b.booking_no, b.status, pg.id, pg.title, pg.type, o.starts_at,
           public.mask_name(pr.name), p.amount, p.status, p.approved_at,
           coalesce((select sum(r.refund_amount) from public.refunds r where r.payment_id = p.id), 0)::int
      from public.payments p
      left join public.bookings b on b.id = p.booking_id
      left join public.offerings o on o.id = b.offering_id
      left join public.programs pg on pg.id = o.program_id
      left join public.profiles pr on pr.id = p.user_id
     where (p_from is null or (p.approved_at at time zone 'Asia/Seoul')::date >= p_from)
       and (p_to is null or (p.approved_at at time zone 'Asia/Seoul')::date <= p_to)
     order by p.approved_at desc nulls last, p.id;
end $$;

create or replace function public.staff_refunds(p_from date default null, p_to date default null)
returns table (refund_id uuid, payment_id uuid, payment_key text, booking_id uuid, booking_no text,
               program_id uuid, program_title text, program_type text, starts_at timestamptz, name_masked text,
               paid_amount int, refund_amount int, fee_amount int, rule text, reason text, pg_transaction_key text,
               created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(array['finance']);
  return query
    select r.id, p.id, p.payment_key, b.id, b.booking_no, pg.id, pg.title, pg.type, o.starts_at,
           public.mask_name(pr.name), p.amount, r.refund_amount, r.fee_amount, r.rule, r.reason, r.pg_transaction_key,
           r.created_at
      from public.refunds r
      join public.payments p on p.id = r.payment_id
      join public.bookings b on b.id = r.booking_id
      join public.offerings o on o.id = b.offering_id
      join public.programs pg on pg.id = o.program_id
      left join public.profiles pr on pr.id = b.user_id
     where (p_from is null or (r.created_at at time zone 'Asia/Seoul')::date >= p_from)
       and (p_to is null or (r.created_at at time zone 'Asia/Seoul')::date <= p_to)
     order by r.created_at desc, r.id;
end $$;

-- ===== 회차 취소 요청/승인(SFR-023) =====
-- 운영 담당 요청: 판매 중(OPEN) 회차만. 요청하면 회차는 CANCEL_REQUESTED 가 되어 새 결제가 막힙니다.
create or replace function public.admin_request_offering_cancel(p_offering uuid, p_reason text)
returns public.offering_cancel_requests
language plpgsql security definer set search_path = public as $$
declare
  v_off public.offerings%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_req public.offering_cancel_requests;
begin
  perform public.require_staff(array['operator']);
  if v_reason = '' or char_length(v_reason) > 500 then perform public.hold_error('INVALID_REASON'); end if;
  select * into v_off from public.offerings where id = p_offering for update;
  if not found then perform public.hold_error('NOT_FOUND'); end if;
  if v_off.status <> 'OPEN' then perform public.hold_error('OFFERING_CLOSED'); end if;

  update public.offerings set status = 'CANCEL_REQUESTED' where id = p_offering;
  insert into public.offering_cancel_requests(offering_id, requested_by, reason, status, requested_at)
    values (p_offering, auth.uid(), v_reason, 'REQUESTED', public.app_now())
    returning * into v_req;
  perform public.admin_log('OFFERING_CANCEL_REQUEST', 'offering', p_offering::text,
    jsonb_build_object('request_id', v_req.id, 'reason', v_reason));
  return v_req;
end $$;

-- 정산 담당 결정. 승인하면 화면이 payments-cancel(mode INSTITUTION)을 불러 회차를 CANCELLED 로 바꾸고 전액 환불합니다
-- (begin_offering_cancel 이 승인된 요청을 확인). 반려하면 회차를 다시 OPEN 으로 돌립니다.
create or replace function public.admin_decide_offering_cancel(p_req uuid, p_approve boolean)
returns public.offering_cancel_requests
language plpgsql security definer set search_path = public as $$
declare
  v_req public.offering_cancel_requests%rowtype;
  v_res public.offering_cancel_requests;
begin
  perform public.require_staff(array['finance']);
  if p_approve is null then perform public.hold_error('INVALID_REQUEST'); end if;
  select * into v_req from public.offering_cancel_requests where id = p_req;
  if not found then perform public.hold_error('NOT_FOUND'); end if;
  -- 잠금 순서: 회차 -> 취소 요청
  perform 1 from public.offerings where id = v_req.offering_id for update;
  select * into v_req from public.offering_cancel_requests where id = p_req for update;
  if v_req.status <> 'REQUESTED' then perform public.hold_error('ALREADY_DECIDED'); end if;

  update public.offering_cancel_requests
     set status = case when p_approve then 'APPROVED' else 'REJECTED' end,
         decided_by = auth.uid(), decided_at = public.app_now()
   where id = p_req
  returning * into v_res;
  if not p_approve then
    update public.offerings set status = 'OPEN' where id = v_req.offering_id and status = 'CANCEL_REQUESTED';
  end if;
  perform public.admin_log(case when p_approve then 'OFFERING_CANCEL_APPROVE' else 'OFFERING_CANCEL_REJECT' end,
    'offering_cancel_request', p_req::text, jsonb_build_object('offering_id', v_req.offering_id));
  return v_res;
end $$;

-- 취소 요청 목록(두 역할). 남은 확정 예약 수/금액, 기관 환불 건수, 결제 중 선점 수를 함께 돌려줍니다.
create or replace function public.staff_cancel_requests()
returns table (id uuid, offering_id uuid, starts_at timestamptz, offering_status text, program_id uuid,
               program_title text, program_type text, reason text, status text, requested_at timestamptz,
               requested_by_name text, decided_by_name text, decided_at timestamptz,
               confirmed_count int, confirmed_amount int, refunded_count int, refunded_amount int, pending_payments int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(null);
  return query
    select r.id, o.id, o.starts_at, o.status, pg.id, pg.title, pg.type, r.reason, r.status, r.requested_at,
           rq.name, dc.name, r.decided_at,
           (select count(*) from public.bookings b where b.offering_id = o.id and b.status = 'CONFIRMED')::int,
           (select coalesce(sum(b.total_amount), 0) from public.bookings b where b.offering_id = o.id and b.status = 'CONFIRMED')::int,
           (select count(*) from public.refunds f join public.bookings b on b.id = f.booking_id
             where b.offering_id = o.id and f.reason = 'INSTITUTION')::int,
           (select coalesce(sum(f.refund_amount), 0) from public.refunds f join public.bookings b on b.id = f.booking_id
             where b.offering_id = o.id and f.reason = 'INSTITUTION')::int,
           (select count(*) from public.holds h where h.offering_id = o.id and h.status = 'PAYING')::int
      from public.offering_cancel_requests r
      join public.offerings o on o.id = r.offering_id
      join public.programs pg on pg.id = o.program_id
      left join public.profiles rq on rq.id = r.requested_by
      left join public.profiles dc on dc.id = r.decided_by
     order by (r.status = 'REQUESTED') desc, r.requested_at desc, r.id;
end $$;

-- ===== 정산(SFR-024, AC-6) =====
-- KST 날짜 x 프로그램 단위 집계. 결제는 승인일, 환불은 환불일에 잡습니다.
--   paid_sum: 승인된 결제 금액 합계(이후 환불돼도 포함), refund_sum: 환불 금액 합계(사유 무관)
--   fee_sum: 회원 취소(USER)의 취소 수수료 합계(결제 금액에 이미 포함), net_sum = paid_sum - refund_sum
-- security_invoker 라 호출자 권한과 RLS 를 따르며, 화면 역할에는 열지 않고 staff_settlement(정산 담당)로만 읽습니다.
create or replace view public.settlement_daily with (security_invoker = true) as
with paid as (
  select (p.approved_at at time zone 'Asia/Seoul')::date as day, o.program_id,
         count(*)::int as n, sum(p.amount)::bigint as s
    from public.payments p
    join public.bookings b on b.id = p.booking_id
    join public.offerings o on o.id = b.offering_id
   where p.approved_at is not null
   group by 1, 2
), ref as (
  select (r.created_at at time zone 'Asia/Seoul')::date as day, o.program_id,
         count(*) filter (where r.refund_amount > 0)::int as n,
         sum(r.refund_amount)::bigint as s,
         count(*) filter (where r.reason = 'USER' and r.refund_amount > 0)::int as user_n,
         count(*) filter (where r.reason = 'INSTITUTION' and r.refund_amount > 0)::int as inst_n,
         count(*) filter (where r.reason = 'USER' and r.fee_amount > 0)::int as fee_n,
         coalesce(sum(r.fee_amount) filter (where r.reason = 'USER'), 0)::bigint as fee
    from public.refunds r
    join public.bookings b on b.id = r.booking_id
    join public.offerings o on o.id = b.offering_id
   group by 1, 2
)
select coalesce(paid.day, ref.day) as day,
       coalesce(paid.program_id, ref.program_id) as program_id,
       coalesce(paid.n, 0) as paid_count,
       coalesce(paid.s, 0) as paid_sum,
       coalesce(ref.n, 0) as refund_count,
       coalesce(ref.user_n, 0) as user_refund_count,
       coalesce(ref.inst_n, 0) as institution_refund_count,
       coalesce(ref.s, 0) as refund_sum,
       coalesce(ref.fee_n, 0) as fee_count,
       coalesce(ref.fee, 0) as fee_sum,
       coalesce(paid.s, 0) - coalesce(ref.s, 0) as net_sum
  from paid full join ref on ref.day = paid.day and ref.program_id = paid.program_id;

revoke all on public.settlement_daily from public, anon, authenticated;
grant select on public.settlement_daily to service_role;

create or replace function public.staff_settlement(p_from date default null, p_to date default null)
returns table (day date, program_id uuid, program_title text, program_type text, paid_count int, paid_sum bigint,
               refund_count int, user_refund_count int, institution_refund_count int, refund_sum bigint,
               fee_count int, fee_sum bigint, net_sum bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(array['finance']);
  return query
    select s.day, s.program_id, pg.title, pg.type, s.paid_count, s.paid_sum, s.refund_count, s.user_refund_count,
           s.institution_refund_count, s.refund_sum, s.fee_count, s.fee_sum, s.net_sum
      from public.settlement_daily s
      join public.programs pg on pg.id = s.program_id
     where (p_from is null or s.day >= p_from) and (p_to is null or s.day <= p_to)
     order by s.day, pg.title;
end $$;

-- ===== 권한 =====
revoke all on function public.staff_bookings(date, date, uuid, uuid, text[], text, text, text),
  public.admin_mark_proof(uuid, boolean), public.staff_waitlist(uuid), public.staff_payments(date, date),
  public.staff_refunds(date, date), public.admin_request_offering_cancel(uuid, text),
  public.admin_decide_offering_cancel(uuid, boolean), public.staff_cancel_requests(), public.staff_settlement(date, date)
  from public, anon, authenticated;
grant execute on function public.staff_bookings(date, date, uuid, uuid, text[], text, text, text),
  public.admin_mark_proof(uuid, boolean), public.staff_waitlist(uuid), public.staff_payments(date, date),
  public.staff_refunds(date, date), public.admin_request_offering_cancel(uuid, text),
  public.admin_decide_offering_cancel(uuid, boolean), public.staff_cancel_requests(), public.staff_settlement(date, date)
  to authenticated, service_role;
