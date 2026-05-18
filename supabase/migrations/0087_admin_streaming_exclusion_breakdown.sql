-- 0087 — 관리자 스트리밍 제외 사유별 breakdown RPC (조회 전용)
--
-- 정책:
-- - admin only
-- - milestone_30s 만 집계 (정산 기준과 동일)
-- - eligible_for_payout=false 인 이벤트의 exclusion_reason 별 카운트 + 합계
-- - admin_streaming_overview 와 같은 p_days 인자 사용 (UI 기간 필터 연동)
--
-- 반환 jsonb:
--   {
--     unreleased: int,
--     admin_preview: int,
--     artist_preview: int,
--     self_play: int,
--     daily_user_track_cap: int,
--     other_excluded: int,        -- reserved (현재 0)
--     total_excluded: int,
--     total_eligible: int,
--     days: int
--   }

CREATE OR REPLACE FUNCTION public.admin_streaming_exclusion_breakdown(p_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  with bucket as (
    select exclusion_reason
    from public.stream_events
    where event_type = 'milestone_30s'
      and created_at > now() - ((p_days - 1) || ' days')::interval
  )
  select jsonb_build_object(
    'unreleased',           count(*) filter (where exclusion_reason='unreleased'),
    'admin_preview',        count(*) filter (where exclusion_reason='admin_preview'),
    'artist_preview',       count(*) filter (where exclusion_reason='artist_preview'),
    'self_play',            count(*) filter (where exclusion_reason='self_play'),
    'daily_user_track_cap', count(*) filter (where exclusion_reason='daily_user_track_cap'),
    'other_excluded',       count(*) filter (where exclusion_reason is null and 1=0),
    'total_excluded',       count(*) filter (where exclusion_reason is not null),
    'total_eligible',       (
      select count(*) from public.stream_events
      where event_type='milestone_30s' and eligible_for_payout=true
        and created_at > now() - ((p_days - 1) || ' days')::interval
    ),
    'days', p_days
  ) into v from bucket;
  return v;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_streaming_exclusion_breakdown(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_streaming_exclusion_breakdown(int) TO authenticated;

NOTIFY pgrst, 'reload schema';
