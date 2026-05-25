-- 0183 — 매장 아키타입 임베딩 빌더. track_embeddings(실적재) 로부터 매장 대표 벡터를 생성.
-- recommend_stores_for_track 가 작동하려면 store_archetype_embeddings 가 필요한데 채우는 함수가 없었음 → 보완.
-- 분석/추천 검증 전용. 자동 공개/차트/정산 미반영.
create or replace function public.admin_build_store_archetypes(p_model text default 'openl3', p_top int default 8)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  r record; v_seeds uuid[]; v_vec public.vector; v_dim int;
  v_built int := 0; v_skipped jsonb := '[]'::jsonb; v_src text;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  for r in select store_key, store_label from public.ai_store_profiles loop
    v_src := 'seed_candidate';
    -- 1) 관리자 승인 seed candidate (임베딩 보유) 우선
    select array_agg(c.track_id) into v_seeds
    from public.store_archetype_seed_candidates c
    join public.track_embeddings e on e.track_id = c.track_id and e.model_name = p_model and e.status = 'done'
    where c.store_key = r.store_key and c.status = 'approved';
    -- 2) 없으면 ai_store_fit 상위 N (임베딩 보유) 로 대체
    if v_seeds is null or array_length(v_seeds, 1) is null then
      v_src := 'ai_store_fit_top';
      select array_agg(tid) into v_seeds from (
        select e.track_id tid
        from public.track_embeddings e
        join public.track_ai_metadata m on m.track_id = e.track_id
        where e.model_name = p_model and e.status = 'done' and m.ai_store_fit ? r.store_key
        order by (m.ai_store_fit->>r.store_key)::numeric desc
        limit greatest(1, p_top)
      ) s;
    end if;
    if v_seeds is null or array_length(v_seeds, 1) is null then
      v_skipped := v_skipped || jsonb_build_object('store_key', r.store_key, 'reason', 'no seed embeddings'); continue;
    end if;
    select avg(e.embedding), max(e.embedding_dim) into v_vec, v_dim
    from public.track_embeddings e where e.track_id = any(v_seeds) and e.model_name = p_model and e.status = 'done';
    if v_vec is null then
      v_skipped := v_skipped || jsonb_build_object('store_key', r.store_key, 'reason', 'avg null'); continue;
    end if;
    insert into public.store_archetype_embeddings(store_key, store_label, model_name, model_version, embedding, embedding_dim, prompt_or_seed_tracks, updated_at)
    values (r.store_key, r.store_label, p_model, 'v1', v_vec, v_dim, v_seeds, now())
    on conflict (store_key, model_name) do update set
      store_label = excluded.store_label, embedding = excluded.embedding, embedding_dim = excluded.embedding_dim,
      prompt_or_seed_tracks = excluded.prompt_or_seed_tracks, updated_at = now();
    v_built := v_built + 1;
  end loop;
  return jsonb_build_object('ok', true, 'model', p_model, 'built', v_built, 'skipped', v_skipped);
end; $$;
grant execute on function public.admin_build_store_archetypes(text, int) to authenticated;

-- 아키타입/임베딩 현황 요약 (검증 탭 헤더용)
create or replace function public.admin_embedding_status(p_model text default 'openl3')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'model', p_model,
    'track_embeddings', (select count(*) from public.track_embeddings where model_name=p_model and status='done'),
    'store_archetypes', (select count(*) from public.store_archetype_embeddings where model_name=p_model),
    'pending', (select jsonb_array_length(public.admin_export_embedding_pending_tracks(p_model, 1000))),
    'embedding_dim', (select max(embedding_dim) from public.track_embeddings where model_name=p_model and status='done'));
end; $$;
grant execute on function public.admin_embedding_status(text) to authenticated;
