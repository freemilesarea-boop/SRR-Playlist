-- ============================================
-- 0491_admin_context_learning.sql
--
-- Phase AI-MUSIC-3 — Context Evolution & Adaptive Learning Engine.
--
-- Context Intelligence(0490)가 "현재 Context"를 분석했다면, 이번에는 **시간에 따른 진화**
-- (Drift/Stability/Decay/Evolution)를 분석하고 Recommendation 품질을 지속 향상시키는
-- **Learning Layer**를 추가한다.
--
--   Drift → Stability → Decay → Similar Context → Smart Fallback → Recommendation Outcome
--   → Confidence Calibration → Context Memory → Learning Timeline
--
-- 이번 Phase 는 **Learning Signal · Evolution 분석 전용**이다. 자동 Playlist/Scheduler/Queue/
-- Playback/Rollout 변경 없음. Recommendation 적용/기각은 **운영자 수동 기록**이며 자동 적용 없음.
--
-- 추가물:
--   1) 읽기 전용 집계 RPC: admin_context_drift(두 기간 분포), admin_context_similarity(Context
--      Feature Vector). Drift/유사도/Stability/Calibration 계산은 프론트 contextLearning.ts(순수 로직).
--   2) 저장소 2개(Context Memory · Recommendation Outcome) + CRUD RPC. 접근은 SECURITY DEFINER
--      RPC 만(직접 테이블 grant 없음 — 기존 rotation/experiment 저장소와 동일 패턴).
--
-- 절대 조건: 기존 Context Intelligence KPI 정의 변경 금지(재사용) · 추측/미존재 Context 생성 금지 ·
--   Sample 부족이면 Drift/Success/Learning 생성 금지(프론트 gate) · 점수 0~100 clamp · NaN 금지 ·
--   SECURITY DEFINER + search_path 고정 · 관리자 가드 · Dimension whitelist.
-- ============================================

-- 관리자 가드 _admin_growth_guard()(0472) · range/time_band/season(0484) · weekday_group/norm_daypart(0490) 재사용.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Context Drift — 동일 Context 의 두 기간(prior/recent, 동일 길이) 분포/KPI 비교 원천.
--    Drift Score 계산은 프론트(장르 분포 거리 + KPI 변화). 표본 부족 판정도 프론트.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_context_drift(
  p_store_type text,
  p_daypart text default null,
  p_weekday_group text default null,
  p_range text default '30d'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full interval := public._playlist_range_interval(p_range);
  v_half interval := public._playlist_range_interval(p_range) / 2;
  v_dp text := public._context_norm_daypart(p_daypart);
  v_wg text := case when p_weekday_group in ('weekday','weekend') then p_weekday_group else null end;
  v_recent_from timestamptz := now() - v_half;
  v_prior_from timestamptz := now() - v_full;
  v_recent jsonb; v_prior jsonb;
begin
  perform public._admin_growth_guard();
  if p_store_type is null then
    return jsonb_build_object('supported', false, 'reason', 'store_type 필수', 'generated_at', now());
  end if;

  -- 한 기간의 KPI + 장르 분포(share) 산출 헬퍼 인라인.
  select to_jsonb(w) into v_recent from (
    select
      count(*) as events,
      round((avg(case when e.track_duration_seconds>0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric,1) as completion_rate,
      round(100.0*count(*) filter (where e.event_type='skip')/nullif(count(*),0),1) as skip_rate,
      coalesce((
        select jsonb_agg(jsonb_build_object('key', g.key, 'events', g.events,
          'share', round(100.0*g.events/nullif(sum(g.events) over (),0),1)) order by g.events desc)
        from (
          select coalesce(tr.main_genre,'(unknown)') as key, count(*) as events
          from public.playback_events_v2 e2 join public.tracks tr on tr.id=e2.track_id
          where e2.store_type_slug=p_store_type and e2.created_at >= v_recent_from
            and (v_dp is null or public._playlist_time_band(extract(hour from (e2.created_at at time zone 'Asia/Seoul'))::int)=v_dp)
            and (v_wg is null or public._context_weekday_group(extract(isodow from (e2.created_at at time zone 'Asia/Seoul'))::int)=v_wg)
          group by coalesce(tr.main_genre,'(unknown)')
        ) g
      ), '[]'::jsonb) as genres
    from public.playback_events_v2 e
    where e.store_type_slug=p_store_type and e.created_at >= v_recent_from
      and (v_dp is null or public._playlist_time_band(extract(hour from (e.created_at at time zone 'Asia/Seoul'))::int)=v_dp)
      and (v_wg is null or public._context_weekday_group(extract(isodow from (e.created_at at time zone 'Asia/Seoul'))::int)=v_wg)
  ) w;

  select to_jsonb(w) into v_prior from (
    select
      count(*) as events,
      round((avg(case when e.track_duration_seconds>0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric,1) as completion_rate,
      round(100.0*count(*) filter (where e.event_type='skip')/nullif(count(*),0),1) as skip_rate,
      coalesce((
        select jsonb_agg(jsonb_build_object('key', g.key, 'events', g.events,
          'share', round(100.0*g.events/nullif(sum(g.events) over (),0),1)) order by g.events desc)
        from (
          select coalesce(tr.main_genre,'(unknown)') as key, count(*) as events
          from public.playback_events_v2 e2 join public.tracks tr on tr.id=e2.track_id
          where e2.store_type_slug=p_store_type and e2.created_at >= v_prior_from and e2.created_at < v_recent_from
            and (v_dp is null or public._playlist_time_band(extract(hour from (e2.created_at at time zone 'Asia/Seoul'))::int)=v_dp)
            and (v_wg is null or public._context_weekday_group(extract(isodow from (e2.created_at at time zone 'Asia/Seoul'))::int)=v_wg)
          group by coalesce(tr.main_genre,'(unknown)')
        ) g
      ), '[]'::jsonb) as genres
    from public.playback_events_v2 e
    where e.store_type_slug=p_store_type and e.created_at >= v_prior_from and e.created_at < v_recent_from
      and (v_dp is null or public._playlist_time_band(extract(hour from (e.created_at at time zone 'Asia/Seoul'))::int)=v_dp)
      and (v_wg is null or public._context_weekday_group(extract(isodow from (e.created_at at time zone 'Asia/Seoul'))::int)=v_wg)
  ) w;

  return jsonb_build_object(
    'store_type', p_store_type, 'daypart', v_dp, 'weekday_group', v_wg, 'range', coalesce(p_range,'30d'),
    'recent', v_recent, 'prior', v_prior,
    'recent_window', jsonb_build_object('from', v_recent_from, 'to', now()),
    'prior_window', jsonb_build_object('from', v_prior_from, 'to', v_recent_from),
    'generated_at', now()
  );
end;
$$;

grant execute on function public.admin_context_drift(text, text, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Context Similarity — Level-1(Store Type) Context 별 Feature Vector(장르 분포 + KPI).
--    Cosine/유사도 계산은 프론트. 표본 부족(p_min_sample)은 프론트에서 제외.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_context_similarity(
  p_range text default '30d',
  p_min_sample int default 20,
  p_limit int default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - public._playlist_range_interval(p_range);
  v_min int := greatest(1, least(coalesce(p_min_sample,20), 100000));
  v_limit int := greatest(1, least(coalesce(p_limit,50), 200));
  v_items jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(x) order by x.events desc), '[]'::jsonb) into v_items from (
    select s.store_type, s.events, s.completion_rate, s.skip_rate, s.avg_listen_seconds,
      coalesce((
        select jsonb_agg(jsonb_build_object('key', g.key, 'share', round(100.0*g.events/nullif(s.events,0),1)) order by g.events desc)
        from (
          select coalesce(tr.main_genre,'(unknown)') as key, count(*) as events
          from public.playback_events_v2 e join public.tracks tr on tr.id=e.track_id
          where e.store_type_slug=s.store_type and e.created_at >= v_since
          group by coalesce(tr.main_genre,'(unknown)')
        ) g
      ), '[]'::jsonb) as genres
    from (
      select e.store_type_slug as store_type, count(*) as events,
        round((avg(case when e.track_duration_seconds>0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric,1) as completion_rate,
        round(100.0*count(*) filter (where e.event_type='skip')/nullif(count(*),0),1) as skip_rate,
        round(avg(e.listened_seconds)::numeric,1) as avg_listen_seconds
      from public.playback_events_v2 e
      where e.created_at >= v_since and e.store_type_slug is not null
      group by e.store_type_slug
      having count(*) >= v_min
      order by count(*) desc
      limit v_limit
    ) s
  ) x;

  return jsonb_build_object('range', coalesce(p_range,'30d'), 'min_sample', v_min, 'items', v_items, 'generated_at', now());
end;
$$;

grant execute on function public.admin_context_similarity(text, int, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Context Memory 저장소 — 운영자/세션이 남기는 Context Snapshot(진화 추적용).
--    접근은 아래 RPC 만(직접 grant 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.context_learning_snapshots (
  id             uuid primary key default gen_random_uuid(),
  context_key    text not null,
  dimensions     jsonb not null default '{}'::jsonb,
  period_start   timestamptz,
  period_end     timestamptz,
  sample_size    int,
  health_score   int,
  score          int,
  confidence     int,
  drift_score    int,
  reco_count     int,
  success_rate   numeric,
  support_status text,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
comment on table public.context_learning_snapshots is
  'AI-MUSIC-3 — Context Memory. Context 별 Health/Score/Confidence/Drift/Success Snapshot. 자동 반영 없음(Learning Signal).';
create index if not exists idx_ctx_snap on public.context_learning_snapshots (context_key, created_at desc);

-- Recommendation Outcome 저장소 — 추천 생성 → 운영자 적용/기각 → Outcome(개선/중립/악화) 기록.
create table if not exists public.context_recommendation_outcomes (
  id            uuid primary key default gen_random_uuid(),
  context_key   text not null,
  dimensions    jsonb not null default '{}'::jsonb,
  reco_type     text not null,
  title         text,
  evidence      jsonb not null default '[]'::jsonb,
  status        text not null default 'active' check (status in ('active','applied','dismissed','resolved')),
  before_kpi    jsonb,
  after_kpi     jsonb,
  outcome       text check (outcome in ('improved','neutral','degraded')),
  created_by    uuid,
  resolved_by   uuid,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
comment on table public.context_recommendation_outcomes is
  'AI-MUSIC-3 — Context Recommendation Outcome. 운영자 적용/기각 + 이후 KPI 개선 여부. 자동 적용 금지.';
create index if not exists idx_ctx_reco on public.context_recommendation_outcomes (context_key, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Context Memory 저장/조회.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_context_snapshot_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_row public.context_learning_snapshots;
begin
  perform public._admin_growth_guard();
  if coalesce(p_payload->>'context_key','') = '' then
    raise exception 'context_key required' using errcode = '22023';
  end if;

  insert into public.context_learning_snapshots(
    context_key, dimensions, period_start, period_end, sample_size,
    health_score, score, confidence, drift_score, reco_count, success_rate, support_status, created_by
  ) values (
    p_payload->>'context_key', coalesce(p_payload->'dimensions','{}'::jsonb),
    nullif(p_payload->>'period_start','')::timestamptz, nullif(p_payload->>'period_end','')::timestamptz,
    nullif(p_payload->>'sample_size','')::int,
    -- 점수는 0~100 clamp(방어적).
    least(100, greatest(0, nullif(p_payload->>'health_score','')::int)),
    least(100, greatest(0, nullif(p_payload->>'score','')::int)),
    least(100, greatest(0, nullif(p_payload->>'confidence','')::int)),
    least(100, greatest(0, nullif(p_payload->>'drift_score','')::int)),
    nullif(p_payload->>'reco_count','')::int, nullif(p_payload->>'success_rate','')::numeric,
    nullif(p_payload->>'support_status',''), auth.uid()
  ) returning id into v_id;

  select * into v_row from public.context_learning_snapshots where id = v_id;
  return to_jsonb(v_row);
end;
$$;
grant execute on function public.admin_context_snapshot_save(jsonb) to authenticated;

create or replace function public.admin_context_memory(p_context_key text default null, p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.context_learning_snapshots s
    where (p_context_key is null or s.context_key = p_context_key)
    order by s.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('context_key', p_context_key, 'items', v_items, 'generated_at', now());
end;
$$;
grant execute on function public.admin_context_memory(text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Recommendation Outcome 기록/해결/조회 + Learning 집계.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_context_reco_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_row public.context_recommendation_outcomes;
begin
  perform public._admin_growth_guard();
  if coalesce(p_payload->>'context_key','') = '' then raise exception 'context_key required' using errcode='22023'; end if;
  if coalesce(p_payload->>'reco_type','') = '' then raise exception 'reco_type required' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
    raise exception 'evidence required (Evidence 없는 추천 기록 금지)' using errcode='22023';
  end if;

  insert into public.context_recommendation_outcomes(
    context_key, dimensions, reco_type, title, evidence, status, before_kpi, created_by
  ) values (
    p_payload->>'context_key', coalesce(p_payload->'dimensions','{}'::jsonb),
    p_payload->>'reco_type', nullif(p_payload->>'title',''), p_payload->'evidence',
    'active', p_payload->'before_kpi', auth.uid()
  ) returning id into v_id;
  select * into v_row from public.context_recommendation_outcomes where id = v_id;
  return to_jsonb(v_row);
end;
$$;
grant execute on function public.admin_context_reco_save(jsonb) to authenticated;

create or replace function public.admin_context_reco_resolve(
  p_id uuid, p_status text, p_outcome text default null, p_after_kpi jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.context_recommendation_outcomes;
begin
  perform public._admin_growth_guard();
  if p_status not in ('applied','dismissed','resolved') then
    raise exception 'invalid status (applied/dismissed/resolved)' using errcode='22023';
  end if;
  if p_outcome is not null and p_outcome not in ('improved','neutral','degraded') then
    raise exception 'invalid outcome' using errcode='22023';
  end if;

  update public.context_recommendation_outcomes
    set status = p_status, outcome = p_outcome, after_kpi = coalesce(p_after_kpi, after_kpi),
        resolved_by = auth.uid(), resolved_at = now()
    where id = p_id
    returning * into v_row;
  if v_row.id is null then raise exception 'not found' using errcode='P0002'; end if;
  return to_jsonb(v_row);
end;
$$;
grant execute on function public.admin_context_reco_resolve(uuid, text, text, jsonb) to authenticated;

create or replace function public.admin_context_reco_list(
  p_context_key text default null, p_status text default null, p_limit int default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.context_recommendation_outcomes r
    where (p_context_key is null or r.context_key = p_context_key)
      and (p_status is null or r.status = p_status)
    order by r.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end;
$$;
grant execute on function public.admin_context_reco_list(text, text, int) to authenticated;

-- Learning 집계 — 상태 분포/Type별 Outcome/성공률(계산 보정은 프론트). Sample 부족은 프론트 gate.
create or replace function public.admin_context_learning(p_context_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_by_status jsonb; v_by_type jsonb; v_totals jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) into v_by_status from (
    select status, count(*) cnt from public.context_recommendation_outcomes
    where (p_context_key is null or context_key = p_context_key) group by status
  ) s;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.total desc), '[]'::jsonb) into v_by_type from (
    select reco_type,
      count(*) as total,
      count(*) filter (where status in ('applied','resolved')) as applied,
      count(*) filter (where status='dismissed') as dismissed,
      count(*) filter (where outcome='improved') as improved,
      count(*) filter (where outcome='neutral') as neutral,
      count(*) filter (where outcome='degraded') as degraded
    from public.context_recommendation_outcomes
    where (p_context_key is null or context_key = p_context_key)
    group by reco_type
  ) t;

  select to_jsonb(x) into v_totals from (
    select count(*) as total,
      count(*) filter (where status in ('applied','resolved')) as applied,
      count(*) filter (where status='dismissed') as dismissed,
      count(*) filter (where outcome is not null) as resolved_outcomes,
      count(*) filter (where outcome='improved') as improved,
      count(*) filter (where outcome='degraded') as degraded
    from public.context_recommendation_outcomes
    where (p_context_key is null or context_key = p_context_key)
  ) x;

  return jsonb_build_object('context_key', p_context_key, 'by_status', v_by_status, 'by_type', v_by_type, 'totals', v_totals, 'generated_at', now());
end;
$$;
grant execute on function public.admin_context_learning(text) to authenticated;
