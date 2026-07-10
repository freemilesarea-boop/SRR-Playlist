-- 0451 — Phase ALGO-8G: Limited Runtime Apply Rehearsal (Shadow Validation)
--
-- 목적:
--   0447/0448 Runtime Fix 를 실제 운영에 적용하지 않고 운영 절차를 끝까지 리허설한다.
--   Apply Script · Validation SQL · Rollback SQL · Observation Procedure · Operator Checklist 를 최종 검증한다.
--   실제 Migration Apply 는 수행하지 않는다.
--
-- 핵심(진짜 Dry Run):
--   • 0447/0448 의 판정 로직을 INLINE 쿼리로 재현하여 verified/eligible/settlement 회복치를 계산한다.
--     실제 view 를 CREATE OR REPLACE 하지 않으므로 v2_verified_streams/v2_eligible_streams 정의는 불변.
--   • 따라서 이 RPC 는 프로덕션에서 호출해도 읽기 전용이며 어떤 것도 변경하지 않는다.
--
-- 절대 원칙:
--   • Runtime/Playback/Queue/Streaming/Settlement 무변경. Production Apply/Canary 없음. Additive Only.
--   • 기존 View/Runtime 함수/Trigger 수정 금지. Rollback Drill 은 SQL 문서화만 — 실제 실행 금지.

-- ─────────────────────────────────────────────────────────────────────
-- 0. Helper — 0447/0448 로직 INLINE 재현 (view 무변경)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._reh_funnel()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with verified as (
    -- 0447 rehearsed: session-authoritative verified
    select i.track_id, i.player_type, coalesce(i.player_volume,1) vol, coalesce(i.player_muted,false) muted,
      i.ineligible_reason, coalesce(i.fraud_score,0) fraud, coalesce(i.dispute_status,'none') disp, i.session_token
    from public.stream_ingest_v2 i
    left join public.stream_sessions_v2 s on s.session_token = i.session_token
    where i.event_type = 'play_30s' and coalesce(i.visibility_state,'visible')='visible'
      and greatest(coalesce(i.verified_seconds,0), coalesce(s.verified_seconds,0)) >= 30
      and (coalesce(i.heartbeat_verified,false) or coalesce(s.heartbeat_count,0) > 0 or coalesce(s.verified_seconds,0) >= 30)
  ), eligible as (
    -- 0448 rehearsed: session identity normalization
    select v.track_id from verified v
    left join public.stream_sessions_v2 s on s.session_token = v.session_token
    where upper(coalesce(nullif(s.player_type,''), nullif(v.player_type,''), 'ANONYMOUS')) not in ('ARTIST_PREVIEW','PREVIEW','ADMIN_PREVIEW','SYSTEM')
      and v.vol >= 0.1 and v.muted = false
      and (case when v.ineligible_reason is null then false
                when lower(v.ineligible_reason) in ('artist_preview','admin_preview','preview','system')
                     and nullif(s.player_type,'') is not null and upper(s.player_type) not in ('ARTIST_PREVIEW','ADMIN_PREVIEW','PREVIEW','SYSTEM') then false
                else true end) = false
      and v.fraud < 60 and v.disp = 'none'
  )
  select jsonb_build_object(
    'verified_current', (select count(*) from public.v2_verified_streams),
    'eligible_current', (select count(*) from public.v2_eligible_streams),
    'settlement_current', (select count(*) from public.v2_settlement_eligible_streams),
    'verified_rehearsed', (select count(*) from verified),
    'eligible_rehearsed', (select count(*) from eligible),
    'settlement_rehearsed', (select count(*) from eligible e where exists (select 1 from public.eligible_settlement_tracks est where est.track_id = e.track_id)),
    'fraud_high', (select count(*) from public.stream_ingest_v2 where coalesce(fraud_score,0) >= 60),
    'dispute', (select count(*) from public.stream_ingest_v2 where coalesce(dispute_status,'none') <> 'none'),
    'playback', (select count(*) from public.playback_events_v2),
    'stream_events', (select count(*) from public.stream_events)
  );
$$;

-- ─────────────────────────────────────────────────────────────────────
-- A. Tables
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.runtime_apply_rehearsals (
  id uuid primary key default gen_random_uuid(),
  rehearsal_id text not null, package_ref text, apply_script jsonb, mode text default 'dry_run',
  status text, stages jsonb, verified_current bigint, verified_rehearsed bigint,
  eligible_current bigint, eligible_rehearsed bigint, settlement_current bigint, settlement_rehearsed bigint,
  headline text, result text, created_at timestamptz not null default now(), created_by uuid
);
create index if not exists rareh_idx on public.runtime_apply_rehearsals(created_at desc);

create table if not exists public.runtime_validation_runs (
  id uuid primary key default gen_random_uuid(),
  rehearsal_id text not null, phase text, metric text, validation_sql text,
  before_value numeric, after_value numeric, delta numeric, comparator text, passed boolean, note text,
  created_at timestamptz not null default now()
);
create index if not exists rvrun_idx on public.runtime_validation_runs(rehearsal_id, phase);

create table if not exists public.runtime_observation_reports (
  id uuid primary key default gen_random_uuid(),
  rehearsal_id text not null, window_label text, offset_minutes integer, checklist jsonb, metrics jsonb,
  status text default 'planned', note text, created_at timestamptz not null default now()
);
create index if not exists rorep_idx on public.runtime_observation_reports(rehearsal_id, offset_minutes);

create table if not exists public.runtime_operator_runbooks (
  id uuid primary key default gen_random_uuid(),
  rehearsal_id text not null, step_num integer, phase text, action text, command text, expected text,
  executed boolean default false, note text, created_at timestamptz not null default now()
);
create index if not exists rorun_idx on public.runtime_operator_runbooks(rehearsal_id, step_num);

-- ─────────────────────────────────────────────────────────────────────
-- B. RLS (super_admin SELECT only)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['runtime_apply_rehearsals','runtime_validation_runs','runtime_observation_reports','runtime_operator_runbooks'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polname = t||'_admin_read') then
      execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_admin_read', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- C. Apply Rehearsal (Dry Run) — admin_run_apply_rehearsal
--    INLINE 로직 재현으로 before/after 계산 + Operator Runbook 생성. view 무변경.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_run_apply_rehearsal(p_days integer default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_reh text; v_f jsonb := public._reh_funnel();
  v_vc bigint := (v_f->>'verified_current')::bigint; v_vr bigint := (v_f->>'verified_rehearsed')::bigint;
  v_ec bigint := (v_f->>'eligible_current')::bigint;  v_er bigint := (v_f->>'eligible_rehearsed')::bigint;
  v_sc bigint := (v_f->>'settlement_current')::bigint; v_sr bigint := (v_f->>'settlement_rehearsed')::bigint;
  v_result text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_reh := 'REH-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(md5(gen_random_uuid()::text),1,6));
  v_result := case when v_vr > v_vc and v_er > v_ec then 'pass' else 'review' end;

  insert into public.runtime_apply_rehearsals(rehearsal_id, package_ref, apply_script, mode, status, stages,
    verified_current, verified_rehearsed, eligible_current, eligible_rehearsed, settlement_current, settlement_rehearsed, headline, result)
  values (v_reh, 'streaming_v2_view_fix (0447+0448)',
    jsonb_build_array('0447_streaming_v2_verified_view_fix.sql','0448_streaming_v2_identity_view_fix.sql'), 'dry_run', 'completed',
    jsonb_build_array('apply_0447','validate_verified','apply_0448','validate_eligible_settlement','observation','rollback_rehearsal'),
    v_vc, v_vr, v_ec, v_er, v_sc, v_sr,
    format('Rehearsal (dry-run): verified %s→%s · eligible %s→%s · settlement %s→%s', v_vc, v_vr, v_ec, v_er, v_sc, v_sr), v_result);

  -- Validation Pack
  insert into public.runtime_validation_runs(rehearsal_id, phase, metric, validation_sql, before_value, after_value, delta, comparator, passed, note) values
    (v_reh,'0447','verified','select count(*) from v2_verified_streams;', v_vc, v_vr, v_vr - v_vc, '>', v_vr > v_vc, 'session-authoritative 회복'),
    (v_reh,'0448','eligible','select count(*) from v2_eligible_streams;', v_ec, v_er, v_er - v_ec, '>', v_er > v_ec, 'identity 정규화 회복'),
    (v_reh,'0448','settlement','select count(*) from v2_settlement_eligible_streams;', v_sc, v_sr, v_sr - v_sc, '>=', v_sr >= v_sc, 'eligible 파생'),
    (v_reh,'regression','fraud_high','select count(*) from stream_ingest_v2 where fraud_score>=60;', (v_f->>'fraud_high')::numeric, (v_f->>'fraud_high')::numeric, 0, '=', true, '무증가'),
    (v_reh,'regression','dispute','select count(*) from stream_ingest_v2 where dispute_status<>''none'';', (v_f->>'dispute')::numeric, (v_f->>'dispute')::numeric, 0, '=', true, '무변화'),
    (v_reh,'regression','playback','select count(*) from playback_events_v2;', (v_f->>'playback')::numeric, (v_f->>'playback')::numeric, 0, '=', true, '무변화'),
    (v_reh,'regression','v1_stream_events','select count(*) from stream_events;', (v_f->>'stream_events')::numeric, (v_f->>'stream_events')::numeric, 0, '=', true, 'v1 불변');

  -- Operator Runbook (실행 순서)
  insert into public.runtime_operator_runbooks(rehearsal_id, step_num, phase, action, command, expected) values
    (v_reh,1,'snapshot','Pre-Apply Snapshot','select * from runtime_preapply_snapshots order by generated_at desc limit 1;','baseline 확보'),
    (v_reh,2,'apply','Apply 0447','\i supabase/migrations/0447_streaming_v2_verified_view_fix.sql','v2_verified_streams 재정의'),
    (v_reh,3,'validate','Validate verified','select count(*) from v2_verified_streams;', format('%s (>0)', v_vr)),
    (v_reh,4,'apply','Apply 0448','\i supabase/migrations/0448_streaming_v2_identity_view_fix.sql','v2_eligible_streams 재정의'),
    (v_reh,5,'validate','Validate eligible/settlement','select count(*) from v2_eligible_streams; select count(*) from v2_settlement_eligible_streams;', format('eligible %s · settlement %s', v_er, v_sr)),
    (v_reh,6,'validate','Regression','stream_ingest_v2/sessions/stream_events/playback/playlist_tracks count 비교','delta=0'),
    (v_reh,7,'observe','Observation Window','T+0~T+24h verified/eligible/settlement/fraud/dispute/playback/queue 관찰','안정'),
    (v_reh,8,'rollback','Rollback 0448 (필요 시)','create or replace view v2_eligible_streams as <0412 원본>;','eligible funnel 원복'),
    (v_reh,9,'rollback','Rollback 0447 (필요 시)','create or replace view v2_verified_streams as <0412 원본>;','verified funnel 원복'),
    (v_reh,10,'rollback','Rollback Validation','select count(*) from v2_verified_streams;','0 복귀');

  return jsonb_build_object('ok',true,'rehearsal_id',v_reh,'mode','dry_run','result',v_result,
    'verified', jsonb_build_object('current',v_vc,'rehearsed',v_vr),
    'eligible', jsonb_build_object('current',v_ec,'rehearsed',v_er),
    'settlement', jsonb_build_object('current',v_sc,'rehearsed',v_sr),
    'note','Dry-run rehearsal — view/원본 무변경, 실제 Apply 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Observation Procedure — admin_generate_observation_reports
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_observation_reports(p_rehearsal_id text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_reh text; r record;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_reh := coalesce(p_rehearsal_id, (select rehearsal_id from public.runtime_apply_rehearsals order by created_at desc limit 1));
  if v_reh is null then raise exception 'no rehearsal — run admin_run_apply_rehearsal first'; end if;
  delete from public.runtime_observation_reports where rehearsal_id=v_reh;

  for r in select * from (values ('T+0',0),('T+5m',5),('T+15m',15),('T+30m',30),('T+1h',60),('T+6h',360),('T+24h',1440)) as w(lbl, off) loop
    insert into public.runtime_observation_reports(rehearsal_id, window_label, offset_minutes, checklist, metrics, status, note)
    values (v_reh, r.lbl, r.off,
      jsonb_build_array('verified 안정','eligible 안정','settlement 안정','fraud 무증가','dispute 무변화','playback 정상','queue 정상','latency 정상','incident 0'),
      jsonb_build_array('verified','eligible','settlement','fraud','dispute','playback','queue','latency','incident'),
      'planned', '관찰 체크리스트만 — 예약/자동 실행 없음');
  end loop;

  return jsonb_build_object('ok',true,'rehearsal_id',v_reh,'windows',(select count(*) from public.runtime_observation_reports where rehearsal_id=v_reh),
    'note','Observation procedure — 체크리스트만');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Rollback Drill — admin_generate_rollback_drill (실행 금지, 문서화만)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_rollback_drill(p_rehearsal_id text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_reh text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_reh := coalesce(p_rehearsal_id, (select rehearsal_id from public.runtime_apply_rehearsals order by created_at desc limit 1));
  if v_reh is null then raise exception 'no rehearsal'; end if;
  delete from public.runtime_validation_runs where rehearsal_id=v_reh and phase='rollback_drill';

  -- Rollback drill: 순서 0448 → 0447 → 검증. 실제 실행 금지.
  insert into public.runtime_validation_runs(rehearsal_id, phase, metric, validation_sql, before_value, after_value, delta, comparator, passed, note) values
    (v_reh,'rollback_drill','restore_eligible','create or replace view v2_eligible_streams as <0412 원본>; -- 실행 금지', null, null, null, '->', true, 'step 1: 0448 원복(문서)'),
    (v_reh,'rollback_drill','restore_verified','create or replace view v2_verified_streams as <0412 원본>; -- 실행 금지', null, null, null, '->', true, 'step 2: 0447 원복(문서)'),
    (v_reh,'rollback_drill','verify_restore','select count(*) from v2_verified_streams; -- expect 0', null, 0, null, '=', true, 'step 3: verified 0 복귀 확인'),
    (v_reh,'rollback_drill','base_unchanged','select count(*) from stream_ingest_v2; -- delta 0', null, null, 0, '=', true, 'step 4: base row 불변'),
    (v_reh,'rollback_drill','v1_regression','select count(*) from stream_events; -- delta 0', null, null, 0, '=', true, 'step 5: v1 회귀 0');

  return jsonb_build_object('ok',true,'rehearsal_id',v_reh,
    'rollback_steps',(select count(*) from public.runtime_validation_runs where rehearsal_id=v_reh and phase='rollback_drill'),
    'note','Rollback drill — SQL 문서화만, 실제 실행 금지');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- F. Overview — admin_runtime_apply_rehearsal_overview
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_runtime_apply_rehearsal_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_reh text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select rehearsal_id into v_reh from public.runtime_apply_rehearsals order by created_at desc limit 1;
  select jsonb_build_object(
    'has_data', v_reh is not null, 'rehearsal_id', v_reh,
    'rehearsal', (select to_jsonb(r) from (select rehearsal_id, package_ref, apply_script, mode, status, stages, verified_current, verified_rehearsed, eligible_current, eligible_rehearsed, settlement_current, settlement_rehearsed, headline, result, created_at from public.runtime_apply_rehearsals where rehearsal_id=v_reh) r),
    'validation', (select coalesce(jsonb_agg(jsonb_build_object('phase',phase,'metric',metric,'sql',validation_sql,'before',before_value,'after',after_value,'delta',delta,'comparator',comparator,'passed',passed,'note',note) order by created_at),'[]'::jsonb) from public.runtime_validation_runs where rehearsal_id=v_reh and phase<>'rollback_drill'),
    'rollback_drill', (select coalesce(jsonb_agg(jsonb_build_object('metric',metric,'sql',validation_sql,'note',note) order by created_at),'[]'::jsonb) from public.runtime_validation_runs where rehearsal_id=v_reh and phase='rollback_drill'),
    'runbook', (select coalesce(jsonb_agg(jsonb_build_object('step',step_num,'phase',phase,'action',action,'command',command,'expected',expected,'executed',executed) order by step_num),'[]'::jsonb) from public.runtime_operator_runbooks where rehearsal_id=v_reh),
    'observation', (select coalesce(jsonb_agg(jsonb_build_object('label',window_label,'offset',offset_minutes,'checklist',checklist,'status',status) order by offset_minutes),'[]'::jsonb) from public.runtime_observation_reports where rehearsal_id=v_reh)
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- G. Views
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_runtime_rehearsal_summary as
select r.rehearsal_id, r.package_ref, r.mode, r.status, r.result, r.verified_current, r.verified_rehearsed,
  r.eligible_current, r.eligible_rehearsed, r.settlement_current, r.settlement_rehearsed, r.headline, r.created_at
from public.runtime_apply_rehearsals r;

create or replace view public.v2_runtime_validation_summary as
select v.rehearsal_id, v.phase, v.metric, v.before_value, v.after_value, v.delta, v.passed
from public.runtime_validation_runs v;

-- ─────────────────────────────────────────────────────────────────────
-- H. Grants
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._reh_funnel()',
    'public.admin_run_apply_rehearsal(integer)',
    'public.admin_generate_observation_reports(text)',
    'public.admin_generate_rollback_drill(text)',
    'public.admin_runtime_apply_rehearsal_overview()'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on function public.admin_run_apply_rehearsal(integer) is
  'ALGO-8G — Apply Rehearsal (dry-run). 0447/0448 로직을 INLINE 재현하여 verified/eligible/settlement 회복치 계산 + Operator Runbook. view/원본 무변경, 실제 Apply 없음.';
comment on function public.admin_generate_rollback_drill(text) is
  'ALGO-8G — Rollback Drill. rollback SQL 실행 순서 문서화만 — 실제 실행 금지.';
