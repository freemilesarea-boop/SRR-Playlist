-- 0331 — store_archetype_embeddings 텍스트-prompt 기반 import RPC (X6.55)
--
-- 배경:
--   0183 admin_build_store_archetypes 는 ai_store_fit 상위 트랙 평균으로 archetype 생성.
--   하지만 ai_store_fit 이 비어있어 (track_ai_metadata 채우는 파이프라인 미가동)
--   build 가 항상 "no seed embeddings" 로 skip. 결과: store_archetype_embeddings = 0건.
--
-- 대안:
--   CLAP 은 text-audio contrastive 학습 → text encoder 와 audio encoder 가 같은 임베딩 공간 공유.
--   "high energy upbeat workout music" 같은 텍스트 prompt 를 CLAP 으로 임베딩 → 매장 archetype 으로 사용.
--   이 임베딩과 트랙 audio 임베딩의 cosine similarity → store fit score 계산.
--
-- 본 RPC:
--   Colab notebook (notebooks/clap_embedding_pipeline.py) 에서 호출.
--   admin / service_role 만 호출 가능.
--   service_role 호출 시 auth.uid() 가 null 이지만 role 체크로 통과.

create or replace function public.admin_import_store_archetypes(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r jsonb;
  v_store_key text;
  v_emb jsonb;
  v_len int;
  v_dim int;
  v_prompt text;
  v_imported int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  if not (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
    or coalesce(auth.role(), '') = 'service_role'
  ) then
    raise exception 'admin or service_role only';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_store_key := nullif(btrim(r->>'store_key'), '');
      v_prompt := r->>'prompt_text';
      v_emb := r->'embedding';

      if v_store_key is null then
        v_skipped := v_skipped + 1;
        v_errors := v_errors || jsonb_build_object('reason', 'missing store_key');
        continue;
      end if;
      if v_emb is null or jsonb_typeof(v_emb) <> 'array' then
        v_skipped := v_skipped + 1;
        v_errors := v_errors || jsonb_build_object('store_key', v_store_key, 'reason', 'embedding not array');
        continue;
      end if;

      v_len := jsonb_array_length(v_emb);
      v_dim := coalesce((r->>'embedding_dim')::int, v_len);
      if v_len = 0 or v_len <> v_dim then
        v_skipped := v_skipped + 1;
        v_errors := v_errors || jsonb_build_object('store_key', v_store_key,
          'reason', format('dim mismatch len=%s dim=%s', v_len, v_dim));
        continue;
      end if;

      insert into public.store_archetype_embeddings(
        store_key, store_label, model_name, model_version,
        embedding, embedding_dim, prompt_or_seed_tracks, updated_at
      ) values (
        v_store_key,
        coalesce((select store_label from public.ai_store_profiles where store_key = v_store_key), v_store_key),
        coalesce(nullif(btrim(r->>'model_name'), ''), 'laion-clap-music-v1'),
        coalesce(nullif(btrim(r->>'model_version'), ''), 'v1'),
        (v_emb::text)::public.vector,
        v_dim,
        case when v_prompt is null then null else array[v_prompt] end,
        now()
      ) on conflict (store_key, model_name) do update set
        store_label = excluded.store_label,
        model_version = excluded.model_version,
        embedding = excluded.embedding,
        embedding_dim = excluded.embedding_dim,
        prompt_or_seed_tracks = excluded.prompt_or_seed_tracks,
        updated_at = now();
      v_imported := v_imported + 1;
    exception when others then
      v_skipped := v_skipped + 1;
      v_errors := v_errors || jsonb_build_object('store_key', v_store_key, 'reason', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('ok', true, 'imported', v_imported, 'skipped', v_skipped, 'errors', v_errors);
end;
$$;

grant execute on function public.admin_import_store_archetypes(jsonb) to authenticated, service_role;
