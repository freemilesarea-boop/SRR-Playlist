-- ============================================
-- 0487_admin_playlist_generator.sql
--
-- Phase AI-PLAYLIST-4 — AI Playlist Generator & Multi-Dimensional Curation Engine.
--
-- 실제 Track 메타데이터(main_genre·mood·bpm·duration·artist·language·release_date)와
-- 재생 이벤트 KPI(playback_events_v2)를 종합해 성과가 높은 **Playlist 초안(Draft)** 을
-- 생성한다. **자동 생성은 허용하지만 자동 배포(Publish)는 금지** — Draft 로 저장하고
-- 운영자 승인 후 기존 Rollout(0486) 을 사용한다. LLM 이 음악 취향을 임의 생성하지 않는다.
--
-- 기존 Playback/Queue/Scheduler/Recommendation/Rollout/Playlist 구조 무변경(재사용·읽기만).
-- 이 마이그레이션은 Draft/Brand DNA 저장 + Track Pool 집계(읽기 전용)만 추가한다.
--
-- 지원/미지원(실제 컬럼 기준): 지원 = main_genre·mood·bpm·duration·artist·language.
--   미지원 = key·vocal 여부·explicit(컬럼 없음) → 프론트에서 '미지원' 표기.
--
-- 절대 조건: Evidence 없는 Track 선택 금지 / 존재하는 데이터만 / 자동 Publish 금지 /
--   Compatibility·Fatigue 0~100 / NaN·Infinity 금지 / SECURITY DEFINER+search_path 고정.
-- ============================================

-- 관리자 가드는 0472 의 _admin_growth_guard() 재사용. range 헬퍼는 0484 재사용.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Generator Track Pool — 메타데이터 + per-track KPI + rollout stage(읽기 전용).
--    이벤트가 있는 트랙 위주로 상위 p_limit 반환(성능). KPI 없는 트랙은 events=0.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_generator_track_pool(p_range text default '30d', p_limit int default 300)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - public._playlist_range_interval(p_range);
  v_limit int := greatest(1, least(coalesce(p_limit, 300), 1000));
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.events desc, t.title), '[]'::jsonb) into v_result
  from (
    select tr.id as track_id, tr.title, tr.artist, tr.main_genre, tr.mood, tr.bpm, tr.duration, tr.language, tr.release_date,
      coalesce(k.events, 0) as events,
      k.skip_rate, k.completion_rate, coalesce(k.likes, 0) as likes, coalesce(k.replays, 0) as replays,
      k.last_event_at, k.store_coverage,
      ro.stage as rollout_stage
    from public.tracks tr
    join (
      -- 이벤트가 있는 트랙만(생성 후보 relevance). KPI 집계.
      select e.track_id,
        count(*) as events,
        round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate,
        round((avg(case when e.track_duration_seconds>0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
        count(*) filter (where e.event_type='like') as likes,
        count(*) filter (where e.event_type='replay') as replays,
        max(e.created_at) as last_event_at,
        count(distinct e.store_type_slug) as store_coverage
      from public.playback_events_v2 e
      where e.created_at >= v_since and e.track_id is not null
      group by e.track_id
    ) k on k.track_id = tr.id
    left join public.track_rollouts ro on ro.track_id = tr.id
    order by k.events desc, tr.title
    limit v_limit
  ) t;

  return jsonb_build_object('range', coalesce(p_range,'30d'), 'items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_generator_track_pool(text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Brand DNA — 브랜드 운영 프로필(기존 Brand Policy 없으면 Draft Profile 저장).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.brand_dna (
  brand_key   text primary key,
  brand_label text,
  profile     jsonb not null default '{}'::jsonb,  -- {genres:[],moods:[],attributes:[],bpm_min,bpm_max}
  source      text not null default 'draft' check (source in ('policy','draft')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.brand_dna is
  'AI-PLAYLIST-4 — 브랜드 운영 프로필(Brand DNA). 기존 Brand Policy 없을 때 Draft Profile.';

create or replace function public.admin_brand_dna_upsert(p_brand_key text, p_brand_label text, p_profile jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.brand_dna;
begin
  perform public._admin_growth_guard();
  if coalesce(p_brand_key,'') = '' then raise exception 'brand_key required' using errcode = '22023'; end if;

  insert into public.brand_dna(brand_key, brand_label, profile, source, created_by, updated_at)
  values (p_brand_key, nullif(p_brand_label,''), coalesce(p_profile, '{}'::jsonb), 'draft', auth.uid(), now())
  on conflict (brand_key) do update set brand_label = excluded.brand_label, profile = excluded.profile, updated_at = now()
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.admin_brand_dna_upsert(text, text, jsonb) to authenticated;

create or replace function public.admin_brand_dna_list()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_result jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(b) order by b.updated_at desc), '[]'::jsonb) into v_result from public.brand_dna b;
  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_brand_dna_list() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Playlist Draft — 생성 결과 저장(자동 Publish 금지). tracks 필수(Evidence).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.playlist_drafts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  store_type    text, brand_key text, time_band text, season text, event_key text,
  config        jsonb not null default '{}'::jsonb,
  tracks        jsonb not null,        -- [{track_id,title,reason,compatibility,...}] 필수
  excluded      jsonb not null default '[]'::jsonb,
  simulation    jsonb,                 -- 예상 diversity/freshness/completion/skip_risk
  status        text not null default 'draft' check (status in ('draft','approved','rejected')),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.playlist_drafts is
  'AI-PLAYLIST-4 — 생성된 Playlist 초안. 자동 Publish 없음; 승인 후 기존 Rollout 사용.';

create index if not exists idx_playlist_drafts_status on public.playlist_drafts (status, created_at desc);

create or replace function public.admin_playlist_draft_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_row public.playlist_drafts;
begin
  perform public._admin_growth_guard();

  if coalesce(p_payload->>'name','') = '' then raise exception 'name required' using errcode = '22023'; end if;
  if p_payload->'tracks' is null or jsonb_typeof(p_payload->'tracks') <> 'array' or jsonb_array_length(p_payload->'tracks') = 0 then
    raise exception 'tracks required (Evidence 없는 Draft 저장 금지)' using errcode = '22023';
  end if;

  insert into public.playlist_drafts(name, store_type, brand_key, time_band, season, event_key, config, tracks, excluded, simulation, created_by)
  values (
    p_payload->>'name', nullif(p_payload->>'store_type',''), nullif(p_payload->>'brand_key',''),
    nullif(p_payload->>'time_band',''), nullif(p_payload->>'season',''), nullif(p_payload->>'event_key',''),
    coalesce(p_payload->'config', '{}'::jsonb), p_payload->'tracks', coalesce(p_payload->'excluded', '[]'::jsonb),
    p_payload->'simulation', auth.uid()
  ) returning id into v_id;

  select * into v_row from public.playlist_drafts where id = v_id;
  return to_jsonb(v_row);
end;
$$;

grant execute on function public.admin_playlist_draft_save(jsonb) to authenticated;

create or replace function public.admin_playlist_drafts(p_status text default null, p_limit int default 50)
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
    from public.playlist_drafts d left join public.users u on u.id = d.created_by
    where p_status is null or d.status = p_status
    order by d.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_playlist_drafts(text, int) to authenticated;

-- Draft 승인/반려(승인은 Publish 아님 — 운영자가 이후 Rollout 사용).
create or replace function public.admin_playlist_draft_set_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.playlist_drafts;
begin
  perform public._admin_growth_guard();
  if p_status not in ('draft','approved','rejected') then raise exception 'invalid status' using errcode = '22023'; end if;

  update public.playlist_drafts set status = p_status, updated_at = now() where id = p_id returning * into v_row;
  if v_row.id is null then raise exception 'draft not found: %', p_id using errcode = 'P0002'; end if;
  return to_jsonb(v_row);
end;
$$;

grant execute on function public.admin_playlist_draft_set_status(uuid, text) to authenticated;
