-- ============================================================================
-- 0489 — 관리자 홈 "처리 대기" 집계 (ADMIN-HOME-WORKQUEUE-1)
--
-- 배경:
--   관리자 홈(/admin?tab=dashboard)은 방문자·스트리밍·매출 차트만 보여준다.
--   "오늘 뭘 처리해야 하는가"는 어디에도 없어서, 운영자가 67개 탭을 직접 돌며
--   대기 건수를 확인해야 한다. 실제로 8/31 #525/#527 에서 드러난 "계좌는 verified
--   인데 지급 요건 미완비 24건"은 그 화면(계좌 확인 / 정산 정보 신청)이 갈라져 있고
--   어느 쪽에서도 카운트가 보이지 않아 6월부터 방치됐다.
--
-- 이 함수는 홈 상단 한 줄에 띄울 대기 건수를 한 번의 왕복으로 반환한다.
--   · 읽기 전용(stable). 기존 RPC/테이블/권한 무변경 — 순수 additive.
--   · 각 카운트는 해당 탭이 이미 쓰는 것과 같은 조건을 재현한다(아래 주석에 출처 명시).
--     새 판정 기준을 만들지 않는다 — 홈 숫자와 탭 목록이 어긋나면 안 되므로.
--
-- 권한:
--   role='admin' 게이트(대부분의 admin RPC 와 동일).
--   정산 금액/건수만 _is_super_admin() 일 때 채운다 — admin_pending_settlement_alert
--   (0476)이 이미 super admin 전용이므로 노출 범위를 그대로 따른다.
-- ============================================================================

create or replace function public.admin_work_queue_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_now                 timestamptz := now();
  v_is_super            boolean;
  v_track_review        int := 0;
  v_artist_approval     int := 0;
  v_payout_intake       int := 0;
  v_payout_verify       int := 0;
  v_payout_incomplete   int := 0;
  v_settlement_month    date := null;
  v_settlement_pending  int := 0;
  v_settlement_held     int := 0;
  v_settlement_amount   bigint := 0;
  v_inquiry_open        int := 0;
  v_inquiry_urgent      int := 0;
  v_store_offline       int := 0;
  v_store_error         int := 0;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  v_is_super := public._is_super_admin();

  -- 음원 검수 대기 — count_pending_review_tracks() (0107) 와 동일 조건.
  select count(*) into v_track_review
  from public.tracks t
  where t.source_type = 'artist_upload'
    and (t.visibility_status = 'pending_review'
         or t.release_status in ('submitted','review_pending','changes_requested'))
    and t.release_status not in ('removed','rejected','released','approved','scheduled');

  -- 아티스트 승인 대기 — list_pending_artists() (0017) 의 pending.
  select count(*) into v_artist_approval
  from public.artist_profiles ap
  where ap.approval_status = 'pending';

  -- 정산 정보 신청 대기 — payout_intake_submissions (0304/0305).
  -- needs_revision 은 회원 보완을 기다리는 상태라 관리자 처리 대기에서 제외한다.
  select count(*) into v_payout_intake
  from public.payout_intake_submissions s
  where s.status = 'pending';

  -- 계좌 확인 대기 — list_pending_payout_accounts 가 보여주는 pending.
  select count(*) into v_payout_verify
  from public.artist_payout_accounts a
  where a.verification_status = 'pending';

  -- 정산 정보 미완비 — 계좌는 verified 인데 지급 요건(실명·주민번호·계좌·원천징수 동의)
  -- 미충족. 0487 이 회원 메일 필터로 쓰는 것과 같은 판정(artist_payout_account_ready).
  -- 어느 탭에도 카운트가 없어 방치됐던 값이라 홈에 올리는 핵심 항목.
  select count(*) into v_payout_incomplete
  from public.artist_payout_accounts a
  where a.verification_status = 'verified'
    and not public.artist_payout_account_ready(a.user_id);

  -- 정산 지급 대기 — admin_pending_settlement_alert() (0476) 과 동일(최신 정산월 한정).
  if v_is_super then
    select max(s.settlement_month) into v_settlement_month
    from public.artist_settlements s where s.status in ('pending','held');

    if v_settlement_month is not null then
      select count(*) filter (where s.status = 'pending')::int,
             count(*) filter (where s.status = 'held')::int,
             coalesce(sum(s.total_settlement_amount), 0)::bigint
        into v_settlement_pending, v_settlement_held, v_settlement_amount
      from public.artist_settlements s
      where s.settlement_month = v_settlement_month
        and s.status in ('pending','held');
    end if;
  end if;

  -- 문의 미처리 — support_inquiries (0284). resolved/closed 는 제외.
  select count(*),
         count(*) filter (where i.priority = 'urgent')
    into v_inquiry_open, v_inquiry_urgent
  from public.support_inquiries i
  where i.status in ('open','in_progress');

  -- 매장 오프라인 / 재생 오류 — admin_noc_kpi() (0385) 의 offline_stores / player_errors
  -- 와 같은 소스. NOC 함수를 호출하지 않고 필요한 두 값만 읽는다(홈은 매 진입 실행).
  select count(*) filter (where not n.is_online),
         count(*) filter (where n.playback_error is not null
                            and length(btrim(n.playback_error)) > 0)
    into v_store_offline, v_store_error
  from public.store_now_playing n;

  return jsonb_build_object(
    'track_review',        v_track_review,
    'artist_approval',     v_artist_approval,
    'payout_intake',       v_payout_intake,
    'payout_verify',       v_payout_verify,
    'payout_incomplete',   v_payout_incomplete,
    'settlement_month',    v_settlement_month,
    'settlement_pending',  v_settlement_pending,
    'settlement_held',     v_settlement_held,
    'settlement_amount',   v_settlement_amount,
    'inquiry_open',        v_inquiry_open,
    'inquiry_urgent',      v_inquiry_urgent,
    'store_offline',       v_store_offline,
    'store_error',         v_store_error,
    'is_super_admin',      v_is_super,
    'computed_at',         v_now
  );
end;
$$;

revoke all on function public.admin_work_queue_counts() from public, anon;
grant execute on function public.admin_work_queue_counts() to authenticated, service_role;

comment on function public.admin_work_queue_counts() is
  '관리자 홈 처리 대기 집계(읽기 전용). 각 카운트는 해당 탭의 기존 판정 조건을 재현한다.';
