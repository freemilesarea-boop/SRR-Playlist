-- ============================================
-- 0500_admin_ai_fleet_intelligence.sql
--
-- Phase AI-MUSIC-13 — Enterprise Fleet Intelligence, Cross-Enterprise Benchmarking
-- & Global Optimization.
--
-- 단일 Store 최적화를 넘어 Store → Fleet → Region → Enterprise → Industry → Global
-- 계층을 읽기 전용 Snapshot(집계)으로 분석한다.
--
--   Store Intelligence → Fleet → Regional → Enterprise → Industry Benchmark
--   → Cross-Enterprise Learning → Optimization Opportunity → Governance Review
--   → Evidence → Production Change Candidate 참고
--
-- ⚠️ 절대: Production Apply/자동 Rollout/자동 Publish/Scheduler·Queue·Playback 변경 없음.
--   Enterprise 원본 데이터 직접 노출 금지 — Cross-Enterprise 는 **익명화된 집계만**
--   (franchise 이름/ID 미노출, 결정적 익명 코드). Brand 간 원본 혼합 없음. Trigger 없음.
--
-- 재사용: 실측 소스는 playback_events_v2(0253) + franchises/franchise_regions/
--   franchise_stores(0349) join 집계 — Fleet Snapshot/Benchmark 테이블 복제 없음
--   (이중 진실 공급원 방지). Industry Benchmark 는 admin_context_overview(0490) 재사용.
--   신규 저장은 Best Practice/Opportunity 후보(Evidence 필수, Governance Review 대상)만.
-- ============================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Best Practice 후보 저장소(자동 적용 없음 — Review 대상 Evidence).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_best_practices (
  id               uuid primary key default gen_random_uuid(),
  practice_code    text not null unique,
  scope            text not null check (scope in ('industry','region','enterprise','global')),
  scope_key        text not null,               -- store_type slug / region name / 익명 enterprise 코드 / 'global'
  title            text not null,
  description      text,
  subject          jsonb not null default '{}'::jsonb,   -- 예: {"genre":"jazz","share_pct":18}
  observed_effect  jsonb not null default '{}'::jsonb,   -- 예: {"metric":"completion_rate","delta_pct":9}
  sample_stores    int check (sample_stores is null or sample_stores >= 0),
  sample_events    int check (sample_events is null or sample_events >= 0),
  confidence       int check (confidence is null or (confidence between 0 and 100)),
  status           text not null default 'candidate' check (status in ('candidate','under_review','reference','rejected','superseded','insufficient_data')),
  evidence         jsonb not null default '[]'::jsonb,
  limitations      jsonb not null default '[]'::jsonb,
  source_version   text not null,
  input_hash       text not null unique,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.ai_best_practices is
  'AI-MUSIC-13 — Best Practice 후보(관찰 상관 기반, 인과 아님). 자동 적용 없음 — Governance Review 대상 Evidence.';
create index if not exists idx_bp_scope on public.ai_best_practices (scope, scope_key, status);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Fleet Opportunity 후보 저장소(자동 실행 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_fleet_opportunities (
  id                uuid primary key default gen_random_uuid(),
  opportunity_code  text not null unique,
  opportunity_type  text not null check (opportunity_type in ('high_skip','high_repeat','quality_degradation','low_completion','new_track_uplift','rotation_improvement','low_diversity')),
  scope             text not null check (scope in ('store','industry','region','enterprise','global')),
  scope_key         text not null,               -- store: 익명 store 코드 · industry: store_type
  severity          text not null check (severity in ('low','moderate','high','critical')),
  kpi_snapshot      jsonb not null default '{}'::jsonb,
  benchmark_snapshot jsonb,
  expected_direction text check (expected_direction is null or expected_direction in ('improve','reduce_risk','unknown')),
  status            text not null default 'detected' check (status in ('detected','under_review','review_candidate','dismissed','resolved','superseded')),
  evidence          jsonb not null default '[]'::jsonb,
  limitations       jsonb not null default '[]'::jsonb,
  source_version    text not null,
  input_hash        text not null unique,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.ai_fleet_opportunities is
  'AI-MUSIC-13 — Fleet 최적화 기회 후보. review_candidate 는 검토 후보일 뿐 실행 아님. 자동 Apply/Rollout 없음.';
create index if not exists idx_fo_type on public.ai_fleet_opportunities (opportunity_type, status, created_at desc);
create index if not exists idx_fo_scope on public.ai_fleet_opportunities (scope, scope_key);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Fleet Summary — Global 집계(읽기 전용, 복제 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_fleet_summary(p_range text default '30d')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_since timestamptz := now() - public._playlist_range_interval(p_range); v_global jsonb; v_fleet jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'events', count(*),
    'stores', count(distinct coalesce(e.business_id, e.user_id)),
    'industries', count(distinct e.store_type_slug) filter (where e.store_type_slug is not null),
    'tracks', count(distinct e.track_id),
    'playlists', count(distinct e.playlist_id),
    'completion_rate', round((avg(case when e.track_duration_seconds > 0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1),
    'skip_rate', round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1),
    'like_rate', round(100.0 * count(*) filter (where e.event_type='like') / nullif(count(*),0), 2),
    'error_rate', round(100.0 * count(*) filter (where e.event_type='player_error') / nullif(count(*),0), 2),
    'last_event_at', max(e.created_at)
  ) into v_global from public.playback_events_v2 e where e.created_at >= v_since;
  select jsonb_build_object(
    'enterprises', (select count(*) from public.franchises where status = 'active'),
    'regions', (select count(*) from public.franchise_regions),
    'fleet_stores', (select count(*) from public.franchise_stores where status = 'active'),
    'best_practices', (select count(*) from public.ai_best_practices where status not in ('rejected','superseded')),
    'opportunities', (select count(*) from public.ai_fleet_opportunities where status in ('detected','under_review','review_candidate'))
  ) into v_fleet;
  return jsonb_build_object('range', coalesce(p_range,'30d'), 'global', v_global, 'fleet', v_fleet, 'generated_at', now());
end; $$;
grant execute on function public.admin_fleet_summary(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Fleet Health 원시 성분(Scope 별 집계 — Health Score 계산은 순수 로직에서).
--    Queue Stability 등 미지원 성분은 null 유지(0 변환 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_fleet_health(p_scope text default 'global', p_scope_key text default null, p_range text default '30d')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_since timestamptz := now() - public._playlist_range_interval(p_range); v_kpi jsonb; v_gov jsonb;
begin
  perform public._admin_growth_guard();
  if p_scope not in ('global','industry') then
    return jsonb_build_object('scope', p_scope, 'supported', false, 'note', 'store/region/enterprise health 는 benchmark RPC 집계로 제공(개별 원본 미노출)');
  end if;
  select jsonb_build_object(
    'events', count(*),
    'playback_health', round((100.0 * count(*) filter (where e.event_type='play_complete') / nullif(count(*) filter (where e.event_type='play_start'),0))::numeric, 1),
    'streaming_quality', round((100.0 - 100.0 * count(*) filter (where e.event_type='player_error') / nullif(count(*),0))::numeric, 1),
    'rotation_quality', round((100.0 - 100.0 * count(*) filter (where e.event_type='replay') / nullif(count(*),0))::numeric, 1),
    'playlist_diversity', round((100.0 * least(1, count(distinct e.playlist_id)::numeric / 20))::numeric, 1),
    'satisfaction', round((100.0 * count(*) filter (where e.event_type='like') / nullif(count(*) filter (where e.event_type in ('like','unlike')),0))::numeric, 1),
    'completion_rate', round((avg(case when e.track_duration_seconds > 0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1),
    'skip_rate', round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1)
  ) into v_kpi from public.playback_events_v2 e
  where e.created_at >= v_since and (p_scope = 'global' or e.store_type_slug = p_scope_key);
  select jsonb_build_object(
    'trust', (select round(avg(reputation)) from public.ai_agents where is_active),
    'governance_health', (select greatest(0, 100 - count(*) * 5) from public.ai_governance_events
                          where event_type in ('violation_detected','violation_blocked') and created_at >= v_since)
  ) into v_gov;
  return jsonb_build_object('scope', p_scope, 'scope_key', p_scope_key, 'supported', true,
    'kpi', v_kpi, 'governance', v_gov, 'queue_stability', null, 'generated_at', now());
end; $$;
grant execute on function public.admin_fleet_health(text, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Enterprise Benchmark — 익명화 집계(franchise 이름/ID 미노출, 결정적 익명 코드).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_benchmark(p_range text default '30d', p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_since timestamptz := now() - public._playlist_range_interval(p_range); v_limit int := greatest(1, least(coalesce(p_limit,50), 100)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.events desc), '[]'::jsonb) into v_items from (
    select
      -- 익명 코드: 순위 기반(원본 franchise id/name 미노출 — Cross-Enterprise 민감 데이터 보호).
      'ENT-' || lpad(row_number() over (order by count(*) desc, min(f.franchise_id::text))::text, 2, '0') as anon_code,
      count(distinct fs.store_id) as store_count,
      count(*) as events,
      round((avg(case when e.track_duration_seconds > 0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
      round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate,
      round(100.0 * count(*) filter (where e.event_type='like') / nullif(count(*),0), 2) as like_rate,
      round(100.0 * count(*) filter (where e.event_type='player_error') / nullif(count(*),0), 2) as error_rate
    from public.playback_events_v2 e
    join public.franchise_stores fs on fs.store_id = coalesce(e.business_id, e.user_id) and fs.status = 'active'
    join lateral (select fs.franchise_id) f on true
    where e.created_at >= v_since
    group by fs.franchise_id
    having count(distinct fs.store_id) >= 2   -- 단일 Store enterprise 는 식별 위험 → 제외(익명성 보장)
    order by count(*) desc limit v_limit
  ) t;
  return jsonb_build_object('range', coalesce(p_range,'30d'), 'anonymized', true, 'items', v_items,
    'note', 'Enterprise 원본(이름/ID) 미노출 — 익명 집계 Benchmark. 2개 미만 Store enterprise 제외.', 'generated_at', now());
end; $$;
grant execute on function public.admin_enterprise_benchmark(text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Region Benchmark — franchise_regions 집계(HQ 정의 지역 라벨, enterprise 미식별).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_region_benchmark(p_range text default '30d', p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_since timestamptz := now() - public._playlist_range_interval(p_range); v_limit int := greatest(1, least(coalesce(p_limit,50), 100)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.events desc), '[]'::jsonb) into v_items from (
    select
      r.name as region_name,
      count(distinct fs.store_id) as store_count,
      count(*) as events,
      round((avg(case when e.track_duration_seconds > 0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
      round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate,
      round(100.0 * count(*) filter (where e.event_type='like') / nullif(count(*),0), 2) as like_rate
    from public.playback_events_v2 e
    join public.franchise_stores fs on fs.store_id = coalesce(e.business_id, e.user_id) and fs.status = 'active'
    join public.franchise_regions r on r.id = fs.region_id
    where e.created_at >= v_since
    group by r.name
    order by count(*) desc limit v_limit
  ) t;
  return jsonb_build_object('range', coalesce(p_range,'30d'), 'items', v_items,
    'note', '실존 franchise_regions 만 집계(임의 지역 생성 없음).', 'generated_at', now());
end; $$;
grant execute on function public.admin_region_benchmark(text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Fleet Growth — 이전/현재 반기 비교(0 비교 금지 — 이전 없으면 null).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_fleet_growth(p_range text default '30d')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_interval interval := public._playlist_range_interval(p_range); v_mid timestamptz := now() - (v_interval/2); v_since timestamptz := now() - v_interval; v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.curr_events desc), '[]'::jsonb) into v_items from (
    select
      e.store_type_slug as store_type,
      count(*) filter (where e.created_at < v_mid) as prev_events,
      count(*) filter (where e.created_at >= v_mid) as curr_events,
      round((avg(case when e.track_duration_seconds > 0 and e.created_at < v_mid then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as prev_completion,
      round((avg(case when e.track_duration_seconds > 0 and e.created_at >= v_mid then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as curr_completion,
      count(distinct coalesce(e.business_id, e.user_id)) filter (where e.created_at < v_mid) as prev_stores,
      count(distinct coalesce(e.business_id, e.user_id)) filter (where e.created_at >= v_mid) as curr_stores
    from public.playback_events_v2 e
    where e.created_at >= v_since and e.store_type_slug is not null
    group by e.store_type_slug
  ) t;
  return jsonb_build_object('range', coalesce(p_range,'30d'), 'items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_fleet_growth(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Opportunity Scan — Store 별 KPI 이상 탐지(익명 store 코드 · 저장 없음, 조회만).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_fleet_opportunity_scan(p_range text default '30d', p_min_events int default 50, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_since timestamptz := now() - public._playlist_range_interval(p_range); v_limit int := greatest(1, least(coalesce(p_limit,50), 100)); v_items jsonb; v_global record;
begin
  perform public._admin_growth_guard();
  select
    round(100.0 * count(*) filter (where event_type='skip') / nullif(count(*),0), 1) as skip_rate,
    round((avg(case when track_duration_seconds > 0 then least(1, listened_seconds/track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
    round(100.0 * count(*) filter (where event_type='player_error') / nullif(count(*),0), 2) as error_rate,
    round(100.0 * count(*) filter (where event_type='replay') / nullif(count(*),0), 2) as replay_rate
  into v_global from public.playback_events_v2 where created_at >= v_since;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.events desc), '[]'::jsonb) into v_items from (
    select
      'STORE-' || lpad(row_number() over (order by count(*) desc, min(coalesce(e.business_id, e.user_id)::text))::text, 3, '0') as anon_code,
      e.store_type_slug as store_type,
      count(*) as events,
      round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate,
      round((avg(case when e.track_duration_seconds > 0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
      round(100.0 * count(*) filter (where e.event_type='player_error') / nullif(count(*),0), 2) as error_rate,
      round(100.0 * count(*) filter (where e.event_type='replay') / nullif(count(*),0), 2) as replay_rate,
      count(distinct e.track_id) as track_count
    from public.playback_events_v2 e
    where e.created_at >= v_since and coalesce(e.business_id, e.user_id) is not null
    group by coalesce(e.business_id, e.user_id), e.store_type_slug
    having count(*) >= greatest(10, coalesce(p_min_events, 50))
    order by count(*) desc limit v_limit
  ) t;
  return jsonb_build_object('range', coalesce(p_range,'30d'), 'anonymized', true,
    'global_baseline', to_jsonb(v_global), 'items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_fleet_opportunity_scan(text, int, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) Best Practice / Opportunity 저장·조회·상태 전이(Evidence 필수 · 자동 적용 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_best_practice_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_existing public.ai_best_practices; v_row public.ai_best_practices; v_id uuid;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'practice_code','') = '' or coalesce(p_payload->>'title','') = '' then raise exception 'practice_code/title required' using errcode='22023'; end if;
  if coalesce(p_payload->>'scope','') not in ('industry','region','enterprise','global') then raise exception 'invalid scope' using errcode='22023'; end if;
  if coalesce(p_payload->>'scope_key','') = '' then raise exception 'scope_key required' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  if coalesce(p_payload->>'source_version','') = '' or coalesce(p_payload->>'input_hash','') = '' then raise exception 'source_version/input_hash required' using errcode='22023'; end if;

  select * into v_existing from public.ai_best_practices where input_hash = p_payload->>'input_hash';
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'practice', to_jsonb(v_existing)); end if;

  insert into public.ai_best_practices(practice_code, scope, scope_key, title, description, subject, observed_effect,
    sample_stores, sample_events, confidence, status, evidence, limitations, source_version, input_hash, created_by)
  values (p_payload->>'practice_code', p_payload->>'scope', p_payload->>'scope_key', p_payload->>'title', nullif(p_payload->>'description',''),
    coalesce(p_payload->'subject','{}'::jsonb), coalesce(p_payload->'observed_effect','{}'::jsonb),
    greatest(0, nullif(p_payload->>'sample_stores','')::int), greatest(0, nullif(p_payload->>'sample_events','')::int),
    least(100, greatest(0, nullif(p_payload->>'confidence','')::int)),
    case when coalesce(nullif(p_payload->>'sample_events','')::int, 0) < 100 then 'insufficient_data' else 'candidate' end,
    p_payload->'evidence', coalesce(p_payload->'limitations','[]'::jsonb), p_payload->>'source_version', p_payload->>'input_hash', auth.uid())
  returning id into v_id;
  select * into v_row from public.ai_best_practices where id = v_id;
  return jsonb_build_object('idempotent', false, 'practice', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_best_practice_save(jsonb) to authenticated;

create or replace function public.admin_best_practices(p_scope text default null, p_status text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_best_practices b
    where (p_scope is null or b.scope = p_scope) and (p_status is null or b.status = p_status)
    order by b.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_best_practices(text, text, int) to authenticated;

create or replace function public.admin_best_practice_set_status(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_best_practices;
begin
  perform public._admin_growth_guard();
  if p_status is null or p_status not in ('under_review','reference','rejected','superseded') then raise exception 'invalid status' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  select * into v_row from public.ai_best_practices where id = p_id;
  if v_row.id is null then raise exception 'practice not found' using errcode='P0002'; end if;
  -- reference 승격은 최소 표본 요구(통계 정직성).
  if p_status = 'reference' and (coalesce(v_row.sample_events, 0) < 100 or coalesce(v_row.sample_stores, 0) < 3) then
    raise exception 'reference requires sample_events>=100 and sample_stores>=3' using errcode='22023';
  end if;
  update public.ai_best_practices set status = p_status, updated_at = now() where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_best_practice_set_status(uuid, text, text) to authenticated;

create or replace function public.admin_fleet_opportunity_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_existing public.ai_fleet_opportunities; v_row public.ai_fleet_opportunities; v_id uuid;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'opportunity_code','') = '' then raise exception 'opportunity_code required' using errcode='22023'; end if;
  if coalesce(p_payload->>'opportunity_type','') not in ('high_skip','high_repeat','quality_degradation','low_completion','new_track_uplift','rotation_improvement','low_diversity') then raise exception 'invalid opportunity_type' using errcode='22023'; end if;
  if coalesce(p_payload->>'scope','') not in ('store','industry','region','enterprise','global') then raise exception 'invalid scope' using errcode='22023'; end if;
  if coalesce(p_payload->>'severity','') not in ('low','moderate','high','critical') then raise exception 'invalid severity' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  if coalesce(p_payload->>'source_version','') = '' or coalesce(p_payload->>'input_hash','') = '' then raise exception 'source_version/input_hash required' using errcode='22023'; end if;

  select * into v_existing from public.ai_fleet_opportunities where input_hash = p_payload->>'input_hash';
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'opportunity', to_jsonb(v_existing)); end if;

  insert into public.ai_fleet_opportunities(opportunity_code, opportunity_type, scope, scope_key, severity,
    kpi_snapshot, benchmark_snapshot, expected_direction, evidence, limitations, source_version, input_hash, created_by)
  values (p_payload->>'opportunity_code', p_payload->>'opportunity_type', p_payload->>'scope', coalesce(nullif(p_payload->>'scope_key',''),'global'),
    p_payload->>'severity', coalesce(p_payload->'kpi_snapshot','{}'::jsonb), p_payload->'benchmark_snapshot',
    nullif(p_payload->>'expected_direction',''), p_payload->'evidence', coalesce(p_payload->'limitations','[]'::jsonb),
    p_payload->>'source_version', p_payload->>'input_hash', auth.uid())
  returning id into v_id;
  select * into v_row from public.ai_fleet_opportunities where id = v_id;
  return jsonb_build_object('idempotent', false, 'opportunity', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_fleet_opportunity_save(jsonb) to authenticated;

create or replace function public.admin_fleet_opportunities(p_type text default null, p_status text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_fleet_opportunities o
    where (p_type is null or o.opportunity_type = p_type) and (p_status is null or o.status = p_status)
    order by o.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_fleet_opportunities(text, text, int) to authenticated;

create or replace function public.admin_fleet_opportunity_set_status(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_fleet_opportunities;
begin
  perform public._admin_growth_guard();
  if p_status is null or p_status not in ('under_review','review_candidate','dismissed','resolved','superseded') then raise exception 'invalid status' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  select * into v_row from public.ai_fleet_opportunities where id = p_id;
  if v_row.id is null then raise exception 'opportunity not found' using errcode='P0002'; end if;
  update public.ai_fleet_opportunities set status = p_status, updated_at = now() where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_fleet_opportunity_set_status(uuid, text, text) to authenticated;
