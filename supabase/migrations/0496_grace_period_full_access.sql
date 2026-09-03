-- ============================================================================
-- 0496_grace_period_full_access.sql
--
-- 정책 변경: **결제한 이용기간이 남아 있으면 해지(정지)했더라도 그 기간 끝까지
--            음원 등록 · 유통 신청 등 유료 기능을 전부 이용할 수 있다.**
--
-- 배경:
--   0467 의 artist_has_paid_access 는 `cancel_requested_at is null` 을 요구해서,
--   해지를 누른 순간(유예기간이 한 달 가까이 남아 있어도) 유통이 즉시 막혔다.
--   반면 users.membership_tier 는 current_period_end 까지 유지되므로 "결제한
--   기간인데 유통만 안 되는" 상태가 됐다. 이미 받은 요금에 대한 이용을 막는 것이라
--   기간 만료(current_period_end)를 기준으로 통일한다.
--
-- 변경:
--   artist_has_paid_access(uuid) 의 유효 결제 조건
--     (이전) status='active'  AND cancel_requested_at is null AND period_end>now()
--     (이후) status in ('active','cancel_scheduled') AND refunded_at is null
--            AND period_end > now()
--
--   이 함수 하나가 tracks 트리거 · tracks/track_audio_quality RLS ·
--   storage(audio/covers) INSERT · get_artist_upload_eligibility(0495) ·
--   get_artist_billing_access 의 공통 게이트라 여기만 바꾸면 전 경로에 적용된다.
--
-- 안전 원칙:
--   • 환불(refunded_at) 건은 계속 차단 — 환불은 기간이 남아 있어도 이용권 회수다.
--   • 'canceled' / 'refunded' / 'expired' 상태는 계속 차단. 유예 상태
--     ('cancel_scheduled') 와 정상 'active' 만 허용한다.
--   • 0495 가 재결제 시 대체된 이전 구독의 current_period_end 를 결제시각으로
--     끊으므로, 대체된 row 가 이 게이트를 다시 열어주는 일은 없다.
--   • 기간이 지나면(current_period_end <= now) 상태 플립(만료 배치) 여부와 무관하게
--     자동으로 다시 차단된다.
--   • 결제/청구 로직 · 음원/정산 데이터 미변경. 함수 시그니처 불변.
-- ============================================================================

create or replace function public.artist_has_paid_access(p_user_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select case
    when p_user_id is null then false
    -- 예외: 관리자
    when exists (select 1 from public.users u where u.id = p_user_id and u.role = 'admin') then true
    -- 예외: 정확한 데모 UUID 4개 (fuzzy 금지 · 정확 일치)
    when p_user_id = any (array[
      'de700001-0000-0000-0000-000000000001',
      'de700002-0000-0000-0000-000000000001',
      'de700002-0000-0000-0000-000000000002',
      'de700002-0000-0000-0000-000000000003'
    ]::uuid[]) then true
    -- 0496: 결제한 이용기간이 남아 있으면 해지 예약(유예) 상태여도 전부 허용.
    --       기준은 current_period_end 단일. 환불건은 제외.
    else exists (
      select 1 from public.subscriptions s
      where s.user_id = p_user_id
        and s.status in ('active','cancel_scheduled')
        and s.refunded_at is null
        and s.current_period_end is not null
        and s.current_period_end > now()
        and s.plan_type in ('individual','business','artist_general','artist_student')
    )
  end;
$$;

-- 0469 의 권한 설정 유지 (create or replace 는 grant 를 보존하지만 명시적으로 재확인).
revoke execute on function public.artist_has_paid_access(uuid) from public;
revoke execute on function public.artist_has_paid_access(uuid) from anon;
grant  execute on function public.artist_has_paid_access(uuid) to authenticated, service_role;

-- ============================================================================
-- 운영 확인 쿼리 (실행 안 함 — 필요 시 수동 실행)
-- ============================================================================
-- 1) 이번 변경으로 유통이 다시 열리는 유저 (해지 예약 + 기간 남음)
-- select s.user_id, s.plan_type, s.status, s.cancel_requested_at, s.current_period_end
-- from public.subscriptions s
-- where s.status = 'cancel_scheduled'
--   and s.refunded_at is null
--   and s.current_period_end > now()
-- order by s.current_period_end;
--
-- 2) 특정 유저 판정 확인 (allowed = true 여야 함)
-- select * from public.artist_billing_access_detail('<user_uuid>'::uuid);
--
-- 3) 환불건이 열리지 않았는지 (0 이어야 정상)
-- select count(*) from public.subscriptions s
-- where s.refunded_at is not null and public.artist_has_paid_access(s.user_id);
