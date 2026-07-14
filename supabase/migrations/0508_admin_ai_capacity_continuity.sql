-- 0508_admin_ai_capacity_continuity.sql
-- Phase AI-OPS-5 — Capacity Intelligence, Demand Forecasting, Cost Governance &
-- Operational Continuity Planning.
--
-- 실제 Usage/Limit/Cost 구조 분석 결과(추측 없음):
--   측정 가능 Usage: playback_events_v2(일/시간별 이벤트·활성 store(business_id)·활성
--     player(user_id)), tracks/playlists/playlist_tracks/audit 행 수, pg_stat_user_tables
--     행 추정치, pg_total_relation_size(DB storage), pg_stat_activity(connections,
--     point-in-time), storage.objects metadata size(bucket: audio/covers/brand-assets)
--   측정 불가: 동시 player(세션 telemetry 없음), bandwidth, edge function 호출 수,
--     API request 수, build minutes, deployment 수 — Provider Usage API 미연동 → unsupported
--   Limit: Supabase/Vercel Plan limit 자동 조회 불가 → 전부 limit_unknown(관리자 입력 전)
--   Cost: 청구서/Billing 테이블 없음 → 단가는 관리자 입력만, actual cost 는 관리자 기록만
--   Continuity(코드에서 확인된 실제 Dependency): Supabase(db/auth/storage),
--     Vercel(frontend), Resend(email), PayApp(payment), Kakao(messaging)
--
-- 원칙:
--   * Limit 모르면 utilization/headroom/exhaustion 계산 안 함(limit_unknown) ·
--     단가 없으면 cost_unknown · null→0 변환 없음 · 음수 usage/limit/cost 차단
--   * AI 가 Metric/Limit/Threshold/단가/Budget/Dependency 를 직접 수정 불가 —
--     관리자 승인 + Audit, 삭제 RPC 없음, Trigger 없음
--   * Infrastructure/Billing API 호출 없음 · 자동 Scale/Backup/Restore/Plan 변경 없음
--   * 예측값을 실제 Usage/Outcome 으로 저장하지 않음(Actual/Estimated/Forecast 분리)

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Capacity Metric 정의 — 실측 가능한 metric whitelist + 관리자 입력 Limit.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_capacity_metrics (
  id                  uuid primary key default gen_random_uuid(),
  metric_code         text not null unique check (metric_code in (
    'daily_playback_events','hourly_peak_playback_events','active_stores_daily','active_players_daily',
    'tracks_total','playlists_total','playlist_tracks_total','audit_event_count',
    'database_row_estimate','database_storage_bytes','database_connections',
    'audio_storage_bytes','image_storage_bytes')),
  domain              text not null check (domain in ('playback_events','active_stores','active_players','concurrent_players','database_rows','database_storage','database_connections','storage_audio','storage_images','bandwidth','edge_functions','api_requests','background_jobs','build_minutes','deployment_count','notification_volume','email_volume','settlement_volume','audit_volume')),
  title               text not null,
  description         text,
  unit                text not null check (unit in ('count','bytes','connections','events_per_day','events_per_hour')),
  source_type         text not null check (source_type in ('playback_events_v2','table_count','pg_stats','pg_stat_activity','storage_objects')),
  aggregation_type    text not null default 'point_in_time' check (aggregation_type in ('daily_count','hourly_peak','point_in_time')),
  limit_source        text not null default 'not_configured' check (limit_source in ('not_configured','admin_entered','provider_documented')),
  hard_limit          numeric check (hard_limit is null or hard_limit >= 0),
  soft_limit          numeric check (soft_limit is null or soft_limit >= 0),
  warning_threshold   numeric not null default 75 check (warning_threshold > 0 and warning_threshold <= 100),
  critical_threshold  numeric not null default 90 check (critical_threshold > 0 and critical_threshold <= 100),
  scope_type          text not null default 'global' check (scope_type in ('global','store','enterprise')),
  source_version      text not null default 'capacity_v1(0508)',
  is_active           boolean not null default false,
  limitations         jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  created_by          uuid,
  approved_by         uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Capacity Snapshot — 실측 usage. Limit 없으면 utilization/headroom null.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_capacity_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  metric_id           uuid not null references public.ai_capacity_metrics(id),
  scope_type          text not null default 'global',
  period_start        timestamptz,
  period_end          timestamptz not null,
  current_usage       numeric check (current_usage is null or current_usage >= 0),
  soft_limit          numeric check (soft_limit is null or soft_limit >= 0),
  hard_limit          numeric check (hard_limit is null or hard_limit >= 0),
  utilization_percent numeric check (utilization_percent is null or utilization_percent >= 0),
  growth_per_day      numeric,
  headroom            numeric,
  projected_exhaustion_at timestamptz,
  status              text not null check (status in ('healthy','watch','constrained','saturation_risk','exhausted','limit_unknown','insufficient_data','unsupported','invalid')),
  sample_size         bigint,
  source_version      text not null default 'capacity_v1(0508)',
  input_hash          text not null,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '[]'::jsonb,
  calculated_at       timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  unique (metric_id, period_end)
);
create index if not exists idx_cap_snap on public.ai_capacity_snapshots (metric_id, period_end desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Cost Model — 관리자 입력 단가만(청구서 근거). AI 수정 불가.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_cost_models (
  id                  uuid primary key default gen_random_uuid(),
  cost_code           text not null,
  provider            text not null check (provider in ('supabase','vercel','resend','payapp','kakao','storage','other')),
  resource_type       text not null,
  unit                text not null,
  unit_price          numeric not null check (unit_price >= 0),
  currency            text not null check (currency in ('KRW','USD')),
  billing_period      text not null default 'monthly' check (billing_period in ('monthly','yearly','per_use')),
  included_amount     numeric check (included_amount is null or included_amount >= 0),
  overage_price       numeric check (overage_price is null or overage_price >= 0),
  effective_from      timestamptz not null default now(),
  effective_to        timestamptz,
  version             int not null default 1 check (version >= 1),
  source              text not null,                     -- 청구서/공식 요금표 등 근거 필수
  evidence            jsonb not null default '[]'::jsonb,
  approved_by         uuid,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  unique (cost_code, version)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Cost Snapshot — Actual(청구 기록)과 Estimated(단가×사용량) 분리.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_cost_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  period_start        timestamptz not null,
  period_end          timestamptz not null,
  provider            text not null check (provider in ('supabase','vercel','resend','payapp','kakao','storage','other')),
  resource_type       text not null,
  usage_amount        numeric check (usage_amount is null or usage_amount >= 0),
  included_usage      numeric check (included_usage is null or included_usage >= 0),
  billable_usage      numeric check (billable_usage is null or billable_usage >= 0),
  estimated_cost      numeric check (estimated_cost is null or estimated_cost >= 0),
  actual_cost         numeric check (actual_cost is null or actual_cost >= 0),
  currency            text not null default 'KRW' check (currency in ('KRW','USD')),
  model_version       text,
  input_hash          text not null,
  status              text not null check (status in ('actual','estimated','provisional','cost_unknown','insufficient_data','invalid')),
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '[]'::jsonb,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  unique (provider, resource_type, period_end, input_hash)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Capacity(Scaling) Plan — 계획/권고 문서만. 실행 상태 없음.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_capacity_plans (
  id                  uuid primary key default gen_random_uuid(),
  plan_code           text not null unique,
  metric_code         text not null,
  scope_type          text not null default 'global',
  plan_type           text not null check (plan_type in ('scale_up_review','soft_limit_increase','storage_optimization','query_optimization','cold_data_archive','provider_plan_review','continuity_improvement','monitor_only')),
  current_capacity    numeric check (current_capacity is null or current_capacity >= 0),
  target_capacity     numeric check (target_capacity is null or target_capacity >= 0),
  forecast_horizon    text,
  trigger_condition   text not null,
  recommended_window  text,
  expected_cost       jsonb not null default '{}'::jsonb,     -- 단가 없으면 {"status":"cost_unknown"}
  risk_tier           text not null default 'medium' check (risk_tier in ('low','medium','high','critical')),
  dependencies        jsonb not null default '[]'::jsonb,
  validation_plan     jsonb not null default '[]'::jsonb,
  rollback_plan       jsonb,
  observation_plan    jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '[]'::jsonb,
  status              text not null default 'draft' check (status in ('draft','pending_review','approved_reference','rejected','cancelled','expired')),
  idempotency_key     text not null unique,
  requested_by        uuid,
  reviewed_by         uuid,
  created_at          timestamptz not null default now(),
  reviewed_at         timestamptz,
  expired_at          timestamptz
);

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Operational Dependency Inventory — 코드/설정에서 확인된 항목만.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_operational_dependencies (
  id                  uuid primary key default gen_random_uuid(),
  dependency_code     text not null unique,
  domain              text not null check (domain in ('database','storage','auth','player','cdn','api','frontend','edge_functions','external_provider','monitoring','notification','payment','email')),
  provider            text not null,
  service_name        text not null,
  dependency_type     text not null default 'managed_service',
  criticality         text not null default 'high' check (criticality in ('low','medium','high','critical')),
  failure_impact      text,
  fallback_available  boolean,
  fallback_description text,
  rto_target          text not null default 'not_defined',   -- 관리자 승인 값만 — AI 생성 금지
  rpo_target          text not null default 'not_defined',
  monitoring_source   text,
  owner               text,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '[]'::jsonb,
  lifecycle_status    text not null default 'draft' check (lifecycle_status in ('draft','active','deprecated','archived')),
  approved_by         uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Capacity Event(Audit).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_capacity_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('metric_saved','snapshot_created','capacity_watch','saturation_risk_detected','capacity_exhausted','limit_unknown_reported','cost_model_saved','cost_snapshot_saved','cost_anomaly_detected','plan_saved','plan_reviewed','dependency_saved','continuity_review','recommendation_generated')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_cap_evt on public.ai_capacity_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Seed — 실측 가능한 Metric 13종(is_active=false · limit_unknown) +
--    코드에서 확인된 Dependency 7종(draft — 관리자 확정 필요).
-- ─────────────────────────────────────────────────────────────────────────
insert into public.ai_capacity_metrics (metric_code, domain, title, unit, source_type, aggregation_type, limitations, evidence) values
  ('daily_playback_events','playback_events','일별 Playback Event','events_per_day','playback_events_v2','daily_count','[]'::jsonb,'[{"label":"source","value":"playback_events_v2 실측"}]'::jsonb),
  ('hourly_peak_playback_events','playback_events','시간별 최대 Playback Event(7일)','events_per_hour','playback_events_v2','hourly_peak','[]'::jsonb,'[{"label":"source","value":"playback_events_v2 실측"}]'::jsonb),
  ('active_stores_daily','active_stores','일별 활성 Store','count','playback_events_v2','daily_count','["playback 이벤트 발생 store 기준"]'::jsonb,'[{"label":"source","value":"distinct business_id 실측"}]'::jsonb),
  ('active_players_daily','active_players','일별 활성 Player(사용자)','count','playback_events_v2','daily_count','["동시 접속 아님 — 일별 distinct"]'::jsonb,'[{"label":"source","value":"distinct user_id 실측"}]'::jsonb),
  ('tracks_total','database_rows','전체 Track 수','count','table_count','point_in_time','[]'::jsonb,'[{"label":"source","value":"tracks 행 수"}]'::jsonb),
  ('playlists_total','database_rows','전체 Playlist 수','count','table_count','point_in_time','[]'::jsonb,'[{"label":"source","value":"playlists 행 수"}]'::jsonb),
  ('playlist_tracks_total','database_rows','전체 Playlist Track 수','count','table_count','point_in_time','[]'::jsonb,'[{"label":"source","value":"playlist_tracks 행 수"}]'::jsonb),
  ('audit_event_count','audit_volume','전체 Playback Event 행 수','count','table_count','point_in_time','[]'::jsonb,'[{"label":"source","value":"playback_events_v2 행 수"}]'::jsonb),
  ('database_row_estimate','database_rows','Public Schema 행 추정치','count','pg_stats','point_in_time','["pg_stat 추정치 — 정확한 count 아님"]'::jsonb,'[{"label":"source","value":"pg_stat_user_tables n_live_tup"}]'::jsonb),
  ('database_storage_bytes','database_storage','Database Storage 사용량','bytes','pg_stats','point_in_time','[]'::jsonb,'[{"label":"source","value":"pg_total_relation_size 합계"}]'::jsonb),
  ('database_connections','database_connections','현재 DB Connection 수','connections','pg_stat_activity','point_in_time','["point-in-time — 기간형 아님"]'::jsonb,'[{"label":"source","value":"pg_stat_activity 실측"}]'::jsonb),
  ('audio_storage_bytes','storage_audio','Audio Storage 사용량','bytes','storage_objects','point_in_time','[]'::jsonb,'[{"label":"source","value":"storage.objects(audio bucket) size 합계"}]'::jsonb),
  ('image_storage_bytes','storage_images','Image Storage 사용량','bytes','storage_objects','point_in_time','[]'::jsonb,'[{"label":"source","value":"storage.objects(covers/brand-assets) size 합계"}]'::jsonb)
on conflict (metric_code) do nothing;

insert into public.ai_operational_dependencies (dependency_code, domain, provider, service_name, criticality, failure_impact, fallback_available, evidence, limitations) values
  ('dep_supabase_database','database','supabase','Supabase Postgres','critical','전체 서비스 중단(데이터/RPC)', false, '[{"label":"source","value":"src/lib/supabase 및 전체 RPC"}]'::jsonb,'["대체 DB 없음 — potential SPOF"]'::jsonb),
  ('dep_supabase_auth','auth','supabase','Supabase Auth','critical','로그인/관리자 접근 불가', false, '[{"label":"source","value":"supabase.auth 사용"}]'::jsonb,'["대체 인증 없음"]'::jsonb),
  ('dep_supabase_storage','storage','supabase','Supabase Storage(audio/covers/brand-assets)','critical','오디오/이미지 재생·표시 불가', false, '[{"label":"source","value":"storage.from(audio/covers/brand-assets)"}]'::jsonb,'["CDN 캐시 외 대체 없음"]'::jsonb),
  ('dep_vercel_frontend','frontend','vercel','Vercel Hosting','critical','웹/관리자 UI 접근 불가', false, '[{"label":"source","value":"Vercel 배포 파이프라인"}]'::jsonb,'["대체 호스팅 없음"]'::jsonb),
  ('dep_resend_email','email','resend','Resend Email','medium','알림/인보이스 메일 발송 실패', false, '[{"label":"source","value":"supabase/functions/dispatch-* RESEND_API_KEY"}]'::jsonb,'["메일 재시도 큐 존재 여부 별도 확인 필요"]'::jsonb),
  ('dep_payapp_payment','payment','payapp','PayApp 결제/구독','high','신규 결제·구독 변경 불가', false, '[{"label":"source","value":"supabase/functions/create-payapp-subscription"}]'::jsonb,'["결제 대체 수단 없음"]'::jsonb),
  ('dep_kakao_messaging','notification','kakao','Kakao 메시지','low','카카오 알림 발송 실패', false, '[{"label":"source","value":"supabase/functions/dispatch-kakao-message"}]'::jsonb,'[]'::jsonb)
on conflict (dependency_code) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) Metric 저장/활성화 — 관리자만(Limit/Threshold 변경 포함). AI 불가.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_capacity_metric_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_row public.ai_capacity_metrics; v_hard numeric; v_soft numeric;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'metric_code','') = '' then raise exception 'metric_code required' using errcode='22023'; end if;
  if coalesce(p_payload->>'change_reason','') = '' then raise exception 'change_reason required (관리자 승인 없는 Limit/Threshold 변경 금지)' using errcode='22023'; end if;
  select id into v_id from public.ai_capacity_metrics where metric_code = p_payload->>'metric_code';
  if v_id is null then raise exception 'metric not found — whitelist 외 metric 생성 금지' using errcode='P0002'; end if;
  v_hard := nullif(p_payload->>'hard_limit','')::numeric; v_soft := nullif(p_payload->>'soft_limit','')::numeric;
  if v_hard is not null and (v_hard <> v_hard or v_hard < 0) then raise exception 'hard_limit 음수/NaN 금지' using errcode='22023'; end if;
  if v_soft is not null and (v_soft <> v_soft or v_soft < 0) then raise exception 'soft_limit 음수/NaN 금지' using errcode='22023'; end if;
  update public.ai_capacity_metrics set
    is_active = coalesce((p_payload->>'is_active')::boolean, is_active),
    hard_limit = coalesce(v_hard, hard_limit),
    soft_limit = coalesce(v_soft, soft_limit),
    limit_source = case when v_hard is not null or v_soft is not null then coalesce(nullif(p_payload->>'limit_source',''),'admin_entered') else limit_source end,
    warning_threshold = coalesce(nullif(p_payload->>'warning_threshold','')::numeric, warning_threshold),
    critical_threshold = coalesce(nullif(p_payload->>'critical_threshold','')::numeric, critical_threshold),
    evidence = coalesce(p_payload->'evidence', evidence),
    approved_by = auth.uid(), updated_at = now()
  where id = v_id returning * into v_row;
  insert into public.ai_capacity_events(event_type, ref_id, detail, actor_id) values ('metric_saved', v_id, p_payload->>'change_reason', auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_capacity_metric_save(jsonb) to authenticated;

create or replace function public.admin_capacity_metrics(p_domain text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.domain, t.metric_code), '[]'::jsonb) into v_items from (
    select * from public.ai_capacity_metrics m where (p_domain is null or m.domain = p_domain) limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_capacity_metrics(text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) 일별 Usage 시계열 — Baseline/Trend/Forecast 의 실측 입력(TS 계산용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_capacity_usage(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_days int := greatest(1, least(coalesce(p_days,30), 90)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.day), '[]'::jsonb) into v_items from (
    select (created_at at time zone 'Asia/Seoul')::date as day,
           count(*) as events,
           count(distinct business_id) as active_stores,
           count(distinct user_id) as active_players
    from public.playback_events_v2
    where created_at >= now() - make_interval(days => v_days)
    group by 1 order by 1
  ) t;
  return jsonb_build_object('items', v_items, 'days', v_days, 'generated_at', now());
end; $$;
grant execute on function public.admin_capacity_usage(int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 11) Capacity Snapshot 생성 — metric_code 별 실측. Limit 없으면 utilization/
--     headroom/exhaustion null + limit_unknown(추정 Limit 로 Saturation 보고 금지).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_capacity_snapshot_create(p_metric_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_m public.ai_capacity_metrics; v_usage numeric; v_sample bigint; v_start timestamptz; v_end timestamptz := date_trunc('hour', now());
  v_prev public.ai_capacity_snapshots; v_growth numeric; v_util numeric; v_headroom numeric; v_exhaust timestamptz; v_status text;
  v_row public.ai_capacity_snapshots;
begin
  perform public._admin_growth_guard();
  select * into v_m from public.ai_capacity_metrics where id = p_metric_id;
  if v_m.id is null then raise exception 'metric not found' using errcode='P0002'; end if;
  if not v_m.is_active then raise exception 'metric 미활성 — 관리자 활성화 필요' using errcode='22023'; end if;

  if v_m.metric_code = 'daily_playback_events' then
    v_start := v_end - interval '1 day';
    select count(*), count(*) into v_usage, v_sample from public.playback_events_v2 where created_at >= v_start and created_at < v_end;
  elsif v_m.metric_code = 'hourly_peak_playback_events' then
    v_start := v_end - interval '7 days';
    select max(c), sum(c) into v_usage, v_sample from (select count(*) c from public.playback_events_v2 where created_at >= v_start and created_at < v_end group by date_trunc('hour', created_at)) x;
  elsif v_m.metric_code = 'active_stores_daily' then
    v_start := v_end - interval '1 day';
    select count(distinct business_id), count(*) into v_usage, v_sample from public.playback_events_v2 where created_at >= v_start and created_at < v_end;
  elsif v_m.metric_code = 'active_players_daily' then
    v_start := v_end - interval '1 day';
    select count(distinct user_id), count(*) into v_usage, v_sample from public.playback_events_v2 where created_at >= v_start and created_at < v_end;
  elsif v_m.metric_code = 'tracks_total' then select count(*), count(*) into v_usage, v_sample from public.tracks;
  elsif v_m.metric_code = 'playlists_total' then select count(*), count(*) into v_usage, v_sample from public.playlists;
  elsif v_m.metric_code = 'playlist_tracks_total' then select count(*), count(*) into v_usage, v_sample from public.playlist_tracks;
  elsif v_m.metric_code = 'audit_event_count' then select count(*), count(*) into v_usage, v_sample from public.playback_events_v2;
  elsif v_m.metric_code = 'database_row_estimate' then
    select sum(n_live_tup), count(*) into v_usage, v_sample from pg_stat_user_tables where schemaname = 'public';
  elsif v_m.metric_code = 'database_storage_bytes' then
    select sum(pg_total_relation_size(relid)), count(*) into v_usage, v_sample from pg_stat_user_tables where schemaname = 'public';
  elsif v_m.metric_code = 'database_connections' then
    select count(*), count(*) into v_usage, v_sample from pg_stat_activity;
  elsif v_m.metric_code = 'audio_storage_bytes' then
    select sum(coalesce((metadata->>'size')::numeric, 0)), count(*) into v_usage, v_sample from storage.objects where bucket_id = 'audio';
  elsif v_m.metric_code = 'image_storage_bytes' then
    select sum(coalesce((metadata->>'size')::numeric, 0)), count(*) into v_usage, v_sample from storage.objects where bucket_id in ('covers','brand-assets');
  else
    raise exception 'metric % 미지원', v_m.metric_code using errcode='22023';
  end if;

  if v_usage is not null and v_usage < 0 then raise exception '음수 usage 차단' using errcode='22023'; end if;

  -- 성장률: 직전 snapshot 대비 일 환산(단일 Spike 방어는 TS Trend 에서 별도).
  select * into v_prev from public.ai_capacity_snapshots where metric_id = p_metric_id and period_end < v_end order by period_end desc limit 1;
  if v_prev.id is not null and v_prev.current_usage is not null and v_usage is not null
     and extract(epoch from (v_end - v_prev.period_end)) > 0 then
    v_growth := round(((v_usage - v_prev.current_usage) / (extract(epoch from (v_end - v_prev.period_end)) / 86400))::numeric, 3);
  end if;

  if v_usage is null then v_status := 'insufficient_data';
  elsif v_m.hard_limit is null then v_status := 'limit_unknown';    -- Limit 모르면 사용률/headroom/exhaustion 계산 안 함
  else
    if v_m.hard_limit > 0 then v_util := round(v_usage / v_m.hard_limit * 100, 2); end if;
    v_headroom := v_m.hard_limit - v_usage;
    if v_growth is not null and v_growth > 0 and v_headroom > 0 then
      v_exhaust := v_end + make_interval(days => floor(v_headroom / v_growth)::int);
    end if;
    v_status := case when v_util is null then 'invalid'
                     when v_util >= 100 then 'exhausted'
                     when v_util >= v_m.critical_threshold then 'saturation_risk'
                     when v_util >= v_m.warning_threshold then 'constrained'
                     when v_util >= 50 then 'watch'
                     else 'healthy' end;
  end if;

  insert into public.ai_capacity_snapshots (metric_id, period_start, period_end, current_usage, soft_limit, hard_limit, utilization_percent, growth_per_day, headroom, projected_exhaustion_at, status, sample_size, input_hash, evidence, limitations)
  values (p_metric_id, v_start, v_end, v_usage, v_m.soft_limit, v_m.hard_limit, v_util, v_growth, v_headroom, v_exhaust, v_status, v_sample,
    md5(p_metric_id::text || '|' || v_end::text),
    jsonb_build_array(jsonb_build_object('label','source',      'value', v_m.source_type), jsonb_build_object('label','actual','value',true)),
    v_m.limitations)
  on conflict (metric_id, period_end) do update set
    current_usage = excluded.current_usage, utilization_percent = excluded.utilization_percent,
    growth_per_day = excluded.growth_per_day, headroom = excluded.headroom,
    projected_exhaustion_at = excluded.projected_exhaustion_at, status = excluded.status,
    sample_size = excluded.sample_size, calculated_at = now()
  returning * into v_row;

  insert into public.ai_capacity_events(event_type, ref_id, detail, actor_id)
  values (case when v_row.status = 'exhausted' then 'capacity_exhausted'
               when v_row.status = 'saturation_risk' then 'saturation_risk_detected'
               when v_row.status = 'limit_unknown' then 'limit_unknown_reported'
               else 'snapshot_created' end,
          v_row.id, format('%s usage=%s status=%s', v_m.metric_code, coalesce(v_usage::text,'null'), v_row.status), auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_capacity_snapshot_create(uuid) to authenticated;

create or replace function public.admin_capacity_snapshots(p_metric_id uuid default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 500)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.period_end desc), '[]'::jsonb) into v_items from (
    select s.*, m.metric_code, m.domain, m.unit from public.ai_capacity_snapshots s
    join public.ai_capacity_metrics m on m.id = s.metric_id
    where (p_metric_id is null or s.metric_id = p_metric_id)
    order by s.period_end desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_capacity_snapshots(uuid, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 12) Cost Model / Cost Snapshot — 관리자 입력만. Actual/Estimated 분리.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_cost_model_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prev public.ai_cost_models; v_row public.ai_cost_models; v_version int := 1; v_price numeric;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'cost_code','') = '' or coalesce(p_payload->>'source','') = '' then
    raise exception 'cost_code/source 필수 (청구서·요금표 근거 없는 단가 생성 금지)' using errcode='22023';
  end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  v_price := (p_payload->>'unit_price')::numeric;
  if v_price is null or v_price <> v_price or v_price < 0 then raise exception 'unit_price 음수/NaN 금지' using errcode='22023'; end if;
  select * into v_prev from public.ai_cost_models where cost_code = p_payload->>'cost_code' order by version desc limit 1;
  if v_prev.id is not null then v_version := v_prev.version + 1;
    update public.ai_cost_models set effective_to = now() where id = v_prev.id and effective_to is null;
  end if;
  insert into public.ai_cost_models (cost_code, provider, resource_type, unit, unit_price, currency, billing_period, included_amount, overage_price, version, source, evidence, approved_by, created_by)
  values (p_payload->>'cost_code', p_payload->>'provider', coalesce(p_payload->>'resource_type','general'), coalesce(p_payload->>'unit','unit'),
    v_price, coalesce(nullif(p_payload->>'currency',''),'KRW'), coalesce(nullif(p_payload->>'billing_period',''),'monthly'),
    nullif(p_payload->>'included_amount','')::numeric, nullif(p_payload->>'overage_price','')::numeric,
    v_version, p_payload->>'source', p_payload->'evidence', auth.uid(), auth.uid())
  returning * into v_row;
  insert into public.ai_capacity_events(event_type, ref_id, detail, actor_id) values ('cost_model_saved', v_row.id, format('%s v%s', v_row.cost_code, v_version), auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_cost_model_save(jsonb) to authenticated;

create or replace function public.admin_cost_models(p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.cost_code, t.version desc), '[]'::jsonb) into v_items from (
    select * from public.ai_cost_models order by cost_code, version desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_cost_models(int) to authenticated;

create or replace function public.admin_cost_snapshot_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_cost_snapshots; v_status text := coalesce(nullif(p_payload->>'status',''),'estimated');
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if v_status not in ('actual','estimated','provisional','cost_unknown','insufficient_data') then raise exception 'invalid status' using errcode='22023'; end if;
  if v_status = 'actual' and (nullif(p_payload->>'actual_cost','')::numeric is null) then raise exception 'actual 상태는 actual_cost 필수(청구 기록)' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  if coalesce(nullif(p_payload->>'estimated_cost','')::numeric, 0) < 0 or coalesce(nullif(p_payload->>'actual_cost','')::numeric, 0) < 0 then raise exception '음수 cost 차단' using errcode='22023'; end if;
  insert into public.ai_cost_snapshots (period_start, period_end, provider, resource_type, usage_amount, included_usage, billable_usage, estimated_cost, actual_cost, currency, model_version, input_hash, status, evidence, limitations, created_by)
  values ((p_payload->>'period_start')::timestamptz, (p_payload->>'period_end')::timestamptz,
    p_payload->>'provider', coalesce(p_payload->>'resource_type','general'),
    nullif(p_payload->>'usage_amount','')::numeric, nullif(p_payload->>'included_usage','')::numeric, nullif(p_payload->>'billable_usage','')::numeric,
    nullif(p_payload->>'estimated_cost','')::numeric, nullif(p_payload->>'actual_cost','')::numeric,
    coalesce(nullif(p_payload->>'currency',''),'KRW'), nullif(p_payload->>'model_version',''),
    md5(coalesce(p_payload->>'provider','') || '|' || coalesce(p_payload->>'resource_type','') || '|' || coalesce(p_payload->>'period_end','')),
    v_status, p_payload->'evidence', coalesce(p_payload->'limitations','["예상 비용 — 실제 청구서 아님"]'::jsonb), auth.uid())
  on conflict (provider, resource_type, period_end, input_hash) do update set
    usage_amount = excluded.usage_amount, estimated_cost = excluded.estimated_cost, actual_cost = excluded.actual_cost, status = excluded.status
  returning * into v_row;
  insert into public.ai_capacity_events(event_type, ref_id, detail, actor_id) values ('cost_snapshot_saved', v_row.id, format('%s/%s %s', v_row.provider, v_row.resource_type, v_status), auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_cost_snapshot_save(jsonb) to authenticated;

create or replace function public.admin_cost_snapshots(p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.period_end desc), '[]'::jsonb) into v_items from (
    select * from public.ai_cost_snapshots order by period_end desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_cost_snapshots(int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 13) Capacity Plan / Dependency — 계획·인벤토리 문서(실행 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_capacity_plan_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_capacity_plans; v_existing public.ai_capacity_plans;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 65536 then raise exception 'payload too large (64KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'plan_code','') = '' or coalesce(p_payload->>'trigger_condition','') = '' or coalesce(p_payload->>'idempotency_key','') = '' then
    raise exception 'plan_code/trigger_condition/idempotency_key 필수' using errcode='22023';
  end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  select * into v_existing from public.ai_capacity_plans where idempotency_key = p_payload->>'idempotency_key';
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'plan', to_jsonb(v_existing)); end if;
  insert into public.ai_capacity_plans (plan_code, metric_code, plan_type, current_capacity, target_capacity, forecast_horizon, trigger_condition, recommended_window, expected_cost, risk_tier, dependencies, validation_plan, rollback_plan, observation_plan, evidence, limitations, idempotency_key, requested_by)
  values (p_payload->>'plan_code', coalesce(p_payload->>'metric_code','—'), p_payload->>'plan_type',
    nullif(p_payload->>'current_capacity','')::numeric, nullif(p_payload->>'target_capacity','')::numeric,
    nullif(p_payload->>'forecast_horizon',''), p_payload->>'trigger_condition', nullif(p_payload->>'recommended_window',''),
    coalesce(p_payload->'expected_cost','{"status":"cost_unknown"}'::jsonb), coalesce(nullif(p_payload->>'risk_tier',''),'medium'),
    coalesce(p_payload->'dependencies','[]'::jsonb), coalesce(p_payload->'validation_plan','[]'::jsonb),
    p_payload->'rollback_plan', p_payload->'observation_plan', p_payload->'evidence',
    coalesce(p_payload->'limitations','["계획 문서만 — 실제 Scale 실행 없음"]'::jsonb),
    p_payload->>'idempotency_key', auth.uid())
  returning * into v_row;
  insert into public.ai_capacity_events(event_type, ref_id, detail, actor_id) values ('plan_saved', v_row.id, v_row.plan_code, auth.uid());
  return jsonb_build_object('idempotent', false, 'plan', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_capacity_plan_save(jsonb) to authenticated;

create or replace function public.admin_capacity_plans(p_status text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_capacity_plans p where (p_status is null or p.status = p_status)
    order by p.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_capacity_plans(text, int) to authenticated;

create or replace function public.admin_capacity_plan_review(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_capacity_plans;
begin
  perform public._admin_growth_guard();
  if p_status is null or p_status not in ('pending_review','approved_reference','rejected','cancelled','expired') then raise exception 'invalid status' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  update public.ai_capacity_plans set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(),
    expired_at = case when p_status = 'expired' then now() else expired_at end
  where id = p_id returning * into v_row;
  if v_row.id is null then raise exception 'plan not found' using errcode='P0002'; end if;
  insert into public.ai_capacity_events(event_type, ref_id, detail, actor_id) values ('plan_reviewed', p_id, format('%s — %s', p_status, p_reason), auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_capacity_plan_review(uuid, text, text) to authenticated;

create or replace function public.admin_operational_dependency_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_row public.ai_operational_dependencies;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'dependency_code','') = '' then raise exception 'dependency_code required' using errcode='22023'; end if;
  if coalesce(p_payload->>'change_reason','') = '' then raise exception 'change_reason required' using errcode='22023'; end if;
  select id into v_id from public.ai_operational_dependencies where dependency_code = p_payload->>'dependency_code';
  if v_id is null then
    if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then
      raise exception 'evidence required (실제 서비스·설정에서 확인된 Dependency 만 등록)' using errcode='22023';
    end if;
    insert into public.ai_operational_dependencies (dependency_code, domain, provider, service_name, criticality, failure_impact, fallback_available, fallback_description, rto_target, rpo_target, monitoring_source, owner, evidence, limitations, lifecycle_status, approved_by)
    values (p_payload->>'dependency_code', p_payload->>'domain', coalesce(p_payload->>'provider','—'), coalesce(p_payload->>'service_name','—'),
      coalesce(nullif(p_payload->>'criticality',''),'high'), nullif(p_payload->>'failure_impact',''),
      (p_payload->>'fallback_available')::boolean, nullif(p_payload->>'fallback_description',''),
      coalesce(nullif(p_payload->>'rto_target',''),'not_defined'), coalesce(nullif(p_payload->>'rpo_target',''),'not_defined'),
      nullif(p_payload->>'monitoring_source',''), nullif(p_payload->>'owner',''),
      p_payload->'evidence', coalesce(p_payload->'limitations','[]'::jsonb),
      coalesce(nullif(p_payload->>'lifecycle_status',''),'draft'), auth.uid())
    returning id into v_id;
  else
    update public.ai_operational_dependencies set
      criticality = coalesce(nullif(p_payload->>'criticality',''), criticality),
      fallback_available = coalesce((p_payload->>'fallback_available')::boolean, fallback_available),
      fallback_description = coalesce(nullif(p_payload->>'fallback_description',''), fallback_description),
      rto_target = coalesce(nullif(p_payload->>'rto_target',''), rto_target),        -- 관리자 승인 값만
      rpo_target = coalesce(nullif(p_payload->>'rpo_target',''), rpo_target),
      monitoring_source = coalesce(nullif(p_payload->>'monitoring_source',''), monitoring_source),
      owner = coalesce(nullif(p_payload->>'owner',''), owner),
      lifecycle_status = coalesce(nullif(p_payload->>'lifecycle_status',''), lifecycle_status),
      evidence = coalesce(p_payload->'evidence', evidence),
      approved_by = auth.uid(), updated_at = now()
    where id = v_id;
  end if;
  insert into public.ai_capacity_events(event_type, ref_id, detail, actor_id) values ('dependency_saved', v_id, p_payload->>'change_reason', auth.uid());
  select * into v_row from public.ai_operational_dependencies where id = v_id;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_operational_dependency_save(jsonb) to authenticated;

create or replace function public.admin_operational_dependencies(p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.criticality desc, t.dependency_code), '[]'::jsonb) into v_items from (
    select * from public.ai_operational_dependencies limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_operational_dependencies(int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 14) 요약 / Audit.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_capacity_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'metrics_total', (select count(*) from public.ai_capacity_metrics),
    'metrics_active', (select count(*) from public.ai_capacity_metrics where is_active),
    'metrics_with_limits', (select count(*) from public.ai_capacity_metrics where hard_limit is not null),
    'metrics_limit_unknown', (select count(*) from public.ai_capacity_metrics where hard_limit is null),
    'snapshot_by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
      select status, count(*) n from (
        select distinct on (metric_id) status from public.ai_capacity_snapshots order by metric_id, period_end desc
      ) latest group by status) x),
    'plans_total', (select count(*) from public.ai_capacity_plans),
    'cost_models', (select count(*) from public.ai_cost_models),
    'cost_actual_snapshots', (select count(*) from public.ai_cost_snapshots where status = 'actual'),
    'cost_estimated_snapshots', (select count(*) from public.ai_cost_snapshots where status = 'estimated'),
    'dependencies_total', (select count(*) from public.ai_operational_dependencies),
    'dependencies_critical', (select count(*) from public.ai_operational_dependencies where criticality = 'critical'),
    'last_snapshot_at', (select max(calculated_at) from public.ai_capacity_snapshots),
    'generated_at', now()
  ) into v;
  return v;
end; $$;
grant execute on function public.admin_capacity_summary() to authenticated;

create or replace function public.admin_capacity_audit(p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,200), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_capacity_events order by created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_capacity_audit(int) to authenticated;
