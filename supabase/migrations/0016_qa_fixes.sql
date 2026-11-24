-- 0016_qa_fixes.sql: 브라우저 검수 결함 D-08, D-09, D-11, D-14 (docs/qa/2026-11-24-qa-browser-results.md)
-- 여러 번 적용해도 같은 결과가 나오도록 create or replace, if not exists 로 씁니다.

-- 상품 유형별 수량 단위(공연 매, 체험과 강좌 명). 알림 문구에 씁니다(D-11).
create or replace function public.qty_unit(p_type text) returns text
language sql immutable set search_path = public as $$
  select case when p_type = 'PERFORMANCE' then '매' else '명' end
$$;

-- D-08: 시연 데이터 초기화는 처음 시드(seed.sql)와 같이 app_now() 의 KST 달력 날짜 자정을 기준으로 삼습니다.
-- 회차 시각은 seed_demo 의 고정 시각(공연 19:30/15:00, 체험 14:00, 강좌 19:00/10:30)이라 초기화한 시각과 무관합니다.
create or replace function public.admin_reset_demo() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_env text := public.app_env();
  v_base timestamptz;
  v_accounts int;
begin
  perform public.require_staff(array['operator']);
  if v_env not in ('demo', 'local') then perform public.hold_error('NOT_ALLOWED_IN_ENV'); end if;
  v_base := date_trunc('day', public.app_now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  perform public.seed_demo(v_base);
  v_accounts := public.restore_demo_accounts();  -- 0015
  perform public.admin_log('RESET_DEMO', 'system', 'demo', jsonb_build_object('base', v_base, 'env', v_env, 'accounts', v_accounts));
  return jsonb_build_object('base', v_base);
end $$;

-- D-11: 대기 승격, 해제 알림의 단위와 표현을 상품 유형에 맞춥니다.
-- 공연은 매/좌석/공연, 체험은 명/자리/회차, 정규 강좌는 명/자리/개강입니다.
create or replace function public.waitlist_notify(p_waitlist uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_w public.waitlist%rowtype;
  v_title text;
  v_type text;
  v_when text;
  v_alloc text;
  v_base text;
  v_left text;
begin
  select * into v_w from public.waitlist where id = p_waitlist;
  select p.title, p.type, to_char(o.starts_at at time zone 'Asia/Seoul', 'FMMM. FMDD. HH24:MI')
    into v_title, v_type, v_when
    from public.offerings o join public.programs p on p.id = o.program_id where o.id = v_w.offering_id;
  v_alloc := case when v_type = 'PERFORMANCE' then format('좌석 %s매가', v_w.qty) else format('%s명 자리가', v_w.qty) end;
  v_base := case v_type when 'PERFORMANCE' then '공연' when 'EXPERIENCE' then '회차' else '개강' end;
  v_left := case when v_type = 'PERFORMANCE' then '남은 좌석이' else '남은 자리가' end;
  if p_kind = 'WAIT_PROMOTED' then
    insert into public.notifications(user_id, kind, title, body) values (v_w.user_id, p_kind,
      '대기하신 예약을 결제하실 수 있습니다',
      format('%s (%s) %s 배정되었습니다. %s까지 결제해 주세요. 기한이 지나면 다음 순번으로 넘어갑니다.',
             v_title, v_when, v_alloc,
             to_char(v_w.deadline_at at time zone 'Asia/Seoul', 'FMMM. FMDD. HH24:MI')));
  else
    insert into public.notifications(user_id, kind, title, body) values (v_w.user_id, p_kind,
      '대기 배정이 종료되었습니다',
      format('%s (%s) 대기 배정분이 결제 기한 경과 또는 %s 2일 전 기준에 따라 해제되었습니다. %s 있으면 일반 예매로 신청해 주세요.',
             v_title, v_when, v_base, v_left));
  end if;
end $$;

-- D-11: 예약 확정 알림의 단위. 0004 의 finalize_booking 과 같고 알림 문구만 다릅니다.
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
    format('%s (%s) %s%s 예약이 확정되었습니다. 예약번호 %s, 결제 금액 %s원입니다.',
           v_title, v_when, v_h.qty, public.qty_unit(v_type), v_b.booking_no, to_char(v_h.amount, 'FM999,999,999,990')),
    public.app_now());
  return v_b;
end $$;

-- D-09: 처리할 항목이 있는 회차만 골라 sweep_offering 을 부릅니다.
-- 대상은 기한이 지난 대기 승격, D-2 에 일반 판매로 풀어야 할 배정분, 오래된 결제 중(PAYING) 선점입니다.
-- 화면이 내 대기 신청, 알림, 상세/선택, 관리자 대기자 관리/대시보드를 열 때 부르고, pg_cron 이 1분마다도 부릅니다.
-- 처리할 것이 없으면 부분 색인 조회로 끝납니다. 잠금은 sweep_offering 이 회차 -> 선점 -> 대기 -> 좌석 순서로 잡습니다.
create index if not exists waitlist_promoted_deadline_idx on public.waitlist(deadline_at) where status = 'PROMOTED';
create index if not exists waitlist_waiting_alloc_idx on public.waitlist(offering_id) where status = 'WAITING' and allocated_qty > 0;
create index if not exists holds_paying_idx on public.holds(paying_since) where status = 'PAYING';

create or replace function public.sweep_due_offerings() returns int
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
       where h.status = 'PAYING' and public.paying_is_stale(h.paying_since)
    ) x
    order by x.offering_id
  loop
    perform public.sweep_offering(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function public.sweep_due_offerings() from public, anon, authenticated;
grant execute on function public.sweep_due_offerings() to authenticated, service_role;
revoke all on function public.qty_unit(text) from public, anon, authenticated;

-- 1분마다 처리(pg_cron 이 있는 환경만). 없으면 화면의 조회 경로에서만 처리합니다.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('sweep-due-offerings', '* * * * *', 'select public.sweep_due_offerings()');
    exception when others then
      raise notice 'pg_cron 예약을 건너뜁니다: %', sqlerrm;
    end;
  end if;
end $$;

-- D-14: 작업 이력의 대상을 구분할 수 있게 표시용 이름을 함께 돌려줍니다.
-- 회원은 가린 이름과 ID 끝 4자리, 예약 매수와 결제는 예약번호, 프로그램과 회차는 이름과 일시입니다.
drop function if exists public.staff_audit(timestamptz, timestamptz, uuid, text, int);
create function public.staff_audit(p_from timestamptz default null, p_to timestamptz default null,
                                   p_actor uuid default null, p_action text default null, p_limit int default 1000)
returns table (id uuid, at timestamptz, actor_id uuid, actor_name_masked text, actor_role text,
               action text, target_type text, target_id text, target_label text, detail jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(null);
  return query
    select a.id, a.at, a.actor_id, public.mask_name(p.name), p.role, a.action, a.target_type, a.target_id,
           case a.target_type
             when 'profile' then coalesce((select public.mask_name(t.name) from public.profiles t where t.id::text = a.target_id), '-')
                                 || ' (' || right(a.target_id, 4) || ')'
             when 'booking_item' then (select b.booking_no from public.booking_items i join public.bookings b on b.id = i.booking_id
                                        where i.id::text = a.target_id)
             when 'payment' then (select coalesce(b.booking_no, y.order_id) from public.payments y
                                    left join public.bookings b on b.id = y.booking_id where y.id::text = a.target_id)
             when 'program' then (select g.title from public.programs g where g.id::text = a.target_id)
             when 'offering' then (select g.title || ' ' || to_char(o.starts_at at time zone 'Asia/Seoul', 'FMMM. FMDD. HH24:MI')
                                     from public.offerings o join public.programs g on g.id = o.program_id where o.id::text = a.target_id)
           end,
           a.detail
      from public.admin_audit a left join public.profiles p on p.id = a.actor_id
     where (p_from is null or a.at >= p_from) and (p_to is null or a.at < p_to)
       and (p_actor is null or a.actor_id = p_actor) and (p_action is null or a.action = p_action)
     order by a.at desc, a.id
     limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end $$;
revoke all on function public.staff_audit(timestamptz, timestamptz, uuid, text, int) from public, anon, authenticated;
grant execute on function public.staff_audit(timestamptz, timestamptz, uuid, text, int) to authenticated, service_role;
