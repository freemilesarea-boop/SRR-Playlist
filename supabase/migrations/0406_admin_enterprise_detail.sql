-- 0406 — Phase ENT-DETAIL-1: Admin Enterprise Detail (Franchise HQ Ops Console)
--
-- 목적:
--   관리자(CS/운영) 가 본사 1곳의 기본정보 · 초대코드 · 매장요약 · 매장목록(플레이어 상태) ·
--   계약 · 정산 · 음악정책 · 감사로그를 한 번의 RPC 로 조회.
--
-- 절대 원칙:
--   • 조회 전용 (SELECT). 기존 테이블/데이터 무변경 — additive RPC 하나만 추가.
--   • 관리자 전용: public._is_super_admin() (users.role='admin' or service_role) 게이트.
--   • null-safe: 데이터 없는 섹션은 빈 배열/ null 반환 (프런트 empty state).
--   • 코드 재발급/계약/매장 write 없음 (조회만).
--
-- 연결 구조 (실측):
--   enterprise_accounts → enterprise_franchises(enterprise_account_id→franchise_id)
--     → franchise_stores(store registry) → store_policy_sync_status(player 상태) / users(업종)
--   지역: enterprise_regions.  계약: enterprise_contracts.  정산: enterprise_monthly_settlements.
--   음악정책: franchise_music_policies(+versions).  감사: admin_operation_logs.
--   코드: enterprise_accounts.hq_invite_code / store_invite_code / brand_code (평문).

create or replace function public.admin_get_enterprise_detail(p_enterprise_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ea public.enterprise_accounts%rowtype;
  v jsonb;
  v_franchise_ids uuid[];
begin
  -- 권한: 관리자만
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;

  select * into v_ea from public.enterprise_accounts where id = p_enterprise_id;
  if not found then
    raise exception 'enterprise not found';
  end if;

  -- 이 본사에 연결된 franchise id 집합 (매장/정책 스코프)
  select coalesce(array_agg(ef.franchise_id), '{}')
    into v_franchise_ids
    from public.enterprise_franchises ef
   where ef.enterprise_account_id = p_enterprise_id and ef.deleted_at is null;

  v := jsonb_build_object(
    -- A. 본사 기본 정보 (deleted_at 포함 — 관리자용)
    'enterprise', jsonb_build_object(
      'id', v_ea.id, 'enterprise_name', v_ea.enterprise_name,
      'manager_name', v_ea.manager_name, 'manager_email', v_ea.manager_email,
      'manager_phone', v_ea.manager_phone, 'role', v_ea.role, 'status', v_ea.status,
      'last_login_at', v_ea.last_login_at, 'auth_user_id', v_ea.auth_user_id,
      'notes', v_ea.notes, 'created_at', v_ea.created_at, 'updated_at', v_ea.updated_at,
      'deleted_at', v_ea.deleted_at, 'onboarding_enabled', v_ea.onboarding_enabled,
      'allow_self_register_region', v_ea.allow_self_register_region,
      'auto_onboarded', v_ea.auto_onboarded, 'brand_registry_id', v_ea.brand_registry_id
    ),

    -- 사업자/정산 담당 프로필
    'business_profile', (
      select to_jsonb(bp) from (
        select company_name, business_number, representative_name, business_address,
               contact_phone, tax_invoice_email, settlement_contact_name,
               settlement_contact_phone, settlement_contact_email
        from public.enterprise_business_profiles where enterprise_account_id = p_enterprise_id
      ) bp
    ),

    -- B. 초대/코드 정보 (평문 코드 + claim 이력)
    'invite', jsonb_build_object(
      'hq_invite_code', v_ea.hq_invite_code,
      'store_invite_code', v_ea.store_invite_code,
      'brand_code', v_ea.brand_code,
      'invite_code_rotated_at', v_ea.invite_code_rotated_at,
      'claims', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'claim_type', c.claim_type, 'status', c.status,
          'invite_code_last4', c.invite_code_last4, 'user_id', c.user_id,
          'store_name_input', c.store_name_input, 'region_name_input', c.region_name_input,
          'brand_name_input', c.brand_name_input, 'failure_reason', c.failure_reason,
          'created_at', c.created_at
        ) order by c.created_at desc), '[]'::jsonb)
        from public.enterprise_invite_claims c where c.enterprise_account_id = p_enterprise_id
      )
    ),

    -- 지역
    'regions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'region_name', r.region_name, 'region_code', r.region_code,
        'status', r.status, 'store_count', r.store_count, 'manager_name', r.manager_name,
        'last_policy_applied_at', r.last_policy_applied_at
      ) order by r.region_name), '[]'::jsonb)
      from public.enterprise_regions r
      where r.enterprise_account_id = p_enterprise_id and r.deleted_at is null
    ),

    -- C. 매장 요약
    'store_summary', (
      select jsonb_build_object(
        'total', count(*),
        'active', count(*) filter (where fs.status = 'active'),
        'inactive', count(*) filter (where fs.status <> 'active'),
        'heartbeat_recent', count(*) filter (where s.last_seen_at > now() - interval '10 minutes'),
        'playing', count(*) filter (where s.player_status = 'playing'),
        'connected_24h', count(*) filter (where s.last_seen_at > now() - interval '24 hours'),
        'offline_or_error', count(*) filter (
          where s.playback_error is not null
             or s.last_seen_at is null
             or s.last_seen_at < now() - interval '24 hours')
      )
      from public.franchise_stores fs
      left join public.store_policy_sync_status s on s.store_id = fs.store_id
      where fs.franchise_id = any(v_franchise_ids)
    ),

    -- D. 매장 목록 (player 상태 포함)
    'stores', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'store_id', fs.store_id, 'store_name', fs.store_name, 'store_status', fs.status,
        'region_id', fs.enterprise_region_id, 'region_name', er.region_name,
        'player_status', s.player_status, 'last_seen_at', s.last_seen_at,
        'last_synced_at', s.last_synced_at, 'last_policy_sync_at', s.last_policy_sync_at,
        'active_policy_id', s.active_policy_id, 'active_version_number', s.active_version_number,
        'current_track_id', s.current_track_id, 'current_track_title', t.title, 'current_track_artist', t.artist,
        'current_track_started_at', s.current_track_started_at,
        'device_model', s.device_model, 'device_os', s.device_os, 'app_version', s.app_version,
        'connection_type', s.connection_type, 'volume', s.volume, 'playback_error', s.playback_error,
        'business_category', u.business_category, 'store_owner_nickname', u.nickname,
        'joined_at', fs.joined_at
      ) order by fs.store_name), '[]'::jsonb)
      from public.franchise_stores fs
      left join public.store_policy_sync_status s on s.store_id = fs.store_id
      left join public.enterprise_regions er on er.id = fs.enterprise_region_id
      left join public.tracks t on t.id = s.current_track_id
      left join public.users u on u.id = fs.store_id
      where fs.franchise_id = any(v_franchise_ids)
    ),

    -- E. 계약 (현재 적용 계약 + 전체)
    'contract', (
      select to_jsonb(c) from (
        select id, contract_no, contract_name, contract_type, start_date, end_date,
               auto_renew, renewal_period_month, status, monthly_store_price, commission_rate,
               minimum_payout, settlement_method, signed_at, memo, created_at, updated_at
        from public.enterprise_contracts
        where enterprise_account_id = p_enterprise_id and deleted_at is null
        order by (status = 'active') desc, coalesce(start_date, '1900-01-01') desc, created_at desc
        limit 1
      ) c
    ),
    'contracts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'contract_no', contract_no, 'contract_name', contract_name,
        'status', status, 'start_date', start_date, 'end_date', end_date,
        'monthly_store_price', monthly_store_price, 'commission_rate', commission_rate,
        'settlement_method', settlement_method, 'auto_renew', auto_renew
      ) order by created_at desc), '[]'::jsonb)
      from public.enterprise_contracts
      where enterprise_account_id = p_enterprise_id and deleted_at is null
    ),

    -- F. 정산 (커미션 기반 — 실제 컬럼만)
    'settlements', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', ms.id, 'settlement_month', ms.settlement_month, 'status', ms.status,
        'active_store_count', ms.active_store_count, 'monthly_store_price', ms.monthly_store_price,
        'commission_rate', ms.commission_rate, 'per_store_commission', ms.per_store_commission,
        'total_commission', ms.total_commission, 'minimum_payout', ms.minimum_payout,
        'below_minimum', (ms.minimum_payout is not null and ms.total_commission < ms.minimum_payout),
        'settlement_method', ms.settlement_method, 'contract_no', ms.contract_no,
        'generated_at', ms.generated_at, 'approved_at', ms.approved_at, 'paid_at', ms.paid_at,
        'payment_reference', ms.payment_reference
      ) order by ms.settlement_month desc), '[]'::jsonb)
      from public.enterprise_monthly_settlements ms
      where ms.enterprise_account_id = p_enterprise_id
    ),

    -- G. 음악 정책 (franchise 기본 정책 + 최신 버전)
    'music_policy', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', mp.id, 'franchise_id', mp.franchise_id, 'name', mp.name, 'description', mp.description,
        'status', mp.status, 'is_default', mp.is_default, 'effective_from', mp.effective_from,
        'effective_until', mp.effective_until, 'source_type', mp.source_type,
        'source_playlist_id', mp.source_playlist_id, 'track_count_snapshot', mp.track_count_snapshot,
        'latest_version', (select max(v.version_number) from public.franchise_policy_versions v where v.policy_id = mp.id)
      ) order by mp.is_default desc, mp.updated_at desc), '[]'::jsonb)
      from public.franchise_music_policies mp
      where mp.franchise_id = any(v_franchise_ids)
    ),

    -- H. 감사 로그 (최근 20 — related_id 또는 details 에 enterprise_id 포함)
    'audit_logs', (
      select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb)
      from (
        select l.created_at, l.source, l.category, l.level, l.status, l.message,
               l.user_id::text as actor, l.related_id, l.error_code
        from public.admin_operation_logs l
        where l.related_id = p_enterprise_id::text
           or l.details->>'enterprise_account_id' = p_enterprise_id::text
           or l.details->>'enterprise_id' = p_enterprise_id::text
           or l.details->>'id' = p_enterprise_id::text
        order by l.created_at desc
        limit 20
      ) x
    )
  );

  return v;
end;
$$;

revoke execute on function public.admin_get_enterprise_detail(uuid) from public, anon;
grant  execute on function public.admin_get_enterprise_detail(uuid) to authenticated;

comment on function public.admin_get_enterprise_detail(uuid) is
  'ENT-DETAIL-1 — 관리자 본사 상세 집계 (조회 전용). enterprise/business_profile/invite/regions/store_summary/stores/contract/settlements/music_policy/audit_logs. _is_super_admin 게이트.';
