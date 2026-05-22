-- 0113 — 플레이리스트 AI 자동 생성 + 음원 자동 배치 (스키마/테이블/분석)
--   기존 수동/동적(is_auto) 플레이리스트 유지. 신규: is_auto_generated=true(저장형 배치).

alter table public.playlists
  add column if not exists subtitle text,
  add column if not exists daypart text,
  add column if not exists genre_tags text[] not null default '{}',
  add column if not exists bpm_min int,
  add column if not exists bpm_max int,
  add column if not exists energy_min int,
  add column if not exists energy_max int,
  add column if not exists vocal_preference text,   -- 'vocal' | 'instrumental' | 'any'
  add column if not exists cover_theme text,
  add column if not exists is_auto_generated boolean not null default false,
  add column if not exists priority_score int not null default 0;

alter table public.playlist_tracks
  add column if not exists match_score numeric,
  add column if not exists placement_reason text,
  add column if not exists placed_by text not null default 'manual',  -- auto | manual | admin
  add column if not exists created_at timestamptz not null default now();
create unique index if not exists uq_playlist_tracks_pl_track on public.playlist_tracks (playlist_id, track_id);

create table if not exists public.track_analysis (
  track_id uuid primary key references public.tracks(id) on delete cascade,
  genre text, bpm int, mood_tags text[] not null default '{}',
  energy int, danceability int, valence int, vocal_presence int, instrumentalness int,
  loudness numeric, duration int, quality_score int, analyzed_at timestamptz not null default now()
);
alter table public.track_analysis enable row level security;
drop policy if exists track_analysis_read on public.track_analysis;
create policy track_analysis_read on public.track_analysis for select using (true);

create table if not exists public.auto_placement_runs (
  id uuid primary key default gen_random_uuid(),
  track_id uuid references public.tracks(id) on delete cascade,
  status text not null, candidate_count int not null default 0, placed_count int not null default 0,
  log_json jsonb, created_at timestamptz not null default now()
);
alter table public.auto_placement_runs enable row level security;
drop policy if exists auto_placement_runs_admin on public.auto_placement_runs;
create policy auto_placement_runs_admin on public.auto_placement_runs for all to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

insert into public.admin_settings(key, value) values ('auto_placement_enabled', 'true'::jsonb)
  on conflict (key) do nothing;

-- 트랙 분석값 파생 (메타데이터 기반). tracks.energy_level(1~5) → 0~100 정규화.
create or replace function public.derive_track_analysis(p_track_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare t record; v_energy int;
begin
  select * into t from public.tracks where id = p_track_id;
  if t.id is null then return; end if;
  v_energy := least(100, greatest(0, coalesce(t.energy_level, 3) * 20));
  insert into public.track_analysis as a
    (track_id, genre, bpm, mood_tags, energy, danceability, valence,
     vocal_presence, instrumentalness, loudness, duration, quality_score, analyzed_at)
  values (
    t.id, nullif(btrim(coalesce(t.main_genre, t.genre, '')), ''), t.bpm,
    case when coalesce(array_length(t.mood_tags,1),0) > 0 then t.mood_tags
         when nullif(btrim(coalesce(t.mood,'')),'') is not null then array[t.mood]
         else '{}'::text[] end,
    v_energy, v_energy, v_energy,
    case when coalesce(t.instrumental,false) then 10 else 80 end,
    case when coalesce(t.instrumental,false) then 90 else 20 end,
    null, t.duration,
    70 + case when t.duration between 60 and 420 then 10 else 0 end, now())
  on conflict (track_id) do update set
    genre=excluded.genre, bpm=excluded.bpm, mood_tags=excluded.mood_tags, energy=excluded.energy,
    danceability=excluded.danceability, valence=excluded.valence, vocal_presence=excluded.vocal_presence,
    instrumentalness=excluded.instrumentalness, duration=excluded.duration, quality_score=excluded.quality_score,
    analyzed_at=now();
end; $function$;
