-- 0470 — Phase AI-MUSIC-7: Preview Runtime Canary & Internal Test Store Certification
--
-- 목적:
--   Shadow Resolution 결과를 Production Store 에 적용하지 않고, *Preview 환경의 명시적으로 허용된 내부 테스트
--   Store* 에만 제한적으로 연결해 실제 Runtime 경로를 검증하기 위한 격리 계층. Production Pilot 이 아니다.
--   일반 Store / 실제 프랜차이즈 Store / Production Player 에는 절대 적용하지 않는다. 판정(env/allowlist/
--   approval/queue/resolver/guardrail/certification)은 전부 클라이언트 규칙 엔진(src/lib/aiPreviewCanary)에서
--   수행하고, 이 migration 은 (1) Allowlist/Run/Session/Queue-Snapshot/Event/Certification/Action 저장용 신규
--   격리 테이블, (2) Preview 환경 + Deployment + Allowlist + Super-Admin + State-allowlist + Version/Snapshot 을
--   서버에서 강제하는 RPC 를 제공한다. LLM/ML 없음.
--
-- 안전 (절대):
--   • Additive Only. 신규 격리 테이블 7 + 신규 RPC. 기존 테이블/뷰/RLS/데이터/Playlist/Store/Playback/Queue/
--     Resolver RPC 무변경. 기존 Playlist/Store Playlist 를 UPDATE 하지 않는다. Canary Event 는 실제 재생에 사용
--     되지 않는다. 기존 Playlist Track 구성/Ranking/Settlement/Streaming/Governance 의미 무변경.
--   • Production Environment write 거부: 모든 write RPC 는 p_environment='preview' 가 아니면 예외. Allowlist 는
--     environment='preview' 만 허용(Wildcard 금지, 자동 추가 금지, 만료 필수). Store attribution 서버 검증.
--   • Production Apply 금지. Preview / rollback-txn(synthetic) 검증 전용. 운영 head 는 0453 유지. (Production DB 에
--     이 migration 이 적용되지 않으므로 Canary RPC 는 Production 에 존재조차 하지 않는다 — 구조적 최종 방어.)
--   • Security Definer + _is_super_admin() 게이트 + search_path 고정 + 파라미터 바인딩 + batch/row/time 상한 +
--     auth.uid() actor 기록 + State transition allowlist. Dynamic SQL 없음.

-- ─────────────────────────────────────────────────────────────────────
-- 1) 신규 격리 테이블
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_music_preview_canary_allowlist (
  id                    uuid primary key default gen_random_uuid(),
  store_uid             uuid not null,
  environment           text not null default 'preview' check (environment = 'preview'),   -- production 절대 불가
  purpose               text not null,
  approved_by           uuid,
  approved_at           timestamptz not null default now(),
  expires_at            timestamptz not null,                    -- 만료 필수
  enabled               boolean not null default true,
  max_sessions          int not null default 1 check (max_sessions >= 0 and max_sessions <= 20),
  allowed_candidate_playlist_id text,
  allowed_candidate_version int,
  notes                 text,
  created_by            uuid,
  created_at            timestamptz not null default now()
);
comment on table public.ai_music_preview_canary_allowlist is 'AI-MUSIC-7 내부 테스트 Store Allowlist. preview 전용, 만료 필수, Wildcard/자동추가 금지. 일반/프랜차이즈 Store 아님.';
create unique index if not exists ampca_store_uq on public.ai_music_preview_canary_allowlist (store_uid) where enabled;

create table if not exists public.ai_music_preview_canary_runs (
  id                    uuid primary key default gen_random_uuid(),
  pilot_run_id          uuid,
  store_uid             uuid not null,
  environment           text not null check (environment = 'preview'),
  deployment_id         text not null,                           -- 승인 시 고정된 허용 Deployment
  candidate_playlist_id text,
  candidate_version     int,
  candidate_snapshot_hash text,
  state                 text not null default 'DRAFT'
                          check (state in ('DRAFT','REVIEW_REQUIRED','APPROVED','ARMED','ACTIVE','PAUSED',
                                           'STOP_REQUESTED','STOPPED','ROLLBACK_REQUESTED','ROLLED_BACK',
                                           'COMPLETED','FAILED','EXPIRED','CANCELLED')),
  scheduled_start       timestamptz, scheduled_end timestamptz, expiry timestamptz,
  approved_by           uuid, approved_at timestamptz, approval_reason text,
  created_by            uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
comment on table public.ai_music_preview_canary_runs is 'AI-MUSIC-7 Preview Canary Run. state 전이는 운영자 승인 RPC 로만. 승인≠활성화. 원본 Playlist/Player 무변경.';
create index if not exists ampcr_state_idx on public.ai_music_preview_canary_runs (state, created_at desc);

create table if not exists public.ai_music_preview_canary_sessions (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid not null references public.ai_music_preview_canary_runs(id) on delete cascade,
  store_uid             uuid not null,
  session_hash          text not null,
  state                 text not null default 'ACTIVE' check (state in ('ACTIVE','PAUSED','ENDED')),
  started_at            timestamptz not null default now(),
  ended_at              timestamptz
);
create index if not exists ampcs_run_idx on public.ai_music_preview_canary_sessions (run_id, started_at desc);

create table if not exists public.ai_music_preview_canary_queue_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid not null references public.ai_music_preview_canary_runs(id) on delete cascade,
  kind                  text not null check (kind in ('candidate','existing')),
  snapshot_hash         text not null,
  payload               jsonb not null default '{}'::jsonb,      -- hash/count only (no URLs/titles/PII)
  created_by            uuid, created_at timestamptz not null default now()
);
comment on table public.ai_music_preview_canary_queue_snapshots is 'AI-MUSIC-7 Candidate/Existing Queue Snapshot(hash/count 전용). 복원 원본 아님 — 검증·감사용.';
create index if not exists ampcqs_run_idx on public.ai_music_preview_canary_queue_snapshots (run_id, kind, created_at desc);

create table if not exists public.ai_music_preview_canary_events (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid references public.ai_music_preview_canary_runs(id) on delete cascade,
  store_uid             uuid not null,
  session_hash          text not null,
  event_name            text not null,
  outcome               text,
  boundary_type         text,
  existing_playlist_hash text, canary_playlist_hash text,
  candidate_version     int, candidate_snapshot_hash text,
  evaluated_at          timestamptz not null default now(),
  created_at            timestamptz not null default now()
);
comment on table public.ai_music_preview_canary_events is 'AI-MUSIC-7 저빈도 Canary Runtime Evidence Event(hash 전용). 제목/트랙/URL/PII 없음. 실제 재생 미사용.';
create index if not exists ampce_run_idx on public.ai_music_preview_canary_events (run_id, evaluated_at desc);
create index if not exists ampce_session_idx on public.ai_music_preview_canary_events (session_hash, evaluated_at desc);

create table if not exists public.ai_music_preview_canary_certifications (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid references public.ai_music_preview_canary_runs(id) on delete cascade,
  score                 numeric,
  cert_status           text not null,
  production_readiness   text not null,
  components            jsonb not null default '{}'::jsonb,
  blockers              jsonb not null default '[]'::jsonb,
  limitations           jsonb not null default '[]'::jsonb,
  created_by            uuid, created_at timestamptz not null default now()
);
comment on table public.ai_music_preview_canary_certifications is 'AI-MUSIC-7 Preview Runtime Certification 스냅샷. 내부 Preview 전용 — Production Ready 아님. 실제 Production Canary 승인 아님.';
create index if not exists ampcc_run_idx on public.ai_music_preview_canary_certifications (run_id, created_at desc);

create table if not exists public.ai_music_preview_canary_actions (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid references public.ai_music_preview_canary_runs(id) on delete cascade,
  action                text not null, from_state text, to_state text, actor uuid, reason text,
  created_at            timestamptz not null default now()
);
comment on table public.ai_music_preview_canary_actions is 'AI-MUSIC-7 전체 감사 추적(append-only 용도). 모든 운영자 승인/전이 기록. 자동 실행 아님.';
create index if not exists ampca_act_run_idx on public.ai_music_preview_canary_actions (run_id, created_at desc);

-- RLS: 관리자 read; writes via RPC only.
do $$ declare t text;
begin
  foreach t in array array['ai_music_preview_canary_allowlist','ai_music_preview_canary_runs','ai_music_preview_canary_sessions','ai_music_preview_canary_queue_snapshots','ai_music_preview_canary_events','ai_music_preview_canary_certifications','ai_music_preview_canary_actions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_super_admin_read', t);
    execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_super_admin_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Preview-environment guard + state-transition allowlist helpers
-- ─────────────────────────────────────────────────────────────────────
-- Production 환경 write 거부: environment 는 반드시 'preview'. (DB 는 Vercel env 를 직접 알 수 없으므로 최종
-- 방어는 "이 migration 을 Production 에 적용하지 않음"이며, 여기서는 명시적 환경 인자를 강제한다.)
create or replace function public._ai_canary_require_preview(p_environment text)
returns void language plpgsql immutable set search_path = public as $$
begin
  if coalesce(p_environment,'') <> 'preview' then
    raise exception 'ENVIRONMENT_BLOCKED: preview only (got %)', coalesce(p_environment,'null');
  end if;
end; $$;
revoke execute on function public._ai_canary_require_preview(text) from public;

create or replace function public._ai_canary_can_transition(p_from text, p_to text)
returns boolean language sql immutable set search_path = public as $$
  select case p_from
    when 'DRAFT' then p_to = any(array['REVIEW_REQUIRED','CANCELLED'])
    when 'REVIEW_REQUIRED' then p_to = any(array['APPROVED','DRAFT','CANCELLED'])
    when 'APPROVED' then p_to = any(array['ARMED','CANCELLED','EXPIRED'])
    when 'ARMED' then p_to = any(array['ACTIVE','CANCELLED','EXPIRED'])
    when 'ACTIVE' then p_to = any(array['PAUSED','STOP_REQUESTED','COMPLETED','FAILED','EXPIRED'])
    when 'PAUSED' then p_to = any(array['ACTIVE','STOP_REQUESTED','FAILED','EXPIRED'])
    when 'STOP_REQUESTED' then p_to = any(array['STOPPED','FAILED'])
    when 'STOPPED' then p_to = any(array['ROLLBACK_REQUESTED','COMPLETED'])
    when 'ROLLBACK_REQUESTED' then p_to = any(array['ROLLED_BACK','FAILED'])
    else false end;
$$;
revoke execute on function public._ai_canary_can_transition(text,text) from public;

create or replace function public._ai_canary_apply_transition(p_run uuid, p_to text, p_action text, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare v_from text; v_env text;
begin
  select state, environment into v_from, v_env from public.ai_music_preview_canary_runs where id = p_run for update;
  if v_from is null then raise exception 'canary run not found'; end if;
  perform public._ai_canary_require_preview(v_env);
  if v_from = p_to then raise exception 'invalid transition: same state (%)', v_from; end if;
  if not public._ai_canary_can_transition(v_from, p_to) then raise exception 'forbidden transition: % -> %', v_from, p_to; end if;
  update public.ai_music_preview_canary_runs set state = p_to, updated_at = now() where id = p_run;
  insert into public.ai_music_preview_canary_actions (run_id, action, from_state, to_state, actor, reason)
    values (p_run, coalesce(p_action,'TRANSITION'), v_from, p_to, auth.uid(), left(coalesce(p_reason,''),1000));
  return v_from;
end; $$;
revoke execute on function public._ai_canary_apply_transition(uuid,text,text,text) from public;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Allowlist write (super-admin, preview only, expiry required, no wildcard)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.record_ai_preview_canary_allowlist(
  p_store uuid, p_environment text, p_purpose text, p_expires_at timestamptz, p_max_sessions int,
  p_candidate_playlist text, p_candidate_version int, p_notes text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  perform public._ai_canary_require_preview(p_environment);
  if p_store is null then raise exception 'store required (no wildcard)'; end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'expiry required (future)'; end if;
  insert into public.ai_music_preview_canary_allowlist (store_uid, environment, purpose, approved_by, approved_at, expires_at, enabled, max_sessions, allowed_candidate_playlist_id, allowed_candidate_version, notes, created_by)
    values (p_store, 'preview', left(coalesce(p_purpose,'internal test'),200), auth.uid(), now(), p_expires_at, true,
            least(greatest(coalesce(p_max_sessions,1),0),20), nullif(p_candidate_playlist,''), p_candidate_version, left(coalesce(p_notes,''),500), auth.uid())
  on conflict (store_uid) where enabled do update set purpose = excluded.purpose, expires_at = excluded.expires_at,
    max_sessions = excluded.max_sessions, allowed_candidate_playlist_id = excluded.allowed_candidate_playlist_id,
    allowed_candidate_version = excluded.allowed_candidate_version, notes = excluded.notes
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'note', 'preview internal test store allowlisted — expiry required, no wildcard');
end; $$;
revoke execute on function public.record_ai_preview_canary_allowlist(uuid,text,text,timestamptz,int,text,int,text) from public;
do $$ begin begin grant execute on function public.record_ai_preview_canary_allowlist(uuid,text,text,timestamptz,int,text,int,text) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.set_ai_preview_canary_allowlist_enabled(p_store uuid, p_enabled boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  update public.ai_music_preview_canary_allowlist set enabled = coalesce(p_enabled,false) where store_uid = p_store;
  return jsonb_build_object('ok', true, 'note', 'allowlist entry toggled');
end; $$;
revoke execute on function public.set_ai_preview_canary_allowlist_enabled(uuid,boolean,text) from public;
do $$ begin begin grant execute on function public.set_ai_preview_canary_allowlist_enabled(uuid,boolean,text) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4) Approval — Run 생성. state=APPROVED. 활성화 아님(Arm/Activate 별도).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.record_ai_preview_canary_approval(
  p_pilot_run uuid, p_store uuid, p_environment text, p_deployment_id text,
  p_candidate_playlist text, p_candidate_version int, p_candidate_snapshot_hash text,
  p_scheduled_start timestamptz, p_scheduled_end timestamptz, p_expiry timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_allow public.ai_music_preview_canary_allowlist;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  perform public._ai_canary_require_preview(p_environment);
  if p_deployment_id is null or p_deployment_id = '' then raise exception 'deployment id required'; end if;
  if p_candidate_version is null then raise exception 'candidate version must be pinned'; end if;
  if p_expiry is null then raise exception 'expiry required'; end if;
  -- Store 는 반드시 활성·미만료 preview allowlist 에 존재해야 한다.
  select * into v_allow from public.ai_music_preview_canary_allowlist where store_uid = p_store and enabled limit 1;
  if v_allow.id is null then raise exception 'STORE_NOT_ALLOWED: not an enabled internal test store'; end if;
  if v_allow.expires_at <= now() then raise exception 'STORE_NOT_ALLOWED: allowlist expired'; end if;
  if v_allow.allowed_candidate_playlist_id is not null and coalesce(p_candidate_playlist,'') <> v_allow.allowed_candidate_playlist_id then raise exception 'CANDIDATE_OUT_OF_SCOPE (playlist)'; end if;
  if v_allow.allowed_candidate_version is not null and coalesce(p_candidate_version,-1) <> v_allow.allowed_candidate_version then raise exception 'CANDIDATE_OUT_OF_SCOPE (version)'; end if;

  insert into public.ai_music_preview_canary_runs (pilot_run_id, store_uid, environment, deployment_id, candidate_playlist_id, candidate_version, candidate_snapshot_hash, state, scheduled_start, scheduled_end, expiry, approved_by, approved_at, approval_reason, created_by)
    values (p_pilot_run, p_store, 'preview', p_deployment_id, nullif(p_candidate_playlist,''), p_candidate_version, nullif(p_candidate_snapshot_hash,''), 'APPROVED', p_scheduled_start, p_scheduled_end, p_expiry, auth.uid(), now(), left(coalesce(p_reason,''),1000), auth.uid())
    returning id into v_id;
  insert into public.ai_music_preview_canary_actions (run_id, action, from_state, to_state, actor, reason)
    values (v_id, 'APPROVAL_RECORDED', 'DRAFT', 'APPROVED', auth.uid(), 'approval stored — NOT armed/activated');
  return jsonb_build_object('ok', true, 'id', v_id, 'note', 'APPROVED (preview) — Arm/Activate 별도 필요. Runtime Queue 미영향.');
end; $$;
revoke execute on function public.record_ai_preview_canary_approval(uuid,uuid,text,text,text,int,text,timestamptz,timestamptz,timestamptz,text) from public;
do $$ begin begin grant execute on function public.record_ai_preview_canary_approval(uuid,uuid,text,text,text,int,text,timestamptz,timestamptz,timestamptz,text) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5) Arm / Activate / Pause / Stop(req→confirm) / Rollback(req→confirm) / Complete / Cancel
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.arm_ai_preview_canary(p_run uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin if not public._is_super_admin() then raise exception 'forbidden'; end if;
  perform public._ai_canary_apply_transition(p_run, 'ARMED', 'ARM', p_reason);
  return jsonb_build_object('ok', true, 'state', 'ARMED', 'note', 'armed — not active; Runtime Queue 미영향'); end; $$;
create or replace function public.activate_ai_preview_canary(p_run uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_run public.ai_music_preview_canary_runs;
begin if not public._is_super_admin() then raise exception 'forbidden'; end if;
  select * into v_run from public.ai_music_preview_canary_runs where id = p_run for update;
  if v_run.id is null then raise exception 'not found'; end if;
  if v_run.expiry is not null and v_run.expiry <= now() then raise exception 'expired'; end if;
  perform public._ai_canary_apply_transition(p_run, 'ACTIVE', 'ACTIVATE', p_reason);
  insert into public.ai_music_preview_canary_sessions (run_id, store_uid, session_hash, state)
    values (p_run, v_run.store_uid, left(md5(p_run::text || now()::text),16), 'ACTIVE');
  return jsonb_build_object('ok', true, 'state', 'ACTIVE', 'note', 'active (preview) — Candidate 적용은 안전한 다음 경계에서만, 실제 setQueue 적용은 DEFERRED'); end; $$;
create or replace function public.pause_ai_preview_canary(p_run uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin if not public._is_super_admin() then raise exception 'forbidden'; end if;
  perform public._ai_canary_apply_transition(p_run, 'PAUSED', 'PAUSE', p_reason);
  update public.ai_music_preview_canary_sessions set state='PAUSED' where run_id=p_run and state='ACTIVE';
  return jsonb_build_object('ok', true, 'state', 'PAUSED'); end; $$;
create or replace function public.request_ai_preview_canary_stop(p_run uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin if not public._is_super_admin() then raise exception 'forbidden'; end if;
  perform public._ai_canary_apply_transition(p_run, 'STOP_REQUESTED', 'REQUEST_STOP', p_reason);
  return jsonb_build_object('ok', true, 'state', 'STOP_REQUESTED', 'note', 'stop requested — confirm 별도'); end; $$;
create or replace function public.stop_ai_preview_canary(p_run uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin if not public._is_super_admin() then raise exception 'forbidden'; end if;
  perform public._ai_canary_apply_transition(p_run, 'STOPPED', 'STOP', p_reason);
  update public.ai_music_preview_canary_sessions set state='ENDED', ended_at=now() where run_id=p_run and state<>'ENDED';
  return jsonb_build_object('ok', true, 'state', 'STOPPED', 'note', '기존 Playlist Resolution 경로 사용 — 현재 Track 강제 중단 없음'); end; $$;
create or replace function public.request_ai_preview_canary_rollback(p_run uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin if not public._is_super_admin() then raise exception 'forbidden'; end if;
  perform public._ai_canary_apply_transition(p_run, 'ROLLBACK_REQUESTED', 'REQUEST_ROLLBACK', p_reason);
  return jsonb_build_object('ok', true, 'state', 'ROLLBACK_REQUESTED', 'note', 'rollback requested — confirm 별도'); end; $$;
create or replace function public.rollback_ai_preview_canary(p_run uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin if not public._is_super_admin() then raise exception 'forbidden'; end if;
  perform public._ai_canary_apply_transition(p_run, 'ROLLED_BACK', 'ROLLBACK', p_reason);
  update public.ai_music_preview_canary_sessions set state='ENDED', ended_at=now() where run_id=p_run and state<>'ENDED';
  return jsonb_build_object('ok', true, 'state', 'ROLLED_BACK', 'note', '다음 안전한 경계에서 기존 Playlist Queue 사용 — 원본 Playlist UPDATE 아님'); end; $$;
create or replace function public.complete_ai_preview_canary(p_run uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin if not public._is_super_admin() then raise exception 'forbidden'; end if;
  perform public._ai_canary_apply_transition(p_run, 'COMPLETED', 'COMPLETE', p_reason);
  update public.ai_music_preview_canary_sessions set state='ENDED', ended_at=now() where run_id=p_run and state<>'ENDED';
  return jsonb_build_object('ok', true, 'state', 'COMPLETED'); end; $$;
do $$ declare f text; begin
  foreach f in array array[
    'arm_ai_preview_canary(uuid,text)','activate_ai_preview_canary(uuid,text)','pause_ai_preview_canary(uuid,text)',
    'request_ai_preview_canary_stop(uuid,text)','stop_ai_preview_canary(uuid,text)','request_ai_preview_canary_rollback(uuid,text)',
    'rollback_ai_preview_canary(uuid,text)','complete_ai_preview_canary(uuid,text)'] loop
    execute format('revoke execute on function public.%s from public', f);
    begin execute format('grant execute on function public.%s to authenticated', f); exception when undefined_object then null; end;
  end loop; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 6) Queue snapshot record + event ingest + certification record
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.record_ai_preview_canary_queue_snapshot(p_run uuid, p_kind text, p_hash text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_kind text := lower(coalesce(p_kind,'candidate'));
begin
  if not public._is_super_admin() then raise exception 'forbidden'; end if;
  if v_kind not in ('candidate','existing') then v_kind := 'candidate'; end if;
  insert into public.ai_music_preview_canary_queue_snapshots (run_id, kind, snapshot_hash, payload, created_by)
    values (p_run, v_kind, left(coalesce(p_hash,'0'),32), coalesce(p_payload,'{}'::jsonb), auth.uid()) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
revoke execute on function public.record_ai_preview_canary_queue_snapshot(uuid,text,text,jsonb) from public;
do $$ begin begin grant execute on function public.record_ai_preview_canary_queue_snapshot(uuid,text,text,jsonb) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.ingest_ai_preview_canary_events(p_run uuid, p_environment text, p_events jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); rec jsonb; v_n int := 0;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  perform public._ai_canary_require_preview(p_environment);
  if jsonb_typeof(coalesce(p_events,'null'::jsonb)) <> 'array' then raise exception 'events must be an array'; end if;
  for rec in select * from jsonb_array_elements(p_events) loop
    exit when v_n >= 50;   -- batch cap
    insert into public.ai_music_preview_canary_events (run_id, store_uid, session_hash, event_name, outcome, boundary_type,
        existing_playlist_hash, canary_playlist_hash, candidate_version, candidate_snapshot_hash, evaluated_at)
      values (p_run, v_uid, left(coalesce(rec->>'sessionHash','0'),16), left(coalesce(rec->>'eventName','canary_event'),48),
        left(nullif(rec->>'outcome',''),32), left(nullif(rec->>'boundaryType',''),32),
        left(nullif(rec->>'existingPlaylistHash',''),16), left(nullif(rec->>'canaryPlaylistHash',''),16),
        (nullif(rec->>'candidateVersion',''))::int, left(nullif(rec->>'candidateSnapshotHash',''),32),
        coalesce((nullif(rec->>'evaluatedAt',''))::timestamptz, now()));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'ingested', v_n, 'note', 'preview canary evidence stored — not used for playback');
end; $$;
revoke execute on function public.ingest_ai_preview_canary_events(uuid,text,jsonb) from public;
do $$ begin begin grant execute on function public.ingest_ai_preview_canary_events(uuid,text,jsonb) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.record_ai_preview_canary_certification(
  p_run uuid, p_score numeric, p_status text, p_readiness text, p_components jsonb, p_blockers jsonb, p_limitations jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status text := upper(coalesce(p_status,'INSUFFICIENT_DATA')); v_ready text := upper(coalesce(p_readiness,'NOT_READY'));
begin
  if not public._is_super_admin() then raise exception 'forbidden'; end if;
  if v_status not in ('CERTIFIED_FOR_INTERNAL_PREVIEW','READY_WITH_WARNINGS','REVIEW_REQUIRED','BLOCKED','INSUFFICIENT_DATA','NOT_RUN') then v_status := 'INSUFFICIENT_DATA'; end if;
  -- Production readiness 는 최대 READY_FOR_PRODUCTION_CANARY_CHANGE_REQUEST 까지만 — 실제 Canary/Full Rollout 값 없음.
  if v_ready not in ('NOT_READY','MORE_PREVIEW_EVIDENCE_REQUIRED','READY_FOR_INTERNAL_MULTI_STORE_PREVIEW','READY_FOR_PRODUCTION_CANARY_CHANGE_REQUEST','BLOCKED','INSUFFICIENT_DATA') then v_ready := 'NOT_READY'; end if;
  insert into public.ai_music_preview_canary_certifications (run_id, score, cert_status, production_readiness, components, blockers, limitations, created_by)
    values (p_run, p_score, v_status, v_ready, coalesce(p_components,'{}'::jsonb), coalesce(p_blockers,'[]'::jsonb), coalesce(p_limitations,'[]'::jsonb), auth.uid()) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'note', 'internal preview certification — not production ready, no production canary approval');
end; $$;
revoke execute on function public.record_ai_preview_canary_certification(uuid,numeric,text,text,jsonb,jsonb,jsonb) from public;
do $$ begin begin grant execute on function public.record_ai_preview_canary_certification(uuid,numeric,text,text,jsonb,jsonb,jsonb) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 7) Server-side canary candidate resolution (preview + deployment + allowlist + session + version/snapshot).
--    Control/미충족 → USE_EXISTING. USE_CANARY_CANDIDATE 는 *결정만* — 실제 Queue 적용은 DEFERRED.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.resolve_ai_preview_canary_candidate(
  p_run uuid, p_environment text, p_deployment_id text, p_is_treatment boolean,
  p_candidate_version int, p_candidate_snapshot_hash text, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_run public.ai_music_preview_canary_runs; v_allow public.ai_music_preview_canary_allowlist; v_now timestamptz := coalesce(p_now, now());
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if coalesce(p_environment,'') <> 'preview' then return jsonb_build_object('ok', true, 'outcome', 'ENVIRONMENT_BLOCKED', 'usedCandidate', false); end if;
  select * into v_run from public.ai_music_preview_canary_runs where id = p_run;
  if v_run.id is null then return jsonb_build_object('ok', true, 'outcome', 'USE_EXISTING', 'usedCandidate', false, 'reason', 'run 없음'); end if;
  if p_deployment_id is null or p_deployment_id <> v_run.deployment_id then return jsonb_build_object('ok', true, 'outcome', 'ENVIRONMENT_BLOCKED', 'usedCandidate', false, 'reason', 'deployment id 불일치'); end if;
  if coalesce(p_is_treatment,false) = false then return jsonb_build_object('ok', true, 'outcome', 'CONTROL_PRESERVED', 'usedCandidate', false); end if;
  if v_run.state <> 'ACTIVE' then return jsonb_build_object('ok', true, 'outcome', 'SESSION_INACTIVE', 'usedCandidate', false, 'state', v_run.state); end if;
  if v_run.expiry is not null and v_run.expiry <= v_now then return jsonb_build_object('ok', true, 'outcome', 'EXPIRED', 'usedCandidate', false); end if;
  select * into v_allow from public.ai_music_preview_canary_allowlist where store_uid = v_run.store_uid and enabled limit 1;
  if v_allow.id is null or v_allow.expires_at <= v_now then return jsonb_build_object('ok', true, 'outcome', 'STORE_NOT_ALLOWED', 'usedCandidate', false); end if;
  if v_run.candidate_version is not null and coalesce(p_candidate_version,-1) <> v_run.candidate_version then return jsonb_build_object('ok', true, 'outcome', 'VERSION_MISMATCH', 'usedCandidate', false); end if;
  if v_run.candidate_snapshot_hash is not null and coalesce(p_candidate_snapshot_hash,'') <> v_run.candidate_snapshot_hash then return jsonb_build_object('ok', true, 'outcome', 'SNAPSHOT_MISMATCH', 'usedCandidate', false); end if;
  return jsonb_build_object('ok', true, 'outcome', 'USE_CANARY_CANDIDATE', 'usedCandidate', true,
    'candidatePlaylistId', v_run.candidate_playlist_id, 'candidateVersion', v_run.candidate_version,
    'note', 'decision only — 실제 setQueue 적용은 DEFERRED, 현재 Track 강제 중단 없음');
end; $$;
revoke execute on function public.resolve_ai_preview_canary_candidate(uuid,text,text,boolean,int,text,timestamptz) from public;
do $$ begin begin grant execute on function public.resolve_ai_preview_canary_candidate(uuid,text,text,boolean,int,text,timestamptz) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 8) 관리자 조회 RPC (READ-ONLY, super-admin)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_preview_canary_overview(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit,50),1),200);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true,
    'allowlistedStores', (select count(*) from public.ai_music_preview_canary_allowlist where enabled and expires_at > now()),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'state', r.state, 'storeUid', r.store_uid,
        'environment', r.environment, 'deploymentId', r.deployment_id, 'candidateVersion', r.candidate_version,
        'activeSessions', (select count(*) from public.ai_music_preview_canary_sessions s where s.run_id=r.id and s.state='ACTIVE'),
        'createdAt', to_char(r.created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by r.created_at desc)
      from (select * from public.ai_music_preview_canary_runs order by created_at desc limit v_limit) r), '[]'::jsonb),
    'note', 'Preview 전용 — 일반/프랜차이즈 Store/Production Player 미대상. Candidate 적용(setQueue)은 DEFERRED.') into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_preview_canary_overview(int) from public;
do $$ begin begin grant execute on function public.admin_ai_preview_canary_overview(int) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.admin_ai_preview_canary_run(p_run uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true,
    'run', (select to_jsonb(r) from public.ai_music_preview_canary_runs r where r.id=p_run),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('sessionHash', s.session_hash, 'state', s.state) order by s.started_at desc) from public.ai_music_preview_canary_sessions s where s.run_id=p_run), '[]'::jsonb),
    'snapshots', coalesce((select jsonb_agg(jsonb_build_object('kind', q.kind, 'snapshotHash', q.snapshot_hash, 'payload', q.payload) order by q.created_at desc) from public.ai_music_preview_canary_queue_snapshots q where q.run_id=p_run), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('eventName', e.event_name, 'outcome', e.outcome, 'boundaryType', e.boundary_type, 'evaluatedAt', to_char(e.evaluated_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by e.evaluated_at desc) from (select * from public.ai_music_preview_canary_events where run_id=p_run order by evaluated_at desc limit 200) e), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'fromState', a.from_state, 'toState', a.to_state, 'reason', a.reason, 'createdAt', to_char(a.created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by a.created_at desc) from public.ai_music_preview_canary_actions a where a.run_id=p_run), '[]'::jsonb),
    'certifications', coalesce((select jsonb_agg(jsonb_build_object('score', c.score, 'certStatus', c.cert_status, 'productionReadiness', c.production_readiness) order by c.created_at desc) from public.ai_music_preview_canary_certifications c where c.run_id=p_run), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_preview_canary_run(uuid) from public;
do $$ begin begin grant execute on function public.admin_ai_preview_canary_run(uuid) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.admin_ai_preview_canary_allowlist(p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit,100),1),500);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true, 'entries', coalesce((
    select jsonb_agg(jsonb_build_object('storeUid', a.store_uid, 'environment', a.environment, 'purpose', a.purpose,
      'enabled', a.enabled, 'expiresAt', to_char(a.expires_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'maxSessions', a.max_sessions,
      'allowedCandidatePlaylistId', a.allowed_candidate_playlist_id, 'allowedCandidateVersion', a.allowed_candidate_version) order by a.created_at desc)
    from (select * from public.ai_music_preview_canary_allowlist order by created_at desc limit v_limit) a), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_preview_canary_allowlist(int) from public;
do $$ begin begin grant execute on function public.admin_ai_preview_canary_allowlist(int) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (참고용 — Preview/rollback-txn 검증 전용. Production apply 금지):
--   drop function if exists public.admin_ai_preview_canary_allowlist(int);
--   drop function if exists public.admin_ai_preview_canary_run(uuid);
--   drop function if exists public.admin_ai_preview_canary_overview(int);
--   drop function if exists public.resolve_ai_preview_canary_candidate(uuid,text,text,boolean,int,text,timestamptz);
--   drop function if exists public.record_ai_preview_canary_certification(uuid,numeric,text,text,jsonb,jsonb,jsonb);
--   drop function if exists public.ingest_ai_preview_canary_events(uuid,text,jsonb);
--   drop function if exists public.record_ai_preview_canary_queue_snapshot(uuid,text,text,jsonb);
--   drop function if exists public.complete_ai_preview_canary(uuid,text);
--   drop function if exists public.rollback_ai_preview_canary(uuid,text);
--   drop function if exists public.request_ai_preview_canary_rollback(uuid,text);
--   drop function if exists public.stop_ai_preview_canary(uuid,text);
--   drop function if exists public.request_ai_preview_canary_stop(uuid,text);
--   drop function if exists public.pause_ai_preview_canary(uuid,text);
--   drop function if exists public.activate_ai_preview_canary(uuid,text);
--   drop function if exists public.arm_ai_preview_canary(uuid,text);
--   drop function if exists public.record_ai_preview_canary_approval(uuid,uuid,text,text,text,int,text,timestamptz,timestamptz,timestamptz,text);
--   drop function if exists public.set_ai_preview_canary_allowlist_enabled(uuid,boolean,text);
--   drop function if exists public.record_ai_preview_canary_allowlist(uuid,text,text,timestamptz,int,text,int,text);
--   drop function if exists public._ai_canary_apply_transition(uuid,text,text,text);
--   drop function if exists public._ai_canary_can_transition(text,text);
--   drop function if exists public._ai_canary_require_preview(text);
--   drop table if exists public.ai_music_preview_canary_actions;
--   drop table if exists public.ai_music_preview_canary_certifications;
--   drop table if exists public.ai_music_preview_canary_events;
--   drop table if exists public.ai_music_preview_canary_queue_snapshots;
--   drop table if exists public.ai_music_preview_canary_sessions;
--   drop table if exists public.ai_music_preview_canary_runs;
--   drop table if exists public.ai_music_preview_canary_allowlist;
-- 신규(0470) 테이블 7 + 함수 22. 롤백은 순수 DROP. 기존 데이터/스키마/RLS/Playlist/Store/Playback/Queue/Resolver 무영향.
-- 기존 Playlist/Store Playlist 를 UPDATE 하지 않는다. Canary Event/Certification 은 실제 재생에 사용되지 않는다.
-- Production Environment write 는 _ai_canary_require_preview 로 거부되며, Production DB 에는 이 migration 이 적용되지 않는다.
