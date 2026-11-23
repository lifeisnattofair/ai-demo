-- 0003_waitlist.sql: 대기 신청, 누적 배정(FIFO), 승격(결제 기한 24시간), 만료, D-2 일반 판매 전환
-- 설계 5-4. 현재 시각은 app_now(), D-day는 d_day()(KST 달력)로만 판단합니다.
-- 동시성: 배정/만료/신청은 모두 회차 행(offerings)을 for update로 잠근 상태에서 처리합니다.

-- 승격자 선점과 대기를 잇는 연결. 결제 확정(CONSUMED) 때 대기를 COMPLETED로 바꾸는 데 씁니다.
alter table public.holds add column waitlist_id uuid references public.waitlist(id);
create index holds_waitlist_idx on public.holds(waitlist_id) where waitlist_id is not null;

-- 한 사용자는 한 회차에 진행 중인 대기를 하나만 가집니다(동시 신청 방어).
create unique index waitlist_active_uq on public.waitlist(offering_id, user_id)
  where status in ('WAITING', 'PROMOTED');

-- 대기 배정 수 중 승격 선점이 살아 있는 몫은 선점 쪽에서 이미 세므로 빼고 셉니다.
create or replace function public.used_capacity(p_offering uuid) returns int
language sql stable security definer set search_path = public as $$
  select (coalesce((select sum(h.qty) from public.bookings b join public.holds h on h.id = b.hold_id
                    where b.offering_id = p_offering and b.status = 'CONFIRMED'), 0)
       + coalesce((select sum(qty) from public.holds
                    where offering_id = p_offering
                      and (status = 'PAYING' or (status = 'ACTIVE' and expires_at > public.app_now()))), 0)
       + coalesce((select sum(w.allocated_qty) from public.waitlist w
                    where w.offering_id = p_offering and w.status in ('WAITING', 'PROMOTED')
                      and not exists (select 1 from public.holds h
                                       where h.waitlist_id = w.id
                                         and (h.status in ('PAYING', 'CONSUMED')
                                              or (h.status = 'ACTIVE' and h.expires_at > public.app_now())))), 0))::int
$$;

-- 지금 취소분을 대기에 배정할 수 있는지: 판매 중, 기준일 D-2 이전, 정규 강좌는 첫 회 시작 전
create or replace function public.waitlist_allocatable(p_offering uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select o.status = 'OPEN'
     and public.d_day(o.starts_at) > 2
     and public.app_now() < coalesce((select min(l.starts_at) from public.course_lessons l where l.offering_id = o.id), o.starts_at)
    from public.offerings o where o.id = p_offering
$$;

create or replace function public.waitlist_notify(p_waitlist uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_w public.waitlist%rowtype;
  v_title text;
  v_when text;
begin
  select * into v_w from public.waitlist where id = p_waitlist;
  select p.title, to_char(o.starts_at at time zone 'Asia/Seoul', 'FMMM. FMDD. HH24:MI')
    into v_title, v_when
    from public.offerings o join public.programs p on p.id = o.program_id where o.id = v_w.offering_id;
  if p_kind = 'WAIT_PROMOTED' then
    insert into public.notifications(user_id, kind, title, body) values (v_w.user_id, p_kind,
      '대기하신 예약을 결제하실 수 있습니다',
      format('%s (%s) %s매(명)가 배정되었습니다. %s까지 결제해 주세요. 기한이 지나면 다음 순번으로 넘어갑니다.',
             v_title, v_when, v_w.qty,
             to_char(v_w.deadline_at at time zone 'Asia/Seoul', 'FMMM. FMDD. HH24:MI')));
  else
    insert into public.notifications(user_id, kind, title, body) values (v_w.user_id, p_kind,
      '대기 배정이 종료되었습니다',
      format('%s (%s) 대기 배정분이 결제 기한 경과 또는 공연 2일 전 기준에 따라 해제되었습니다. 남은 좌석이 있으면 일반 예매로 신청해 주세요.',
             v_title, v_when));
  end if;
end $$;

-- 풀린 재고를 대기 순번(created_at FIFO)대로 배정하고 남는 몫은 일반 판매로 돌립니다.
-- 호출자가 회차 행을 잠그고, 넘기는 좌석은 호출자가 잠가 소유한 좌석이어야 합니다.
-- 좌석제는 p_seats(오름차순으로 배정), 정원제는 p_qty만 씁니다.
create or replace function public.waitlist_route(p_offering uuid, p_seats int[], p_qty int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_is_seat boolean := p_seats is not null;
  v_left int;
  v_seats int[];
  v_take int;
  v_w public.waitlist%rowtype;
begin
  if v_is_seat then
    select coalesce(array_agg(x order by x), '{}') into v_seats from (select distinct unnest(p_seats) x) t;
    v_left := cardinality(v_seats);
  else
    v_left := greatest(coalesce(p_qty, 0), 0);
  end if;
  if v_left = 0 then return; end if;

  if public.waitlist_allocatable(p_offering) then
    for v_w in
      select * from public.waitlist
       where offering_id = p_offering and status = 'WAITING' and allocated_qty < qty
       order by created_at, id
       for update
    loop
      exit when v_left = 0;
      v_take := least(v_w.qty - v_w.allocated_qty, v_left);
      if v_is_seat then
        update public.inventory_seats
           set status = 'WAIT_ALLOCATED', waitlist_id = v_w.id, hold_id = null
         where offering_id = p_offering
           and seat_id = any(v_seats[cardinality(v_seats) - v_left + 1 : cardinality(v_seats) - v_left + v_take]);
      end if;
      v_left := v_left - v_take;
      if v_w.allocated_qty + v_take = v_w.qty then
        update public.waitlist
           set allocated_qty = qty, status = 'PROMOTED', promoted_at = public.app_now(),
               deadline_at = public.app_now() + interval '24 hours'
         where id = v_w.id;
        perform public.waitlist_notify(v_w.id, 'WAIT_PROMOTED');
      else
        update public.waitlist set allocated_qty = allocated_qty + v_take where id = v_w.id;
      end if;
    end loop;
  end if;

  -- 남는 몫은 일반 판매(정원제는 사용 수에서 빠진 만큼 자동으로 판매 가능)
  if v_is_seat and v_left > 0 then
    update public.inventory_seats
       set status = 'AVAILABLE', waitlist_id = null, hold_id = null
     where offering_id = p_offering
       and seat_id = any(v_seats[cardinality(v_seats) - v_left + 1 : cardinality(v_seats)]);
  end if;
end $$;

-- 진행 중인 대기 하나를 종료(p_status)하고 배정분을 다음 순번 또는 일반 판매로 돌립니다.
-- 호출자가 회차 행을 잠가야 합니다.
create or replace function public.waitlist_close(p_waitlist uuid, p_status text, p_hold_status text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_w public.waitlist%rowtype;
  v_is_seat boolean;
  v_seats int[];
begin
  select * into v_w from public.waitlist where id = p_waitlist for update;
  if not found or v_w.status not in ('WAITING', 'PROMOTED') then return; end if;
  select p.type = 'PERFORMANCE' into v_is_seat
    from public.offerings o join public.programs p on p.id = o.program_id where o.id = v_w.offering_id;

  update public.holds set status = p_hold_status
   where waitlist_id = v_w.id and status = 'ACTIVE';
  update public.waitlist set status = p_status where id = v_w.id;

  if v_is_seat then
    select coalesce(array_agg(seat_id order by seat_id), '{}') into v_seats from (
      select seat_id from public.inventory_seats
       where offering_id = v_w.offering_id and waitlist_id = v_w.id and status in ('WAIT_ALLOCATED', 'HELD')
       for update) t;
    -- 좌석을 먼저 대기에서 떼어 낸 뒤 다시 배정합니다.
    update public.inventory_seats set status = 'AVAILABLE', waitlist_id = null, hold_id = null
     where offering_id = v_w.offering_id and seat_id = any(v_seats);
    perform public.waitlist_route(v_w.offering_id, v_seats, null);
  else
    perform public.waitlist_route(v_w.offering_id, null, v_w.allocated_qty);
  end if;
end $$;

-- 지연 처리. 누구나 호출할 수 있으므로 기한이 지난 항목만 처리하고, 여러 번 불러도 결과가 같습니다.
create or replace function public.sweep_offering(p_offering uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_starts timestamptz;
  v_w public.waitlist%rowtype;
begin
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
      perform public.waitlist_close(v_w.id,
        case when ((v_starts at time zone 'Asia/Seoul')::date - (v_w.deadline_at at time zone 'Asia/Seoul')::date) <= 2
             then 'RELEASED' else 'EXPIRED' end,
        'EXPIRED');
      perform public.waitlist_notify(v_w.id, 'WAIT_EXPIRED');
    end loop;

    -- D-2부터는 모으던 배정분도 일반 판매로 풉니다.
    if public.d_day(v_starts) <= 2 then
      for v_w in
        select * from public.waitlist
         where offering_id = p_offering and status = 'WAITING' and allocated_qty > 0
         order by created_at, id
      loop
        perform public.waitlist_close(v_w.id, 'RELEASED', 'EXPIRED');
        perform public.waitlist_notify(v_w.id, 'WAIT_EXPIRED');
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

-- 대기 신청. 매진일 때만 받습니다.
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
  if p_qty is null or p_qty <= 0 then perform public.hold_error('INVALID_REQUEST'); end if;

  select * into v_off from public.offerings where id = p_offering for update;
  if not found then perform public.hold_error('NOT_ON_SALE'); end if;
  perform public.sweep_offering(p_offering);
  select type into v_type from public.programs where id = v_off.program_id;

  if v_off.status <> 'OPEN' or public.app_now() < v_off.sale_starts_at or public.app_now() >= v_off.sale_ends_at
     or public.app_now() >= coalesce((select min(starts_at) from public.course_lessons where offering_id = p_offering), v_off.starts_at)
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

-- 대기 취소. 배정분은 다음 순번(또는 D-2 이내면 일반 판매)으로 넘깁니다.
create or replace function public.cancel_waitlist(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_w public.waitlist%rowtype;
begin
  select * into v_w from public.waitlist where id = p_id;
  if not found or v_w.user_id is distinct from v_uid then perform public.hold_error('NOT_OWNER'); end if;
  perform 1 from public.offerings where id = v_w.offering_id for update;
  perform public.sweep_offering(v_w.offering_id);
  select * into v_w from public.waitlist where id = p_id;
  if v_w.status not in ('WAITING', 'PROMOTED') then return; end if;
  if exists (select 1 from public.holds where waitlist_id = p_id and status = 'PAYING') then
    perform public.hold_error('PAYMENT_IN_PROGRESS');
  end if;
  perform public.waitlist_close(p_id, 'CANCELLED', 'RELEASED');
end $$;

-- 취소로 풀린 재고 반환(내부 전용, Task 7 취소 흐름이 호출). 좌석제는 p_seat_ids, 정원제는 p_qty.
create or replace function public.release_inventory(p_offering uuid, p_seat_ids int[], p_qty int) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_off public.offerings%rowtype;
  v_type text;
  v_seats int[];
begin
  select * into v_off from public.offerings where id = p_offering for update;
  if not found then perform public.hold_error('INVALID_REQUEST'); end if;
  perform public.sweep_offering(p_offering);
  select type into v_type from public.programs where id = v_off.program_id;

  if v_type = 'PERFORMANCE' then
    -- 판매됐거나 이미 풀린 좌석만 받습니다. 선점/배정 중인 좌석은 건드리지 않습니다(이중 배정 방지).
    select coalesce(array_agg(seat_id order by seat_id), '{}') into v_seats from (
      select seat_id from public.inventory_seats
       where offering_id = p_offering and seat_id = any(coalesce(p_seat_ids, '{}'))
         and status in ('SOLD', 'AVAILABLE')
       order by seat_id
       for update) t;
    perform public.waitlist_route(p_offering, v_seats, null);
  else
    -- 실제 빈 정원을 넘겨 배정하지 않습니다.
    perform public.waitlist_route(p_offering, null,
      least(greatest(coalesce(p_qty, 0), 0), greatest(v_off.capacity - public.used_capacity(p_offering), 0)));
  end if;
end $$;

-- 승격자가 결제하러 들어올 때 배정분으로 선점을 만듭니다. 선점 만료 = 결제 기한.
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

-- 승격 선점을 스스로 풀면 좌석은 기한까지 승격자 배정으로 남습니다(다시 hold_for_promotion 가능).
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
  if v_h.waitlist_id is not null then
    update public.inventory_seats set status = 'WAIT_ALLOCATED', hold_id = null
     where hold_id = p_hold and status = 'HELD';
  else
    update public.inventory_seats set status = 'AVAILABLE', hold_id = null
     where hold_id = p_hold and status = 'HELD';
  end if;
end $$;

-- 승격 선점이 결제 확정(CONSUMED)되면 대기를 COMPLETED로 바꿉니다.
create or replace function public.holds_complete_waitlist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.waitlist set status = 'COMPLETED'
   where id = new.waitlist_id and status = 'PROMOTED';
  return new;
end $$;

create trigger holds_complete_waitlist
  after update of status on public.holds
  for each row
  when (new.status = 'CONSUMED' and old.status is distinct from 'CONSUMED' and new.waitlist_id is not null)
  execute function public.holds_complete_waitlist();

revoke all on function public.waitlist_allocatable(uuid), public.waitlist_notify(uuid, text),
  public.waitlist_route(uuid, int[], int), public.waitlist_close(uuid, text, text),
  public.release_inventory(uuid, int[], int), public.holds_complete_waitlist(),
  public.join_waitlist(uuid, int), public.cancel_waitlist(uuid), public.hold_for_promotion(uuid),
  public.used_capacity(uuid), public.sweep_offering(uuid), public.release_hold(uuid)
  from public, anon, authenticated;
grant execute on function public.join_waitlist(uuid, int), public.cancel_waitlist(uuid),
  public.hold_for_promotion(uuid), public.sweep_offering(uuid), public.release_hold(uuid)
  to authenticated, service_role;
grant execute on function public.release_inventory(uuid, int[], int), public.used_capacity(uuid) to service_role;
