-- 0014_content_fixes.sql: anti-slop 감사 001 반영(시연 데이터 문구)
-- #14 실내악 출연자 이름을 실존 유명인과 겹치지 않는 가상 이름으로 바꿉니다(COR-001).
-- #15 정규 강좌 시리즈 문구를 개강 일정(12월)에 맞춰 「2026 겨울학기 정규 강좌」로 바꿉니다.
-- 이미 들어 있는 행을 고치고, seed_demo(시연 데이터 초기화와 seed.sql이 부름)도 같은 문구를 쓰도록 본문의 해당 글자만 바꿔 다시 만듭니다.
-- 여러 번 실행해도 결과가 같습니다(바꿀 글자가 없으면 그대로 둡니다).

do $fix$
declare
  pairs text[][] := array[
    array['"한지민"', '"윤서진"'],
    array['"오세윤"', '"강도하"'],
    array['"박다온"', '"민채윤"'],
    array['"이준서"', '"서지후"'],
    array['2027 봄학기 정규 강좌', '2026 겨울학기 정규 강좌']
  ];
  def text;
  i int;
begin
  -- 1) seed_demo 본문
  def := pg_get_functiondef('public.seed_demo(timestamptz)'::regprocedure);
  for i in 1 .. array_length(pairs, 1) loop
    def := replace(def, pairs[i][1], pairs[i][2]);
  end loop;
  execute def;

  -- 2) 지금 들어 있는 프로그램 행
  for i in 1 .. array_length(pairs, 1) loop
    update public.programs
       set details = replace(details::text, pairs[i][1], pairs[i][2])::jsonb
     where details::text like '%' || pairs[i][1] || '%';
    update public.programs
       set poster_series = replace(poster_series, pairs[i][1], pairs[i][2])
     where poster_series like '%' || pairs[i][1] || '%';
  end loop;
end
$fix$;

-- execute 로 다시 만든 함수에도 권한을 같게 둡니다(0001 과 같음).
revoke all on function public.seed_demo(timestamptz) from public, anon, authenticated;
grant execute on function public.seed_demo(timestamptz) to service_role;
