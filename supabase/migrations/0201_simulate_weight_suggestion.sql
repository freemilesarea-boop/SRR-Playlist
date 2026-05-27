-- 0201 — 가중치 제안 적용 전 "영향도 시뮬레이션" (read-only). 실제 가중치/score/update 절대 없음.
--   현재 track_ai_metadata.ai_store_fit(매장별 0~100) + ai_scoring_config 컷오프를 읽어,
--   제안된 가상 delta 를 적용했을 때 추천/제외/플레이리스트 영향을 추정만 한다.
--   delta = confidence 기반 5~15p (overpredict/-trust: 음수, underpredict: 양수). 실제 반영 아님.

create or replace function public.admin_simulate_weight_suggestion(p_suggestion_id uuid, p_sample_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  s public.ai_weight_suggestions%rowtype;
  rc numeric; xt numeric; v_delta numeric; v_signed numeric; v_lim int;
  v_is_store boolean; v_store text; v_owner text; v_sensitive boolean; res jsonb;
  sensitive text[] := array['hospital','kids_cafe','yoga','pilates','fine_dining','hotel_lobby','nail_shop'];
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select * into s from public.ai_weight_suggestions where id=p_suggestion_id;
  if not found then raise exception 'suggestion not found'; end if;
  select fit_recommend_cutoff, store_exclude_threshold into rc, xt from public.ai_scoring_config where id=1;
  v_lim := least(greatest(coalesce(p_sample_limit,100),1),500);
  v_delta := round(5 + 10*coalesce(s.confidence,0.5));                      -- 5~15p
  v_is_store := s.suggestion_type in ('store_overpredict','store_underpredict');
  v_signed := case when s.suggestion_type='store_underpredict' then v_delta else -v_delta end;
  v_store := case when v_is_store then s.target_key end;
  v_owner := case when s.suggestion_type='uploader_trust_down' then s.target_key end;
  v_sensitive := coalesce(v_store = any(sensitive), false);

  with aff as (
    select t.id track_id, t.title, au.email artist_email, am.ai_store_fit fit,
           exists(select 1 from public.playlist_tracks pt where pt.track_id=t.id) in_pl
    from public.track_ai_metadata am
    join public.tracks t on t.id = am.track_id
    left join auth.users au on au.id = t.owner_user_id
    where am.ai_store_fit is not null
      and ( (v_is_store and am.ai_store_fit ? v_store)
         or (not v_is_store and t.owner_user_id::text = v_owner) )
  ),
  calc as (
    select a.*,
      case when v_is_store then nullif(a.fit->>v_store,'')::numeric
           else (select max(val::numeric) from jsonb_each_text(a.fit) e(k,val)) end as cur
    from aff a
  ),
  fin as (
    select c.*, greatest(0, least(100, c.cur + v_signed)) as sim,
      (c.cur >= rc) cur_rec, (greatest(0, least(100, c.cur + v_signed)) >= rc) sim_rec,
      (c.cur > xt and greatest(0, least(100, c.cur + v_signed)) <= xt) became_excl,
      (select array_agg(k order by val desc) from (select k, val::numeric val from jsonb_each_text(c.fit) e(k,val) order by val::numeric desc limit 3) z) cur_top,
      (select array_agg(k order by val desc) from (
         select k, case when v_is_store and k=v_store then greatest(0,least(100,val::numeric+v_signed)) else val::numeric end val
         from jsonb_each_text(c.fit) e(k,val) order by 2 desc limit 3) z) sim_top
    from calc c where c.cur is not null
  )
  select jsonb_build_object(
    'suggestion_id', s.id, 'suggestion_type', s.suggestion_type, 'target_key', s.target_key,
    'current_config', jsonb_build_object('fit_recommend_cutoff', rc, 'store_exclude_threshold', xt),
    'proposed_delta', v_signed,
    'affected_tracks_count', count(*),
    'would_drop_below_recommend', count(*) filter (where cur_rec and not sim_rec),
    'would_enter_recommend', count(*) filter (where not cur_rec and sim_rec),
    'would_be_excluded', count(*) filter (where became_excl),
    'playlist_impact_count', count(*) filter (where in_pl and (cur_rec <> sim_rec)),
    'guardrail_conflict_change_estimate', jsonb_build_object(
        'sensitive_store', v_sensitive,
        'direction', case s.suggestion_type when 'store_overpredict' then 'reduce' when 'store_underpredict' then 'increase' else 'reduce' end,
        'estimate', case when v_sensitive then count(*) filter (where cur_rec and not sim_rec) else 0 end),
    'sample_tracks', coalesce((
       select jsonb_agg(x.obj) from (
         select jsonb_build_object(
           'track_id', track_id, 'title', title, 'artist_email', artist_email,
           'current_score', round(cur,1), 'simulated_score', round(sim,1), 'delta', round(sim-cur,1),
           'current_top_stores', cur_top, 'simulated_top_stores', sim_top,
           'currently_recommended', cur_rec, 'simulated_recommended', sim_rec, 'in_playlists', in_pl) obj
         from fin order by (cur_rec <> sim_rec) desc, cur desc limit v_lim) x), '[]'::jsonb)
  ) into res from fin;
  return res;
end; $$;
grant execute on function public.admin_simulate_weight_suggestion(uuid, int) to authenticated;