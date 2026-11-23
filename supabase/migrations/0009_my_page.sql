-- 0009_my_page.sql: 내 예약, 대기, 알림 화면용 조회/처리 함수
-- 화면이 테이블을 직접 읽지 않고 본인 행만 함수로 받습니다(RLS 전환 전에도 남의 행이 보이지 않도록).

-- 본인 예약 목록(최신순). p_booking 을 주면 그 예약 한 건만 돌려줍니다.
-- 환불 미리보기에 필요한 수업 시작 목록과 결제/환불 기록을 함께 담습니다.
create or replace function public.my_bookings_overview(p_booking uuid default null)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t.obj order by t.created_at desc), '[]'::jsonb)
  from (
    select b.created_at,
      jsonb_build_object(
        'id', b.id, 'booking_no', b.booking_no, 'status', b.status, 'total_amount', b.total_amount,
        'created_at', b.created_at, 'cancelled_at', b.cancelled_at,
        'offering', jsonb_build_object('id', o.id, 'starts_at', o.starts_at, 'ends_at', o.ends_at, 'status', o.status),
        'program', jsonb_build_object('id', p.id, 'type', p.type, 'title', p.title, 'venue', p.venue,
                     'poster_image', p.poster_image, 'poster_tone', p.poster_tone, 'poster_series', p.poster_series,
                     'poster_title', p.poster_title, 'poster_sub', p.poster_sub),
        'lesson_starts', case when p.type = 'COURSE' then
          (select coalesce(jsonb_agg(l.starts_at order by l.starts_at, l.seq), '[]'::jsonb) from public.course_lessons l where l.offering_id = o.id) end,
        'items', (select coalesce(jsonb_agg(jsonb_build_object('row_label', s.row_label, 'seat_no', s.seat_no, 'grade', s.grade,
                                                              'discount_type', bi.discount_type, 'amount', bi.amount)
                                           order by s.row_label, s.seat_no), '[]'::jsonb)
                    from public.booking_items bi left join public.seats s on s.id = bi.seat_id
                   where bi.booking_id = b.id),
        'payment', (select jsonb_build_object('approved_at', pay.approved_at, 'amount', pay.amount, 'status', pay.status)
                      from public.payments pay where pay.booking_id = b.id limit 1),
        'refund', (select jsonb_build_object('refund_amount', r.refund_amount, 'fee_amount', r.fee_amount, 'rule', r.rule,
                                             'reason', r.reason, 'created_at', r.created_at)
                     from public.refunds r where r.booking_id = b.id order by r.created_at desc, r.id limit 1)
      ) as obj
    from public.bookings b
    join public.offerings o on o.id = b.offering_id
    join public.programs p on p.id = o.program_id
   where b.user_id = auth.uid() and (p_booking is null or b.id = p_booking)
  ) t
$$;

-- 본인 대기 신청(대기 중, 승격됨). position 은 같은 회차에서 먼저 신청한 진행 중 대기 수 + 1.
create or replace function public.my_waitlist_overview()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t.obj order by t.created_at desc), '[]'::jsonb)
  from (
    select w.created_at,
      jsonb_build_object(
        'id', w.id, 'qty', w.qty, 'allocated_qty', w.allocated_qty, 'status', w.status,
        'deadline_at', w.deadline_at, 'created_at', w.created_at,
        'position', 1 + (select count(*) from public.waitlist e
                          where e.offering_id = w.offering_id and e.status in ('WAITING', 'PROMOTED')
                            and (e.created_at, e.id) < (w.created_at, w.id)),
        'offering', jsonb_build_object('id', o.id, 'starts_at', o.starts_at, 'ends_at', o.ends_at),
        'program', jsonb_build_object('id', p.id, 'type', p.type, 'title', p.title, 'venue', p.venue)
      ) as obj
    from public.waitlist w
    join public.offerings o on o.id = w.offering_id
    join public.programs p on p.id = o.program_id
   where w.user_id = auth.uid() and w.status in ('WAITING', 'PROMOTED')
  ) t
$$;

-- 본인 알림(최신 100건)
create or replace function public.my_notifications()
returns table (id uuid, kind text, title text, body text, channel text, read_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select n.id, n.kind, n.title, n.body, n.channel, n.read_at, n.created_at
    from public.notifications n
   where n.user_id = auth.uid()
   order by n.created_at desc, n.id
   limit 100
$$;

-- 알림 읽음 처리. 본인 알림만 바뀌고, 이미 읽은 알림은 그대로 둡니다.
create or replace function public.mark_notification_read(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then perform public.hold_error('UNAUTHENTICATED'); end if;
  update public.notifications set read_at = public.app_now()
   where id = p_id and user_id = auth.uid() and read_at is null;
end $$;

create or replace function public.mark_all_notifications_read() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if auth.uid() is null then perform public.hold_error('UNAUTHENTICATED'); end if;
  update public.notifications set read_at = public.app_now() where user_id = auth.uid() and read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- 마이페이지 왼쪽 메뉴의 건수: 예정 예약, 진행 중 대기, 안 읽은 알림
create or replace function public.my_counts() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'upcoming', (select count(*) from public.bookings b join public.offerings o on o.id = b.offering_id
                  where b.user_id = auth.uid() and b.status = 'CONFIRMED' and coalesce(o.ends_at, o.starts_at) > public.app_now()),
    'waitlist', (select count(*) from public.waitlist w where w.user_id = auth.uid() and w.status in ('WAITING', 'PROMOTED')),
    'unread', (select count(*) from public.notifications n where n.user_id = auth.uid() and n.read_at is null))
$$;

revoke all on function public.my_bookings_overview(uuid), public.my_waitlist_overview(), public.my_notifications(),
  public.mark_notification_read(uuid), public.mark_all_notifications_read(), public.my_counts()
  from public, anon, authenticated;
grant execute on function public.my_bookings_overview(uuid), public.my_waitlist_overview(), public.my_notifications(),
  public.mark_notification_read(uuid), public.mark_all_notifications_read(), public.my_counts()
  to authenticated, service_role;
