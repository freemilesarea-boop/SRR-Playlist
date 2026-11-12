-- 0553_announcement_today_log.sql
--
-- 안내방송 전용 플레이어(/brand/announcer/:brandId) 화면의 "오늘 송출 기록".
-- 이 기기(로그인 계정)가 오늘(KST) 내보낸 안내방송의 회차별 결과를 돌려준다.
-- 한 회차에 started → played/failed 처럼 여러 줄이 남으므로 회차별 최종 상태 1줄로 접는다.

create or replace function public.store_my_announcement_today(p_limit int default 50)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with today as (
    select ((now() at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul' as start_at
  ),
  logs as (
    select distinct on (coalesce(pl.occurrence_key, pl.id::text))
           pl.schedule_id, pl.status, pl.error_message,
           coalesce(pl.scheduled_for, pl.played_at, pl.created_at) as at,
           pl.played_at, pl.created_at
      from public.enterprise_announcement_play_logs pl, today
     where pl.store_id = auth.uid()
       and pl.created_at >= today.start_at
     order by coalesce(pl.occurrence_key, pl.id::text),
              case pl.status when 'played' then 0 when 'failed' then 1 when 'skipped' then 2 else 3 end,
              pl.created_at desc
  )
  select jsonb_build_object('success', true, 'data', coalesce(jsonb_agg(jsonb_build_object(
           'schedule_id',   l.schedule_id,
           'schedule_name', s.name,
           'asset_title',   a.title,
           'status',        l.status,
           'error',         l.error_message,
           'scheduled_at',  l.at,
           'played_at',     l.played_at
         ) order by l.at desc), '[]'::jsonb))
    from (select * from logs order by at desc limit greatest(coalesce(p_limit, 50), 1)) l
    left join public.enterprise_announcement_schedules s on s.id = l.schedule_id
    left join public.enterprise_announcement_assets a on a.id = s.asset_id
   where auth.uid() is not null;
$$;

revoke all on function public.store_my_announcement_today(int) from public, anon;
grant execute on function public.store_my_announcement_today(int) to authenticated;
