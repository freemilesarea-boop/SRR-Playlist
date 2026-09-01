-- ============================================================================
-- 0490_enterprise_store_signup_region_optional.sql
-- Phase ENTERPRISE-STORE-SIGNUP-REGION-SELFSERVE-1
--
-- 번호 이력: 0465 → 0487(#526) → 0490.
--   #526 과 #527 이 같은 날 각각 0487 을 써서 prefix 가 중복됐고
--   lint:migrations(duplicate-prefix)가 그때부터 실패하고 있었다.
--   prod 적용 여부를 확인한 결과 0487_broadcast_filter_payout_pii_incomplete(#527)만
--   적용돼 있고 이 파일은 미적용이라, 적용된 쪽을 두고 이 파일을 옮겼다.
--   (docs/migrations.md — allowlist 확장은 이미 prod 반영된 경우에만.)
--
-- ⚠ 이 마이그레이션은 아직 prod 에 적용되지 않았다. #526 의 프론트엔드는 이미 배포돼
--   지역을 선택 입력으로 받는데 서버 함수는 여전히 region_name 을 필수로 요구하므로,
--   지역을 비우고 가입하면 실패한다. 적용 필요.
--
-- 목적: 엔터프라이즈 가맹(매장 셀프) 회원가입에서 "지역(region)"을 회원이 직접
--   입력·등록할 수 있게 한다.
--   기존: claim_enterprise_store_account 는 (a) region_name 을 필수로 요구하고,
--         (b) 신규 지역 자동 등록은 enterprise_accounts.allow_self_register_region=true
--         인 경우에만 허용 → 관리자가 미리 지역을 등록하지 않으면 가맹점이 가입 불가.
--   변경: 매장 셀프 가입 시 회원이 자기 지역을 자유롭게 입력하면 그 지역을
--         enterprise_regions 에 신규 등록(status='active', created_by=회원)하여
--         관리자 페이지(admin_list_enterprise_regions)에 데이터로 즉시 노출한다.
--         지역은 선택 입력 — 비워두면 지역 없이 가입(본사가 나중에 배정).
--
-- 불변식(보존):
--   • 0363 본문 100% 보존 — region 처리부만 변경. business 계정/withdrawn/
--     primary-franchise/franchise_stores upsert/claims 감사/return 경로 전부 불변.
--   • franchise_stores.enterprise_region_id 는 nullable → 지역 없이 null 로 생성.
--   • 이미 등록된 지역명을 입력하면 기존 지역에 매칭(중복 생성 없음).
--
-- 변경(3곳):
--   ① `region_name required` 예외 제거(선택 입력).
--   ② 신규 지역 자동 등록의 allow_self_register_region 게이트 제거 →
--      매장 셀프 가입은 항상 회원 입력 지역을 신규 등록(관리자 사전등록 불필요).
--   ③ region 매칭/등록을 `if v_region_name <> ''` 로 감싸 미입력 시 건너뜀.
-- ============================================================================
create or replace function public.claim_enterprise_store_account(
  p_brand_name text,
  p_invite_code text,
  p_store_name text,
  p_region_name text,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_user public.users;
  v_validate jsonb;
  v_ea_id uuid;
  v_ea public.enterprise_accounts;
  v_region public.enterprise_regions;
  v_franchise_id uuid;
  v_store public.franchise_stores;
  v_claim_id uuid;
  v_last4 text;
  v_brand text := btrim(coalesce(p_brand_name, ''));
  v_store_name text := btrim(coalesce(p_store_name, ''));
  v_region_name text := btrim(coalesce(p_region_name, ''));
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if v_store_name = '' then raise exception 'store_name required'; end if;
  -- 🆕 0490: 지역(region)은 선택 입력 — required 예외 제거(미입력이어도 가입 진행).

  -- users.account_type='business' AND withdrawn_at IS NULL (0362 일관 기준)
  select * into v_user from public.users where id = v_uid;
  if v_user.id is null then
    raise exception 'users row not found — 가입 직후 동기화 지연 가능 (잠시 후 재시도)';
  end if;
  if v_user.withdrawn_at is not null then raise exception 'user withdrawn'; end if;
  if coalesce(v_user.account_type, 'individual') <> 'business' then
    raise exception 'business 계정만 매장 가입이 가능합니다.';
  end if;

  v_validate := public.validate_enterprise_invite(p_brand_name, p_invite_code, 'store');
  if not coalesce((v_validate->>'success')::boolean, false) then
    return jsonb_build_object('success', false,
                              'reason', coalesce(v_validate->>'reason', '검증 실패'));
  end if;

  v_ea_id := (v_validate->>'enterprise_account_id')::uuid;
  v_last4 := right(upper(btrim(coalesce(p_invite_code, ''))), 4);
  select * into v_ea from public.enterprise_accounts where id = v_ea_id;

  -- region 매칭/자가등록 — 🆕 0490
  --   • 지역이 입력되면: 기존 등록 지역과 매칭, 없으면 회원이 입력한 지역을 신규 등록.
  --     관리자 사전 등록 불필요(allow_self_register_region 설정과 무관). 신규 지역은
  --     enterprise_regions(status='active', created_by=회원)로 저장되어 관리자 페이지
  --     (admin_list_enterprise_regions)에 즉시 데이터로 노출된다.
  --   • 지역이 비어 있으면(선택 입력): 지역 없이 진행(enterprise_region_id null).
  if v_region_name <> '' then
    select * into v_region
      from public.enterprise_regions
     where enterprise_account_id = v_ea_id
       and lower(btrim(region_name)) = lower(v_region_name)
       and deleted_at is null
     limit 1;

    if v_region.id is null then
      insert into public.enterprise_regions
        (enterprise_account_id, region_name, region_code, status, created_by, updated_by)
      values
        (v_ea_id, v_region_name,
         upper(substr(regexp_replace(v_region_name, '\s+', '', 'g'), 1, 12)),
         'active', v_uid, v_uid)
      returning * into v_region;
    end if;
  end if;

  -- enterprise → primary franchise
  select franchise_id into v_franchise_id
    from public.enterprise_franchises
   where enterprise_account_id = v_ea_id
     and role = 'primary'
     and status = 'active'
     and deleted_at is null
   limit 1;

  if v_franchise_id is null then
    insert into public.enterprise_invite_claims
      (enterprise_account_id, user_id, claim_type, invite_code_last4,
       brand_name_input, store_name_input, region_name_input,
       status, failure_reason, user_agent)
    values
      (v_ea_id, v_uid, 'store', v_last4, v_brand, v_store_name, v_region_name,
       'failed', 'primary franchise not configured', p_user_agent);
    raise exception '본사 프랜차이즈 설정이 완료되지 않았습니다. 관리자에게 문의하세요.';
  end if;

  -- franchise_stores upsert (franchise_id, store_id) unique 활용
  insert into public.franchise_stores
    (franchise_id, region_id, store_id, store_name, status, enterprise_region_id)
  values
    (v_franchise_id, null, v_uid, v_store_name, 'active', v_region.id)
  on conflict (franchise_id, store_id) do update set
    store_name = coalesce(excluded.store_name, public.franchise_stores.store_name),
    enterprise_region_id = coalesce(excluded.enterprise_region_id, public.franchise_stores.enterprise_region_id),
    status = 'active'
  returning * into v_store;

  insert into public.enterprise_invite_claims
    (enterprise_account_id, franchise_id, user_id, claim_type, invite_code_last4,
     brand_name_input, store_name_input, region_name_input,
     status, user_agent)
  values
    (v_ea_id, v_franchise_id, v_uid, 'store', v_last4,
     v_brand, v_store_name, v_region_name,
     'success', p_user_agent)
  returning id into v_claim_id;

  return jsonb_build_object(
    'success', true,
    'enterprise_account_id', v_ea_id,
    'franchise_id', v_franchise_id,
    'enterprise_region_id', v_region.id,
    'franchise_store_id', v_store.id,
    'claim_id', v_claim_id
  );
end;
$$;
revoke execute on function public.claim_enterprise_store_account(text, text, text, text, text) from public, anon;
grant execute on function public.claim_enterprise_store_account(text, text, text, text, text) to authenticated;

-- ============================================================================
-- 진단(diagnostics) — 적용 후 즉시 확인용(무해).
-- ============================================================================
do $$
declare n int;
begin
  select count(*) into n from pg_proc where proname = 'claim_enterprise_store_account';
  raise notice '[0490] claim_enterprise_store_account 정의 % 개 (지역 회원 자가입력/등록)', n;
end$$;
