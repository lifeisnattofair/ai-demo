-- 0015_final_fixes.sql: 최종 리뷰 반영
-- I1  hold_seats 도 회차 행을 먼저 잠급니다(잠금 순서 offering -> hold -> waitlist -> seats, hold_capacity 와 같음).
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
