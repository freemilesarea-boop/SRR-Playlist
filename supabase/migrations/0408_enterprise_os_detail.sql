-- 0408 — Phase ENT-OS-1: Enterprise OS Detail (본사 통합 운영 조회)
--
-- 목적:
--   관리자가 본사 1곳을 열면 브랜드/매장/음악/이미지/플레이어/정산/로그를
--   한 RPC 로 조회. Brand 를 Enterprise 내부 객체로 흡수.
--
-- 절대 원칙:
--   • 조회 전용 · additive RPC 하나만 추가. 기존 admin_get_enterprise_detail(0406) 무변경.
--   • 테이블 변경 없음 (0407 에서 brand↔enterprise 링크 완료).
--   • super_admin 전용. null-safe. 브랜드 없으면 brand=null, assets=[], sessions=[].

create or replace function public.admin_get_enterprise_os_detail(p_enterprise_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ea public.enterprise_accounts%rowtype;
  v_brand public.brand_accounts%rowtype;
  v jsonb;
  v_franchise_ids uuid[];
  v_has_brand boolean;
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;

  select * into v_ea from public.enterprise_accounts where id = p_enterprise_id;
  if not found then raise exception 'enterprise not found'; end if;

  select coalesce(array_agg(ef.franchise_id), '{}') into v_franchise_ids
    from public.enterprise_franchises ef
   where ef.enterprise_account_id = p_enterprise_id and ef.deleted_at is null;

  -- 연결 active 브랜드 (본사당 1개)
  select * into v_brand from public.brand_accounts
   where enterprise_account_id = p_enterprise_id and deleted_at is null
   order by (status='active') desc, created_at desc limit 1;
  v_has_brand := found;

  v := jsonb_build_object(
    -- A. 본사
    'enterprise', jsonb_build_object(
      'id', v_ea.id, 'enterprise_name', v_ea.enterprise_name,
      'manager_name', v_ea.manager_name, 'manager_email', v_ea.manager_email,
      'manager_phone', v_ea.manager_phone, 'role', v_ea.role, 'status', v_ea.status,
      'last_login_at', v_ea.last_login_at, 'created_at', v_ea.created_at, 'updated_at', v_ea.updated_at,
      'deleted_at', v_ea.deleted_at,
      'hq_invite_code', v_ea.hq_invite_code, 'store_invite_code', v_ea.store_invite_code
    ),

    -- B. 브랜드 (없으면 null)
    'brand', case when v_has_brand then jsonb_build_object(
        'id', v_brand.id, 'name', v_brand.name, 'enterprise_account_id', v_brand.enterprise_account_id,
        'status', v_brand.status, 'industry_type', v_brand.industry_type, 'description', v_brand.description,
        'created_at', v_brand.created_at, 'updated_at', v_brand.updated_at,
        'media_count', (select count(*) from public.brand_media_assets m where m.brand_id=v_brand.id and m.deleted_at is null),
        'active_media_count', (select count(*) from public.brand_media_assets m where m.brand_id=v_brand.id and m.deleted_at is null and m.status='active'),
        'playlist_track_count', jsonb_array_length(public._brand_generate_playlist(v_brand.id, 300)),
        'connected_store_count', (select count(*) from public.franchise_stores fs where fs.franchise_id = any(v_franchise_ids))
      ) else null end,

    -- 브랜드 음악 정책
    'brand_music_policy', case when v_has_brand then (
        select row_to_json(p) from (
          select preferred_genres, blocked_genres, preferred_moods, blocked_moods,
                 energy_min, energy_max, vocal_policy, auto_generate_enabled
          from public.brand_music_policies where brand_id = v_brand.id) p
      ) else null end,

    -- 이미지/사이니지
    'brand_media_assets', case when v_has_brand then (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', id, 'asset_type', asset_type, 'title', title, 'image_url', image_url,
          'display_duration_seconds', display_duration_seconds, 'sort_order', sort_order,
          'status', status, 'starts_at', starts_at, 'ends_at', ends_at,
          'created_at', created_at, 'updated_at', updated_at) order by sort_order, created_at), '[]'::jsonb)
        from public.brand_media_assets where brand_id = v_brand.id and deleted_at is null
      ) else '[]'::jsonb end,

    -- 플레이어 세션
    'brand_player_sessions', case when v_has_brand then (
        select coalesce(jsonb_agg(x order by x.last_seen_at desc nulls last), '[]'::jsonb) from (
          select s.id, s.last_seen_at, s.playback_started_at, s.user_agent, s.current_track_id, s.created_at, s.user_id
          from public.brand_player_sessions s where s.brand_id = v_brand.id
          order by s.last_seen_at desc nulls last limit 20) x
      ) else '[]'::jsonb end,
    'brand_session_summary', case when v_has_brand then jsonb_build_object(
        'total', (select count(*) from public.brand_player_sessions s where s.brand_id=v_brand.id),
        'active_recent', (select count(*) from public.brand_player_sessions s where s.brand_id=v_brand.id and s.last_seen_at > now() - interval '10 minutes'),
        'last_24h', (select count(*) from public.brand_player_sessions s where s.brand_id=v_brand.id and s.last_seen_at > now() - interval '24 hours')
      ) else jsonb_build_object('total',0,'active_recent',0,'last_24h',0) end,

    -- C. 매장 요약
    'store_summary', (
      select jsonb_build_object(
        'total', count(*),
        'active', count(*) filter (where fs.status='active'),
        'inactive', count(*) filter (where fs.status<>'active'),
        'heartbeat_recent', count(*) filter (where s.last_seen_at > now()-interval '10 minutes'),
        'playing', count(*) filter (where s.player_status='playing'),
        'connected_24h', count(*) filter (where s.last_seen_at > now()-interval '24 hours'),
        'offline_or_error', count(*) filter (where s.playback_error is not null or s.last_seen_at is null or s.last_seen_at < now()-interval '24 hours'))
      from public.franchise_stores fs
      left join public.store_policy_sync_status s on s.store_id = fs.store_id
      where fs.franchise_id = any(v_franchise_ids)),

    -- D. 매장 목록
    'stores', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'store_id', fs.store_id, 'store_name', fs.store_name, 'store_status', fs.status,
        'region_name', er.region_name, 'player_status', s.player_status, 'last_seen_at', s.last_seen_at,
        'active_version_number', s.active_version_number, 'current_track_title', t.title,
        'device_model', s.device_model, 'playback_error', s.playback_error,
        'business_category', u.business_category) order by fs.store_name), '[]'::jsonb)
      from public.franchise_stores fs
      left join public.store_policy_sync_status s on s.store_id = fs.store_id
      left join public.enterprise_regions er on er.id = fs.enterprise_region_id
      left join public.tracks t on t.id = s.current_track_id
      left join public.users u on u.id = fs.store_id
      where fs.franchise_id = any(v_franchise_ids)),

    -- E. Enterprise/Franchise 음악 정책
    'enterprise_music_policy', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', mp.id, 'name', mp.name, 'status', mp.status, 'is_default', mp.is_default,
        'source_type', mp.source_type, 'track_count_snapshot', mp.track_count_snapshot,
        'effective_from', mp.effective_from,
        'latest_version', (select max(vv.version_number) from public.franchise_policy_versions vv where vv.policy_id = mp.id)
      ) order by mp.is_default desc, mp.updated_at desc), '[]'::jsonb)
      from public.franchise_music_policies mp where mp.franchise_id = any(v_franchise_ids)),

    -- F. 계약
    'contract', (
      select to_jsonb(c) from (
        select id, contract_no, contract_name, contract_type, start_date, end_date, auto_renew, status,
               monthly_store_price, commission_rate, minimum_payout, settlement_method, signed_at
        from public.enterprise_contracts
        where enterprise_account_id = p_enterprise_id and deleted_at is null
        order by (status='active') desc, coalesce(start_date,'1900-01-01') desc, created_at desc limit 1) c),

    -- G. 정산
    'settlements', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', ms.id, 'settlement_month', ms.settlement_month, 'status', ms.status,
        'active_store_count', ms.active_store_count, 'total_commission', ms.total_commission,
        'minimum_payout', ms.minimum_payout,
        'below_minimum', (ms.minimum_payout is not null and ms.total_commission < ms.minimum_payout),
        'paid_at', ms.paid_at) order by ms.settlement_month desc), '[]'::jsonb)
      from public.enterprise_monthly_settlements ms where ms.enterprise_account_id = p_enterprise_id),

    -- H. 감사 로그 (enterprise + brand 관련)
    'audit_logs', (
      select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
        select l.created_at, l.source, l.category, l.level, l.status, l.message, l.related_id
        from public.admin_operation_logs l
        where l.related_id = p_enterprise_id::text
           or l.details->>'enterprise_account_id' = p_enterprise_id::text
           or l.details->>'enterprise_id' = p_enterprise_id::text
        order by l.created_at desc limit 20) x)
  );

  return v;
end;
$$;
revoke execute on function public.admin_get_enterprise_os_detail(uuid) from public, anon;
grant  execute on function public.admin_get_enterprise_os_detail(uuid) to authenticated;

comment on function public.admin_get_enterprise_os_detail(uuid) is
  'ENT-OS-1 — 본사 통합 운영 조회 (조회 전용). enterprise/brand/brand_music_policy/brand_media_assets/brand_player_sessions/store_summary/stores/enterprise_music_policy/contract/settlements/audit_logs. _is_super_admin 게이트.';
