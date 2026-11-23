-- 0006_program_posters.sql: 포스터 문구와 상세 소개 컬럼, 비회원 잔여석 조회, 사진 포스터를 넣은 seed_demo
--
-- programs.poster_image : 사진 키(quartet, theater, pottery, makeup, choir, watercolor). 화면이 키를 이미지로 바꿉니다.
-- programs.poster_series/poster_title/poster_sub : 포스터에 얹는 문구. poster_title 의 줄바꿈은 \n 입니다.
-- programs.details : 상세 화면 소개 문구 {runtime, intro[], items_title, items[{name,note}], people[{name,role}], guide}

alter table public.programs
  add column if not exists poster_series text,
  add column if not exists poster_title text,
  add column if not exists poster_sub text,
  add column if not exists details jsonb not null default '{}'::jsonb;

-- 목록과 상세는 로그인 전에도 잔여석을 보여 줍니다. 함수는 security definer 이고 수량만 돌려줍니다.
grant execute on function public.remaining_capacity(uuid) to anon;

create or replace function public.seed_demo(base timestamptz) returns void
language plpgsql as $$
declare
  p_chamber uuid; p_drama uuid; p_pottery uuid; p_makeup uuid; p_choir uuid; p_water uuid;
  pid uuid; oid uuid; d int; w int; m int;
begin
  truncate table public.refunds, public.payments, public.pg_mock_transactions, public.booking_items,
    public.bookings, public.notifications, public.inventory_seats, public.waitlist, public.holds,
    public.offering_cancel_requests, public.admin_audit, public.course_lessons, public.offering_prices,
    public.offerings, public.programs cascade;

  insert into public.programs(type, title, summary, description, venue, audience, poster_image, poster_tone,
                              poster_series, poster_title, poster_sub, details) values
    ('PERFORMANCE', '겨울 실내악 시리즈 「현의 대화」', '현악 사중주가 들려주는 겨울밤 실내악',
     '현악 사중주가 바로크부터 근대까지 겨울에 어울리는 곡을 연주합니다. 약 90분, 중간 휴식 없음.', '소극장', '초등학생 이상',
     'quartet', 'dark', 'HANBIT CHAMBER 2026', E'현의\n대화', '겨울 실내악 시리즈',
     '{"runtime":"100분 (휴식 15분 포함)",
       "intro":["한빛아트센터 겨울 실내악 시리즈는 지역에서 활동하는 연주자들이 한 해를 마무리하며 꾸미는 무대입니다. 올해는 대화를 주제로, 네 개의 현악기가 서로 묻고 답하는 작품들을 골랐습니다.","공연 시작 20분 전부터 로비에서 해설이 있는 리허설을 공개합니다."],
       "items_title":"프로그램",
       "items":[{"name":"현악 사중주 D장조 Op.76 No.5 (하이든)","note":"약 20분"},{"name":"현악 사중주 g단조 Op.10 (드뷔시)","note":"약 25분"},{"name":"겨울, 강 (현악 사중주를 위한 위촉 초연)","note":"약 15분"}],
       "people":[{"name":"한지민","role":"제1바이올린"},{"name":"오세윤","role":"제2바이올린"},{"name":"박다온","role":"비올라"},{"name":"이준서","role":"첼로"}],
       "guide":"공연 시작 후에는 입장이 제한될 수 있습니다. 휠체어석은 R석 J열 양끝 4석이며, 예매 후 예약 문의 031-000-1200으로 알려 주시면 안내해 드립니다."}'::jsonb)
    returning id into p_chamber;
  insert into public.programs(type, title, summary, description, venue, audience, poster_image, poster_tone,
                              poster_series, poster_title, poster_sub, details) values
    ('PERFORMANCE', '한빛 청소년 연극제 「우리들의 무대」', '청소년 극단이 올리는 창작 연극',
     '지역 청소년 극단이 직접 쓰고 연출한 창작 연극입니다. 약 100분, 중간 휴식 10분.', '소극장', '중학생 이상',
     'theater', 'dark', '제7회 한빛 청소년 연극제', E'우리들의\n무대', '청소년 극단 세 팀의 창작극',
     '{"runtime":"100분 (휴식 10분 포함)",
       "intro":["지역 청소년 극단 세 팀이 한 학기 동안 직접 쓰고 연출한 창작극을 올립니다. 교실, 골목, 버스 정류장처럼 익숙한 장소에서 시작하는 이야기입니다.","무대 위 배우도, 무대 뒤 스태프도 모두 청소년입니다. 공연이 끝나면 로비에서 짧은 인사 시간을 갖습니다."],
       "items_title":"작품",
       "items":[{"name":"막차가 오기 전에 (달빛극단)","note":"약 30분"},{"name":"3학년 2반 교탁 (소리나무 극단)","note":"약 35분"},{"name":"옥상 정원 (빛나래 극단)","note":"약 35분"}],
       "people":[{"name":"달빛극단","role":"연출 정하준"},{"name":"소리나무 극단","role":"연출 권나연"},{"name":"빛나래 극단","role":"연출 서도윤"}],
       "guide":"공연 시작 후에는 입장이 제한될 수 있습니다. 작품 사이 휴식 시간에는 재입장이 가능합니다. 휠체어석 이용은 예약 문의 031-000-1200으로 알려 주세요."}'::jsonb)
    returning id into p_drama;
  insert into public.programs(type, title, summary, description, venue, audience, poster_image, poster_tone,
                              poster_series, poster_title, poster_sub, details) values
    ('EXPERIENCE', '가족 도자기 공방', '가족이 함께 빚는 나만의 접시',
     '흙 다루기부터 유약 선택까지 강사와 함께 접시 한 점을 만듭니다. 소요 약 2시간.', '창작공방', '초등학생 동반 가족',
     'pottery', 'dark', '주말 가족 체험', E'흙으로\n빚는 겨울', '가족 도자기 공방',
     '{"runtime":"약 2시간",
       "intro":["가족이 한 테이블에 둘러앉아 흙을 만지며 접시 한 점을 만듭니다. 처음 해 보는 분도 강사가 곁에서 도와드리니 걱정하지 않으셔도 됩니다.","완성한 작품은 건조와 유약, 소성을 거쳐 약 3주 뒤 공방에서 찾아가실 수 있습니다."],
       "items_title":"진행 순서",
       "items":[{"name":"흙 다루기와 밀기","note":"30분"},{"name":"접시 모양 만들기","note":"40분"},{"name":"무늬 넣기와 유약 고르기","note":"30분"},{"name":"정리와 작품 보관","note":"20분"}],
       "people":[],
       "guide":"흙이 묻을 수 있으니 편한 옷을 입고 오세요. 앞치마와 도구는 공방에서 준비합니다. 만 7세 미만 어린이는 보호자와 함께 신청해 주세요."}'::jsonb)
    returning id into p_pottery;
  insert into public.programs(type, title, summary, description, venue, audience, poster_image, poster_tone,
                              poster_series, poster_title, poster_sub, details) values
    ('EXPERIENCE', '무대 분장 체험', '무대 분장 기법을 배워 보는 체험',
     '무대 분장 전문가에게 기본 기법을 배우고 직접 분장해 봅니다. 소요 약 2시간.', '분장실', '중학생 이상',
     'makeup', 'dark', '무대 뒤 이야기', E'배우의\n얼굴', '무대 분장 체험',
     '{"runtime":"약 2시간",
       "intro":["무대 위에서는 멀리서도 표정이 보여야 합니다. 분장 전문가에게 기본 기법을 배우고, 서로의 얼굴에 직접 분장해 봅니다.","체험이 끝나면 분장한 모습을 사진으로 남길 수 있도록 촬영 공간을 마련해 두었습니다."],
       "items_title":"진행 순서",
       "items":[{"name":"무대 분장의 기초 설명","note":"20분"},{"name":"밑 화장과 윤곽 잡기","note":"40분"},{"name":"캐릭터 분장 따라 하기","note":"40분"},{"name":"촬영과 정리","note":"20분"}],
       "people":[],
       "guide":"피부가 민감하신 분은 신청 전에 예약 문의 031-000-1200으로 알려 주세요. 분장 도구는 모두 일회용 또는 소독한 것을 씁니다."}'::jsonb)
    returning id into p_makeup;
  insert into public.programs(type, title, summary, description, venue, audience, poster_image, poster_tone,
                              poster_series, poster_title, poster_sub, details) values
    ('COURSE', '시민 합창 교실 (12주)', '매주 함께 노래하는 12주 과정',
     '발성과 호흡부터 화음 맞추기까지 12주 동안 배웁니다. 매주 1회, 2시간.', '연습실', '성인',
     'choir', 'dark', '2027 봄학기 정규 강좌', E'함께\n부르는 노래', '시민 합창 교실 12주',
     '{"runtime":"매주 1회, 회당 2시간",
       "intro":["악보를 읽지 못해도 괜찮습니다. 호흡과 발성부터 천천히 익히고, 12주 동안 두 곡을 함께 완성합니다.","마지막 주에는 가족과 지인을 초대해 연습실에서 작은 발표 시간을 갖습니다."],
       "items_title":"커리큘럼",
       "items":[{"name":"1 - 3주","note":"호흡과 발성, 몸 풀기"},{"name":"4 - 6주","note":"단선율 노래와 리듬"},{"name":"7 - 9주","note":"2부 합창과 화음 맞추기"},{"name":"10 - 12주","note":"곡 다듬기와 발표"}],
       "people":[],
       "guide":"수강 신청은 개강 전까지 가능합니다. 첫 수업 전에 별도 준비물은 없으며, 악보와 연습 음원은 수업 시간에 나눠 드립니다."}'::jsonb)
    returning id into p_choir;
  insert into public.programs(type, title, summary, description, venue, audience, poster_image, poster_tone,
                              poster_series, poster_title, poster_sub, details) values
    ('COURSE', '생활 수채화 (12주)', '일상을 그리는 12주 수채화 과정',
     '기초 재료 다루기부터 풍경과 정물 완성까지 12주 동안 배웁니다. 매주 1회, 2시간.', '미술실', '성인',
     'watercolor', 'light', '2027 봄학기 정규 강좌', E'물빛으로\n그리는 일상', '생활 수채화 12주',
     '{"runtime":"매주 1회, 회당 2시간",
       "intro":["물감과 물의 양을 조절하는 기초부터 시작해, 일상에서 마주치는 정물과 풍경을 한 장씩 완성해 갑니다.","그림 경험이 없어도 신청하실 수 있습니다. 매 수업 끝에 작품을 함께 둘러보는 시간이 있습니다."],
       "items_title":"커리큘럼",
       "items":[{"name":"1 - 3주","note":"재료 이해와 번지기, 색 섞기"},{"name":"4 - 6주","note":"정물 그리기"},{"name":"7 - 9주","note":"풍경 그리기"},{"name":"10 - 12주","note":"주제 작품 완성과 감상"}],
       "people":[],
       "guide":"종이와 물감, 붓은 첫 수업에 기본 세트를 드립니다. 추가 재료는 개인이 준비해 주세요."}'::jsonb)
    returning id into p_water;

  -- 공연: 회차 base+10일, base+20일, 좌석제 R/S/A
  foreach pid in array array[p_chamber, p_drama] loop
    foreach d in array array[10, 20] loop
      m := case when d = 10 then 19 * 60 + 30 else 15 * 60 end;  -- 19:30, 15:00
      insert into public.offerings(program_id, starts_at, ends_at, capacity, sale_starts_at, sale_ends_at)
        values (pid, base + make_interval(days => d, mins => m), base + make_interval(days => d, mins => m + 120), 200,
                base - interval '7 days', base + make_interval(days => d, mins => m))
        returning id into oid;
      insert into public.offering_prices(offering_id, grade, price)
        values (oid, 'R', 40000), (oid, 'S', 30000), (oid, 'A', 20000);
      insert into public.inventory_seats(offering_id, seat_id) select oid, s.id from public.seats s;
    end loop;
  end loop;

  -- 체험: 회차 base+5일, base+12일, 정원 20, 10000원
  foreach pid in array array[p_pottery, p_makeup] loop
    foreach d in array array[5, 12] loop
      m := 14 * 60;  -- 14:00
      insert into public.offerings(program_id, starts_at, ends_at, capacity, sale_starts_at, sale_ends_at)
        values (pid, base + make_interval(days => d, mins => m), base + make_interval(days => d, mins => m + 120), 20,
                base - interval '7 days', base + make_interval(days => d, mins => m))
        returning id into oid;
      insert into public.offering_prices(offering_id, grade, price) values (oid, null, 10000);
    end loop;
  end loop;

  -- 정규 강좌: 첫 회 base+9일, 주 1회 12회, 정원 15, 120000원
  foreach pid in array array[p_choir, p_water] loop
    m := case when pid = p_choir then 19 * 60 else 10 * 60 + 30 end;  -- 19:00, 10:30
    insert into public.offerings(program_id, starts_at, ends_at, capacity, sale_starts_at, sale_ends_at)
      values (pid, base + make_interval(days => 9, mins => m), base + make_interval(days => 9 + 7 * 11, mins => m + 120), 15,
              base - interval '7 days', base + make_interval(days => 9, mins => m))
      returning id into oid;
    insert into public.offering_prices(offering_id, grade, price) values (oid, null, 120000);
    for w in 1..12 loop
      insert into public.course_lessons(offering_id, seq, starts_at)
        values (oid, w, base + make_interval(days => 9 + 7 * (w - 1), mins => m));
    end loop;
  end loop;
end $$;

revoke all on function public.seed_demo(timestamptz) from public, anon, authenticated;
grant execute on function public.seed_demo(timestamptz) to service_role;
