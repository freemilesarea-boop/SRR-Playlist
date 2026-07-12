-- ============================================
-- 0473_admin_member_funnel.sql
--
-- Phase ADMIN-MEMBER-FUNNEL-1 — Member Conversion Funnel Intelligence.
--
-- PR #362(스냅샷) · #363(성장) 위에 이어, 회원이 방문→가입→인증→로그인→프로필→
-- 첫 재생→무료→유료→사업자→매장→Player→Streaming 중 어디서 이탈하는지 분석하는
-- 퍼널 집계 RPC 3개를 추가한다. 기존 RPC 전부 무변경. 읽기 전용 집계.
-- Player/Queue/Playback/Scheduler/정산/음원 데이터 무변경.
--
-- ── 절대 원칙: 실제 존재하는 데이터만 사용, 없는 데이터는 추정 금지 ──────────
--   각 step 은 실제 컬럼/테이블에 근거하며, 회원(user) 단위로 매핑되지 않는
--   step 은 supported=false 로 명시하고 count 를 내지 않는다(추정 금지).
--
-- ── 데이터 근거 (프로덕션 read-only 확인) ──────────────────────────────────
--   회원가입    = public.users, role<>'admin' (created_at)
--   이메일 인증 = auth.users.email_confirmed_at is not null
--   첫 로그인   = auth.users.last_sign_in_at is not null  (최초 시각 컬럼은 없어
--                 "1회 이상 로그인" 여부로 근사 — first-login 타임스탬프 미보유)
--   프로필 완료 = users.signup_completed = true (온보딩 완료 = 무료 이용 가능)
--   첫 음악 재생= public.stream_events 에 user_id 존재 (참여 지표)
--   유료 결제   = 활성 유료 구독(subscriptions.status in active/cancel_scheduled)
--                 = #362 유료 정의와 동일
--   사업자 등록 = account_type='business'
--   매장 생성   = business_profiles.user_id 존재(store_name 보유)
--   Player 연결 = brand_player_sessions — user_id 가 회원 계정과 매핑되지 않음
--                 (회원 매칭 0) → 회원 grain 미지원(supported=false)
--   Streaming   = stream_sessions_v2 — 개인 청취 세션 혼재로 "매장 스트리밍"
--                 회원 grain 을 정확히 분리 불가 → 미지원(supported=false)
--   아티스트    : 승인 artist_profiles.approval_status='approved',
--                 업로드 tracks.owner_user_id, QC tracks metadata+audio review
--                 'approved', 유통 tracks.release_status='released',
--                 정산 artist_settlements.artist_user_id
--   일반 장기유지 / Revenue 3·6·12개월 유지: 유지 코호트 이력 테이블 부재 → 미지원
--
-- ── 시간대 ─────────────────────────────────────────────────────────────────
--   코호트 기간 필터는 가입 시각(users.created_at) 기준. 오늘/이번달 등 캘린더
--   경계는 KST(Asia/Seoul). 최근 7/30/90일은 now()-interval rolling. (0472 동일)
--
-- ── 정합성 ─────────────────────────────────────────────────────────────────
--   conv/drop/monotonic 검증은 프론트(순수 함수)에서 재계산 — 여기서는 각 step
--   raw count + supported flag 만 반환한다. 전환율 0~100 clamp, NaN/Infinity
--   방지는 프론트 책임. RPC 는 앞단계≥뒷단계 를 보장하지 않으며(실데이터가
--   비단조일 수 있음), 프론트가 비단조 구간을 경고로 표시한다.
-- ============================================

-- 관리자 가드는 0472 의 _admin_growth_guard() 재사용.

-- 코호트 기간 → [start,end] 계산 헬퍼 성격의 로직은 각 함수 안에 인라인.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) admin_member_funnel(p_range) — 전체 회원 퍼널 (코호트 기간 필터).
--    p_range: 'all'|'today'|'7d'|'30d'|'90d'|'12m'. 그 외 → 예외.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_member_funnel(p_range text default 'all')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_start timestamptz;   -- null = 전체
  v_steps jsonb;
  v_engagement jsonb;
  v_total bigint;
begin
  perform public._admin_growth_guard();

  if p_range = 'all' then
    v_start := null;
  elsif p_range = 'today' then
    v_start := (v_today::timestamp at time zone 'Asia/Seoul');
  elsif p_range = '7d' then
    v_start := now() - interval '7 days';
  elsif p_range = '30d' then
    v_start := now() - interval '30 days';
  elsif p_range = '90d' then
    v_start := now() - interval '90 days';
  elsif p_range = '12m' then
    v_start := now() - interval '12 months';
  else
    raise exception 'invalid range: %, allowed: all|today|7d|30d|90d|12m', p_range
      using errcode = '22023';
  end if;

  with m as (
    select
      u.id,
      u.account_type,
      u.signup_completed,
      u.withdrawn_at,
      au.email_confirmed_at,
      au.last_sign_in_at,
      exists (select 1 from public.subscriptions s
              where s.user_id = u.id and s.status in ('active','cancel_scheduled')) as paid,
      exists (select 1 from public.stream_events se where se.user_id = u.id) as played,
      exists (select 1 from public.business_profiles bp where bp.user_id = u.id) as has_store
    from public.users u
    left join auth.users au on au.id = u.id
    where coalesce(u.role,'user') <> 'admin'
      and (v_start is null or u.created_at >= v_start)
  ),
  agg as (
    select
      count(*)                                                          as signup,
      count(*) filter (where email_confirmed_at is not null)            as email,
      count(*) filter (where last_sign_in_at is not null)               as login,
      count(*) filter (where signup_completed is true)                  as profile,
      count(*) filter (where played)                                    as first_play,
      count(*) filter (where paid)                                      as paid,
      count(*) filter (where account_type = 'business')                 as business,
      count(*) filter (where has_store)                                 as store
    from m
  )
  -- 메인 체인(획득→수익화)은 회원당 subset 이 성립해 단조(내림차순)이다.
  -- 첫 음악 재생/Player/Streaming 은 회원당 subset 이 아니거나(참여 지표) 회원
  -- grain 데이터가 없어(미지원) 메인 전환 체인에서 분리하여 engagement 로 반환한다
  -- → 메인 퍼널의 전환율 clamp(>100%) 왜곡 방지. (실데이터: 유료 68 > 첫재생 49)
  select
    (select signup from agg),
    jsonb_build_array(
      jsonb_build_object('key','signup',   'label','회원가입',    'count',(select signup   from agg),'supported',true),
      jsonb_build_object('key','email',    'label','이메일 인증', 'count',(select email    from agg),'supported',true),
      jsonb_build_object('key','login',    'label','첫 로그인',   'count',(select login    from agg),'supported',true,'note','1회 이상 로그인(최초 시각 미보유)'),
      jsonb_build_object('key','profile',  'label','무료 이용',   'count',(select profile  from agg),'supported',true,'note','signup_completed = 온보딩/무료 이용'),
      jsonb_build_object('key','paid',     'label','유료 결제',   'count',(select paid     from agg),'supported',true),
      jsonb_build_object('key','business', 'label','사업자 등록', 'count',(select business from agg),'supported',true),
      jsonb_build_object('key','store',    'label','매장 생성',   'count',(select store    from agg),'supported',true,'note','business_profiles')
    ),
    jsonb_build_array(
      jsonb_build_object('key','first_play','label','첫 음악 재생', 'count',(select first_play from agg),'supported',true,'note','참여 지표 — 아티스트/사업자는 낮을 수 있음(subset 아님)'),
      jsonb_build_object('key','player',    'label','Player 연결',  'count',null,'supported',false,'note','brand_player_sessions 가 회원 계정과 매핑되지 않음(회원 grain 미지원)'),
      jsonb_build_object('key','streaming', 'label','Streaming 시작','count',null,'supported',false,'note','개인 청취 세션 혼재로 매장 스트리밍 회원 분리 불가')
    )
  into v_total, v_steps, v_engagement;

  return jsonb_build_object(
    'range', p_range,
    'cohort_total', v_total,
    'steps', v_steps,
    'engagement', v_engagement,
    'generated_at', now()
  );
end;
$$;

grant execute on function public.admin_member_funnel(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) admin_member_funnel_breakdown() — 회원 유형별 퍼널 + Revenue 퍼널 (전체).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_member_funnel_breakdown()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_artist jsonb; v_business jsonb; v_general jsonb; v_revenue jsonb;
begin
  perform public._admin_growth_guard();

  -- 아티스트: 가입 → 승인 → 첫 업로드 → QC 통과 → 유통 → 첫 정산
  with a as (
    select u.id from public.users u
    where coalesce(u.role,'user') <> 'admin' and u.account_type = 'artist'
  )
  select jsonb_build_array(
    jsonb_build_object('key','signup',  'label','가입',        'count',(select count(*) from a),'supported',true),
    jsonb_build_object('key','approved','label','승인',        'count',(select count(distinct ap.user_id) from public.artist_profiles ap join a on a.id=ap.user_id where ap.approval_status='approved'),'supported',true),
    jsonb_build_object('key','upload',  'label','첫 음원 업로드','count',(select count(distinct t.owner_user_id) from public.tracks t join a on a.id=t.owner_user_id),'supported',true),
    jsonb_build_object('key','qc',      'label','QC 통과',      'count',(select count(distinct t.owner_user_id) from public.tracks t join a on a.id=t.owner_user_id where t.metadata_review_status='approved' and t.audio_review_status='approved'),'supported',true),
    jsonb_build_object('key','released','label','유통',        'count',(select count(distinct t.owner_user_id) from public.tracks t join a on a.id=t.owner_user_id where t.release_status='released'),'supported',true),
    jsonb_build_object('key','settled', 'label','첫 정산',     'count',(select count(distinct s.artist_user_id) from public.artist_settlements s join a on a.id=s.artist_user_id),'supported',true)
  ) into v_artist;

  -- 사업자: 가입 → 매장 생성 → (계약/Player/Streaming 미지원)
  with b as (
    select u.id from public.users u
    where coalesce(u.role,'user') <> 'admin' and u.account_type = 'business'
  )
  select jsonb_build_array(
    jsonb_build_object('key','signup','label','가입',      'count',(select count(*) from b),'supported',true),
    jsonb_build_object('key','store', 'label','매장 생성', 'count',(select count(distinct bp.user_id) from public.business_profiles bp join b on b.id=bp.user_id),'supported',true,'note','business_profiles'),
    jsonb_build_object('key','contract','label','계약',    'count',null,'supported',false,'note','사업자 계약 이력 테이블 부재(contract_status=not_created)'),
    jsonb_build_object('key','player','label','Player 연결','count',null,'supported',false,'note','회원 grain 미지원'),
    jsonb_build_object('key','streaming','label','첫 재생','count',null,'supported',false,'note','매장 스트리밍 회원 분리 불가')
  ) into v_business;

  -- 일반: 가입 → 무료(활성) → 유료 → 장기유지(미지원)
  with g as (
    select u.id, u.withdrawn_at, u.disabled_at,
      exists (select 1 from public.subscriptions s where s.user_id=u.id and s.status in ('active','cancel_scheduled')) as paid
    from public.users u
    where coalesce(u.role,'user') <> 'admin' and coalesce(u.account_type,'') not in ('artist','business')
  )
  select jsonb_build_array(
    jsonb_build_object('key','signup','label','가입',      'count',(select count(*) from g),'supported',true),
    jsonb_build_object('key','free',  'label','무료 이용', 'count',(select count(*) from g where withdrawn_at is null and disabled_at is null),'supported',true,'note','활성(비탈퇴)'),
    jsonb_build_object('key','paid',  'label','유료 결제', 'count',(select count(*) from g where paid),'supported',true),
    jsonb_build_object('key','retain','label','장기 유지', 'count',null,'supported',false,'note','유지 코호트 이력 부재')
  ) into v_general;

  -- Revenue: 무료(전체) → 결제 시도 → 결제 성공 → 구독 유지 → 3/6/12개월 유지(미지원)
  with r as (
    select u.id,
      exists (select 1 from public.payment_orders po where po.user_id=u.id) as attempted,
      exists (select 1 from public.payment_orders po where po.user_id=u.id and (po.status='paid' or po.paid_at is not null)) as succeeded,
      exists (select 1 from public.subscriptions s where s.user_id=u.id and s.status in ('active','cancel_scheduled')) as active_sub
    from public.users u where coalesce(u.role,'user') <> 'admin'
  )
  select jsonb_build_array(
    jsonb_build_object('key','free',    'label','무료',       'count',(select count(*) from r),'supported',true,'note','전체 유효 회원(모두 무료로 시작)'),
    jsonb_build_object('key','attempt', 'label','결제 시도',  'count',(select count(*) from r where attempted),'supported',true,'note','payment_orders 존재'),
    jsonb_build_object('key','success', 'label','결제 성공',  'count',(select count(*) from r where succeeded),'supported',true,'note','paid 결제 이력'),
    jsonb_build_object('key','retained','label','구독 유지',  'count',(select count(*) from r where active_sub),'supported',true,'note','현재 활성 구독'),
    jsonb_build_object('key','m3','label','3개월 유지','count',null,'supported',false,'note','유지 이력 부재'),
    jsonb_build_object('key','m6','label','6개월 유지','count',null,'supported',false,'note','유지 이력 부재'),
    jsonb_build_object('key','m12','label','12개월 유지','count',null,'supported',false,'note','유지 이력 부재')
  ) into v_revenue;

  return jsonb_build_object(
    'segments', jsonb_build_object('artist', v_artist, 'business', v_business, 'general', v_general),
    'revenue', v_revenue,
    'generated_at', now()
  );
end;
$$;

grant execute on function public.admin_member_funnel_breakdown() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) admin_member_funnel_history() — 이번달 vs 지난달 코호트 퍼널(각 step count).
--    프론트가 step 별 전환율/증감(delta)을 계산한다.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_member_funnel_history()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_this_start date := date_trunc('month', (now() at time zone 'Asia/Seoul')::date)::date;
  v_prev_start date := (date_trunc('month', (now() at time zone 'Asia/Seoul')::date) - interval '1 month')::date;
  v_steps jsonb;
begin
  perform public._admin_growth_guard();

  with m as (
    select
      u.id,
      (u.created_at at time zone 'Asia/Seoul')::date as kst_day,
      u.signup_completed,
      au.email_confirmed_at,
      au.last_sign_in_at,
      exists (select 1 from public.subscriptions s where s.user_id=u.id and s.status in ('active','cancel_scheduled')) as paid
    from public.users u
    left join auth.users au on au.id = u.id
    where coalesce(u.role,'user') <> 'admin'
      and (u.created_at at time zone 'Asia/Seoul')::date >= v_prev_start
  ),
  bucketed as (
    select
      case when kst_day >= v_this_start then 'this' else 'prev' end as period,
      email_confirmed_at is not null as email,
      last_sign_in_at is not null as login,
      signup_completed is true as profile,
      paid
    from m
  )
  select jsonb_build_array(
    jsonb_build_object('key','signup', 'label','회원가입',
      'this', count(*) filter (where period='this'),
      'prev', count(*) filter (where period='prev')),
    jsonb_build_object('key','email', 'label','이메일 인증',
      'this', count(*) filter (where period='this' and email),
      'prev', count(*) filter (where period='prev' and email)),
    jsonb_build_object('key','login', 'label','첫 로그인',
      'this', count(*) filter (where period='this' and login),
      'prev', count(*) filter (where period='prev' and login)),
    jsonb_build_object('key','profile', 'label','무료 이용',
      'this', count(*) filter (where period='this' and profile),
      'prev', count(*) filter (where period='prev' and profile)),
    jsonb_build_object('key','paid', 'label','유료 결제',
      'this', count(*) filter (where period='this' and paid),
      'prev', count(*) filter (where period='prev' and paid))
  ) into v_steps
  from bucketed;

  return jsonb_build_object(
    'this_month_start', v_this_start,
    'prev_month_start', v_prev_start,
    'steps', v_steps,
    'generated_at', now()
  );
end;
$$;

grant execute on function public.admin_member_funnel_history() to authenticated;
