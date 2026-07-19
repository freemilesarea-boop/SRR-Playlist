-- ============================================
-- 0569_ai_experiment_controlled_ab.sql
--
-- Phase AI-EXPERIMENT-1 — Controlled A/B Test, Canary Validation & Safe Event Emission.
--
-- Stage 0(Event Emission)~Stage 3(Canary) **기반**만 구축한다. 일반 Store 의 Playback/
-- Player/Queue/Scheduler/Playlist/Recommendation v1·v2 점수식/Weight/정산은 무변경.
-- Treatment 는 Allowlist + 승인 + Running 상태 + Emergency Stop 비활성일 때만 가능하며,
-- Global Rollout / v1 Disable / Weight Apply / 자동 Rollback RPC 는 존재하지 않는다.
--
-- 재사용: ai_learning_exposures(0568 — 중복 Exposure Ledger 금지, 연결 테이블만 신설) ·
-- _admin_growth_guard(0472) · _touch_updated_at(0025). Raw IP 저장 금지.
--
-- Runtime RPC(비관리자)는 auth.uid() = store 본인 범위로 강제된다:
--   · experiment_runtime_lookup() — 본인 Store 의 Running Assignment/Emergency Stop 만 반환.
--   · experiment_record_exposure(p) — store_id 를 auth.uid() 로 강제(위조 불가),
--     Treatment 소스 기록은 실제 treatment Assignment 가 있을 때만 허용.
--   조회/기록 실패 시 클라이언트는 항상 Control(기존 동작)로 동작한다.
-- ============================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Experiment 본체
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_recommendation_experiments (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null check (char_length(name) between 1 and 200),
  hypothesis                  text not null default '',
  stage                       text not null default 'event_emission_only'
    check (stage in ('event_emission_only','shadow_assignment','internal_test','canary','limited')),
  status                      text not null default 'draft'
    check (status in ('draft','ready_for_review','approved','scheduled','running','paused','stopped','completed','rejected','archived')),
  primary_metric              text not null default 'valid_completion_rate',
  secondary_metrics           jsonb not null default '[]'::jsonb,
  guardrail_config            jsonb not null default '{}'::jsonb,
  control_algorithm_version   text not null default 'recommendation_v1',
  treatment_algorithm_version text not null default 'rec-v2',
  control_weight_version      text not null default 'v1-production',
  treatment_weight_version    text not null default 'rec-v2-w1',
  weight_proposal_id          uuid references public.ai_learning_weight_proposals(id) on delete set null,
  allocation_ratio            numeric not null default 0.5 check (allocation_ratio > 0 and allocation_ratio < 1),
  seed                        bigint not null default 1,
  assignment_version          text not null default 'assign-v1',
  minimum_exposure            int not null default 100,
  minimum_valid_outcomes      int not null default 30,
  minimum_duration_hours      int not null default 72,
  maximum_duration_hours      int not null default 720,
  start_at                    timestamptz,
  end_at                      timestamptz,
  emergency_stop              boolean not null default false,
  pause_reason                text,
  stop_reason                 text,
  config_snapshot             jsonb not null default '{}'::jsonb,
  quality_score               numeric check (quality_score is null or (quality_score >= 0 and quality_score <= 100)),
  quality_grade               text check (quality_grade is null or quality_grade in ('A','B','C','D','insufficient_data','invalid')),
  decision                    text check (decision is null or decision in ('continue','pause','stop','extend','promote_candidate','insufficient_data')),
  decision_reason             text,
  created_by                  uuid,
  approved_by                 uuid,
  approved_at                 timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  expires_at                  timestamptz not null default now() + interval '90 days',
  check (end_at is null or start_at is null or end_at > start_at)
);

comment on table public.ai_recommendation_experiments is
  'AI-EXPERIMENT-1 — Controlled A/B(Allowlist 한정). Approved/성공 판정은 v2 의 전체 Production 적용이 아니다.';

create index if not exists idx_ai_exp_status on public.ai_recommendation_experiments (status, created_at desc);

drop trigger if exists tg_ai_exp_touch on public.ai_recommendation_experiments;
create trigger tg_ai_exp_touch before update on public.ai_recommendation_experiments
  for each row execute function public._touch_updated_at();

alter table public.ai_recommendation_experiments enable row level security;
-- deny-all — 관리는 관리자 RPC, Runtime 은 본인 Store 범위 RPC 로만.

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Store Allowlist — Treatment 는 Allowlist Store 에만 가능.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_experiment_store_allowlist (
  id              uuid primary key default gen_random_uuid(),
  experiment_id   uuid not null references public.ai_recommendation_experiments(id) on delete cascade,
  store_id        uuid not null,
  brand_id        uuid,
  allowed_stage   text not null default 'internal_test'
    check (allowed_stage in ('shadow_assignment','internal_test','canary','limited')),
  status          text not null default 'active' check (status in ('active','removed','emergency_excluded')),
  max_exposures   int,
  start_at        timestamptz,
  end_at          timestamptz,
  approved_by     uuid,
  approval_reason text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (experiment_id, store_id)
);

create index if not exists idx_ai_exp_allow_store on public.ai_experiment_store_allowlist (store_id, status);

drop trigger if exists tg_ai_exp_allow_touch on public.ai_experiment_store_allowlist;
create trigger tg_ai_exp_allow_touch before update on public.ai_experiment_store_allowlist
  for each row execute function public._touch_updated_at();

alter table public.ai_experiment_store_allowlist enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Assignment — 서버 결정론(md5 bucket) · Sticky(unique) · Override 는 Audit.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_experiment_assignments (
  id                 uuid primary key default gen_random_uuid(),
  experiment_id      uuid not null references public.ai_recommendation_experiments(id) on delete cascade,
  store_id           uuid not null,
  variant            text not null check (variant in ('control','treatment','shadow_treatment')),
  assignment_key     text not null,
  assignment_version text not null,
  status             text not null default 'assigned'
    check (status in ('assigned','excluded','ineligible','overridden','expired')),
  reason             text,
  assigned_at        timestamptz not null default now(),
  expires_at         timestamptz,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  unique (experiment_id, store_id)
);

create index if not exists idx_ai_exp_assign_store on public.ai_experiment_assignments (store_id, status);

alter table public.ai_experiment_assignments enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Exposure 연결(0568 Ledger 재사용 — 중복 파이프라인 금지) / 5) Snapshot / 6) Events / 7) Rollback
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_experiment_exposures (
  id                   uuid primary key default gen_random_uuid(),
  experiment_id        uuid not null references public.ai_recommendation_experiments(id) on delete cascade,
  assignment_id        uuid references public.ai_experiment_assignments(id) on delete set null,
  learning_exposure_id uuid not null references public.ai_learning_exposures(id) on delete cascade,
  variant              text not null check (variant in ('control','treatment','shadow_treatment')),
  is_shadow            boolean not null default false,
  fallback_to_control  boolean not null default false,
  fallback_reason      text,
  created_at           timestamptz not null default now(),
  unique (learning_exposure_id)
);

create index if not exists idx_ai_exp_expo on public.ai_experiment_exposures (experiment_id, variant, created_at desc);

alter table public.ai_experiment_exposures enable row level security;

create table if not exists public.ai_experiment_metric_snapshots (
  id                uuid primary key default gen_random_uuid(),
  experiment_id     uuid not null references public.ai_recommendation_experiments(id) on delete cascade,
  window_start      timestamptz not null,
  window_end        timestamptz not null,
  control_metrics   jsonb not null default '{}'::jsonb,
  treatment_metrics jsonb not null default '{}'::jsonb,
  guardrail_results jsonb not null default '[]'::jsonb,
  srm_result        jsonb not null default '{}'::jsonb,
  quality_score     numeric,
  quality_grade     text,
  decision          text,
  limitations       jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  unique (experiment_id, window_start, window_end)
);

alter table public.ai_experiment_metric_snapshots enable row level security;

create table if not exists public.ai_experiment_events (
  id              uuid primary key default gen_random_uuid(),
  experiment_id   uuid not null references public.ai_recommendation_experiments(id) on delete cascade,
  event_type      text not null check (event_type in (
    'created','allowlist_changed','assignment_built','assignment_overridden','status_changed',
    'emergency_stop','snapshot_recorded','rollback_proposed','fallback_recorded','note')),
  actor_id        uuid,
  previous_status text,
  next_status     text,
  reason          text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_ai_exp_events on public.ai_experiment_events (experiment_id, created_at desc);

alter table public.ai_experiment_events enable row level security;

create table if not exists public.ai_experiment_rollback_proposals (
  id                 uuid primary key default gen_random_uuid(),
  experiment_id      uuid not null references public.ai_recommendation_experiments(id) on delete cascade,
  status             text not null default 'draft'
    check (status in ('draft','ready_for_review','approved','rejected','archived')),
  trigger_reason     text not null,
  severity           text not null default 'warning' check (severity in ('warning','critical')),
  affected_stores    jsonb not null default '[]'::jsonb,
  guardrail_evidence jsonb not null default '{}'::jsonb,
  recommended_action text not null default 'pause'
    check (recommended_action in ('continue','pause','stop','reduce_ratio','remove_store','extend_observation','return_to_shadow')),
  risks              jsonb not null default '[]'::jsonb,
  created_by         uuid,
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  rejection_reason   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.ai_experiment_rollback_proposals is
  'Rollback Proposal — approved 는 관리자 실행 후보 승인 기록이며 자동 Rollback 실행이 아니다.';

drop trigger if exists tg_ai_exp_rb_touch on public.ai_experiment_rollback_proposals;
create trigger tg_ai_exp_rb_touch before update on public.ai_experiment_rollback_proposals
  for each row execute function public._touch_updated_at();

alter table public.ai_experiment_rollback_proposals enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 결정론 Assignment 계산(서버 전용 md5 bucket 0~9999) — 클라이언트 지정 불가.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public._ai_exp_variant(
  p_experiment_id uuid, p_store_id uuid, p_seed bigint, p_version text, p_ratio numeric, p_stage text
) returns text
language sql
immutable
as $$
  select case
    when (('x' || substr(md5(p_experiment_id::text || p_store_id::text || p_seed::text || p_version), 1, 8))::bit(32)::bigint % 10000)
         < (p_ratio * 10000)::bigint
    then case when p_stage = 'shadow_assignment' then 'shadow_treatment' else 'treatment' end
    else 'control'
  end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) 관리자 RPC — 생성/목록/상세/Allowlist/Assignment/상태 전이/Emergency Stop/
--    Snapshot/Rollback. Global Rollout·Weight Apply·v1 Disable RPC 는 없다.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_exp_create(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_id uuid; v_prop record;
begin
  perform public._admin_growth_guard();
  if coalesce(p_payload->>'name','') = '' then raise exception 'name required' using errcode = '22023'; end if;
  if length(p_payload::text) > 100000 then raise exception 'payload too large' using errcode = '22023'; end if;

  -- Weight Proposal 을 Treatment 에 쓰려면 Approved 상태여야 한다(Production Apply 아님 — Snapshot 복사).
  if coalesce(p_payload->>'weight_proposal_id','') <> '' then
    select id, status, proposed_weights into v_prop
    from public.ai_learning_weight_proposals where id = (p_payload->>'weight_proposal_id')::uuid;
    if v_prop.id is null then raise exception 'weight proposal not found' using errcode = 'P0002'; end if;
    if v_prop.status <> 'approved' then
      raise exception 'weight proposal must be approved (got %)', v_prop.status using errcode = '23514';
    end if;
  end if;

  insert into public.ai_recommendation_experiments(
    name, hypothesis, stage, primary_metric, secondary_metrics, guardrail_config,
    control_algorithm_version, treatment_algorithm_version,
    control_weight_version, treatment_weight_version, weight_proposal_id,
    allocation_ratio, seed, assignment_version,
    minimum_exposure, minimum_valid_outcomes, minimum_duration_hours, maximum_duration_hours,
    start_at, end_at, config_snapshot, created_by)
  values (
    p_payload->>'name', coalesce(p_payload->>'hypothesis',''),
    coalesce(nullif(p_payload->>'stage',''), 'event_emission_only'),
    coalesce(nullif(p_payload->>'primary_metric',''), 'valid_completion_rate'),
    coalesce(p_payload->'secondary_metrics', '[]'::jsonb),
    coalesce(p_payload->'guardrail_config', '{}'::jsonb),
    coalesce(nullif(p_payload->>'control_algorithm_version',''), 'recommendation_v1'),
    coalesce(nullif(p_payload->>'treatment_algorithm_version',''), 'rec-v2'),
    coalesce(nullif(p_payload->>'control_weight_version',''), 'v1-production'),
    coalesce(nullif(p_payload->>'treatment_weight_version',''), 'rec-v2-w1'),
    nullif(p_payload->>'weight_proposal_id','')::uuid,
    least(0.9, greatest(0.1, coalesce((p_payload->>'allocation_ratio')::numeric, 0.5))),
    coalesce((p_payload->>'seed')::bigint, 1),
    coalesce(nullif(p_payload->>'assignment_version',''), 'assign-v1'),
    greatest(1, coalesce((p_payload->>'minimum_exposure')::int, 100)),
    greatest(1, coalesce((p_payload->>'minimum_valid_outcomes')::int, 30)),
    greatest(1, coalesce((p_payload->>'minimum_duration_hours')::int, 72)),
    least(2160, greatest(1, coalesce((p_payload->>'maximum_duration_hours')::int, 720))),
    (p_payload->>'start_at')::timestamptz, (p_payload->>'end_at')::timestamptz,
    coalesce(p_payload->'config_snapshot', '{}'::jsonb) || jsonb_build_object(
      'weight_snapshot', coalesce(v_prop.proposed_weights, 'null'::jsonb)),
    auth.uid())
  returning id into v_id;

  insert into public.ai_experiment_events(experiment_id, event_type, actor_id, next_status)
  values (v_id, 'created', auth.uid(), 'draft');

  return public.admin_ai_exp_detail(v_id);
end;
$$;

grant execute on function public.admin_ai_exp_create(jsonb) to authenticated;

create or replace function public.admin_ai_exps(p_status text default null, p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_limit int := greatest(1, least(coalesce(p_limit, 50), 200)); v jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v from (
    select e.id, e.name, e.stage, e.status, e.primary_metric, e.allocation_ratio,
      e.emergency_stop, e.quality_score, e.quality_grade, e.decision,
      e.start_at, e.end_at, e.created_at,
      (select count(*) from public.ai_experiment_assignments a where a.experiment_id = e.id and a.status = 'assigned') as assignment_count,
      (select count(*) from public.ai_experiment_store_allowlist w where w.experiment_id = e.id and w.status = 'active') as allowlist_count,
      (select count(*) from public.ai_experiment_exposures x where x.experiment_id = e.id) as exposure_count,
      u.nickname as created_by_name, a2.nickname as approved_by_name
    from public.ai_recommendation_experiments e
    left join public.users u on u.id = e.created_by
    left join public.users a2 on a2.id = e.approved_by
    where p_status is null or e.status = p_status
    order by e.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v, 'generated_at', now());
end;
$$;

grant execute on function public.admin_ai_exps(text, int) to authenticated;

create or replace function public.admin_ai_exp_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_exp jsonb; v_allow jsonb; v_assign jsonb; v_events jsonb; v_snapshots jsonb; v_rollbacks jsonb;
begin
  perform public._admin_growth_guard();
  select to_jsonb(e) into v_exp from public.ai_recommendation_experiments e where e.id = p_id;
  if v_exp is null then raise exception 'experiment not found: %', p_id using errcode = 'P0002'; end if;

  select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) into v_allow
  from (select * from public.ai_experiment_store_allowlist where experiment_id = p_id order by created_at desc limit 200) w;
  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_assign
  from (select * from public.ai_experiment_assignments where experiment_id = p_id order by assigned_at desc limit 200) a;
  select coalesce(jsonb_agg(to_jsonb(ev) order by ev.created_at desc), '[]'::jsonb) into v_events
  from (select e2.*, u.nickname as actor_name from public.ai_experiment_events e2
        left join public.users u on u.id = e2.actor_id
        where e2.experiment_id = p_id order by e2.created_at desc limit 50) ev;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc), '[]'::jsonb) into v_snapshots
  from (select * from public.ai_experiment_metric_snapshots where experiment_id = p_id order by created_at desc limit 20) s;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) into v_rollbacks
  from (select * from public.ai_experiment_rollback_proposals where experiment_id = p_id order by created_at desc limit 20) r;

  return jsonb_build_object('experiment', v_exp, 'allowlist', v_allow, 'assignments', v_assign,
    'events', v_events, 'snapshots', v_snapshots, 'rollback_proposals', v_rollbacks, 'generated_at', now());
end;
$$;

grant execute on function public.admin_ai_exp_detail(uuid) to authenticated;

create or replace function public.admin_ai_exp_allowlist_set(p_experiment_id uuid, p_store_id uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_action text := coalesce(nullif(p_payload->>'action',''), 'add');
begin
  perform public._admin_growth_guard();
  if not exists (select 1 from public.ai_recommendation_experiments where id = p_experiment_id) then
    raise exception 'experiment not found' using errcode = 'P0002';
  end if;

  if v_action = 'remove' then
    update public.ai_experiment_store_allowlist
    set status = 'removed' where experiment_id = p_experiment_id and store_id = p_store_id;
  else
    insert into public.ai_experiment_store_allowlist(
      experiment_id, store_id, brand_id, allowed_stage, max_exposures, start_at, end_at, approved_by, approval_reason)
    values (
      p_experiment_id, p_store_id, nullif(p_payload->>'brand_id','')::uuid,
      coalesce(nullif(p_payload->>'allowed_stage',''), 'internal_test'),
      (p_payload->>'max_exposures')::int,
      (p_payload->>'start_at')::timestamptz, (p_payload->>'end_at')::timestamptz,
      auth.uid(), nullif(p_payload->>'approval_reason',''))
    on conflict (experiment_id, store_id) do update set
      status = 'active', allowed_stage = excluded.allowed_stage, max_exposures = excluded.max_exposures,
      approved_by = excluded.approved_by, approval_reason = excluded.approval_reason;
  end if;

  insert into public.ai_experiment_events(experiment_id, event_type, actor_id, reason, metadata)
  values (p_experiment_id, 'allowlist_changed', auth.uid(), v_action,
    jsonb_build_object('store_id', p_store_id));
  return public.admin_ai_exp_detail(p_experiment_id);
end;
$$;

grant execute on function public.admin_ai_exp_allowlist_set(uuid, uuid, jsonb) to authenticated;

-- Assignment 생성: Allowlist(active) Store 만 대상. 서버가 Variant 를 계산(sticky upsert 아님 —
-- 기존 행 유지, 신규만 insert). Treatment 는 stage 가 internal_test 이상일 때만 생성된다.
create or replace function public.admin_ai_exp_build_assignments(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare e record; w record; v_variant text; v_built int := 0;
begin
  perform public._admin_growth_guard();
  select * into e from public.ai_recommendation_experiments where id = p_id;
  if e.id is null then raise exception 'experiment not found' using errcode = 'P0002'; end if;
  if e.status not in ('approved','scheduled','running') then
    raise exception 'assignments require approved/scheduled/running (got %)', e.status using errcode = '23514';
  end if;

  for w in select * from public.ai_experiment_store_allowlist
           where experiment_id = p_id and status = 'active'
  loop
    v_variant := public._ai_exp_variant(p_id, w.store_id, e.seed, e.assignment_version, e.allocation_ratio, e.stage);
    -- Stage 게이트: internal_test 미만에서는 실제 treatment 를 만들지 않는다.
    if v_variant = 'treatment' and e.stage in ('event_emission_only','shadow_assignment') then
      v_variant := case when e.stage = 'shadow_assignment' then 'shadow_treatment' else 'control' end;
    end if;
    insert into public.ai_experiment_assignments(
      experiment_id, store_id, variant, assignment_key, assignment_version, reason)
    values (p_id, w.store_id, v_variant,
      md5(p_id::text || w.store_id::text || e.seed::text || e.assignment_version),
      e.assignment_version, 'deterministic')
    on conflict (experiment_id, store_id) do nothing; -- Sticky — 기존 배정 유지.
    v_built := v_built + 1;
  end loop;

  insert into public.ai_experiment_events(experiment_id, event_type, actor_id, metadata)
  values (p_id, 'assignment_built', auth.uid(), jsonb_build_object('processed', v_built));
  return public.admin_ai_exp_detail(p_id);
end;
$$;

grant execute on function public.admin_ai_exp_build_assignments(uuid) to authenticated;

create or replace function public.admin_ai_exp_override_assignment(p_id uuid, p_store_id uuid, p_variant text, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public._admin_growth_guard();
  if p_variant not in ('control','treatment','shadow_treatment') then
    raise exception 'invalid variant' using errcode = '22023';
  end if;
  if coalesce(p_reason,'') = '' then raise exception 'override reason required' using errcode = '22023'; end if;
  update public.ai_experiment_assignments
  set variant = p_variant, status = 'overridden', reason = p_reason
  where experiment_id = p_id and store_id = p_store_id;
  if not found then raise exception 'assignment not found' using errcode = 'P0002'; end if;

  insert into public.ai_experiment_events(experiment_id, event_type, actor_id, reason, metadata)
  values (p_id, 'assignment_overridden', auth.uid(), p_reason,
    jsonb_build_object('store_id', p_store_id, 'variant', p_variant));
  return public.admin_ai_exp_detail(p_id);
end;
$$;

grant execute on function public.admin_ai_exp_override_assignment(uuid, uuid, text, text) to authenticated;

-- 상태 전이: draft→ready_for_review→approved→scheduled→running→paused/stopped/completed→archived.
-- Start(=running) 게이트: 승인 필수 · internal_test 이상은 Allowlist 필수 ·
-- canary 는 internal_test 근거(config_snapshot.internal_test_evidence) 필수.
create or replace function public.admin_ai_exp_set_status(p_id uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare e record; v_allowed boolean;
begin
  perform public._admin_growth_guard();
  select * into e from public.ai_recommendation_experiments where id = p_id;
  if e.id is null then raise exception 'experiment not found' using errcode = 'P0002'; end if;
  if p_status not in ('draft','ready_for_review','approved','scheduled','running','paused','stopped','completed','rejected','archived') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  v_allowed := (e.status = 'draft' and p_status in ('ready_for_review','archived'))
    or (e.status = 'ready_for_review' and p_status in ('approved','rejected','draft','archived'))
    or (e.status = 'approved' and p_status in ('scheduled','running','archived'))
    or (e.status = 'scheduled' and p_status in ('running','archived'))
    or (e.status = 'running' and p_status in ('paused','stopped','completed'))
    or (e.status = 'paused' and p_status in ('running','stopped','completed'))
    or (e.status in ('stopped','completed','rejected') and p_status = 'archived');
  if not v_allowed then
    raise exception 'transition not allowed: % -> %', e.status, p_status using errcode = '22023';
  end if;

  if p_status = 'running' then
    if e.approved_by is null and e.status = 'approved' then
      -- approved 상태 자체가 승인 기록을 요구.
      null;
    end if;
    if e.stage in ('internal_test','canary','limited')
       and not exists (select 1 from public.ai_experiment_store_allowlist
                       where experiment_id = p_id and status = 'active') then
      raise exception 'allowlist required for stage %', e.stage using errcode = '23514';
    end if;
    if e.stage in ('canary','limited') and (e.config_snapshot->'internal_test_evidence') is null then
      raise exception 'canary/limited requires internal_test_evidence in config_snapshot' using errcode = '23514';
    end if;
  end if;
  if p_status = 'approved' then
    update public.ai_recommendation_experiments
    set approved_by = auth.uid(), approved_at = now() where id = p_id;
  end if;
  if p_status = 'rejected' and coalesce(p_reason,'') = '' then
    raise exception 'rejection reason required' using errcode = '22023';
  end if;

  update public.ai_recommendation_experiments set
    status = p_status,
    pause_reason = case when p_status = 'paused' then p_reason else pause_reason end,
    stop_reason = case when p_status = 'stopped' then p_reason else stop_reason end
  where id = p_id;

  insert into public.ai_experiment_events(experiment_id, event_type, actor_id, previous_status, next_status, reason)
  values (p_id, 'status_changed', auth.uid(), e.status, p_status, p_reason);
  return public.admin_ai_exp_detail(p_id);
end;
$$;

grant execute on function public.admin_ai_exp_set_status(uuid, text, text) to authenticated;

-- Emergency Stop: 신규 Treatment 라우팅 중지 신호(Weight Apply 아님). 재생 중 Track 은 건드리지 않는다.
create or replace function public.admin_ai_exp_emergency_stop(p_id uuid, p_enabled boolean, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public._admin_growth_guard();
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode = '22023'; end if;
  update public.ai_recommendation_experiments set emergency_stop = p_enabled where id = p_id;
  if not found then raise exception 'experiment not found' using errcode = 'P0002'; end if;
  insert into public.ai_experiment_events(experiment_id, event_type, actor_id, reason, metadata)
  values (p_id, 'emergency_stop', auth.uid(), p_reason, jsonb_build_object('enabled', p_enabled));
  return public.admin_ai_exp_detail(p_id);
end;
$$;

grant execute on function public.admin_ai_exp_emergency_stop(uuid, boolean, text) to authenticated;

-- Metric Snapshot 기록 — SRM/Blocking Guardrail 위반 시 'valid' 결론 저장 차단.
create or replace function public.admin_ai_exp_record_snapshot(p_id uuid, p_snapshot jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public._admin_growth_guard();
  if not exists (select 1 from public.ai_recommendation_experiments where id = p_id) then
    raise exception 'experiment not found' using errcode = 'P0002';
  end if;
  if length(p_snapshot::text) > 200000 then raise exception 'snapshot too large' using errcode = '22023'; end if;
  if coalesce(p_snapshot->'srm_result'->>'srm_detected', 'false')::boolean
     and coalesce(p_snapshot->>'decision','') in ('continue','promote_candidate') then
    raise exception 'SRM detected — result cannot be recorded as valid continue/promote' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_snapshot->'guardrail_results','[]'::jsonb)) g
    where g->>'status' = 'breach')
     and coalesce(p_snapshot->>'decision','') in ('continue','promote_candidate') then
    raise exception 'blocking guardrail breach — continue/promote decision blocked' using errcode = '23514';
  end if;

  insert into public.ai_experiment_metric_snapshots(
    experiment_id, window_start, window_end, control_metrics, treatment_metrics,
    guardrail_results, srm_result, quality_score, quality_grade, decision, limitations)
  values (
    p_id, (p_snapshot->>'window_start')::timestamptz, (p_snapshot->>'window_end')::timestamptz,
    coalesce(p_snapshot->'control_metrics','{}'::jsonb), coalesce(p_snapshot->'treatment_metrics','{}'::jsonb),
    coalesce(p_snapshot->'guardrail_results','[]'::jsonb), coalesce(p_snapshot->'srm_result','{}'::jsonb),
    (p_snapshot->>'quality_score')::numeric, nullif(p_snapshot->>'quality_grade',''),
    nullif(p_snapshot->>'decision',''), coalesce(p_snapshot->'limitations','[]'::jsonb))
  on conflict (experiment_id, window_start, window_end) do update set
    control_metrics = excluded.control_metrics, treatment_metrics = excluded.treatment_metrics,
    guardrail_results = excluded.guardrail_results, srm_result = excluded.srm_result,
    quality_score = excluded.quality_score, quality_grade = excluded.quality_grade,
    decision = excluded.decision, limitations = excluded.limitations;

  update public.ai_recommendation_experiments set
    quality_score = (p_snapshot->>'quality_score')::numeric,
    quality_grade = nullif(p_snapshot->>'quality_grade',''),
    decision = nullif(p_snapshot->>'decision',''),
    decision_reason = nullif(p_snapshot->>'decision_reason','')
  where id = p_id;

  insert into public.ai_experiment_events(experiment_id, event_type, actor_id, metadata)
  values (p_id, 'snapshot_recorded', auth.uid(),
    jsonb_build_object('decision', p_snapshot->>'decision', 'grade', p_snapshot->>'quality_grade'));
  return public.admin_ai_exp_detail(p_id);
end;
$$;

grant execute on function public.admin_ai_exp_record_snapshot(uuid, jsonb) to authenticated;

create or replace function public.admin_ai_exp_rollback_propose(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_rb uuid;
begin
  perform public._admin_growth_guard();
  if not exists (select 1 from public.ai_recommendation_experiments where id = p_id) then
    raise exception 'experiment not found' using errcode = 'P0002';
  end if;
  insert into public.ai_experiment_rollback_proposals(
    experiment_id, trigger_reason, severity, affected_stores, guardrail_evidence,
    recommended_action, risks, created_by)
  values (
    p_id, coalesce(nullif(p_payload->>'trigger_reason',''), 'manual'),
    coalesce(nullif(p_payload->>'severity',''), 'warning'),
    coalesce(p_payload->'affected_stores','[]'::jsonb),
    coalesce(p_payload->'guardrail_evidence','{}'::jsonb),
    coalesce(nullif(p_payload->>'recommended_action',''), 'pause'),
    coalesce(p_payload->'risks','[]'::jsonb), auth.uid())
  returning id into v_rb;
  insert into public.ai_experiment_events(experiment_id, event_type, actor_id, metadata)
  values (p_id, 'rollback_proposed', auth.uid(), jsonb_build_object('proposal_id', v_rb));
  return public.admin_ai_exp_detail(p_id);
end;
$$;

grant execute on function public.admin_ai_exp_rollback_propose(uuid, jsonb) to authenticated;

create or replace function public.admin_ai_exp_rollback_set_status(p_rollback_id uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare r record;
begin
  perform public._admin_growth_guard();
  select * into r from public.ai_experiment_rollback_proposals where id = p_rollback_id;
  if r.id is null then raise exception 'rollback proposal not found' using errcode = 'P0002'; end if;
  if p_status not in ('ready_for_review','approved','rejected','archived') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_status = 'rejected' and coalesce(p_reason,'') = '' then
    raise exception 'rejection reason required' using errcode = '22023';
  end if;
  update public.ai_experiment_rollback_proposals set
    status = p_status,
    reviewed_by = case when p_status in ('approved','rejected') then auth.uid() else reviewed_by end,
    reviewed_at = case when p_status in ('approved','rejected') then now() else reviewed_at end,
    rejection_reason = case when p_status = 'rejected' then p_reason else rejection_reason end
  where id = p_rollback_id;
  insert into public.ai_experiment_events(experiment_id, event_type, actor_id, reason, metadata)
  values (r.experiment_id, 'note', auth.uid(), p_reason,
    jsonb_build_object('rollback_proposal', p_rollback_id, 'status', p_status,
      'note', 'approved 는 실행 후보 승인 기록 — 자동 Rollback 실행 아님'));
  return public.admin_ai_exp_detail(r.experiment_id);
end;
$$;

grant execute on function public.admin_ai_exp_rollback_set_status(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) Runtime RPC — 비관리자. auth.uid() = store 본인 범위 강제.
--     조회 실패/부재 시 클라이언트는 항상 Control(기존 동작)로 진행한다.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.experiment_runtime_lookup()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_store uuid := auth.uid(); v jsonb;
begin
  if v_store is null then return jsonb_build_object('assignment', null); end if;
  select jsonb_build_object(
    'experiment_id', e.id, 'stage', e.stage, 'status', e.status,
    'variant', a.variant, 'assignment_id', a.id,
    'emergency_stop', e.emergency_stop,
    'algorithm_version', case when a.variant = 'control' then e.control_algorithm_version else e.treatment_algorithm_version end,
    'weight_version', case when a.variant = 'control' then e.control_weight_version else e.treatment_weight_version end)
  into v
  from public.ai_experiment_assignments a
  join public.ai_recommendation_experiments e on e.id = a.experiment_id
  where a.store_id = v_store and a.status in ('assigned','overridden')
    and e.status = 'running'
  order by a.assigned_at desc limit 1;
  return jsonb_build_object('assignment', v);
end;
$$;

grant execute on function public.experiment_runtime_lookup() to authenticated;

-- Exposure 기록(Runtime): store_id 는 auth.uid() 로 강제(위조 불가). Treatment 소스는
-- 실제 treatment Assignment + Allowlist + Running + Emergency Stop 비활성일 때만 허용.
create or replace function public.experiment_record_exposure(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_store uuid := auth.uid();
  v_exp_id uuid := nullif(p_payload->>'experiment_id','')::uuid;
  v_assignment record; v_learn_id uuid; v_variant text := 'control';
  v_is_shadow boolean := false; v_fallback boolean := coalesce((p_payload->>'fallback_to_control')::boolean, false);
  v_key text := p_payload->>'idempotency_key';
begin
  if v_store is null then raise exception 'auth required' using errcode = '42501'; end if;
  if coalesce(v_key,'') = '' then raise exception 'idempotency_key required' using errcode = '22023'; end if;
  if length(p_payload::text) > 30000 then raise exception 'payload too large' using errcode = '22023'; end if;

  if v_exp_id is not null then
    select a.*, e.emergency_stop, e.status as exp_status, e.stage as exp_stage
      into v_assignment
    from public.ai_experiment_assignments a
    join public.ai_recommendation_experiments e on e.id = a.experiment_id
    where a.experiment_id = v_exp_id and a.store_id = v_store and a.status in ('assigned','overridden');
    if v_assignment.id is null then
      v_exp_id := null; -- Assignment 없는 실험 참조는 무시(일반 Store — Control 기록만).
    else
      v_variant := v_assignment.variant;
      v_is_shadow := v_variant = 'shadow_treatment';
      -- Treatment 기록 게이트: Running + Allowlist + Emergency Stop off. 아니면 Control fallback 기록.
      if v_variant = 'treatment' and (
        v_assignment.exp_status <> 'running' or v_assignment.emergency_stop
        or not exists (select 1 from public.ai_experiment_store_allowlist w
          where w.experiment_id = v_exp_id and w.store_id = v_store and w.status = 'active')
      ) then
        v_variant := 'control'; v_fallback := true;
      end if;
    end if;
  end if;

  insert into public.ai_learning_exposures(
    idempotency_key, is_shadow, store_id, session_id, track_id,
    source, algorithm_version, weight_version, recommendation_rank,
    playlist_id, queue_position, daypart, store_type, exposed_at, metadata)
  values (
    v_key, v_is_shadow, v_store, nullif(p_payload->>'session_id',''),
    (p_payload->>'track_id')::uuid,
    coalesce(nullif(p_payload->>'source',''), 'unknown'),
    nullif(p_payload->>'algorithm_version',''), nullif(p_payload->>'weight_version',''),
    (p_payload->>'recommendation_rank')::int,
    nullif(p_payload->>'playlist_id','')::uuid, (p_payload->>'queue_position')::int,
    nullif(p_payload->>'daypart',''), nullif(p_payload->>'store_type',''),
    coalesce((p_payload->>'exposed_at')::timestamptz, now()),
    jsonb_build_object('runtime', true))
  on conflict (idempotency_key) do nothing
  returning id into v_learn_id;

  if v_learn_id is null then
    return jsonb_build_object('duplicate', true);
  end if;

  if v_exp_id is not null then
    insert into public.ai_experiment_exposures(
      experiment_id, assignment_id, learning_exposure_id, variant, is_shadow,
      fallback_to_control, fallback_reason)
    values (v_exp_id, v_assignment.id, v_learn_id, v_variant, v_is_shadow,
      v_fallback, case when v_fallback then coalesce(nullif(p_payload->>'fallback_reason',''), 'gate_check') else null end)
    on conflict (learning_exposure_id) do nothing;
  end if;

  return jsonb_build_object('exposure_id', v_learn_id, 'variant', v_variant, 'fallback', v_fallback, 'duplicate', false);
end;
$$;

grant execute on function public.experiment_record_exposure(jsonb) to authenticated;
