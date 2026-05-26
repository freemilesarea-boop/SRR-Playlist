-- 0197 — PR-A: RBAC 보안 하드닝 (additive, 가드만 변경 — 함수 본문 로직 불변)
--
-- 배경(감사 결과, 라이브 introspection 으로 확인):
--   정산/지급/계좌 RPC 는 가드가 role='admin' 뿐이고, admin_add_admin 이 모든 하위역할을
--   users.role='admin' 으로 승격하므로 reviewer/sales_admin/curator_admin 도 호출 가능(잠재 권한상승).
--   admin_get_setting / admin_log_operation 은 내부 가드가 전혀 없어 일반 authenticated 도 호출 가능.
--
-- 조치:
--   (1) 정산/지급/계좌 4종 → super_admin 전용. 라이브 함수 정의를 읽어 "가드 술어만" 치환
--       (본문은 byte-identical 로 보존 → 정산 로직/eligibility 필터에 절대 영향 없음). 멱등.
--   (2) admin_get_setting → 비-admin 차단 (admin_set_setting 과 동일한 role='admin' 가드).
--   (3) admin_log_operation → 비-admin 차단 (서비스롤/관리자 허용; _internal_is_admin_caller).
--
-- 기존 super_admin 동작은 그대로 유지. drop/rename 없음. rollback 스크립트 제공.
--
-- ★★ 추가 발견 (검증된 라이브 P0) ★★
--   RBAC 헬퍼(is_super_admin / can_*)가 `current_admin_role() = X` / `in (...)` 형태라
--   비-admin(역할 없음) 호출 시 NULL 을 반환한다. 0193 가드는 `if not can_xxx() then raise`
--   패턴이므로 `if not NULL` = NULL → IF 가 거짓 처리 → raise 미실행 → **일반 로그인 사용자가
--   admin_bulk_delete_tracks / admin_takedown_track / admin_sales_agent_list 등 granular 가드
--   함수를 전부 우회**(라이브 트랜잭션 테스트로 확인). 아래 (0) 에서 헬퍼를 coalesce(...,false)로
--   고쳐 모든 granular 가드를 한 번에 차단한다.

-- (0) ★P0★ RBAC 헬퍼 NULL→false 보정 (모든 granular 가드 우회 차단). 시그니처/의미 동일, 멱등.
create or replace function public.is_super_admin() returns boolean language sql stable security definer set search_path to 'public' as $f$ select coalesce(public.current_admin_role() = 'super_admin', false); $f$;
create or replace function public.can_manage_tracks() returns boolean language sql stable security definer set search_path to 'public' as $f$ select coalesce(public.current_admin_role() in ('super_admin','content_admin'), false); $f$;
create or replace function public.can_review_tracks() returns boolean language sql stable security definer set search_path to 'public' as $f$ select coalesce(public.current_admin_role() in ('super_admin','content_admin','reviewer'), false); $f$;
create or replace function public.can_manage_curation() returns boolean language sql stable security definer set search_path to 'public' as $f$ select coalesce(public.current_admin_role() in ('super_admin','curator_admin'), false); $f$;
create or replace function public.can_manage_sales() returns boolean language sql stable security definer set search_path to 'public' as $f$ select coalesce(public.current_admin_role() in ('super_admin','sales_admin'), false); $f$;
create or replace function public.can_override_guardrails() returns boolean language sql stable security definer set search_path to 'public' as $f$ select coalesce(public.current_admin_role() = 'super_admin', false); $f$;
create or replace function public.can_manage_admins() returns boolean language sql stable security definer set search_path to 'public' as $f$ select coalesce(public.current_admin_role() = 'super_admin', false); $f$;

-- (1) 정산/지급/계좌 RPC: 가드 술어 role='admin' → public.is_super_admin() (본문 보존, 멱등)
do $$
declare r record; v_def text; v_new text;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'admin_finalize_settlement', 'admin_mark_settlement_paid',
      'admin_generate_monthly_settlement', 'admin_reveal_payout_account')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := regexp_replace(
      v_def,
      'exists\s*\(\s*select\s+1\s+from\s+public\.users\s+u\s+where\s+u\.id\s*=\s*v_uid\s+and\s+u\.role\s*=\s*''admin''\s*\)',
      'public.is_super_admin()',
      'g');
    if v_new <> v_def then
      execute v_new;
      raise notice '[0197] hardened guard → super_admin: %', r.proname;
    else
      raise warning '[0197] guard pattern NOT matched (검토 필요): %', r.proname;
    end if;
  end loop;
end $$;

-- (2) admin_get_setting — 비-admin 차단 (정보노출 방지). 본문 동일 + 선두 가드.
create or replace function public.admin_get_setting(p_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_val jsonb;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  select value into v_val from public.admin_settings where key = p_key;
  return v_val;
end; $function$;

-- (3) admin_log_operation — 비-admin 차단(감사로그 위조 방지). 서비스롤/관리자만 기록 가능.
--     본문은 라이브 정의와 동일, 선두에 가드만 추가. 비허용 caller 는 조용히 null 반환(호출자 비차단 원칙 유지).
create or replace function public.admin_log_operation(
  p_source text, p_category text, p_level text, p_status text, p_message text,
  p_details jsonb default '{}'::jsonb, p_user_id uuid default null::uuid,
  p_related_id text default null::text, p_duration_ms integer default null::integer,
  p_error_code text default null::text, p_error_message text default null::text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid;
begin
  -- 0197: 비-admin(일반 authenticated/anon) 의 로그 위조 차단. 서비스롤·관리자만 허용.
  if not public._internal_is_admin_caller() then
    return null;
  end if;
  insert into public.admin_operation_logs
    (source, category, level, status, message, details, user_id,
     related_id, duration_ms, error_code, error_message)
  values (
    coalesce(nullif(btrim(p_source), ''), 'unknown'),
    coalesce(nullif(btrim(p_category), ''), 'system'),
    case when p_level in ('info','success','warning','error') then p_level else 'info' end,
    coalesce(nullif(btrim(p_status), ''), 'unknown'),
    coalesce(nullif(btrim(p_message), ''), '(empty)'),
    coalesce(p_details, '{}'::jsonb),
    p_user_id, p_related_id, p_duration_ms, p_error_code, p_error_message
  )
  returning id into v_id;
  return v_id;
exception when others then
  return null;
end;
$function$;

-- 확인: 4종이 더 이상 legacy role='admin' 가드를 쓰지 않는지
select p.proname,
  (p.prosrc ~* 'role\s*=\s*''admin''') as still_legacy_admin,
  (p.prosrc ~* 'is_super_admin') as uses_super_admin
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'admin_finalize_settlement','admin_mark_settlement_paid',
  'admin_generate_monthly_settlement','admin_reveal_payout_account',
  'admin_get_setting','admin_log_operation')
order by p.proname;
