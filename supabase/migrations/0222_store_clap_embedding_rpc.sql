-- 0222 — Modal worker 가 호출할 embedding 저장 + 백필 후보 조회 RPC (이미 prod 적용)
-- 인증: service_role 만 — Modal 환경변수에 SUPABASE_SERVICE_ROLE_KEY 설정

create or replace function public.store_track_embedding(
  p_track_id uuid,
  p_embedding float8[],
  p_model_version text default 'laion-clap-music-v1'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if array_length(p_embedding, 1) <> 512 then
    raise exception 'embedding must be 512 dimensions, got %', array_length(p_embedding, 1);
  end if;
  insert into public.track_embeddings(track_id, embedding, model_version)
  values (p_track_id, p_embedding::vector(512), p_model_version)
  on conflict (track_id, model_version) do update
    set embedding = excluded.embedding, created_at = now();
end;
$$;
revoke all on function public.store_track_embedding(uuid, float8[], text) from public, anon, authenticated;
grant execute on function public.store_track_embedding(uuid, float8[], text) to service_role;

create or replace function public.list_tracks_needing_embedding(p_limit int default 100)
returns table (track_id uuid, title text, audio_url text, storage_path text, duration numeric)
language sql
security definer
set search_path = public
stable
as $$
  select t.id, t.title, t.audio_url, t.storage_path, t.duration
  from public.tracks t
  left join public.track_embeddings te on te.track_id = t.id and te.model_version = 'laion-clap-music-v1'
  where t.visibility_status = 'approved' and t.removed_at is null
    and te.id is null and t.audio_url is not null and t.duration > 30
  order by t.created_at desc
  limit p_limit;
$$;
revoke all on function public.list_tracks_needing_embedding(int) from public, anon, authenticated;
grant execute on function public.list_tracks_needing_embedding(int) to service_role;
