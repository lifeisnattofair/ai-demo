-- 0004_booking.sql: 결제 준비, 결제 잠금, 예약 확정, 실패 시 되돌리기
-- 현재 시각은 app_now()만 씁니다(SFR-025). 금액은 원 단위 정수입니다.
-- 잠금 순서: (회차 ->) 선점 -> 대기 -> 좌석. 0003의 waitlist_close와 같은 순서라 교착이 없습니다.
-- prepare_payment만 화면(authenticated)이 부르고, 나머지는 payments-confirm 함수(service_role) 전용입니다.

-- 할인율(%). 값은 supabase/functions/_shared/policy/pricing.js 의 DISCOUNTS 와 같아야 합니다(테스트로 비교).
create or replace function public.discount_rate(p_type text) returns int
language sql immutable as $$
  select case p_type
    when 'GENERAL' then 0
    when 'DISABLED' then 50
    when 'DISABLED_COMPANION' then 50
    when 'MERIT' then 50
    when 'MERIT_COMPANION' then 50
    when 'MULTICHILD' then 30
  end
$$;

-- 결제 준비. 화면이 결제 단계에서 「결제하기」를 누를 때 부릅니다.
-- p_items = [{ seatId?, discountType }] (좌석제는 선점한 좌석마다 하나, 정원제는 수량만큼 seatId 없이)
-- 단가는 화면 값을 믿지 않고 offering_prices(좌석 등급별, 정원제는 등급 없음)에서 다시 읽어
-- holds.items = [{ seat_id, unitPrice, discountType }]로 저장합니다. 금액도 서버 계산과 같아야 합니다.
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
  select * into v_h from public.holds where id = p_hold for update;
  if not found or v_h.user_id is distinct from v_uid then perform public.hold_error('NOT_OWNER'); end if;
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
  if exists (select 1 from unnest(v_types) x where public.discount_rate(x) is null)
     or (v_type = 'COURSE' and v_types && array['DISABLED_COMPANION', 'MERIT_COMPANION'])
     or cardinality(array_positions(v_types, 'DISABLED')) > 1
     or cardinality(array_positions(v_types, 'MERIT')) > 1
     or (v_type <> 'COURSE' and (
           cardinality(array_positions(v_types, 'DISABLED_COMPANION')) > cardinality(array_positions(v_types, 'DISABLED'))
        or cardinality(array_positions(v_types, 'MERIT_COMPANION')) > cardinality(array_positions(v_types, 'MERIT'))))
  then
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

-- 결제 승인 직전 잠금. ACTIVE이고 만료 전이면 선점과 좌석을 PAYING으로 바꿉니다.
-- PAYING은 sweep_offering이 만료시키지 않으므로 승인 도중 좌석을 잃지 않습니다.
create or replace function public.lock_for_confirm(p_order_id text) returns public.holds
language plpgsql security definer set search_path = public as $$
declare
  v_h public.holds%rowtype;
  v_type text;
  v_changed int;
  v_res public.holds;
begin
  select * into v_h from public.holds where order_id = p_order_id for update;
  if not found then perform public.hold_error('ORDER_NOT_FOUND'); end if;
  if v_h.status = 'CONSUMED' then perform public.hold_error('ALREADY_CONFIRMED'); end if;
  if v_h.status = 'PAYING' then perform public.hold_error('PAYMENT_IN_PROGRESS'); end if;
  if v_h.status <> 'ACTIVE' or v_h.expires_at <= public.app_now() then perform public.hold_error('HOLD_EXPIRED'); end if;

  select p.type into v_type
    from public.offerings o join public.programs p on p.id = o.program_id where o.id = v_h.offering_id;

  update public.holds set status = 'PAYING' where id = v_h.id returning * into v_res;
  update public.inventory_seats set status = 'PAYING'
   where hold_id = v_h.id and status = 'HELD';
  get diagnostics v_changed = row_count;
  if v_type = 'PERFORMANCE' and v_changed <> v_h.qty then
    perform public.hold_error('HOLD_EXPIRED');  -- 좌석을 잃은 선점(예외로 전체 롤백)
  end if;
  return v_res;
end $$;

-- 예약 확정. 좌석 SOLD, 선점 CONSUMED(트리거가 승격 대기를 COMPLETED로), 예약, 항목, 결제 행, 알림을 한 트랜잭션에서 만듭니다.
-- 같은 주문을 다시 부르면(같은 paymentKey) 이미 만든 예약을 돌려줍니다.
create or replace function public.finalize_booking(p_order_id text, p_payment_key text, p_raw jsonb)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  v_h public.holds%rowtype;
  v_b public.bookings;
  v_type text;
  v_title text;
  v_when text;
  v_changed int;
  v_sum int;
  v_try int := 0;
begin
  if p_payment_key is null or p_payment_key = '' then perform public.hold_error('INVALID_REQUEST'); end if;
  select * into v_h from public.holds where order_id = p_order_id for update;
  if not found then perform public.hold_error('ORDER_NOT_FOUND'); end if;
  if v_h.status = 'CONSUMED' then
    select b.* into v_b from public.bookings b join public.payments p on p.booking_id = b.id
     where b.hold_id = v_h.id and p.payment_key = p_payment_key;
    if found then return v_b; end if;
    perform public.hold_error('ALREADY_CONFIRMED');
  end if;
  if v_h.status <> 'PAYING' then perform public.hold_error('HOLD_NOT_PAYING'); end if;
  if v_h.items is null or v_h.amount is null then perform public.hold_error('INVALID_REQUEST'); end if;
  if p_raw ? 'totalAmount' and (p_raw->'totalAmount') is distinct from to_jsonb(v_h.amount) then
    perform public.hold_error('AMOUNT_MISMATCH');
  end if;

  select p.type, p.title, to_char(o.starts_at at time zone 'Asia/Seoul', 'FMMM. FMDD. HH24:MI')
    into v_type, v_title, v_when
    from public.offerings o join public.programs p on p.id = o.program_id where o.id = v_h.offering_id;

  -- 선점 먼저(트리거가 대기를 갱신), 그다음 좌석
  update public.holds set status = 'CONSUMED' where id = v_h.id;
  update public.inventory_seats set status = 'SOLD', waitlist_id = null
   where hold_id = v_h.id and status = 'PAYING';
  get diagnostics v_changed = row_count;
  if v_type = 'PERFORMANCE' and v_changed <> v_h.qty then perform public.hold_error('SEAT_STATE_INVALID'); end if;

  -- 예약번호 B + 8자리. 드물게 겹치면 다시 뽑습니다.
  loop
    v_try := v_try + 1;
    begin
      insert into public.bookings(booking_no, user_id, offering_id, hold_id, status, total_amount, created_at)
        values ('B' || lpad(floor(random() * 100000000)::bigint::text, 8, '0'),
                v_h.user_id, v_h.offering_id, v_h.id, 'CONFIRMED', v_h.amount, public.app_now())
        returning * into v_b;
      exit;
    exception when unique_violation then
      if v_try >= 5 then raise; end if;
    end;
  end loop;

  insert into public.booking_items(booking_id, seat_id, discount_type, unit_price, discount_amount, amount)
  select v_b.id, (e->>'seat_id')::int, e->>'discountType', (e->>'unitPrice')::int,
         (e->>'unitPrice')::int * public.discount_rate(e->>'discountType') / 100,
         (e->>'unitPrice')::int - (e->>'unitPrice')::int * public.discount_rate(e->>'discountType') / 100
    from jsonb_array_elements(v_h.items) with ordinality t(e, ord)
   order by ord;
  select coalesce(sum(amount), 0) into v_sum from public.booking_items where booking_id = v_b.id;
  if v_sum <> v_h.amount then perform public.hold_error('AMOUNT_MISMATCH'); end if;

  insert into public.payments(order_id, payment_key, booking_id, user_id, amount, status, approved_at, raw)
    values (p_order_id, p_payment_key, v_b.id, v_h.user_id, v_h.amount, 'DONE', public.app_now(), p_raw);

  insert into public.notifications(user_id, kind, title, body, created_at) values (v_h.user_id, 'PAYMENT_DONE',
    '예약이 확정되었습니다',
    format('%s (%s) %s매(명) 예약이 확정되었습니다. 예약번호 %s, 결제 금액 %s원입니다.',
           v_title, v_when, v_h.qty, v_b.booking_no, to_char(v_h.amount, 'FM999,999,999,990')),
    public.app_now());
  return v_b;
end $$;

-- 승인 거절, 금액 불일치, 확정 실패 뒤 잠금을 풉니다. PAYING이 아니면 아무것도 하지 않습니다.
-- 만료 전이면 ACTIVE/HELD로 되돌려 다시 결제할 수 있게 하고, 만료 뒤면 EXPIRED/AVAILABLE로 풉니다.
-- 승격 선점(waitlist_id 있음)의 기한 처리는 대기 로직이 맡으므로 sweep_offering을 부릅니다.
create or replace function public.unlock_after_failure(p_order_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_h public.holds%rowtype;
begin
  select * into v_h from public.holds where order_id = p_order_id;
  if not found or v_h.status <> 'PAYING' then return; end if;
  if v_h.waitlist_id is not null then
    -- sweep_offering과 같은 순서(회차 -> 선점)로 잠급니다.
    perform 1 from public.offerings where id = v_h.offering_id for update;
  end if;
  select * into v_h from public.holds where id = v_h.id for update;
  if v_h.status <> 'PAYING' then return; end if;

  if v_h.expires_at > public.app_now() or v_h.waitlist_id is not null then
    update public.holds set status = 'ACTIVE' where id = v_h.id;
    update public.inventory_seats set status = 'HELD' where hold_id = v_h.id and status = 'PAYING';
    if v_h.waitlist_id is not null and v_h.expires_at <= public.app_now() then
      perform public.sweep_offering(v_h.offering_id);
    end if;
  else
    update public.holds set status = 'EXPIRED' where id = v_h.id;
    update public.inventory_seats set status = 'AVAILABLE', hold_id = null
     where hold_id = v_h.id and status = 'PAYING';
  end if;
end $$;

revoke all on function public.discount_rate(text),
  public.prepare_payment(uuid, jsonb, int, text), public.lock_for_confirm(text),
  public.finalize_booking(text, text, jsonb), public.unlock_after_failure(text)
  from public, anon, authenticated;
grant execute on function public.discount_rate(text) to anon, authenticated, service_role;
grant execute on function public.prepare_payment(uuid, jsonb, int, text) to authenticated, service_role;
grant execute on function public.lock_for_confirm(text), public.finalize_booking(text, text, jsonb),
  public.unlock_after_failure(text) to service_role;
