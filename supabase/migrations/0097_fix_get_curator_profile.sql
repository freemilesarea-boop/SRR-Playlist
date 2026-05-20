-- 0097 — HOTFIX: get_curator_profile 호출 시 큐레이터 상세 진입 불가 (404 false positive)
--
-- 증상: 큐레이터 카드 클릭 → "큐레이터를 찾을 수 없어요"
-- 원인: 0013 의 get_curator_profile 함수 본문이 2개의 잠재 버그를 동시 보유.
--   (1) own_pls CTE 의 unqualified created_at 이 RETURNS TABLE OUT 파라미터 created_at 과
--       충돌 → 42702 column reference ambiguous
--   (2) coalesce(sum(...), 0) 가 numeric 반환 → OUT 의 bigint 와 불일치 → 42804
--   PL/pgSQL lazy bind 라 CREATE 시점엔 통과, 호출 시점에만 fail.
--   fetchCuratorProfile 가 catch → null → UI 가 "찾을 수 없어요" 표시.
--
-- 수정:
--   (1) own_pls.created_at → pl_created_at 으로 rename + 테이블 alias(pp) qualify
--   (2) follower_count / total_playlist_streams / monthly_streams / chart_entries 에 ::bigint 캐스팅

create or replace function public.get_curator_profile(p_handle text)
returns table(user_id uuid, display_name text, handle text, bio text, profile_image_url text, contact_email text, instagram_url text, youtube_url text, website_url text, allow_business_contact boolean, is_verified boolean, is_featured boolean, created_at timestamp with time zone, follower_count bigint, playlist_count bigint, total_playlist_streams bigint, monthly_streams bigint, chart_entries bigint, playlists jsonb)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
begin
  select cp.user_id into v_user_id
  from public.curator_profiles cp
  where cp.handle = lower(p_handle);

  if v_user_id is null then return; end if;

  return query
  with
    own_pls as (
      select pp.id, pp.title, pp.thumbnail_url, pp.category, pp.created_at as pl_created_at
      from public.playlists pp
      where pp.created_by_user_id = v_user_id
    ),
    pl_follows as (
      select pf.playlist_id, count(*)::bigint as fc
      from public.playlist_follows pf
      where pf.playlist_id in (select id from own_pls)
      group by pf.playlist_id
    ),
    pl_streams as (
      select se.playlist_id,
             count(*) filter (where se.event_type = 'milestone_30s')::bigint as total,
             count(*) filter (where se.event_type = 'milestone_30s'
                              and se.created_at >= now() - interval '30 days')::bigint as monthly
      from public.stream_events se
      where se.playlist_id in (select id from own_pls)
      group by se.playlist_id
    ),
    user_followers as (
      select count(distinct pf.user_id)::bigint as fc
      from public.playlist_follows pf
      where pf.playlist_id in (select id from own_pls)
    ),
    chart_cnt as (
      select count(*)::bigint as ce
      from public.stream_events se
      where se.playlist_id in (select id from own_pls)
        and se.event_type = 'complete'
    ),
    pl_array as (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'title', p.title,
            'thumbnail_url', p.thumbnail_url,
            'category', p.category,
            'follower_count', coalesce(plf.fc, 0),
            'stream_count', coalesce(pls.total, 0)
          )
          order by coalesce(pls.total, 0) desc, p.pl_created_at desc
        ),
        '[]'::jsonb
      ) as arr
      from own_pls p
      left join pl_follows plf on plf.playlist_id = p.id
      left join pl_streams pls on pls.playlist_id = p.id
    )
  select
    cp.user_id, cp.display_name, cp.handle, cp.bio, cp.profile_image_url,
    cp.contact_email, cp.instagram_url, cp.youtube_url, cp.website_url,
    cp.allow_business_contact, cp.is_verified, cp.is_featured, cp.created_at,
    coalesce((select fc from user_followers), 0)::bigint as follower_count,
    (select count(*)::bigint from own_pls) as playlist_count,
    coalesce((select sum(total) from pl_streams), 0)::bigint as total_playlist_streams,
    coalesce((select sum(monthly) from pl_streams), 0)::bigint as monthly_streams,
    coalesce((select ce from chart_cnt), 0)::bigint as chart_entries,
    (select arr from pl_array) as playlists
  from public.curator_profiles cp
  where cp.user_id = v_user_id;
end;
$function$;
