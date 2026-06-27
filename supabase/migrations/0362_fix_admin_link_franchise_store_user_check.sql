-- 0362 — Hotfix: admin_link_franchise_store user 검사 컬럼 정합성
--
-- 원인:
--   0349:778 의 admin_link_franchise_store 가 사용자 자격을 subscription_type='business'
--   로 게이트.
--   실제 프로젝트 데이터:
--     - account_type='business' 인 사용자가 비즈니스 매장
--     - subscription_type 는 'individual' / 'free' 등 별개 플랜
--   결과: 정상적인 비즈니스 매장도 'store user must be business plan' 으로 reject 됨.
--
-- 프로젝트 전반의 비즈니스 판별 기준 (참고):
--   - salesperson_my_stores (0350:44): account_type='business' AND withdrawn_at IS NULL
--   - store_now_playing view (0357:84): account_type='business' AND withdrawn_at IS NULL
--   - admin_list_store_monitoring (0357:147): account_type='business' AND withdrawn_at IS NULL
--
-- 수정:
--   - admin_link_franchise_store RPC 안의 사용자 자격 검사만 교체
--   - subscription_type 조건 제거
--   - account_type='business' AND withdrawn_at IS NULL 로 변경 (프로젝트 일관)
--   - 시그니처 / RETURNS / GRANT / INSERT/ON CONFLICT 본문 모두 동일
--
-- 절대 금지:
--   - DB 스키마 / 인덱스 / RLS 변경 X
--   - 다른 RPC 변경 X
--   - frontend / API wrapper 변경 X

create or replace function public.admin_link_franchise_store(
  p_franchise_id uuid, p_store_id uuid, p_region_id uuid default null, p_store_name text default null
)
returns public.franchise_stores
language plpgsql security definer set search_path to 'public' as $$
declare v_row public.franchise_stores;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  -- 0362 fix: subscription_type → account_type + withdrawn_at (프로젝트 일관 기준)
  if not exists (
    select 1 from public.users
     where id = p_store_id
       and account_type = 'business'
       and withdrawn_at is null
  ) then
    raise exception 'store user must be business account: %', p_store_id;
  end if;
  insert into public.franchise_stores (franchise_id, region_id, store_id, store_name)
  values (p_franchise_id, p_region_id, p_store_id, p_store_name)
  on conflict (franchise_id, store_id) do update set
    region_id = excluded.region_id, store_name = coalesce(excluded.store_name, public.franchise_stores.store_name),
    status = 'active'
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.admin_link_franchise_store(uuid, uuid, uuid, text) to authenticated;

comment on function public.admin_link_franchise_store(uuid, uuid, uuid, text) is
  '0362 hotfix — user 검사를 account_type=business + withdrawn_at IS NULL 로 변경. 시그니처/로직 불변.';


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_rpc int;
  v_src text;
  v_uses_account_type boolean := false;
  v_still_uses_subscription_type boolean := false;
begin
  select count(*) into v_rpc from pg_proc where proname = 'admin_link_franchise_store';

  select prosrc into v_src
    from pg_proc
   where proname = 'admin_link_franchise_store'
   limit 1;
  v_uses_account_type := v_src ilike '%account_type%';
  v_still_uses_subscription_type := v_src ilike '%subscription_type%';

  raise notice '====== 0362 admin_link_franchise_store Hotfix Diagnostics ======';
  raise notice 'RPC count: % / 1', v_rpc;
  raise notice 'uses account_type: % (expect true)', v_uses_account_type;
  raise notice 'still uses subscription_type: % (expect false)', v_still_uses_subscription_type;
  raise notice '===============================================================';

  if v_rpc = 1 and v_uses_account_type and not v_still_uses_subscription_type then
    raise notice '0362 HOTFIX COMPLETE — admin_link_franchise_store 정상';
  else
    raise warning '0362 HOTFIX INCOMPLETE — 위 결과 확인 필요';
  end if;
end$$;
