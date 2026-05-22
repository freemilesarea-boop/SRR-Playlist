-- 0120 — users 권한 상승 차단 (치명 보안 수정)
--   기존: users_update_self RLS(auth.uid()=id) + 테이블 전체 UPDATE 권한 → 일반 사용자가
--   본인 row 의 role='admin' / membership_tier='business' 를 직접 set 가능 (권한/결제등급 상승).
--   조치: authenticated/anon 의 테이블 UPDATE 회수 후, role/membership_tier 를 제외한
--   전 컬럼에만 컬럼 단위 UPDATE 권한 부여. role/membership_tier 는 SECURITY DEFINER
--   함수(owner=postgres: webhook/정산/계약/탈퇴/관리자 RPC)만 변경 가능 (컬럼 GRANT 우회).
--   additive/비파괴: 데이터·컬럼·타입·RLS 정책 변경 없음. 권한만 축소.
revoke update on public.users from authenticated;
revoke update on public.users from anon;

do $$
declare v_cols text;
begin
  select string_agg(format('%I', column_name), ', ')
    into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'users'
    and column_name not in ('role', 'membership_tier');
  execute format('grant update (%s) on public.users to authenticated', v_cols);
end $$;
