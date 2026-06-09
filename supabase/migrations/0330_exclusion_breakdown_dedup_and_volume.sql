-- 0330 — admin_streaming_exclusion_breakdown 에 dedup_30s_window + muted/volume 추가 (X6.47)
--
-- 분석 보고서 Tier 3.3 follow-up:
--   0087 breakdown RPC 가 5개 카테고리만 반환:
--     unreleased / admin_preview / artist_preview / self_play / daily_user_track_cap
--   그런데 admin UI (StreamingAnalytics.tsx:302-303) 는 muted_play / low_player_volume
--   카드도 렌더 — 0089 가 컬럼/exclusion 만 추가하고 breakdown RPC 갱신을 누락.
--   결과: 두 카드가 undefined → 빈 값 노출.
--
-- X6.47 의 새 'dedup_30s_window' 도 추가해서 admin 이 dedup 거부 건수 가시.
--
-- 변경:
--   - admin_streaming_exclusion_breakdown 에 muted_play / low_player_volume /
--     dedup_30s_window 3개 카운트 추가
--   - other_excluded placeholder 제거 (TS 인터페이스에도 없음)
--   - return signature 호환 (existing field 그대로 + 3개 추가)

create or replace function public.admin_streaming_exclusion_breakdown(p_days int default 30)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
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
    'muted_play',           count(*) filter (where exclusion_reason='muted_play'),
    'low_player_volume',    count(*) filter (where exclusion_reason='low_player_volume'),
    'dedup_30s_window',     count(*) filter (where exclusion_reason='dedup_30s_window'),
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

revoke execute on function public.admin_streaming_exclusion_breakdown(int) from public, anon;
grant execute on function public.admin_streaming_exclusion_breakdown(int) to authenticated;

notify pgrst, 'reload schema';
