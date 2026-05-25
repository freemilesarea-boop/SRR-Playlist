-- 0171b — embedding 검증 RPC (비교/목록/액션). 0171 의 helper/테이블 의존.
create or replace function public.admin_get_embedding_comparison(p_track_id uuid, p_model text default 'openl3')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_ai record; v_emb record; v_dis jsonb; v_heur jsonb; v_embtop jsonb; v_issues text[] := '{}';
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select * into v_ai from public.track_ai_metadata where track_id=p_track_id;
  select status, model_name, model_version, embedding_dim, confidence, error_message, created_at into v_emb
    from public.track_embeddings where track_id=p_track_id and model_name=p_model;
  v_dis := public._emb_disagreement(p_track_id, p_model);
  select coalesce(jsonb_agg(jsonb_build_object('store_key',key,'score',round(value::numeric)) order by value::numeric desc),'[]'::jsonb) into v_heur
  from (select key, value from jsonb_each_text(coalesce(v_ai.ai_store_fit,'{}'::jsonb))
        where key not in ('cafe_afternoon','cafe_morning','winebar_evening','lounge') order by value::numeric desc limit 5) h;
  select coalesce(jsonb_agg(jsonb_build_object('store_key',key,'similarity',value::numeric) order by value::numeric desc),'[]'::jsonb) into v_embtop
  from (select key, value from jsonb_each_text(coalesce(v_dis->'embedding_sims','{}'::jsonb)) order by value::numeric desc limit 5) e;
  if (v_dis->'issues') is not null then select array_agg(x) into v_issues from jsonb_array_elements_text(v_dis->'issues') x; end if;
  if v_emb.model_version is not null and v_emb.model_version <> 'v1' then v_issues := array_append(v_issues,'old_model'); end if;
  if not exists (select 1 from public.store_archetype_embeddings where model_name=p_model) then v_issues := array_append(v_issues,'missing_archetype'); end if;
  return jsonb_build_object('track_id', p_track_id, 'embedding_status', coalesce(v_emb.status,'none'),
    'model_name', v_emb.model_name, 'model_version', v_emb.model_version, 'embedding_dim', v_emb.embedding_dim,
    'confidence', v_emb.confidence, 'error_message', v_emb.error_message, 'embedded_at', v_emb.created_at,
    'has_embedding', (v_dis->>'has_embedding')::boolean, 'disagreement_score', v_dis->'score',
    'suspected_issues', to_jsonb(coalesce(v_issues,'{}')), 'heuristic_top5', v_heur, 'embedding_top5', v_embtop, 'ai_status', v_ai.status);
end; $$;
grant execute on function public.admin_get_embedding_comparison(uuid, text) to authenticated;

create or replace function public.admin_list_embedding_review_tracks(p_filter text default 'all', p_model text default 'openl3', p_limit int default 150)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.disagreement_score desc nulls last, x.created_at desc),'[]'::jsonb) into v from (
    select t.id as track_id, t.title, t.artist, t.cover_url, t.created_at,
      coalesce(e.status,'none') as embedding_status, e.model_name, e.model_version, e.embedding_dim, e.error_message, m.status as ai_status,
      coalesce((public._emb_disagreement(t.id, p_model)->>'score')::numeric, null) as disagreement_score,
      (public._emb_disagreement(t.id, p_model)->>'has_embedding')::boolean as has_embedding, r.review_status
    from public.tracks t
    left join public.track_embeddings e on e.track_id=t.id and e.model_name=p_model
    left join public.track_ai_metadata m on m.track_id=t.id
    left join public.track_embedding_reviews r on r.track_id=t.id and r.model_name=p_model
    where t.source_type in ('artist_upload','admin_upload') and t.removed_at is null and t.release_status in ('released','approved','scheduled')
      and case p_filter
        when 'pending' then (e.track_id is null or e.status in ('pending','processing'))
        when 'done' then (e.status='done')
        when 'failed' then (e.status='failed')
        when 'disagree_high' then (e.status='done' and coalesce((public._emb_disagreement(t.id, p_model)->>'score')::numeric,0) >= 50)
        when 'gym_fp' then (e.status='done' and (public._emb_disagreement(t.id, p_model)->'issues') @> '["gym_false_positive"]'::jsonb)
        else true end
    limit greatest(1, p_limit)
  ) x;
  return v;
end; $$;
grant execute on function public.admin_list_embedding_review_tracks(text, text, int) to authenticated;

create or replace function public.admin_mark_embedding_reviewed(p_track_id uuid, p_model text default 'openl3', p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_dis jsonb;
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  v_dis := public._emb_disagreement(p_track_id, p_model);
  insert into public.track_embedding_reviews(track_id, model_name, review_status, disagreement_score, suspected_issue, admin_note, reviewed_by, reviewed_at)
  values (p_track_id, p_model, 'reviewed', (v_dis->>'score')::numeric,
    (select array_agg(x) from jsonb_array_elements_text(coalesce(v_dis->'issues','[]'::jsonb)) x), nullif(btrim(p_note),''), v_uid, now())
  on conflict (track_id, model_name) do update set review_status='reviewed', disagreement_score=excluded.disagreement_score,
    suspected_issue=excluded.suspected_issue, admin_note=coalesce(excluded.admin_note, public.track_embedding_reviews.admin_note),
    reviewed_by=v_uid, reviewed_at=now(), updated_at=now();
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.admin_mark_embedding_reviewed(uuid, text, text) to authenticated;

create or replace function public.admin_mark_embedding_reanalysis_needed(p_track_id uuid, p_model text default 'openl3', p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  insert into public.track_embedding_reviews(track_id, model_name, review_status, admin_note, reviewed_by, reviewed_at)
  values (p_track_id, p_model, 'needs_reanalysis', nullif(btrim(p_note),''), v_uid, now())
  on conflict (track_id, model_name) do update set review_status='needs_reanalysis',
    admin_note=coalesce(excluded.admin_note, public.track_embedding_reviews.admin_note), reviewed_by=v_uid, reviewed_at=now(), updated_at=now();
  update public.track_embeddings set status='failed', error_message=coalesce('재분석 필요: '||nullif(btrim(p_note),''),'재분석 필요'), updated_at=now()
  where track_id=p_track_id and model_name=p_model;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.admin_mark_embedding_reanalysis_needed(uuid, text, text) to authenticated;

create or replace function public.admin_add_store_seed_candidate(p_track_id uuid, p_store_key text, p_model text default 'openl3')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_sim numeric;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select round((1-(e.embedding OPERATOR(public.<=>) s.embedding))::numeric,4) into v_sim
  from public.track_embeddings e join public.store_archetype_embeddings s on s.model_name=e.model_name
  where e.track_id=p_track_id and e.model_name=p_model and s.store_key=p_store_key;
  insert into public.store_archetype_seed_candidates(store_key, track_id, model_name, similarity_score, status)
  values (p_store_key, p_track_id, p_model, v_sim, 'candidate')
  on conflict (store_key, track_id, model_name) do update set similarity_score=excluded.similarity_score, status='candidate';
  return jsonb_build_object('ok', true, 'similarity', v_sim);
end; $$;
grant execute on function public.admin_add_store_seed_candidate(uuid, text, text) to authenticated;

create or replace function public.admin_apply_embedding_to_ai_metadata(p_track_id uuid, p_model text default 'openl3')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_emb jsonb; v_fit jsonb;
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  select (public._emb_disagreement(p_track_id, p_model)->'embedding_sims') into v_emb;
  if v_emb is null or v_emb = '{}'::jsonb then raise exception 'no embedding to apply'; end if;
  select jsonb_object_agg(key, round(value::numeric*100)) into v_fit from jsonb_each_text(v_emb);
  update public.track_ai_metadata set embedding_store_fit=v_fit, updated_at=now() where track_id=p_track_id;
  if not found then
    insert into public.track_ai_metadata(track_id, status, embedding_store_fit) values (p_track_id, 'pending', v_fit)
    on conflict (track_id) do update set embedding_store_fit=v_fit, updated_at=now();
  end if;
  perform public.admin_mark_embedding_reviewed(p_track_id, p_model, 'embedding 결과 반영(embedding_store_fit, 라이브 미연동)');
  return jsonb_build_object('ok', true, 'embedding_store_fit', v_fit);
end; $$;
grant execute on function public.admin_apply_embedding_to_ai_metadata(uuid, text) to authenticated;
