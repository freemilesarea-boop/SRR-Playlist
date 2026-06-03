-- 0271 — admin_backfill_store_genre_policy_review: excluded 상태 보호 (X5.4 hotfix)
--
-- 문제: 기존 ON CONFLICT 로직이 source='admin' 만 보호.
--       status='excluded' (이미 명시 차단) 도 review_needed 로 강등됨.
--
-- 수정: status='excluded' 도 보호 대상 추가 (source='admin' 과 OR 결합)

create or replace function public.admin_backfill_store_genre_policy_review(
  p_dry_run boolean default true
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_total int := 0; v_with_policy int := 0; v_violations int := 0;
  v_already_admin int := 0; v_marked int := 0;
  v_excluded_protected int := 0;
  v_by_store jsonb; v_by_genre jsonb;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  create temp table _v on commit drop as
  select pt.playlist_id, pt.track_id,
         public.normalize_store_label(pl.business_category) as slug,
         t.main_genre, coalesce(t.instrumental,false) as is_inst,
         public._check_store_genre_placement(pt.track_id, public.normalize_store_label(pl.business_category)) as ck,
         f.status as cur_status, f.source as cur_source
  from public.playlist_tracks pt
  join public.playlists pl on pl.id = pt.playlist_id
  join public.tracks t on t.id = pt.track_id
  left join public.playlist_track_fit_scores f on f.playlist_id=pt.playlist_id and f.track_id=pt.track_id
  where pt.removed_at is null
    and public.normalize_store_label(pl.business_category) is not null;

  select count(*) into v_total from _v;
  select count(*) into v_with_policy from _v where (ck->>'has_store_policy')::bool;
  select count(*) into v_violations from _v
    where (ck->>'has_store_policy')::bool and not (ck->>'allowed')::bool;
  select count(*) into v_already_admin from _v
    where (ck->>'has_store_policy')::bool and not (ck->>'allowed')::bool and cur_source='admin';
  select count(*) into v_excluded_protected from _v
    where (ck->>'has_store_policy')::bool and not (ck->>'allowed')::bool
      and cur_status='excluded' and coalesce(cur_source,'') <> 'admin';

  select jsonb_object_agg(slug, n) into v_by_store from (
    select slug, count(*) as n from _v
    where (ck->>'has_store_policy')::bool and not (ck->>'allowed')::bool
    group by slug
  ) s;

  select jsonb_object_agg(coalesce(main_genre,'(null)'), n) into v_by_genre from (
    select main_genre, count(*) as n from _v
    where (ck->>'has_store_policy')::bool and not (ck->>'allowed')::bool
    group by main_genre order by 2 desc limit 30
  ) g;

  if not p_dry_run then
    insert into public.playlist_track_fit_scores
      (playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score,
       reason, source, status, updated_at, reason_codes)
    select v.playlist_id, v.track_id,
           coalesce((select fit_score from public.playlist_track_fit_scores f2
                     where f2.playlist_id=v.playlist_id and f2.track_id=v.track_id), 50),
           0,0,0,0,
           format('[md_policy_violation] %s · genre=%s · vocal=%s',
                  v.slug, v.main_genre,
                  case when v.is_inst then 'instrumental' else 'vocal' end),
           'algorithm', 'review_needed', now(),
           array['md_policy_violation:'||v.slug, 'md_policy_v1']
    from _v v
    where (v.ck->>'has_store_policy')::bool and not (v.ck->>'allowed')::bool
    on conflict (playlist_id, track_id) do update set
      -- 🆕 0271: admin OR excluded 보호
      status = case when public.playlist_track_fit_scores.source='admin'
                    or public.playlist_track_fit_scores.status='excluded'
                    then public.playlist_track_fit_scores.status
                    else 'review_needed' end,
      reason = case when public.playlist_track_fit_scores.source='admin'
                    or public.playlist_track_fit_scores.status='excluded'
                    then public.playlist_track_fit_scores.reason
                    else excluded.reason end,
      reason_codes = case when public.playlist_track_fit_scores.source='admin'
                          then public.playlist_track_fit_scores.reason_codes
                          else array_cat(coalesce(public.playlist_track_fit_scores.reason_codes,'{}'::text[]),
                                          excluded.reason_codes) end,
      updated_at = now();
    get diagnostics v_marked = row_count;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'total_playlist_tracks_scanned', v_total,
    'with_policy_defined', v_with_policy,
    'violations', v_violations,
    'admin_overrides_protected', v_already_admin,
    'excluded_protected', v_excluded_protected,
    'marked_review_needed', v_marked,
    'by_store', coalesce(v_by_store, '{}'::jsonb),
    'by_genre', coalesce(v_by_genre, '{}'::jsonb),
    'note', case when p_dry_run then 'DRY RUN — no DB changes'
                 else 'APPLIED — review_needed marked (admin + excluded preserved)' end
  );
end; $$;
