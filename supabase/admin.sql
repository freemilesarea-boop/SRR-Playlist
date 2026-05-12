-- ============================================
-- 관리자 승격 SQL
-- 가입 후 SQL Editor 에서 실행하세요.
-- ============================================

-- 1) 가입된 user_id 확인
select id, email, created_at
from auth.users
where email = 'freemilesarea@gmail.com';

-- 2) role 을 admin 으로 변경
update public.users
set role = 'admin'
where id = (
  select id from auth.users where email = 'freemilesarea@gmail.com'
);

-- 3) 적용 확인
select u.id, u.nickname, u.role, u.subscription_type, au.email
from public.users u
join auth.users au on au.id = u.id
where u.role = 'admin';

-- 기대 결과: 1행, role = 'admin', email = 'freemilesarea@gmail.com'
