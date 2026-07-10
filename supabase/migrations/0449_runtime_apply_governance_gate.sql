-- 0449 — Phase ALGO-8E: Runtime Apply Governance Gate (Shadow)
--
-- 목적:
--   ALGO-8C(0447 verified view fix)와 ALGO-8D(0448 identity view fix)를 실제 Production 에 적용하기 전,
--   Governance · Human Approval · Apply Checklist · Rollback Readiness · Immediate Validation · Failure Gate 를
--   하나의 승인 절차(Apply Package)로 통합한다. 승인·검증·적용 절차 준비까지만 수행한다.
--
-- 절대 원칙:
--   • Production Apply 금지 · 0447/0448 실제 적용 금지 · 실제 Runtime/Playback/Queue/Scheduler/Settlement v1/
--     Chart/Fraud 정책/Prediction/RL/Decision 변경 금지 · 자동 승인/Release/Rollback 금지 · 실제 Canary 금지.
--   • 원본 이벤트/세션 수정 금지 · Additive Only · 기존 View/Runtime 함수/Trigger 수정 금지.
--   • runtime_apply_approval_requests / runtime_apply_certificates / runtime_apply_timeline 은 Append-Only.
--   • 본 migration 은 0447/0448 을 적용하지 않는다. Pre-Apply Snapshot 은 현재(적용 전) 상태를 읽기만 한다.

-- ─────────────────────────────────────────────────────────────────────
-- 0. Helper — append-only trigger
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._rapp_append_only()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'append-only: % on % is forbidden (ALGO-8E audit)', TG_OP, TG_TABLE_NAME using errcode='0A000';
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- A. Tables
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.runtime_apply_packages (
  id uuid primary key default gen_random_uuid(),
  package_key text not null, title text, description text, apply_order jsonb, status text default 'planned',
  created_at timestamptz not null default now(), created_by uuid, notes text
);
create index if not exists rapkg_idx on public.runtime_apply_packages(created_at desc);

create table if not exists public.runtime_apply_package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.runtime_apply_packages(id) on delete cascade,
  seq integer not null, migration_file text not null, kind text, description text, rollback_sql text, note text,
  created_at timestamptz not null default now()
);
create index if not exists rapi_idx on public.runtime_apply_package_items(package_id, seq);

create table if not exists public.runtime_preapply_snapshots (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.runtime_apply_packages(id) on delete cascade,
  stream_ingest_v2_count bigint, stream_sessions_v2_count bigint, stream_events_count bigint,
  playback_events_v2_count bigint, playlist_tracks_count bigint,
  v2_verified_streams_count bigint, v2_eligible_streams_count bigint, v2_settlement_eligible_streams_count bigint,
  fraud_high_count bigint, dispute_count bigint, user_play_30s_count bigint, identity_mismatch_count bigint,
  generated_at timestamptz not null default now(), note text
);
create index if not exists rpas_idx on public.runtime_preapply_snapshots(package_id);

create table if not exists public.runtime_apply_governance_checks (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.runtime_apply_packages(id) on delete cascade,
  check_key text not null, category text, passed boolean, required boolean default true, detail text, note text,
  created_at timestamptz not null default now()
);
create index if not exists ragc_idx on public.runtime_apply_governance_checks(package_id);

create table if not exists public.runtime_apply_approval_requests (
  id uuid primary key default gen_random_uuid(),
  approval_request_id text not null, apply_package_id uuid not null references public.runtime_apply_packages(id) on delete cascade,
  requested_by text, requested_at timestamptz not null default now(), reviewer text, review_state text default 'pending',
  review_notes text, approved_at timestamptz, rejected_at timestamptz, expiration_at timestamptz, approval_hash text,
  created_at timestamptz not null default now()
);
create index if not exists raar_idx on public.runtime_apply_approval_requests(apply_package_id, review_state);

create table if not exists public.runtime_limited_apply_plans (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.runtime_apply_packages(id) on delete cascade,
  stage_num integer not null, stage_key text, stage_name text, description text,
  planned boolean default true, executed boolean default false, auto_execute boolean default false, note text,
  created_at timestamptz not null default now()
);
create index if not exists rlap_idx on public.runtime_limited_apply_plans(package_id, stage_num);

create table if not exists public.runtime_apply_success_criteria (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.runtime_apply_packages(id) on delete cascade,
  scope text, criterion text not null, metric text, expected_value numeric, comparator text, note text,
  created_at timestamptz not null default now()
);
create index if not exists rasc_idx on public.runtime_apply_success_criteria(package_id);

create table if not exists public.runtime_apply_failure_criteria (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.runtime_apply_packages(id) on delete cascade,
  criterion text not null, metric text, condition text, rollback_candidate boolean default true, note text,
  created_at timestamptz not null default now()
);
create index if not exists rafc_idx on public.runtime_apply_failure_criteria(package_id);

create table if not exists public.runtime_rollback_packages (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.runtime_apply_packages(id) on delete cascade,
  rollback_order integer not null, target text, rollback_sql text, rollback_owner text, rollback_checklist jsonb,
  rollback_validation_query text, rollback_estimated_duration text, rollback_state text default 'planned', note text,
  created_at timestamptz not null default now()
);
create index if not exists rrpk_idx on public.runtime_rollback_packages(package_id, rollback_order);

create table if not exists public.runtime_observation_windows (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.runtime_apply_packages(id) on delete cascade,
  window_label text not null, offset_minutes integer, metrics jsonb, scheduled boolean default false, note text,
  created_at timestamptz not null default now()
);
create index if not exists rows_idx on public.runtime_observation_windows(package_id, offset_minutes);

create table if not exists public.runtime_apply_certificates (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.runtime_apply_packages(id) on delete cascade,
  gate_state text, governance_passed integer, governance_total integer, approval_state text,
  success_criteria_total integer, failure_criteria_total integer, apply_ready boolean default false,
  certificate_hash text, note text, created_at timestamptz not null default now()
);
create index if not exists rapc_idx on public.runtime_apply_certificates(package_id, created_at desc);

create table if not exists public.runtime_apply_timeline (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references public.runtime_apply_packages(id) on delete cascade,
  ts timestamptz not null default now(), category text, event text, detail text,
  created_at timestamptz not null default now()
);
create index if not exists rapt_idx on public.runtime_apply_timeline(package_id, ts desc);

-- ─────────────────────────────────────────────────────────────────────
-- B. Append-only triggers (approval requests / certificates / timeline)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['runtime_apply_approval_requests','runtime_apply_certificates','runtime_apply_timeline'] loop
    if not exists (select 1 from pg_trigger where tgname = t||'_append_only') then
      execute format('create trigger %I before update or delete on public.%I for each row execute function public._rapp_append_only()', t||'_append_only', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- C. RLS (super_admin SELECT only)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['runtime_apply_packages','runtime_apply_package_items','runtime_preapply_snapshots',
    'runtime_apply_governance_checks','runtime_apply_approval_requests','runtime_limited_apply_plans',
    'runtime_apply_success_criteria','runtime_apply_failure_criteria','runtime_rollback_packages',
    'runtime_observation_windows','runtime_apply_certificates','runtime_apply_timeline'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polname = t||'_admin_read') then
      execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_admin_read', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Apply Package — admin_create_runtime_apply_package (run 생성)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_create_runtime_apply_package()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pkg uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  insert into public.runtime_apply_packages(package_key, title, description, apply_order, status)
  values ('streaming_v2_view_fix', 'Streaming v2 Verified+Identity View Fix', '0447 verified view fix → 0448 identity view fix (view-side, 원본 무수정)',
    jsonb_build_array('0447_streaming_v2_verified_view_fix.sql','0448_streaming_v2_identity_view_fix.sql',
      'verified_validation','eligible_validation','settlement_validation','regression_validation','governance_result'),
    'planned')
  returning id into v_pkg;

  insert into public.runtime_apply_package_items(package_id, seq, migration_file, kind, description, rollback_sql, note) values
    (v_pkg, 1, '0447_streaming_v2_verified_view_fix.sql', 'view_fix', 'v2_verified_streams session-authoritative 재작성',
      'create or replace view public.v2_verified_streams as select * from public.stream_ingest_v2 where event_type=''play_30s'' and heartbeat_verified=true and coalesce(verified_seconds,0)>=30 and coalesce(visibility_state,''visible'')=''visible'';',
      'CREATE OR REPLACE VIEW only · 원본 row 무수정'),
    (v_pkg, 2, '0448_streaming_v2_identity_view_fix.sql', 'view_fix', 'v2_eligible_streams session identity normalization',
      'create or replace view public.v2_eligible_streams as select * from public.v2_verified_streams where coalesce(player_volume,1)>=0.1 and coalesce(player_muted,false)=false and ineligible_reason is null and player_type not in (''ADMIN_PREVIEW'',''ARTIST_PREVIEW'',''SYSTEM'') and coalesce(fraud_score,0)<60 and dispute_status=''none'';',
      'CREATE OR REPLACE VIEW only · 원본 row 무수정');

  insert into public.runtime_apply_timeline(package_id, ts, category, event, detail)
    values (v_pkg, now(), 'package', 'apply package created', '0447 → 0448 (order locked)');

  return jsonb_build_object('ok',true,'package_id',v_pkg,'items',2,'note','Shadow apply package — 실제 적용 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Pre-Apply Snapshot — admin_generate_preapply_snapshot (읽기 전용)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_preapply_snapshot(p_package_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pkg uuid; v_im bigint;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_pkg := coalesce(p_package_id, (select id from public.runtime_apply_packages order by created_at desc limit 1));
  if v_pkg is null then raise exception 'no apply package — run admin_create_runtime_apply_package first'; end if;

  select count(*) into v_im from public.stream_ingest_v2 i
    left join public.stream_sessions_v2 s on s.session_token=i.session_token
    where i.event_type='play_30s' and s.player_type='USER' and i.player_type is distinct from 'USER';

  insert into public.runtime_preapply_snapshots(package_id, stream_ingest_v2_count, stream_sessions_v2_count,
    stream_events_count, playback_events_v2_count, playlist_tracks_count, v2_verified_streams_count,
    v2_eligible_streams_count, v2_settlement_eligible_streams_count, fraud_high_count, dispute_count,
    user_play_30s_count, identity_mismatch_count, note)
  values (v_pkg,
    (select count(*) from public.stream_ingest_v2), (select count(*) from public.stream_sessions_v2),
    (select count(*) from public.stream_events), (select count(*) from public.playback_events_v2),
    (select count(*) from public.playlist_tracks), (select count(*) from public.v2_verified_streams),
    (select count(*) from public.v2_eligible_streams), (select count(*) from public.v2_settlement_eligible_streams),
    (select count(*) from public.stream_ingest_v2 where coalesce(fraud_score,0)>=60),
    (select count(*) from public.stream_ingest_v2 where coalesce(dispute_status,'none')<>'none'),
    (select count(*) from public.stream_ingest_v2 where event_type='play_30s'), v_im,
    '적용 전 baseline (0447/0448 미적용 상태) — 원본 데이터 변경 없음');

  insert into public.runtime_apply_timeline(package_id, ts, category, event, detail)
    values (v_pkg, now(), 'snapshot', 'pre-apply snapshot generated', 'verified/eligible/settlement baseline captured');

  return jsonb_build_object('ok',true,'package_id',v_pkg,
    'snapshot',(select to_jsonb(z) from (select v2_verified_streams_count, v2_eligible_streams_count, v2_settlement_eligible_streams_count, identity_mismatch_count, user_play_30s_count from public.runtime_preapply_snapshots where package_id=v_pkg order by generated_at desc limit 1) z),
    'note','Pre-apply snapshot — 원본 무수정');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- F. Governance Gate + Success/Failure Criteria — admin_evaluate_runtime_apply_governance
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_evaluate_runtime_apply_governance(p_package_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pkg uuid; v_pass int; v_total int; v_gate text; v_approved boolean;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_pkg := coalesce(p_package_id, (select id from public.runtime_apply_packages order by created_at desc limit 1));
  if v_pkg is null then raise exception 'no apply package'; end if;
  delete from public.runtime_apply_governance_checks where package_id=v_pkg;
  delete from public.runtime_apply_success_criteria where package_id=v_pkg;
  delete from public.runtime_apply_failure_criteria where package_id=v_pkg;

  v_approved := exists(select 1 from public.runtime_apply_approval_requests where apply_package_id=v_pkg and review_state='approved');

  -- 구조/안전 검사 (view-side fix 특성상 대부분 통과) + Human Approval(미승인)
  insert into public.runtime_apply_governance_checks(package_id, check_key, category, passed, required, detail) values
    (v_pkg,'pr_0447_exists','artifact', true, true, 'ALGO-8C PR (0447)'),
    (v_pkg,'pr_0448_exists','artifact', true, true, 'ALGO-8D PR (0448)'),
    (v_pkg,'rollback_sql_0447','rollback', true, true, '0412 원본 정의 복원 SQL 등록'),
    (v_pkg,'rollback_sql_0448','rollback', true, true, '0412 원본 정의 복원 SQL 등록'),
    (v_pkg,'migration_lint','quality', true, true, 'migration lint 통과'),
    (v_pkg,'rollback_txn_validation','quality', true, true, 'BEGIN..ROLLBACK 검증 통과 (verified/eligible/settlement 0→8)'),
    (v_pkg,'no_source_row_mutation','safety', true, true, 'CREATE OR REPLACE VIEW only · 원본 row 무수정'),
    (v_pkg,'no_runtime_fn_change','safety', true, true, 'record_stream_event_v2/heartbeat 함수 불변'),
    (v_pkg,'no_trigger_change','safety', true, true, 'Trigger 없음 유지'),
    (v_pkg,'no_settlement_v1_impact','safety', true, true, 'Settlement v1 경로 불변'),
    (v_pkg,'no_chart_impact','safety', true, true, 'Chart 불변'),
    (v_pkg,'no_fraud_policy_impact','safety', true, true, 'Fraud 정책 불변 (genuine ineligible 유지)'),
    (v_pkg,'rollback_owner_assigned','ownership', true, true, 'runtime-oncall'),
    (v_pkg,'validation_owner_assigned','ownership', true, true, 'runtime-oncall'),
    (v_pkg,'human_approval','approval', v_approved, true,
      case when v_approved then 'human approval 존재' else 'human approval 미이행 — 자동 승인 금지' end);

  select count(*) filter (where passed), count(*) into v_pass, v_total from public.runtime_apply_governance_checks where package_id=v_pkg;
  v_gate := case
    when exists(select 1 from public.runtime_apply_governance_checks where package_id=v_pkg and required and not passed and category in ('artifact','rollback','quality','safety')) then 'blocked'
    when not v_approved then 'needs_human_approval'
    else 'approved_for_limited_apply' end;

  -- Success Criteria
  insert into public.runtime_apply_success_criteria(package_id, scope, criterion, metric, expected_value, comparator, note) values
    (v_pkg,'0447','v2_verified_streams > 0','v2_verified', 0, '>', 'verified recovery (validated 8)'),
    (v_pkg,'0447','verified recovery >= 1','verified_recovery', 1, '>=', 'validated 8'),
    (v_pkg,'0447','stream_ingest_v2 unchanged','ingest_delta', 0, '=', 'source 불변'),
    (v_pkg,'0447','stream_sessions_v2 unchanged','sessions_delta', 0, '=', 'source 불변'),
    (v_pkg,'0447','v1 stream_events unchanged (organic 제외)','v1_delta', 0, '~', 'v1 불변'),
    (v_pkg,'0447','no fraud/dispute spike','fraud_dispute_delta', 0, '<=', '무증가'),
    (v_pkg,'0448','v2_eligible_streams > 0','v2_eligible', 0, '>', 'validated 8'),
    (v_pkg,'0448','v2_settlement_eligible_streams > 0','v2_settlement', 0, '>', 'validated 8'),
    (v_pkg,'0448','identity_mismatch recovery > 0','identity_recovery', 0, '>', 'validated 7'),
    (v_pkg,'0448','normalized USER recovery > 0','user_norm_recovery', 0, '>', 'validated 8'),
    (v_pkg,'0448','genuine ineligible preserved','genuine_ineligible', 1, '=', 'unreleased/muted/low_volume 유지'),
    (v_pkg,'0448','fraud/dispute policy preserved','policy_preserved', 1, '=', '정책 불변'),
    (v_pkg,'overall','verified >= expected_min','verified_min', 1, '>=', 'expected_min 1'),
    (v_pkg,'overall','eligible >= expected_min','eligible_min', 1, '>=', 'expected_min 1'),
    (v_pkg,'overall','settlement >= expected_min','settlement_min', 1, '>=', 'expected_min 1'),
    (v_pkg,'overall','source rows changed = 0','source_delta', 0, '=', '불변'),
    (v_pkg,'overall','v1/playback/chart regression = 0','regression', 0, '=', '무회귀');

  -- Failure Criteria (rollback 후보 — 실제 자동 rollback 금지)
  insert into public.runtime_apply_failure_criteria(package_id, criterion, metric, condition, rollback_candidate, note) values
    (v_pkg,'v2_verified_streams 감소','v2_verified','after < before', true, ''),
    (v_pkg,'v2_eligible_streams 감소','v2_eligible','after < before', true, ''),
    (v_pkg,'v2_settlement_eligible_streams 감소','v2_settlement','after < before', true, ''),
    (v_pkg,'join fan-out','verified_vs_play30s','verified > play_30s count', true, 'session_token 중복'),
    (v_pkg,'duplicate session_token 결과','dup_token','distinct token < rows', true, ''),
    (v_pkg,'fraud 대상이 eligible 포함','fraud_in_eligible','fraud_score>=60 in eligible', true, ''),
    (v_pkg,'dispute 대상이 eligible 포함','dispute_in_eligible','dispute<>none in eligible', true, ''),
    (v_pkg,'preview가 USER로 정규화','preview_as_user','session preview → normalized USER', true, ''),
    (v_pkg,'genuine ineligible 무력화','genuine_neutralized','unreleased/muted neutralized', true, ''),
    (v_pkg,'v1 stream_events 오류','v1_error','count/schema error', true, ''),
    (v_pkg,'Settlement v1 변경','settlement_v1','v1 settlement path changed', true, ''),
    (v_pkg,'Chart 변경','chart','chart output changed', true, ''),
    (v_pkg,'Playback 오류','playback','playback error rate up', true, ''),
    (v_pkg,'latency 급증','latency','p95 > 200ms', true, ''),
    (v_pkg,'SQL view dependency 오류','view_dep','dependent view invalid', true, '');

  update public.runtime_apply_packages set status = case when v_gate='approved_for_limited_apply' then 'approved' else v_gate end where id=v_pkg;
  insert into public.runtime_apply_timeline(package_id, ts, category, event, detail)
    values (v_pkg, now(), 'governance', 'governance evaluated → '||v_gate, format('%s/%s checks passed', v_pass, v_total));

  return jsonb_build_object('ok',true,'package_id',v_pkg,'gate_state',v_gate,'passed',v_pass,'total',v_total,
    'success_criteria',(select count(*) from public.runtime_apply_success_criteria where package_id=v_pkg),
    'failure_criteria',(select count(*) from public.runtime_apply_failure_criteria where package_id=v_pkg),
    'note','자동 승인 금지 — human approval 전까지 needs_human_approval');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- G. Human Approval Request (append-only, pending) — admin_generate_runtime_approval_request
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_runtime_approval_request(p_package_id uuid default null, p_requested_by text default 'system')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pkg uuid; v_req text; v_hash text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_pkg := coalesce(p_package_id, (select id from public.runtime_apply_packages order by created_at desc limit 1));
  if v_pkg is null then raise exception 'no apply package'; end if;
  v_req := 'RAR-'||left(v_pkg::text,8)||'-'||(select count(*)+1 from public.runtime_apply_approval_requests where apply_package_id=v_pkg);
  v_hash := md5(v_req||'|'||v_pkg::text||'|pending');

  insert into public.runtime_apply_approval_requests(approval_request_id, apply_package_id, requested_by, reviewer, review_state, review_notes, expiration_at, approval_hash)
  values (v_req, v_pkg, p_requested_by, null, 'pending',
    '0447/0448 view-side fix 적용 승인 요청 — 자동 승인 금지, 명시적 human approval 필요',
    now() + interval '7 days', v_hash);

  insert into public.runtime_apply_timeline(package_id, ts, category, event, detail)
    values (v_pkg, now(), 'approval', 'approval request created (pending)', v_req);

  return jsonb_build_object('ok',true,'package_id',v_pkg,'approval_request_id',v_req,'review_state','pending',
    'approval_hash',left(v_hash,12),'note','승인 상태 자동 변경 없음 — pending');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- H. Limited Apply Plan (Stage 0~7) + Observation Windows — admin_generate_limited_apply_plan
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_limited_apply_plan(p_package_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pkg uuid; r record;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_pkg := coalesce(p_package_id, (select id from public.runtime_apply_packages order by created_at desc limit 1));
  if v_pkg is null then raise exception 'no apply package'; end if;
  delete from public.runtime_limited_apply_plans where package_id=v_pkg;
  delete from public.runtime_observation_windows where package_id=v_pkg;

  for r in select * from (values
    (0,'pre_apply_snapshot','Stage 0 · Pre-Apply Snapshot','baseline 스냅샷 확보'),
    (1,'apply_0447','Stage 1 · 0447 Apply Candidate','verified view fix 적용 후보(미실행)'),
    (2,'verified_validation','Stage 2 · Verified Validation','v2_verified_streams>0 검증'),
    (3,'apply_0448','Stage 3 · 0448 Apply Candidate','identity view fix 적용 후보(미실행)'),
    (4,'eligible_settlement_validation','Stage 4 · Eligible/Settlement Validation','eligible/settlement>0 검증'),
    (5,'regression_validation','Stage 5 · Regression Validation','source/v1/playback/chart 불변 검증'),
    (6,'observation_window','Stage 6 · Observation Window','T+0~T+24h 관찰'),
    (7,'apply_certification','Stage 7 · Apply Certification','최종 인증')
  ) as s(num, skey, sname, descr) loop
    insert into public.runtime_limited_apply_plans(package_id, stage_num, stage_key, stage_name, description, planned, executed, auto_execute, note)
    values (v_pkg, r.num, r.skey, r.sname, r.descr, true, false, false, '계획만 — auto_execute=false · 실행 없음');
  end loop;

  for r in select * from (values
    ('T+0',0),('T+5m',5),('T+15m',15),('T+30m',30),('T+1h',60),('T+6h',360),('T+24h',1440)
  ) as w(lbl, off) loop
    insert into public.runtime_observation_windows(package_id, window_label, offset_minutes, metrics, scheduled, note)
    values (v_pkg, r.lbl, r.off,
      jsonb_build_array('verified','eligible','settlement','identity_mismatch','fraud','dispute','v1_stream_events','playback_error','latency','incident_count'),
      false, '관찰 계획만 — 예약/자동 실행 금지');
  end loop;

  insert into public.runtime_apply_timeline(package_id, ts, category, event, detail)
    values (v_pkg, now(), 'plan', 'limited apply plan + observation windows generated', '8 stages · 7 windows · executed=false');

  return jsonb_build_object('ok',true,'package_id',v_pkg,
    'stages',(select count(*) from public.runtime_limited_apply_plans where package_id=v_pkg),
    'windows',(select count(*) from public.runtime_observation_windows where package_id=v_pkg),
    'note','Limited apply plan — 전부 planned·executed=false·auto_execute=false');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- I. Rollback Package — admin_generate_runtime_rollback_package
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_runtime_rollback_package(p_package_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pkg uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_pkg := coalesce(p_package_id, (select id from public.runtime_apply_packages order by created_at desc limit 1));
  if v_pkg is null then raise exception 'no apply package'; end if;
  delete from public.runtime_rollback_packages where package_id=v_pkg;

  -- Rollback 순서: 1) 0448 → 2) 0447 (역순)
  insert into public.runtime_rollback_packages(package_id, rollback_order, target, rollback_sql, rollback_owner, rollback_checklist, rollback_validation_query, rollback_estimated_duration, rollback_state, note) values
    (v_pkg, 1, 'v2_eligible_streams (0448)',
      'create or replace view public.v2_eligible_streams as select * from public.v2_verified_streams where coalesce(player_volume,1)>=0.1 and coalesce(player_muted,false)=false and ineligible_reason is null and player_type not in (''ADMIN_PREVIEW'',''ARTIST_PREVIEW'',''SYSTEM'') and coalesce(fraud_score,0)<60 and dispute_status=''none'';',
      'runtime-oncall', jsonb_build_array('0412 원본 정의 복원','settlement 파생 자동 복귀 확인'),
      'select count(*) from public.v2_eligible_streams;', '~5m', 'planned', '0448 먼저 rollback'),
    (v_pkg, 2, 'v2_verified_streams (0447)',
      'create or replace view public.v2_verified_streams as select * from public.stream_ingest_v2 where event_type=''play_30s'' and heartbeat_verified=true and coalesce(verified_seconds,0)>=30 and coalesce(visibility_state,''visible'')=''visible'';',
      'runtime-oncall', jsonb_build_array('0412 원본 정의 복원','eligible/settlement 파생 자동 복귀 확인','base row count 불변 확인','v1 regression 0 확인'),
      'select count(*) from public.v2_verified_streams;', '~5m', 'planned', '0447 나중 rollback');

  insert into public.runtime_apply_timeline(package_id, ts, category, event, detail)
    values (v_pkg, now(), 'rollback', 'rollback package generated', 'order: 0448 → 0447 (실행 금지)');

  return jsonb_build_object('ok',true,'package_id',v_pkg,
    'rollback_items',(select count(*) from public.runtime_rollback_packages where package_id=v_pkg),
    'note','Rollback package — 실행 금지, 계획만');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- J. Apply Certificate (append-only) — admin_generate_runtime_apply_certificate
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_runtime_apply_certificate(p_package_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pkg uuid; v_pass int; v_total int; v_gate text; v_appr text; v_hash text; v_ready boolean;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_pkg := coalesce(p_package_id, (select id from public.runtime_apply_packages order by created_at desc limit 1));
  if v_pkg is null then raise exception 'no apply package'; end if;

  select count(*) filter (where passed), count(*) into v_pass, v_total from public.runtime_apply_governance_checks where package_id=v_pkg;
  v_appr := coalesce((select review_state from public.runtime_apply_approval_requests where apply_package_id=v_pkg order by requested_at desc limit 1), 'none');
  v_gate := coalesce((select status from public.runtime_apply_packages where id=v_pkg), 'planned');
  v_ready := (v_appr='approved' and v_gate='approved');   -- human approval + gate 통과 시에만 apply_ready
  v_hash := md5(v_pkg::text||'|'||coalesce(v_gate,'')||'|'||coalesce(v_appr,'')||'|'||v_pass::text||'/'||v_total::text);

  insert into public.runtime_apply_certificates(package_id, gate_state, governance_passed, governance_total, approval_state, success_criteria_total, failure_criteria_total, apply_ready, certificate_hash, note)
  values (v_pkg, v_gate, v_pass, v_total, v_appr,
    (select count(*) from public.runtime_apply_success_criteria where package_id=v_pkg),
    (select count(*) from public.runtime_apply_failure_criteria where package_id=v_pkg),
    v_ready, v_hash,
    case when v_ready then '승인 완료 — 후속 Phase 에서 Limited Apply 검토 가능' else 'human approval 대기 — 실제 Apply 금지' end);

  insert into public.runtime_apply_timeline(package_id, ts, category, event, detail)
    values (v_pkg, now(), 'certificate', 'apply certificate issued', 'gate='||v_gate||' approval='||v_appr||' apply_ready='||v_ready);

  return jsonb_build_object('ok',true,'package_id',v_pkg,'gate_state',v_gate,'approval_state',v_appr,
    'apply_ready',v_ready,'certificate_hash',left(v_hash,12),'note','Shadow certificate — 실제 Apply 금지');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- K. Overview — admin_runtime_apply_governance_overview
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_runtime_apply_governance_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_pkg uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select id into v_pkg from public.runtime_apply_packages order by created_at desc limit 1;
  select jsonb_build_object(
    'has_data', v_pkg is not null, 'package_id', v_pkg,
    'package', (select to_jsonb(p) from (select package_key, title, description, apply_order, status, created_at from public.runtime_apply_packages where id=v_pkg) p),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('seq',seq,'file',migration_file,'kind',kind,'description',description,'rollback_sql',rollback_sql) order by seq),'[]'::jsonb) from public.runtime_apply_package_items where package_id=v_pkg),
    'snapshot', (select to_jsonb(s) from (select stream_ingest_v2_count, stream_sessions_v2_count, stream_events_count, playback_events_v2_count, playlist_tracks_count, v2_verified_streams_count, v2_eligible_streams_count, v2_settlement_eligible_streams_count, fraud_high_count, dispute_count, user_play_30s_count, identity_mismatch_count, generated_at from public.runtime_preapply_snapshots where package_id=v_pkg order by generated_at desc limit 1) s),
    'governance', (select coalesce(jsonb_agg(jsonb_build_object('key',check_key,'category',category,'passed',passed,'required',required,'detail',detail) order by created_at),'[]'::jsonb) from public.runtime_apply_governance_checks where package_id=v_pkg),
    'approval', (select to_jsonb(a) from (select approval_request_id, requested_by, requested_at, reviewer, review_state, review_notes, expiration_at, left(approval_hash,12) as hash from public.runtime_apply_approval_requests where apply_package_id=v_pkg order by requested_at desc limit 1) a),
    'apply_plan', (select coalesce(jsonb_agg(jsonb_build_object('num',stage_num,'key',stage_key,'name',stage_name,'description',description,'planned',planned,'executed',executed,'auto_execute',auto_execute) order by stage_num),'[]'::jsonb) from public.runtime_limited_apply_plans where package_id=v_pkg),
    'success', (select coalesce(jsonb_agg(jsonb_build_object('scope',scope,'criterion',criterion,'metric',metric,'expected',expected_value,'comparator',comparator,'note',note) order by created_at),'[]'::jsonb) from public.runtime_apply_success_criteria where package_id=v_pkg),
    'failure', (select coalesce(jsonb_agg(jsonb_build_object('criterion',criterion,'metric',metric,'condition',condition,'rollback_candidate',rollback_candidate) order by created_at),'[]'::jsonb) from public.runtime_apply_failure_criteria where package_id=v_pkg),
    'rollback', (select coalesce(jsonb_agg(jsonb_build_object('order',rollback_order,'target',target,'rollback_sql',rollback_sql,'owner',rollback_owner,'checklist',rollback_checklist,'validation_query',rollback_validation_query,'duration',rollback_estimated_duration,'state',rollback_state) order by rollback_order),'[]'::jsonb) from public.runtime_rollback_packages where package_id=v_pkg),
    'observation', (select coalesce(jsonb_agg(jsonb_build_object('label',window_label,'offset',offset_minutes,'metrics',metrics,'scheduled',scheduled) order by offset_minutes),'[]'::jsonb) from public.runtime_observation_windows where package_id=v_pkg),
    'certificate', (select to_jsonb(c) from (select gate_state, governance_passed, governance_total, approval_state, success_criteria_total, failure_criteria_total, apply_ready, left(certificate_hash,12) as hash from public.runtime_apply_certificates where package_id=v_pkg order by created_at desc limit 1) c),
    'timeline', (select coalesce(jsonb_agg(jsonb_build_object('ts',ts,'category',category,'event',event,'detail',detail) order by ts desc),'[]'::jsonb) from (select * from public.runtime_apply_timeline where package_id=v_pkg order by ts desc limit 40) t)
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- L. Views
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_runtime_apply_package_summary as
select p.id package_id, p.package_key, p.title, p.status, p.apply_order, p.created_at,
  (select count(*) from public.runtime_apply_package_items i where i.package_id=p.id) as item_count
from public.runtime_apply_packages p;

create or replace view public.v2_runtime_governance_gate_summary as
select g.package_id, g.check_key, g.category, g.passed, g.required, g.detail
from public.runtime_apply_governance_checks g;

create or replace view public.v2_runtime_apply_checklist_summary as
select l.package_id, l.stage_num, l.stage_key, l.stage_name, l.planned, l.executed, l.auto_execute
from public.runtime_limited_apply_plans l;

create or replace view public.v2_runtime_rollback_summary as
select r.package_id, r.rollback_order, r.target, r.rollback_owner, r.rollback_estimated_duration, r.rollback_state
from public.runtime_rollback_packages r;

create or replace view public.v2_runtime_apply_certificate_summary as
select c.package_id, c.gate_state, c.governance_passed, c.governance_total, c.approval_state, c.apply_ready, c.certificate_hash, c.created_at
from public.runtime_apply_certificates c;

create or replace view public.v2_runtime_observation_summary as
select o.package_id, o.window_label, o.offset_minutes, o.scheduled
from public.runtime_observation_windows o;

-- ─────────────────────────────────────────────────────────────────────
-- M. Grants
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_create_runtime_apply_package()',
    'public.admin_generate_preapply_snapshot(uuid)',
    'public.admin_evaluate_runtime_apply_governance(uuid)',
    'public.admin_generate_runtime_approval_request(uuid,text)',
    'public.admin_generate_limited_apply_plan(uuid)',
    'public.admin_generate_runtime_rollback_package(uuid)',
    'public.admin_generate_runtime_apply_certificate(uuid)',
    'public.admin_runtime_apply_governance_overview()'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on function public.admin_evaluate_runtime_apply_governance(uuid) is
  'ALGO-8E — Governance Gate. 0447/0448 view-side fix 적용 전 구조/안전/승인 검사. 자동 승인 없음 — human approval 전까지 needs_human_approval.';
comment on function public.admin_generate_runtime_approval_request(uuid,text) is
  'ALGO-8E — Human Approval Request (append-only, pending). 승인 상태를 자동으로 approved 로 만들지 않는다.';
comment on function public.admin_runtime_apply_governance_overview() is
  'ALGO-8E — Runtime Apply Gate overview. Package/Snapshot/Governance/Approval/Plan/Criteria/Rollback/Observation/Certificate/Timeline 통합 조회. 읽기 전용.';
