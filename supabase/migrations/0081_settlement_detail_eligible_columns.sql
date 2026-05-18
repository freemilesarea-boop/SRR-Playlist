-- 0081 — admin_settlement_detail RPC 가 items 에 eligible/raw/excluded 컬럼 포함
--
-- 0079 에서 settlement_items 에 eligible_stream_count / raw_milestone_stream_count /
-- excluded_stream_count 컬럼이 추가되었으나, admin_settlement_detail RPC 의 jsonb
-- 응답에 포함되지 않아 관리자 정산 상세 UI 에서 표시 불가했던 부분을 fix.
--
-- 변경:
-- - items jsonb 에 eligible_stream_count / raw_milestone_stream_count /
--   excluded_stream_count 필드 추가
-- - stream_count / pool_revenue_share / track_code / track_title 기존 필드는 그대로

CREATE OR REPLACE FUNCTION public.admin_settlement_detail(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_result jsonb;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  select jsonb_build_object(
    'settlement', to_jsonb(s.*),
    'artist', jsonb_build_object('nickname', u.nickname, 'email', au.email, 'artist_name', ap.artist_name),
    'policy', to_jsonb(p.*),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'track_code', i.track_code,
        'track_title', i.track_title,
        'stream_count', i.stream_count,
        'eligible_stream_count', i.eligible_stream_count,
        'raw_milestone_stream_count', i.raw_milestone_stream_count,
        'excluded_stream_count', i.excluded_stream_count,
        'pool_revenue_share', i.pool_revenue_share
      ) order by i.pool_revenue_share desc), '[]'::jsonb)
      from public.settlement_items i where i.settlement_id = s.id
    )
  ) into v_result
  from public.artist_settlements s
  join public.users u on u.id = s.artist_user_id
  left join auth.users au on au.id = s.artist_user_id
  left join public.artist_profiles ap on ap.user_id = s.artist_user_id
  left join public.settlement_policies p on p.id = s.policy_id
  where s.id = p_id;
  return v_result;
end; $function$;

NOTIFY pgrst, 'reload schema';
