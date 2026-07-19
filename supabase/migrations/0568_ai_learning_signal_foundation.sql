-- ============================================
-- 0568_ai_learning_signal_foundation.sql
--
-- Phase AI-LEARNING-1 — Continuous Learning Signal Foundation & Safe Feedback Loop.
--
-- 목적: 학습에 사용할 수 있는 데이터의 수집(Exposure Ledger)·검증·Attribution·집계·
-- Bias 감지·v1/v2 비교·Shadow Weight Proposal·Backtest·Human Review **까지만**.
-- Production Recommendation Weight/v1·v2 점수식/Playlist/Queue/Scheduler/Player/
-- Reaction Learning/Track Reputation/정산은 **일절 무변경**. Weight Apply RPC 는
-- 존재하지 않는다. Approved 는 "향후 제한적 실험 후보 승인" 감사 기록일 뿐이다.
--
-- 사전 감사 실측:
--   · playback_events_v2(0253) 에는 recommendation source/algorithm version/rank/
--     draft id 가 없음 → 정식 Exposure Ledger 를 신설하고, 기존 이벤트 기반 귀속은
--     partially_attributed/ambiguous 로만 처리(임의 귀속 금지).
--   · Reaction(0345) 은 수집 경로 연결됨 + Production 0행 — 원인은 사용 부재 유력,
--     저장 실패 여부는 로그 부재로 unknown(가정하지 않음).
--   · v2 Shadow Preview 노출은 is_shadow=true 로 Production Exposure 와 분리한다.
--   · 이번 Phase 는 Player 에 emission 을 배선하지 않는다(수집 RPC 만 준비 — 후속
--     Phase 에서 최소 Event Emission 만 추가 예정, 재생 로직 변경 없음).
--
-- 개인정보: Raw IP 저장 금지 · device_key 는 해시/익명 키만(서버가 원문 저장 안 함) ·
-- 정산/계좌/계약 데이터와 연결 금지. 재사용: _admin_growth_guard(0472) ·
-- _touch_updated_at(0025) · Early Skip 30초(0182) · Complete 80%/complete 이벤트(기존
-- v1 정책) · mute/low-volume 제외(0347 계열 정책 참조).
-- ============================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Exposure Ledger — "추천/재생 후보로 실제 제시된 사실". Shadow 분리 저장.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_learning_exposures (
  id                       uuid primary key default gen_random_uuid(),
  idempotency_key          text not null,
  is_shadow                boolean not null default false,
  store_id                 uuid,
  brand_id                 uuid,
  session_id               text,
  device_key               text, -- 해시/익명 키만 허용(원문 식별자 저장 금지)
  track_id                 uuid not null references public.tracks(id) on delete cascade,
  artist_name              text,
  source                   text not null default 'unknown'
    check (source in ('recommendation_v1','recommendation_v2_shadow','playlist','sequence_draft','scheduler','auto_continue','manual','unknown')),
  algorithm_version        text,
  weight_version           text,
  recommendation_draft_id  uuid references public.ai_recommendation_drafts(id) on delete set null,
  recommendation_rank      int,
  playlist_id              uuid references public.playlists(id) on delete set null,
  playlist_draft_id        uuid references public.ai_playlist_drafts(id) on delete set null,
  sequence_draft_id        uuid references public.ai_playlist_sequence_drafts(id) on delete set null,
  queue_position           int,
  current_track_id         uuid,
  previous_track_id        uuid,
  daypart                  text,
  store_type               text,
  exposed_at               timestamptz not null,
  selected_at              timestamptz,
  playback_started_at      timestamptz,
  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  unique (idempotency_key)
);

comment on table public.ai_learning_exposures is
  'AI-LEARNING-1 — Exposure Ledger(Shadow 분리: is_shadow). v2 Shadow Preview 는 Production Exposure 로 기록하지 않는다.';

create index if not exists idx_ai_learn_exp_time on public.ai_learning_exposures (exposed_at desc);
create index if not exists idx_ai_learn_exp_track on public.ai_learning_exposures (track_id, exposed_at desc);
create index if not exists idx_ai_learn_exp_store on public.ai_learning_exposures (store_id, exposed_at desc);
create index if not exists idx_ai_learn_exp_source on public.ai_learning_exposures (source, is_shadow, exposed_at desc);

alter table public.ai_learning_exposures enable row level security;
-- 정책 없음(deny-all) — Insert/조회는 아래 RPC 로만. Event 는 수정 RPC 자체가 없다(불변).

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Learning Event — 검증/정규화/Confidence/Attribution 은 서버가 계산.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_learning_events (
  id                 uuid primary key default gen_random_uuid(),
  idempotency_key    text not null,
  exposure_id        uuid references public.ai_learning_exposures(id) on delete set null,
  event_type         text not null check (event_type in (
    'recommendation_exposed','recommendation_selected','track_queued','playback_started',
    'playback_completed','playback_skipped','playback_failed','track_replayed',
    'track_liked','track_disliked','track_excluded','session_ended')),
  track_id           uuid not null references public.tracks(id) on delete cascade,
  store_id           uuid,
  session_id         text,
  occurred_at        timestamptz not null,
  received_at        timestamptz not null default now(),
  raw_value          numeric,
  normalized_value   numeric check (normalized_value is null or (normalized_value >= -1 and normalized_value <= 1)),
  signal_type        text not null default 'neutral'
    check (signal_type in ('positive','negative','neutral','quality_failure','not_applicable')),
  signal_status      text not null default 'pending'
    check (signal_status in ('valid','invalid','duplicate','insufficient_data','excluded','pending')),
  confidence         numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  attribution_status text not null default 'unattributed'
    check (attribution_status in ('attributed','partially_attributed','unattributed','ambiguous','invalid')),
  validation_reasons jsonb not null default '[]'::jsonb,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  unique (idempotency_key)
);

create index if not exists idx_ai_learn_ev_time on public.ai_learning_events (occurred_at desc);
create index if not exists idx_ai_learn_ev_track on public.ai_learning_events (track_id, occurred_at desc);
create index if not exists idx_ai_learn_ev_status on public.ai_learning_events (signal_status, occurred_at desc);

alter table public.ai_learning_events enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Learning Aggregate / 4) Weight Proposal / 5) Audit
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_learning_aggregates (
  id                uuid primary key default gen_random_uuid(),
  entity_type       text not null check (entity_type in ('track','artist','store','brand','store_type','industry','algorithm','source')),
  entity_id         text not null,
  window_type       text not null check (window_type in ('daily','7d','28d','all')),
  window_start      timestamptz not null,
  window_end        timestamptz not null,
  metrics           jsonb not null default '{}'::jsonb,
  confidence        numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  sample_status     text not null default 'insufficient_data' check (sample_status in ('sufficient','insufficient_data')),
  data_quality      jsonb not null default '{}'::jsonb,
  bias_flags        jsonb not null default '[]'::jsonb,
  algorithm_version text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (entity_type, entity_id, window_type, window_start)
);

create index if not exists idx_ai_learn_agg on public.ai_learning_aggregates (entity_type, window_type, window_end desc);

drop trigger if exists tg_ai_learn_agg_touch on public.ai_learning_aggregates;
create trigger tg_ai_learn_agg_touch before update on public.ai_learning_aggregates
  for each row execute function public._touch_updated_at();

alter table public.ai_learning_aggregates enable row level security;

create table if not exists public.ai_learning_weight_proposals (
  id                      uuid primary key default gen_random_uuid(),
  scope_type              text not null default 'global' check (scope_type in ('global','brand','store_type','store')),
  scope_id                text,
  algorithm_version       text not null,
  base_weight_version     text not null,
  proposed_weight_version text not null,
  status                  text not null default 'draft'
    check (status in ('draft','ready_for_review','approved','rejected','archived')),
  current_weights         jsonb not null,
  proposed_weights        jsonb not null,
  deltas                  jsonb not null default '{}'::jsonb,
  evidence_window         jsonb not null default '{}'::jsonb,
  sample_count            int not null default 0,
  confidence              numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  expected_impact         jsonb not null default '{}'::jsonb,
  backtest_result         jsonb not null default '{}'::jsonb,
  quality_score           numeric check (quality_score is null or (quality_score >= 0 and quality_score <= 100)),
  quality_grade           text check (quality_grade is null or quality_grade in ('A','B','C','D','insufficient_data')),
  risks                   jsonb not null default '[]'::jsonb,
  insufficient_data       jsonb not null default '[]'::jsonb,
  explanation             jsonb not null default '[]'::jsonb,
  input_hash              text,
  created_by              uuid,
  reviewed_by             uuid,
  reviewed_at             timestamptz,
  rejection_reason        text,
  expires_at              timestamptz not null default now() + interval '30 days',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.ai_learning_weight_proposals is
  'AI-LEARNING-1 — Shadow Weight Proposal. Approved=향후 제한적 실험 후보 승인 기록이며 Production Weight 적용이 아니다(Apply RPC 없음).';

create index if not exists idx_ai_learn_prop_status on public.ai_learning_weight_proposals (status, created_at desc);

drop trigger if exists tg_ai_learn_prop_touch on public.ai_learning_weight_proposals;
create trigger tg_ai_learn_prop_touch before update on public.ai_learning_weight_proposals
  for each row execute function public._touch_updated_at();

alter table public.ai_learning_weight_proposals enable row level security;

create table if not exists public.ai_learning_events_audit (
  id              uuid primary key default gen_random_uuid(),
  proposal_id     uuid references public.ai_learning_weight_proposals(id) on delete cascade,
  event_type      text not null check (event_type in ('created','reevaluated','backtested','status_changed','aggregated','note')),
  actor_id        uuid,
  previous_status text,
  next_status     text,
  reason          text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_ai_learn_audit on public.ai_learning_events_audit (proposal_id, created_at desc);

alter table public.ai_learning_events_audit enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Exposure 기록 — Idempotency + timestamp 검증. Player 배선은 후속 Phase.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_learn_record_exposure(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_key text := p_payload->>'idempotency_key';
  v_exposed timestamptz := (p_payload->>'exposed_at')::timestamptz;
  v_id uuid;
begin
  perform public._admin_growth_guard();

  if coalesce(v_key,'') = '' then raise exception 'idempotency_key required' using errcode = '22023'; end if;
  if v_exposed is null then raise exception 'exposed_at required' using errcode = '22023'; end if;
  if v_exposed > now() + interval '5 minutes' then
    raise exception 'future timestamp rejected' using errcode = '22023';
  end if;
  if v_exposed < now() - interval '90 days' then
    raise exception 'timestamp too old (max 90 days)' using errcode = '22023';
  end if;
  if length(p_payload::text) > 50000 then raise exception 'payload too large' using errcode = '22023'; end if;
  -- 개인정보 최소화: raw_ip/user_agent 원문 필드는 거부.
  if p_payload ? 'raw_ip' or p_payload ? 'ip' then
    raise exception 'raw ip is not allowed' using errcode = '22023';
  end if;

  insert into public.ai_learning_exposures(
    idempotency_key, is_shadow, store_id, brand_id, session_id, device_key,
    track_id, artist_name, source, algorithm_version, weight_version,
    recommendation_draft_id, recommendation_rank, playlist_id, playlist_draft_id, sequence_draft_id,
    queue_position, current_track_id, previous_track_id, daypart, store_type,
    exposed_at, selected_at, playback_started_at, metadata)
  values (
    v_key,
    coalesce((p_payload->>'is_shadow')::boolean, (p_payload->>'source') = 'recommendation_v2_shadow'),
    nullif(p_payload->>'store_id','')::uuid, nullif(p_payload->>'brand_id','')::uuid,
    nullif(p_payload->>'session_id',''), left(nullif(p_payload->>'device_key',''), 64),
    (p_payload->>'track_id')::uuid, nullif(p_payload->>'artist_name',''),
    coalesce(nullif(p_payload->>'source',''), 'unknown'),
    nullif(p_payload->>'algorithm_version',''), nullif(p_payload->>'weight_version',''),
    nullif(p_payload->>'recommendation_draft_id','')::uuid, (p_payload->>'recommendation_rank')::int,
    nullif(p_payload->>'playlist_id','')::uuid, nullif(p_payload->>'playlist_draft_id','')::uuid,
    nullif(p_payload->>'sequence_draft_id','')::uuid,
    (p_payload->>'queue_position')::int,
    nullif(p_payload->>'current_track_id','')::uuid, nullif(p_payload->>'previous_track_id','')::uuid,
    nullif(p_payload->>'daypart',''), nullif(p_payload->>'store_type',''),
    v_exposed, (p_payload->>'selected_at')::timestamptz, (p_payload->>'playback_started_at')::timestamptz,
    coalesce(p_payload->'metadata', '{}'::jsonb))
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.ai_learning_exposures where idempotency_key = v_key;
    return jsonb_build_object('id', v_id, 'duplicate', true);
  end if;
  return jsonb_build_object('id', v_id, 'duplicate', false);
end;
$$;

grant execute on function public.admin_ai_learn_record_exposure(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Event Batch 기록 — 서버가 검증/정규화/Confidence/Attribution 을 계산한다.
--    클라이언트가 보낸 confidence/normalized/attribution 은 무시한다.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_learn_record_events(p_events jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_item jsonb; v_inserted int := 0; v_dup int := 0; v_invalid int := 0;
  v_key text; v_type text; v_occurred timestamptz;
  v_exp_id uuid; v_exp_track uuid; v_exp_shadow boolean; v_exp_at timestamptz;
  v_norm numeric; v_sig text; v_status text; v_attr text; v_conf numeric;
  v_reasons jsonb;
  v_started boolean;
begin
  perform public._admin_growth_guard();

  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'events array required' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 200 then
    raise exception 'batch too large (max 200)' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_events) loop
    v_key := v_item->>'idempotency_key';
    v_type := v_item->>'event_type';
    v_occurred := (v_item->>'occurred_at')::timestamptz;
    v_reasons := '[]'::jsonb;
    v_status := 'valid'; v_sig := 'neutral'; v_norm := 0; v_conf := 0.5;

    if coalesce(v_key,'') = '' or v_occurred is null or coalesce(v_item->>'track_id','') = '' then
      v_invalid := v_invalid + 1; continue;
    end if;
    if v_occurred > now() + interval '5 minutes' or v_occurred < now() - interval '90 days' then
      v_status := 'invalid'; v_reasons := v_reasons || '"timestamp_out_of_range"'::jsonb;
    end if;

    -- Attribution: Exposure ID 명시 → attributed. session/playlist 휴리스틱은
    -- 이 RPC 에서 하지 않는다(임의 귀속 금지) — 없으면 unattributed.
    v_exp_id := null; v_exp_track := null; v_exp_shadow := null; v_exp_at := null;
    if coalesce(v_item->>'exposure_id','') <> '' then
      select x.id, x.track_id, x.is_shadow, x.exposed_at
        into v_exp_id, v_exp_track, v_exp_shadow, v_exp_at
      from public.ai_learning_exposures x where x.id = (v_item->>'exposure_id')::uuid;
      if v_exp_id is null then
        v_attr := 'invalid'; v_reasons := v_reasons || '"exposure_not_found"'::jsonb;
      elsif v_exp_track <> (v_item->>'track_id')::uuid then
        v_attr := 'invalid'; v_reasons := v_reasons || '"exposure_track_mismatch"'::jsonb;
        v_exp_id := null;
      elsif v_exp_shadow then
        -- Shadow 노출은 실제 Playback 에 귀속하지 않는다.
        v_attr := 'invalid'; v_reasons := v_reasons || '"shadow_exposure_not_attributable"'::jsonb;
        v_exp_id := null;
      elsif v_occurred < v_exp_at then
        v_attr := 'invalid'; v_reasons := v_reasons || '"event_before_exposure"'::jsonb;
      else
        v_attr := 'attributed';
      end if;
    else
      v_attr := 'unattributed';
    end if;

    -- 순서 검증: playback_started 이전의 outcome 은 invalid.
    if v_type in ('playback_completed','playback_skipped','track_replayed','track_liked','track_disliked') then
      v_started := exists (
        select 1 from public.ai_learning_events e
        where e.session_id = nullif(v_item->>'session_id','')
          and e.track_id = (v_item->>'track_id')::uuid
          and e.event_type = 'playback_started'
          and e.occurred_at <= v_occurred);
      if not v_started then
        v_status := case when v_status = 'valid' then 'pending' else v_status end;
        v_reasons := v_reasons || '"no_playback_started_seen"'::jsonb;
      end if;
    end if;

    -- 정규화(초기 v1 상수 — 코드 SIGNAL_VALUES 와 동일, 버전 sig-norm-v1):
    --   like +1.0 · replay +0.8 · complete +0.6 · skip -0.4(early -0.7) · dislike -1.0 ·
    --   failed 는 품질 신호(선호 Negative 아님) · muted/low-volume 재생은 excluded.
    if coalesce((v_item->>'muted')::boolean, false)
       or coalesce((v_item->>'volume')::numeric, 1) < 0.1 then
      v_status := 'excluded'; v_reasons := v_reasons || '"muted_or_low_volume"'::jsonb;
    end if;
    case v_type
      when 'track_liked' then v_sig := 'positive'; v_norm := 1.0;
      when 'track_replayed' then v_sig := 'positive'; v_norm := 0.8;
      when 'playback_completed' then v_sig := 'positive'; v_norm := 0.6;
      when 'playback_skipped' then
        if coalesce((v_item->>'listened_seconds')::numeric, 999) < 30 then
          v_sig := 'negative'; v_norm := -0.7; -- Early Skip(0182 30초 정책 재사용)
        else
          v_sig := 'negative'; v_norm := -0.4;
        end if;
      when 'track_disliked' then v_sig := 'negative'; v_norm := -1.0;
      when 'track_excluded' then v_sig := 'negative'; v_norm := -0.9;
      when 'playback_failed' then v_sig := 'quality_failure'; v_norm := null; -- 선호 Negative 로 반영 금지
      else v_sig := 'neutral'; v_norm := 0;
    end case;

    -- Confidence = attribution × validity × playback quality(단순 v1 공식, 서버 계산).
    v_conf := (case v_attr when 'attributed' then 1.0 when 'partially_attributed' then 0.6
                when 'unattributed' then 0.3 else 0 end)
      * (case when v_status = 'valid' then 1.0 when v_status = 'pending' then 0.5 else 0 end)
      * (case when v_type = 'playback_failed' then 0.5 else 1.0 end);

    begin
      insert into public.ai_learning_events(
        idempotency_key, exposure_id, event_type, track_id, store_id, session_id,
        occurred_at, raw_value, normalized_value, signal_type, signal_status,
        confidence, attribution_status, validation_reasons, metadata)
      values (
        v_key, v_exp_id, v_type, (v_item->>'track_id')::uuid,
        nullif(v_item->>'store_id','')::uuid, nullif(v_item->>'session_id',''),
        v_occurred, (v_item->>'raw_value')::numeric, v_norm, v_sig, v_status,
        round(v_conf, 3), v_attr, v_reasons,
        jsonb_build_object('listened_seconds', v_item->>'listened_seconds',
          'volume', v_item->>'volume', 'muted', v_item->>'muted', 'norm_version', 'sig-norm-v1'));
      v_inserted := v_inserted + 1;
    exception when unique_violation then
      v_dup := v_dup + 1;
    end;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_dup, 'invalid', v_invalid);
end;
$$;

grant execute on function public.admin_ai_learn_record_events(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 집계 — 관리자 수동 실행, Window 제한. 결과는 aggregates 에 upsert.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_learn_build_aggregates(p_window text default '7d')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_days int; v_start timestamptz; v_end timestamptz := now(); v_rows int := 0; r record;
begin
  perform public._admin_growth_guard();

  v_days := case p_window when 'daily' then 1 when '7d' then 7 when '28d' then 28 else null end;
  if v_days is null then raise exception 'window must be daily|7d|28d' using errcode = '22023'; end if;
  v_start := v_end - make_interval(days => v_days);

  for r in
    select 'track'::text as entity_type, e.track_id::text as entity_id,
      count(distinct x.id) filter (where not coalesce(x.is_shadow,false)) as exposure_count,
      count(*) filter (where e.event_type = 'playback_started') as play_count,
      count(*) filter (where e.event_type = 'playback_completed' and e.signal_status = 'valid') as completion_count,
      count(*) filter (where e.event_type = 'playback_skipped' and e.signal_status = 'valid') as skip_count,
      count(*) filter (where e.event_type = 'track_liked' and e.signal_status = 'valid') as like_count,
      count(*) filter (where e.event_type = 'track_disliked' and e.signal_status = 'valid') as dislike_count,
      count(*) filter (where e.event_type = 'track_replayed' and e.signal_status = 'valid') as replay_count,
      count(*) filter (where e.event_type = 'playback_failed') as failure_count,
      count(*) filter (where e.attribution_status = 'attributed') as attributed_count,
      count(*) as total_events,
      avg(e.confidence) as avg_confidence
    from public.ai_learning_events e
    left join public.ai_learning_exposures x on x.id = e.exposure_id
    where e.occurred_at >= v_start and e.occurred_at < v_end
    group by e.track_id
  loop
    insert into public.ai_learning_aggregates(
      entity_type, entity_id, window_type, window_start, window_end, metrics, confidence, sample_status)
    values (
      r.entity_type, r.entity_id, p_window, v_start, v_end,
      jsonb_build_object(
        'exposure_count', r.exposure_count, 'play_count', r.play_count,
        'completion_count', r.completion_count, 'skip_count', r.skip_count,
        'like_count', r.like_count, 'dislike_count', r.dislike_count,
        'replay_count', r.replay_count, 'failure_count', r.failure_count,
        'attributed_count', r.attributed_count, 'total_events', r.total_events,
        'completion_rate', case when r.play_count > 0 then round(r.completion_count::numeric / r.play_count, 3) else null end,
        'skip_rate', case when r.play_count > 0 then round(r.skip_count::numeric / r.play_count, 3) else null end,
        'attributed_rate', case when r.total_events > 0 then round(r.attributed_count::numeric / r.total_events, 3) else null end),
      round(coalesce(r.avg_confidence, 0), 3),
      -- Sample 기준(Track: Exposure 20+/Playback 10+) 미달이면 insufficient — 기준을 낮추지 않는다.
      case when r.exposure_count >= 20 and r.play_count >= 10 then 'sufficient' else 'insufficient_data' end)
    on conflict (entity_type, entity_id, window_type, window_start) do update set
      window_end = excluded.window_end, metrics = excluded.metrics,
      confidence = excluded.confidence, sample_status = excluded.sample_status;
    v_rows := v_rows + 1;
  end loop;

  insert into public.ai_learning_events_audit(proposal_id, event_type, actor_id, metadata)
  values (null, 'aggregated', auth.uid(), jsonb_build_object('window', p_window, 'rows', v_rows));

  return jsonb_build_object('window', p_window, 'rows', v_rows, 'window_start', v_start, 'window_end', v_end);
end;
$$;

grant execute on function public.admin_ai_learn_build_aggregates(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) 조회 — Overview / Exposure / Event / Aggregate (읽기 전용, Pagination).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_learn_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'exposures_total', (select count(*) from public.ai_learning_exposures where not is_shadow),
    'exposures_shadow', (select count(*) from public.ai_learning_exposures where is_shadow),
    'events_total', (select count(*) from public.ai_learning_events),
    'events_valid', (select count(*) from public.ai_learning_events where signal_status = 'valid'),
    'events_invalid', (select count(*) from public.ai_learning_events where signal_status = 'invalid'),
    'events_duplicate_rejected', null,
    'events_excluded', (select count(*) from public.ai_learning_events where signal_status = 'excluded'),
    'attributed', (select count(*) from public.ai_learning_events where attribution_status = 'attributed'),
    'unattributed', (select count(*) from public.ai_learning_events where attribution_status = 'unattributed'),
    'reaction_rows_production_note', 'store_track_reactions 는 기존 계층(무변경) — 본 원장은 별도 수집',
    'track_coverage', (select count(distinct track_id) from public.ai_learning_events),
    'store_coverage', (select count(distinct store_id) from public.ai_learning_events where store_id is not null),
    'aggregates', (select count(*) from public.ai_learning_aggregates),
    'proposals', (select count(*) from public.ai_learning_weight_proposals),
    'generated_at', now()) into v;
  return v;
end;
$$;

grant execute on function public.admin_ai_learn_overview() to authenticated;

create or replace function public.admin_ai_learn_exposures(p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_limit int := greatest(1, least(coalesce(p_limit, 50), 200)); v jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v from (
    select x.id, x.is_shadow, x.source, x.algorithm_version, x.store_id, x.store_type,
      x.track_id, tr.title, x.recommendation_rank, x.playlist_id, x.sequence_draft_id,
      x.exposed_at, x.selected_at, x.playback_started_at
    from public.ai_learning_exposures x
    left join public.tracks tr on tr.id = x.track_id
    order by x.exposed_at desc
    limit v_limit offset greatest(0, coalesce(p_offset, 0))
  ) t;
  return jsonb_build_object('items', v, 'generated_at', now());
end;
$$;

grant execute on function public.admin_ai_learn_exposures(int, int) to authenticated;

create or replace function public.admin_ai_learn_events(p_status text default null, p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_limit int := greatest(1, least(coalesce(p_limit, 50), 200)); v jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v from (
    select e.id, e.event_type, e.track_id, tr.title, e.store_id, e.session_id,
      e.occurred_at, e.received_at, e.normalized_value, e.signal_type, e.signal_status,
      e.confidence, e.attribution_status, e.validation_reasons
    from public.ai_learning_events e
    left join public.tracks tr on tr.id = e.track_id
    where p_status is null or e.signal_status = p_status
    order by e.occurred_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v, 'generated_at', now());
end;
$$;

grant execute on function public.admin_ai_learn_events(text, int) to authenticated;

create or replace function public.admin_ai_learn_aggregates(p_entity_type text default 'track', p_window text default '7d', p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_limit int := greatest(1, least(coalesce(p_limit, 100), 300)); v jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v from (
    select a.entity_type, a.entity_id, tr.title, a.window_type, a.window_start, a.window_end,
      a.metrics, a.confidence, a.sample_status, a.bias_flags
    from public.ai_learning_aggregates a
    left join public.tracks tr on a.entity_type = 'track' and tr.id::text = a.entity_id
    where a.entity_type = p_entity_type and a.window_type = p_window
    order by (a.metrics->>'play_count')::numeric desc nulls last limit v_limit
  ) t;
  return jsonb_build_object('items', v, 'generated_at', now());
end;
$$;

grant execute on function public.admin_ai_learn_aggregates(text, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) Weight Proposal — 서버 구조 게이트: 합 100 · |Δ|≤5 · Sample 최소 기준.
--     Hard Policy(Eligibility/Guardrail) 관련 가중치 항목은 제안 대상이 아니다.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_learn_proposal_create(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_cur jsonb := p_payload->'current_weights';
  v_prop jsonb := p_payload->'proposed_weights';
  v_sum_cur numeric := 0; v_sum_prop numeric := 0; v_k text; v_delta numeric;
  v_sample int := coalesce((p_payload->>'sample_count')::int, 0);
  v_id uuid; v_hash text; v_dup uuid;
begin
  perform public._admin_growth_guard();

  if v_cur is null or v_prop is null then raise exception 'weights required' using errcode = '22023'; end if;
  for v_k in select jsonb_object_keys(v_cur) loop
    v_sum_cur := v_sum_cur + (v_cur->>v_k)::numeric;
  end loop;
  for v_k in select jsonb_object_keys(v_prop) loop
    v_sum_prop := v_sum_prop + (v_prop->>v_k)::numeric;
    v_delta := (v_prop->>v_k)::numeric - coalesce((v_cur->>v_k)::numeric, 0);
    if abs(v_delta) > 5 then
      raise exception 'delta cap exceeded for %: % (max ±5)', v_k, v_delta using errcode = '23514';
    end if;
  end loop;
  if round(v_sum_cur) <> 100 or round(v_sum_prop) <> 100 then
    raise exception 'weights must sum to 100 (current %, proposed %)', v_sum_cur, v_sum_prop using errcode = '23514';
  end if;
  -- Sample 최소 기준(Algorithm Comparison: Exposure 100+/Valid Outcome 30+) 미달 시 생성 차단.
  if v_sample < 30 then
    raise exception 'insufficient sample for proposal (% < 30 valid outcomes)', v_sample using errcode = '23514';
  end if;

  v_hash := md5(v_cur::text || v_prop::text || coalesce(p_payload->>'scope_type','global') || coalesce(p_payload->>'scope_id',''));
  select id into v_dup from public.ai_learning_weight_proposals
  where input_hash = v_hash and status in ('draft','ready_for_review')
    and created_at >= now() - interval '10 minutes' limit 1;
  if v_dup is not null then
    return public.admin_ai_learn_proposal_detail(v_dup) || jsonb_build_object('duplicate', true);
  end if;

  insert into public.ai_learning_weight_proposals(
    scope_type, scope_id, algorithm_version, base_weight_version, proposed_weight_version,
    current_weights, proposed_weights, deltas, evidence_window, sample_count, confidence,
    expected_impact, backtest_result, quality_score, quality_grade, risks, insufficient_data,
    explanation, input_hash, created_by)
  values (
    coalesce(nullif(p_payload->>'scope_type',''), 'global'), nullif(p_payload->>'scope_id',''),
    coalesce(nullif(p_payload->>'algorithm_version',''), 'rec-v2'),
    coalesce(nullif(p_payload->>'base_weight_version',''), 'rec-v2-w1'),
    coalesce(nullif(p_payload->>'proposed_weight_version',''), 'rec-v2-w2-proposal'),
    v_cur, v_prop, coalesce(p_payload->'deltas', '{}'::jsonb),
    coalesce(p_payload->'evidence_window', '{}'::jsonb), v_sample,
    least(1, greatest(0, coalesce((p_payload->>'confidence')::numeric, 0))),
    coalesce(p_payload->'expected_impact', '{}'::jsonb),
    coalesce(p_payload->'backtest_result', '{}'::jsonb),
    (p_payload->>'quality_score')::numeric, nullif(p_payload->>'quality_grade',''),
    coalesce(p_payload->'risks', '[]'::jsonb), coalesce(p_payload->'insufficient_data', '[]'::jsonb),
    coalesce(p_payload->'explanation', '[]'::jsonb), v_hash, auth.uid())
  returning id into v_id;

  insert into public.ai_learning_events_audit(proposal_id, event_type, actor_id, next_status, metadata)
  values (v_id, 'created', auth.uid(), 'draft', jsonb_build_object('sample', v_sample));

  return public.admin_ai_learn_proposal_detail(v_id);
end;
$$;

grant execute on function public.admin_ai_learn_proposal_create(jsonb) to authenticated;

create or replace function public.admin_ai_learn_proposals(p_status text default null, p_limit int default 50)
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
    select p.id, p.scope_type, p.scope_id, p.status, p.algorithm_version,
      p.base_weight_version, p.proposed_weight_version, p.sample_count, p.confidence,
      p.quality_score, p.quality_grade, p.created_at, p.reviewed_at,
      u.nickname as created_by_name, r.nickname as reviewed_by_name
    from public.ai_learning_weight_proposals p
    left join public.users u on u.id = p.created_by
    left join public.users r on r.id = p.reviewed_by
    where p_status is null or p.status = p_status
    order by p.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v, 'generated_at', now());
end;
$$;

grant execute on function public.admin_ai_learn_proposals(text, int) to authenticated;

create or replace function public.admin_ai_learn_proposal_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_prop jsonb; v_events jsonb;
begin
  perform public._admin_growth_guard();
  select to_jsonb(p) into v_prop from public.ai_learning_weight_proposals p where p.id = p_id;
  if v_prop is null then raise exception 'proposal not found: %', p_id using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb) into v_events from (
    select a.event_type, a.actor_id, u.nickname as actor_name, a.previous_status, a.next_status,
      a.reason, a.metadata, a.created_at
    from public.ai_learning_events_audit a
    left join public.users u on u.id = a.actor_id
    where a.proposal_id = p_id order by a.created_at desc limit 50
  ) e;
  return jsonb_build_object('proposal', v_prop, 'events', v_events, 'generated_at', now());
end;
$$;

grant execute on function public.admin_ai_learn_proposal_detail(uuid) to authenticated;

-- Backtest 결과 기록(계산은 코드 엔진 — 서버는 안전 게이트만 재검증해 저장).
create or replace function public.admin_ai_learn_proposal_backtest(p_id uuid, p_result jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_status text;
begin
  perform public._admin_growth_guard();
  select status into v_status from public.ai_learning_weight_proposals where id = p_id;
  if v_status is null then raise exception 'proposal not found: %', p_id using errcode = 'P0002'; end if;
  if length(p_result::text) > 100000 then raise exception 'result too large' using errcode = '22023'; end if;
  if coalesce((p_result->>'hard_gate_violations')::int, 0) > 0 then
    raise exception 'backtest with hard gate violations cannot be recorded as passing' using errcode = '23514';
  end if;

  update public.ai_learning_weight_proposals set backtest_result = p_result where id = p_id;
  insert into public.ai_learning_events_audit(proposal_id, event_type, actor_id, metadata)
  values (p_id, 'backtested', auth.uid(), jsonb_build_object('verdict', p_result->>'verdict'));
  return public.admin_ai_learn_proposal_detail(p_id);
end;
$$;

grant execute on function public.admin_ai_learn_proposal_backtest(uuid, jsonb) to authenticated;

create or replace function public.admin_ai_learn_proposal_set_status(p_id uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare p record; v_allowed boolean;
begin
  perform public._admin_growth_guard();
  select * into p from public.ai_learning_weight_proposals where id = p_id;
  if p.id is null then raise exception 'proposal not found: %', p_id using errcode = 'P0002'; end if;
  if p_status not in ('draft','ready_for_review','approved','rejected','archived') then
    raise exception 'invalid status: %', p_status using errcode = '22023';
  end if;
  v_allowed := (p.status = 'draft' and p_status in ('ready_for_review','archived'))
    or (p.status = 'ready_for_review' and p_status in ('approved','rejected','draft','archived'))
    or (p.status in ('approved','rejected') and p_status = 'archived');
  if not v_allowed then
    raise exception 'transition not allowed: % -> %', p.status, p_status using errcode = '22023';
  end if;
  if p_status = 'ready_for_review' then
    -- 승격 게이트: Sample/Backtest 없이는 검토 불가.
    if p.sample_count < 30 then
      raise exception 'insufficient sample blocks review' using errcode = '23514';
    end if;
    if p.backtest_result = '{}'::jsonb then
      raise exception 'backtest required before review' using errcode = '23514';
    end if;
  end if;
  if p_status = 'rejected' and coalesce(p_reason,'') = '' then
    raise exception 'rejection_reason required' using errcode = '22023';
  end if;

  update public.ai_learning_weight_proposals set
    status = p_status,
    reviewed_by = case when p_status in ('approved','rejected') then auth.uid() else reviewed_by end,
    reviewed_at = case when p_status in ('approved','rejected') then now() else reviewed_at end,
    rejection_reason = case when p_status = 'rejected' then p_reason else rejection_reason end
  where id = p_id;

  insert into public.ai_learning_events_audit(proposal_id, event_type, actor_id, previous_status, next_status, reason)
  values (p_id, 'status_changed', auth.uid(), p.status, p_status, p_reason);

  return public.admin_ai_learn_proposal_detail(p_id);
end;
$$;

grant execute on function public.admin_ai_learn_proposal_set_status(uuid, text, text) to authenticated;
