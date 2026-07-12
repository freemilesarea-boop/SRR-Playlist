-- ============================================
-- 0478_admin_mission_feed.sql
--
-- Phase ADMIN-MISSION-CONTROL-1 — AI Music OS Mission Control.
--
-- Mission Control 은 기존 Dashboard(Member/Growth/Funnel/Revenue/Artist/Business/
-- Streaming/WEB-OBS)의 **통합 레이어**다. 동일 KPI 를 중복 계산하지 않으며, Overview/
-- Health/Timeline/Alert 는 전부 기존 RPC/fetcher 를 프론트에서 병렬 재사용한다.
--
-- 이 마이그레이션은 기존에 없는 **단 하나**의 부족한 부분만 추가한다:
--   admin_mission_feed(p_limit) — 도메인 교차 최근 이벤트 스트림(Live Operations Feed).
-- (기존 admin_noc_recent_events/admin_enterprise_ops_activity_feed 는 NOC/Enterprise
--  스코프 전용이라 회원가입/구독/정산/승인/매장 등 크로스 도메인 이벤트를 담지 못함.)
-- Alert Center 는 기존 admin_noc_active_alerts(limit,severity) 를 그대로 재사용한다.
--
-- 기존 RPC/View/계산 전부 무변경. 읽기 전용. 데이터 수정 없음. 중복 KPI 계산 없음
-- (feed 는 지표가 아니라 이벤트 로그 — KPI 재계산이 아니다).
--
-- ── 이벤트 소스 (실제 존재 테이블만; 없는 이벤트는 생성하지 않음) ──────────
--   member_signup   : public.users(account_type in individual/null) created_at
--   business_signup : public.users(account_type='business') created_at
--   artist_signup   : public.artist_profiles created_at
--   artist_approved : public.artist_profiles(approval_status='approved') approved_at
--   qc_passed       : public.tracks(metadata+audio review approved) approved_at
--   track_released  : public.tracks(release_status='released') released_at
--   subscription    : public.subscriptions created_at
--   payment_paid    : public.payment_orders(status='paid') paid_at
--   settlement      : public.artist_settlements created_at
--   store_created   : public.franchise_stores created_at
--
-- ── 정합성 ─── limit 클램프(1..100), 최신순. 시각은 KST 표시를 위해 timestamptz 그대로 반환.
-- ============================================

-- 관리자 가드는 0472 의 _admin_growth_guard() 재사용.

create or replace function public.admin_mission_feed(p_limit int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 30), 100));
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  with ev as (
    select 'member_signup'   as kind, '신규 회원'   as label, u.created_at as at, coalesce(u.nickname,'')       as ref
      from public.users u where coalesce(u.role,'user') <> 'admin' and coalesce(u.account_type,'') not in ('business','artist') and u.created_at is not null
    union all
    select 'business_signup', '신규 사업자', u.created_at, coalesce(u.nickname,'')
      from public.users u where coalesce(u.role,'user') <> 'admin' and u.account_type='business' and u.created_at is not null
    union all
    select 'artist_signup', '신규 아티스트', ap.created_at, coalesce(ap.artist_name,'')
      from public.artist_profiles ap where ap.created_at is not null
    union all
    select 'artist_approved', '아티스트 승인', ap.approved_at, coalesce(ap.artist_name,'')
      from public.artist_profiles ap where ap.approval_status='approved' and ap.approved_at is not null
    union all
    select 'qc_passed', 'QC 통과', t.approved_at, coalesce(t.title,'')
      from public.tracks t where t.metadata_review_status='approved' and t.audio_review_status='approved' and t.approved_at is not null
    union all
    select 'track_released', '음원 유통', t.released_at, coalesce(t.title,'')
      from public.tracks t where t.release_status='released' and t.released_at is not null
    union all
    select 'subscription', '구독 생성', s.created_at, coalesce(s.plan_type,'')
      from public.subscriptions s where s.created_at is not null
    union all
    select 'payment_paid', '결제 완료', p.paid_at, coalesce(p.plan_type,'')
      from public.payment_orders p where p.status='paid' and p.refunded_at is null and p.paid_at is not null
    union all
    select 'settlement', '정산 생성', st.created_at, coalesce(st.artist_email,'')
      from public.artist_settlements st where st.created_at is not null
    union all
    select 'store_created', '매장 생성', fs.created_at, coalesce(fs.store_name,'')
      from public.franchise_stores fs where fs.created_at is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'label', label, 'at', at, 'ref', ref) order by at desc), '[]'::jsonb)
  into v_result
  from (select * from ev order by at desc limit v_limit) q;

  return jsonb_build_object('items', v_result, 'limit', v_limit, 'generated_at', now());
end;
$$;

grant execute on function public.admin_mission_feed(int) to authenticated;
