-- 0450 — Phase ALGO-8F: Human Approval Workflow & Runtime Apply Authorization (Shadow)
--
-- 목적:
--   ALGO-8E(0449)에서 생성한 Runtime Apply Package 를 운영자가 승인하는 절차를 구축한다.
--   Approval Workflow · Multi Reviewer · Approval Policy · Approval Audit · Authorization Certificate 생성.
--   실제 Apply 는 하지 않는다 — Human Approval 과 Authorization(권한 부여)만 관리한다.
--
-- 절대 원칙:
--   • Runtime/Playback/Queue/Streaming/Settlement/Prediction/RL/Decision/Governance 무변경.
--     Production Apply/Canary 없음. Authorization 은 "실제 Apply 권한"만 부여하고 실행은 하지 않는다.
--   • Additive Only. 기존 View/Runtime 함수/Trigger 수정 금지.
--   • runtime_authorization_reviews / runtime_authorization_certificate / runtime_authorization_audit 는 Append-Only.
--   • 자동 투표 없음 — review(vote)는 super_admin 이 명시적으로 호출할 때만 기록된다.

-- ─────────────────────────────────────────────────────────────────────
-- 0. Helper — append-only trigger
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._rauth_append_only()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'append-only: % on % is forbidden (ALGO-8F audit)', TG_OP, TG_TABLE_NAME using errcode='0A000';
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- A. Tables
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.runtime_authorization_policy (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null, description text, rule text,           -- '2of3' | '3of4' | 'all_required'
  required_approvals integer, total_reviewers integer, roles jsonb,
  created_at timestamptz not null default now()
);
create index if not exists rapol_idx on public.runtime_authorization_policy(policy_key);

create table if not exists public.runtime_authorization_requests (
  id uuid primary key default gen_random_uuid(),
  request_id text not null, apply_package_ref text, title text, description text,
  policy_key text, status text default 'Requested',               -- Draft/Requested/Under Review/Approved/Rejected/Expired/Revoked
  requested_by text, requested_at timestamptz not null default now(), expiration_at timestamptz, note text
);
create index if not exists rareq_idx on public.runtime_authorization_requests(request_id);

create table if not exists public.runtime_authorization_reviews (
  id uuid primary key default gen_random_uuid(),
  request_id text not null, reviewer_role text, reviewer text, vote text,   -- approve/reject/abstain
  reason text, voted_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create index if not exists rarev_idx on public.runtime_authorization_reviews(request_id, voted_at desc);

create table if not exists public.runtime_authorization_certificate (
  id uuid primary key default gen_random_uuid(),
  request_id text not null, authorization_status text,            -- unauthorized/pending/authorized/revoked
  approvals_count integer, rejections_count integer, required_approvals integer,
  policy_satisfied boolean default false, authorized_roles jsonb, certificate_hash text, note text,
  created_at timestamptz not null default now()
);
create index if not exists racert_idx on public.runtime_authorization_certificate(request_id, created_at desc);

create table if not exists public.runtime_authorization_audit (
  id uuid primary key default gen_random_uuid(),
  request_id text not null, actor text, action text, detail text, ts timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists raaud_idx on public.runtime_authorization_audit(request_id, ts desc);

-- ─────────────────────────────────────────────────────────────────────
-- B. Append-only triggers (reviews / certificate / audit)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['runtime_authorization_reviews','runtime_authorization_certificate','runtime_authorization_audit'] loop
    if not exists (select 1 from pg_trigger where tgname = t||'_append_only') then
      execute format('create trigger %I before update or delete on public.%I for each row execute function public._rauth_append_only()', t||'_append_only', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- C. RLS (super_admin SELECT only)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['runtime_authorization_policy','runtime_authorization_requests',
    'runtime_authorization_reviews','runtime_authorization_certificate','runtime_authorization_audit'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polname = t||'_admin_read') then
      execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_admin_read', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Request Authorization — admin_request_runtime_authorization (request 생성 + policy)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_request_runtime_authorization(
  p_apply_package_ref text default 'streaming_v2_view_fix (0447+0448)', p_rule text default '3of4', p_requested_by text default 'admin')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_req text; v_pol text; v_required int; v_total int := 4; v_roles jsonb := jsonb_build_array('AI Owner','Streaming Owner','Backend Owner','Operations Owner');
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_required := case p_rule when '2of3' then 2 when '3of4' then 3 when 'all_required' then v_total else 3 end;
  if p_rule = '2of3' then v_total := 3; v_roles := jsonb_build_array('AI Owner','Streaming Owner','Operations Owner'); end if;

  v_pol := 'POL-'||p_rule;
  insert into public.runtime_authorization_policy(policy_key, description, rule, required_approvals, total_reviewers, roles)
  values (v_pol, format('%s reviewer approval policy', p_rule), p_rule, v_required, v_total, v_roles);

  v_req := 'AUTH-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(md5(gen_random_uuid()::text),1,6));
  insert into public.runtime_authorization_requests(request_id, apply_package_ref, title, description, policy_key, status, requested_by, expiration_at, note)
  values (v_req, p_apply_package_ref, 'Runtime Apply Authorization — '||p_apply_package_ref,
    '0447/0448 view-side fix 적용 권한 요청 (실제 Apply 없음, 권한만 부여)', v_pol, 'Requested', p_requested_by,
    now() + interval '7 days', 'Human Approval Workflow — 자동 승인 없음');

  insert into public.runtime_authorization_audit(request_id, actor, action, detail)
  values (v_req, p_requested_by, 'requested', format('authorization requested · policy %s (%s of %s)', p_rule, v_required, v_total));

  return jsonb_build_object('ok',true,'request_id',v_req,'policy',v_pol,'rule',p_rule,'required_approvals',v_required,'total_reviewers',v_total,
    'status','Requested','note','Authorization 요청 생성 — 실제 Apply 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Review (Vote, append-only) — admin_review_runtime_authorization
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_review_runtime_authorization(
  p_request_id text, p_reviewer_role text, p_vote text, p_reviewer text default 'admin', p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_exists boolean; v_status text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if p_vote not in ('approve','reject','abstain') then raise exception 'invalid vote: %', p_vote; end if;
  select true into v_exists from public.runtime_authorization_requests where request_id=p_request_id limit 1;
  if not v_exists then raise exception 'no authorization request: %', p_request_id; end if;

  -- append-only vote 기록 (같은 role 재투표 시 새 row — 최신 vote 가 유효)
  insert into public.runtime_authorization_reviews(request_id, reviewer_role, reviewer, vote, reason)
  values (p_request_id, p_reviewer_role, p_reviewer, p_vote, coalesce(p_reason, p_vote));

  -- 요청 상태를 Under Review 로 전이 (Approved/Rejected 는 generate_authorization 에서 확정)
  update public.runtime_authorization_requests set status='Under Review'
  where request_id=p_request_id and status in ('Requested','Draft');

  insert into public.runtime_authorization_audit(request_id, actor, action, detail)
  values (p_request_id, p_reviewer, 'reviewed', format('%s voted %s (%s)', p_reviewer_role, p_vote, coalesce(p_reason,'')));

  select status into v_status from public.runtime_authorization_requests where request_id=p_request_id;
  return jsonb_build_object('ok',true,'request_id',p_request_id,'reviewer_role',p_reviewer_role,'vote',p_vote,'status',v_status,
    'votes',(select count(*) from public.runtime_authorization_reviews where request_id=p_request_id),
    'note','Vote 기록 (append-only) — 자동 승인 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- F. Generate Authorization + Certificate — admin_generate_runtime_authorization
--    정책 대비 최신 vote 집계 → authorization 상태 + append-only certificate
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_runtime_authorization(p_request_id text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_req text; v_pol record; v_appr int; v_rej int; v_status text; v_reqstatus text; v_sat boolean; v_hash text; v_roles jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_req := coalesce(p_request_id, (select request_id from public.runtime_authorization_requests order by requested_at desc limit 1));
  if v_req is null then raise exception 'no authorization request'; end if;

  select p.rule, p.required_approvals, p.total_reviewers into v_pol
  from public.runtime_authorization_requests r join public.runtime_authorization_policy p on p.policy_key=r.policy_key
  where r.request_id=v_req limit 1;

  -- role 별 최신 vote 집계 (append-only 이므로 latest per role)
  with latest as (
    select distinct on (reviewer_role) reviewer_role, vote
    from public.runtime_authorization_reviews where request_id=v_req
    order by reviewer_role, voted_at desc
  )
  select count(*) filter (where vote='approve'), count(*) filter (where vote='reject'),
    coalesce(jsonb_agg(reviewer_role) filter (where vote='approve'),'[]'::jsonb)
    into v_appr, v_rej, v_roles from latest;

  v_sat := coalesce(v_appr,0) >= coalesce(v_pol.required_approvals, 3)
    and (v_pol.rule <> 'all_required' or coalesce(v_rej,0) = 0);
  -- authorization 상태 (실제 Apply 권한만 — 실행 없음)
  v_status := case
    when coalesce(v_rej,0) > (coalesce(v_pol.total_reviewers,4) - coalesce(v_pol.required_approvals,3)) then 'unauthorized'
    when v_sat then 'authorized'
    when coalesce(v_appr,0) > 0 or coalesce(v_rej,0) > 0 then 'pending'
    else 'unauthorized' end;
  v_reqstatus := case when v_status='authorized' then 'Approved'
    when v_status='unauthorized' and coalesce(v_rej,0) > 0 then 'Rejected'
    when coalesce(v_appr,0) > 0 or coalesce(v_rej,0) > 0 then 'Under Review' else 'Requested' end;

  v_hash := md5(v_req||'|'||v_status||'|'||coalesce(v_appr,0)::text||'/'||coalesce(v_pol.required_approvals,3)::text);

  insert into public.runtime_authorization_certificate(request_id, authorization_status, approvals_count, rejections_count, required_approvals, policy_satisfied, authorized_roles, certificate_hash, note)
  values (v_req, v_status, coalesce(v_appr,0), coalesce(v_rej,0), coalesce(v_pol.required_approvals,3), v_sat, v_roles, v_hash,
    case when v_status='authorized' then '실제 Runtime Apply 권한 부여 — 실행은 하지 않음(별도 Apply Phase 필요)'
         else 'Authorization 미완료 — Apply 불가' end);

  update public.runtime_authorization_requests set status=v_reqstatus where request_id=v_req;

  insert into public.runtime_authorization_audit(request_id, actor, action, detail)
  values (v_req, 'system', case when v_status='authorized' then 'authorized' else 'evaluated' end,
    format('status=%s approvals=%s/%s rejections=%s', v_status, coalesce(v_appr,0), coalesce(v_pol.required_approvals,3), coalesce(v_rej,0)));

  return jsonb_build_object('ok',true,'request_id',v_req,'authorization_status',v_status,'request_status',v_reqstatus,
    'approvals',coalesce(v_appr,0),'rejections',coalesce(v_rej,0),'required',coalesce(v_pol.required_approvals,3),
    'policy_satisfied',v_sat,'certificate_hash',left(v_hash,12),'note','Authorization 생성 — 실제 Apply 금지');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- G. Overview — admin_runtime_authorization_overview
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_runtime_authorization_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_req text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select request_id into v_req from public.runtime_authorization_requests order by requested_at desc limit 1;
  select jsonb_build_object(
    'has_data', v_req is not null, 'request_id', v_req,
    'request', (select to_jsonb(r) from (select request_id, apply_package_ref, title, description, policy_key, status, requested_by, requested_at, expiration_at from public.runtime_authorization_requests where request_id=v_req) r),
    'policy', (select to_jsonb(p) from (select policy_key, description, rule, required_approvals, total_reviewers, roles from public.runtime_authorization_policy p join public.runtime_authorization_requests r on r.policy_key=p.policy_key where r.request_id=v_req limit 1) p),
    'reviews', (select coalesce(jsonb_agg(jsonb_build_object('role',reviewer_role,'reviewer',reviewer,'vote',vote,'reason',reason,'voted_at',voted_at) order by voted_at),'[]'::jsonb) from public.runtime_authorization_reviews where request_id=v_req),
    'latest_votes', (select coalesce(jsonb_object_agg(reviewer_role, vote),'{}'::jsonb) from (select distinct on (reviewer_role) reviewer_role, vote from public.runtime_authorization_reviews where request_id=v_req order by reviewer_role, voted_at desc) z),
    'certificate', (select to_jsonb(c) from (select authorization_status, approvals_count, rejections_count, required_approvals, policy_satisfied, authorized_roles, left(certificate_hash,12) as hash, note, created_at from public.runtime_authorization_certificate where request_id=v_req order by created_at desc limit 1) c),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('actor',actor,'action',action,'detail',detail,'ts',ts) order by ts desc),'[]'::jsonb) from public.runtime_authorization_audit where request_id=v_req)
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- H. Views
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_runtime_authorization_summary as
select r.request_id, r.apply_package_ref, r.policy_key, r.status, r.requested_by, r.requested_at, r.expiration_at,
  (select authorization_status from public.runtime_authorization_certificate c where c.request_id=r.request_id order by c.created_at desc limit 1) as authorization_status
from public.runtime_authorization_requests r;

create or replace view public.v2_runtime_authorization_review_summary as
select v.request_id, v.reviewer_role, v.reviewer, v.vote, v.voted_at
from public.runtime_authorization_reviews v;

-- ─────────────────────────────────────────────────────────────────────
-- I. Grants
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_request_runtime_authorization(text,text,text)',
    'public.admin_review_runtime_authorization(text,text,text,text,text)',
    'public.admin_generate_runtime_authorization(text)',
    'public.admin_runtime_authorization_overview()'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on function public.admin_request_runtime_authorization(text,text,text) is
  'ALGO-8F — Human Approval Workflow. 0447/0448 Apply 권한 요청 + Approval Policy(2of3/3of4/all) 생성. 실제 Apply 없음.';
comment on function public.admin_review_runtime_authorization(text,text,text,text,text) is
  'ALGO-8F — Multi-reviewer vote (append-only). 자동 투표 없음 — super_admin 명시적 호출만 기록.';
comment on function public.admin_generate_runtime_authorization(text) is
  'ALGO-8F — Authorization Certificate 생성. 정책 대비 vote 집계 → authorized 시 실제 Apply "권한"만 부여(실행 없음).';
