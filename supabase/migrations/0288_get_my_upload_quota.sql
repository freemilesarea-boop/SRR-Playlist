-- 0288 — get_my_upload_quota RPC + 월 한도 검증 (X6.2.13)
--
-- 긴급 버그: 아티스트가 월 50곡 한도까지 등록했고 관리자가 30곡 반려/삭제했어도
--          여전히 한도 초과로 추가 업로드 차단됨.
--
-- 원인: 프론트엔드 (artistApi.ts:27) 가 get_my_upload_quota RPC 를 호출하나
--      해당 RPC 가 DB 에 정의되지 않음 → null 반환 → 검증 우회 또는 정확한 quota 표시 불가.
--
-- 카운트 포함 (= 진행 중 / 승인됨 / 발매됨):
--   release_status: submitted, review_pending, changes_requested, approved, scheduled, released
--   AND visibility_status <> 'rejected'  (관리자 반려 제외)
--   AND removed_at IS NULL                (soft delete 제외)
--
-- 카운트 제외 (= 슬롯 반환):
--   release_status IN ('draft','rejected','removed')
--   OR visibility_status = 'rejected'
--   OR removed_at IS NOT NULL
--
-- 월 경계: KST 기준 매월 1일 00:00 ~ 다음달 1일 00:00.
-- 기준 시각: tracks.created_at.

create or replace function public.get_my_upload_quota(
  p_quota int default 50
) returns table (
  used int,
  quota int,
  remaining int,
  period_start timestamptz,
  period_end timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_start timestamptz;
  v_end timestamptz;
  v_used int := 0;
begin
  if v_uid is null then
    raise exception 'unauthorized';
  end if;

  -- KST 기준 이번 달 1일 00:00
  v_start := (date_trunc('month', (now() at time zone 'Asia/Seoul'))::timestamp at time zone 'Asia/Seoul');
  v_end := ((date_trunc('month', (now() at time zone 'Asia/Seoul')) + interval '1 month')::timestamp at time zone 'Asia/Seoul');

  -- "진행 중 / 승인된" 트랙만 카운트.
  -- 반려(rejected) / 삭제(removed) / soft-delete(removed_at) 은 슬롯 반환 — 제외.
  select count(*)::int into v_used
  from public.tracks t
  where t.owner_user_id = v_uid
    and t.source_type = 'artist_upload'
    and t.created_at >= v_start
    and t.created_at <  v_end
    and t.removed_at is null
    and t.release_status in ('submitted','review_pending','changes_requested','approved','scheduled','released')
    and coalesce(t.visibility_status, '') <> 'rejected';

  return query select
    v_used,
    p_quota,
    greatest(0, p_quota - v_used),
    v_start,
    v_end;
end; $$;

revoke all on function public.get_my_upload_quota(int) from public, anon;
grant execute on function public.get_my_upload_quota(int) to authenticated, service_role;

-- 멱등성: artistApi.ts 가 인자 없이 호출. p_quota default=50 으로 정상 매칭.

-- ===== 서버 단 최종 가드 (submit_artist_release 내부) =====
-- 현재는 클라이언트 사전 차단만 있음. 서버에서도 트리거 또는 RPC 내부에서 한 번 더 확인 필요.
-- 단, submit_artist_release 가 0065 에 정의돼 있고 큰 함수 — 별도 작업으로 분리.
-- 본 마이그레이션은 quota RPC 구현에 집중.
