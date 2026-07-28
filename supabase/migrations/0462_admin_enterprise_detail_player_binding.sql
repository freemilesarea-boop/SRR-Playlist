-- 0462 — Phase BRAND-HQ-RUNTIME-TRUTH-1: admin_get_enterprise_detail 에 실제 Player Binding 추가
--
-- 배경:
--   HQ 상세는 brand_code / brand_registry_id 만 노출했고, 실제 Brand Player Runtime 이 요구하는
--   brand_accounts(enterprise_account_id 링크 + status='active' + deleted_at is null) 상태를 알 수 없었다.
--   그래서 관리자에서는 "연결됨"처럼 보이지만 verify_store_code 는 brand_not_linked 를 반환.
--
-- 이 migration:
--   • 기존 0406 함수를 forward create-or-replace 로 확장 (기존 파일/데이터 무변경).
--   • 반환 JSON 에 'player_binding' 키 1개만 additive 추가 — 기존 키/응답 호환 유지.
--   • 조회 전용(SELECT). 데이터 생성/수정 없음. brand_accounts 자동 생성/연결 없음.
--   • 활성 판정은 Runtime(verify_store_code, 0455)과 동일: status='active' AND deleted_at IS NULL.
--   • 동일 enterprise 에 brand_accounts 여러 행이 있으면 숨기지 않고 deterministic 하게 1개 선택
--     (미삭제 > 활성 > 최신) + binding_count 로 이상 상태 경고.
--   • _is_super_admin 게이트/권한/개인정보 정책 동일 — 신규 민감정보 없음.

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
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;

  select * into v_ea from public.enterprise_accounts where id = p_enterprise_id;
  if not found then
    raise exception 'enterprise not found';
  end if;

  select coalesce(array_agg(ef.franchise_id), '{}')
    into v_franchise_ids
    from public.enterprise_franchises ef
   where ef.enterprise_account_id = p_enterprise_id and ef.deleted_at is null;

  v := jsonb_build_object(
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

    -- BRAND-HQ-RUNTIME-TRUTH-1 — 실제 Brand Player Binding (brand_accounts). 조회 전용.
    -- 활성 판정은 verify_store_code(0455) 와 동일 의미. row 없으면 nulls + is_active_binding=false.
    'player_binding', coalesce(
      (
        select jsonb_build_object(
          'brand_account_id', ba.id,
          'brand_account_name', ba.name,
          'brand_account_status', ba.status,
          'brand_account_deleted_at', ba.deleted_at,
          'enterprise_account_id', ba.enterprise_account_id,
          'is_active_binding', (ba.status = 'active' and ba.deleted_at is null),
          'binding_count', (select count(*) from public.brand_accounts b
                             where b.enterprise_account_id = p_enterprise_id)
        )
        from public.brand_accounts ba
        where ba.enterprise_account_id = p_enterprise_id
        order by (ba.deleted_at is null) desc, (ba.status = 'active') desc, ba.created_at desc
        limit 1
      ),
      jsonb_build_object(
        'brand_account_id', null, 'brand_account_name', null,
        'brand_account_status', null, 'brand_account_deleted_at', null,
        'enterprise_account_id', null, 'is_active_binding', false, 'binding_count', 0
      )
    ),

    'business_profile', (
      select to_jsonb(bp) from (
        select company_name, business_number, representative_name, business_address,
               contact_phone, tax_invoice_email, settlement_contact_name,
               settlement_contact_phone, settlement_contact_email
        from public.enterprise_business_profiles where enterprise_account_id = p_enterprise_id
      ) bp
    ),

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

    'regions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'region_name', r.region_name, 'region_code', r.region_code,
        'status', r.status, 'store_count', r.store_count, 'manager_name', r.manager_name,
        'last_policy_applied_at', r.last_policy_applied_at
      ) order by r.region_name), '[]'::jsonb)
      from public.enterprise_regions r
      where r.enterprise_account_id = p_enterprise_id and r.deleted_at is null
    ),

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
  'ENT-DETAIL-1 (+0462 player_binding) — 관리자 본사 상세 집계 (조회 전용). enterprise/player_binding/business_profile/invite/regions/store_summary/stores/contract/settlements/music_policy/audit_logs. _is_super_admin 게이트.';
