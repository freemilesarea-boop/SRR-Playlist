-- 0527_admin_ai_market_intelligence.sql
-- Phase AI-OPS-24 — Enterprise Market Intelligence, Competitive Intelligence &
-- External Environment Center.
--
-- 실제 구조 분석 결과(추측 없음 — 실측 소스 검증 완료):
--   Customer Behavior 원본: playback_events_v2(store_type_slug/created_at/session_id/
--     device_type — 0253 검증), playlists.business_category(0001).
--   조직 지역 원본: enterprise_regions(0352 — 조직 구조이며 시장 지역 데이터 아님, 참조만).
--   외부 시장/경쟁사/산업/경제/규제 데이터 원본 없음(실측)
--     → market_unavailable 유지(임의 생성 금지). 경쟁사 프로필은 사람 입력만.
--
-- Market 정직성(전부 강제):
--   * 자동 경쟁사 생성/자동 시장 분석 확정/자동 전략·KPI·예산·계약 변경 없음.
--   * Market Trend ≠ Future Guarantee. Competition ≠ Threat. Opportunity ≠ Success.
--   * Signal ≠ Fact — Signal 은 Confirmed 가 아닌 observed 상태에서 시작(서버 강제).
--   * Correlation ≠ Causation. Recommendation ≠ Business Decision.
--   * Unknown 유지(null→0 금지). 표본 부족 sample_too_small. 근거 부족 market_unverified.
--   * Trigger 없음 · 삭제 RPC 없음 · 원본 미변경 · 자동 발송 없음.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Competitor Profile — 사람 입력만(자동 경쟁사 생성 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_market_competitors (
  id                  uuid primary key default gen_random_uuid(),
  competitor_code     text not null unique,
  name                text not null,
  category            text,
  region              text,
  position_reference  text,                                       -- 사람 관찰 참조 — 사실 단정 아님
  capability_notes    jsonb not null default '[]'::jsonb,
  data_availability   text not null default 'market_unavailable' check (data_availability in ('external_data_available','market_unavailable')),
  record_status       text not null default 'active_reference' check (record_status in ('active_reference','under_review','superseded_reference','invalidated','market_unverified')),
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  review_reason       text,
  warnings            jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Competition ≠ Threat","사람 관찰 기록 — 사실 단정 아님"]'::jsonb,
  source_version      text not null default 'market_v1(0527)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_mkt_comp on public.ai_market_competitors (record_status, category, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Market Signal — observed 에서 시작(Signal ≠ Fact, 서버 강제).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_market_signals (
  id                  uuid primary key default gen_random_uuid(),
  signal_code         text not null unique,
  signal_kind         text not null check (signal_kind in ('economic','seasonal','regulatory','technology','consumer','industry','competitor')),
  title               text not null,
  detail              text,
  region              text,
  category            text,
  observed_at         date,
  signal_status       text not null default 'observed' check (signal_status in ('observed','corroborated_reference','contradicted_reference','expired_reference','invalidated')),
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  review_reason       text,
  warnings            jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Signal ≠ Fact","observed 는 관찰이며 확정 아님"]'::jsonb,
  source_version      text not null default 'market_v1(0527)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_mkt_signal on public.ai_market_signals (signal_kind, signal_status, created_at desc);

-- Trend/Industry/Regional/Behavior/Opportunity/Risk/Correlation/Briefing/권고/Audit 는 Event 통합(테이블 최소화).
create table if not exists public.ai_market_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('competitor_recorded','competitor_observed','competitor_reviewed','market_signal_recorded','market_signal_reviewed','market_trend_analyzed','industry_analyzed','regional_analyzed','customer_behavior_analyzed','market_opportunity_proposed','market_risk_assessed','market_correlation_analyzed','market_briefing_recorded','market_recommendation_created','external_market_reference','market_item_invalidated')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_mkt_evt on public.ai_market_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) 요약 — 내부 행동 실측 + 외부 미존재 정직 표기.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_market_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'behavior_actuals', jsonb_build_object(
      'plays_30d', (select count(*) from public.playback_events_v2 where created_at > now() - interval '30 days' and event_type = 'play_start'),
      'distinct_sessions_30d', (select count(distinct session_id) from public.playback_events_v2 where created_at > now() - interval '30 days' and session_id is not null),
      'distinct_categories_30d', (select count(distinct store_type_slug) from public.playback_events_v2 where created_at > now() - interval '30 days' and store_type_slug is not null),
      'playlists_total', (select count(*) from public.playlists),
      'playlists_played_30d', (select count(distinct playlist_id) from public.playback_events_v2 where created_at > now() - interval '30 days' and playlist_id is not null),
      'enterprise_regions_registered', (select count(*) from public.enterprise_regions where deleted_at is null)   -- 조직 실측 — 시장 지역 데이터 아님
    ),
    'category_plays_30d', (select coalesce(jsonb_object_agg(slug, n), '{}'::jsonb) from (
      select store_type_slug slug, count(*) n from public.playback_events_v2
      where created_at > now() - interval '30 days' and store_type_slug is not null and event_type = 'play_start'
      group by store_type_slug order by n desc limit 10) x),
    'hour_distribution_30d', (select coalesce(jsonb_object_agg(h::text, n), '{}'::jsonb) from (
      select extract(hour from created_at)::int h, count(*) n from public.playback_events_v2
      where created_at > now() - interval '30 days' and event_type = 'play_start' group by 1) x),
    'device_distribution_30d', (select coalesce(jsonb_object_agg(coalesce(device_type, '(unknown)'), n), '{}'::jsonb) from (
      select device_type, count(*) n from public.playback_events_v2
      where created_at > now() - interval '30 days' group by device_type order by n desc limit 8) x),
    'market_unavailable', jsonb_build_array('industry_dataset','competitor_external_data','economic_indicators','regulatory_feed','country_city_market_data','consumer_survey','seasonal_market_dataset'),   -- 외부 원본 없음(실측)
    'competitors_total', (select count(*) from public.ai_market_competitors),
    'competitors_unavailable', (select count(*) from public.ai_market_competitors where data_availability = 'market_unavailable'),
    'signals_total', (select count(*) from public.ai_market_signals),
    'signals_by_status', (select coalesce(jsonb_object_agg(signal_status, n), '{}'::jsonb) from (select signal_status, count(*) n from public.ai_market_signals group by signal_status) x),
    'no_auto_competitor_creation', true, 'no_auto_market_conclusion', true, 'signal_is_not_fact', true,
    'correlation_is_not_causation', true, 'opportunity_is_not_success', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Competitor 생성·관찰·검토 — 사람 입력만.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_market_competitor_create(
  p_code text, p_name text, p_evidence jsonb,
  p_category text default null, p_region text default null, p_position text default null,
  p_capabilities jsonb default '[]'::jsonb, p_external_data boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_name is null or btrim(p_name) = '' then raise exception 'name 필수(사람 입력 — 자동 경쟁사 생성 없음)'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence(출처) 필수 — market_unverified 방지'; end if;
  if jsonb_array_length(coalesce(p_capabilities, '[]'::jsonb)) > 30 then raise exception 'capability 30개 제한'; end if;
  select id into v_id from public.ai_market_competitors where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_market_competitors (competitor_code, name, category, region, position_reference, capability_notes, data_availability, evidence, idempotency_key, created_by)
  values (p_code, left(p_name, 200), p_category, p_region, p_position, coalesce(p_capabilities, '[]'::jsonb),
          case when p_external_data then 'external_data_available' else 'market_unavailable' end, p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_market_events (event_type, ref_id, detail, actor_id) values ('competitor_recorded', v_id, p_code || ' — 사람 입력(Competition ≠ Threat)', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'ai_generated', false, 'threat_claimed', false, 'production_applied', false);
end $$;

create or replace function public.admin_market_competitor_observe(p_id uuid, p_note text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_evt uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_note is null or btrim(p_note) = '' then raise exception '관찰 내용 필수'; end if;
  if p_payload is not null and pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  if not exists (select 1 from public.ai_market_competitors where id = p_id) then raise exception 'competitor 실존 검증 실패'; end if;
  insert into public.ai_market_events (event_type, ref_id, detail, payload, actor_id)
  values ('competitor_observed', p_id, left(p_note, 200) || ' (관찰 기록 — 사실 단정 아님)', p_payload, v_uid)
  returning id into v_evt;
  return jsonb_build_object('ok', true, 'id', v_evt, 'fact_confirmed', false, 'production_applied', false);
end $$;

create or replace function public.admin_market_competitor_review(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_creator uuid; v_warnings jsonb := '[]'::jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('active_reference','under_review','superseded_reference','invalidated','market_unverified') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select record_status, created_by into v_cur, v_creator from public.ai_market_competitors where id = p_id for update;
  if v_cur is null then raise exception 'competitor 없음'; end if;
  if v_cur in ('superseded_reference','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  if v_creator is not null and v_creator = v_uid and p_status = 'active_reference' then
    v_warnings := jsonb_build_array('self_review_warning: 생성자와 판정자가 동일');
  end if;
  update public.ai_market_competitors
     set record_status = p_status, warnings = warnings || v_warnings,
         reviewer_id = v_uid, reviewed_at = now(), review_reason = left(p_reason, 500)
   where id = p_id;
  insert into public.ai_market_events (event_type, ref_id, detail, actor_id) values ('competitor_reviewed', p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200), v_uid);
  return jsonb_build_object('ok', true, 'record_status', p_status, 'warnings', v_warnings, 'production_applied', false);
end $$;

create or replace function public.admin_market_competitors(p_status text default null, p_limit int default 100)
returns setof public.ai_market_competitors language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_market_competitors where (p_status is null or record_status = p_status)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Market Signal — observed 강제 시작(Signal ≠ Fact).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_market_signal_record(
  p_code text, p_kind text, p_title text, p_evidence jsonb,
  p_detail text default null, p_region text default null, p_category text default null, p_observed_at date default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('economic','seasonal','regulatory','technology','consumer','industry','competitor') then raise exception '허용되지 않는 signal_kind'; end if;
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수(Signal ≠ Fact)'; end if;
  select id into v_id from public.ai_market_signals where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  -- signal_status 는 항상 observed 로 시작(Confirmed 시작 금지 — 서버 강제)
  insert into public.ai_market_signals (signal_code, signal_kind, title, detail, region, category, observed_at, signal_status, evidence, idempotency_key, created_by)
  values (p_code, p_kind, left(p_title, 200), p_detail, p_region, p_category, p_observed_at, 'observed', p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_market_events (event_type, ref_id, detail, actor_id) values ('market_signal_recorded', v_id, p_code || ' (' || p_kind || ') — observed 시작(Signal ≠ Fact)', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'signal_status', 'observed', 'fact_confirmed', false, 'production_applied', false);
end $$;

create or replace function public.admin_market_signal_review(p_id uuid, p_status text, p_reason text, p_additional_evidence jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_creator uuid; v_warnings jsonb := '[]'::jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('corroborated_reference','contradicted_reference','expired_reference','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select signal_status, created_by into v_cur, v_creator from public.ai_market_signals where id = p_id for update;
  if v_cur is null then raise exception 'signal 없음'; end if;
  if v_cur in ('expired_reference','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  -- corroborated 전환은 추가 Evidence 필수(관찰→보강 — 그래도 Fact 확정 아님)
  if p_status = 'corroborated_reference' and (p_additional_evidence is null or jsonb_typeof(p_additional_evidence) <> 'array' or jsonb_array_length(p_additional_evidence) = 0) then
    raise exception 'corroborated 전환은 추가 Evidence 필수(market_unverified)';
  end if;
  if v_creator is not null and v_creator = v_uid and p_status = 'corroborated_reference' then
    v_warnings := jsonb_build_array('self_review_warning: 기록자와 보강 판정자가 동일');
  end if;
  update public.ai_market_signals
     set signal_status = p_status, warnings = warnings || v_warnings,
         evidence = evidence || coalesce(p_additional_evidence, '[]'::jsonb),
         reviewer_id = v_uid, reviewed_at = now(), review_reason = left(p_reason, 500)
   where id = p_id;
  insert into public.ai_market_events (event_type, ref_id, detail, actor_id) values ('market_signal_reviewed', p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || ' (Signal ≠ Fact)', v_uid);
  return jsonb_build_object('ok', true, 'signal_status', p_status, 'warnings', v_warnings, 'fact_confirmed', false, 'production_applied', false);
end $$;

create or replace function public.admin_market_signals(p_kind text default null, p_limit int default 100)
returns setof public.ai_market_signals language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_market_signals where (p_kind is null or signal_kind = p_kind)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) 카테고리별 일별 실측 시계열 — Category/Demand Trend 원자료.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_market_category_timeline(p_days int default 30)
returns table (day date, category text, plays bigint)
language plpgsql security definer set search_path = public as $$
declare v_days int;
begin
  perform public._admin_growth_guard();
  v_days := least(greatest(coalesce(p_days, 30), 7), 120);
  return query
  with top_cats as (
    select store_type_slug slug from public.playback_events_v2
    where created_at > now() - (v_days || ' days')::interval and store_type_slug is not null and event_type = 'play_start'
    group by store_type_slug order by count(*) desc limit 8
  )
  select e.created_at::date, e.store_type_slug, count(*)::bigint
  from public.playback_events_v2 e
  where e.created_at > now() - (v_days || ' days')::interval
    and e.event_type = 'play_start'
    and e.store_type_slug in (select slug from top_cats)
  group by 1, 2 order by 1 asc, 3 desc;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Governance Event / Audit — Trend/Industry/Regional/Behavior/Opportunity/
--    Risk/Correlation/Briefing/권고 통합.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_market_governance_record(p_kind text, p_reason text, p_payload jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('market_trend_analyzed','industry_analyzed','regional_analyzed','customer_behavior_analyzed','market_opportunity_proposed','market_risk_assessed','market_correlation_analyzed','market_briefing_recorded','market_recommendation_created','external_market_reference') then raise exception '허용되지 않는 kind'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  insert into public.ai_market_events (event_type, ref_id, detail, payload, actor_id)
  values (p_kind, p_ref_id, left(p_reason, 200) || case
      when p_kind = 'market_opportunity_proposed' then ' (Opportunity ≠ Success·확정 아님)'
      when p_kind = 'market_correlation_analyzed' then ' (Correlation ≠ Causation)'
      when p_kind = 'market_briefing_recorded' then ' (자동 발송 없음)'
      when p_kind = 'market_trend_analyzed' then ' (Trend ≠ Future Guarantee)'
      else '' end, p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'market_conclusion_confirmed', false, 'strategy_changed', false, 'auto_sent', false, 'production_applied', false);
end $$;

create or replace function public.admin_market_audit(p_limit int default 100)
returns setof public.ai_market_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_market_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_market_competitors enable row level security;
alter table public.ai_market_signals enable row level security;
alter table public.ai_market_events enable row level security;

comment on table public.ai_market_competitors is 'AI-OPS-24 — Competitor Profile(사람 입력만 — 자동 생성 없음·Competition ≠ Threat·기본 market_unavailable).';
comment on table public.ai_market_signals is 'AI-OPS-24 — Market Signal(observed 강제 시작 — Signal ≠ Fact·corroborated 는 추가 Evidence 필수).';
comment on table public.ai_market_events is 'AI-OPS-24 — Market Audit(event_type whitelist 16종·Trend/Industry/Regional/Behavior/Opportunity/Risk/Correlation/Briefing 통합).';
