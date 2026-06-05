-- 0293 — 업로드 quota 일관성 핫픽스 (X6.7)
--
-- 운영 제보: 50곡 제출 중 43곡 반려(removed) 상태인 사용자가
-- 새 곡 업로드 시 "한도 50곡 모두 사용" 차단.
--
-- 근본 원인 2개:
--   1) _tg_enforce_monthly_upload_quota 트리거가 removed/rejected 필터 없이 raw count
--      → 50곡 카운트 그대로 → 차단
--   2) get_my_upload_quota 함수가 무인자/인자 2개 오버로드 → PostgREST 가 무인자
--      레거시(필터 없음) 호출 → UI 도 50/50 표시
--
-- 해결:
--   A) 트리거 함수의 count 절에 get_my_upload_quota 와 동일한 필터 적용
--      (removed_at is null + release_status in [활성 상태들] + visibility_status <> 'rejected')
--   B) 무인자 레거시 get_my_upload_quota() DROP — 신규 (p_quota default 50) 만 남김
--
-- 안전: 자동 삭제 / 데이터 변경 없음. 함수 정의만 수정.

-- ===== A. 차단 트리거 — get_my_upload_quota 와 동일 필터 적용 =====
create or replace function public._tg_enforce_monthly_upload_quota()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_month_start timestamptz := (date_trunc('month', (now() at time zone 'Asia/Seoul'))::timestamp at time zone 'Asia/Seoul');
  v_month_end   timestamptz := ((date_trunc('month', (now() at time zone 'Asia/Seoul')) + interval '1 month')::timestamp at time zone 'Asia/Seoul');
  v_quota constant int := 50;
begin
  if new.source_type is distinct from 'artist_upload' then return new; end if;
  if new.owner_user_id is null then return new; end if;

  -- admin 은 한도 미적용
  if exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    return new;
  end if;

  -- get_my_upload_quota(int) 와 동일한 필터:
  --   removed_at is null + 활성 release_status + rejected visibility 제외
  select count(*) into v_count
  from public.tracks t
  where t.owner_user_id = new.owner_user_id
    and t.source_type = 'artist_upload'
    and t.created_at >= v_month_start
    and t.created_at <  v_month_end
    and t.removed_at is null
    and t.release_status in ('submitted','review_pending','changes_requested','approved','scheduled','released')
    and coalesce(t.visibility_status, '') <> 'rejected';

  if v_count >= v_quota then
    raise exception 'monthly_upload_quota_exceeded'
      using hint = format(
        '이번 달 음원 등록 한도(%s곡)를 모두 사용하셨습니다. 다음 달 1일부터 다시 등록 가능합니다.',
        v_quota
      );
  end if;

  return new;
end; $$;

-- ===== B. ambiguous 무인자 오버로드 제거 =====
-- PostgREST 가 무인자 호출 시 (인자 없는 시그니처가 있으면) 그것을 우선 선택 →
-- 0288 fix 의 신규 함수가 무시되는 문제. 레거시 DROP 으로 정리.
drop function if exists public.get_my_upload_quota();

-- 신규 함수 (p_quota default 50) 만 남음 — RPC 호출 시 body 없어도 default 적용.
-- 함수 정의는 0288 그대로 유지하되, 안전 확인을 위해 한 번 더 재선언.
create or replace function public.get_my_upload_quota(p_quota integer default 50)
returns table(
  used integer, quota integer, remaining integer,
  period_start timestamptz, period_end timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_start timestamptz;
  v_end timestamptz;
  v_used int := 0;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  v_start := (date_trunc('month', (now() at time zone 'Asia/Seoul'))::timestamp at time zone 'Asia/Seoul');
  v_end   := ((date_trunc('month', (now() at time zone 'Asia/Seoul')) + interval '1 month')::timestamp at time zone 'Asia/Seoul');

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
    v_start, v_end;
end; $$;

revoke all on function public.get_my_upload_quota(integer) from public, anon;
grant execute on function public.get_my_upload_quota(integer) to authenticated, service_role;
