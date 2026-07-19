-- ─────────────────────────────────────────────────────────────────────────
-- 0570 — AI-EXPERIMENT-2: Internal Treatment Routing, Experiment Runtime &
--        Guarded Validation.
--
-- 0569 자산(experiments / allowlist / assignments / exposures / snapshots /
-- events / rollback)을 재사용하며 중복 테이블을 만들지 않는다. 이 마이그레이션은
-- 승인된 internal_test Store 최대 1~2곳에 한해 Recommendation v2 를 실제 Runtime
-- 추천 경로에 연결하기 위한 최소 자산만 추가한다:
--   1) ai_experiment_runtime_events  — Route / Fallback 관측 원장
--   2) ai_experiment_store_stops     — Store 단위 Emergency Stop
--   3) ai_experiment_exposures 확장  — Runtime Route / Attribution 컬럼
--   4) Runtime RPC                   — Gate / Treatment Recommend / Runtime Event
--   5) Admin RPC                     — Store Stop/Resume / Runtime Events /
--                                      Metric·Guardrail Snapshot / Internal Overview
--
-- 절대 원칙:
--   · Treatment 는 running + internal_test + Allowlist active + variant=treatment +
--     Emergency Stop off + Store Stop 없음 + Config 유효일 때만. 하나라도 실패 →
--     서버가 route='fallback_control' 를 반환하고 Track 을 반환하지 않는다(Fail-Closed).
--   · Treatment 추천 Track 집합은 **소스 플레이리스트의 재생가능 Track** 으로 제한한다
--     (외부 Track 주입 없음 — Queue 계약 안전. 최악의 경우에도 Control 과 동일 집합).
--   · Recommendation v1/v2 점수식·Production Weight·Queue·Player·Scheduler·Settlement
--     을 일절 변경하지 않는다. Global Rollout / Auto Canary / Auto Weight Apply /
--     Auto Rollback 함수는 존재하지 않는다.
--   · Store 인증(auth.uid())으로만 Runtime 범위를 결정한다. Client 는 Experiment/
--     Assignment/Variant/Stage/Version/Weight 를 지정할 수 없다.
--   · 재사용: _admin_growth_guard(0472) · _touch_updated_at(0025).
-- ─────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Runtime Events — Route / Fallback 관측 (Playback 무영향, 실패 silent 삽입)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_experiment_runtime_events (
  id                   uuid primary key default gen_random_uuid(),
  experiment_id        uuid references public.ai_recommendation_experiments(id) on delete cascade,
  assignment_id        uuid references public.ai_experiment_assignments(id) on delete set null,
  store_id             uuid not null,
  session_id           text,
  route                text not null
    check (route in ('control','treatment','shadow','fallback_control')),
  fallback_reason      text,
  algorithm_version    text,
  weight_version       text,
  treatment_duration_ms int,
  control_duration_ms   int,
  result_count         int,
  queue_contract_valid boolean,
  metadata             jsonb not null default '{}'::jsonb,
  occurred_at          timestamptz not null default now(),
  created_at           timestamptz not null default now()
);

create index if not exists idx_ai_exp_runtime_ev
  on public.ai_experiment_runtime_events (experiment_id, occurred_at desc);
create index if not exists idx_ai_exp_runtime_ev_store
  on public.ai_experiment_runtime_events (store_id, occurred_at desc);

alter table public.ai_experiment_runtime_events enable row level security;
-- deny-all — Runtime 은 본인 Store 범위 record RPC, 조회는 관리자 RPC 로만.

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Store-Level Emergency Stop — 실험 전체 Stop 과 별개의 Store 단위 중지
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_experiment_store_stops (
  id            uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.ai_recommendation_experiments(id) on delete cascade,
  store_id      uuid not null,
  status        text not null default 'stopped' check (status in ('stopped','resumed')),
  reason        text not null,
  stopped_by    uuid,
  stopped_at    timestamptz not null default now(),
  resumed_by    uuid,
  resumed_at    timestamptz,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (experiment_id, store_id)
);

create index if not exists idx_ai_exp_store_stops
  on public.ai_experiment_store_stops (store_id, status);

drop trigger if exists tg_ai_exp_store_stops_touch on public.ai_experiment_store_stops;
create trigger tg_ai_exp_store_stops_touch before update on public.ai_experiment_store_stops
  for each row execute function public._touch_updated_at();

alter table public.ai_experiment_store_stops enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Exposure Attribution 확장 (0569 ai_experiment_exposures — 재사용 확장)
-- ─────────────────────────────────────────────────────────────────────────
alter table public.ai_experiment_exposures
  add column if not exists route             text,
  add column if not exists queue_request_id  text,
  add column if not exists queue_position    int,
  add column if not exists actual_selected   boolean,
  add column if not exists playback_attributed boolean,
  add column if not exists attribution_status text;

-- 0569 events check 확장 — Store Stop / Resume / Runtime Fallback Audit.
alter table public.ai_experiment_events drop constraint if exists ai_experiment_events_event_type_check;
alter table public.ai_experiment_events add constraint ai_experiment_events_event_type_check
  check (event_type in (
    'created','allowlist_changed','assignment_built','assignment_overridden','status_changed',
    'emergency_stop','snapshot_recorded','rollback_proposed','fallback_recorded','note',
    'store_stopped','store_resumed','metric_snapshot','guardrail_snapshot'));

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Runtime Gate — 본인 Store 의 Treatment 적격성(서버 판정, Client 위조 불가).
--    하나라도 실패하면 eligible=false + reason → Client 는 Control 을 사용한다.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.experiment_treatment_gate()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_store uuid := auth.uid();
  a record;
  v_reason text := null;
  v_eligible boolean := false;
begin
  if v_store is null then
    return jsonb_build_object('eligible', false, 'reason', 'auth_required', 'assignment', null);
  end if;

  select a.id as assignment_id, a.variant, a.status as assignment_status, a.experiment_id,
         e.status as exp_status, e.stage, e.emergency_stop, e.config_snapshot,
         e.treatment_algorithm_version, e.treatment_weight_version
    into a
  from public.ai_experiment_assignments a
  join public.ai_recommendation_experiments e on e.id = a.experiment_id
  where a.store_id = v_store and a.status in ('assigned','overridden') and e.status = 'running'
  order by a.assigned_at desc
  limit 1;

  if a.assignment_id is null then
    return jsonb_build_object('eligible', false, 'reason', 'no_running_assignment', 'assignment', null);
  end if;

  -- Fail-Closed 게이트 — 순서대로 첫 실패 사유를 반환한다.
  if a.variant = 'control' then v_reason := 'control_assignment';
  elsif a.variant = 'shadow_treatment' then v_reason := 'shadow_assignment';
  elsif a.variant <> 'treatment' then v_reason := 'not_treatment';
  elsif a.stage <> 'internal_test' then v_reason := 'wrong_stage';
  elsif a.emergency_stop then v_reason := 'emergency_stop';
  elsif not exists (
    select 1 from public.ai_experiment_store_allowlist w
    where w.experiment_id = a.experiment_id and w.store_id = v_store and w.status = 'active'
      and w.allowed_stage in ('internal_test','canary','limited')
  ) then v_reason := 'not_allowlisted';
  elsif exists (
    select 1 from public.ai_experiment_store_stops s
    where s.experiment_id = a.experiment_id and s.store_id = v_store and s.status = 'stopped'
  ) then v_reason := 'store_stopped';
  elsif coalesce(a.config_snapshot, '{}'::jsonb) = '{}'::jsonb then v_reason := 'invalid_config';
  else v_eligible := true;
  end if;

  return jsonb_build_object(
    'eligible', v_eligible,
    'reason', v_reason,
    'assignment', jsonb_build_object(
      'experiment_id', a.experiment_id,
      'assignment_id', a.assignment_id,
      'variant', a.variant,
      'stage', a.stage,
      'algorithm_version', a.treatment_algorithm_version,
      'weight_version', a.treatment_weight_version));
end;
$$;

grant execute on function public.experiment_treatment_gate() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Treatment Recommend (Runtime Preview) — Draft 저장 없이 v2 결정론 재순위.
--    · Gate 재검증(위 게이트와 동일 조건).
--    · Candidate 집합 = 소스 플레이리스트의 재생가능 Track (외부 주입 없음).
--    · Score = 실측 신호(fit / quality / reaction / behavior / recency / fatigue)를
--      Experiment Weight Snapshot 으로 가중 합산 + md5(seed||track) 결정론 tie-break.
--      → 동일 (store, playlist, seed, assignment) 입력에 동일 순서. Production Weight
--      미변경(요청 단위 Snapshot 만 사용).
--    · target 미만이면 route='fallback_control' + insufficient_candidates.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.experiment_treatment_recommend(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_store uuid := auth.uid();
  v_gate jsonb;
  v_eligible boolean;
  v_exp_id uuid;
  v_assignment_id uuid;
  v_playlist_id uuid := nullif(p_payload->>'playlist_id','')::uuid;
  v_target int := greatest(1, least(coalesce((p_payload->>'target_count')::int, 20), 100));
  v_seed bigint;
  v_weights jsonb;
  v_algo text; v_wver text;
  v_items jsonb;
  v_count int;
begin
  if v_store is null then
    return jsonb_build_object('route','fallback_control','reason','auth_required','tracks','[]'::jsonb);
  end if;

  v_gate := public.experiment_treatment_gate();
  v_eligible := coalesce((v_gate->>'eligible')::boolean, false);
  if not v_eligible then
    return jsonb_build_object('route','fallback_control',
      'reason', coalesce(v_gate->>'reason','gate_failed'), 'tracks','[]'::jsonb);
  end if;

  v_exp_id := (v_gate->'assignment'->>'experiment_id')::uuid;
  v_assignment_id := (v_gate->'assignment'->>'assignment_id')::uuid;
  v_algo := v_gate->'assignment'->>'algorithm_version';
  v_wver := v_gate->'assignment'->>'weight_version';

  if v_playlist_id is null then
    return jsonb_build_object('route','fallback_control','reason','candidate_pool_empty','tracks','[]'::jsonb);
  end if;

  -- Experiment Weight Snapshot(요청 단위) — 없으면 v2 기본 가중치(합 100) 사용.
  select coalesce(
    (config_snapshot->'weight_snapshot'),
    jsonb_build_object(
      'storeFit',20,'trackQuality',10,'reactionSignal',10,'behavior',10,
      'novelty',5,'fatigueControl',5)), seed
    into v_weights, v_seed
  from public.ai_recommendation_experiments where id = v_exp_id;

  -- 소스 플레이리스트의 재생가능 Track 만 후보로 삼아 결정론 재순위한다.
  select coalesce(jsonb_agg(to_jsonb(x) order by x.score desc, x.tiebreak asc), '[]'::jsonb), count(*)
    into v_items, v_count
  from (
    select
      tr.id, tr.title, tr.artist, tr.genre, tr.mood, tr.audio_url, tr.cover_url,
      tr.duration, tr.created_at,
      -- 가중 합산 스코어(0..100 정규화 신호 × Snapshot 가중치).
      (
        coalesce((v_weights->>'storeFit')::numeric,0)      * (coalesce(f.fit_score,50)/100.0) +
        coalesce((v_weights->>'trackQuality')::numeric,0)  * (coalesce(lq.qc_score,50)/100.0) +
        coalesce((v_weights->>'reactionSignal')::numeric,0)* greatest(0, coalesce(agg.like_ratio,50) - coalesce(agg.dislike_ratio,0))/100.0 +
        coalesce((v_weights->>'behavior')::numeric,0)      * greatest(0, coalesce(bs.completion_rate,50) - coalesce(bs.skip_rate,0))/100.0 +
        coalesce((v_weights->>'novelty')::numeric,0)       * (case when tr.created_at >= now() - interval '60 days' then 1.0 else 0.4 end) +
        coalesce((v_weights->>'fatigueControl')::numeric,0)* (1.0 - least(1.0, coalesce(k.events,0)/50.0))
      ) as score,
      -- 결정론 tie-break — seed + track_id md5.
      ('x' || substr(md5(v_seed::text || tr.id::text), 1, 8))::bit(32)::bigint as tiebreak
    from public.playlist_tracks pt
    join public.tracks tr on tr.id = pt.track_id
    left join public.playlist_track_fit_scores f
      on f.playlist_id = v_playlist_id and f.track_id = tr.id
    left join lateral (
      select q.qc_score from public.audio_qc_reports q
      where q.track_id = tr.id order by q.created_at desc limit 1
    ) lq on true
    left join public.track_reaction_aggregate agg on agg.track_id = tr.id
    left join lateral (
      select b.completion_rate, b.skip_rate from public.track_behavior_scores b
      where b.track_id = tr.id order by b.window_days asc limit 1
    ) bs on true
    left join lateral (
      select count(*)::int as events from public.playback_events_v2 e
      where e.track_id = tr.id and e.created_at >= now() - interval '30 days'
    ) k on true
    where pt.playlist_id = v_playlist_id
      and tr.removed_at is null
      and tr.visibility_status = 'approved'
      and (tr.release_status = 'released' or tr.source_type = 'admin_upload')
      and tr.audio_url is not null
      and coalesce(tr.audio_health_status, 'unknown') in ('ok','unknown')
    limit greatest(v_target, 200)
  ) x;

  if v_count = 0 then
    return jsonb_build_object('route','fallback_control','reason','candidate_pool_empty','tracks','[]'::jsonb);
  end if;
  if v_count < v_target then
    return jsonb_build_object('route','fallback_control','reason','insufficient_candidates',
      'tracks','[]'::jsonb, 'available', v_count, 'target', v_target);
  end if;

  return jsonb_build_object(
    'route','treatment',
    'reason', null,
    'experiment_id', v_exp_id,
    'assignment_id', v_assignment_id,
    'algorithm_version', v_algo,
    'weight_version', v_wver,
    'tracks', (select jsonb_agg(elem) from (
      select elem from jsonb_array_elements(v_items) with ordinality as t(elem, ord)
      order by ord limit v_target
    ) s));
end;
$$;

grant execute on function public.experiment_treatment_recommend(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Runtime Event 기록 (Client fire-and-forget) — Route/Fallback 관측.
--    store_id 는 auth.uid() 로 강제(위조 불가). 실험/배정 참조는 본인 것만 허용.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.experiment_record_runtime_event(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_store uuid := auth.uid();
  v_exp_id uuid := nullif(p_payload->>'experiment_id','')::uuid;
  v_assign uuid := nullif(p_payload->>'assignment_id','')::uuid;
  v_route text := p_payload->>'route';
  v_id uuid;
begin
  if v_store is null then raise exception 'auth required' using errcode = '42501'; end if;
  if v_route not in ('control','treatment','shadow','fallback_control') then
    raise exception 'invalid route' using errcode = '22023';
  end if;
  if length(p_payload::text) > 20000 then raise exception 'payload too large' using errcode = '22023'; end if;

  -- 실험/배정 참조는 본인 Store 의 것만 유효. 아니면 참조를 떼고 관측만 남긴다.
  if v_exp_id is not null and not exists (
    select 1 from public.ai_experiment_assignments a
    where a.experiment_id = v_exp_id and a.store_id = v_store
  ) then
    v_exp_id := null; v_assign := null;
  end if;

  insert into public.ai_experiment_runtime_events(
    experiment_id, assignment_id, store_id, session_id, route, fallback_reason,
    algorithm_version, weight_version, treatment_duration_ms, control_duration_ms,
    result_count, queue_contract_valid, metadata)
  values (
    v_exp_id, v_assign, v_store, nullif(p_payload->>'session_id',''), v_route,
    nullif(p_payload->>'fallback_reason',''),
    nullif(p_payload->>'algorithm_version',''), nullif(p_payload->>'weight_version',''),
    (p_payload->>'treatment_duration_ms')::int, (p_payload->>'control_duration_ms')::int,
    (p_payload->>'result_count')::int,
    (p_payload->>'queue_contract_valid')::boolean,
    coalesce(p_payload->'metadata','{}'::jsonb))
  returning id into v_id;

  return jsonb_build_object('runtime_event_id', v_id);
end;
$$;

grant execute on function public.experiment_record_runtime_event(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Admin — Store Stop / Resume (현재 재생 강제 중단 없음 · 다음 요청부터 Control).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_exp_store_stop(p_id uuid, p_store_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public._admin_growth_guard();
  if coalesce(p_reason,'') = '' then raise exception 'stop reason required' using errcode = '22023'; end if;
  if not exists (select 1 from public.ai_recommendation_experiments where id = p_id) then
    raise exception 'experiment not found' using errcode = 'P0002';
  end if;

  insert into public.ai_experiment_store_stops(experiment_id, store_id, status, reason, stopped_by)
  values (p_id, p_store_id, 'stopped', p_reason, auth.uid())
  on conflict (experiment_id, store_id) do update
    set status = 'stopped', reason = p_reason, stopped_by = auth.uid(),
        stopped_at = now(), resumed_by = null, resumed_at = null;

  insert into public.ai_experiment_events(experiment_id, event_type, actor_id, reason, metadata)
  values (p_id, 'store_stopped', auth.uid(), p_reason, jsonb_build_object('store_id', p_store_id));
  return jsonb_build_object('ok', true, 'store_id', p_store_id, 'status', 'stopped');
end;
$$;

grant execute on function public.admin_ai_exp_store_stop(uuid, uuid, text) to authenticated;

create or replace function public.admin_ai_exp_store_resume(p_id uuid, p_store_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public._admin_growth_guard();
  if coalesce(p_reason,'') = '' then raise exception 'resume reason required' using errcode = '22023'; end if;

  update public.ai_experiment_store_stops
    set status = 'resumed', resumed_by = auth.uid(), resumed_at = now(),
        metadata = metadata || jsonb_build_object('resume_reason', p_reason)
  where experiment_id = p_id and store_id = p_store_id;
  if not found then raise exception 'store stop not found' using errcode = 'P0002'; end if;

  insert into public.ai_experiment_events(experiment_id, event_type, actor_id, reason, metadata)
  values (p_id, 'store_resumed', auth.uid(), p_reason, jsonb_build_object('store_id', p_store_id));
  return jsonb_build_object('ok', true, 'store_id', p_store_id, 'status', 'resumed');
end;
$$;

grant execute on function public.admin_ai_exp_store_resume(uuid, uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Admin — Runtime Events 조회.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_exp_runtime_events(p_id uuid, p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(r) order by r.occurred_at desc), '[]'::jsonb) into v
  from (
    select id, experiment_id, assignment_id, store_id, session_id, route, fallback_reason,
      algorithm_version, weight_version, treatment_duration_ms, control_duration_ms,
      result_count, queue_contract_valid, occurred_at
    from public.ai_experiment_runtime_events
    where experiment_id = p_id
    order by occurred_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) r;
  return v;
end;
$$;

grant execute on function public.admin_ai_exp_runtime_events(uuid, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) Admin — Metric Snapshot 자동 생성(실제 Exposure/Runtime 기반).
--    데이터 없으면 insufficient_data. 승자/성공 단정은 클라이언트 통계 계층에서만.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_exp_generate_metric_snapshot(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  e record;
  v_control_expo int; v_treat_expo int; v_fallback int; v_treat_route int;
  v_window_start timestamptz; v_window_end timestamptz := now();
  v_control jsonb; v_treatment jsonb; v_snap_id uuid;
begin
  perform public._admin_growth_guard();
  select * into e from public.ai_recommendation_experiments where id = p_id;
  if e.id is null then raise exception 'experiment not found' using errcode = 'P0002'; end if;
  v_window_start := coalesce(e.start_at, e.created_at);

  select
    count(*) filter (where variant = 'control'),
    count(*) filter (where variant = 'treatment')
    into v_control_expo, v_treat_expo
  from public.ai_experiment_exposures where experiment_id = p_id;

  select
    count(*) filter (where route = 'fallback_control'),
    count(*) filter (where route = 'treatment')
    into v_fallback, v_treat_route
  from public.ai_experiment_runtime_events where experiment_id = p_id;

  v_control := jsonb_build_object('exposure', coalesce(v_control_expo,0), 'status',
    case when coalesce(v_control_expo,0) = 0 then 'insufficient_data' else 'available' end);
  v_treatment := jsonb_build_object('exposure', coalesce(v_treat_expo,0),
    'runtime_treatment_events', coalesce(v_treat_route,0),
    'fallback_events', coalesce(v_fallback,0),
    'status', case when coalesce(v_treat_expo,0) = 0 then 'insufficient_data' else 'available' end);

  insert into public.ai_experiment_metric_snapshots(
    experiment_id, window_start, window_end, control_metrics, treatment_metrics,
    guardrail_results, srm_result, decision, limitations)
  values (
    p_id, v_window_start, v_window_end, v_control, v_treatment,
    '[]'::jsonb,
    jsonb_build_object('status',
      case when coalesce(v_control_expo,0) + coalesce(v_treat_expo,0) < 100 then 'insufficient_data' else 'ok' end,
      'sample', coalesce(v_control_expo,0) + coalesce(v_treat_expo,0)),
    'insufficient_data',
    jsonb_build_array('실측 Exposure 표본이 부족하면 승자/성능 비교를 수행하지 않는다.',
      '이 Snapshot 은 관측 원장 집계이며 Global Rollout 근거가 아니다.'))
  on conflict (experiment_id, window_start, window_end) do update
    set control_metrics = excluded.control_metrics, treatment_metrics = excluded.treatment_metrics,
        srm_result = excluded.srm_result, limitations = excluded.limitations
  returning id into v_snap_id;

  insert into public.ai_experiment_events(experiment_id, event_type, actor_id, metadata)
  values (p_id, 'metric_snapshot', auth.uid(),
    jsonb_build_object('snapshot_id', v_snap_id, 'sample', coalesce(v_control_expo,0) + coalesce(v_treat_expo,0)));

  return jsonb_build_object('snapshot_id', v_snap_id,
    'control', v_control, 'treatment', v_treatment,
    'sample', coalesce(v_control_expo,0) + coalesce(v_treat_expo,0));
end;
$$;

grant execute on function public.admin_ai_exp_generate_metric_snapshot(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) Admin — Guardrail Snapshot 자동 생성. Blocking 발생 시 Pause Proposal 만 기록
--     (자동 Rollback / 강제 Playback 중단 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_exp_generate_guardrail_snapshot(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  e record;
  v_total int; v_fallback int; v_fallback_rate numeric; v_treat int;
  v_results jsonb := '[]'::jsonb;
  v_blocking int := 0;
begin
  perform public._admin_growth_guard();
  select * into e from public.ai_recommendation_experiments where id = p_id;
  if e.id is null then raise exception 'experiment not found' using errcode = 'P0002'; end if;

  select count(*), count(*) filter (where route = 'fallback_control'), count(*) filter (where route = 'treatment')
    into v_total, v_fallback, v_treat
  from public.ai_experiment_runtime_events where experiment_id = p_id;

  -- Emergency Stop 활성 — Blocking.
  if e.emergency_stop then
    v_results := v_results || jsonb_build_array(jsonb_build_object('name','emergency_stop_active','kind','blocking','status','breach'));
    v_blocking := v_blocking + 1;
  end if;

  -- Treatment Fallback Rate — 표본 충분할 때만 평가(그 전엔 insufficient_data).
  if coalesce(v_total,0) < 20 then
    v_results := v_results || jsonb_build_array(jsonb_build_object('name','treatment_fallback_rate','kind','blocking','status','insufficient_data','sample', coalesce(v_total,0)));
  else
    v_fallback_rate := round(v_fallback::numeric / nullif(v_total,0), 3);
    if v_fallback_rate > 0.5 then
      v_results := v_results || jsonb_build_array(jsonb_build_object('name','treatment_fallback_rate','kind','blocking','status','breach','value', v_fallback_rate));
      v_blocking := v_blocking + 1;
    else
      v_results := v_results || jsonb_build_array(jsonb_build_object('name','treatment_fallback_rate','kind','blocking','status','pass','value', v_fallback_rate));
    end if;
  end if;

  insert into public.ai_experiment_events(experiment_id, event_type, actor_id, metadata)
  values (p_id, 'guardrail_snapshot', auth.uid(),
    jsonb_build_object('blocking', v_blocking, 'results', v_results,
      'proposal', case when v_blocking > 0 then 'pause_recommended' else 'none' end));

  return jsonb_build_object(
    'results', v_results, 'blocking_count', v_blocking,
    'proposal', case when v_blocking > 0 then 'pause_recommended' else 'none' end,
    'note', 'Blocking 발생 시에도 자동 Rollback/강제 Playback 중단은 없다 — Pause 제안만 기록된다.');
end;
$$;

grant execute on function public.admin_ai_exp_generate_guardrail_snapshot(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 11) Admin — Internal Runtime Overview (UI 집계).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_exp_internal_overview(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'experiment', (select jsonb_build_object('id', id, 'name', name, 'stage', stage, 'status', status,
        'emergency_stop', emergency_stop, 'allocation_ratio', allocation_ratio)
      from public.ai_recommendation_experiments where id = p_id),
    'allowlist_count', (select count(*) from public.ai_experiment_store_allowlist where experiment_id = p_id and status = 'active'),
    'control_stores', (select count(*) from public.ai_experiment_assignments where experiment_id = p_id and variant = 'control' and status in ('assigned','overridden')),
    'treatment_stores', (select count(*) from public.ai_experiment_assignments where experiment_id = p_id and variant = 'treatment' and status in ('assigned','overridden')),
    'store_stops', (select coalesce(jsonb_agg(jsonb_build_object('store_id', store_id, 'status', status, 'reason', reason, 'stopped_at', stopped_at)), '[]'::jsonb)
      from public.ai_experiment_store_stops where experiment_id = p_id),
    'runtime_totals', (select jsonb_build_object(
        'total', count(*),
        'treatment', count(*) filter (where route = 'treatment'),
        'fallback_control', count(*) filter (where route = 'fallback_control'),
        'control', count(*) filter (where route = 'control'))
      from public.ai_experiment_runtime_events where experiment_id = p_id),
    'exposure_totals', (select jsonb_build_object(
        'control', count(*) filter (where variant = 'control'),
        'treatment', count(*) filter (where variant = 'treatment'),
        'fallback', count(*) filter (where fallback_to_control))
      from public.ai_experiment_exposures where experiment_id = p_id)
  ) into v;
  return v;
end;
$$;

grant execute on function public.admin_ai_exp_internal_overview(uuid) to authenticated;
