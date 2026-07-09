-- 0441 — Phase ALGO-2E: Streaming Shadow Calibration & Verified Pipeline (Shadow)
--
-- 목적:
--   ALGO-2D 모니터링에서 확인된 Shadow Funnel 병목(verified=0, eligible=0)을 Shadow 환경에서
--   재현·보정한다. USER Playback → Verified → Eligible → Settlement → Learning → Prediction 까지의
--   후보(candidate)를 Shadow 로 계산하고, Identity Mapping · Completion Calibration · Funnel Analytics ·
--   Drop Analysis · Calibration Report 를 생성한다.
--
-- 절대 원칙:
--   • Playback Runtime/Queue/Scheduler/Settlement v1/Exposure/Prediction/Fraud 정책 무변경.
--   • Production Apply 금지. additive only. 실제 stream_ingest_v2/stream_sessions_v2 이벤트 수정 금지(읽기 전용).
--   • Verified/Eligible 는 후보 계산만 — 실제 funnel/정산에 반영하지 않는다.
--
-- 근본원인(ALGO-2D):
--   (a) 검증 타이밍: play_30s milestone 행이 fire 시점 heartbeat_verified=false·verified_seconds<30 으로
--       고정되고, session(stream_sessions_v2) 이 이후 heartbeat 로 verified_seconds 120~130s 확정해도
--       milestone 이 back-fill 되지 않음 → v2_verified_streams(=play_30s AND hb AND vsec>=30) 0.
--   (b) 세션 정체성: session.player_type=USER 인데 ingest milestone.player_type=ARTIST_PREVIEW 라벨 →
--       v2_eligible_streams(player_type NOT IN preview) 에서 제외.
--   본 Calibration 은 session 을 authoritative 로 삼아 두 병목을 Shadow 로 보정한 후보를 산출한다.

-- ─────────────────────────────────────────────────────────────────────
-- 0. Helper — listener_type 분류 / drop_reason 권고
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._stream_listener_type(p_ptype text, p_user uuid, p_anon text)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when p_ptype = 'USER' then 'user'
    when p_ptype = 'ARTIST_PREVIEW' then 'artist_preview'
    when p_ptype = 'ADMIN_PREVIEW' then 'admin_preview'
    when p_ptype = 'SYSTEM' then 'system'
    when p_user is not null then 'user'
    when p_anon is not null then 'anonymous'
    else 'unknown' end;
$$;

create or replace function public._stream_drop_recommendation(p_reason text)
returns text language sql immutable set search_path to 'public' as $$
  select case p_reason
    when 'verification_delay' then 'milestone verified_seconds 를 session heartbeat 확정값으로 back-fill (verification 순서 보정 필요)'
    when 'identity_mismatch' then 'ingest milestone player_type 를 session.player_type 로 정규화 (session identity 우선)'
    when 'heartbeat_missing' then 'heartbeat 확정 후 verified 판정 (milestone fire 시점 조기 확정 회피)'
    when 'completion_missing' then 'play_completed 누락 세션은 heartbeat 기반 verified 확정 경로 필요'
    when 'no_session' then 'session_token 없는 milestone 은 verified 불가 — 세션 생성/연결 보장'
    when 'insufficient_verified_seconds' then '실제 재생 30s 미만 — 정상 drop'
    when 'not_visible' then 'background/hidden 재생 — 정상 drop'
    when 'preview_excluded' then 'preview 는 settlement 제외 — 정상'
    when 'low_volume' then 'volume<0.1 — 정상 drop'
    when 'muted' then 'muted 재생 — 정상 drop'
    when 'fraud' then 'fraud_score>=60 — 정상 drop'
    when 'dispute' then 'dispute 상태 — 정상 drop'
    when 'track_not_settlement_eligible' then 'settlement 대상 트랙 아님 — 정상'
    else '분류 필요' end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- A. Tables
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.stream_shadow_calibration_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(), window_days integer,
  raw_count integer, play30s_count integer, verified_actual integer,
  verified_candidate integer, eligible_candidate integer, settlement_candidate integer,
  top_drop_reason text, notes text, created_by uuid
);
create index if not exists sscr_run_idx on public.stream_shadow_calibration_runs(run_at desc);

create table if not exists public.stream_shadow_calibration_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.stream_shadow_calibration_runs(id) on delete cascade,
  ingest_id bigint, session_token text, event_type text, track_id uuid,
  orig_player_type text, true_player_type text, listener_type text, identity_mismatch boolean default false,
  milestone_verified_seconds numeric, session_verified_seconds numeric, heartbeat_count integer, client_reported_seconds numeric,
  completion_rate numeric, shadow_completion_score numeric, has_play_completed boolean default false,
  actual_verified boolean default false, verified_candidate boolean default false, eligible_candidate boolean default false,
  settlement_candidate boolean default false, learning_candidate boolean default false, prediction_candidate boolean default false,
  drop_stage text, drop_reason text, drop_reasons jsonb, created_at timestamptz not null default now()
);
create index if not exists ssci_run_idx on public.stream_shadow_calibration_items(run_id);
create index if not exists ssci_drop_idx on public.stream_shadow_calibration_items(run_id, drop_stage, drop_reason);

create table if not exists public.verified_pipeline_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.stream_shadow_calibration_runs(id) on delete cascade,
  ingest_id bigint, session_token text, track_id uuid, stage text not null, candidate boolean not null default false,
  reason text, created_at timestamptz not null default now()
);
create index if not exists vpc_run_idx on public.verified_pipeline_candidates(run_id, stage);

create table if not exists public.identity_mapping_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.stream_shadow_calibration_runs(id) on delete cascade,
  session_token text, session_player_type text, milestone_player_type text, true_player_type text,
  listener_type text, mismatch boolean default false, created_at timestamptz not null default now()
);
create index if not exists imr_run_idx on public.identity_mapping_results(run_id);

create table if not exists public.completion_calibration (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.stream_shadow_calibration_runs(id) on delete cascade,
  session_token text, track_id uuid, milestone_verified_seconds numeric, session_verified_seconds numeric,
  heartbeat_count integer, client_reported_seconds numeric, completion_rate numeric, shadow_completion_score numeric,
  has_play_completed boolean default false, created_at timestamptz not null default now()
);
create index if not exists cc_run_idx on public.completion_calibration(run_id);

create table if not exists public.funnel_calibration_summary (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.stream_shadow_calibration_runs(id) on delete cascade,
  raw_events integer, verified_events_actual integer, verified_candidate integer,
  eligible_events_actual integer, eligible_candidate integer, settlement_events_actual integer, settlement_candidate integer,
  learning_candidate integer, prediction_candidate integer,
  verified_conversion_rate numeric, eligible_conversion_rate numeric, verified_drop_rate numeric,
  created_at timestamptz not null default now()
);
create index if not exists fcs_run_idx on public.funnel_calibration_summary(run_id);

create table if not exists public.drop_reason_analysis (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.stream_shadow_calibration_runs(id) on delete cascade,
  drop_stage text, drop_reason text, cnt integer, pct numeric, recommendation text, created_at timestamptz not null default now()
);
create index if not exists dra_run_idx on public.drop_reason_analysis(run_id, cnt desc);

-- ─────────────────────────────────────────────────────────────────────
-- B. RLS (super_admin SELECT only)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['stream_shadow_calibration_runs','stream_shadow_calibration_items','verified_pipeline_candidates',
    'identity_mapping_results','completion_calibration','funnel_calibration_summary','drop_reason_analysis'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polname = t||'_admin_read') then
      execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_admin_read', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- C. Main Calibration — admin_run_stream_shadow_calibration
--    play_30s milestone × session 조인으로 verified/eligible/settlement 후보 + drop 분류 산출
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_run_stream_shadow_calibration(p_days integer default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; v_from timestamptz := now() - make_interval(days => greatest(coalesce(p_days,30),1));
  v_raw integer; v_p30 integer; v_top text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;

  select count(*) into v_raw from public.stream_ingest_v2 where created_at >= v_from;
  insert into public.stream_shadow_calibration_runs(window_days, raw_count) values (greatest(coalesce(p_days,30),1), v_raw) returning id into v_run;

  -- Calibration items (play_30s milestone 기준)
  insert into public.stream_shadow_calibration_items(run_id, ingest_id, session_token, event_type, track_id,
    orig_player_type, true_player_type, listener_type, identity_mismatch,
    milestone_verified_seconds, session_verified_seconds, heartbeat_count, client_reported_seconds,
    completion_rate, shadow_completion_score, has_play_completed,
    actual_verified, verified_candidate, eligible_candidate, settlement_candidate, learning_candidate, prediction_candidate,
    drop_stage, drop_reason, drop_reasons)
  select v_run, x.ingest_id, x.session_token, x.event_type, x.track_id,
    x.orig_ptype, x.true_ptype, public._stream_listener_type(x.true_ptype, x.user_id, x.anonymous_id), x.mismatch,
    x.m_vsec, x.s_vsec, x.hb, x.client_sec,
    round(least(1.0, x.s_vsec / greatest(x.client_sec, x.s_vsec, 1))::numeric,4),
    round(least(1.0, x.s_vsec / 120.0)::numeric,4), x.has_completed,
    x.actual_verified, x.verified_cand, x.eligible_cand, x.settlement_cand, x.eligible_cand, x.eligible_cand,
    x.drop_stage, x.drop_reason,
    (select coalesce(jsonb_agg(r),'[]'::jsonb) from unnest(x.reasons) r)
  from (
    select i.id ingest_id, i.session_token, i.event_type, i.track_id, i.player_type orig_ptype, i.user_id, i.anonymous_id,
      coalesce(s.player_type, i.player_type) true_ptype,
      (s.player_type is not null and s.player_type is distinct from i.player_type) mismatch,
      coalesce(i.verified_seconds,0) m_vsec, coalesce(s.verified_seconds, i.verified_seconds, 0) s_vsec,
      coalesce(s.heartbeat_count,0) hb, i.client_reported_seconds client_sec,
      exists(select 1 from public.stream_ingest_v2 pc where pc.session_token=i.session_token and pc.event_type='play_completed') has_completed,
      -- actual verified (현행 view 기준)
      (i.event_type='play_30s' and i.heartbeat_verified is true and coalesce(i.verified_seconds,0) >= 30 and coalesce(i.visibility_state,'visible')='visible') actual_verified,
      -- calibrated verified candidate (session authoritative)
      (coalesce(s.verified_seconds, i.verified_seconds, 0) >= 30 and coalesce(i.visibility_state,'visible')='visible' and coalesce(s.heartbeat_count,0) > 0) verified_cand,
      -- eligible candidate (true identity + policy)
      (coalesce(s.verified_seconds, i.verified_seconds, 0) >= 30 and coalesce(i.visibility_state,'visible')='visible' and coalesce(s.heartbeat_count,0) > 0
        and coalesce(s.player_type, i.player_type) <> all (array['ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM'])
        and coalesce(i.player_volume,1) >= 0.1 and coalesce(i.player_muted,false)=false and i.ineligible_reason is null
        and coalesce(i.fraud_score,0) < 60 and coalesce(i.dispute_status,'none')='none') eligible_cand,
      -- settlement candidate (eligible + settlement track)
      (coalesce(s.verified_seconds, i.verified_seconds, 0) >= 30 and coalesce(i.visibility_state,'visible')='visible' and coalesce(s.heartbeat_count,0) > 0
        and coalesce(s.player_type, i.player_type) <> all (array['ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM'])
        and coalesce(i.player_volume,1) >= 0.1 and coalesce(i.player_muted,false)=false and i.ineligible_reason is null
        and coalesce(i.fraud_score,0) < 60 and coalesce(i.dispute_status,'none')='none'
        and exists(select 1 from public.eligible_settlement_tracks est where est.track_id=i.track_id)) settlement_cand,
      -- 현행 pipeline 이 drop 하는 지점/사유
      case
        when not (i.heartbeat_verified is true and coalesce(i.verified_seconds,0) >= 30 and coalesce(i.visibility_state,'visible')='visible') then 'verified'
        when coalesce(i.player_type,'') = any (array['ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM']) or coalesce(i.player_volume,1) < 0.1 or coalesce(i.player_muted,false) or i.ineligible_reason is not null or coalesce(i.fraud_score,0) >= 60 or coalesce(i.dispute_status,'none') <> 'none' then 'eligible'
        when not exists(select 1 from public.eligible_settlement_tracks est where est.track_id=i.track_id) then 'settlement'
        else null end drop_stage,
      case
        when not (i.heartbeat_verified is true and coalesce(i.verified_seconds,0) >= 30 and coalesce(i.visibility_state,'visible')='visible') then (
          case when s.session_token is null then 'no_session'
               when coalesce(i.visibility_state,'visible') <> 'visible' then 'not_visible'
               when coalesce(s.verified_seconds,0) >= 30 and coalesce(i.verified_seconds,0) < 30 then 'verification_delay'
               when i.heartbeat_verified is not true then 'heartbeat_missing'
               else 'insufficient_verified_seconds' end)
        when coalesce(i.player_type,'') = any (array['ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM']) then (
          case when s.player_type = 'USER' then 'identity_mismatch' else 'preview_excluded' end)
        when coalesce(i.player_volume,1) < 0.1 then 'low_volume'
        when coalesce(i.player_muted,false) then 'muted'
        when coalesce(i.fraud_score,0) >= 60 then 'fraud'
        when coalesce(i.dispute_status,'none') <> 'none' then 'dispute'
        when not exists(select 1 from public.eligible_settlement_tracks est where est.track_id=i.track_id) then 'track_not_settlement_eligible'
        else null end drop_reason,
      -- 복수 사유 배열(정보)
      array_remove(array[
        case when coalesce(s.verified_seconds,0) >= 30 and coalesce(i.verified_seconds,0) < 30 then 'verification_delay' end,
        case when s.player_type = 'USER' and i.player_type is distinct from 'USER' then 'identity_mismatch' end,
        case when i.heartbeat_verified is not true then 'heartbeat_missing' end,
        case when not exists(select 1 from public.stream_ingest_v2 pc where pc.session_token=i.session_token and pc.event_type='play_completed') then 'completion_missing' end
      ], null) reasons
    from public.stream_ingest_v2 i
    left join public.stream_sessions_v2 s on s.session_token = i.session_token
    where i.event_type = 'play_30s' and i.created_at >= v_from
  ) x;
  get diagnostics v_p30 = row_count;

  -- Completion calibration (동일 소스에서)
  insert into public.completion_calibration(run_id, session_token, track_id, milestone_verified_seconds, session_verified_seconds,
    heartbeat_count, client_reported_seconds, completion_rate, shadow_completion_score, has_play_completed)
  select run_id, session_token, track_id, milestone_verified_seconds, session_verified_seconds, heartbeat_count, client_reported_seconds,
    completion_rate, shadow_completion_score, has_play_completed
  from public.stream_shadow_calibration_items where run_id=v_run;

  select drop_reason into v_top from public.stream_shadow_calibration_items where run_id=v_run and drop_reason is not null group by drop_reason order by count(*) desc limit 1;

  update public.stream_shadow_calibration_runs set play30s_count=v_p30,
    verified_actual=(select count(*) from public.stream_shadow_calibration_items where run_id=v_run and actual_verified),
    verified_candidate=(select count(*) from public.stream_shadow_calibration_items where run_id=v_run and verified_candidate),
    eligible_candidate=(select count(*) from public.stream_shadow_calibration_items where run_id=v_run and eligible_candidate),
    settlement_candidate=(select count(*) from public.stream_shadow_calibration_items where run_id=v_run and settlement_candidate),
    top_drop_reason=v_top where id=v_run;

  return jsonb_build_object('ok',true,'run_id',v_run,'raw_count',v_raw,'play30s',v_p30,
    'verified_actual',(select count(*) from public.stream_shadow_calibration_items where run_id=v_run and actual_verified),
    'verified_candidate',(select count(*) from public.stream_shadow_calibration_items where run_id=v_run and verified_candidate),
    'eligible_candidate',(select count(*) from public.stream_shadow_calibration_items where run_id=v_run and eligible_candidate),
    'settlement_candidate',(select count(*) from public.stream_shadow_calibration_items where run_id=v_run and settlement_candidate),
    'top_drop_reason',v_top,'note','Shadow calibration — 실제 이벤트/funnel 미반영');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Identity Mapping — admin_generate_identity_mapping
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_identity_mapping(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; v_n integer;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.stream_shadow_calibration_runs order by run_at desc limit 1));
  if v_run is null then raise exception 'no calibration run — run admin_run_stream_shadow_calibration first'; end if;
  delete from public.identity_mapping_results where run_id=v_run;

  insert into public.identity_mapping_results(run_id, session_token, session_player_type, milestone_player_type, true_player_type, listener_type, mismatch)
  select v_run, session_token,
    (select s.player_type from public.stream_sessions_v2 s where s.session_token=ci.session_token),
    orig_player_type, true_player_type, listener_type, identity_mismatch
  from public.stream_shadow_calibration_items ci where run_id=v_run;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok',true,'run_id',v_run,'mapped',v_n,
    'mismatches',(select count(*) from public.identity_mapping_results where run_id=v_run and mismatch),
    'breakdown',(select coalesce(jsonb_object_agg(listener_type,c),'{}'::jsonb) from (select listener_type, count(*) c from public.identity_mapping_results where run_id=v_run group by 1) z),
    'note','Shadow identity mapping — 실제 이벤트 수정 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Verified Pipeline Candidates — admin_generate_verified_candidates
--    stage 별(verified/eligible/settlement/learning/prediction) 후보 unpivot
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_verified_candidates(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; v_n integer;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.stream_shadow_calibration_runs order by run_at desc limit 1));
  if v_run is null then raise exception 'no calibration run'; end if;
  delete from public.verified_pipeline_candidates where run_id=v_run;

  insert into public.verified_pipeline_candidates(run_id, ingest_id, session_token, track_id, stage, candidate, reason)
  select v_run, ingest_id, session_token, track_id, st.stage,
    case st.stage when 'verified' then verified_candidate when 'eligible' then eligible_candidate
      when 'settlement' then settlement_candidate when 'learning' then learning_candidate else prediction_candidate end,
    case when (case st.stage when 'verified' then verified_candidate when 'eligible' then eligible_candidate
      when 'settlement' then settlement_candidate when 'learning' then learning_candidate else prediction_candidate end)
      then 'calibrated candidate' else coalesce(drop_reason,'dropped') end
  from public.stream_shadow_calibration_items ci
  cross join (values ('verified'),('eligible'),('settlement'),('learning'),('prediction')) st(stage)
  where ci.run_id=v_run;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok',true,'run_id',v_run,'candidate_rows',v_n,
    'stage_counts',(select coalesce(jsonb_object_agg(stage, c),'{}'::jsonb) from (select stage, count(*) filter (where candidate) c from public.verified_pipeline_candidates where run_id=v_run group by stage) z),
    'note','Shadow pipeline candidates — 실반영 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- F. Funnel Summary + Drop Analysis (Calibration Report) — admin_generate_funnel_summary
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_funnel_summary(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; v_raw integer; v_va integer; v_vc integer; v_ec integer; v_sc integer; v_p30 integer;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.stream_shadow_calibration_runs order by run_at desc limit 1));
  if v_run is null then raise exception 'no calibration run'; end if;
  delete from public.drop_reason_analysis where run_id=v_run;
  delete from public.funnel_calibration_summary where run_id=v_run;

  select raw_count, play30s_count into v_raw, v_p30 from public.stream_shadow_calibration_runs where id=v_run;
  select count(*) filter (where actual_verified), count(*) filter (where verified_candidate),
    count(*) filter (where eligible_candidate), count(*) filter (where settlement_candidate)
    into v_va, v_vc, v_ec, v_sc from public.stream_shadow_calibration_items where run_id=v_run;

  insert into public.funnel_calibration_summary(run_id, raw_events, verified_events_actual, verified_candidate,
    eligible_events_actual, eligible_candidate, settlement_events_actual, settlement_candidate, learning_candidate, prediction_candidate,
    verified_conversion_rate, eligible_conversion_rate, verified_drop_rate)
  values (v_run, coalesce(v_raw,0), coalesce(v_va,0), coalesce(v_vc,0), 0, coalesce(v_ec,0), 0, coalesce(v_sc,0), coalesce(v_ec,0), coalesce(v_ec,0),
    round((coalesce(v_vc,0)::numeric / nullif(v_p30,0)),4), round((coalesce(v_ec,0)::numeric / nullif(v_vc,0)),4),
    round((1 - coalesce(v_vc,0)::numeric / nullif(v_p30,0)),4));

  -- Drop reason analysis (+ 권고)
  insert into public.drop_reason_analysis(run_id, drop_stage, drop_reason, cnt, pct, recommendation)
  select v_run, drop_stage, drop_reason, count(*)::int, round((count(*)::numeric / nullif(v_p30,0)),4), public._stream_drop_recommendation(drop_reason)
  from public.stream_shadow_calibration_items where run_id=v_run and drop_reason is not null
  group by drop_stage, drop_reason;

  return jsonb_build_object('ok',true,'run_id',v_run,
    'funnel', jsonb_build_object('raw',v_raw,'play30s',v_p30,'verified_actual',v_va,'verified_candidate',v_vc,'eligible_candidate',v_ec,'settlement_candidate',v_sc),
    'drop_analysis', (select coalesce(jsonb_agg(jsonb_build_object('stage',drop_stage,'reason',drop_reason,'count',cnt,'pct',pct,'recommendation',recommendation) order by cnt desc),'[]'::jsonb) from public.drop_reason_analysis where run_id=v_run),
    'report', jsonb_build_object(
      'headline', format('현행 verified %s → calibrated %s (session identity + verified_seconds back-fill 시 회복 가능)', coalesce(v_va,0), coalesce(v_vc,0)),
      'top_recommendation', (select recommendation from public.drop_reason_analysis where run_id=v_run order by cnt desc limit 1)),
    'note','Shadow funnel/report — 실반영 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- G. Overview — admin_stream_shadow_overview
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_stream_shadow_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_run uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select id into v_run from public.stream_shadow_calibration_runs order by run_at desc limit 1;
  select jsonb_build_object(
    'has_data', v_run is not null, 'run_id', v_run,
    'summary', (select to_jsonb(r) from (select raw_count, play30s_count, verified_actual, verified_candidate, eligible_candidate, settlement_candidate, top_drop_reason, run_at from public.stream_shadow_calibration_runs where id=v_run) r),
    'funnel', (select to_jsonb(f) from (select raw_events, verified_events_actual, verified_candidate, eligible_candidate, settlement_candidate, learning_candidate, prediction_candidate, verified_conversion_rate, verified_drop_rate from public.funnel_calibration_summary where run_id=v_run order by created_at desc limit 1) f),
    'identity', jsonb_build_object(
      'mismatches',(select count(*) from public.identity_mapping_results where run_id=v_run and mismatch),
      'breakdown',(select coalesce(jsonb_object_agg(listener_type,c),'{}'::jsonb) from (select listener_type, count(*) c from public.identity_mapping_results where run_id=v_run group by 1) z),
      'list',(select coalesce(jsonb_agg(jsonb_build_object('token',right(session_token,6),'session',session_player_type,'milestone',milestone_player_type,'true',true_player_type,'mismatch',mismatch) order by mismatch desc),'[]'::jsonb) from public.identity_mapping_results where run_id=v_run)),
    'drop_analysis', (select coalesce(jsonb_agg(jsonb_build_object('stage',drop_stage,'reason',drop_reason,'count',cnt,'pct',pct,'recommendation',recommendation) order by cnt desc),'[]'::jsonb) from public.drop_reason_analysis where run_id=v_run),
    'candidates', (select coalesce(jsonb_object_agg(stage, c),'{}'::jsonb) from (select stage, count(*) filter (where candidate) c from public.verified_pipeline_candidates where run_id=v_run group by stage) z),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('token',right(session_token,6),'true_ptype',true_player_type,'m_vsec',milestone_verified_seconds,'s_vsec',session_verified_seconds,'hb',heartbeat_count,'actual_verified',actual_verified,'verified_cand',verified_candidate,'eligible_cand',eligible_candidate,'settlement_cand',settlement_candidate,'drop_stage',drop_stage,'drop_reason',drop_reason) order by verified_candidate desc, session_verified_seconds desc),'[]'::jsonb)
              from (select * from public.stream_shadow_calibration_items where run_id=v_run order by session_verified_seconds desc limit 20) it)
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- H. Views
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_stream_shadow_summary as
select ci.run_id, ci.session_token, ci.track_id, ci.orig_player_type, ci.true_player_type, ci.listener_type, ci.identity_mismatch,
  ci.milestone_verified_seconds, ci.session_verified_seconds, ci.heartbeat_count, ci.completion_rate, ci.shadow_completion_score,
  ci.actual_verified, ci.verified_candidate, ci.eligible_candidate, ci.settlement_candidate, ci.drop_stage, ci.drop_reason
from public.stream_shadow_calibration_items ci;

create or replace view public.v2_verified_pipeline_summary as
select c.run_id, c.stage, count(*) filter (where c.candidate) as candidates, count(*) as total
from public.verified_pipeline_candidates c group by c.run_id, c.stage;

create or replace view public.v2_funnel_summary as
select f.run_id, f.raw_events, f.verified_events_actual, f.verified_candidate, f.eligible_candidate, f.settlement_candidate,
  f.learning_candidate, f.prediction_candidate, f.verified_conversion_rate, f.eligible_conversion_rate, f.verified_drop_rate
from public.funnel_calibration_summary f;

create or replace view public.v2_identity_mapping_summary as
select i.run_id, i.session_token, i.session_player_type, i.milestone_player_type, i.true_player_type, i.listener_type, i.mismatch
from public.identity_mapping_results i;

-- ─────────────────────────────────────────────────────────────────────
-- I. Grants
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._stream_listener_type(text,uuid,text)',
    'public._stream_drop_recommendation(text)',
    'public.admin_run_stream_shadow_calibration(integer)',
    'public.admin_generate_identity_mapping(uuid)',
    'public.admin_generate_verified_candidates(uuid)',
    'public.admin_generate_funnel_summary(uuid)',
    'public.admin_stream_shadow_overview()'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on function public.admin_run_stream_shadow_calibration(integer) is
  'ALGO-2E — Streaming Shadow Calibration. play_30s×session 조인으로 verified/eligible 후보 재계산. 실제 이벤트/funnel/정산 미반영.';
comment on function public.admin_generate_funnel_summary(uuid) is
  'ALGO-2E — Funnel Analytics + Drop Reason 분석/권고. Shadow only — 운영 적용 없음.';
