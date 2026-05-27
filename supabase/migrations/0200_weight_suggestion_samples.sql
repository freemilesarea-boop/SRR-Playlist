-- 0200 — AI 가중치 제안의 "근거 샘플 곡" 조회 RPC (read-only). 설정/데이터 변경 없음.
--   제안(ai_weight_suggestions) 1건에 대해, 그 제안을 만든 실제 학습예시(곡)들을 반환.
--   저장형 evidence_samples 대신 on-demand 조회(항상 최신, jsonb 비대화 방지).

create or replace function public.admin_weight_suggestion_samples(p_suggestion_id uuid, p_limit int default 10)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare s public.ai_weight_suggestions%rowtype; v jsonb; v_days int; v_lim int;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  select * into s from public.ai_weight_suggestions where id = p_suggestion_id;
  if not found then raise exception 'suggestion not found'; end if;
  v_days := coalesce(s.source_window_days, 90);
  v_lim  := least(greatest(coalesce(p_limit,10),1),50);

  with base as (
    select e.*, t.title as track_title, u.email as artist_email
    from public.metadata_training_examples e
    left join public.tracks t on t.id = e.track_id
    left join auth.users u on u.id = e.owner_user_id
    where e.created_at >= now() - (v_days||' days')::interval
  ), matched as (
    select * from base e
    where
      (s.suggestion_type = 'store_overpredict'
        and (e.field_diffs->>'ai_present')::boolean is true
        and s.target_key = any(coalesce(e.ai_store_tags,'{}'::text[]))
        and not (s.target_key = any(coalesce(e.admin_final_store_tags,'{}'::text[]))))
      or
      (s.suggestion_type = 'store_underpredict'
        and (e.field_diffs->>'ai_present')::boolean is true
        and s.target_key = any(coalesce(e.admin_final_store_tags,'{}'::text[]))
        and not (s.target_key = any(coalesce(e.ai_store_tags,'{}'::text[]))))
      or
      (s.suggestion_type = 'uploader_trust_down'
        and e.owner_user_id::text = s.target_key
        and (e.field_diffs->'store'->>'user_match') = 'false')
    order by e.created_at desc
    limit v_lim
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'track_id', m.track_id,
    'track_title', m.track_title,
    'artist_email', m.artist_email,
    'owner_user_id', m.owner_user_id,
    'ai_metadata', jsonb_build_object('genre', m.ai_genre, 'moods', m.ai_moods, 'store_tags', m.ai_store_tags, 'tempo', m.ai_tempo_feel),
    'user_metadata', jsonb_build_object('genre', m.user_genre, 'moods', m.user_moods, 'store_tags', m.user_store_tags, 'tempo', m.user_tempo_feel),
    'admin_final_metadata', jsonb_build_object('genre', m.admin_final_genre, 'moods', m.admin_final_moods, 'store_tags', m.admin_final_store_tags, 'tempo', m.admin_final_tempo_feel),
    'correction_type', m.correction_type,
    'changed_at', m.created_at,
    'reviewed_by', m.reviewed_by,
    'field_diffs', m.field_diffs)), '[]'::jsonb)
  into v from matched m;

  return jsonb_build_object('ok', true, 'suggestion_type', s.suggestion_type, 'target_key', s.target_key, 'samples', v);
end; $$;
grant execute on function public.admin_weight_suggestion_samples(uuid, int) to authenticated;