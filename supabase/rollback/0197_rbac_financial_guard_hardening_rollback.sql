-- Rollback for 0197_rbac_financial_guard_hardening.sql
-- 가드만 원복(super_admin → role='admin'). 함수 본문은 그대로(byte-identical). additive 원복.
-- ⚠ 원복 시 reviewer/sales/curator(=users.role='admin')가 다시 정산/지급/계좌에 접근 가능해짐.
-- ⚠⚠ (0) 헬퍼 coalesce 원복은 일반 사용자 granular 가드 우회 P0 를 다시 연다 — 전체 되돌릴 때만 사용.

-- (0) RBAC 헬퍼 원복 (NULL 반환 버전 — ⚠ P0 재오픈)
create or replace function public.is_super_admin() returns boolean language sql stable security definer set search_path to 'public' as $f$ select public.current_admin_role() = 'super_admin'; $f$;
create or replace function public.can_manage_tracks() returns boolean language sql stable security definer set search_path to 'public' as $f$ select public.current_admin_role() in ('super_admin','content_admin'); $f$;
create or replace function public.can_review_tracks() returns boolean language sql stable security definer set search_path to 'public' as $f$ select public.current_admin_role() in ('super_admin','content_admin','reviewer'); $f$;
create or replace function public.can_manage_curation() returns boolean language sql stable security definer set search_path to 'public' as $f$ select public.current_admin_role() in ('super_admin','curator_admin'); $f$;
create or replace function public.can_manage_sales() returns boolean language sql stable security definer set search_path to 'public' as $f$ select public.current_admin_role() in ('super_admin','sales_admin'); $f$;
create or replace function public.can_override_guardrails() returns boolean language sql stable security definer set search_path to 'public' as $f$ select public.current_admin_role() = 'super_admin'; $f$;
create or replace function public.can_manage_admins() returns boolean language sql stable security definer set search_path to 'public' as $f$ select public.current_admin_role() = 'super_admin'; $f$;

-- (1) 정산/지급/계좌: is_super_admin() → 기존 role='admin' 술어로 환원 (멱등)
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
      'public\.is_super_admin\(\)',
      'exists (select 1 from public.users u where u.id = v_uid and u.role = ''admin'')',
      'g');
    if v_new <> v_def then execute v_new; end if;
  end loop;
end $$;

-- (2) admin_get_setting — 원본(가드 없음) 복원
create or replace function public.admin_get_setting(p_key text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_val jsonb;
begin
  select value into v_val from public.admin_settings where key = p_key;
  return v_val;
end; $function$;

-- (3) admin_log_operation — 원본(가드 없음) 복원
create or replace function public.admin_log_operation(
  p_source text, p_category text, p_level text, p_status text, p_message text,
  p_details jsonb default '{}'::jsonb, p_user_id uuid default null::uuid,
  p_related_id text default null::text, p_duration_ms integer default null::integer,
  p_error_code text default null::text, p_error_message text default null::text)
returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid;
begin
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
