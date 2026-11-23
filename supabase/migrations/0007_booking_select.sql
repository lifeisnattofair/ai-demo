-- 0007_booking_select.sql: 좌석/인원 선택 화면용 조회 함수
-- 화면이 테이블을 직접 읽지 않고(이후 RLS 를 켜도 그대로 동작하도록) 필요한 값만 함수로 받습니다.

-- 회차의 좌석 배치와 현재 상태. 만료된 선점은 먼저 정리해서 돌려줍니다.
create or replace function public.offering_seat_map(p_offering uuid)
returns table (seat_id int, row_label text, seat_no int, grade text, status text)
language plpgsql security definer set search_path = public as $$
begin
  perform public.sweep_offering(p_offering);
  return query
    select s.id, s.row_label, s.seat_no, s.grade, i.status
      from public.inventory_seats i
      join public.seats s on s.id = i.seat_id
     where i.offering_id = p_offering
     order by s.row_label, s.seat_no;
end $$;

-- 로그인한 사용자의 해당 회차 확정 + 유효 선점 수량(1인 한도 안내용). 판단은 hold_* 함수가 다시 합니다.
create or replace function public.my_offering_qty(p_offering uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then 0 else public.user_held_qty(auth.uid(), p_offering) end
$$;

-- 로그인한 사용자가 이 회차에 이미 잡아 둔 유효 선점(없으면 행 없음). 이전 단계에서 돌아왔을 때 이어가기 위해 씁니다.
create or replace function public.my_active_hold(p_offering uuid) returns setof public.holds
language sql stable security definer set search_path = public as $$
  select h.* from public.holds h
   where h.user_id = auth.uid() and h.offering_id = p_offering
     and h.status = 'ACTIVE' and h.expires_at > public.app_now()
   order by h.created_at desc
   limit 1
$$;

revoke all on function public.offering_seat_map(uuid), public.my_offering_qty(uuid), public.my_active_hold(uuid)
  from public, anon, authenticated;
grant execute on function public.offering_seat_map(uuid), public.my_offering_qty(uuid), public.my_active_hold(uuid)
  to authenticated, service_role;
