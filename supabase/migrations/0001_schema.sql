-- 0001_schema.sql: 예약 플랫폼 스키마 (RLS 정책은 Task 13, 업무 함수는 Task 4 이후)
-- 일시는 timestamptz(UTC), 금액은 원 단위 정수.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  role text not null default 'member' check (role in ('member','operator','finance')),
  verified_at timestamptz
);

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('PERFORMANCE','EXPERIENCE','COURSE')),
  title text not null,
  summary text,
  description text,
  venue text,
  audience text,
  poster_image text,
  poster_tone text not null default 'dark' check (poster_tone in ('light','dark')),
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.offerings (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int not null check (capacity > 0),
  sale_starts_at timestamptz not null,
  sale_ends_at timestamptz not null,
  status text not null default 'OPEN' check (status in ('OPEN','CANCEL_REQUESTED','CANCELLED'))
);
create index offerings_program_idx on public.offerings(program_id);

create table public.course_lessons (
  offering_id uuid not null references public.offerings(id) on delete cascade,
  seq int not null,
  starts_at timestamptz not null,
  primary key (offering_id, seq)
);

create table public.seats (
  id int primary key,
  row_label text not null,
  seat_no int not null,
  grade text not null check (grade in ('R','S','A')),
  unique (row_label, seat_no)
);

create table public.offering_prices (
  offering_id uuid not null references public.offerings(id) on delete cascade,
  grade text check (grade in ('R','S','A')),
  price int not null check (price >= 0)
);
create unique index offering_prices_uq on public.offering_prices(offering_id, coalesce(grade, ''));

create table public.holds (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.offerings(id),
  user_id uuid not null references public.profiles(id),
  qty int not null check (qty > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','PAYING','CONSUMED','EXPIRED','RELEASED')),
  order_id text unique,
  amount int,
  items jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index holds_offering_idx on public.holds(offering_id);
create index holds_user_idx on public.holds(user_id);

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.offerings(id),
  user_id uuid not null references public.profiles(id),
  qty int not null check (qty > 0),
  allocated_qty int not null default 0,
  status text not null default 'WAITING' check (status in ('WAITING','PROMOTED','COMPLETED','EXPIRED','CANCELLED','RELEASED')),
  promoted_at timestamptz,
  deadline_at timestamptz,
  created_at timestamptz not null default now()
);
create index waitlist_offering_idx on public.waitlist(offering_id, created_at);

create table public.inventory_seats (
  offering_id uuid not null references public.offerings(id) on delete cascade,
  seat_id int not null references public.seats(id),
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE','HELD','PAYING','WAIT_ALLOCATED','SOLD')),
  hold_id uuid references public.holds(id),
  waitlist_id uuid references public.waitlist(id),
  primary key (offering_id, seat_id)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_no text not null unique,
  user_id uuid not null references public.profiles(id),
  offering_id uuid not null references public.offerings(id),
  hold_id uuid not null unique references public.holds(id),
  status text not null default 'CONFIRMED' check (status in ('CONFIRMED','CANCELLED')),
  total_amount int not null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create index bookings_user_idx on public.bookings(user_id);
create index bookings_offering_idx on public.bookings(offering_id);

create table public.booking_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  seat_id int references public.seats(id),
  discount_type text not null default 'NONE',
  unit_price int not null,
  discount_amount int not null default 0,
  amount int not null,
  proof_checked boolean not null default false
);
create index booking_items_booking_idx on public.booking_items(booking_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique,
  payment_key text not null unique,
  booking_id uuid references public.bookings(id),
  user_id uuid not null references public.profiles(id),
  amount int not null,
  status text not null check (status in ('DONE','CANCELED','PARTIAL_CANCELED')),
  approved_at timestamptz,
  raw jsonb
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  booking_id uuid not null references public.bookings(id),
  refund_amount int not null,
  fee_amount int not null default 0,
  rule text,
  reason text not null check (reason in ('USER','INSTITUTION','CONFLICT')),
  pg_transaction_key text,
  created_at timestamptz not null default now()
);

create table public.pg_mock_transactions (
  payment_key text primary key,
  order_id text not null unique,
  amount int not null,
  balance_amount int not null,
  status text not null check (status in ('DONE','CANCELED','PARTIAL_CANCELED')),
  cancels jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  kind text not null,
  title text not null,
  body text,
  channel text not null default 'SMS_MOCK',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

create table public.admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  target_type text,
  target_id text,
  detail jsonb,
  at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key,
  value jsonb not null
);
-- 키: env('local'|'qa'|'demo'), clock_enabled, clock_offset_ms, pg_mock_mode('APPROVE'|'DECLINE', qa 환경에서만 변경)
insert into public.app_settings(key, value) values
  ('env', '"local"'),
  ('clock_enabled', 'true'),
  ('clock_offset_ms', '0'),
  ('pg_mock_mode', '"APPROVE"')
on conflict (key) do nothing;

create table public.offering_cancel_requests (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.offerings(id),
  requested_by uuid references public.profiles(id),
  reason text,
  status text not null default 'REQUESTED' check (status in ('REQUESTED','APPROVED','REJECTED')),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz
);

-- 좌석 마스터: A~J열 x 20석 (A~D=R, E~G=S, H~J=A)
insert into public.seats(id, row_label, seat_no, grade)
select (r.i - 1) * 20 + n, chr(64 + r.i), n,
       case when r.i <= 4 then 'R' when r.i <= 7 then 'S' else 'A' end
from generate_series(1, 10) as r(i), generate_series(1, 20) as n;

-- 시드: 거래성 데이터를 비우고 base 기준 상대 일정으로 다시 넣습니다.
-- 계정(auth.users, profiles), seats, app_settings는 건드리지 않습니다.
create or replace function public.seed_demo(base timestamptz) returns void
language plpgsql as $$
declare
  p_chamber uuid; p_drama uuid; p_pottery uuid; p_makeup uuid; p_choir uuid; p_water uuid;
  pid uuid; oid uuid; d int; w int;
begin
  truncate table public.refunds, public.payments, public.pg_mock_transactions, public.booking_items,
    public.bookings, public.notifications, public.inventory_seats, public.waitlist, public.holds,
    public.offering_cancel_requests, public.admin_audit, public.course_lessons, public.offering_prices,
    public.offerings, public.programs cascade;

  insert into public.programs(type, title, summary, description, venue, audience, poster_tone) values
    ('PERFORMANCE', '겨울 실내악 시리즈 「현의 대화」', '현악 사중주가 들려주는 겨울밤 실내악',
     '현악 사중주가 바로크부터 근대까지 겨울에 어울리는 곡을 연주합니다. 약 90분, 중간 휴식 없음.', '소극장', '초등학생 이상', 'dark')
    returning id into p_chamber;
  insert into public.programs(type, title, summary, description, venue, audience, poster_tone) values
    ('PERFORMANCE', '한빛 청소년 연극제 「우리들의 무대」', '청소년 극단이 올리는 창작 연극',
     '지역 청소년 극단이 직접 쓰고 연출한 창작 연극입니다. 약 100분, 중간 휴식 10분.', '소극장', '중학생 이상', 'light')
    returning id into p_drama;
  insert into public.programs(type, title, summary, description, venue, audience, poster_tone) values
    ('EXPERIENCE', '가족 도자기 공방', '가족이 함께 빚는 나만의 접시',
     '흙 다루기부터 유약 선택까지 강사와 함께 접시 한 점을 만듭니다. 소요 약 2시간.', '창작공방', '초등학생 동반 가족', 'light')
    returning id into p_pottery;
  insert into public.programs(type, title, summary, description, venue, audience, poster_tone) values
    ('EXPERIENCE', '무대 분장 체험', '무대 분장 기법을 배워 보는 체험',
     '무대 분장 전문가에게 기본 기법을 배우고 직접 분장해 봅니다. 소요 약 2시간.', '분장실', '중학생 이상', 'dark')
    returning id into p_makeup;
  insert into public.programs(type, title, summary, description, venue, audience, poster_tone) values
    ('COURSE', '시민 합창 교실 (12주)', '매주 함께 노래하는 12주 과정',
     '발성과 호흡부터 화음 맞추기까지 12주 동안 배웁니다. 매주 1회, 2시간.', '연습실', '성인', 'light')
    returning id into p_choir;
  insert into public.programs(type, title, summary, description, venue, audience, poster_tone) values
    ('COURSE', '생활 수채화 (12주)', '일상을 그리는 12주 수채화 과정',
     '기초 재료 다루기부터 풍경과 정물 완성까지 12주 동안 배웁니다. 매주 1회, 2시간.', '미술실', '성인', 'light')
    returning id into p_water;

  -- 공연: 회차 base+10일, base+20일, 좌석제 R/S/A
  foreach pid in array array[p_chamber, p_drama] loop
    foreach d in array array[10, 20] loop
      insert into public.offerings(program_id, starts_at, ends_at, capacity, sale_starts_at, sale_ends_at)
        values (pid, base + make_interval(days => d), base + make_interval(days => d, hours => 2), 200,
                base - interval '7 days', base + make_interval(days => d))
        returning id into oid;
      insert into public.offering_prices(offering_id, grade, price)
        values (oid, 'R', 40000), (oid, 'S', 30000), (oid, 'A', 20000);
      insert into public.inventory_seats(offering_id, seat_id) select oid, s.id from public.seats s;
    end loop;
  end loop;

  -- 체험: 회차 base+5일, base+12일, 정원 20, 10000원
  foreach pid in array array[p_pottery, p_makeup] loop
    foreach d in array array[5, 12] loop
      insert into public.offerings(program_id, starts_at, ends_at, capacity, sale_starts_at, sale_ends_at)
        values (pid, base + make_interval(days => d), base + make_interval(days => d, hours => 2), 20,
                base - interval '7 days', base + make_interval(days => d))
        returning id into oid;
      insert into public.offering_prices(offering_id, grade, price) values (oid, null, 10000);
    end loop;
  end loop;

  -- 정규 강좌: 첫 회 base+9일, 주 1회 12회, 정원 15, 120000원
  foreach pid in array array[p_choir, p_water] loop
    insert into public.offerings(program_id, starts_at, ends_at, capacity, sale_starts_at, sale_ends_at)
      values (pid, base + interval '9 days', base + make_interval(days => 9 + 7 * 11, hours => 2), 15,
              base - interval '7 days', base + interval '9 days')
      returning id into oid;
    insert into public.offering_prices(offering_id, grade, price) values (oid, null, 120000);
    for w in 1..12 loop
      insert into public.course_lessons(offering_id, seq, starts_at)
        values (oid, w, base + make_interval(days => 9 + 7 * (w - 1)));
    end loop;
  end loop;
end $$;

revoke all on function public.seed_demo(timestamptz) from public, anon, authenticated;
grant execute on function public.seed_demo(timestamptz) to service_role;
