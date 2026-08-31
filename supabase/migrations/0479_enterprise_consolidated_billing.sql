-- ============================================================================
-- 0479_enterprise_consolidated_billing.sql
-- 본사 '일괄청구(consolidated billing)' — 브랜드 체크 → 신규 가맹점 자동 인식 →
--   본사 청구예정액 실시간 상승 → 매월 1일 자동 청구서 생성.
--
-- 배경: 청구 인프라는 이미 존재한다.
--   · 신규 가맹점은 claim_enterprise_store_account() 로 브랜드(본사)에 즉시 active 연결.
--   · _enterprise_active_store_count() × _enterprise_monthly_store_price() = 청구액.
--   · admin_generate_enterprise_billing_invoice() 가 draft 청구서 + 라인아이템 생성(멱등).
--   빠진 것은 (a) '일괄청구 대상' 명시 토글, (b) 실시간 청구예정액 조회,
--   (c) 매월 자동 생성 크론 — 이 3가지를 추가한다.
--
-- 안전: 자동화는 'draft 청구서 생성'까지만. 발행/수금은 관리자 수동(기존 lifecycle 유지).
--   플래그는 opt-in(기본 false) — 명시적으로 체크한 본사만 대상.
-- ============================================================================

-- (0) 일괄청구 대상 플래그 (opt-in)
alter table public.enterprise_accounts
  add column if not exists consolidated_billing_enabled boolean not null default false;

comment on column public.enterprise_accounts.consolidated_billing_enabled is
  '일괄청구 대상 여부. true면 매월 1일 자동 청구서 생성 + 실시간 청구예정액 집계 대상.';

-- (1) 관리자 토글 — 브랜드(본사) 일괄청구 on/off
create or replace function public.admin_set_enterprise_consolidated_billing(
  p_enterprise_account_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_name text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_enterprise_account_id is null then raise exception 'enterprise_account_id required'; end if;

  update public.enterprise_accounts
     set consolidated_billing_enabled = coalesce(p_enabled, false),
         updated_by = v_uid, updated_at = now()
   where id = p_enterprise_account_id and deleted_at is null
  returning enterprise_name into v_name;

  if v_name is null then raise exception 'enterprise account not found'; end if;

  perform public.admin_log_operation(
    'enterprise_billing', 'enterprise_billing.consolidated.toggle', 'info',
    case when p_enabled then 'enabled' else 'disabled' end,
    format('일괄청구 %s — %s', case when p_enabled then 'ON' else 'OFF' end, v_name),
    jsonb_build_object('enterprise_account_id', p_enterprise_account_id, 'enabled', p_enabled),
    v_uid, p_enterprise_account_id::text, null, null, null
  );

  return jsonb_build_object('success', true,
    'enterprise_account_id', p_enterprise_account_id, 'enabled', coalesce(p_enabled, false));
end;
$$;
revoke all on function public.admin_set_enterprise_consolidated_billing(uuid, boolean) from public;
grant execute on function public.admin_set_enterprise_consolidated_billing(uuid, boolean) to authenticated, service_role;

-- (2) 실시간 청구예정액 — 전체 본사(토글 UI용) (활성매장 × 단가) + 이번 달 청구서 상태.
--     관리자가 체크/해제할 수 있도록 consolidated 여부 무관하게 활성 본사를 모두 반환.
create or replace function public.admin_enterprise_consolidated_billing_preview()
returns table(
  enterprise_account_id uuid,
  enterprise_name text,
  brand_code text,
  consolidated_billing_enabled boolean,
  active_store_count int,
  monthly_store_price int,
  projected_amount bigint,
  current_month date,
  current_invoice_id uuid,
  current_invoice_status text,
  current_invoice_total bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_month date := date_trunc('month', (now() at time zone 'Asia/Seoul'))::date;
begin
  if not public._is_super_admin() then return; end if;
  return query
  select ea.id, ea.enterprise_name, ea.brand_code, ea.consolidated_billing_enabled,
         cnt.c, price.p, (cnt.c::bigint * price.p::bigint),
         v_month, inv.id, inv.status, inv.total_amount::bigint
  from public.enterprise_accounts ea
  cross join lateral (select public._enterprise_active_store_count(ea.id) as c) cnt
  cross join lateral (select public._enterprise_monthly_store_price(ea.id) as p) price
  left join lateral (
    select i.id, i.status, i.total_amount
    from public.enterprise_billing_invoices i
    where i.enterprise_account_id = ea.id and i.billing_month = v_month and i.deleted_at is null
    order by i.created_at desc limit 1
  ) inv on true
  where ea.deleted_at is null
    and ea.status in ('active','invited')
  order by ea.consolidated_billing_enabled desc, (cnt.c::bigint * price.p::bigint) desc, ea.enterprise_name;
end;
$$;
revoke all on function public.admin_enterprise_consolidated_billing_preview() from public;
grant execute on function public.admin_enterprise_consolidated_billing_preview() to authenticated, service_role;

-- (3) 매월 자동 생성 크론 함수 — 일괄청구 대상 본사만, 이번 달 draft 청구서 생성(멱등)
create or replace function public.cron_generate_enterprise_billing(p_month date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_month date := coalesce(date_trunc('month', p_month)::date,
                           date_trunc('month', (now() at time zone 'Asia/Seoul'))::date);
  v_admin uuid;
  v_ea record;
  v_res jsonb;
  v_created int := 0;
  v_skipped int := 0;
begin
  -- 시스템 admin 컨텍스트(생성 RPC 의 super_admin 게이트 통과 + 감사 created_by)
  select id into v_admin from public.users where role = 'admin' order by created_at limit 1;
  if v_admin is null then
    return jsonb_build_object('ok', false, 'error', 'no_admin', 'month', v_month);
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  for v_ea in
    select id, enterprise_name from public.enterprise_accounts
     where deleted_at is null and consolidated_billing_enabled = true
       and status in ('active','invited')
     order by enterprise_name
  loop
    -- 이미 이번 달 청구서 있으면 skip (생성 RPC 도 멱등이지만 카운트 위해 선확인)
    if exists (select 1 from public.enterprise_billing_invoices
                where enterprise_account_id = v_ea.id and billing_month = v_month and deleted_at is null) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_res := public.admin_generate_enterprise_billing_invoice(v_month, v_ea.id, null, 0, false);
    v_created := v_created + coalesce((v_res->>'created_count')::int, 0);
  end loop;

  if v_created > 0 then
    insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
    values ('enterprise_billing_ready', 'warning',
      to_char(v_month, 'YYYY-MM') || ' 본사 일괄청구서 자동 생성 — 발행 검토 필요',
      to_char(v_month, 'YYYY-MM') || '월 일괄청구 대상 본사의 청구서(draft)가 자동 생성되었습니다. '
        || '관리자 페이지에서 검토 후 발행/수금하세요. (자동 생성은 draft 까지이며 발행/수금은 하지 않습니다.)',
      jsonb_build_object('billing_month', v_month, 'created', v_created, 'skipped', v_skipped),
      0, now());
  end if;

  return jsonb_build_object('ok', true, 'month', v_month, 'created', v_created, 'skipped', v_skipped);
exception when others then
  insert into public.admin_notifications (kind, severity, title, body, dispatch_attempts, created_at)
  values ('enterprise_billing_ready', 'error',
    '본사 일괄청구서 자동 생성 실패 (' || coalesce(v_month::text, '?') || ')',
    '자동 생성 중 오류: ' || sqlerrm || ' — 관리자가 수동 생성해 주세요.', 0, now());
  return jsonb_build_object('ok', false, 'error', sqlerrm, 'month', v_month);
end;
$$;
revoke all on function public.cron_generate_enterprise_billing(date) from public;
grant execute on function public.cron_generate_enterprise_billing(date) to service_role;

-- (4) 매월 1일 09:10 KST(00:10 UTC) 자동 생성 — 아티스트 정산(00:00)과 10분 간격
select cron.schedule(
  'srr-enterprise-billing-autogen',
  '10 0 1 * *',
  $cron$select public.cron_generate_enterprise_billing();$cron$
);
