-- 0013_system.sql: 검수용 시계, 시연 데이터 초기화, 작업 이력 조회, 환경 분리
-- 환경(app_settings.env)
--   qa    : 검수용 시계 사용(admin_set_clock). 시연 데이터 초기화는 못 씁니다.
--   demo  : 공개 시연. 시계 오프셋은 저장돼 있어도 app_now() 가 무시합니다(설계 5-7). 시연 데이터 초기화만 씁니다.
--   local : 로컬 개발. 개발자가 둘 다 시험할 수 있도록 시계와 초기화를 모두 허용합니다(화면 메뉴는 VITE_ENV 가 정함).
-- 두 함수 모두 운영 담당(operator)만 실행하고 admin_audit 에 남깁니다. 다시 실행해도 결과가 같습니다.

create or replace function public.app_env() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value #>> '{}' from public.app_settings where key = 'env'), 'local')
$$;

-- 공개 시연(demo)에서는 시계를 끕니다. 오프셋 값이 남아 있어도 실제 시각을 돌려줍니다.
create or replace function public.app_now() returns timestamptz
language sql stable security definer set search_path = public as $$
  select case
    when coalesce((select value from public.app_settings where key = 'clock_enabled'), 'false'::jsonb) = 'true'::jsonb
         and public.app_env() <> 'demo'
      then now() + make_interval(secs => coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'clock_offset_ms'), 0) / 1000.0)
    else now()
  end
$$;

-- 담당자용 시계 상태: {env, enabled, offsetMs, now}. enabled 는 실제로 적용되는지(demo 에서는 항상 false)입니다.
create or replace function public.staff_clock() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_env text := public.app_env();
  v_on boolean;
  v_off bigint;
begin
  perform public.require_staff(null);
  v_on := coalesce((select value from public.app_settings where key = 'clock_enabled'), 'false'::jsonb) = 'true'::jsonb and v_env <> 'demo';
  v_off := case when v_on then coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'clock_offset_ms'), 0)::bigint else 0 end;
  return jsonb_build_object('env', v_env, 'enabled', v_on, 'offsetMs', v_off, 'now', public.app_now());
end $$;

-- 검수용 시계 설정(운영 담당). 오프셋은 실제 시각에 더하는 값(밀리초)이고 0 이면 실제 시각입니다.
create or replace function public.admin_set_clock(p_offset_ms bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_env text := public.app_env();
  v_old bigint;
begin
  perform public.require_staff(array['operator']);
  if v_env not in ('qa', 'local') then perform public.hold_error('NOT_ALLOWED_IN_ENV'); end if;
  if p_offset_ms is null or abs(p_offset_ms) > 365::bigint * 86400000 then perform public.hold_error('INVALID_REQUEST'); end if;
  v_old := coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'clock_offset_ms'), 0)::bigint;
  insert into public.app_settings(key, value) values ('clock_enabled', 'true'::jsonb), ('clock_offset_ms', to_jsonb(p_offset_ms))
  on conflict (key) do update set value = excluded.value;
  perform public.admin_log('CLOCK_SET', 'app_settings', 'clock_offset_ms', jsonb_build_object('from', v_old, 'to', p_offset_ms, 'env', v_env));
  return public.staff_clock();
end $$;

-- 시연 데이터 초기화(운영 담당). 예약, 대기, 알림, 모의 결제 기록을 지우고 시드 일정을 app_now() 기준으로 다시 만듭니다.
-- 계정(auth.users, profiles)과 설정은 건드리지 않습니다. seed_demo 가 작업 이력도 비우므로 초기화 기록은 그 뒤에 남깁니다.
create or replace function public.admin_reset_demo() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_env text := public.app_env();
  v_base timestamptz;
begin
  perform public.require_staff(array['operator']);
  if v_env not in ('demo', 'local') then perform public.hold_error('NOT_ALLOWED_IN_ENV'); end if;
  v_base := public.app_now();
  perform public.seed_demo(v_base);
  perform public.admin_log('RESET_DEMO', 'system', 'demo', jsonb_build_object('base', v_base, 'env', v_env));
  return jsonb_build_object('base', v_base);
end $$;

-- 작업 이력 조회(운영, 정산 담당 모두). 작업자 이름은 가려서 돌려줍니다(SER-005).
-- 기간은 작업 일시 기준이고 p_to 는 포함하지 않습니다(미만). 최신순 최대 p_limit 건(상한 1000).
create or replace function public.staff_audit(p_from timestamptz default null, p_to timestamptz default null,
                                              p_actor uuid default null, p_action text default null, p_limit int default 1000)
returns table (id uuid, at timestamptz, actor_id uuid, actor_name_masked text, actor_role text,
               action text, target_type text, target_id text, detail jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_staff(null);
  return query
    select a.id, a.at, a.actor_id, public.mask_name(p.name), p.role, a.action, a.target_type, a.target_id, a.detail
      from public.admin_audit a left join public.profiles p on p.id = a.actor_id
     where (p_from is null or a.at >= p_from) and (p_to is null or a.at < p_to)
       and (p_actor is null or a.actor_id = p_actor) and (p_action is null or a.action = p_action)
     order by a.at desc, a.id
     limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
end $$;

revoke all on function public.app_env(), public.staff_clock(), public.admin_set_clock(bigint), public.admin_reset_demo(),
  public.staff_audit(timestamptz, timestamptz, uuid, text, int) from public, anon, authenticated;
grant execute on function public.staff_clock(), public.admin_set_clock(bigint), public.admin_reset_demo(),
  public.staff_audit(timestamptz, timestamptz, uuid, text, int) to authenticated, service_role;
