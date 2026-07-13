-- ============================================
-- 0488_admin_adaptive_rotation.sql
--
-- Phase AI-PLAYLIST-5 — Adaptive Rotation & Anti-Fatigue Sequencing Engine.
--
-- AI Playlist Generator(0487)가 선택한 Track 집합을 기반으로, 반복 피로도·아티스트/장르/
-- 무드 편중·BPM/무드 흐름·재발견·신곡 노출을 고려해 **덜 질리는 재생 순서 초안(Rotation
-- Draft)** 을 생성한다. Selection(어떤 Track) 과 Sequencing(어떤 순서) 을 분리한다.
--
-- **자동 Queue/Scheduler/Playback/Crossfade 반영 전부 금지.** 이 마이그레이션은 Rotation
-- Draft 저장/조회/상태/이력 + Sequencing 용 per-track KPI/재생윈도우 집계(읽기 전용)만
-- 추가한다. Sequencing 계산은 프론트 rotationSequencer.ts(순수 로직).
--
-- 지원/미지원(실제 데이터 기준): 지원 = main_genre·mood·bpm(있을 때)·duration·artist +
--   play_count(1d/7d/30d)·last_played_at(store_type/전체 History). 미지원 = key·vocal·
--   explicit·energy 컬럼 부재, 개별 store_id History(playback_events_v2 미기록).
--
-- 절대 조건: Evidence 없는 Track 배치 금지 / sequence Track 중복 금지 / config clamp /
--   Null 메타 추정 금지 / 승인=Publish 아님 / NaN·Infinity 금지 / SECURITY DEFINER+search_path.
-- ============================================

-- 관리자 가드는 0472 의 _admin_growth_guard() 재사용. range 헬퍼는 0484 재사용.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Rotation Track Pool — 메타 + KPI + 재생 윈도우(1d/7d/30d) + last_played(읽기 전용).
--    Sequencing 의 Fatigue/Rediscovery 계산 입력. Store-level 없음 → 전체/store_type History.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_rotation_track_pool(
  p_range text default '30d', p_limit int default 500, p_store_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - public._playlist_range_interval(p_range);
  v_limit int := greatest(1, least(coalesce(p_limit, 500), 2000));
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.p30d desc, t.title), '[]'::jsonb) into v_result
  from (
    select tr.id as track_id, tr.title, tr.artist, tr.main_genre, tr.mood, tr.bpm, tr.duration, tr.language,
      k.events, k.skip_rate, k.completion_rate, coalesce(k.likes,0) as likes, coalesce(k.replays,0) as replays,
      k.p1d, k.p7d, k.p30d, k.last_played_at,
      case when k.last_played_at is not null then round(extract(epoch from (now() - k.last_played_at))/86400, 1) else null end as days_since_last_play,
      k.store_coverage, ro.stage as rollout_stage
    from public.tracks tr
    join (
      select e.track_id,
        count(*) as events,
        round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate,
        round((avg(case when e.track_duration_seconds>0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
        count(*) filter (where e.event_type='like') as likes,
        count(*) filter (where e.event_type='replay') as replays,
        count(*) filter (where e.created_at >= now()-interval '1 day') as p1d,
        count(*) filter (where e.created_at >= now()-interval '7 days') as p7d,
        count(*) filter (where e.created_at >= now()-interval '30 days') as p30d,
        max(e.created_at) as last_played_at,
        count(distinct e.store_type_slug) as store_coverage
      from public.playback_events_v2 e
      where e.created_at >= v_since and e.track_id is not null
        and (p_store_type is null or e.store_type_slug = p_store_type)
      group by e.track_id
    ) k on k.track_id = tr.id
    left join public.track_rollouts ro on ro.track_id = tr.id
    order by k.p30d desc, tr.title
    limit v_limit
  ) t;

  return jsonb_build_object('range', coalesce(p_range,'30d'), 'store_type', p_store_type,
    'store_level_supported', false, 'items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_rotation_track_pool(text, int, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Rotation Draft 저장소.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.rotation_drafts (
  id                      uuid primary key default gen_random_uuid(),
  source_playlist_draft_id uuid references public.playlist_drafts(id) on delete set null,
  name                    text not null,
  store_type_slug         text, brand_key text, daypart text, season text,
  target_duration_minutes int,
  status                  text not null default 'draft' check (status in ('draft','simulated','approved','rejected','archived')),
  config                  jsonb not null default '{}'::jsonb,
  sequence                jsonb not null,       -- [{position,track_id,title,score,reason,constraints}] 필수
  simulation              jsonb,
  evidence                jsonb not null default '[]'::jsonb,
  created_by              uuid, approved_by uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  approved_at             timestamptz
);

comment on table public.rotation_drafts is
  'AI-PLAYLIST-5 — 재생 순서 초안(Rotation Draft). 자동 Queue/Scheduler 반영 없음; 승인=Publish 아님. Sequencing 계산은 프론트.';

create index if not exists idx_rotation_drafts_status on public.rotation_drafts (status, created_at desc);

-- Rotation Draft 이력(생성/시뮬/승인/반려 Audit).
create table if not exists public.rotation_draft_history (
  id          uuid primary key default gen_random_uuid(),
  draft_id    uuid references public.rotation_drafts(id) on delete cascade,
  action      text not null check (action in ('created','simulated','approved','rejected','archived','edited')),
  from_status text, to_status text,
  note        text,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists idx_rotation_hist on public.rotation_draft_history (draft_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Draft 저장(sequence 필수 · Track 중복 금지 · evidence 필수).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_rotation_draft_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid; v_row public.rotation_drafts;
  v_seq jsonb := p_payload->'sequence';
  v_count int; v_distinct int;
begin
  perform public._admin_growth_guard();

  if coalesce(p_payload->>'name','') = '' then raise exception 'name required' using errcode = '22023'; end if;
  if v_seq is null or jsonb_typeof(v_seq) <> 'array' or jsonb_array_length(v_seq) = 0 then
    raise exception 'sequence required (Evidence 없는 순서 저장 금지)' using errcode = '22023';
  end if;
  -- Track 중복 금지 검증.
  select jsonb_array_length(v_seq), count(distinct x->>'track_id')
  into v_count, v_distinct
  from jsonb_array_elements(v_seq) x;
  if v_count <> v_distinct then
    raise exception 'duplicate track in sequence (동일 Track 중복 금지)' using errcode = '22023';
  end if;

  insert into public.rotation_drafts(
    source_playlist_draft_id, name, store_type_slug, brand_key, daypart, season, target_duration_minutes,
    status, config, sequence, simulation, evidence, created_by
  ) values (
    nullif(p_payload->>'source_playlist_draft_id','')::uuid, p_payload->>'name',
    nullif(p_payload->>'store_type_slug',''), nullif(p_payload->>'brand_key',''),
    nullif(p_payload->>'daypart',''), nullif(p_payload->>'season',''),
    nullif(p_payload->>'target_duration_minutes','')::int,
    'simulated', coalesce(p_payload->'config','{}'::jsonb), v_seq, p_payload->'simulation',
    coalesce(p_payload->'evidence','[]'::jsonb), auth.uid()
  ) returning id into v_id;

  insert into public.rotation_draft_history(draft_id, action, to_status, created_by)
  values (v_id, 'created', 'simulated', auth.uid());

  select * into v_row from public.rotation_drafts where id = v_id;
  return to_jsonb(v_row);
end;
$$;

grant execute on function public.admin_rotation_draft_save(jsonb) to authenticated;

create or replace function public.admin_rotation_drafts(p_status text default null, p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_limit int := greatest(1, least(coalesce(p_limit, 50), 200)); v_result jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_result
  from (
    select d.*, u.nickname as created_by_name
    from public.rotation_drafts d left join public.users u on u.id = d.created_by
    where p_status is null or d.status = p_status
    order by d.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_rotation_drafts(text, int) to authenticated;

-- Draft 상태 변경(승인=Publish 아님; Queue/Scheduler 변경 없음). 이력 기록.
create or replace function public.admin_rotation_draft_set_status(p_id uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.rotation_drafts; v_from text;
begin
  perform public._admin_growth_guard();
  if p_status not in ('draft','simulated','approved','rejected','archived') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  select status into v_from from public.rotation_drafts where id = p_id;
  if v_from is null then raise exception 'draft not found: %', p_id using errcode = 'P0002'; end if;

  update public.rotation_drafts set
    status = p_status,
    approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    updated_at = now()
  where id = p_id returning * into v_row;

  insert into public.rotation_draft_history(draft_id, action, from_status, to_status, note, created_by)
  values (p_id, case p_status when 'approved' then 'approved' when 'rejected' then 'rejected' when 'archived' then 'archived' else 'edited' end, v_from, p_status, p_note, auth.uid());

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.admin_rotation_draft_set_status(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Rotation 이력 / Learning(참고용; 자동 Weight/Rule 변경 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_rotation_history(p_limit int default 100, p_draft_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_limit int := greatest(1, least(coalesce(p_limit, 100), 300)); v_result jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_result
  from (
    select h.id, h.draft_id, h.action, h.from_status, h.to_status, h.note, h.created_at, u.nickname as created_by_name
    from public.rotation_draft_history h left join public.users u on u.id = h.created_by
    where p_draft_id is null or h.draft_id = p_draft_id
    order by h.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_rotation_history(int, uuid) to authenticated;

create or replace function public.admin_rotation_learning()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_by_status jsonb; v_total int; v_approved int; v_rejected int;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) into v_by_status
  from (select status, count(*) cnt from public.rotation_drafts group by status) s;
  select count(*) into v_total from public.rotation_drafts;
  select count(*) into v_approved from public.rotation_drafts where status = 'approved';
  select count(*) into v_rejected from public.rotation_drafts where status = 'rejected';

  return jsonb_build_object(
    'by_status', v_by_status, 'total', v_total, 'approved', v_approved, 'rejected', v_rejected,
    'approval_rate', case when v_approved + v_rejected > 0 then round(100.0 * v_approved / (v_approved + v_rejected), 1) else null end,
    'generated_at', now()
  );
end;
$$;

grant execute on function public.admin_rotation_learning() to authenticated;
