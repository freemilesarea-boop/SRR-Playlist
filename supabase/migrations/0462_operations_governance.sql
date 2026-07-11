-- 0462 — Phase WEB-OBS-9: Operations Governance & Autonomous Decision Support
--
-- 목적:
--   운영 의사결정을 체계적으로 "지원"한다: 릴리스 준비도/권고를 스냅샷으로 기록(operations_decisions),
--   운영자의 승인/반려/조사필요 선택을 감사 로그로 남기고(operations_approvals, append-only),
--   정적 Playbook(operations_playbooks)과 Rule 설정(operations_rules, 버전 관리)을 제공한다.
--
-- 안전 (절대):
--   • Decision SUPPORT 전용. 이 migration 의 어떤 RPC 도 릴리스를 Merge/Deploy/Rollback 하거나 Release 를
--     차단하거나 Player 를 제어하지 않는다. record_operations_approval 은 운영자의 선택을 "기록"만 하며,
--     그 기록으로 인해 자동 실행되는 downstream 은 없다(자동 실행 금지, 운영자 승인 필수).
--   • Additive Only. 신규 테이블 4 + 신규 RPC 8. 기존 테이블/RPC/뷰/RLS/데이터/텔레메트리 의미 무변경.
--   • Production Apply 금지. Preview / rollback-txn 검증 전용.
--   • Security Definer + _is_super_admin() 게이트 + search_path 고정 + 파라미터 바인딩(동적 SQL 없음).
--   • operations_approvals 는 append-only(감사): update/delete 취소, RPC insert 만.

-- ─────────────────────────────────────────────────────────────────────
-- 1) 테이블 (신규, 자기완결 — 기존 데이터와 분리)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.operations_decisions (
  id             uuid primary key default gen_random_uuid(),
  scope          text not null,                       -- release id / incident key / 'FLEET'
  kind           text not null check (kind in ('RELEASE','INCIDENT','RECOMMENDATION','CHANGE')),
  title          text not null,
  recommendation text not null,                       -- advisory action label (e.g. DELAY_RELEASE)
  status         text not null default 'OPEN' check (status in ('OPEN','APPROVED','REJECTED','NEEDS_INVESTIGATION','OBSERVED','CLOSED')),
  confidence     numeric check (confidence is null or (confidence >= 0 and confidence <= 100)),
  payload        jsonb,                               -- snapshot of readiness/evidence (PII-free)
  created_by     uuid,                                -- auth.uid() of the operator who logged it
  created_at     timestamptz not null default now()
);
comment on table public.operations_decisions is
  'WEB-OBS-9 운영 의사결정 스냅샷(권고/준비도). 기록 전용 — 어떤 실행도 트리거하지 않음. 원문 PII 미저장.';
create index if not exists opsd_status_idx on public.operations_decisions (status, created_at desc);
create index if not exists opsd_scope_idx  on public.operations_decisions (scope, created_at desc);

create table if not exists public.operations_approvals (
  id          uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.operations_decisions(id) on delete cascade,
  choice      text not null check (choice in ('APPROVE','REJECT','NEED_INVESTIGATION')),
  reason      text,
  actor       uuid,                                   -- auth.uid() of the approver
  created_at  timestamptz not null default now()
);
comment on table public.operations_approvals is
  'WEB-OBS-9 운영자 승인/반려 감사 로그(append-only). 기록일 뿐, 릴리스/롤백/Player 를 실행하지 않음.';
create index if not exists opsa_decision_idx on public.operations_approvals (decision_id, created_at);

create table if not exists public.operations_playbooks (
  incident_type      text primary key,
  title              text not null,
  possible_causes    jsonb not null default '[]'::jsonb,
  evidence_to_collect jsonb not null default '[]'::jsonb,
  recommended_checks jsonb not null default '[]'::jsonb,
  escalation_path    jsonb not null default '[]'::jsonb,
  updated_at         timestamptz not null default now()
);
comment on table public.operations_playbooks is 'WEB-OBS-9 정적 Playbook(조사 가이드). 실행 없음.';

create table if not exists public.operations_rules (
  rule_key   text primary key,
  label      text not null,
  threshold  numeric,
  weight     numeric,
  enabled    boolean not null default true,
  version    int not null default 1,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
comment on table public.operations_rules is 'WEB-OBS-9 Rule 설정(threshold/weight/enable, 버전 관리). 표시/거버넌스용.';

-- RLS: super-admin read only; writes exclusively via the security-definer RPCs below.
do $$ declare t text;
begin
  foreach t in array array['operations_decisions','operations_approvals','operations_playbooks','operations_rules'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_super_admin_read', t);
    execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_super_admin_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Write RPCs — 기록 전용. 어떤 실행도 트리거하지 않음.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.record_operations_decision(
  p_scope text, p_kind text, p_title text, p_recommendation text,
  p_confidence numeric default null, p_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_kind text := upper(coalesce(p_kind,'RECOMMENDATION'));
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if v_kind not in ('RELEASE','INCIDENT','RECOMMENDATION','CHANGE') then v_kind := 'RECOMMENDATION'; end if;
  insert into public.operations_decisions (scope, kind, title, recommendation, confidence, payload, created_by)
  values (left(coalesce(p_scope,'FLEET'),200), v_kind, left(coalesce(p_title,''),300), left(coalesce(p_recommendation,''),120),
          case when p_confidence between 0 and 100 then p_confidence else null end, p_payload, auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
revoke execute on function public.record_operations_decision(text,text,text,text,numeric,jsonb) from public;
do $$ begin begin grant execute on function public.record_operations_decision(text,text,text,text,numeric,jsonb) to authenticated; exception when undefined_object then null; end; end $$;

-- Records the operator's choice (APPROVE/REJECT/NEED_INVESTIGATION) as an append-only audit row and
-- reflects it on the parent decision's status. THIS DOES NOT EXECUTE A RELEASE/ROLLBACK/PLAYER ACTION.
create or replace function public.record_operations_approval(
  p_decision_id uuid, p_choice text, p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_choice text := upper(coalesce(p_choice,'')); v_status text; v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if v_choice not in ('APPROVE','REJECT','NEED_INVESTIGATION') then raise exception 'invalid choice'; end if;
  if not exists (select 1 from public.operations_decisions where id = p_decision_id) then raise exception 'decision not found'; end if;
  insert into public.operations_approvals (decision_id, choice, reason, actor)
  values (p_decision_id, v_choice, left(coalesce(p_reason,''),1000), auth.uid()) returning id into v_id;
  v_status := case v_choice when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'NEEDS_INVESTIGATION' end;
  update public.operations_decisions set status = v_status where id = p_decision_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status,
    'note', 'audit record only — no release/rollback/player action executed');
end; $$;
revoke execute on function public.record_operations_approval(uuid,text,text) from public;
do $$ begin begin grant execute on function public.record_operations_approval(uuid,text,text) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.upsert_operations_rule(
  p_key text, p_label text, p_threshold numeric default null, p_weight numeric default null, p_enabled boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_version int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if coalesce(btrim(p_key),'') = '' then raise exception 'rule key required'; end if;
  insert into public.operations_rules (rule_key, label, threshold, weight, enabled, version, updated_by, updated_at)
  values (left(p_key,80), left(coalesce(p_label,p_key),200), p_threshold, p_weight, coalesce(p_enabled,true), 1, auth.uid(), now())
  on conflict (rule_key) do update set
    label = excluded.label, threshold = excluded.threshold, weight = excluded.weight,
    enabled = excluded.enabled, version = public.operations_rules.version + 1, updated_by = auth.uid(), updated_at = now()
  returning version into v_version;
  return jsonb_build_object('ok', true, 'rule_key', p_key, 'version', v_version);
end; $$;
revoke execute on function public.upsert_operations_rule(text,text,numeric,numeric,boolean) from public;
do $$ begin begin grant execute on function public.upsert_operations_rule(text,text,numeric,numeric,boolean) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Read RPCs — overview / queue / history / playbooks / rules
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_operations_overview()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_since timestamptz := now() - interval '7 days';
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true,
    'openDecisions', (select count(*) from public.operations_decisions where status = 'OPEN'),
    'pendingApprovals', (select count(*) from public.operations_decisions where status = 'OPEN'),
    'approvals7d', (select count(*) from public.operations_approvals where choice='APPROVE' and created_at >= v_since),
    'rejected7d', (select count(*) from public.operations_approvals where choice='REJECT' and created_at >= v_since),
    'needInvestigation7d', (select count(*) from public.operations_approvals where choice='NEED_INVESTIGATION' and created_at >= v_since),
    'decisions7d', (select count(*) from public.operations_decisions where created_at >= v_since)
  ) into v; return v;
end; $$;
revoke execute on function public.admin_operations_overview() from public;
do $$ begin begin grant execute on function public.admin_operations_overview() to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.admin_operations_queue(p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit,100),1),300);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true, 'decisions', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'scope', scope, 'kind', kind, 'title', title,
      'recommendation', recommendation, 'status', status, 'confidence', confidence,
      'createdBy', created_by, 'createdAt', to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'payload', payload) order by created_at desc)
    from (select * from public.operations_decisions where status = 'OPEN' order by created_at desc limit v_limit) d), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_operations_queue(int) from public;
do $$ begin begin grant execute on function public.admin_operations_queue(int) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.admin_operations_history(p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit,200),1),500);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true,
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'scope', scope, 'kind', kind, 'title', title,
      'recommendation', recommendation, 'status', status, 'confidence', confidence, 'createdBy', created_by,
      'createdAt', to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by created_at desc)
      from (select * from public.operations_decisions order by created_at desc limit v_limit) d), '[]'::jsonb),
    'approvals', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'decisionId', decision_id, 'choice', choice,
      'reason', reason, 'actor', actor, 'createdAt', to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by created_at desc)
      from (select * from public.operations_approvals order by created_at desc limit v_limit) a), '[]'::jsonb)
  ) into v; return v;
end; $$;
revoke execute on function public.admin_operations_history(int) from public;
do $$ begin begin grant execute on function public.admin_operations_history(int) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.admin_operations_playbooks()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true, 'playbooks', coalesce((
    select jsonb_agg(jsonb_build_object('incidentType', incident_type, 'title', title, 'possibleCauses', possible_causes,
      'evidenceToCollect', evidence_to_collect, 'recommendedChecks', recommended_checks, 'escalationPath', escalation_path) order by incident_type)
    from public.operations_playbooks), '[]'::jsonb)) into v; return v;
end; $$;
revoke execute on function public.admin_operations_playbooks() from public;
do $$ begin begin grant execute on function public.admin_operations_playbooks() to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.admin_operations_rules()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true, 'rules', coalesce((
    select jsonb_agg(jsonb_build_object('key', rule_key, 'label', label, 'threshold', threshold, 'weight', weight,
      'enabled', enabled, 'version', version, 'updatedBy', updated_by, 'updatedAt', to_char(updated_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by rule_key)
    from public.operations_rules), '[]'::jsonb)) into v; return v;
end; $$;
revoke execute on function public.admin_operations_rules() from public;
do $$ begin begin grant execute on function public.admin_operations_rules() to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4) Seed static playbooks + default rules (idempotent)
-- ─────────────────────────────────────────────────────────────────────
insert into public.operations_playbooks (incident_type, title, possible_causes, evidence_to_collect, recommended_checks, escalation_path) values
  ('MEDIA_ERROR_SPIKE','Media / Decoder Error Spike',
   '["특정 트랙 소스/컨테이너 손상","브라우저/디코더 비호환","CDN/네트워크 오류"]'::jsonb,
   '["media_code 분포","browser/os 집중도","release 상관","영향 store/session"]'::jsonb,
   '["browser 집중 여부","release 이후 급증","소스/컨테이너 확인"]'::jsonb,
   '["Store","Brand","Enterprise","Platform"]'::jsonb),
  ('STALL_SPIKE','Buffering / Stall Spike',
   '["네트워크 대역/지연","버퍼 부족","CDN 지연"]'::jsonb,'["stall 비율","networkState/readyState","recovery 상관"]'::jsonb,
   '["매장 회선","시간대 집중","CDN 지역"]'::jsonb,'["Store","Brand","Enterprise","Platform"]'::jsonb),
  ('TTFA_REGRESSION','TTFA_APPROX Regression',
   '["초기 로드 경로 변화","네트워크 악화","번들 크기 증가"]'::jsonb,'["TTFA p75 baseline→current","release/browser 상관"]'::jsonb,
   '["release 상관","(요청→최초 진행 근사)"]'::jsonb,'["Store","Brand","Enterprise","Platform"]'::jsonb),
  ('RECOVERY_FAILURE_SPIKE','Recovery Failure Spike',
   '["반복 media error","네트워크 단절","복구 경로 한계"]'::jsonb,'["recovery attempted/failed","reason 분포","재발 여부"]'::jsonb,
   '["progressive 여부","근본 원인"]'::jsonb,'["Store","Brand","Enterprise","Platform"]'::jsonb),
  ('PLAYBACK_START_FAILURE_SPIKE','Playback Start Failure Spike',
   '["자동재생 차단","초기 미디어 오류","초기 로드 실패"]'::jsonb,'["start 성공/실패","first_progress 미도달","media_error 선행"]'::jsonb,
   '["자동재생 정책","초기 네트워크","release 상관"]'::jsonb,'["Store","Brand","Enterprise","Platform"]'::jsonb)
on conflict (incident_type) do nothing;

insert into public.operations_rules (rule_key, label, threshold, weight, enabled) values
  ('readiness.ready','Release Readiness — READY 기준', 85, 26, true),
  ('readiness.block_on_critical','활성 CRITICAL incident 시 승격 제한', null, null, true),
  ('confidence.high','Confidence — HIGH 기준', 80, 34, true),
  ('escalation.platform_stores','Platform escalation 매장 임계', 25, null, true),
  ('rec.block_release_score_drop','BLOCK 권고 점수 하락 임계', 14, null, true)
on conflict (rule_key) do nothing;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (참고용 — Preview/rollback-txn 검증 전용. Production apply 금지):
--   drop function if exists public.admin_operations_rules();
--   drop function if exists public.admin_operations_playbooks();
--   drop function if exists public.admin_operations_history(int);
--   drop function if exists public.admin_operations_queue(int);
--   drop function if exists public.admin_operations_overview();
--   drop function if exists public.upsert_operations_rule(text,text,numeric,numeric,boolean);
--   drop function if exists public.record_operations_approval(uuid,text,text);
--   drop function if exists public.record_operations_decision(text,text,text,text,numeric,jsonb);
--   drop table if exists public.operations_approvals;
--   drop table if exists public.operations_rules;
--   drop table if exists public.operations_playbooks;
--   drop table if exists public.operations_decisions;
-- 신규(0462) 테이블 4 + 함수 8. 롤백은 순수 DROP. 기존 데이터/스키마/RLS/텔레메트리 영향 없음.
-- 어떤 RPC 도 릴리스/롤백/Release 차단/Player 제어를 실행하지 않음 — 기록·조회 전용.
