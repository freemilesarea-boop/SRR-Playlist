-- 0124 — 탈퇴 회원 이메일 해제(재가입 허용)용 컬럼 (additive only)
--   original_email: 탈퇴 시점의 원본 이메일 보존(정산/계약 식별).
--   email_released_at: auth.users 이메일을 masked 로 변경(해제)한 시각.
--   기존 컬럼/데이터 변경 없음. authenticated 직접 UPDATE 권한 없음(테이블 UPDATE 회수됨 — 0120).
alter table public.users
  add column if not exists original_email text,
  add column if not exists email_released_at timestamptz;
