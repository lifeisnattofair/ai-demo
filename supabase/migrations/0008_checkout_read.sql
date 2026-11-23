-- 0008_checkout_read.sql: 할인/결제/완료 화면용 조회 함수
-- 화면이 테이블을 직접 읽지 않고 본인 선점과 본인 예약의 필요한 값만 함수로 받습니다.

-- 본인 선점 한 건과 잡아 둔 좌석(공연만). 선점이 없거나 남의 것이면 행이 없습니다.
create or replace function public.get_my_hold(p_hold uuid)
returns table (id uuid, offering_id uuid, qty int, status text, expires_at timestamptz, seats jsonb)
language sql stable security definer set search_path = public as $$
  select h.id, h.offering_id, h.qty, h.status, h.expires_at,
         coalesce((select jsonb_agg(jsonb_build_object('seat_id', s.id, 'row_label', s.row_label, 'seat_no', s.seat_no, 'grade', s.grade)
                                    order by s.row_label, s.seat_no)
                     from public.inventory_seats i join public.seats s on s.id = i.seat_id
                    where i.hold_id = h.id), '[]'::jsonb)
    from public.holds h
   where h.id = p_hold and h.user_id = auth.uid()
$$;

-- 본인 예약의 좌석과 적용 할인(완료 화면용)
create or replace function public.my_booking_items(p_booking uuid)
returns table (row_label text, seat_no int, grade text, discount_type text, amount int)
language sql stable security definer set search_path = public as $$
  select s.row_label, s.seat_no, s.grade, bi.discount_type, bi.amount
    from public.bookings b
    join public.booking_items bi on bi.booking_id = b.id
    left join public.seats s on s.id = bi.seat_id
   where b.id = p_booking and b.user_id = auth.uid()
   order by s.row_label, s.seat_no
$$;

revoke all on function public.get_my_hold(uuid), public.my_booking_items(uuid) from public, anon, authenticated;
grant execute on function public.get_my_hold(uuid), public.my_booking_items(uuid) to authenticated, service_role;
