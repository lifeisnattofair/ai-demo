-- seed.sql: 데모 전용 계정 5개와 프로필, 기본 시드 데이터.
-- 비밀번호는 데모 전용 값입니다 (README 시연 안내와 동일): Demo-1234!
-- supabase db reset 때만 실행됩니다. seed_demo()는 계정을 지우지 않습니다.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       extensions.crypt('Demo-1234!', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
       '', '', '', ''
from (values
  ('00000000-0000-4000-8000-000000000001'::uuid, 'member1@demo.test'),
  ('00000000-0000-4000-8000-000000000002'::uuid, 'member2@demo.test'),
  ('00000000-0000-4000-8000-000000000003'::uuid, 'member3@demo.test'),
  ('00000000-0000-4000-8000-000000000011'::uuid, 'operator@demo.test'),
  ('00000000-0000-4000-8000-000000000012'::uuid, 'finance@demo.test')
) as u(id, email)
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u
where u.email like '%@demo.test'
  and not exists (select 1 from auth.identities i where i.user_id = u.id);

insert into public.profiles (id, name, phone, role, verified_at) values
  ('00000000-0000-4000-8000-000000000001', '회원 하나', '010-0000-0001', 'member', now()),
  ('00000000-0000-4000-8000-000000000002', '회원 둘', '010-0000-0002', 'member', now()),
  ('00000000-0000-4000-8000-000000000003', '회원 셋', '010-0000-0003', 'member', now()),
  ('00000000-0000-4000-8000-000000000011', '운영 담당', '010-0000-0011', 'operator', now()),
  ('00000000-0000-4000-8000-000000000012', '재무 담당', '010-0000-0012', 'finance', now())
on conflict (id) do nothing;

select public.seed_demo(date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul');
