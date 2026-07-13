-- ============================================
-- 0486_admin_track_rollout.sql
--
-- Phase AI-PLAYLIST-3 — New Track Test Pool & Progressive Rollout.
--
-- 신규 음원을 전체 매장에 즉시 배포하지 않고 Draft → Test Pool → Pilot → Limited →
-- Expanded → Global → Archived 순으로 **점진적으로 확산**한다. **자동 전면 배포/자동 승격/
-- 자동 Rollback 을 하지 않는다** — 실제 재생 이벤트(playback_events_v2) KPI 로 승격/보류/
-- Rollback 을 "추천"만 하고, 단계 변경은 운영자 승인(수동)으로만 진행한다.
--
-- 기존 Playback/Queue/Scheduler/Playlist/Recommendation/Experiment 무변경(재사용·읽기만).
-- 이 마이그레이션은 rollout 상태/이력 저장 + per-track KPI 집계(읽기 전용)만 추가한다.
--
-- 절대 조건: Evidence 없는 승격 금지 / Sample 부족 시 '판단 보류' / 자동 배포·승격·Rollback
--   금지 / 존재하는 KPI 만 / 점수·비율 clamp / NaN·Infinity 금지 / SECURITY DEFINER+search_path.
-- ============================================

-- 관리자 가드는 0472 의 _admin_growth_guard() 재사용. range/scope 헬퍼는 0484 재사용.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Track Rollout 상태 저장소.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.track_rollouts (
  id                uuid primary key default gen_random_uuid(),
  track_id          uuid not null,
  track_title       text,
  stage             text not null default 'test_pool'
                    check (stage in ('draft','test_pool','pilot','limited','expanded','global','archived')),
  scope_type        text not null default 'all' check (scope_type in ('all','industry','store_type','brand','playlist')),
  scope_value       text,
  rollout_percent   int not null default 5 check (rollout_percent between 0 and 100),
  promotion_config  jsonb not null default '{"completion_min":70,"skip_max":10,"sample_min":30,"rollback_skip_max":25,"rollback_completion_min":50}'::jsonb,
  notes             text,
  last_evaluated_at timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (track_id)
);

comment on table public.track_rollouts is
  'AI-PLAYLIST-3 — 신규 음원 점진 확산 상태. 자동 배포/승격/Rollback 없음; 실제 KPI 로 추천만, 단계 변경은 수동.';

create index if not exists idx_track_rollout_stage on public.track_rollouts (stage, updated_at desc);

-- 단계 변경 이력(승격/보류/Rollback Audit). Evidence 필수(promote/rollback).
create table if not exists public.track_rollout_history (
  id           uuid primary key default gen_random_uuid(),
  rollout_id   uuid references public.track_rollouts(id) on delete cascade,
  track_id     uuid,
  from_stage   text,
  to_stage     text,
  decision     text not null check (decision in ('promote','hold','rollback','archive','manual')),
  from_percent int, to_percent int,
  evidence     jsonb,
  reason       text,
  created_by   uuid,
  created_at   timestamptz not null default now()
);

comment on table public.track_rollout_history is
  'AI-PLAYLIST-3 — 승격/보류/Rollback 이력(Audit). promote/rollback 는 Evidence 필수.';

create index if not exists idx_track_rollout_hist on public.track_rollout_history (rollout_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Rollout 생성/수정. 기본 test_pool·5%. promotion_config 검증.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_track_rollout_upsert(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_scope text := coalesce(p_payload->>'scope_type', 'all');
  v_percent int := greatest(0, least(coalesce((p_payload->>'rollout_percent')::int, 5), 100));
  v_row public.track_rollouts;
begin
  perform public._admin_growth_guard();

  if (p_payload->>'track_id') is null then
    raise exception 'track_id required' using errcode = '22023';
  end if;
  if v_scope not in ('all','industry','store_type','brand','playlist') then
    raise exception 'invalid scope_type' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.track_rollouts(track_id, track_title, scope_type, scope_value, rollout_percent, promotion_config, notes, created_by)
    values (
      (p_payload->>'track_id')::uuid, p_payload->>'track_title', v_scope, nullif(p_payload->>'scope_value',''),
      v_percent, coalesce(p_payload->'promotion_config', '{"completion_min":70,"skip_max":10,"sample_min":30,"rollback_skip_max":25,"rollback_completion_min":50}'::jsonb),
      nullif(p_payload->>'notes',''), auth.uid()
    )
    on conflict (track_id) do update
      set scope_type = excluded.scope_type, scope_value = excluded.scope_value, rollout_percent = excluded.rollout_percent,
          promotion_config = excluded.promotion_config, notes = excluded.notes, updated_at = now()
    returning id into v_id;
  else
    update public.track_rollouts set
      scope_type = v_scope, scope_value = nullif(p_payload->>'scope_value',''), rollout_percent = v_percent,
      promotion_config = coalesce(p_payload->'promotion_config', promotion_config), notes = nullif(p_payload->>'notes',''),
      updated_at = now()
    where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'rollout not found: %', p_id using errcode = 'P0002';
    end if;
  end if;

  select * into v_row from public.track_rollouts where id = v_id;
  return to_jsonb(v_row);
end;
$$;

grant execute on function public.admin_track_rollout_upsert(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) 단계 변경(수동 승인). promote/rollback 는 Evidence 필수. 이력 기록.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_track_rollout_set_stage(
  p_id uuid, p_to_stage text, p_decision text, p_to_percent int default null,
  p_evidence jsonb default null, p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.track_rollouts;
  v_from_stage text; v_from_percent int;
begin
  perform public._admin_growth_guard();

  if p_to_stage not in ('draft','test_pool','pilot','limited','expanded','global','archived') then
    raise exception 'invalid stage' using errcode = '22023';
  end if;
  if p_decision not in ('promote','hold','rollback','archive','manual') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  if p_decision in ('promote','rollback') and (p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0) then
    raise exception 'evidence required for promote/rollback (근거 없는 승격/Rollback 금지)' using errcode = '22023';
  end if;

  select stage, rollout_percent into v_from_stage, v_from_percent from public.track_rollouts where id = p_id;
  if v_from_stage is null then
    raise exception 'rollout not found: %', p_id using errcode = 'P0002';
  end if;

  update public.track_rollouts set
    stage = p_to_stage,
    rollout_percent = coalesce(p_to_percent, rollout_percent),
    updated_at = now()
  where id = p_id
  returning * into v_row;

  insert into public.track_rollout_history(rollout_id, track_id, from_stage, to_stage, decision, from_percent, to_percent, evidence, reason, created_by)
  values (p_id, v_row.track_id, v_from_stage, p_to_stage, p_decision, v_from_percent, coalesce(p_to_percent, v_row.rollout_percent), coalesce(p_evidence, '[]'::jsonb), p_reason, auth.uid());

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.admin_track_rollout_set_stage(uuid, text, text, int, jsonb, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Rollout 목록.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_track_rollouts(p_stage text default null, p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 100), 300));
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc), '[]'::jsonb) into v_result
  from (
    select r.*, u.nickname as created_by_name
    from public.track_rollouts r
    left join public.users u on u.id = r.created_by
    where p_stage is null or r.stage = p_stage
    order by r.updated_at desc limit v_limit
  ) t;

  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_track_rollouts(text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Track KPI 집계 — playback_events_v2 에서 per-track KPI(읽기 전용). scope 필터.
--    승격/Rollback 판정은 프론트 trackRollout.ts(순수 로직). 여기서는 원자료만.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_track_rollout_compare(
  p_track_id uuid, p_scope_type text default 'all', p_scope_value text default null, p_range text default '30d'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - public._playlist_range_interval(p_range);
  v_row jsonb;
begin
  perform public._admin_growth_guard();

  if p_scope_type not in ('all','industry','store_type','brand','playlist') then
    raise exception 'invalid scope_type' using errcode = '22023';
  end if;

  select to_jsonb(t) into v_row
  from (
    select p_track_id as track_id,
      count(*) as events,
      count(*) filter (where e.event_type='skip') as skips,
      round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate,
      round((avg(case when e.track_duration_seconds>0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
      round(avg(e.listened_seconds)::numeric, 1) as avg_listen_seconds,
      count(*) filter (where e.event_type='like') as likes,
      count(*) filter (where e.event_type='replay') as replays,
      count(distinct e.store_type_slug) as store_coverage,
      count(distinct e.playlist_id) as playlist_coverage
    from public.playback_events_v2 e
    where e.track_id = p_track_id
      and e.created_at >= v_since
      and (
        p_scope_type in ('all','brand')   -- brand 데이터 미기록 → 전체와 동일 처리(미지원 표기는 프론트)
        or (p_scope_type in ('industry','store_type') and e.store_type_slug = p_scope_value)
        or (p_scope_type = 'playlist' and e.playlist_id = nullif(p_scope_value,'')::uuid)
      )
  ) t;

  return jsonb_build_object('track_id', p_track_id, 'scope_type', p_scope_type, 'scope_value', p_scope_value, 'range', coalesce(p_range,'30d'), 'kpi', v_row, 'generated_at', now());
end;
$$;

grant execute on function public.admin_track_rollout_compare(uuid, text, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Rollout 이력.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_track_rollout_history(p_limit int default 100, p_track_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 100), 300));
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_result
  from (
    select h.id, h.rollout_id, h.track_id, h.from_stage, h.to_stage, h.decision, h.from_percent, h.to_percent,
           h.evidence, h.reason, h.created_at, u.nickname as created_by_name
    from public.track_rollout_history h
    left join public.users u on u.id = h.created_by
    where p_track_id is null or h.track_id = p_track_id
    order by h.created_at desc limit v_limit
  ) t;

  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_track_rollout_history(int, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Learning 집계(승격 성공률·Rollback 비율; 참고용, 자동 Rule 변경 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_track_rollout_learning()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_by_decision jsonb; v_stage_dist jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_object_agg(decision, cnt), '{}'::jsonb) into v_by_decision
  from (select decision, count(*) as cnt from public.track_rollout_history group by decision) s;

  select coalesce(jsonb_object_agg(stage, cnt), '{}'::jsonb) into v_stage_dist
  from (select stage, count(*) as cnt from public.track_rollouts group by stage) s;

  return jsonb_build_object(
    'by_decision', v_by_decision,
    'stage_distribution', v_stage_dist,
    'total_rollouts', (select count(*) from public.track_rollouts),
    'generated_at', now()
  );
end;
$$;

grant execute on function public.admin_track_rollout_learning() to authenticated;
