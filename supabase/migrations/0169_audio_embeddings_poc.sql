-- 0169 — Audio Embedding 추천 엔진 (조사/설계/PoC). additive only.
-- 기존 추천/차트/정산/플레이어 로직 미변경. 신규 테이블 + cosine RPC + (라이브 미연동) 결합 함수.
create extension if not exists vector with schema public;

create table if not exists public.track_embeddings (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  model_name text not null, model_version text not null default 'v1',
  embedding public.vector, embedding_dim int,
  segment_type text default 'full', confidence numeric,
  status text not null default 'done' check (status in ('pending','processing','done','failed')),
  error_message text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (track_id, model_name)
);
create index if not exists idx_te_track on public.track_embeddings(track_id);
create index if not exists idx_te_model_status on public.track_embeddings(model_name, status);
alter table public.track_embeddings enable row level security;
drop policy if exists te_admin_read on public.track_embeddings;
create policy te_admin_read on public.track_embeddings for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

create table if not exists public.store_archetype_embeddings (
  id uuid primary key default gen_random_uuid(),
  store_key text not null, store_label text,
  model_name text not null, model_version text not null default 'v1',
  embedding public.vector, embedding_dim int, prompt_or_seed_tracks text[],
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (store_key, model_name)
);
alter table public.store_archetype_embeddings enable row level security;
drop policy if exists sae_admin_read on public.store_archetype_embeddings;
create policy sae_admin_read on public.store_archetype_embeddings for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- 곡 → 매장 cosine similarity (0~1, 높을수록 가까움). 연산자는 schema-qualify (search_path 안전).
create or replace function public.recommend_stores_for_track(p_track_id uuid, p_model text default 'openl3')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.similarity desc), '[]'::jsonb) into v from (
    select s.store_key, s.store_label, round((1 - (e.embedding OPERATOR(public.<=>) s.embedding))::numeric, 4) as similarity
    from public.track_embeddings e join public.store_archetype_embeddings s on s.model_name = e.model_name
    where e.track_id = p_track_id and e.model_name = p_model and e.status='done' and e.embedding is not null
  ) x;
  return v;
end; $$;
grant execute on function public.recommend_stores_for_track(uuid, text) to authenticated;

create or replace function public.recommend_tracks_for_store(p_store_key text, p_model text default 'openl3', p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.similarity desc), '[]'::jsonb) into v from (
    select e.track_id, t.title, t.artist, round((1 - (e.embedding OPERATOR(public.<=>) s.embedding))::numeric, 4) as similarity
    from public.store_archetype_embeddings s
    join public.track_embeddings e on e.model_name = s.model_name and e.status='done' and e.embedding is not null
    join public.tracks t on t.id = e.track_id
    where s.store_key = p_store_key and s.model_name = p_model and t.release_status in ('released','approved') and t.removed_at is null
    order by (e.embedding OPERATOR(public.<=>) s.embedding) asc limit greatest(1, p_limit)
  ) x;
  return v;
end; $$;
grant execute on function public.recommend_tracks_for_store(text, text, int) to authenticated;

create or replace function public.admin_list_embedding_pending(p_model text default 'openl3', p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x)),'[]'::jsonb) into v from (
    select t.id as track_id, t.title, t.artist, t.audio_url, t.storage_path, t.duration
    from public.tracks t
    where t.source_type in ('artist_upload','admin_upload') and t.removed_at is null
      and t.release_status in ('released','approved','scheduled') and t.audio_url is not null
      and not exists (select 1 from public.track_embeddings e where e.track_id=t.id and e.model_name=p_model and e.status='done')
    limit greatest(1, p_limit)
  ) x;
  return v;
end; $$;
grant execute on function public.admin_list_embedding_pending(text, int) to authenticated;

-- 결합(설계용, 라이브 미연동): embedding 50% + 기존 store_fit 30% + behavior 20% → ai_fit_v2
create or replace function public.compute_ai_fit_v2(p_track_id uuid, p_store_key text, p_model text default 'openl3')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_sim numeric; v_storefit numeric; v_behav numeric; v_fit numeric; v_ai record;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select round((1 - (e.embedding OPERATOR(public.<=>) s.embedding))::numeric,4) into v_sim
  from public.track_embeddings e join public.store_archetype_embeddings s on s.model_name=e.model_name
  where e.track_id=p_track_id and e.model_name=p_model and s.store_key=p_store_key and e.status='done';
  select * into v_ai from public.track_ai_metadata where track_id=p_track_id;
  v_storefit := case when v_ai.track_id is not null and v_ai.ai_store_fit ? p_store_key then (v_ai.ai_store_fit->>p_store_key)::numeric else 50 end;
  v_behav := public._ai_behavior_score(null, p_track_id);
  v_fit := round( coalesce(v_sim,0.5)*100*0.5 + v_storefit*0.3 + v_behav*0.2 );
  return jsonb_build_object('embedding_similarity', v_sim, 'store_fit', v_storefit, 'behavior', v_behav, 'ai_fit_v2', v_fit);
end; $$;
grant execute on function public.compute_ai_fit_v2(uuid, text, text) to authenticated;
