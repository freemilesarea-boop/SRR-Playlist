-- 0273 — admin_list_md_policy_violations 정식 등록 (X5.4 후속)
--
-- 사유: 0268 적용 시 mcp__apply_migration query 에 함수 정의 누락.
--       p_dry_run=false 실행 후 검증 단계에서 직접 SQL 로 추가 등록.
--       DB 와 코드 히스토리 일치화를 위해 정식 마이그레이션으로 남김.
--
-- 멱등: CREATE OR REPLACE — DB 에 이미 존재하는 함수와 동일 정의.

create or replace function public.admin_list_md_policy_violations(
  p_store text default null, p_limit int default 200
) returns table (
  playlist_id uuid, playlist_name text, track_id uuid, track_title text, artist text,
  main_genre text, instrumental boolean, store_slug text, reason text,
  fit_score numeric, fit_status text, fit_source text
)
language plpgsql stable security definer set search_path = public as $$
declare v_admin uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return query
    select pt.playlist_id, pl.title, pt.track_id, t.title, t.artist,
           t.main_genre, coalesce(t.instrumental, false),
           public.normalize_store_label(pl.business_category),
           (public._check_store_genre_placement(pt.track_id,
              public.normalize_store_label(pl.business_category)))->>'reason',
           f.fit_score, f.status, f.source
    from public.playlist_tracks pt
    join public.playlists pl on pl.id = pt.playlist_id
    join public.tracks t on t.id = pt.track_id
    left join public.playlist_track_fit_scores f on f.playlist_id=pt.playlist_id and f.track_id=pt.track_id
    where pt.removed_at is null
      and (p_store is null or public.normalize_store_label(pl.business_category) = p_store)
      and (
        public._check_store_genre_placement(pt.track_id,
          public.normalize_store_label(pl.business_category))->>'reason'
      ) in ('md_policy_no_match','md_policy_undefined_store')
    limit coalesce(p_limit, 200);
end; $$;

revoke all on function public.admin_list_md_policy_violations(text, int) from public, anon;
grant execute on function public.admin_list_md_policy_violations(text, int) to authenticated, service_role;
