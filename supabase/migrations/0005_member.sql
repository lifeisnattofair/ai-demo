-- 0005_member.sql: 회원 모의 본인인증, 회원 탈퇴
-- 파일명 번호는 supabase 마이그레이션 버전이라 겹치면 안 됩니다. 0004_booking.sql 다음 번호를 씁니다.
-- 저장 항목은 이름, 휴대폰 번호, 이메일(auth.users)뿐입니다(SER-004).

-- 탈퇴(차단)한 계정의 아직 유효한 토큰으로 회원 RPC를 호출하지 못하게 합니다.
create or replace function public.assert_active_member(p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_uid is null
     or not exists (select 1 from auth.users u where u.id = p_uid and (u.banned_until is null or u.banned_until <= now())) then
    perform public.hold_error('UNAUTHENTICATED');
  end if;
end $$;

-- 모의 본인인증: 호출자의 프로필을 만들거나 갱신하고 verified_at 을 기록합니다(SIR-006).
-- role 은 건드리지 않으므로 이 함수로 권한을 올릴 수 없습니다.
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
  if v_name = '' or char_length(v_name) > 50 then perform public.hold_error('INVALID_NAME'); end if;
  if v_phone !~ '^01[0-9]{8,9}$' then perform public.hold_error('INVALID_PHONE'); end if;

  insert into public.profiles (id, name, phone, verified_at)
  values (v_uid, v_name, v_phone, public.app_now())
  on conflict (id) do update
    set name = excluded.name, phone = excluded.phone, verified_at = excluded.verified_at
  returning * into v_row;
  return v_row;
end $$;

-- 회원 탈퇴: 예정된 예약이 있으면 거절합니다. 과거 예약 기록은 남겨야 하므로
-- 계정을 지우지 않고 개인정보를 비운 뒤 로그인을 막습니다.
create or replace function public.withdraw_member() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_w record;
begin
  perform public.assert_active_member(v_uid);

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

revoke all on function public.assert_active_member(uuid) from public, anon, authenticated;
revoke all on function public.complete_mock_verification(text, text), public.withdraw_member() from public, anon;
grant execute on function public.complete_mock_verification(text, text), public.withdraw_member() to authenticated;
