-- ============================================
-- 0501_admin_ai_federated_learning.sql
--
-- Phase AI-MUSIC-14 — Federated Learning, Privacy-Preserving Intelligence
-- & Global Knowledge Federation.
--
-- 각 Store/Enterprise 가 원본 데이터를 노출하지 않고 **익명화된 Knowledge(통계/패턴/
-- Confidence/Sample/Evidence)만** 공유해 전체 AI 를 발전시키는 계층.
--
--   Store AI → Local Memory → Local Knowledge → Privacy Validation → Anonymous
--   Knowledge → Federated Aggregation → Regional/Enterprise/Global Knowledge
--   → Governance Validation → Evidence Only
--
-- ⚠️ 절대: Raw Data/PII/Store 식별자/Audio URL/계약·정산 원문 공유 금지 — pattern_save
--   RPC 가 Privacy Gate(금지 필드·최소 표본·익명성 임계) 를 서버측 강제하고 결과를
--   ai_federated_privacy_audit 에 기록한다. Production Apply/자동 Publish/Rollout/
--   Scheduler/Queue/Playback 변경 없음. 기존 Memory/Pattern/Knowledge Graph(0498)
--   테이블 무변경 — Federated Knowledge 는 별도 저장(정의 충돌 방지). Trigger 없음.
--   AI 가 Federated Rule(게이트 임계값)을 수정하는 RPC 없음.
-- ============================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Federated Pattern(익명 Knowledge) — Store 이름/ID 저장 필드 자체가 없음.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_federated_patterns (
  id               uuid primary key default gen_random_uuid(),
  pattern_key      text not null,
  layer            text not null check (layer in ('store','brand','enterprise','region','global')),
  industry         text,                       -- store_type slug(익명 집계 축)
  region_label     text,                       -- franchise_regions 라벨(enterprise 미식별)
  context_key      text,
  subject          jsonb not null default '{}'::jsonb,    -- 예: {"genre":"jazz","share_pct":18}
  metric_code      text not null,
  direction        text check (direction is null or direction in ('positive','negative','neutral','mixed')),
  effect_value     numeric,
  baseline_value   numeric,
  confidence       int check (confidence is null or (confidence between 0 and 100)),
  sample_count     int not null check (sample_count >= 0),
  sample_stores    int not null check (sample_stores >= 0),
  freshness_score  int check (freshness_score is null or (freshness_score between 0 and 100)),
  status           text not null default 'local_only' check (status in ('local_only','candidate','regional','enterprise','global_candidate','global_validated','deprecated','archived')),
  privacy_passed   boolean not null default false,
  evidence         jsonb not null default '[]'::jsonb,
  limitations      jsonb not null default '[]'::jsonb,
  source_version   text not null,
  input_hash       text not null unique,
  last_validated_at timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.ai_federated_patterns is
  'AI-MUSIC-14 — 익명 Federated Knowledge(통계만, 식별자 필드 없음). Privacy Gate 통과분만 저장. Evidence Only — 자동 실행 없음.';
create index if not exists idx_fed_layer on public.ai_federated_patterns (layer, status, created_at desc);
create index if not exists idx_fed_industry on public.ai_federated_patterns (industry, metric_code);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Privacy Validation Audit — 통과/차단 모두 기록(재현 가능).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_federated_privacy_audit (
  id             uuid primary key default gen_random_uuid(),
  pattern_key    text,
  layer          text,
  passed         boolean not null,
  checks         jsonb not null default '{}'::jsonb,     -- {min_sample, anonymity, forbidden_fields, pii, ...}
  violations     jsonb not null default '[]'::jsonb,
  actor_id       uuid,
  created_at     timestamptz not null default now()
);
comment on table public.ai_federated_privacy_audit is
  'AI-MUSIC-14 — Privacy Gate 검증 로그(통과/차단). 원본 payload 는 저장하지 않음(위반 사유만).';
create index if not exists idx_fed_privacy on public.ai_federated_privacy_audit (passed, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Federated Conflict(Local vs Global 등) — Governance Review 대상.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_federated_conflicts (
  id              uuid primary key default gen_random_uuid(),
  conflict_key    text not null unique,
  conflict_type   text not null check (conflict_type in ('local_vs_global','brand_vs_enterprise','enterprise_vs_region','regional_vs_global')),
  local_pattern_id  uuid references public.ai_federated_patterns(id),
  global_pattern_id uuid references public.ai_federated_patterns(id),
  context_key     text,
  summary         text not null,
  resolution      text not null default 'unresolved' check (resolution in ('unresolved','local_preferred','global_preferred','context_split','governance_review')),
  resolution_reason text,
  evidence        jsonb not null default '[]'::jsonb,
  resolved_by     uuid,
  resolved_at     timestamptz,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
comment on table public.ai_federated_conflicts is
  'AI-MUSIC-14 — Federated Knowledge 충돌 기록. 해소는 Governance Review(사람) 로만 — 자동 해소 없음.';
create index if not exists idx_fed_conflict on public.ai_federated_conflicts (resolution, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Summary / 목록.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_federated_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_patterns jsonb; v_privacy jsonb; v_conflicts jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'total', count(*),
    'by_layer', (select coalesce(jsonb_object_agg(layer, n), '{}'::jsonb) from (select layer, count(*) n from public.ai_federated_patterns group by layer) x),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.ai_federated_patterns group by status) x),
    'global_validated', count(*) filter (where status = 'global_validated'),
    'deprecated', count(*) filter (where status = 'deprecated'),
    'last_pattern_at', max(created_at)
  ) into v_patterns from public.ai_federated_patterns;
  select jsonb_build_object('total', count(*), 'passed', count(*) filter (where passed), 'blocked', count(*) filter (where not passed))
  into v_privacy from public.ai_federated_privacy_audit;
  select jsonb_build_object('total', count(*), 'unresolved', count(*) filter (where resolution = 'unresolved'), 'governance_review', count(*) filter (where resolution = 'governance_review'))
  into v_conflicts from public.ai_federated_conflicts;
  return jsonb_build_object('patterns', v_patterns, 'privacy', v_privacy, 'conflicts', v_conflicts, 'generated_at', now());
end; $$;
grant execute on function public.admin_federated_summary() to authenticated;

create or replace function public.admin_federated_patterns(p_layer text default null, p_status text default null, p_industry text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_federated_patterns p
    where (p_layer is null or p.layer = p_layer) and (p_status is null or p.status = p_status) and (p_industry is null or p.industry = p_industry)
    order by p.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_federated_patterns(text, text, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Pattern 저장 — Privacy Gate 서버측 강제(위반 시 저장 거부 + Audit 기록).
--    금지 필드(payload 어디에도 식별자/민감 키 금지) · 최소 표본 · 익명성 임계.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_federated_pattern_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_layer text := p_payload->>'layer'; v_sample int := coalesce(nullif(p_payload->>'sample_count','')::int, 0);
  v_stores int := coalesce(nullif(p_payload->>'sample_stores','')::int, 0);
  v_violations jsonb := '[]'::jsonb; v_txt text; v_key text;
  v_forbidden text[] := array['store_id','store_name','user_id','business_id','business_name','email','phone','audio_url','file_url','contract','settlement','account','iban','payout'];
  v_existing public.ai_federated_patterns; v_row public.ai_federated_patterns; v_id uuid; v_passed boolean;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if v_layer is null or v_layer not in ('store','brand','enterprise','region','global') then raise exception 'invalid layer' using errcode='22023'; end if;
  if coalesce(p_payload->>'pattern_key','') = '' or coalesce(p_payload->>'metric_code','') = '' then raise exception 'pattern_key/metric_code required' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  if coalesce(p_payload->>'source_version','') = '' or coalesce(p_payload->>'input_hash','') = '' then raise exception 'source_version/input_hash required' using errcode='22023'; end if;

  -- Privacy Gate ① 최소 표본(단일 사건/소표본 공유 금지).
  if v_sample < 30 then v_violations := v_violations || jsonb_build_array('min_sample: sample_count < 30'); end if;
  -- ② 익명성 임계(Store 층 이상 공유는 3+ Store 집계만 — 개별 Store 재식별 방지).
  if v_layer <> 'store' and v_stores < 3 then v_violations := v_violations || jsonb_build_array('anonymity: sample_stores < 3'); end if;
  -- ③ 금지 필드/민감 키(payload 전체 텍스트 검사 — Raw Data/식별자/민감 원문 공유 금지).
  v_txt := lower(p_payload::text);
  foreach v_key in array v_forbidden loop
    if position('"' || v_key || '"' in v_txt) > 0 then v_violations := v_violations || jsonb_build_array('forbidden_field: ' || v_key); end if;
  end loop;
  -- ④ PII 패턴(이메일/URL — Audio URL·원본 링크 공유 금지).
  if v_txt ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then v_violations := v_violations || jsonb_build_array('pii: email pattern'); end if;
  if v_txt ~ 'https?://' then v_violations := v_violations || jsonb_build_array('pii: url pattern'); end if;

  v_passed := jsonb_array_length(v_violations) = 0;
  insert into public.ai_federated_privacy_audit(pattern_key, layer, passed, checks, violations, actor_id)
  values (p_payload->>'pattern_key', v_layer, v_passed,
    jsonb_build_object('min_sample', v_sample >= 30, 'anonymity', v_layer = 'store' or v_stores >= 3, 'forbidden_fields', true, 'pii_scan', true),
    v_violations, auth.uid());
  if not v_passed then
    return jsonb_build_object('saved', false, 'privacy_passed', false, 'violations', v_violations);
  end if;

  select * into v_existing from public.ai_federated_patterns where input_hash = p_payload->>'input_hash';
  if v_existing.id is not null then return jsonb_build_object('saved', false, 'idempotent', true, 'privacy_passed', true, 'pattern', to_jsonb(v_existing)); end if;

  insert into public.ai_federated_patterns(pattern_key, layer, industry, region_label, context_key, subject, metric_code,
    direction, effect_value, baseline_value, confidence, sample_count, sample_stores, freshness_score, status, privacy_passed,
    evidence, limitations, source_version, input_hash, last_validated_at, created_by)
  values (p_payload->>'pattern_key', v_layer, nullif(p_payload->>'industry',''), nullif(p_payload->>'region_label',''),
    nullif(p_payload->>'context_key',''), coalesce(p_payload->'subject','{}'::jsonb), p_payload->>'metric_code',
    nullif(p_payload->>'direction',''), nullif(p_payload->>'effect_value','')::numeric, nullif(p_payload->>'baseline_value','')::numeric,
    least(100, greatest(0, nullif(p_payload->>'confidence','')::int)), v_sample, v_stores,
    least(100, greatest(0, nullif(p_payload->>'freshness_score','')::int)),
    case when v_layer = 'store' then 'local_only' else 'candidate' end, true,
    p_payload->'evidence', coalesce(p_payload->'limitations','[]'::jsonb), p_payload->>'source_version', p_payload->>'input_hash', now(), auth.uid())
  returning id into v_id;
  select * into v_row from public.ai_federated_patterns where id = v_id;
  return jsonb_build_object('saved', true, 'idempotent', false, 'privacy_passed', true, 'pattern', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_federated_pattern_save(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Knowledge Promotion — 표본 게이트 강제(사람 승인 · 자동 승격 없음).
--    게이트 임계값은 코드 상수 — AI/RPC 로 수정 불가(Federated Rule 보호).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_federated_promote(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_federated_patterns;
begin
  perform public._admin_growth_guard();
  if p_status is null or p_status not in ('candidate','regional','enterprise','global_candidate','global_validated','deprecated','archived') then raise exception 'invalid status' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  select * into v_row from public.ai_federated_patterns where id = p_id;
  if v_row.id is null then raise exception 'pattern not found' using errcode='P0002'; end if;
  if not v_row.privacy_passed then raise exception 'privacy gate not passed' using errcode='22023'; end if;
  -- 승격 표본 게이트(익명성/대표성 — 통계 정직성).
  if p_status = 'regional' and v_row.sample_stores < 3 then raise exception 'regional requires sample_stores>=3' using errcode='22023'; end if;
  if p_status = 'enterprise' and v_row.sample_stores < 5 then raise exception 'enterprise requires sample_stores>=5' using errcode='22023'; end if;
  if p_status = 'global_candidate' and (v_row.sample_stores < 10 or v_row.sample_count < 300) then raise exception 'global_candidate requires stores>=10 and sample>=300' using errcode='22023'; end if;
  if p_status = 'global_validated' and (v_row.sample_stores < 20 or v_row.sample_count < 1000 or coalesce(v_row.confidence,0) < 60) then
    raise exception 'global_validated requires stores>=20, sample>=1000, confidence>=60' using errcode='22023';
  end if;
  update public.ai_federated_patterns set status = p_status,
    last_validated_at = case when p_status in ('regional','enterprise','global_candidate','global_validated') then now() else last_validated_at end,
    updated_at = now()
  where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_federated_promote(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Conflict 기록/조회/해소(Governance Review — 자동 해소 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_federated_conflict_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_existing public.ai_federated_conflicts; v_row public.ai_federated_conflicts; v_id uuid;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'conflict_key','') = '' or coalesce(p_payload->>'summary','') = '' then raise exception 'conflict_key/summary required' using errcode='22023'; end if;
  if coalesce(p_payload->>'conflict_type','') not in ('local_vs_global','brand_vs_enterprise','enterprise_vs_region','regional_vs_global') then raise exception 'invalid conflict_type' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  select * into v_existing from public.ai_federated_conflicts where conflict_key = p_payload->>'conflict_key';
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'conflict', to_jsonb(v_existing)); end if;
  insert into public.ai_federated_conflicts(conflict_key, conflict_type, local_pattern_id, global_pattern_id, context_key, summary, evidence, created_by)
  values (p_payload->>'conflict_key', p_payload->>'conflict_type', nullif(p_payload->>'local_pattern_id','')::uuid, nullif(p_payload->>'global_pattern_id','')::uuid,
    nullif(p_payload->>'context_key',''), p_payload->>'summary', p_payload->'evidence', auth.uid())
  returning id into v_id;
  select * into v_row from public.ai_federated_conflicts where id = v_id;
  return jsonb_build_object('idempotent', false, 'conflict', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_federated_conflict_save(jsonb) to authenticated;

create or replace function public.admin_federated_conflicts(p_resolution text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_federated_conflicts c where (p_resolution is null or c.resolution = p_resolution)
    order by c.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_federated_conflicts(text, int) to authenticated;

create or replace function public.admin_federated_conflict_resolve(p_id uuid, p_resolution text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_federated_conflicts;
begin
  perform public._admin_growth_guard();
  if p_resolution is null or p_resolution not in ('local_preferred','global_preferred','context_split','governance_review') then raise exception 'invalid resolution' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required (Governance Review 근거)' using errcode='22023'; end if;
  select * into v_row from public.ai_federated_conflicts where id = p_id;
  if v_row.id is null then raise exception 'conflict not found' using errcode='P0002'; end if;
  update public.ai_federated_conflicts set resolution = p_resolution, resolution_reason = p_reason, resolved_by = auth.uid(), resolved_at = now()
  where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_federated_conflict_resolve(uuid, text, text) to authenticated;

create or replace function public.admin_federated_privacy_log(p_passed boolean default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_federated_privacy_audit a where (p_passed is null or a.passed = p_passed)
    order by a.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_federated_privacy_log(boolean, int) to authenticated;
