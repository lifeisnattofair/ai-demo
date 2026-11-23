-- 0015_final_fixes.sql: 최종 리뷰 반영
-- I1  hold_seats 도 회차 행을 먼저 잠급니다(잠금 순서 offering -> hold -> waitlist -> seats, hold_capacity 와 같음).
-- I2  회원이 내 정보에서 이름과 휴대폰 번호를 고칩니다(SFR-002). 이메일 변경은 이 프로토타입 범위 밖입니다.
-- I3  공개 시연(env = demo)에서 공개된 시연 계정 5개는 연락처 변경과 탈퇴를 막고,
--     시연 데이터 초기화(admin_reset_demo)가 이 계정들의 상태(차단, 이메일, 비밀번호, 프로필)를 시드 값으로 되돌립니다.
-- M6  가격은 1원 이상이어야 합니다(결제 확인이 금액 0 을 받지 않기 때문입니다).
-- 모두 create or replace 라 다시 실행해도 결과가 같습니다. 본문은 각 함수의 최신 정의를 옮기고 표시한 부분만 더했습니다.

-- ===== I1: hold_seats (최신 정의 0011_rls.sql + 회차 행 잠금) =====
create or replace function public.hold_seats(p_offering uuid, p_seat_ids int[]) returns public.holds
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_seats int[];
  v_hold public.holds;
  v_changed int;
begin
  if v_uid is null then perform public.hold_error('UNAUTHENTICATED'); end if;
  perform public.assert_active_member(v_uid);
  select array_agg(distinct x) into v_seats from unnest(coalesce(p_seat_ids, '{}')) x;
  if v_seats is null then perform public.hold_error('INVALID_REQUEST'); end if;

  -- 같은 사용자의 여러 탭이 한도를 동시에 우회하지 못하게 사용자+회차 단위로 직렬화
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || p_offering::text, 0));
  -- 0015: 회차 행을 먼저 잠급니다. 이 잠금 없이 sweep(만료 선점 행 잠금)과 insert(FK 의 회차 KEY SHARE)를 하면
  -- 회차를 먼저 잠그고 같은 선점 행을 기다리는 finalize_cancel, admin_upsert_offering 등과 교착될 수 있습니다.
  perform 1 from public.offerings where id = p_offering for update;
  perform public.sweep_offering(p_offering);
  perform public.hold_precheck(v_uid, p_offering, cardinality(v_seats), 'SEAT');

  insert into public.holds(offering_id, user_id, qty, status, expires_at)
    values (p_offering, v_uid, cardinality(v_seats), 'ACTIVE', public.app_now() + interval '10 minutes')
    returning * into v_hold;

  -- 조건부 update: AVAILABLE인 행만 바뀌므로 동시에 같은 좌석을 잡아도 한 쪽만 성공
  update public.inventory_seats
     set status = 'HELD', hold_id = v_hold.id
   where offering_id = p_offering and seat_id = any(v_seats) and status = 'AVAILABLE';
  get diagnostics v_changed = row_count;
  if v_changed <> cardinality(v_seats) then
    perform public.hold_error('SEAT_TAKEN');  -- 예외로 트랜잭션 전체 롤백
  end if;
  return v_hold;
end $$;

-- ===== I3: 공개 시연 계정 =====
-- seed.sql 이 만드는 계정 5개의 고정 id 와 시드 값입니다. 탈퇴하면 이메일이 바뀌므로 id 로 구분합니다.
create or replace function public.demo_seed_accounts()
returns table (id uuid, email text, name text, phone text, role text)
language sql immutable set search_path = public as $$
  values
    ('00000000-0000-4000-8000-000000000001'::uuid, 'member1@demo.test', '회원 하나', '010-0000-0001', 'member'),
    ('00000000-0000-4000-8000-000000000002'::uuid, 'member2@demo.test', '회원 둘', '010-0000-0002', 'member'),
    ('00000000-0000-4000-8000-000000000003'::uuid, 'member3@demo.test', '회원 셋', '010-0000-0003', 'member'),
    ('00000000-0000-4000-8000-000000000011'::uuid, 'operator@demo.test', '운영 담당', '010-0000-0011', 'operator'),
    ('00000000-0000-4000-8000-000000000012'::uuid, 'finance@demo.test', '재무 담당', '010-0000-0012', 'finance')
$$;

-- 공개 시연(demo)에서 시연 계정이면 DEMO_ACCOUNT_LOCKED 로 거절합니다. 다른 환경에서는 아무것도 하지 않습니다.
create or replace function public.assert_not_demo_seed(p_uid uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_env() = 'demo' and exists (select 1 from public.demo_seed_accounts() s where s.id = p_uid) then
    perform public.hold_error('DEMO_ACCOUNT_LOCKED');
  end if;
end $$;

-- 모의 본인인증(최신 정의 0005_member.sql + 시연 계정 확인). 이 함수도 이름과 휴대폰 번호를 바꾸므로 같이 막습니다.
create or replace function public.complete_mock_verification(p_name text, p_phone text)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_row public.profiles;
begin
  perform public.assert_active_member(v_uid);
  perform public.assert_not_demo_seed(v_uid);  -- 0015
  if v_name = '' or char_length(v_name) > 50 then perform public.hold_error('INVALID_NAME'); end if;
  if v_phone !~ '^01[0-9]{8,9}$' then perform public.hold_error('INVALID_PHONE'); end if;

  insert into public.profiles (id, name, phone, verified_at)
  values (v_uid, v_name, v_phone, public.app_now())
  on conflict (id) do update
    set name = excluded.name, phone = excluded.phone, verified_at = excluded.verified_at
  returning * into v_row;
  return v_row;
end $$;

-- ===== I2: 내 정보 수정(SFR-002) =====
-- 호출자 본인의 이름과 휴대폰 번호만 바꿉니다. role, verified_at 은 건드리지 않습니다.
-- 프로필이 없으면(가입 중 연락처 입력이 끝나지 않음) PROFILE_REQUIRED 로 거절하고, 화면은 연락처 입력 단계로 보냅니다.
create or replace function public.update_my_contact(p_name text, p_phone text)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_row public.profiles;
begin
  perform public.assert_active_member(v_uid);
  perform public.assert_not_demo_seed(v_uid);
  if v_name = '' or char_length(v_name) > 50 then perform public.hold_error('INVALID_NAME'); end if;
  if v_phone !~ '^01[0-9]{8,9}$' then perform public.hold_error('INVALID_PHONE'); end if;

  update public.profiles set name = v_name, phone = v_phone
   where id = v_uid and verified_at is not null
  returning * into v_row;
  if not found then perform public.hold_error('PROFILE_REQUIRED'); end if;
  return v_row;
end $$;

-- 회원 탈퇴(최신 정의 0005_member.sql + 시연 계정 확인)
create or replace function public.withdraw_member() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_w record;
begin
  perform public.assert_active_member(v_uid);
  perform public.assert_not_demo_seed(v_uid);  -- 0015

  if exists (
    select 1 from public.bookings b
    join public.offerings o on o.id = b.offering_id
    where b.user_id = v_uid and b.status = 'CONFIRMED' and o.ends_at > public.app_now()
  ) or exists (
    select 1 from public.holds h
    where h.user_id = v_uid and h.status in ('ACTIVE', 'PAYING') and h.expires_at > public.app_now()
  ) then
    perform public.hold_error('ACTIVE_BOOKING');
  end if;

  for v_w in select id from public.waitlist where user_id = v_uid and status in ('WAITING', 'PROMOTED') loop
    perform public.cancel_waitlist(v_w.id);
  end loop;

  update public.profiles set name = '탈퇴한 회원', phone = null, verified_at = null where id = v_uid;
  update auth.users
    set email = 'withdrawn-' || v_uid::text || '@invalid.local',
        raw_user_meta_data = '{}'::jsonb,
        banned_until = timestamptz '9999-12-31 00:00:00+00'
    where id = v_uid;
  -- 같은 이메일로 다시 가입할 수 있도록 연결된 로그인 수단과 세션을 지웁니다(refresh token 은 세션과 함께 삭제됩니다).
  delete from auth.identities where user_id = v_uid;
  delete from auth.sessions where user_id = v_uid;
end $$;

-- 시연 계정을 시드 상태로 되돌립니다. 비밀번호 변경은 Supabase Auth 가 처리해 SQL 로 막을 수 없으므로
-- 화면에서 숨기고(account.js), 누가 API 로 바꿨더라도 초기화 때 시드 비밀번호(README 에 공개된 데모 값)로 돌려놓습니다.
-- 다른 사용자가 같은 이메일을 이미 쓰고 있으면 이메일만 그대로 둡니다(고유 제약 충돌 방지).
create or replace function public.restore_demo_accounts() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  update auth.users u
     set email = case when exists (select 1 from auth.users x where x.email = s.email and x.id <> u.id) then u.email else s.email end,
         encrypted_password = extensions.crypt('Demo-1234!', extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(u.email_confirmed_at, now()),
         raw_user_meta_data = '{}'::jsonb, email_change = '', email_change_token_new = '',
         banned_until = null,
         updated_at = now()
    from public.demo_seed_accounts() s
   where u.id = s.id;
  get diagnostics v_n = row_count;

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.id::text, 'email',
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()
    from auth.users u join public.demo_seed_accounts() s on s.id = u.id
   where not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');
  update auth.identities i
     set identity_data = i.identity_data || jsonb_build_object('email', u.email), updated_at = now()
    from auth.users u join public.demo_seed_accounts() s on s.id = u.id
   where i.user_id = u.id and i.provider = 'email' and i.identity_data ->> 'email' is distinct from u.email;

  insert into public.profiles (id, name, phone, role, verified_at)
  select s.id, s.name, s.phone, s.role, now()
    from public.demo_seed_accounts() s join auth.users u on u.id = s.id
  on conflict (id) do update
    set name = excluded.name, phone = excluded.phone, role = excluded.role,
        verified_at = coalesce(public.profiles.verified_at, excluded.verified_at);
  return v_n;
end $$;

-- 시연 데이터 초기화(최신 정의 0013_system.sql + 시연 계정 복구)
create or replace function public.admin_reset_demo() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_env text := public.app_env();
  v_base timestamptz;
  v_accounts int;
begin
  perform public.require_staff(array['operator']);
  if v_env not in ('demo', 'local') then perform public.hold_error('NOT_ALLOWED_IN_ENV'); end if;
  v_base := public.app_now();
  perform public.seed_demo(v_base);
  v_accounts := public.restore_demo_accounts();  -- 0015
  perform public.admin_log('RESET_DEMO', 'system', 'demo', jsonb_build_object('base', v_base, 'env', v_env, 'accounts', v_accounts));
  return jsonb_build_object('base', v_base);
end $$;

-- ===== M6: 가격은 1원 이상(최신 정의 0010_admin.sql, 하한만 0 -> 1) =====
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
                    or (e ->> 'price')::numeric < 1 or (e ->> 'price')::numeric > 10000000) then
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

-- ===== 권한 =====
revoke all on function public.demo_seed_accounts(), public.assert_not_demo_seed(uuid), public.restore_demo_accounts()
  from public, anon, authenticated;
revoke all on function public.update_my_contact(text, text) from public, anon;
grant execute on function public.update_my_contact(text, text) to authenticated;
