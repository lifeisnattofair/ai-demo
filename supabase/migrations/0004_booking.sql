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

-- 할인 선택 규칙. pricing.js validateDiscounts와 같은 판정을 하며(조합 전수 테스트로 비교) 오류 코드 배열을 돌려줍니다(빈 배열이면 통과).
create or replace function public.validate_discounts(p_types text[], p_product_type text) returns text[]
language plpgsql immutable as $$
declare
  v text[] := coalesce(p_types, '{}');
  n_d int := cardinality(array_positions(v, 'DISABLED'));
  n_dc int := cardinality(array_positions(v, 'DISABLED_COMPANION'));
  n_m int := cardinality(array_positions(v, 'MERIT'));
  n_mc int := cardinality(array_positions(v, 'MERIT_COMPANION'));
  errs text[] := '{}';
begin
  if exists (select 1 from unnest(v) x where public.discount_rate(x) is null) then
    return array['UNKNOWN_DISCOUNT'];
  end if;
  if p_product_type = 'COURSE' and n_dc + n_mc > 0 then errs := errs || 'COURSE_NO_COMPANION'::text; end if;
  if n_d > 1 then errs := errs || 'DISABLED_OVER_LIMIT'::text; end if;
  if n_m > 1 then errs := errs || 'MERIT_OVER_LIMIT'::text; end if;
  if p_product_type is distinct from 'COURSE' and (n_dc > n_d or n_mc > n_m) then
    errs := errs || 'COMPANION_WITHOUT_MAIN'::text;
  end if;
  return errs;
end $$;

-- 결제 중(PAYING)이 된 시각. 오래된 PAYING은 sweep_offering이 정리합니다.
alter table public.holds add column if not exists paying_since timestamptz;

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

-- PAYING이 5분 넘게 이어졌는지. paying_since가 없으면(수동으로 만든 상태 등) 오래된 것으로 보지 않습니다.
create or replace function public.paying_is_stale(p_since timestamptz) returns boolean
language sql stable as $$
  select p_since is not null and p_since <= public.app_now() - interval '5 minutes'
$$;

-- 이 주문에 승인 완료(DONE)된 모의 결제가 있는지
create or replace function public.order_has_charge(p_order_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pg_mock_transactions where order_id = p_order_id and status = 'DONE')
$$;

-- 결제 승인 직전 잠금. ACTIVE이고 만료 전이면 선점과 좌석을 PAYING으로 바꿉니다.
-- PAYING은 sweep_offering이 만료시키지 않으므로 승인 도중 좌석을 잃지 않습니다.
create or replace function public.lock_for_confirm(p_order_id text) returns public.holds
language plpgsql security definer set search_path = public as $$
declare
  v_h public.holds%rowtype;
  v_type text;
  v_changed int;
  v_res public.holds;
  v_off_status text;
begin
  select * into v_h from public.holds where order_id = p_order_id;
  if not found then perform public.hold_error('ORDER_NOT_FOUND'); end if;
  -- 잠금 순서: 회차 -> 선점. begin_offering_cancel(회차를 잠그고 CANCELLED)과 직렬화됩니다.
  select status into v_off_status from public.offerings where id = v_h.offering_id for update;
  select * into v_h from public.holds where order_id = p_order_id for update;
  if v_h.status = 'CONSUMED' then perform public.hold_error('ALREADY_CONFIRMED'); end if;
  if v_h.status = 'PAYING' then
    -- 승인은 끝났는데 확정 결과를 모르는 채 5분 넘게 남은 결제는 다시 들어와 확정을 이어 갈 수 있습니다.
    if public.paying_is_stale(v_h.paying_since) and public.order_has_charge(p_order_id) then
      update public.holds set paying_since = public.app_now() where id = v_h.id returning * into v_res;
      return v_res;
    end if;
    perform public.hold_error('PAYMENT_IN_PROGRESS');
  end if;
  -- 새 승인(ACTIVE -> PAYING)은 판매 중인 회차에서만. 위의 승인 완료 결제 재진입은 확정까지 보내고 일괄 취소가 환불합니다.
  if v_off_status is distinct from 'OPEN' then perform public.hold_error('NOT_ON_SALE'); end if;
  if v_h.status <> 'ACTIVE' or v_h.expires_at <= public.app_now() then perform public.hold_error('HOLD_EXPIRED'); end if;

  select p.type into v_type
    from public.offerings o join public.programs p on p.id = o.program_id where o.id = v_h.offering_id;

  update public.holds set status = 'PAYING', paying_since = public.app_now() where id = v_h.id returning * into v_res;
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
  select * into v_h from public.holds where order_id = p_order_id;
  if not found then perform public.hold_error('ORDER_NOT_FOUND'); end if;
  -- 잠금 순서(R15): 회차 -> 선점. 예약 insert의 FK가 회차에 거는 KEY SHARE보다 먼저 회차를 잡아
  -- 같은 주문의 lock_for_confirm(회차 -> 선점)과 교착하지 않습니다.
  perform 1 from public.offerings where id = v_h.offering_id for update;
  select * into v_h from public.holds where order_id = p_order_id for update;
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
  update public.holds set status = 'CONSUMED', paying_since = null where id = v_h.id;
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
-- PAYING 선점 하나를 되돌립니다(내부 전용). 선점 행을 잠근 뒤 좌석을 바꿉니다(선점 -> 좌석).
-- 만료 전이거나 승격 선점이면 ACTIVE/HELD(승격 선점의 기한 처리는 sweep_offering의 대기 로직이 맡음),
-- 만료 뒤 일반 선점이면 EXPIRED/AVAILABLE. 실제로 바꿨으면 true.
create or replace function public.revert_paying(p_hold uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_h public.holds%rowtype;
begin
  select * into v_h from public.holds where id = p_hold for update;
  if not found or v_h.status <> 'PAYING' then return false; end if;
  -- 취소된 회차는 판매가 닫혔으므로 되살리지 않고 풉니다(대기도 begin_offering_cancel이 이미 종료).
  if (select status from public.offerings where id = v_h.offering_id) = 'CANCELLED' then
    update public.holds set status = 'EXPIRED', paying_since = null where id = v_h.id;
    update public.inventory_seats set status = 'AVAILABLE', hold_id = null, waitlist_id = null
     where hold_id = v_h.id and status = 'PAYING';
    return true;
  end if;
  if v_h.expires_at > public.app_now() or v_h.waitlist_id is not null then
    update public.holds set status = 'ACTIVE', paying_since = null where id = v_h.id;
    update public.inventory_seats set status = 'HELD' where hold_id = v_h.id and status = 'PAYING';
  else
    update public.holds set status = 'EXPIRED', paying_since = null where id = v_h.id;
    update public.inventory_seats set status = 'AVAILABLE', hold_id = null
     where hold_id = v_h.id and status = 'PAYING';
  end if;
  return true;
end $$;

create or replace function public.unlock_after_failure(p_order_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_h public.holds%rowtype;
begin
  select * into v_h from public.holds where order_id = p_order_id;
  if not found or v_h.status <> 'PAYING' then return; end if;
  -- 항상 회차 -> 선점 순서로 잠급니다(sweep_offering, lock_for_confirm과 같음). revert_paying이 읽는 회차 상태도 이 잠금 아래에서 봅니다.
  perform 1 from public.offerings where id = v_h.offering_id for update;
  if public.revert_paying(v_h.id) and v_h.waitlist_id is not null and v_h.expires_at <= public.app_now() then
    perform public.sweep_offering(v_h.offering_id);
  end if;
end $$;

-- 0003의 sweep_offering에 0) 오래된 결제 중(PAYING) 정리를 앞에 붙입니다.
-- PAYING이 5분 넘게 이어졌는데 승인 완료된 결제가 없으면 unlock_after_failure와 같은 규칙으로 되돌립니다.
-- 승인 완료된 결제가 있으면 그대로 둡니다(같은 주문으로 다시 승인 요청하면 멱등하게 확정됨).
-- 잠금 순서: 회차 -> 선점 -> 대기 -> 좌석.
create or replace function public.sweep_offering(p_offering uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_starts timestamptz;
  v_w public.waitlist%rowtype;
  v_hid uuid;
begin
  -- 0) 오래된 PAYING
  if exists (
    select 1 from public.holds h
     where h.offering_id = p_offering and h.status = 'PAYING'
       and public.paying_is_stale(h.paying_since) and not public.order_has_charge(h.order_id)
  ) then
    perform 1 from public.offerings where id = p_offering for update;
    for v_hid in
      select h.id from public.holds h
       where h.offering_id = p_offering and h.status = 'PAYING'
         and public.paying_is_stale(h.paying_since) and not public.order_has_charge(h.order_id)
       order by h.id
    loop
      perform public.revert_paying(v_hid);
    end loop;
  end if;

  -- 1) 처리할 대기가 있을 때만 회차 행을 잠급니다.
  if exists (
    select 1 from public.waitlist w join public.offerings o on o.id = w.offering_id
     where w.offering_id = p_offering
       and ((w.status = 'PROMOTED' and w.deadline_at <= public.app_now())
            or (w.status = 'WAITING' and w.allocated_qty > 0 and public.d_day(o.starts_at) <= 2))
  ) then
    select starts_at into v_starts from public.offerings where id = p_offering for update;

    -- 결제 기한 만료. 결제 진행 중(PAYING) 선점이 있으면 결제 결과를 기다립니다.
    -- 기한 만료 시점이 D-2 이내면 RELEASED(일반 판매), 아니면 EXPIRED(다음 순번)입니다.
    for v_w in
      select * from public.waitlist w
       where w.offering_id = p_offering and w.status = 'PROMOTED' and w.deadline_at <= public.app_now()
         and not exists (select 1 from public.holds h where h.waitlist_id = w.id and h.status = 'PAYING')
       order by w.created_at, w.id
    loop
      if public.waitlist_close(v_w.id,
        case when ((v_starts at time zone 'Asia/Seoul')::date - (v_w.deadline_at at time zone 'Asia/Seoul')::date) <= 2
             then 'RELEASED' else 'EXPIRED' end,
        'EXPIRED') then
        perform public.waitlist_notify(v_w.id, 'WAIT_EXPIRED');
      end if;
    end loop;

    -- D-2부터는 모으던 배정분도 일반 판매로 풉니다.
    if public.d_day(v_starts) <= 2 then
      for v_w in
        select * from public.waitlist
         where offering_id = p_offering and status = 'WAITING' and allocated_qty > 0
         order by created_at, id
      loop
        if public.waitlist_close(v_w.id, 'RELEASED', 'EXPIRED') then
          perform public.waitlist_notify(v_w.id, 'WAIT_EXPIRED');
        end if;
      end loop;
    end if;
  end if;

  -- 2) 만료된 일반 선점(Task 4). 승격 선점은 1)에서 대기 기한과 함께 처리합니다.
  with expired as (
    update public.holds h
       set status = 'EXPIRED'
     where h.offering_id = p_offering and h.status = 'ACTIVE' and h.expires_at <= public.app_now()
       and h.waitlist_id is null
    returning h.id
  )
  update public.inventory_seats s
     set status = 'AVAILABLE', hold_id = null
   where s.offering_id = p_offering and s.status = 'HELD' and s.hold_id in (select id from expired);
end $$;

revoke all on function public.discount_rate(text), public.validate_discounts(text[], text),
  public.paying_is_stale(timestamptz), public.order_has_charge(text), public.revert_paying(uuid),
  public.prepare_payment(uuid, jsonb, int, text), public.lock_for_confirm(text),
  public.finalize_booking(text, text, jsonb), public.unlock_after_failure(text), public.sweep_offering(uuid)
  from public, anon, authenticated;
grant execute on function public.discount_rate(text), public.validate_discounts(text[], text)
  to anon, authenticated, service_role;
grant execute on function public.sweep_offering(uuid) to authenticated, service_role;
grant execute on function public.prepare_payment(uuid, jsonb, int, text) to authenticated, service_role;
grant execute on function public.lock_for_confirm(text), public.finalize_booking(text, text, jsonb),
  public.unlock_after_failure(text) to service_role;

-- ===== Task 7: 취소, 환불, 기관 일괄 취소, 웹훅 =====
-- 모두 payments-cancel / payments-webhook 함수(service_role) 전용입니다.
-- 잠금 순서: 회차 -> (예약) -> 선점 -> 대기 -> 좌석. release_inventory/sweep_offering과 같은 순서입니다.

-- 취소 진행 표시(동시 취소 방지). 5분이 지나면 다시 잡을 수 있습니다.
alter table public.bookings add column if not exists cancel_started_at timestamptz;
-- 처음 취소 시도의 환불 규칙. PG 취소 뒤 확정이 실패하면 재시도는 지금 정책이 아니라 이 규칙과 PG 기록으로 확정합니다.
-- pg.cancel 전에 begin_cancel이 남기고 abort_cancel은 지우지 않습니다(이 값이 있어야 재시도가 PG를 조회).
alter table public.bookings add column if not exists cancel_rule text;

-- 환불 계산에 필요한 정보. 기준일은 회차 시작(정규 강좌는 첫 회).
-- {productType, paidAmount, baseAt, lessonStarts, paymentKey, status, ownerId, offeringId, offeringStatus, refund, cancelRule}
-- refund는 이미 취소된 예약의 기록된 환불 결과({refundAmount, feeAmount, rule}) 또는 null입니다.
create or replace function public.cancel_context(p_booking uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
    'productType', p.type,
    'paidAmount', coalesce(pay.amount, b.total_amount),
    'baseAt', coalesce((select min(l.starts_at) from public.course_lessons l where l.offering_id = o.id), o.starts_at),
    'lessonStarts', case when p.type = 'COURSE' then
      (select jsonb_agg(l.starts_at order by l.starts_at, l.seq) from public.course_lessons l where l.offering_id = o.id) end,
    'paymentKey', pay.payment_key,
    'status', b.status,
    'ownerId', b.user_id,
    'offeringId', o.id,
    'offeringStatus', o.status,
    'cancelRule', b.cancel_rule,
    'refund', (select jsonb_build_object('refundAmount', r.refund_amount, 'feeAmount', r.fee_amount, 'rule', r.rule)
                 from public.refunds r where r.booking_id = b.id order by r.created_at desc, r.id limit 1))
    into v
    from public.bookings b
    join public.offerings o on o.id = b.offering_id
    join public.programs p on p.id = o.program_id
    left join public.payments pay on pay.booking_id = b.id
   where b.id = p_booking;
  if v is null then perform public.hold_error('BOOKING_NOT_FOUND'); end if;
  return v;
end $$;

-- 취소 시작 표시. CONFIRMED이고 다른 취소가 진행 중이 아닐 때만 true.
-- p_rule이 있으면(PG 취소 전 첫 시도) cancel_rule을 그 값으로, null이면(PG 기록으로 이어 확정) 기존 값을 둡니다.
drop function if exists public.begin_cancel(uuid);
create or replace function public.begin_cancel(p_booking uuid, p_rule text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.bookings set cancel_started_at = public.app_now(), cancel_rule = coalesce(p_rule, cancel_rule)
   where id = p_booking and status = 'CONFIRMED'
     and (cancel_started_at is null or cancel_started_at <= public.app_now() - interval '5 minutes');
  return found;
end $$;

create or replace function public.abort_cancel(p_booking uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.bookings set cancel_started_at = null where id = p_booking and status = 'CONFIRMED';
end $$;

-- 취소 확정. 예약 CANCELLED, 환불 기록, 결제 상태, 재고 반환, 알림을 한 트랜잭션에서 처리합니다.
-- 이미 CANCELLED면 아무것도 바꾸지 않고 예약을 돌려줍니다(멱등).
-- 재고: 판매 중인 회차는 release_inventory(대기 FIFO 배정, D-2 이내면 일반 판매)로, 취소된 회차(기관 취소)는
-- 판매가 닫혔으므로 대기에 배정하지 않고 좌석만 비웁니다.
-- 알림: 회원 취소 BOOKING_CANCELLED, 기관 취소 OFFERING_CANCELLED.
create or replace function public.finalize_cancel(p_booking uuid, p_refund int, p_fee int, p_rule text, p_reason text, p_tx_key text)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  v_b public.bookings%rowtype;
  v_off public.offerings%rowtype;
  v_pay public.payments%rowtype;
  v_type text;
  v_title text;
  v_when text;
  v_seats int[];
  v_qty int;
  v_res public.bookings;
begin
  select * into v_b from public.bookings where id = p_booking;
  if not found then perform public.hold_error('BOOKING_NOT_FOUND'); end if;
  select * into v_off from public.offerings where id = v_b.offering_id for update;
  select * into v_b from public.bookings where id = p_booking for update;
  if v_b.status = 'CANCELLED' then return v_b; end if;

  if p_reason is null or p_reason not in ('USER', 'INSTITUTION', 'CONFLICT') then
    perform public.hold_error('INVALID_REQUEST');
  end if;
  if p_reason = 'INSTITUTION' and v_off.status <> 'CANCELLED' then perform public.hold_error('OFFERING_NOT_CANCELLED'); end if;
  select * into v_pay from public.payments where booking_id = v_b.id for update;
  if not found then perform public.hold_error('PAYMENT_NOT_FOUND'); end if;
  if p_refund is null or p_fee is null or p_refund < 0 or p_fee < 0 or p_refund + p_fee <> v_pay.amount then
    perform public.hold_error('AMOUNT_MISMATCH');
  end if;
  if p_refund > 0 and coalesce(p_tx_key, '') = '' then perform public.hold_error('INVALID_REQUEST'); end if;

  -- release_inventory가 확정 수에서 빼고 세도록 예약을 먼저 CANCELLED로 바꿉니다.
  update public.bookings set status = 'CANCELLED', cancelled_at = public.app_now(), cancel_started_at = null
   where id = v_b.id returning * into v_res;

  insert into public.refunds(payment_id, booking_id, refund_amount, fee_amount, rule, reason, pg_transaction_key, created_at)
    values (v_pay.id, v_b.id, p_refund, p_fee, p_rule, p_reason, nullif(p_tx_key, ''), public.app_now());
  if p_refund > 0 then
    update public.payments
       set status = case when p_refund = v_pay.amount then 'CANCELED' else 'PARTIAL_CANCELED' end
     where id = v_pay.id;
  end if;

  select p.type, p.title, to_char(v_off.starts_at at time zone 'Asia/Seoul', 'FMMM. FMDD. HH24:MI')
    into v_type, v_title, v_when
    from public.programs p where p.id = v_off.program_id;

  if v_type = 'PERFORMANCE' then
    select coalesce(array_agg(seat_id order by seat_id), '{}') into v_seats
      from public.booking_items where booking_id = v_b.id and seat_id is not null;
  else
    select qty into v_qty from public.holds where id = v_b.hold_id;
  end if;

  if v_off.status = 'CANCELLED' then
    if v_type = 'PERFORMANCE' then
      perform 1 from public.inventory_seats
       where offering_id = v_off.id and seat_id = any(v_seats) and status = 'SOLD'
       order by seat_id for update;
      update public.inventory_seats set status = 'AVAILABLE', hold_id = null, waitlist_id = null
       where offering_id = v_off.id and seat_id = any(v_seats) and status = 'SOLD';
    end if;
  else
    perform public.release_inventory(v_off.id, case when v_type = 'PERFORMANCE' then v_seats end, v_qty);
  end if;

  if p_reason = 'INSTITUTION' then
    insert into public.notifications(user_id, kind, title, body, created_at) values (v_b.user_id, 'OFFERING_CANCELLED',
      '회차가 취소되어 전액 환불했습니다',
      format('기관 사정으로 %s (%s) 회차가 취소되었습니다. 예약번호 %s의 결제 금액 %s원을 전액 환불했습니다. 카드사에 따라 환불 반영까지 며칠 걸릴 수 있습니다.',
             v_title, v_when, v_b.booking_no, to_char(p_refund, 'FM999,999,999,990')),
      public.app_now());
  else
    insert into public.notifications(user_id, kind, title, body, created_at) values (v_b.user_id, 'BOOKING_CANCELLED',
      '예약이 취소되었습니다',
      format('%s (%s) 예약(예약번호 %s)이 취소되었습니다. 환불 금액 %s원, 취소 수수료 %s원입니다.',
             v_title, v_when, v_b.booking_no, to_char(p_refund, 'FM999,999,999,990'), to_char(p_fee, 'FM999,999,999,990')),
      public.app_now());
  end if;
  return v_res;
end $$;

-- 기관 사유 회차 일괄 취소 시작. 정산 담당(finance)이고 승인된 취소 요청이 있어야 합니다.
-- 회차를 CANCELLED로 바꾸고 판매를 닫습니다: 유효 선점 해제, 진행 중인 대기 종료(알림), 선점/배정 좌석 비우기.
-- 돌려주는 bookingIds(아직 CONFIRMED인 예약)를 호출자가 하나씩 기관 취소합니다. 다시 불러도 안전합니다.
create or replace function public.begin_offering_cancel(p_offering uuid, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_off public.offerings%rowtype;
  v_title text;
  v_when text;
  v_w record;
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'finance') then
    perform public.hold_error('FORBIDDEN');
  end if;
  select * into v_off from public.offerings where id = p_offering for update;
  if not found then perform public.hold_error('OFFERING_NOT_FOUND'); end if;
  if not exists (select 1 from public.offering_cancel_requests where offering_id = p_offering and status = 'APPROVED') then
    perform public.hold_error('CANCEL_NOT_APPROVED');
  end if;

  if v_off.status <> 'CANCELLED' then
    update public.offerings set status = 'CANCELLED' where id = p_offering;
    select p.title, to_char(v_off.starts_at at time zone 'Asia/Seoul', 'FMMM. FMDD. HH24:MI') into v_title, v_when
      from public.programs p where p.id = v_off.program_id;

    -- 선점 -> 대기 -> 좌석 순서. 결제 중(PAYING) 선점은 결과를 기다립니다(확정되면 다시 불러 환불).
    perform 1 from public.holds where offering_id = p_offering and status = 'ACTIVE' order by id for update;
    update public.holds set status = 'RELEASED' where offering_id = p_offering and status = 'ACTIVE';

    for v_w in
      select * from public.waitlist
       where offering_id = p_offering and status in ('WAITING', 'PROMOTED')
       order by created_at, id
       for update
    loop
      update public.waitlist set status = 'CANCELLED' where id = v_w.id;
      insert into public.notifications(user_id, kind, title, body, created_at) values (v_w.user_id, 'OFFERING_CANCELLED',
        '대기 신청하신 회차가 취소되었습니다',
        format('기관 사정으로 %s (%s) 회차가 취소되어 대기 신청이 종료되었습니다. 다른 회차를 확인해 주세요.', v_title, v_when),
        public.app_now());
    end loop;

    perform 1 from public.inventory_seats
     where offering_id = p_offering and status in ('HELD', 'WAIT_ALLOCATED') order by seat_id for update;
    update public.inventory_seats set status = 'AVAILABLE', hold_id = null, waitlist_id = null
     where offering_id = p_offering and status in ('HELD', 'WAIT_ALLOCATED');

    insert into public.admin_audit(actor_id, action, target_type, target_id, detail, at)
      values (p_actor, 'OFFERING_CANCEL', 'offering', p_offering::text, jsonb_build_object('previousStatus', v_off.status),
              public.app_now());
  end if;

  -- pendingPayments: 결제 중(PAYING) 선점 수. 승인되면 확정되므로 호출자가 나중에 다시 불러 환불합니다.
  return jsonb_build_object('offeringId', p_offering, 'bookingIds', coalesce((
    select jsonb_agg(id order by created_at, id) from public.bookings
     where offering_id = p_offering and status = 'CONFIRMED'), '[]'::jsonb),
    'pendingPayments', (select count(*) from public.holds where offering_id = p_offering and status = 'PAYING'));
end $$;

-- 웹훅 반영. 기대 상태(p_expected)일 때만 결제 상태를 바꿉니다. 바꿨으면 true.
create or replace function public.apply_payment_status(p_payment_key text, p_status text, p_expected text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_status is null or p_status not in ('DONE', 'CANCELED', 'PARTIAL_CANCELED') then
    perform public.hold_error('INVALID_REQUEST');
  end if;
  update public.payments set status = p_status
   where payment_key = p_payment_key and status = p_expected and status <> p_status;
  return found;
end $$;

revoke all on function public.cancel_context(uuid), public.begin_cancel(uuid, text), public.abort_cancel(uuid),
  public.finalize_cancel(uuid, int, int, text, text, text), public.begin_offering_cancel(uuid, uuid),
  public.apply_payment_status(text, text, text)
  from public, anon, authenticated;
grant execute on function public.cancel_context(uuid), public.begin_cancel(uuid, text), public.abort_cancel(uuid),
  public.finalize_cancel(uuid, int, int, text, text, text), public.begin_offering_cancel(uuid, uuid),
  public.apply_payment_status(text, text, text)
  to service_role;
