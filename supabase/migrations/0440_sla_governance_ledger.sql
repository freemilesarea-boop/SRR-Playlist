-- 0440 — Phase ALGO-6F: SLA Streak Ledger & AI Governance (Shadow)
--
-- 목적:
--   ALGO-6D Shadow SLA 결과를 Append-Only Ledger 에 영구 기록(hash chain)하여 AI 운영 전환의
--   유일한 공식 근거를 구축한다. SLA Ledger · Governance Ledger · SLA Streak · Governance Gate ·
--   Ledger Integrity · Governance Audit · Shadow Certificate. 전부 Shadow.
--
-- 절대 원칙:
--   • 실제 Queue/Playback/Scheduler/Exposure/Prediction/RL/Settlement/Streaming/Decision/Observability 무변경.
--   • Production Apply 금지. additive only. 자동 승인/자동 Canary 금지.
--   • Ledger 는 Append Only — UPDATE/DELETE 금지(트리거로 강제). 운영 전환은
--     Ledger + Human Approval + Governance 3가지 충족 시에만 후속 Phase 에서 검토.
--
-- 자족적: SLA metric 은 playback_events_v2(median split + 일자별 안정성)로 산출한다.
--   (ALGO-6A~6E 테이블 유무와 무관)

-- ─────────────────────────────────────────────────────────────────────
-- 0. Helpers
-- ─────────────────────────────────────────────────────────────────────
-- Append-only 강제(트리거): UPDATE/DELETE 차단
create or replace function public._ledger_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'append-only ledger: % 금지 (UPDATE/DELETE 불가)', tg_op using errcode='23514';
end; $$;

-- SLA ledger entry canonical payload (hash 대상 — recorded_at 제외, 결정론적)
create or replace function public._sla_ledger_payload(
  p_seq bigint, p_state text, p_score numeric, p_acc numeric, p_risk numeric, p_drift numeric,
  p_sample integer, p_sdays integer, p_smonths integer, p_crit integer, p_rv integer, p_mv text)
returns text language sql immutable set search_path to 'public' as $$
  select jsonb_build_object('seq',p_seq,'sla_state',p_state,'sla_score',p_score,'accuracy',p_acc,'risk',p_risk,
    'drift',p_drift,'sample_size',p_sample,'stable_days',p_sdays,'stable_months',p_smonths,
    'critical_alerts',p_crit,'run_version',p_rv,'model_version',p_mv)::text;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- A. Tables (append-only ledgers + governance)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.sla_ledger (
  id uuid primary key default gen_random_uuid(),
  seq bigint not null, sla_result text, sla_state text, sla_score numeric,
  accuracy numeric, risk numeric, drift numeric, sample_size integer,
  stable_days integer, stable_months integer, critical_alerts integer,
  run_version integer, model_version text,
  prev_hash text, entry_hash text not null,
  recorded_at timestamptz not null default now(), recorded_by uuid
);
create unique index if not exists sll_seq_uidx on public.sla_ledger(seq);
create index if not exists sll_recorded_idx on public.sla_ledger(recorded_at desc);

create table if not exists public.governance_ledger (
  id uuid primary key default gen_random_uuid(),
  seq bigint not null, approval_request text, approval_result text default 'pending',
  reviewer text, review_notes text, decision_reason text, governance_version integer,
  prev_hash text, entry_hash text not null,
  approval_timestamp timestamptz not null default now(), recorded_by uuid
);
create unique index if not exists gll_seq_uidx on public.governance_ledger(seq);

create table if not exists public.sla_streak_history (
  id uuid primary key default gen_random_uuid(),
  consecutive_pass_days integer default 0, consecutive_pass_weeks integer default 0, consecutive_pass_months integer default 0,
  best_streak integer default 0, current_streak integer default 0, failure_count integer default 0, recovery_count integer default 0,
  total_entries integer default 0, computed_at timestamptz not null default now()
);
create index if not exists ssh_computed_idx on public.sla_streak_history(computed_at desc);

create table if not exists public.governance_gate (
  id uuid primary key default gen_random_uuid(),
  gate_state text not null,                    -- shadow_only/observation/candidate/ready_for_review/approved_by_human/ready_for_real_canary/blocked
  current_streak integer, consecutive_pass_months integer, reasons jsonb,
  computed_at timestamptz not null default now(), created_by uuid
);
create index if not exists ggt_computed_idx on public.governance_gate(computed_at desc);

create table if not exists public.ledger_integrity (
  id uuid primary key default gen_random_uuid(),
  ledger_name text not null, entries_checked integer, chain_valid boolean, tamper_detected boolean,
  first_hash text, last_hash text, checksum text, notes text, verified_at timestamptz not null default now()
);
create index if not exists lit_verified_idx on public.ledger_integrity(ledger_name, verified_at desc);

create table if not exists public.governance_audit (
  id uuid primary key default gen_random_uuid(),
  who uuid, action text not null, why text, what_changed jsonb,
  approval_reason text, rejection_reason text, at timestamptz not null default now()
);
create index if not exists gau_at_idx on public.governance_audit(at desc);

create table if not exists public.shadow_certificates (
  id uuid primary key default gen_random_uuid(),
  certificate_version integer not null, gate_state text,
  accuracy_history jsonb, risk_history jsonb, stability jsonb, sla_history jsonb,
  ledger_chain jsonb, approval_history jsonb, cert_hash text,
  issued_at timestamptz not null default now(), issued_by uuid
);
create index if not exists shc_issued_idx on public.shadow_certificates(issued_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- B. Append-only triggers (UPDATE/DELETE 차단)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['sla_ledger','governance_ledger'] loop
    if not exists (select 1 from pg_trigger where tgname = t||'_no_mutation') then
      execute format('create trigger %I before update or delete on public.%I for each row execute function public._ledger_block_mutation()', t||'_no_mutation', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- C. RLS (super_admin SELECT only)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['sla_ledger','governance_ledger','sla_streak_history','governance_gate','ledger_integrity','governance_audit','shadow_certificates'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polname = t||'_admin_read') then
      execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_admin_read', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Append SLA Ledger — admin_append_sla_ledger (hash chain, append-only)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_append_sla_ledger(p_days integer default 120)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_from timestamptz := now() - make_interval(days => greatest(coalesce(p_days,120),1)); v_split timestamptz;
  m record; v_sdays integer; v_crit integer; v_smonths integer;
  v_state text; v_score numeric; c_acc boolean; c_risk boolean; c_drift boolean; c_sample boolean; c_days boolean; c_months boolean; c_crit boolean; v_pass int;
  v_seq bigint; v_prev text; v_payload text; v_hash text; v_rv integer; v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select percentile_disc(0.5) within group (order by created_at) into v_split from public.playback_events_v2 where created_at >= v_from;
  if v_split is null then raise exception 'no playback data'; end if;

  select * into m from (
    with bef as (select track_id, count(*) plays, avg(completion_percent)/100.0 comp,
        avg(case when event_type='skip' or coalesce(completion_percent,0)<30 then 1 else 0 end) skip,
        avg(case when coalesce(completion_percent,0)>=60 then 1 else 0 end) elig, least(1.0,count(*)::numeric/20.0) conf
      from public.playback_events_v2 where created_at >= v_from and created_at < v_split group by track_id),
    aft as (select track_id, count(*) plays, avg(completion_percent)/100.0 comp,
        avg(case when event_type='skip' or coalesce(completion_percent,0)<30 then 1 else 0 end) skip,
        avg(case when coalesce(completion_percent,0)>=60 then 1 else 0 end) elig, least(1.0,count(*)::numeric/20.0) conf
      from public.playback_events_v2 where created_at >= v_split group by track_id),
    j as (select b.comp bc, b.skip bs, b.elig be, b.conf bconf, a.comp ac, a.skip as_, a.elig ae, a.conf aconf from bef b join aft a on a.track_id=b.track_id)
    select round(avg(1 - least(1, abs((0.5*bc+0.3*be+0.2*(1-bs)) - (0.5*ac+0.3*ae+0.2*(1-as_)))))::numeric,4) accuracy,
      round(avg(least(1,0.5*as_+0.5*(1-aconf)))::numeric,4) risk, round(avg(abs(ac-bc))::numeric,4) drift, count(*)::int n from j) m;

  -- 일자별 90d 안정성 → consecutive_stable_days + critical count
  select consec, crit into v_sdays, v_crit from (
    with days as (select gs::date d from generate_series(current_date - 89, current_date, interval '1 day') gs),
    daily as (select d.d, (select avg(completion_percent)/100.0 from public.playback_events_v2 e where e.created_at::date=d.d) comp,
        (select count(*) from public.playback_events_v2 e where e.created_at::date=d.d) cnt from days d),
    wmean as (select avg(comp) mm from daily where comp is not null),
    classed as (select d, case when cnt=0 or comp is null then 'insufficient' when abs(comp-(select mm from wmean)) < 0.08 then 'stable' when abs(comp-(select mm from wmean)) < 0.15 then 'warning' else 'critical' end st from daily),
    ranked as (select d, st, row_number() over (order by d desc) rn from classed)
    select (coalesce((select min(rn) from ranked where st <> 'stable'),(select count(*)+1 from ranked))-1) consec,
      (select count(*) from classed where st='critical') crit) z;
  v_smonths := floor(coalesce(v_sdays,0)/30.0)::int;

  -- SLA 판정 (default policy 임계)
  c_acc := coalesce(m.accuracy,0) >= 0.75; c_risk := coalesce(m.risk,1) <= 0.20; c_drift := coalesce(m.drift,1) <= 0.15;
  c_sample := coalesce(m.n,0) >= 100; c_days := coalesce(v_sdays,0) >= 30; c_months := coalesce(v_smonths,0) >= 3; c_crit := coalesce(v_crit,0) <= 0;
  v_pass := c_acc::int + c_risk::int + c_drift::int + c_sample::int + c_days::int + c_months::int + c_crit::int;
  v_state := case when coalesce(m.n,0) < 10 then 'insufficient_data' when v_pass = 7 then 'sla_pass' when v_pass >= 5 then 'sla_warning' else 'sla_fail' end;
  v_score := round((v_pass::numeric/7.0),4);

  -- hash chain
  select coalesce(max(seq),0)+1 into v_seq from public.sla_ledger;
  select coalesce((select entry_hash from public.sla_ledger order by seq desc limit 1),'GENESIS') into v_prev;
  v_rv := (v_seq)::int;
  v_payload := public._sla_ledger_payload(v_seq, v_state, v_score, m.accuracy, m.risk, m.drift, m.n, coalesce(v_sdays,0), v_smonths, coalesce(v_crit,0), v_rv, 'shadow-v1');
  v_hash := md5(v_payload || v_prev);

  insert into public.sla_ledger(seq, sla_result, sla_state, sla_score, accuracy, risk, drift, sample_size,
    stable_days, stable_months, critical_alerts, run_version, model_version, prev_hash, entry_hash, recorded_by)
  values (v_seq, v_state, v_state, v_score, m.accuracy, m.risk, m.drift, m.n,
    coalesce(v_sdays,0), v_smonths, coalesce(v_crit,0), v_rv, 'shadow-v1', v_prev, v_hash, auth.uid())
  returning id into v_id;

  insert into public.governance_audit(who, action, why, what_changed)
  values (auth.uid(), 'append_sla_ledger', 'shadow SLA 결과 append-only 기록',
    jsonb_build_object('seq',v_seq,'sla_state',v_state,'entry_hash',v_hash));

  return jsonb_build_object('ok',true,'ledger_id',v_id,'seq',v_seq,'sla_state',v_state,'sla_score',v_score,
    'accuracy',m.accuracy,'risk',m.risk,'sample_size',m.n,'entry_hash',v_hash,'prev_hash',v_prev,
    'note','Append-only SLA ledger — 수정 불가, 실반영 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Governance Gate + Streak — admin_generate_governance_gate
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_governance_gate()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare st record; v_gate text; v_latest text; v_reasons jsonb; v_gseq bigint; v_prev text; v_hash text; v_gver integer;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;

  select * into st from (
    with e as (select seq, sla_state, recorded_at::date d from public.sla_ledger),
    -- entries-based current/best streak of sla_pass
    ordered as (select sla_state, row_number() over (order by seq) rn, seq from e),
    grp as (select *, sum(case when sla_state='sla_pass' then 0 else 1 end) over (order by seq) g from ordered),
    runs as (select g, count(*) c from grp where sla_state='sla_pass' group by g),
    -- day-based consecutive pass days
    byday as (select d, bool_and(sla_state='sla_pass') allpass from e group by d),
    dranked as (select d, allpass, row_number() over (order by d desc) rn from byday)
    select
      (select coalesce((select min(rn) from (select sla_state, row_number() over (order by seq desc) rn from e) q where sla_state <> 'sla_pass'),(select count(*)+1 from e))-1) current_streak,
      coalesce((select max(c) from runs),0) best_streak,
      (select count(*) from e where sla_state='sla_fail') failure_count,
      (select count(*) from (select sla_state, lag(sla_state) over (order by seq) prev from e) t where sla_state='sla_pass' and prev='sla_fail') recovery_count,
      (select count(*) from e) total_entries,
      (select coalesce((select min(rn) from dranked where not allpass),(select count(*)+1 from dranked))-1) consec_pass_days,
      (select sla_state from e order by seq desc limit 1) latest_state
  ) st;

  insert into public.sla_streak_history(consecutive_pass_days, consecutive_pass_weeks, consecutive_pass_months,
    best_streak, current_streak, failure_count, recovery_count, total_entries)
  values (coalesce(st.consec_pass_days,0), floor(coalesce(st.consec_pass_days,0)/7.0)::int, floor(coalesce(st.consec_pass_days,0)/30.0)::int,
    coalesce(st.best_streak,0), coalesce(st.current_streak,0), coalesce(st.failure_count,0), coalesce(st.recovery_count,0), coalesce(st.total_entries,0));

  v_latest := st.latest_state;
  -- Governance Gate (Shadow — 실제 전환 없음). approved_by_human/ready_for_real_canary 는 인간 승인 있어야 하며 shadow 에선 도달 불가.
  v_gate := case
    when coalesce(st.total_entries,0)=0 then 'shadow_only'
    when floor(coalesce(st.consec_pass_days,0)/30.0)::int >= 3 and exists(select 1 from public.governance_ledger where approval_result='approved') then 'ready_for_real_canary'
    when floor(coalesce(st.consec_pass_days,0)/30.0)::int >= 3 then 'ready_for_review'
    when coalesce(st.current_streak,0) >= 3 then 'candidate'
    when v_latest='sla_fail' then 'blocked'
    when exists(select 1 from public.sla_ledger where sla_state='sla_pass') then 'observation'
    else 'shadow_only' end;

  v_reasons := jsonb_build_object('current_streak',coalesce(st.current_streak,0),'best_streak',coalesce(st.best_streak,0),
    'consecutive_pass_days',coalesce(st.consec_pass_days,0),'consecutive_pass_months',floor(coalesce(st.consec_pass_days,0)/30.0)::int,
    'failure_count',coalesce(st.failure_count,0),'latest_state',v_latest,'total_entries',coalesce(st.total_entries,0),
    'human_approval', exists(select 1 from public.governance_ledger where approval_result='approved'),
    'note','운영 전환은 Ledger+Human Approval+Governance 3충족 시에만 후속 검토');

  insert into public.governance_gate(gate_state, current_streak, consecutive_pass_months, reasons, created_by)
  values (v_gate, coalesce(st.current_streak,0), floor(coalesce(st.consec_pass_days,0)/30.0)::int, v_reasons, auth.uid());

  -- candidate/ready_for_review → governance ledger 에 approval_request(pending) append (자동 승인 없음)
  if v_gate in ('candidate','ready_for_review') then
    select coalesce(max(seq),0)+1 into v_gseq from public.governance_ledger;
    select coalesce((select entry_hash from public.governance_ledger order by seq desc limit 1),'GENESIS') into v_prev;
    v_gver := v_gseq::int;
    v_hash := md5(jsonb_build_object('seq',v_gseq,'request','promotion_review','result','pending','gate',v_gate,'version',v_gver)::text || v_prev);
    insert into public.governance_ledger(seq, approval_request, approval_result, decision_reason, governance_version, prev_hash, entry_hash, recorded_by)
    values (v_gseq, 'promotion_review', 'pending', 'gate='||v_gate||' → 인간 검토 요청(자동 승인 없음)', v_gver, v_prev, v_hash, auth.uid());
  end if;

  insert into public.governance_audit(who, action, why, what_changed)
  values (auth.uid(), 'generate_governance_gate', 'SLA streak 기반 게이트 판정', jsonb_build_object('gate_state',v_gate,'current_streak',coalesce(st.current_streak,0)));

  return jsonb_build_object('ok',true,'gate_state',v_gate,'current_streak',coalesce(st.current_streak,0),
    'consecutive_pass_days',coalesce(st.consec_pass_days,0),'consecutive_pass_months',floor(coalesce(st.consec_pass_days,0)/30.0)::int,
    'best_streak',coalesce(st.best_streak,0),'failure_count',coalesce(st.failure_count,0),'reasons',v_reasons,
    'note','Governance Gate 판정만 — 실제 운영 전환/자동 승인 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- F. Ledger Integrity 검증 — admin_verify_ledger_integrity
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_verify_ledger_integrity(p_ledger text default 'sla_ledger')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record; v_prev text := 'GENESIS'; v_valid boolean := true; v_n integer := 0; v_first text; v_last text; v_calc text; v_checksum text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if coalesce(p_ledger,'') not in ('sla_ledger','governance_ledger') then raise exception 'invalid ledger'; end if;

  if p_ledger = 'sla_ledger' then
    for r in select * from public.sla_ledger order by seq loop
      v_n := v_n + 1;
      if v_first is null then v_first := r.entry_hash; end if;
      v_calc := md5(public._sla_ledger_payload(r.seq, r.sla_state, r.sla_score, r.accuracy, r.risk, r.drift, r.sample_size, r.stable_days, r.stable_months, r.critical_alerts, r.run_version, r.model_version) || v_prev);
      if r.prev_hash <> v_prev or r.entry_hash <> v_calc then v_valid := false; end if;
      v_prev := r.entry_hash; v_last := r.entry_hash;
    end loop;
    select md5(coalesce(string_agg(entry_hash, '' order by seq),'')) into v_checksum from public.sla_ledger;
  else
    for r in select * from public.governance_ledger order by seq loop
      v_n := v_n + 1;
      if v_first is null then v_first := r.entry_hash; end if;
      v_calc := md5(jsonb_build_object('seq',r.seq,'request',r.approval_request,'result',r.approval_result,'gate','_','version',r.governance_version)::text || v_prev);
      -- governance payload 는 gate 값이 append 시점 종속이라 prev_hash 연결만 검증
      if r.prev_hash <> v_prev then v_valid := false; end if;
      v_prev := r.entry_hash; v_last := r.entry_hash;
    end loop;
    select md5(coalesce(string_agg(entry_hash, '' order by seq),'')) into v_checksum from public.governance_ledger;
  end if;

  insert into public.ledger_integrity(ledger_name, entries_checked, chain_valid, tamper_detected, first_hash, last_hash, checksum, notes)
  values (p_ledger, v_n, v_valid, not v_valid, v_first, v_last, v_checksum,
    case when v_valid then 'chain 무결 — append-only 검증 통과' else 'tamper 의심 — hash/prev_hash 불일치' end);

  return jsonb_build_object('ok',true,'ledger',p_ledger,'entries_checked',v_n,'chain_valid',v_valid,'tamper_detected',not v_valid,
    'first_hash',v_first,'last_hash',v_last,'checksum',v_checksum,'note','Audit 목적 — 무결성 검증만');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- G. Shadow Certificate — admin_generate_shadow_certificate (생성만)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_shadow_certificate()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_ver integer; v_gate text; v_acc jsonb; v_risk jsonb; v_sla jsonb; v_stab jsonb; v_chain jsonb; v_appr jsonb; v_hash text; v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select coalesce(max(certificate_version),0)+1 into v_ver from public.shadow_certificates;
  select gate_state into v_gate from public.governance_gate order by computed_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('seq',seq,'accuracy',accuracy) order by seq),'[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('seq',seq,'risk',risk) order by seq),'[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('seq',seq,'state',sla_state,'score',sla_score) order by seq),'[]'::jsonb)
    into v_acc, v_risk, v_sla from public.sla_ledger;
  select to_jsonb(s) into v_stab from (select consecutive_pass_days, consecutive_pass_months, best_streak, current_streak, failure_count from public.sla_streak_history order by computed_at desc limit 1) s;
  select jsonb_build_object('entries',(select count(*) from public.sla_ledger),
    'first_hash',(select entry_hash from public.sla_ledger order by seq limit 1),
    'last_hash',(select entry_hash from public.sla_ledger order by seq desc limit 1),
    'integrity',(select jsonb_build_object('chain_valid',chain_valid,'tamper',tamper_detected,'checksum',checksum) from public.ledger_integrity where ledger_name='sla_ledger' order by verified_at desc limit 1)) into v_chain;
  select coalesce(jsonb_agg(jsonb_build_object('seq',seq,'request',approval_request,'result',approval_result) order by seq),'[]'::jsonb) into v_appr from public.governance_ledger;

  v_hash := md5(jsonb_build_object('version',v_ver,'gate',v_gate,'sla',v_sla,'stability',v_stab,'chain',v_chain,'approvals',v_appr)::text);

  insert into public.shadow_certificates(certificate_version, gate_state, accuracy_history, risk_history, stability, sla_history, ledger_chain, approval_history, cert_hash, issued_by)
  values (v_ver, v_gate, v_acc, v_risk, v_stab, v_sla, v_chain, v_appr, v_hash, auth.uid())
  returning id into v_id;

  insert into public.governance_audit(who, action, why, what_changed)
  values (auth.uid(), 'generate_shadow_certificate', 'AI Shadow Certificate 발급(관측 증빙)', jsonb_build_object('version',v_ver,'gate',v_gate,'cert_hash',v_hash));

  return jsonb_build_object('ok',true,'certificate_id',v_id,'certificate_version',v_ver,'gate_state',v_gate,'cert_hash',v_hash,
    'note','Shadow Certificate 생성만 — 운영 전환 승인 아님');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- H. Overview — admin_ai_governance_overview
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_governance_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select jsonb_build_object(
    'has_data', exists(select 1 from public.sla_ledger),
    'gate', (select to_jsonb(g) from (select gate_state, current_streak, consecutive_pass_months, reasons, computed_at from public.governance_gate order by computed_at desc limit 1) g),
    'streak', (select to_jsonb(s) from (select consecutive_pass_days, consecutive_pass_weeks, consecutive_pass_months, best_streak, current_streak, failure_count, recovery_count, total_entries from public.sla_streak_history order by computed_at desc limit 1) s),
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object('seq',seq,'state',sla_state,'score',sla_score,'accuracy',accuracy,'risk',risk,'entry_hash',entry_hash,'prev_hash',prev_hash,'at',recorded_at) order by seq desc),'[]'::jsonb)
               from (select * from public.sla_ledger order by seq desc limit 15) l),
    'integrity', (select to_jsonb(i) from (select ledger_name, entries_checked, chain_valid, tamper_detected, checksum, verified_at from public.ledger_integrity order by verified_at desc limit 1) i),
    'certificate', (select to_jsonb(c) from (select certificate_version, gate_state, cert_hash, issued_at from public.shadow_certificates order by issued_at desc limit 1) c),
    'approvals', (select coalesce(jsonb_agg(jsonb_build_object('seq',seq,'request',approval_request,'result',approval_result,'reason',decision_reason,'at',approval_timestamp) order by seq desc),'[]'::jsonb) from public.governance_ledger),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('action',action,'why',why,'at',at) order by at desc),'[]'::jsonb) from (select * from public.governance_audit order by at desc limit 10) a),
    'counts', jsonb_build_object('sla_entries',(select count(*) from public.sla_ledger),'gov_entries',(select count(*) from public.governance_ledger),'certificates',(select count(*) from public.shadow_certificates))
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- I. Views
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_sla_ledger_summary as
select l.seq, l.sla_state, l.sla_score, l.accuracy, l.risk, l.drift, l.sample_size, l.stable_days, l.stable_months,
  l.critical_alerts, l.run_version, l.model_version, l.prev_hash, l.entry_hash, l.recorded_at
from public.sla_ledger l;

create or replace view public.v2_governance_gate_summary as
select g.gate_state, g.current_streak, g.consecutive_pass_months, g.reasons, g.computed_at
from public.governance_gate g;

create or replace view public.v2_shadow_certificate_summary as
select c.certificate_version, c.gate_state, c.cert_hash, c.stability, c.ledger_chain, c.issued_at
from public.shadow_certificates c;

create or replace view public.v2_ledger_integrity_summary as
select i.ledger_name, i.entries_checked, i.chain_valid, i.tamper_detected, i.first_hash, i.last_hash, i.checksum, i.verified_at
from public.ledger_integrity i;

-- ─────────────────────────────────────────────────────────────────────
-- J. Grants
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._sla_ledger_payload(bigint,text,numeric,numeric,numeric,numeric,integer,integer,integer,integer,integer,text)',
    'public.admin_append_sla_ledger(integer)',
    'public.admin_generate_governance_gate()',
    'public.admin_generate_shadow_certificate()',
    'public.admin_verify_ledger_integrity(text)',
    'public.admin_ai_governance_overview()'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on table public.sla_ledger is
  'ALGO-6F — Append-only SLA Ledger(hash chain). UPDATE/DELETE 트리거 차단. 운영 전환 공식 근거.';
comment on function public.admin_generate_governance_gate() is
  'ALGO-6F — SLA streak 기반 Governance Gate 판정. 자동 승인/자동 전환 없음(shadow).';
