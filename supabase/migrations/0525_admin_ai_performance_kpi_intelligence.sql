-- 0525_admin_ai_performance_kpi_intelligence.sql
-- Phase AI-OPS-22 — Enterprise Performance Intelligence, KPI Intelligence &
-- Executive Performance Center.
--
-- 실제 구조 분석 결과(추측 없음 — 실측 소스 검증 완료):
--   MRR 원본: subscriptions.current_amount(status active/cancel_scheduled 합 — 0474/0511 검증).
--   Growth 원본: users.created_at + account_type(artist/business — 0472 검증).
--   Listening 원본: playback_events_v2.listened_seconds(0253 — 실측 이벤트).
--   Playlist Quality 원본: playlist_track_fit_scores.fit_score(0156 — 0~100, Proxy).
--   Stability 원본: playback_events_v2.player_error/play_start 비율(Proxy — APM 아님).
--   Objective 연결: ai_corporate_objectives(0524) 실존 검증.
--   외부 벤치마크/시장 점유율/CSAT·NPS 원본 없음(실측) → kpi_unavailable 유지.
--
-- KPI 정직성(전부 강제):
--   * KPI 자동 생성/자동 수정/목표 자동 변경 없음 — 사람 RPC 만. Trigger 없음 · 삭제 RPC 없음.
--   * KPI ≠ Business Success. Trend ≠ Guarantee. Correlation ≠ Causation. Forecast ≠ Actual.
--   * Variance ≠ Failure. Health ≠ Business Quality. Recommendation ≠ Decision.
--   * Unknown 유지(null→0 금지). 표본 부족 sample_too_small. 근거 부족 kpi_unverified.
--   * measured snapshot 없이 watch/at_risk 판정 금지(서버 raise). 자동 발송 없음.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) KPI Definition — 사람 정의만(자동 생성/수정 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_kpi_definitions (
  id                  uuid primary key default gen_random_uuid(),
  kpi_code            text not null unique,
  title               text not null,
  description         text,
  measurement_source  text not null check (measurement_source in ('mrr','arr_derived','member_growth','active_stores','active_artists','listening_hours','playlist_quality_proxy','system_stability_proxy','manual_entry','unsupported')),
  unit                text,
  direction           text not null default 'unspecified' check (direction in ('higher_is_better','lower_is_better','range_target','unspecified')),
  hierarchy_level     text not null default 'business_kpi' check (hierarchy_level in ('corporate_goal','strategic_objective','business_kpi','operational_kpi','execution_metric')),
  parent_kpi_id       uuid references public.ai_kpi_definitions(id),
  linked_objective_ids jsonb not null default '[]'::jsonb,       -- ai_corporate_objectives(0524) 참조
  review_cycle        text not null default 'monthly' check (review_cycle in ('daily','weekly','monthly','quarterly','yearly','manual')),
  target_value        numeric,                                    -- 사람 설정만(admin_kpi_target_set)
  target_rationale    text,
  target_set_by       uuid,
  target_set_at       timestamptz,
  kpi_status          text not null default 'draft' check (kpi_status in ('draft','active_reference','watch_reference','at_risk_reference','under_review','paused_reference','retired_reference','invalidated','kpi_unavailable','kpi_unverified','insufficient_data')),
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  review_reason       text,
  warnings            jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["KPI ≠ Business Success","Health ≠ Business Quality"]'::jsonb,
  source_version      text not null default 'performance_v1(0525)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_kpi_def on public.ai_kpi_definitions (measurement_source, kpi_status, hierarchy_level, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) KPI Snapshot — append-only 측정 기록(Forecast ≠ Actual 분리 저장).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_kpi_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  kpi_id              uuid not null references public.ai_kpi_definitions(id),
  period_kind         text not null check (period_kind in ('daily','weekly','monthly','quarterly','yearly','adhoc')),
  period_start        date,
  period_end          date,
  actual_value        numeric,                                    -- null 유지(0 변환 금지)
  target_value        numeric,
  forecast_value      numeric,                                    -- Forecast ≠ Actual
  source_kind         text not null check (source_kind in ('measured','human_entered','forecast_reference')),
  sample_size         int,
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Forecast ≠ Actual","Variance ≠ Failure"]'::jsonb,
  source_version      text not null default 'performance_v1(0525)',
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_kpi_snap on public.ai_kpi_snapshots (kpi_id, period_kind, created_at desc);

-- Attribution/Variance/Trend/Health/Benchmark/Correlation/Briefing/권고/Audit 는 Event 통합(테이블 최소화).
create table if not exists public.ai_performance_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('kpi_defined','kpi_reviewed','kpi_target_set','kpi_snapshot_recorded','kpi_measured','kpi_hierarchy_analyzed','attribution_analyzed','variance_analyzed','trend_analyzed','health_evaluated','benchmark_compared','correlation_analyzed','performance_briefing_recorded','performance_recommendation_created','external_performance_reference','kpi_invalidated')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_perf_evt on public.ai_performance_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) 요약 — KPI 실측 + 미존재 정직 표기.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_performance_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v jsonb; v_mrr numeric; v_starts bigint; v_errors bigint;
  v_listen numeric; v_listen_samples bigint; v_fit numeric; v_fit_samples bigint;
begin
  perform public._admin_growth_guard();
  select coalesce(sum(current_amount), 0) into v_mrr from public.subscriptions where status in ('active','cancel_scheduled');
  select count(*) filter (where event_type = 'play_start'), count(*) filter (where event_type = 'player_error')
    into v_starts, v_errors from public.playback_events_v2 where created_at > now() - interval '30 days';
  select sum(listened_seconds) / 3600.0, count(*) into v_listen, v_listen_samples
    from public.playback_events_v2 where created_at > now() - interval '30 days' and listened_seconds is not null;
  select avg(fit_score), count(fit_score) into v_fit, v_fit_samples from public.playlist_track_fit_scores where fit_score is not null;
  select jsonb_build_object(
    'kpi_actuals', jsonb_build_object(
      'mrr', v_mrr,
      'arr_derived', v_mrr * 12,                                 -- ARR = MRR×12 파생(계약 확정 아님)
      'members_total', (select count(*) from public.users),
      'active_artists_registered', (select count(*) from public.users where account_type = 'artist'),
      'business_members_registered', (select count(*) from public.users where account_type = 'business'),
      'new_members_30d', (select count(*) from public.users where created_at > now() - interval '30 days'),
      'active_stores_30d', (select count(distinct business_id) from public.playback_events_v2 where created_at > now() - interval '30 days' and business_id is not null),
      'listening_hours_30d', case when v_listen_samples > 0 then round(v_listen, 2) else null end,   -- 표본 0 → null 유지
      'listening_event_samples_30d', v_listen_samples,
      'play_starts_30d', v_starts,
      'player_errors_30d', v_errors,
      'playlist_quality_proxy_avg_fit', case when v_fit_samples > 0 then round(v_fit, 2) else null end,
      'playlist_quality_samples', v_fit_samples,
      'playlists_total', (select count(*) from public.playlists),
      'tracks_total', (select count(*) from public.tracks)
    ),
    'kpi_unavailable', jsonb_build_array('external_benchmark','market_share','csat_nps','churn_cohort_ltv'),   -- 원본 없음(실측)
    'kpi_definitions_total', (select count(*) from public.ai_kpi_definitions),
    'kpi_by_status', (select coalesce(jsonb_object_agg(kpi_status, n), '{}'::jsonb) from (select kpi_status, count(*) n from public.ai_kpi_definitions group by kpi_status) x),
    'kpi_by_level', (select coalesce(jsonb_object_agg(hierarchy_level, n), '{}'::jsonb) from (select hierarchy_level, count(*) n from public.ai_kpi_definitions group by hierarchy_level) x),
    'snapshots_total', (select count(*) from public.ai_kpi_snapshots),
    'objectives_0524', (select count(*) from public.ai_corporate_objectives),
    'no_auto_kpi_creation', true, 'no_auto_target_change', true, 'kpi_is_not_business_success', true,
    'correlation_is_not_causation', true, 'no_auto_briefing_send', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) KPI 정의 생성·목표 설정·검토 — 전부 사람 RPC.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_kpi_definition_create(
  p_code text, p_title text, p_source text, p_evidence jsonb,
  p_description text default null, p_unit text default null, p_direction text default 'unspecified',
  p_level text default 'business_kpi', p_parent_id uuid default null,
  p_objective_ids jsonb default '[]'::jsonb, p_review_cycle text default 'monthly'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cnt int; v_found int; v_status text := 'draft';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수(사람 입력 — KPI 자동 생성 없음)'; end if;
  if p_source not in ('mrr','arr_derived','member_growth','active_stores','active_artists','listening_hours','playlist_quality_proxy','system_stability_proxy','manual_entry','unsupported') then raise exception '허용되지 않는 measurement_source'; end if;
  if p_direction not in ('higher_is_better','lower_is_better','range_target','unspecified') then raise exception '허용되지 않는 direction'; end if;
  if p_level not in ('corporate_goal','strategic_objective','business_kpi','operational_kpi','execution_metric') then raise exception '허용되지 않는 hierarchy_level'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_parent_id is not null and not exists (select 1 from public.ai_kpi_definitions where id = p_parent_id) then raise exception 'parent KPI 실존 검증 실패'; end if;
  v_cnt := jsonb_array_length(coalesce(p_objective_ids, '[]'::jsonb));
  if v_cnt > 30 then raise exception 'objective 연결 30개 제한'; end if;
  if v_cnt > 0 then
    select count(*) into v_found from public.ai_corporate_objectives o where o.id in (select (jsonb_array_elements_text(p_objective_ids))::uuid);
    if v_found <> v_cnt then raise exception 'objective(0524) 실존 검증 실패'; end if;
  end if;
  select id into v_id from public.ai_kpi_definitions where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  if p_source = 'unsupported' then v_status := 'kpi_unavailable'; end if;   -- 지원 안 되는 KPI 는 kpi_unavailable 유지
  insert into public.ai_kpi_definitions (kpi_code, title, description, measurement_source, unit, direction, hierarchy_level, parent_kpi_id, linked_objective_ids, review_cycle, kpi_status, evidence, idempotency_key, created_by)
  values (p_code, left(p_title, 200), p_description, p_source, p_unit, p_direction, p_level, p_parent_id, coalesce(p_objective_ids, '[]'::jsonb), coalesce(p_review_cycle, 'monthly'), v_status, p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_performance_events (event_type, ref_id, detail, actor_id) values ('kpi_defined', v_id, p_code || ' (' || p_source || ') — 사람 정의(자동 생성 아님)', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'kpi_status', v_status, 'ai_generated', false, 'production_applied', false);
end $$;

create or replace function public.admin_kpi_target_set(p_id uuid, p_target numeric, p_rationale text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_rationale is null or btrim(p_rationale) = '' then raise exception 'Target Rationale 필수(목표 자동 변경 없음)'; end if;
  select kpi_status into v_cur from public.ai_kpi_definitions where id = p_id for update;
  if v_cur is null then raise exception 'KPI 없음'; end if;
  if v_cur in ('retired_reference','invalidated') then raise exception '종결 상태(%)에서 목표 변경 불가', v_cur; end if;
  update public.ai_kpi_definitions
     set target_value = p_target, target_rationale = left(p_rationale, 500), target_set_by = v_uid, target_set_at = now()
   where id = p_id;
  insert into public.ai_performance_events (event_type, ref_id, detail, actor_id) values ('kpi_target_set', p_id, 'target=' || coalesce(p_target::text, 'null') || ' — ' || left(p_rationale, 200) || ' (사람 설정)', v_uid);
  return jsonb_build_object('ok', true, 'target_value', p_target, 'auto_changed', false, 'production_applied', false);
end $$;

create or replace function public.admin_kpi_definition_review(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_creator uuid; v_snaps int; v_warnings jsonb := '[]'::jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('active_reference','watch_reference','at_risk_reference','under_review','paused_reference','retired_reference','invalidated','kpi_unverified','insufficient_data') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select kpi_status, created_by into v_cur, v_creator from public.ai_kpi_definitions where id = p_id for update;
  if v_cur is null then raise exception 'KPI 없음'; end if;
  if v_cur in ('retired_reference','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  if v_cur = 'kpi_unavailable' and p_status not in ('invalidated','retired_reference') then raise exception 'kpi_unavailable 은 지원 KPI 로 전환 불가(원본 없음)'; end if;
  -- Health 판정(watch/at_risk)은 measured snapshot 근거 필수(Health 는 Evidence 동반)
  select count(*) into v_snaps from public.ai_kpi_snapshots where kpi_id = p_id and source_kind = 'measured';
  if p_status in ('watch_reference','at_risk_reference') and v_snaps = 0 then raise exception 'measured snapshot 근거 없음 — health 판정 금지(kpi_unverified)'; end if;
  if v_creator is not null and v_creator = v_uid and p_status in ('at_risk_reference','retired_reference') then
    v_warnings := jsonb_build_array('self_review_warning: 생성자와 판정자가 동일');
  end if;
  update public.ai_kpi_definitions
     set kpi_status = p_status, warnings = warnings || v_warnings,
         reviewer_id = v_uid, reviewed_at = now(), review_reason = left(p_reason, 500)
   where id = p_id;
  insert into public.ai_performance_events (event_type, ref_id, detail, actor_id) values ('kpi_reviewed', p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || ' (Health ≠ Business Quality)', v_uid);
  return jsonb_build_object('ok', true, 'kpi_status', p_status, 'warnings', v_warnings, 'production_applied', false);
end $$;

create or replace function public.admin_kpi_definitions(p_status text default null, p_limit int default 100)
returns setof public.ai_kpi_definitions language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_kpi_definitions where (p_status is null or kpi_status = p_status)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Snapshot 기록·실측 캡처 — append-only(수정/삭제 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_kpi_snapshot_record(
  p_key text, p_kpi_id uuid, p_period_kind text, p_source_kind text, p_evidence jsonb,
  p_actual numeric default null, p_target numeric default null, p_forecast numeric default null,
  p_period_start date default null, p_period_end date default null, p_sample_size int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_period_kind not in ('daily','weekly','monthly','quarterly','yearly','adhoc') then raise exception '허용되지 않는 period_kind'; end if;
  if p_source_kind not in ('human_entered','forecast_reference') then raise exception 'measured 는 admin_kpi_snapshot_capture 로만 기록'; end if;
  if p_actual is null and p_target is null and p_forecast is null then raise exception 'actual/target/forecast 중 1개 이상 필수(null→0 변환 금지)'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if not exists (select 1 from public.ai_kpi_definitions where id = p_kpi_id) then raise exception 'KPI 실존 검증 실패'; end if;
  select id into v_id from public.ai_kpi_snapshots where idempotency_key = p_key;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_kpi_snapshots (kpi_id, period_kind, period_start, period_end, actual_value, target_value, forecast_value, source_kind, sample_size, evidence, idempotency_key, created_by)
  values (p_kpi_id, p_period_kind, p_period_start, p_period_end, p_actual, p_target, p_forecast, p_source_kind, p_sample_size, p_evidence, p_key, v_uid)
  returning id into v_id;
  insert into public.ai_performance_events (event_type, ref_id, detail, actor_id) values ('kpi_snapshot_recorded', v_id, p_period_kind || '/' || p_source_kind || ' — Forecast ≠ Actual', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'forecast_is_not_actual', true, 'production_applied', false);
end $$;

create or replace function public.admin_kpi_snapshot_capture(p_key text, p_kpi_id uuid, p_period_kind text default 'monthly')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid; v_id uuid; v_source text; v_target numeric; v_days int;
  v_actual numeric; v_sample bigint := 0; v_note text; v_starts bigint; v_errors bigint;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_period_kind not in ('daily','weekly','monthly','quarterly','yearly','adhoc') then raise exception '허용되지 않는 period_kind'; end if;
  select measurement_source, target_value into v_source, v_target from public.ai_kpi_definitions where id = p_kpi_id;
  if v_source is null then raise exception 'KPI 실존 검증 실패'; end if;
  if v_source in ('manual_entry','unsupported') then raise exception 'kpi_unavailable — 실측 캡처 미지원(%)', v_source; end if;
  select id into v_id from public.ai_kpi_snapshots where idempotency_key = p_key;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  v_days := case p_period_kind when 'daily' then 1 when 'weekly' then 7 when 'monthly' then 30 when 'quarterly' then 90 when 'yearly' then 365 else 30 end;
  if v_source = 'mrr' then
    select coalesce(sum(current_amount), 0), count(*) into v_actual, v_sample from public.subscriptions where status in ('active','cancel_scheduled');
    v_note := 'subscriptions.current_amount 합(active/cancel_scheduled)';
  elsif v_source = 'arr_derived' then
    select coalesce(sum(current_amount), 0) * 12, count(*) into v_actual, v_sample from public.subscriptions where status in ('active','cancel_scheduled');
    v_note := 'ARR = MRR×12 파생(계약 확정 아님)';
  elsif v_source = 'member_growth' then
    select count(*), count(*) into v_actual, v_sample from public.users where created_at > now() - (v_days || ' days')::interval;
    v_note := '신규 가입 실측(' || v_days || 'd)';
  elsif v_source = 'active_stores' then
    select count(distinct business_id), count(*) into v_actual, v_sample from public.playback_events_v2 where created_at > now() - (v_days || ' days')::interval and business_id is not null;
    v_note := '재생 이벤트 발생 매장 실측(' || v_days || 'd — 등록 매장 아님)';
  elsif v_source = 'active_artists' then
    select count(*), count(*) into v_actual, v_sample from public.users where account_type = 'artist';
    v_note := '등록 아티스트 실측(활동 지표 아님)';
  elsif v_source = 'listening_hours' then
    select sum(listened_seconds) / 3600.0, count(*) into v_actual, v_sample from public.playback_events_v2 where created_at > now() - (v_days || ' days')::interval and listened_seconds is not null;
    if v_sample = 0 then v_actual := null; end if;                -- 표본 0 → null 유지(0 아님)
    v_note := 'listened_seconds 합/3600(' || v_days || 'd)';
  elsif v_source = 'playlist_quality_proxy' then
    select avg(fit_score), count(fit_score) into v_actual, v_sample from public.playlist_track_fit_scores where fit_score is not null;
    if v_sample = 0 then v_actual := null; end if;
    v_note := 'fit_score 평균(Proxy — 품질 단정 아님)';
  elsif v_source = 'system_stability_proxy' then
    select count(*) filter (where event_type = 'play_start'), count(*) filter (where event_type = 'player_error')
      into v_starts, v_errors from public.playback_events_v2 where created_at > now() - (v_days || ' days')::interval;
    v_sample := v_starts;
    if v_starts > 0 then v_actual := round((1 - v_errors::numeric / v_starts) * 100, 2); else v_actual := null; end if;
    v_note := 'play_start 대비 player_error 비율(Proxy — APM 아님, ' || v_days || 'd)';
  end if;
  insert into public.ai_kpi_snapshots (kpi_id, period_kind, period_start, period_end, actual_value, target_value, source_kind, sample_size, evidence, unknown_factors, idempotency_key, created_by)
  values (p_kpi_id, p_period_kind, (now() - (v_days || ' days')::interval)::date, now()::date, v_actual, v_target,
          'measured', v_sample::int, jsonb_build_array(jsonb_build_object('source', v_source, 'note', v_note)),
          case when v_actual is null then jsonb_build_array('표본 0 — insufficient_data(null 유지)') else '[]'::jsonb end,
          p_key, v_uid)
  returning id into v_id;
  insert into public.ai_performance_events (event_type, ref_id, detail, actor_id) values ('kpi_measured', v_id, v_source || ' 실측(' || p_period_kind || ') — KPI ≠ Business Success', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'actual_value', v_actual, 'sample_size', v_sample, 'kpi_is_not_business_success', true, 'production_applied', false);
end $$;

create or replace function public.admin_kpi_snapshots(p_kpi_id uuid default null, p_limit int default 100)
returns setof public.ai_kpi_snapshots language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_kpi_snapshots where (p_kpi_id is null or kpi_id = p_kpi_id)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) 일별 실측 시계열 — Trend 분석용 원자료(분류는 클라이언트 순수 로직).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_performance_timeline(p_days int default 30)
returns table (day date, new_members bigint, listening_hours numeric, play_starts bigint, player_errors bigint, active_stores bigint)
language plpgsql security definer set search_path = public as $$
declare v_days int;
begin
  perform public._admin_growth_guard();
  v_days := least(greatest(coalesce(p_days, 30), 7), 120);
  return query
  with days as (select generate_series((now() - (v_days - 1 || ' days')::interval)::date, now()::date, '1 day')::date as d),
  members as (select created_at::date d, count(*) n from public.users where created_at > now() - (v_days || ' days')::interval group by 1),
  events as (
    select created_at::date d,
           sum(listened_seconds) filter (where listened_seconds is not null) / 3600.0 hours,
           count(*) filter (where event_type = 'play_start') starts,
           count(*) filter (where event_type = 'player_error') errors,
           count(distinct business_id) filter (where business_id is not null) stores
    from public.playback_events_v2 where created_at > now() - (v_days || ' days')::interval group by 1
  )
  select days.d, coalesce(m.n, 0), round(e.hours, 2), coalesce(e.starts, 0), coalesce(e.errors, 0), coalesce(e.stores, 0)
  from days left join members m on m.d = days.d left join events e on e.d = days.d
  order by days.d asc;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Governance Event / Audit — Attribution/Variance/Trend/Health/Benchmark/
--    Correlation/Briefing/권고 통합.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_performance_governance_record(p_kind text, p_reason text, p_payload jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('kpi_hierarchy_analyzed','attribution_analyzed','variance_analyzed','trend_analyzed','health_evaluated','benchmark_compared','correlation_analyzed','performance_briefing_recorded','performance_recommendation_created','external_performance_reference') then raise exception '허용되지 않는 kind'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  insert into public.ai_performance_events (event_type, ref_id, detail, payload, actor_id)
  values (p_kind, p_ref_id, left(p_reason, 200) || case
      when p_kind = 'attribution_analyzed' then ' (원인 후보 — 인과 확정 아님)'
      when p_kind = 'correlation_analyzed' then ' (Correlation ≠ Causation)'
      when p_kind = 'performance_briefing_recorded' then ' (자동 발송 없음)'
      when p_kind = 'trend_analyzed' then ' (Trend ≠ Guarantee)'
      else '' end, p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'kpi_changed', false, 'auto_sent', false, 'production_applied', false);
end $$;

create or replace function public.admin_performance_audit(p_limit int default 100)
returns setof public.ai_performance_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_performance_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_kpi_definitions enable row level security;
alter table public.ai_kpi_snapshots enable row level security;
alter table public.ai_performance_events enable row level security;

comment on table public.ai_kpi_definitions is 'AI-OPS-22 — KPI 정의(사람 정의만 — 자동 생성/수정/목표 변경 없음·KPI ≠ Business Success).';
comment on table public.ai_kpi_snapshots is 'AI-OPS-22 — KPI Snapshot(append-only·Forecast ≠ Actual·null 유지).';
comment on table public.ai_performance_events is 'AI-OPS-22 — Performance Audit(event_type whitelist 16종·Attribution/Variance/Trend/Health/Benchmark/Correlation/Briefing 통합).';
