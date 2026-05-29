-- 0219 — CLAP 기반 AI 큐레이션 v1 인프라 (이미 prod 적용)
--
-- pgvector 활성화 + 4 테이블 + centroid 함수 + 트리거.

create extension if not exists vector;

create table if not exists public.track_embeddings (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  embedding vector(512) not null,
  model_version text not null default 'laion-clap-music-v1',
  audio_segment_start_sec int not null default 30,
  audio_segment_duration_sec int not null default 30,
  created_at timestamptz not null default now(),
  unique (track_id, model_version)
);
create index if not exists track_embeddings_track_idx on public.track_embeddings(track_id);

create table if not exists public.playlist_centroids (
  playlist_id uuid primary key references public.playlists(id) on delete cascade,
  embedding vector(512) not null,
  track_count int not null default 0,
  model_version text not null default 'laion-clap-music-v1',
  updated_at timestamptz not null default now()
);

create table if not exists public.genre_block_rules (
  id serial primary key,
  business_category text not null,
  playlist_subtype text,
  block_kind text not null check (block_kind in ('allow', 'block')),
  genre_pattern text not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (business_category, playlist_subtype, block_kind, genre_pattern)
);
create index if not exists genre_block_rules_category_idx on public.genre_block_rules(business_category);

create table if not exists public.clap_recommendations (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  clap_similarity numeric(6,4) not null,
  genre_score numeric(5,2),
  mood_score numeric(5,2),
  energy_score numeric(5,2),
  quality_score numeric(5,2),
  total_score numeric(5,2) not null,
  hard_block_reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','dismissed')),
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (playlist_id, track_id)
);
create index if not exists clap_recommendations_playlist_idx on public.clap_recommendations(playlist_id, status, total_score desc);
create index if not exists clap_recommendations_status_idx on public.clap_recommendations(status);

alter table public.track_embeddings enable row level security;
alter table public.playlist_centroids enable row level security;
alter table public.genre_block_rules enable row level security;
alter table public.clap_recommendations enable row level security;

drop policy if exists track_embeddings_public_read on public.track_embeddings;
create policy track_embeddings_public_read on public.track_embeddings for select using (true);
drop policy if exists playlist_centroids_public_read on public.playlist_centroids;
create policy playlist_centroids_public_read on public.playlist_centroids for select using (true);
drop policy if exists genre_block_rules_public_read on public.genre_block_rules;
create policy genre_block_rules_public_read on public.genre_block_rules for select using (true);
drop policy if exists clap_recommendations_admin_read on public.clap_recommendations;
create policy clap_recommendations_admin_read on public.clap_recommendations
  for select using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- playlist centroid 재계산 — element-wise 평균 (pgvector avg() 차원 손실 회피)
create or replace function public.recompute_playlist_centroid(p_playlist_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_dims constant int := 512;
  v_sum float8[];
  v_emb_arr float8[];
  v_avg vector;
  r record;
begin
  v_sum := array_fill(0::float8, ARRAY[v_dims]);
  for r in
    select te.embedding::float8[] as emb
    from public.playlist_tracks pt
    join public.track_embeddings te on te.track_id = pt.track_id
    where pt.playlist_id = p_playlist_id and te.model_version = 'laion-clap-music-v1'
  loop
    v_emb_arr := r.emb;
    for i in 1..v_dims loop v_sum[i] := v_sum[i] + v_emb_arr[i]; end loop;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    delete from public.playlist_centroids where playlist_id = p_playlist_id;
    return;
  end if;

  for i in 1..v_dims loop v_sum[i] := v_sum[i] / v_count; end loop;
  v_avg := v_sum::vector;

  insert into public.playlist_centroids(playlist_id, embedding, track_count, updated_at)
  values (p_playlist_id, v_avg, v_count, now())
  on conflict (playlist_id) do update
    set embedding = excluded.embedding,
        track_count = excluded.track_count,
        updated_at = now();
end;
$$;

revoke all on function public.recompute_playlist_centroid(uuid) from public, anon;
grant execute on function public.recompute_playlist_centroid(uuid) to authenticated, service_role;

create or replace function public._tg_recompute_centroid()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_playlist_centroid(old.playlist_id);
    return old;
  else
    perform public.recompute_playlist_centroid(new.playlist_id);
    return new;
  end if;
end;
$$;

drop trigger if exists tg_playlist_tracks_centroid on public.playlist_tracks;
create trigger tg_playlist_tracks_centroid
after insert or update or delete on public.playlist_tracks
for each row execute function public._tg_recompute_centroid();

create or replace function public._tg_embedding_added()
returns trigger language plpgsql as $$
declare v_pid uuid;
begin
  for v_pid in select distinct playlist_id from public.playlist_tracks where track_id = new.track_id
  loop perform public.recompute_playlist_centroid(v_pid); end loop;
  return new;
end;
$$;

drop trigger if exists tg_track_embeddings_centroid on public.track_embeddings;
create trigger tg_track_embeddings_centroid
after insert or update on public.track_embeddings
for each row execute function public._tg_embedding_added();
