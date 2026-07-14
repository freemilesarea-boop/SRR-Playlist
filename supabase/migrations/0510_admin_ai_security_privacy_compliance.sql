-- 0510_admin_ai_security_privacy_compliance.sql
-- Phase AI-OPS-7 — Security Operations, Access Governance, Privacy Control &
-- Compliance Evidence Center.
--
-- 실제 Identity/권한/민감 데이터 구조 분석 결과(추측 없음):
--   Role: users.role in ('user','admin') 2종만(0001) — 세분 RBAC 없음 → rbac_limited.
--     account_type in ('individual','business','artist')(0017). admin 판별:
--     _admin_growth_guard/_internal_is_admin_caller. MFA/Session Policy 확인 불가.
--   민감 데이터(실존 확인): auth.users.email(개인정보) · payout_accounts.account_number
--     (계좌 원본, 0060) — artist_settlements 는 masked 만 snapshot · payout_reveal_audit
--     (0061) 계좌 열람 audit 존재 · artist_contracts(0057 계약) · artist_settlements
--     (0060 정산) · tracks.audio_url · storage(audio/covers/brand-assets)
--   로그: 계좌 열람은 payout_reveal_audit 로 기록됨(partially). 로그인 이력은
--     auth.users.last_sign_in_at 뿐(전용 로그인 로그 없음) · 민감 테이블 SELECT 로그
--     없음 → logging_unavailable. RLS 는 119개 migration 에서 광범위 사용.
--
-- 원칙:
--   * 자동 계정 비활성화/Role 변경/권한 회수/비밀번호 초기화/MFA/Session/데이터 삭제 없음
--     — 조회·분석·검토·판정·권고·외부 수행 Reference·Audit 만
--   * 비밀번호/Token/Secret 값 저장 금지 — Table/Column Metadata 만
--   * 로그가 없으면 접근이 없었다고 단정하지 않음(logging_unavailable)
--   * AI 가 Security Policy/Retention 기간 직접 수정 불가 — 관리자 승인 + change_reason
--   * 법적 보존기간 임의 생성 없음(Retention seed 0건) · 공식 인증(ISO/SOC2/ISMS) 주장 없음
--   * Trigger 없음 · 삭제 RPC 없음 · auth.users/public.users(role·withdrawn_at) UPDATE 없음

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Access Review — 검토/권고 기록(실제 Role·권한 변경 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_security_access_reviews (
  id                  uuid primary key default gen_random_uuid(),
  review_code         text not null unique,
  review_scope        text not null default 'global',
  subject_user_id     uuid not null references public.users(id),
  subject_role        text,
  review_type         text not null check (review_type in ('periodic','privileged_access','dormant_account','role_change','scope_review','sensitive_data_access','segregation_of_duties','emergency_access','manual')),
  current_permissions jsonb not null default '{}'::jsonb,
  risk_summary        jsonb not null default '{}'::jsonb,
  conflict_summary    jsonb not null default '{}'::jsonb,
  recommendation      text,
  review_status       text not null default 'draft' check (review_status in ('draft','pending_review','waiting_evidence','approved_reference','reduction_recommended','revocation_recommended','rejected','cancelled','expired','invalidated')),
  reviewer_id         uuid,
  approver_id         uuid,
  decision            text,
  decision_reason     text,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["검토·권고만 — 실제 계정/권한 변경 없음(외부 수동 조치 후 Reference 기록)"]'::jsonb,
  source_version      text not null default 'secgov_v1(0510)',
  input_hash          text not null,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  reviewed_at         timestamptz,
  expires_at          timestamptz
);
create index if not exists idx_sec_review on public.ai_security_access_reviews (review_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Sensitive Data Registry — Metadata 만(Secret 값 저장 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_security_data_registry (
  id                  uuid primary key default gen_random_uuid(),
  data_code           text not null unique,
  domain              text not null check (domain in ('identity','authentication','authorization','admin_access','contract_data','settlement_data','payout_data','account_data','personal_data','storage_access','rpc_security','secrets','audit_logging','retention','privacy_request')),
  table_name          text not null,
  column_name         text,
  storage_location    text not null default 'postgres',
  classification      text not null check (classification in ('public','internal','confidential','sensitive','highly_sensitive','restricted')),
  contains_personal_data  boolean not null default false,
  contains_financial_data boolean not null default false,
  contains_contract_data  boolean not null default false,
  encryption_status   text not null default 'encryption_unverified' check (encryption_status in ('encrypted_at_rest_provider','encryption_unverified','not_applicable')),
  access_logging_status text not null default 'logging_unavailable' check (access_logging_status in ('logged','partially_logged','logging_unavailable','not_applicable')),
  retention_policy_id uuid,
  owner               text,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '[]'::jsonb,
  lifecycle_status    text not null default 'draft' check (lifecycle_status in ('draft','active','deprecated','archived')),
  approved_by         uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Privacy Request — 접수/검토/외부 조치 Reference(실제 삭제 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_privacy_requests (
  id                  uuid primary key default gen_random_uuid(),
  request_code        text not null unique,
  subject_user_id     uuid references public.users(id),
  request_type        text not null check (request_type in ('access','correction','deletion','restriction','export','consent_withdrawal','objection','manual')),
  request_status      text not null default 'new' check (request_status in ('new','identity_verification_required','verified','reviewing','waiting_legal_review','waiting_external_action','completed_reference','partially_completed_reference','rejected','cancelled','expired','invalidated')),
  requested_at        timestamptz not null default now(),
  identity_verified_at timestamptz,
  due_at              timestamptz,
  assigned_to         uuid,
  data_scope          jsonb not null default '[]'::jsonb,
  legal_hold          boolean not null default false,
  retention_exception text,
  action_plan         jsonb not null default '[]'::jsonb,
  external_action_reference jsonb,                 -- 외부 수행 조치 참고 기록(자동 처리 아님)
  decision            text,
  decision_reason     text,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["시스템이 개인정보를 자동 삭제/Export 하지 않음 — 외부 수동 조치 Reference 만"]'::jsonb,
  created_by          uuid,
  reviewed_by         uuid,
  completed_at        timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists idx_privacy_req on public.ai_privacy_requests (request_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Retention Policy — 관리자 입력만(법적 보존기간 임의 생성 없음, seed 0건).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_data_retention_policies (
  id                  uuid primary key default gen_random_uuid(),
  policy_code         text not null,
  data_domain         text not null check (data_domain in ('personal_data','contract_data','settlement_data','payout_data','account_data','audit_logging','playback_events','storage_audio','storage_images')),
  retention_period_days int check (retention_period_days is null or retention_period_days > 0),
  legal_basis         text not null,               -- 근거 없는 보존기간 생성 금지
  contract_requirement boolean not null default false,
  settlement_requirement boolean not null default false,
  deletion_method     text not null default 'deletion_reference_only',
  exception_rules     jsonb not null default '[]'::jsonb,
  effective_from      timestamptz not null default now(),
  effective_to        timestamptz,
  version             int not null default 1 check (version >= 1),
  lifecycle_status    text not null default 'draft' check (lifecycle_status in ('draft','pending_approval','active','superseded','archived','blocked')),
  change_reason       text not null,
  approved_by         uuid,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  unique (policy_code, version)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Compliance Control — 내부 검토용(공식 인증 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_compliance_controls (
  id                  uuid primary key default gen_random_uuid(),
  control_code        text not null unique,
  control_domain      text not null,
  title               text not null,
  description         text,
  requirement         text,
  evidence_sources    jsonb not null default '[]'::jsonb,
  control_status      text not null default 'not_reviewed' check (control_status in ('operating','partially_operating','design_only','gap_detected','not_applicable','not_reviewed','insufficient_data')),
  owner               text,
  reviewer            uuid,
  review_frequency    text default 'quarterly',
  last_reviewed_at    timestamptz,
  next_review_at      timestamptz,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["내부 검토용 — ISO 27001/SOC 2/ISMS 등 공식 인증 아님"]'::jsonb,
  lifecycle_status    text not null default 'draft' check (lifecycle_status in ('draft','active','archived')),
  approved_by         uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Security Event(Audit + External Action Reference 통합 — 테이블 최소화).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_security_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('privileged_access_detected','dormant_account_candidate','inactive_account_assigned','excessive_permission_candidate','scope_unrestricted','segregation_conflict','sensitive_data_access_review_required','audit_gap_detected','rls_gap_detected','rpc_guard_gap_detected','search_path_gap_detected','public_access_candidate','retention_gap_detected','privacy_request_created','privacy_request_updated','access_review_created','access_review_decided','access_reduction_recommended','revocation_recommended','external_action_reference_recorded','privacy_action_reference_recorded','registry_saved','retention_policy_saved','compliance_control_saved','compliance_review_started','compliance_evidence_generated','compliance_not_certified')),
  severity            text not null default 'informational' check (severity in ('informational','low','medium','high','critical')),
  subject_user_id     uuid,
  ref_id              uuid,
  detail              text,
  payload             jsonb,                       -- external action reference 포함(참고 기록)
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_sec_evt on public.ai_security_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Seed — 실존 확인된 민감 데이터 Registry 9건(draft) + Compliance Control
--    6건(not_reviewed — Evidence 없는 operating 표시 금지). Retention seed 0건.
-- ─────────────────────────────────────────────────────────────────────────
insert into public.ai_security_data_registry (data_code, domain, table_name, column_name, storage_location, classification, contains_personal_data, contains_financial_data, contains_contract_data, encryption_status, access_logging_status, evidence, limitations) values
  ('reg_auth_email','personal_data','auth.users','email','postgres','sensitive', true, false, false, 'encrypted_at_rest_provider','logging_unavailable','[{"label":"source","value":"Supabase Auth 기본"}]'::jsonb,'["조회 로그 없음 — 접근 없었다고 단정 불가"]'::jsonb),
  ('reg_payout_account','account_data','payout_accounts','account_number','postgres','highly_sensitive', true, true, false, 'encryption_unverified','partially_logged','[{"label":"source","value":"0060 — 원본 계좌"},{"label":"audit","value":"payout_reveal_audit(0061) 열람 기록"}]'::jsonb,'["컬럼 단위 암호화 확인 불가(encryption_unverified)"]'::jsonb),
  ('reg_settlement_masked','settlement_data','artist_settlements','masked_account_number','postgres','sensitive', true, true, false, 'encrypted_at_rest_provider','logging_unavailable','[{"label":"source","value":"0060 — masked snapshot 만 저장"}]'::jsonb,'[]'::jsonb),
  ('reg_settlement_rows','settlement_data','artist_settlements', null,'postgres','sensitive', false, true, false, 'encrypted_at_rest_provider','logging_unavailable','[{"label":"source","value":"0060 정산 데이터"}]'::jsonb,'["SELECT 로그 없음"]'::jsonb),
  ('reg_contracts','contract_data','artist_contracts', null,'postgres','confidential', true, false, true, 'encrypted_at_rest_provider','logging_unavailable','[{"label":"source","value":"0057 계약"}]'::jsonb,'["조회 로그 없음"]'::jsonb),
  ('reg_audio_url','storage_access','tracks','audio_url','postgres','internal', false, false, false, 'encrypted_at_rest_provider','logging_unavailable','[{"label":"source","value":"0001"}]'::jsonb,'[]'::jsonb),
  ('reg_storage_audio','storage_access','storage.objects','audio bucket','supabase_storage','internal', false, false, false, 'encrypted_at_rest_provider','logging_unavailable','[{"label":"source","value":"storage.from(audio)"}]'::jsonb,'["다운로드 로그 미수집"]'::jsonb),
  ('reg_playback_user','personal_data','playback_events_v2','user_id','postgres','internal', true, false, false, 'encrypted_at_rest_provider','not_applicable','[{"label":"source","value":"0253 — 개인 식별자 포함"}]'::jsonb,'[]'::jsonb),
  ('reg_service_secrets','secrets','edge_functions','RESEND_API_KEY 등 env', 'environment_variable','restricted', false, false, false, 'encryption_unverified','logging_unavailable','[{"label":"source","value":"supabase/functions env 참조"}]'::jsonb,'["Secret 값은 본 Registry 에 저장하지 않음 — 위치 metadata 만"]'::jsonb)
on conflict (data_code) do nothing;

insert into public.ai_compliance_controls (control_code, control_domain, title, requirement, evidence_sources, control_status) values
  ('ctl_admin_guard','authorization','관리자 Guard 적용','모든 admin RPC 는 _admin_growth_guard 검증','["migrations 0472~0510 RPC"]'::jsonb,'not_reviewed'),
  ('ctl_search_path','rpc_security','SECURITY DEFINER search_path 고정','모든 SECURITY DEFINER 함수 set search_path = public','["migrations 전수"]'::jsonb,'not_reviewed'),
  ('ctl_payout_reveal_audit','account_data','계좌 열람 Audit','계좌 원본 열람 시 payout_reveal_audit 기록','["0061"]'::jsonb,'not_reviewed'),
  ('ctl_masked_snapshot','settlement_data','정산 계좌 Masking','정산 snapshot 은 masked_account_number 만 저장','["0060"]'::jsonb,'not_reviewed'),
  ('ctl_ai_audit_chain','audit_logging','AI 운영 Audit 체인','0479~0510 audit/event 테이블 기록','["ai_*_events/audit 테이블"]'::jsonb,'not_reviewed'),
  ('ctl_no_auto_execution','admin_access','자동 실행 금지','AI 는 Production/계정/권한/데이터 자동 변경 불가','["Phase AI-OPS-1~7 설계"]'::jsonb,'not_reviewed')
on conflict (control_code) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Identity Inventory — 실시간 조회(원본 복제/저장 없음, 이메일 마스킹).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_security_identities(p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,200), 500)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_items from (
    select u.id, u.role, u.account_type,
      case when position('@' in coalesce(au.email,'')) > 1
           then left(au.email, 2) || '***' || substring(au.email from position('@' in au.email)) end as masked_email,
      (u.withdrawn_at is null) as is_active,
      (u.role = 'admin') as is_admin,
      au.last_sign_in_at,
      u.created_at,
      'unknown' as mfa_status                       -- MFA 확인 수단 없음 — 임의 판단 금지
    from public.users u
    left join auth.users au on au.id = u.id
    order by (u.role = 'admin') desc, u.created_at desc
    limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'note', '실시간 조회 — 원본 미복제·이메일 마스킹·MFA unknown', 'generated_at', now());
end; $$;
grant execute on function public.admin_security_identities(int) to authenticated;

create or replace function public.admin_security_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'total_accounts', (select count(*) from public.users),
    'active_accounts', (select count(*) from public.users where withdrawn_at is null),
    'admin_accounts', (select count(*) from public.users where role = 'admin' and withdrawn_at is null),
    'withdrawn_admins', (select count(*) from public.users where role = 'admin' and withdrawn_at is not null),
    'roles', (select coalesce(jsonb_object_agg(role, n), '{}'::jsonb) from (select role, count(*) n from public.users group by role) x),
    'reviews_pending', (select count(*) from public.ai_security_access_reviews where review_status in ('draft','pending_review','waiting_evidence')),
    'privacy_requests_open', (select count(*) from public.ai_privacy_requests where request_status not in ('completed_reference','partially_completed_reference','rejected','cancelled','expired','invalidated')),
    'retention_policies_active', (select count(*) from public.ai_data_retention_policies where lifecycle_status = 'active'),
    'registry_items', (select count(*) from public.ai_security_data_registry),
    'controls_not_reviewed', (select count(*) from public.ai_compliance_controls where control_status = 'not_reviewed'),
    'security_events', (select count(*) from public.ai_security_events),
    'generated_at', now()
  ) into v;
  return v;
end; $$;
grant execute on function public.admin_security_summary() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) Access Review — 생성/결정(자동 Role 변경 없음) + 외부 조치 Reference.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_security_access_review_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_security_access_reviews; v_existing public.ai_security_access_reviews; v_role text;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 65536 then raise exception 'payload too large (64KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'review_code','') = '' or coalesce(p_payload->>'idempotency_key','') = '' then raise exception 'review_code/idempotency_key 필수' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  select role into v_role from public.users where id = (p_payload->>'subject_user_id')::uuid;
  if v_role is null then raise exception 'subject user 미존재' using errcode='P0002'; end if;
  select * into v_existing from public.ai_security_access_reviews where idempotency_key = p_payload->>'idempotency_key';
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'review', to_jsonb(v_existing)); end if;
  insert into public.ai_security_access_reviews (review_code, review_scope, subject_user_id, subject_role, review_type, current_permissions, risk_summary, conflict_summary, review_status, evidence, input_hash, idempotency_key, created_by)
  values (p_payload->>'review_code', coalesce(nullif(p_payload->>'review_scope',''),'global'),
    (p_payload->>'subject_user_id')::uuid, v_role, coalesce(nullif(p_payload->>'review_type',''),'manual'),
    coalesce(p_payload->'current_permissions','{}'::jsonb), coalesce(p_payload->'risk_summary','{}'::jsonb), coalesce(p_payload->'conflict_summary','{}'::jsonb),
    'pending_review', p_payload->'evidence',
    md5(coalesce(p_payload->>'subject_user_id','') || '|' || coalesce(p_payload->>'review_type','') || '|' || coalesce(p_payload->>'review_code','')),
    p_payload->>'idempotency_key', auth.uid())
  returning * into v_row;
  insert into public.ai_security_events(event_type, severity, subject_user_id, ref_id, detail, actor_id)
  values ('access_review_created', 'informational', v_row.subject_user_id, v_row.id, v_row.review_code, auth.uid());
  return jsonb_build_object('idempotent', false, 'review', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_security_access_review_create(jsonb) to authenticated;

create or replace function public.admin_security_access_review_decide(p_id uuid, p_status text, p_recommendation text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_security_access_reviews;
begin
  perform public._admin_growth_guard();
  if p_status is null or p_status not in ('pending_review','waiting_evidence','approved_reference','reduction_recommended','revocation_recommended','rejected','cancelled','expired','invalidated') then
    raise exception 'invalid status(실제 권한 변경 상태 없음)' using errcode='22023';
  end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  select * into v_row from public.ai_security_access_reviews where id = p_id;
  if v_row.id is null then raise exception 'review not found' using errcode='P0002'; end if;
  if v_row.review_status in ('rejected','cancelled','expired','invalidated') then raise exception 'review finalized' using errcode='22023'; end if;
  update public.ai_security_access_reviews set review_status = p_status,
    recommendation = coalesce(nullif(p_recommendation,''), recommendation),
    decision = p_status, decision_reason = p_reason,
    reviewer_id = coalesce(reviewer_id, auth.uid()), approver_id = auth.uid(), reviewed_at = now()
  where id = p_id returning * into v_row;
  insert into public.ai_security_events(event_type, severity, subject_user_id, ref_id, detail, actor_id)
  values (case p_status when 'reduction_recommended' then 'access_reduction_recommended'
                        when 'revocation_recommended' then 'revocation_recommended'
                        else 'access_review_decided' end,
          case when p_status = 'revocation_recommended' then 'high' else 'informational' end,
          v_row.subject_user_id, p_id, p_reason, auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_security_access_review_decide(uuid, text, text, text) to authenticated;

create or replace function public.admin_security_access_reviews(p_status text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_security_access_reviews r where (p_status is null or r.review_status = p_status)
    order by r.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_security_access_reviews(text, int) to authenticated;

create or replace function public.admin_security_external_action_reference(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'action_type','') not in ('account_disabled_reference','account_enabled_reference','role_changed_reference','scope_reduced_reference','permission_revoked_reference','password_reset_reference','mfa_enabled_reference','session_revoked_reference','credential_rotated_reference') then
    raise exception 'invalid action_type(참고 기록 전용 — 실행 아님)' using errcode='22023';
  end if;
  if coalesce(p_payload->>'performed_by','') = '' or coalesce(p_payload->>'performed_at','') = '' or coalesce(p_payload->>'external_system','') = '' then
    raise exception 'performed_by/performed_at/external_system 필수(외부 수행 기록)' using errcode='22023';
  end if;
  insert into public.ai_security_events(event_type, severity, subject_user_id, detail, payload, actor_id)
  values ('external_action_reference_recorded', 'informational', nullif(p_payload->>'subject_user_id','')::uuid,
    p_payload->>'action_type', p_payload, auth.uid())
  returning id into v_id;
  return jsonb_build_object('recorded', true, 'event_id', v_id, 'note', '외부 수행 참고 기록 — 시스템이 조치를 실행하지 않음');
end; $$;
grant execute on function public.admin_security_external_action_reference(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) Data Registry / Retention / Compliance Control 저장(관리자 승인).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_security_data_registry_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_row public.ai_security_data_registry;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'data_code','') = '' then raise exception 'data_code required' using errcode='22023'; end if;
  if coalesce(p_payload->>'change_reason','') = '' then raise exception 'change_reason required' using errcode='22023'; end if;
  if p_payload ? 'secret_value' or p_payload ? 'token' or p_payload ? 'password' then raise exception 'Secret 값 저장 금지 — metadata 만' using errcode='22023'; end if;
  select id into v_id from public.ai_security_data_registry where data_code = p_payload->>'data_code';
  if v_id is null then
    if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;
    insert into public.ai_security_data_registry (data_code, domain, table_name, column_name, storage_location, classification, contains_personal_data, contains_financial_data, contains_contract_data, encryption_status, access_logging_status, owner, evidence, limitations, lifecycle_status, approved_by)
    values (p_payload->>'data_code', p_payload->>'domain', p_payload->>'table_name', nullif(p_payload->>'column_name',''),
      coalesce(nullif(p_payload->>'storage_location',''),'postgres'), p_payload->>'classification',
      coalesce((p_payload->>'contains_personal_data')::boolean, false), coalesce((p_payload->>'contains_financial_data')::boolean, false), coalesce((p_payload->>'contains_contract_data')::boolean, false),
      coalesce(nullif(p_payload->>'encryption_status',''),'encryption_unverified'), coalesce(nullif(p_payload->>'access_logging_status',''),'logging_unavailable'),
      nullif(p_payload->>'owner',''), p_payload->'evidence', coalesce(p_payload->'limitations','[]'::jsonb),
      coalesce(nullif(p_payload->>'lifecycle_status',''),'draft'), auth.uid())
    returning id into v_id;
  else
    update public.ai_security_data_registry set
      classification = coalesce(nullif(p_payload->>'classification',''), classification),
      encryption_status = coalesce(nullif(p_payload->>'encryption_status',''), encryption_status),
      access_logging_status = coalesce(nullif(p_payload->>'access_logging_status',''), access_logging_status),
      retention_policy_id = coalesce(nullif(p_payload->>'retention_policy_id','')::uuid, retention_policy_id),
      lifecycle_status = coalesce(nullif(p_payload->>'lifecycle_status',''), lifecycle_status),
      evidence = coalesce(p_payload->'evidence', evidence),
      approved_by = auth.uid(), updated_at = now()
    where id = v_id;
  end if;
  insert into public.ai_security_events(event_type, ref_id, detail, actor_id) values ('registry_saved', v_id, p_payload->>'change_reason', auth.uid());
  select * into v_row from public.ai_security_data_registry where id = v_id;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_security_data_registry_save(jsonb) to authenticated;

create or replace function public.admin_security_data_registry(p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.classification desc, t.data_code), '[]'::jsonb) into v_items from (
    select * from public.ai_security_data_registry limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_security_data_registry(int) to authenticated;

create or replace function public.admin_retention_policy_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prev public.ai_data_retention_policies; v_row public.ai_data_retention_policies; v_version int := 1;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'policy_code','') = '' or coalesce(p_payload->>'legal_basis','') = '' then
    raise exception 'policy_code/legal_basis 필수 — 법적 근거 없는 보존기간 생성 금지' using errcode='22023';
  end if;
  if coalesce(p_payload->>'change_reason','') = '' then raise exception 'change_reason required (AI 직접 변경 금지)' using errcode='22023'; end if;
  select * into v_prev from public.ai_data_retention_policies where policy_code = p_payload->>'policy_code' order by version desc limit 1;
  if v_prev.id is not null then v_version := v_prev.version + 1;
    update public.ai_data_retention_policies set lifecycle_status = 'superseded', effective_to = now() where id = v_prev.id and lifecycle_status in ('draft','pending_approval','active');
  end if;
  insert into public.ai_data_retention_policies (policy_code, data_domain, retention_period_days, legal_basis, contract_requirement, settlement_requirement, deletion_method, exception_rules, version, lifecycle_status, change_reason, approved_by, created_by)
  values (p_payload->>'policy_code', p_payload->>'data_domain', nullif(p_payload->>'retention_period_days','')::int,
    p_payload->>'legal_basis', coalesce((p_payload->>'contract_requirement')::boolean, false), coalesce((p_payload->>'settlement_requirement')::boolean, false),
    'deletion_reference_only', coalesce(p_payload->'exception_rules','[]'::jsonb), v_version,
    coalesce(nullif(p_payload->>'lifecycle_status',''),'draft'), p_payload->>'change_reason',
    case when coalesce(nullif(p_payload->>'lifecycle_status',''),'draft') = 'active' then auth.uid() end, auth.uid())
  returning * into v_row;
  insert into public.ai_security_events(event_type, ref_id, detail, actor_id) values ('retention_policy_saved', v_row.id, format('%s v%s', v_row.policy_code, v_version), auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_retention_policy_save(jsonb) to authenticated;

create or replace function public.admin_retention_policies(p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.policy_code, t.version desc), '[]'::jsonb) into v_items from (
    select * from public.ai_data_retention_policies order by policy_code, version desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_retention_policies(int) to authenticated;

create or replace function public.admin_compliance_control_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_row public.ai_compliance_controls; v_status text := nullif(p_payload->>'control_status','');
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'control_code','') = '' then raise exception 'control_code required' using errcode='22023'; end if;
  if coalesce(p_payload->>'change_reason','') = '' then raise exception 'change_reason required' using errcode='22023'; end if;
  if v_status = 'operating' and (p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0) then
    raise exception 'Evidence 없는 Control 을 operating 으로 표시 금지' using errcode='22023';
  end if;
  select id into v_id from public.ai_compliance_controls where control_code = p_payload->>'control_code';
  if v_id is null then
    insert into public.ai_compliance_controls (control_code, control_domain, title, description, requirement, evidence_sources, control_status, owner, evidence, lifecycle_status, approved_by)
    values (p_payload->>'control_code', coalesce(nullif(p_payload->>'control_domain',''),'general'), coalesce(nullif(p_payload->>'title',''), p_payload->>'control_code'),
      nullif(p_payload->>'description',''), nullif(p_payload->>'requirement',''), coalesce(p_payload->'evidence_sources','[]'::jsonb),
      coalesce(v_status,'not_reviewed'), nullif(p_payload->>'owner',''), coalesce(p_payload->'evidence','[]'::jsonb),
      coalesce(nullif(p_payload->>'lifecycle_status',''),'draft'), auth.uid())
    returning id into v_id;
  else
    update public.ai_compliance_controls set
      control_status = coalesce(v_status, control_status),
      evidence = coalesce(p_payload->'evidence', evidence),
      last_reviewed_at = now(), reviewer = auth.uid(), approved_by = auth.uid(), updated_at = now()
    where id = v_id;
  end if;
  insert into public.ai_security_events(event_type, ref_id, detail, actor_id) values ('compliance_control_saved', v_id, p_payload->>'change_reason', auth.uid());
  select * into v_row from public.ai_compliance_controls where id = v_id;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_compliance_control_save(jsonb) to authenticated;

create or replace function public.admin_compliance_controls(p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.control_code), '[]'::jsonb) into v_items from (
    select * from public.ai_compliance_controls limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_compliance_controls(int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 11) Privacy Request — 접수/검토/외부 조치 Reference(자동 삭제 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_privacy_request_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_privacy_requests;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 65536 then raise exception 'payload too large (64KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'request_code','') = '' then raise exception 'request_code required' using errcode='22023'; end if;
  if coalesce(p_payload->>'request_type','') not in ('access','correction','deletion','restriction','export','consent_withdrawal','objection','manual') then raise exception 'invalid request_type' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  if nullif(p_payload->>'subject_user_id','') is not null and not exists (select 1 from public.users where id = (p_payload->>'subject_user_id')::uuid) then
    raise exception 'subject user 미존재' using errcode='P0002';
  end if;
  insert into public.ai_privacy_requests (request_code, subject_user_id, request_type, due_at, data_scope, legal_hold, evidence, created_by)
  values (p_payload->>'request_code', nullif(p_payload->>'subject_user_id','')::uuid, p_payload->>'request_type',
    nullif(p_payload->>'due_at','')::timestamptz, coalesce(p_payload->'data_scope','[]'::jsonb),
    coalesce((p_payload->>'legal_hold')::boolean, false), p_payload->'evidence', auth.uid())
  returning * into v_row;
  insert into public.ai_security_events(event_type, subject_user_id, ref_id, detail, actor_id) values ('privacy_request_created', v_row.subject_user_id, v_row.id, v_row.request_type, auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_privacy_request_create(jsonb) to authenticated;

create or replace function public.admin_privacy_request_update(p_id uuid, p_section text, p_value jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_privacy_requests; v_status text;
begin
  perform public._admin_growth_guard();
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  if p_section is null or p_section not in ('status','action_reference') then raise exception 'invalid section' using errcode='22023'; end if;
  select * into v_row from public.ai_privacy_requests where id = p_id;
  if v_row.id is null then raise exception 'privacy request not found' using errcode='P0002'; end if;
  if v_row.request_status in ('rejected','cancelled','expired','invalidated') then raise exception 'request finalized' using errcode='22023'; end if;

  if p_section = 'status' then
    v_status := p_value->>'status';
    if v_status is null or v_status not in ('identity_verification_required','verified','reviewing','waiting_legal_review','waiting_external_action','completed_reference','partially_completed_reference','rejected','cancelled','expired','invalidated') then
      raise exception 'invalid status(자동 처리 완료 상태 없음)' using errcode='22023';
    end if;
    if v_status in ('completed_reference','partially_completed_reference') and v_row.external_action_reference is null and p_value->'external_action_reference' is null then
      raise exception '외부 조치 Reference 없는 completed_reference 금지(실제 삭제/처리 없이 완료 표시 금지)' using errcode='22023';
    end if;
    update public.ai_privacy_requests set request_status = v_status,
      identity_verified_at = case when v_status = 'verified' then now() else identity_verified_at end,
      external_action_reference = coalesce(p_value->'external_action_reference', external_action_reference),
      decision = v_status, decision_reason = p_reason, reviewed_by = auth.uid(),
      completed_at = case when v_status in ('completed_reference','partially_completed_reference') then now() else completed_at end
    where id = p_id;
  else
    -- 외부 수행 조치 참고 기록(자동 처리 아님).
    if coalesce(p_value->>'action_type','') not in ('data_exported_reference','profile_corrected_reference','account_deleted_reference','personal_data_deleted_reference','access_restricted_reference','consent_withdrawn_reference','request_rejected_reference') then
      raise exception 'invalid action_type(참고 기록 전용)' using errcode='22023';
    end if;
    if coalesce(p_value->>'performed_by','') = '' or coalesce(p_value->>'performed_at','') = '' then raise exception 'performed_by/performed_at 필수' using errcode='22023'; end if;
    update public.ai_privacy_requests set external_action_reference = p_value where id = p_id;
  end if;
  insert into public.ai_security_events(event_type, subject_user_id, ref_id, detail, payload, actor_id)
  values (case when p_section = 'status' then 'privacy_request_updated' else 'privacy_action_reference_recorded' end, v_row.subject_user_id, p_id, p_reason, p_value, auth.uid());
  select * into v_row from public.ai_privacy_requests where id = p_id;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_privacy_request_update(uuid, text, jsonb, text) to authenticated;

create or replace function public.admin_privacy_requests(p_status text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_privacy_requests r where (p_status is null or r.request_status = p_status)
    order by r.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_privacy_requests(text, int) to authenticated;

create or replace function public.admin_security_audit(p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,200), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_security_events order by created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_security_audit(int) to authenticated;
