-- 0156 — AI 큐레이션 엔진 v1 스키마 (additive)
-- track_audio_features / track_ai_metadata / playlist_track_fit_scores / track_play_events
-- + 기존 metadata_violation_candidates 확장 (unique(playlist_id,track_id) 유지)

create table if not exists public.track_audio_features (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null unique references public.tracks(id) on delete cascade,
  bpm numeric, key_name text, musical_key text, mode text,
  loudness numeric, rms numeric, peak numeric, dynamic_range numeric,
  energy numeric check (energy is null or (energy >= 0 and energy <= 1)),
  danceability numeric check (danceability is null or (danceability >= 0 and danceability <= 1)),
  acousticness numeric check (acousticness is null or (acousticness >= 0 and acousticness <= 1)),
  instrumentalness numeric check (instrumentalness is null or (instrumentalness >= 0 and instrumentalness <= 1)),
  speechiness numeric check (speechiness is null or (speechiness >= 0 and speechiness <= 1)),
  vocal_presence numeric check (vocal_presence is null or (vocal_presence >= 0 and vocal_presence <= 1)),
  brightness numeric check (brightness is null or (brightness >= 0 and brightness <= 1)),
  tempo_stability numeric check (tempo_stability is null or (tempo_stability >= 0 and tempo_stability <= 1)),
  duration_seconds numeric,
  analysis_version text not null default 'v1',
  analyzer text default 'heuristic-v1',
  status text not null default 'pending' check (status in ('pending','analyzing','done','failed')),
  error_message text, analyzed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_taf_track on public.track_audio_features(track_id);
create index if not exists idx_taf_status on public.track_audio_features(status);

create table if not exists public.track_ai_metadata (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null unique references public.tracks(id) on delete cascade,
  ai_genres text[] default '{}', ai_moods text[] default '{}', ai_situations text[] default '{}',
  ai_energy_level text check (ai_energy_level in ('low','medium','high','unknown')) default 'unknown',
  ai_vocal_type text,
  ai_store_fit jsonb not null default '{}',
  ai_exclusions text[] default '{}',
  metadata_confidence numeric check (metadata_confidence is null or (metadata_confidence >= 0 and metadata_confidence <= 1)),
  mismatch_score numeric check (mismatch_score is null or (mismatch_score >= 0 and mismatch_score <= 1)),
  mismatch_reasons text[] default '{}', explanation text,
  analysis_version text default 'v1',
  status text not null default 'pending' check (status in ('pending','done','failed','reviewed')),
  reviewed_by uuid references public.users(id) on delete set null, reviewed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_taim_track on public.track_ai_metadata(track_id);
create index if not exists idx_taim_status on public.track_ai_metadata(status);
create index if not exists idx_taim_mismatch on public.track_ai_metadata(mismatch_score desc);

create table if not exists public.playlist_track_fit_scores (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  fit_score numeric check (fit_score is null or (fit_score >= 0 and fit_score <= 100)),
  audio_score numeric check (audio_score is null or (audio_score >= 0 and audio_score <= 100)),
  metadata_score numeric check (metadata_score is null or (metadata_score >= 0 and metadata_score <= 100)),
  behavior_score numeric check (behavior_score is null or (behavior_score >= 0 and behavior_score <= 100)),
  penalty_score numeric check (penalty_score is null or (penalty_score >= 0 and penalty_score <= 100)),
  reason text,
  source text not null default 'algorithm' check (source in ('algorithm','admin','user_behavior')),
  status text not null default 'active' check (status in ('active','excluded','review_needed')),
  updated_at timestamptz not null default now(),
  unique (playlist_id, track_id)
);
create index if not exists idx_ptfs_playlist_fit on public.playlist_track_fit_scores(playlist_id, fit_score desc);
create index if not exists idx_ptfs_track on public.playlist_track_fit_scores(track_id);

create table if not exists public.track_play_events (
  id uuid primary key default gen_random_uuid(),
  track_id uuid references public.tracks(id) on delete cascade,
  playlist_id uuid references public.playlists(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  session_id text,
  event_type text not null check (event_type in ('play','start','skip','complete','like','unlike','error')),
  played_seconds numeric, duration_seconds numeric, completion_ratio numeric,
  skip_reason text, device text,
  created_at timestamptz not null default now()
);
create index if not exists idx_tpe_track_pl_time on public.track_play_events(track_id, playlist_id, created_at desc);
create index if not exists idx_tpe_session_time on public.track_play_events(session_id, created_at desc);
create index if not exists idx_tpe_type_time on public.track_play_events(event_type, created_at desc);

-- 기존 metadata_violation_candidates 확장 (additive — unique 유지)
alter table public.metadata_violation_candidates add column if not exists violation_type text default 'high_skip_rate';
alter table public.metadata_violation_candidates add column if not exists severity text default 'medium';
alter table public.metadata_violation_candidates add column if not exists mismatch_score numeric;
alter table public.metadata_violation_candidates add column if not exists completion_rate numeric;
alter table public.metadata_violation_candidates add column if not exists mismatch_reasons text[] default '{}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname='mvc_severity_chk') then
    alter table public.metadata_violation_candidates add constraint mvc_severity_chk check (severity in ('low','medium','high'));
  end if;
end $$;
create index if not exists idx_mvc_sev_created on public.metadata_violation_candidates(status, severity, last_detected_at desc);

alter table public.track_audio_features enable row level security;
alter table public.track_ai_metadata enable row level security;
alter table public.playlist_track_fit_scores enable row level security;
alter table public.track_play_events enable row level security;

drop policy if exists taf_admin_read on public.track_audio_features;
create policy taf_admin_read on public.track_audio_features for select
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));
drop policy if exists taim_admin_read on public.track_ai_metadata;
create policy taim_admin_read on public.track_ai_metadata for select
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));
drop policy if exists ptfs_admin_read on public.playlist_track_fit_scores;
create policy ptfs_admin_read on public.playlist_track_fit_scores for select
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));
drop policy if exists tpe_self_insert on public.track_play_events;
create policy tpe_self_insert on public.track_play_events for insert
  with check (user_id is null or user_id = auth.uid());
drop policy if exists tpe_admin_read on public.track_play_events;
create policy tpe_admin_read on public.track_play_events for select
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));
