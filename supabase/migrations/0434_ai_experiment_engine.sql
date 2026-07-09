-- 0434 — Phase ALGO-5A: AI Experiment Engine & Model Registry (MLOps, Shadow)
--
-- 목적:
--   ALGO-4A~4C Shadow AI 스택(exposure/learning/prediction/calibration/queue/counterfactual)
--   모델을 버전 관리하고, Champion/Challenger Shadow A/B 로 비교·후보 판정하는 MLOps 레이어.
--   운영에 바로 반영하지 않고 버전관리 → Shadow 실험 → 후보 판정 → 승인 대기 구조만 만든다.
--
-- 절대 원칙:
--   • 실제 Queue/Playback/Scheduler/Exposure/Prediction/Calibration/Settlement/Streaming/Fraud
--     /Runtime 무변경. Production apply 금지. additive only. 기존 ALGO-4 결과 불변.
--   • traffic_split 은 실제 트래픽 분배가 아니라 Shadow 계산 비율. 자동 승격/적용 없음(상태 표시만).
--
-- 자족적: 모델 버전은 metric 스냅샷(jsonb)을 기록하며, 실험은 기록된 metric 을 비교한다
--   (기저 ALGO-4 테이블 유무와 무관하게 동작). created_from_run_id 는 출처 참조용.

-- ─────────────────────────────────────────────────────────────────────
-- A. Model Registry
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_model_registry (
  id uuid primary key default gen_random_uuid(),
  model_key text not null unique,          -- exposure_model / prediction_model / ...
  model_type text not null,
  display_name text,
  description text,
  created_by uuid, created_at timestamptz not null default now()
);

create table if not exists public.ai_model_versions (
  id uuid primary key default gen_random_uuid(),
  model_key text not null references public.ai_model_registry(model_key) on delete cascade,
  version integer not null,
  status text not null default 'draft',    -- draft/champion/challenger/candidate/archived
  parameters jsonb,
  metrics jsonb,                           -- 기록된 metric 스냅샷
  parent_version integer,
  created_from_run_id uuid,
  notes text,
  created_by uuid, created_at timestamptz not null default now(),
  promoted_at timestamptz, archived_at timestamptz
);
create unique index if not exists amv_key_version_uidx on public.ai_model_versions(model_key, version);
create index if not exists amv_status_idx on public.ai_model_versions(model_key, status);

create table if not exists public.ai_model_parameters (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references public.ai_model_versions(id) on delete cascade,
  param_key text not null, param_value text, param_type text,
  created_at timestamptz not null default now()
);
create index if not exists amp_version_idx on public.ai_model_parameters(model_version_id);

create table if not exists public.ai_model_lineage (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references public.ai_model_versions(id) on delete cascade,
  parent_version_id uuid,
  relation text default 'derived_from',
  created_at timestamptz not null default now()
);
create index if not exists aml_version_idx on public.ai_model_lineage(model_version_id);

-- ─────────────────────────────────────────────────────────────────────
-- B. Experiment Engine
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_experiments (
  id uuid primary key default gen_random_uuid(),
  experiment_key text not null unique,
  name text, model_type text,
  status text not null default 'draft',    -- draft/running/completed/candidate/blocked
  champion_version_id uuid references public.ai_model_versions(id),
  challenger_version_id uuid references public.ai_model_versions(id),
  traffic_split_shadow numeric not null default 0.5,   -- Shadow 계산 비율(실 트래픽 아님)
  evaluation_window_days integer default 14,
  min_sample_size integer default 30,
  promotion_state text,                    -- ready_for_review/.../blocked_by_risk/insufficient_data
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz
);

create table if not exists public.ai_experiment_variants (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.ai_experiments(id) on delete cascade,
  variant_role text not null,              -- champion/challenger/control/treatment
  model_version_id uuid references public.ai_model_versions(id),
  allocation numeric default 0.5,
  metrics jsonb,
  created_at timestamptz not null default now()
);
create index if not exists aev_exp_idx on public.ai_experiment_variants(experiment_id);

create table if not exists public.ai_experiment_runs (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.ai_experiments(id) on delete cascade,
  run_at timestamptz not null default now(), run_by uuid,
  sample_size integer, winner_role text, notes text
);
create index if not exists aer_exp_idx on public.ai_experiment_runs(experiment_id, run_at desc);

create table if not exists public.ai_experiment_results (
  id uuid primary key default gen_random_uuid(),
  experiment_run_id uuid not null references public.ai_experiment_runs(id) on delete cascade,
  variant_role text not null, metrics jsonb, created_at timestamptz not null default now()
);
create index if not exists aeres_run_idx on public.ai_experiment_results(experiment_run_id);

create table if not exists public.ai_experiment_metrics (
  id uuid primary key default gen_random_uuid(),
  experiment_run_id uuid not null references public.ai_experiment_runs(id) on delete cascade,
  metric_key text not null, direction text,
  champion_value numeric, challenger_value numeric, delta numeric, better_variant text,
  created_at timestamptz not null default now()
);
create index if not exists aem_run_idx on public.ai_experiment_metrics(experiment_run_id);

-- ─────────────────────────────────────────────────────────────────────
-- C. Rollback Plans + Audit
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_model_rollback_plans (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid, from_model_version_id uuid, to_model_version_id uuid,
  rollback_reason text, rollback_steps jsonb, safety_checks jsonb,
  created_by uuid, created_at timestamptz not null default now()
);

create table if not exists public.ai_experiment_audit_logs (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid, action text not null, actor uuid,
  before_state jsonb, after_state jsonb, metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists aeal_exp_idx on public.ai_experiment_audit_logs(experiment_id, created_at desc);

do $$ declare t text;
begin
  foreach t in array array['ai_model_registry','ai_model_versions','ai_model_parameters','ai_model_lineage',
    'ai_experiments','ai_experiment_variants','ai_experiment_runs','ai_experiment_results','ai_experiment_metrics',
    'ai_model_rollback_plans','ai_experiment_audit_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polname = t||'_admin_read') then
      execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_admin_read', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Metric direction helper (higher/lower is better)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._ai_metric_direction(p_metric text)
returns text language sql immutable set search_path to 'public' as $$
  select case p_metric
    when 'expected_skip' then 'lower'
    when 'risk_score' then 'lower'
    else 'higher' end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Register model version (registry upsert + params + lineage + audit)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_register_ai_model(
  p_model_key text, p_model_type text, p_version integer, p_status text default 'draft',
  p_parameters jsonb default '{}'::jsonb, p_metrics jsonb default '{}'::jsonb,
  p_parent_version integer default null, p_created_from_run_id uuid default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_vid uuid; v_parent uuid; k text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  insert into public.ai_model_registry(model_key, model_type, display_name, created_by)
    values (p_model_key, p_model_type, initcap(replace(p_model_key,'_',' ')), auth.uid())
    on conflict (model_key) do update set model_type=excluded.model_type;

  insert into public.ai_model_versions(model_key, version, status, parameters, metrics, parent_version, created_from_run_id, notes, created_by,
    promoted_at)
  values (p_model_key, p_version, coalesce(p_status,'draft'), coalesce(p_parameters,'{}'::jsonb), coalesce(p_metrics,'{}'::jsonb),
    p_parent_version, p_created_from_run_id, p_notes, auth.uid(),
    case when p_status in ('champion','challenger','candidate') then now() else null end)
  on conflict (model_key, version) do update set status=excluded.status, parameters=excluded.parameters, metrics=excluded.metrics, notes=excluded.notes
  returning id into v_vid;

  -- params 정규화
  delete from public.ai_model_parameters where model_version_id=v_vid;
  for k in select jsonb_object_keys(coalesce(p_parameters,'{}'::jsonb)) loop
    insert into public.ai_model_parameters(model_version_id, param_key, param_value, param_type)
    values (v_vid, k, (p_parameters->>k), jsonb_typeof(p_parameters->k));
  end loop;

  -- lineage
  if p_parent_version is not null then
    select id into v_parent from public.ai_model_versions where model_key=p_model_key and version=p_parent_version;
    if v_parent is not null and not exists(select 1 from public.ai_model_lineage where model_version_id=v_vid and parent_version_id=v_parent) then
      insert into public.ai_model_lineage(model_version_id, parent_version_id, relation) values (v_vid, v_parent, 'derived_from');
    end if;
  end if;

  insert into public.ai_experiment_audit_logs(action, actor, after_state, metadata)
  values ('register_model', auth.uid(), jsonb_build_object('model_key',p_model_key,'version',p_version,'status',p_status), jsonb_build_object('metrics',p_metrics));

  return jsonb_build_object('ok',true,'model_version_id',v_vid,'model_key',p_model_key,'version',p_version,'status',p_status);
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- F. Create experiment (champion vs challenger)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_create_ai_experiment(
  p_experiment_key text, p_name text, p_model_type text,
  p_champion_version_id uuid, p_challenger_version_id uuid,
  p_traffic_split numeric default 0.5, p_eval_window integer default 14, p_min_sample integer default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_exp uuid; v_cm jsonb; v_ch jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select metrics into v_cm from public.ai_model_versions where id=p_champion_version_id;
  select metrics into v_ch from public.ai_model_versions where id=p_challenger_version_id;

  insert into public.ai_experiments(experiment_key, name, model_type, status, champion_version_id, challenger_version_id,
    traffic_split_shadow, evaluation_window_days, min_sample_size, created_by)
  values (p_experiment_key, p_name, p_model_type, 'draft', p_champion_version_id, p_challenger_version_id,
    coalesce(p_traffic_split,0.5), coalesce(p_eval_window,14), coalesce(p_min_sample,30), auth.uid())
  on conflict (experiment_key) do update set name=excluded.name, champion_version_id=excluded.champion_version_id,
    challenger_version_id=excluded.challenger_version_id, updated_at=now()
  returning id into v_exp;

  delete from public.ai_experiment_variants where experiment_id=v_exp;
  insert into public.ai_experiment_variants(experiment_id, variant_role, model_version_id, allocation, metrics)
  values (v_exp, 'champion', p_champion_version_id, coalesce(p_traffic_split,0.5), v_cm),
         (v_exp, 'challenger', p_challenger_version_id, 1-coalesce(p_traffic_split,0.5), v_ch);

  insert into public.ai_experiment_audit_logs(experiment_id, action, actor, after_state)
  values (v_exp, 'create_experiment', auth.uid(), jsonb_build_object('experiment_key',p_experiment_key,'champion',p_champion_version_id,'challenger',p_challenger_version_id));

  return jsonb_build_object('ok',true,'experiment_id',v_exp,'experiment_key',p_experiment_key);
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- G. Run experiment (Shadow A/B evaluation → results + per-metric compare)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_run_ai_experiment(p_experiment_id uuid, p_sample_size integer default 100)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; v_cm jsonb; v_ch jsonb; v_winner text; v_ch_wins int; v_cm_wins int;
  v_metrics text[] := array['prediction_accuracy','calibration_score','expected_completion','expected_skip',
    'expected_revenue','queue_overlap','ndcg','mrr','diversity_score','freshness_score','stability_score','risk_score'];
  mk text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select metrics into v_cm from public.ai_experiment_variants where experiment_id=p_experiment_id and variant_role='champion';
  select metrics into v_ch from public.ai_experiment_variants where experiment_id=p_experiment_id and variant_role='challenger';
  if v_cm is null or v_ch is null then raise exception 'experiment variants not set'; end if;

  insert into public.ai_experiment_runs(experiment_id, run_by, sample_size) values (p_experiment_id, auth.uid(), coalesce(p_sample_size,100)) returning id into v_run;

  insert into public.ai_experiment_results(experiment_run_id, variant_role, metrics)
  values (v_run, 'champion', v_cm), (v_run, 'challenger', v_ch);

  v_ch_wins := 0; v_cm_wins := 0;
  foreach mk in array v_metrics loop
    declare cv numeric := (v_cm->>mk)::numeric; hv numeric := (v_ch->>mk)::numeric; dir text := public._ai_metric_direction(mk); bv text;
    begin
      if cv is null and hv is null then continue; end if;
      bv := case
        when dir='higher' then case when coalesce(hv,-1) > coalesce(cv,-1) then 'challenger' when coalesce(cv,-1) > coalesce(hv,-1) then 'champion' else 'tie' end
        else case when coalesce(hv,2) < coalesce(cv,2) then 'challenger' when coalesce(cv,2) < coalesce(hv,2) then 'champion' else 'tie' end end;
      if bv='challenger' then v_ch_wins:=v_ch_wins+1; elsif bv='champion' then v_cm_wins:=v_cm_wins+1; end if;
      insert into public.ai_experiment_metrics(experiment_run_id, metric_key, direction, champion_value, challenger_value, delta, better_variant)
      values (v_run, mk, dir, cv, hv, round(coalesce(hv,0)-coalesce(cv,0),6), bv);
    end;
  end loop;

  v_winner := case when v_ch_wins > v_cm_wins then 'challenger' when v_cm_wins > v_ch_wins then 'champion' else 'tie' end;
  update public.ai_experiment_runs set winner_role=v_winner where id=v_run;
  update public.ai_experiments set status='completed', updated_at=now() where id=p_experiment_id;

  insert into public.ai_experiment_audit_logs(experiment_id, action, actor, after_state)
  values (p_experiment_id, 'run_experiment', auth.uid(), jsonb_build_object('run_id',v_run,'winner',v_winner,'challenger_wins',v_ch_wins,'champion_wins',v_cm_wins));

  return jsonb_build_object('ok',true,'experiment_run_id',v_run,'winner',v_winner,'challenger_wins',v_ch_wins,'champion_wins',v_cm_wins);
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- H. Compare experiment (latest run metric table)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_compare_ai_experiment(p_experiment_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_run uuid; v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select id into v_run from public.ai_experiment_runs where experiment_id=p_experiment_id order by run_at desc limit 1;
  if v_run is null then return jsonb_build_object('has_data', false); end if;
  select jsonb_build_object('has_data', true, 'experiment_run_id', v_run,
    'winner', (select winner_role from public.ai_experiment_runs where id=v_run),
    'metrics', (select coalesce(jsonb_agg(jsonb_build_object('metric',metric_key,'direction',direction,'champion',champion_value,'challenger',challenger_value,'delta',delta,'better',better_variant) order by metric_key),'[]'::jsonb)
      from public.ai_experiment_metrics where experiment_run_id=v_run)) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- I. Promotion Gate + Rollback plan (상태 판정만, 자동 적용 없음)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_mark_experiment_candidate(p_experiment_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  e public.ai_experiments%rowtype; v_run uuid; v_cm jsonb; v_ch jsonb; v_sample int;
  cal_ok boolean; skip_ok boolean; compl_ok boolean; risk_ok boolean; sample_ok boolean;
  v_state text; v_rollback uuid; v_before text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select * into e from public.ai_experiments where id=p_experiment_id;
  if e.id is null then raise exception 'experiment not found'; end if;
  v_before := e.promotion_state;
  select id, sample_size into v_run, v_sample from public.ai_experiment_runs where experiment_id=p_experiment_id order by run_at desc limit 1;
  if v_run is null then raise exception 'run experiment first'; end if;
  select metrics into v_cm from public.ai_experiment_variants where experiment_id=p_experiment_id and variant_role='champion';
  select metrics into v_ch from public.ai_experiment_variants where experiment_id=p_experiment_id and variant_role='challenger';

  cal_ok   := (v_ch->>'calibration_score')::numeric  >= (v_cm->>'calibration_score')::numeric + 0.03;
  skip_ok  := (v_ch->>'expected_skip')::numeric      <= (v_cm->>'expected_skip')::numeric - 0.05;
  compl_ok := (v_ch->>'expected_completion')::numeric >= (v_cm->>'expected_completion')::numeric + 0.03;
  risk_ok  := coalesce((v_ch->>'risk_score')::numeric, 1) <= 0.2;
  sample_ok := coalesce(v_sample,0) >= coalesce(e.min_sample_size,30);

  v_state := case
    when not sample_ok then 'insufficient_data'
    when not risk_ok then 'blocked_by_risk'
    when cal_ok and skip_ok and compl_ok and risk_ok then 'ready_for_promotion'
    when (cal_ok::int + skip_ok::int + compl_ok::int) >= 2 then 'ready_for_shadow_expansion'
    else 'ready_for_review' end;

  update public.ai_experiments set promotion_state=v_state,
    status = case when v_state in ('ready_for_promotion','ready_for_shadow_expansion') then 'candidate' when v_state='blocked_by_risk' then 'blocked' else status end,
    updated_at=now() where id=p_experiment_id;

  -- Rollback plan 자동 생성 (candidate 시)
  if v_state in ('ready_for_promotion','ready_for_shadow_expansion') then
    insert into public.ai_model_rollback_plans(experiment_id, from_model_version_id, to_model_version_id, rollback_reason, rollback_steps, safety_checks, created_by)
    values (p_experiment_id, e.challenger_version_id, e.champion_version_id, 'challenger 승격 실패/이상 시 champion 복귀(shadow)',
      jsonb_build_array('challenger version archived_at 설정','champion status=champion 복원','experiment status=blocked'),
      jsonb_build_object('calibration_ge', cal_ok, 'skip_le', skip_ok, 'completion_ge', compl_ok, 'risk_le', risk_ok, 'sample_ok', sample_ok), auth.uid())
    returning id into v_rollback;
  end if;

  insert into public.ai_experiment_audit_logs(experiment_id, action, actor, before_state, after_state, metadata)
  values (p_experiment_id, 'mark_candidate', auth.uid(), jsonb_build_object('promotion_state',v_before),
    jsonb_build_object('promotion_state',v_state), jsonb_build_object('gate', jsonb_build_object('cal',cal_ok,'skip',skip_ok,'compl',compl_ok,'risk',risk_ok,'sample',sample_ok),'rollback_plan',v_rollback));

  return jsonb_build_object('ok',true,'experiment_id',p_experiment_id,'promotion_state',v_state,
    'gate', jsonb_build_object('calibration_ge_champion+0.03',cal_ok,'skip_le_champion-0.05',skip_ok,'completion_ge_champion+0.03',compl_ok,'risk_le_0.2',risk_ok,'sample_ok',sample_ok),
    'rollback_plan_id', v_rollback, 'note','상태 판정만 — 자동 승격/적용 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- J. Overview
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_experiment_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select jsonb_build_object('has_data', exists(select 1 from public.ai_experiments),
    'models', (select coalesce(jsonb_agg(jsonb_build_object('model_key',r.model_key,'model_type',r.model_type,'versions',
        (select count(*) from public.ai_model_versions v where v.model_key=r.model_key),
        'champion',(select version from public.ai_model_versions v where v.model_key=r.model_key and v.status='champion' order by version desc limit 1)) order by r.model_key),'[]'::jsonb) from public.ai_model_registry r),
    'experiments', (select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'key',e.experiment_key,'name',e.name,'status',e.status,'promotion_state',e.promotion_state,
        'champion_v',(select version from public.ai_model_versions where id=e.champion_version_id),
        'challenger_v',(select version from public.ai_model_versions where id=e.challenger_version_id),
        'winner',(select winner_role from public.ai_experiment_runs where experiment_id=e.id order by run_at desc limit 1)) order by e.created_at desc),'[]'::jsonb) from public.ai_experiments e),
    'candidates', (select coalesce(jsonb_agg(jsonb_build_object('key',experiment_key,'promotion_state',promotion_state) order by updated_at desc),'[]'::jsonb) from public.ai_experiments where promotion_state in ('ready_for_promotion','ready_for_shadow_expansion','ready_for_review')),
    'rollback_plans', (select count(*) from public.ai_model_rollback_plans),
    'recent_audit', (select coalesce(jsonb_agg(jsonb_build_object('action',action,'at',created_at,'meta',metadata) order by created_at desc),'[]'::jsonb) from (select * from public.ai_experiment_audit_logs order by created_at desc limit 15) a)
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- K. Views
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_ai_model_registry_summary as
select r.model_key, r.model_type, r.display_name,
  (select count(*) from public.ai_model_versions v where v.model_key=r.model_key) as version_count,
  (select max(version) from public.ai_model_versions v where v.model_key=r.model_key) as latest_version,
  (select version from public.ai_model_versions v where v.model_key=r.model_key and v.status='champion' order by version desc limit 1) as champion_version
from public.ai_model_registry r;

create or replace view public.v2_ai_experiment_summary as
select e.id, e.experiment_key, e.name, e.model_type, e.status, e.promotion_state, e.traffic_split_shadow,
  e.min_sample_size, e.created_at,
  (select winner_role from public.ai_experiment_runs r where r.experiment_id=e.id order by run_at desc limit 1) as latest_winner
from public.ai_experiments e;

create or replace view public.v2_ai_experiment_result_summary as
select m.experiment_run_id, r.experiment_id, m.metric_key, m.direction, m.champion_value, m.challenger_value, m.delta, m.better_variant
from public.ai_experiment_metrics m join public.ai_experiment_runs r on r.id=m.experiment_run_id;

create or replace view public.v2_ai_promotion_candidate_summary as
select e.id, e.experiment_key, e.name, e.promotion_state, e.status, e.updated_at,
  (select count(*) from public.ai_model_rollback_plans p where p.experiment_id=e.id) as rollback_plan_count
from public.ai_experiments e where e.promotion_state is not null;

-- ─────────────────────────────────────────────────────────────────────
-- L. 권한
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._ai_metric_direction(text)',
    'public.admin_register_ai_model(text,text,integer,text,jsonb,jsonb,integer,uuid,text)',
    'public.admin_create_ai_experiment(text,text,text,uuid,uuid,numeric,integer,integer)',
    'public.admin_run_ai_experiment(uuid,integer)',
    'public.admin_compare_ai_experiment(uuid)',
    'public.admin_mark_experiment_candidate(uuid)',
    'public.admin_ai_experiment_overview()'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on table public.ai_model_versions is
  'ALGO-5A — AI Model Registry(version+status+metrics 스냅샷). Shadow MLOps. 운영 미반영.';
comment on function public.admin_mark_experiment_candidate(uuid) is
  'ALGO-5A — Promotion Gate 판정(상태만). 자동 승격/적용 없음. rollback plan 자동 기록.';
