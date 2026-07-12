-- ============================================
-- 0476_admin_business_intel.sql
--
-- Phase ADMIN-BUSINESS-1 — Business Intelligence Dashboard 집계 RPC 5개.
--
-- PR #362~#366 위에 이어, 사업자/브랜드/매장/Player/계약/운영 Lifecycle 을 실제
-- 운영 데이터로 분석한다. 기존 Player/계약/스트리밍/Member/Revenue/Artist RPC 전부
-- 무변경(신규 이름). 읽기 전용 집계. Business/Store/Player 데이터 수정 없음.
--
-- ── 실제 Business 데이터 모델 (프로덕션 read-only 확인) ───────────────────
--   users account_type='business'(3): 사업자 계정.
--   business_profiles(3): user_id·store_name·business_type·open/close_time (개별 매장).
--   franchises(1, active) · brand_accounts(1, active) · enterprise_accounts(1)
--     · enterprise_brand_registry(1: default_monthly_fee=4900) : 브랜드/본사 계층.
--   franchise_stores(5, active): franchise_id·store_id·region_id (브랜드 소속 매장).
--   brand_player_sessions(5): brand_id·user_id·current_track_id·playback_started_at
--     ·last_seen_at (Player 세션 = heartbeat). 온라인 판정 = last_seen_at >= now()-5분.
--
-- ── 데이터 관측 (중요) ─────────────────────────────────────────────────────
--   사업자 계정(3)과 franchise/brand/player 계층(1 브랜드·5 매장·5 Player)은 사실상
--   분리되어 있다(franchise_stores.store_id 중 business 계정 0 · player 세션은 전부
--   비-business 1명). 프랜차이즈 모델 특성상 "브랜드 1 < 매장 5"가 성립하므로 총
--   사업자 ≥ 브랜드 ≥ 매장 ≥ Player 계층 가정을 강제하지 않는다(프론트에서 caveat).
--   모든 Player 는 최근 접속이 2일 전이라 온라인(≤5분) 0 · 오프라인 5.
--
-- ── 시간대 ─── 오늘/이번달 경계 KST(Asia/Seoul), 최근 N일 rolling. (0472 동일)
--
-- ── 미지원 (추정 금지 → "데이터 없음") ─────────────────────────────────────
--   Player Recovery · Heartbeat History(테이블 부재; last_seen 스냅샷만) · Store Health
--   · Streaming Quality/Buffer/Skip/Error(playback_events_v2 에 품질 컬럼 없음) ·
--   Queue Delay · Crossfade 오류 · Business AI Score · 국가별 · 사업자 계약 이력
--   (business 계약 테이블 부재) · 24시간 운영/계약 갱신 이력.
--   지원(부분): 지역별(franchise_stores.region_id·enterprise_regions) · 월 요금(등록 기본값).
--
-- ── 정합성 ─── 퍼널 전환율 0~100, Health 0~100. raw count + supported flag 만 반환하고
--   비율/Health/정합성 검증은 프론트 순수함수(businessIntel.ts)가 담당.
-- ============================================

-- 관리자 가드는 0472 의 _admin_growth_guard() 재사용.
-- 온라인 판정 임계(분). 세션 last_seen 기반.
-- (상수는 RPC 안에 인라인)

-- ─────────────────────────────────────────────────────────────────────────
-- 1) admin_business_summary() — Business KPI.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_business_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_month date := date_trunc('month', v_today)::date;
  v_online_cutoff timestamptz := now() - interval '5 minutes';
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  with biz as (select id, created_at from public.users where account_type = 'business')
  select jsonb_build_object(
    -- 사업자
    'total_business', (select count(*) from biz),
    'today_signups', (select count(*) from biz where (created_at at time zone 'Asia/Seoul')::date = v_today),
    'month_signups', (select count(*) from biz where (created_at at time zone 'Asia/Seoul')::date >= v_month),
    'active_business', (select count(*) from biz b join public.users u on u.id=b.id where u.withdrawn_at is null and u.disabled_at is null
                        and exists (select 1 from public.subscriptions s where s.user_id=b.id and s.status in ('active','cancel_scheduled'))),
    'inactive_business', (select count(*) from biz b where not exists (select 1 from public.subscriptions s where s.user_id=b.id and s.status in ('active','cancel_scheduled'))),
    -- 계약: 전용 계약 테이블 부재 → 요금 등록 기본값만 노출
    'contract_supported', false,
    'monthly_fee_default', (select coalesce(max(default_monthly_fee),0) from public.enterprise_brand_registry),
    -- 브랜드
    'total_brands', (select count(*) from public.brand_accounts where deleted_at is null),
    'active_brands', (select count(*) from public.brand_accounts where deleted_at is null and status='active'),
    'total_franchises', (select count(*) from public.franchises),
    'total_enterprises', (select count(*) from public.enterprise_accounts where deleted_at is null),
    -- 매장
    'total_stores', (select count(*) from public.franchise_stores),
    'business_stores', (select count(*) from public.business_profiles),
    'today_new_stores', (select count(*) from public.franchise_stores where (created_at at time zone 'Asia/Seoul')::date = v_today),
    'month_new_stores', (select count(*) from public.franchise_stores where (created_at at time zone 'Asia/Seoul')::date >= v_month),
    -- Player
    'total_players', (select count(*) from public.brand_player_sessions),
    'online_players', (select count(*) from public.brand_player_sessions where last_seen_at >= v_online_cutoff),
    'offline_players', (select count(*) from public.brand_player_sessions where last_seen_at is null or last_seen_at < v_online_cutoff),
    'heartbeat_players', (select count(*) from public.brand_player_sessions where last_seen_at is not null),
    'playing_players', (select count(*) from public.brand_player_sessions where current_track_id is not null),
    'today_new_players', (select count(*) from public.brand_player_sessions where (created_at at time zone 'Asia/Seoul')::date = v_today),
    'online_cutoff_minutes', 5,
    'generated_at', now()
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.admin_business_summary() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) admin_business_funnel() — 사업자 계정 Lifecycle 퍼널 (raw count + supported).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_business_funnel()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_result jsonb;
begin
  perform public._admin_growth_guard();

  with biz as (select id from public.users where account_type='business')
  select jsonb_build_object(
    'steps', jsonb_build_array(
      jsonb_build_object('key','signup',   'label','사업자 가입', 'count',(select count(*) from biz),'supported',true),
      jsonb_build_object('key','contract', 'label','계약',        'count',null,'supported',false,'note','사업자 계약 이력 테이블 부재'),
      jsonb_build_object('key','brand',    'label','브랜드 생성', 'count',null,'supported',false,'note','브랜드가 사업자 계정과 연결되지 않음'),
      jsonb_build_object('key','store',    'label','매장 생성',   'count',(select count(distinct bp.user_id) from public.business_profiles bp join biz on biz.id=bp.user_id),'supported',true,'note','business_profiles'),
      jsonb_build_object('key','player',   'label','Player 연결', 'count',(select count(distinct bps.user_id) from public.brand_player_sessions bps join biz on biz.id=bps.user_id),'supported',true),
      jsonb_build_object('key','play',     'label','첫 음악 재생','count',(select count(distinct se.user_id) from public.stream_events se join biz on biz.id=se.user_id),'supported',true),
      jsonb_build_object('key','uptime',   'label','24시간 정상 운영','count',null,'supported',false,'note','운영 uptime 이력 부재'),
      jsonb_build_object('key','retain',   'label','구독 유지',   'count',(select count(distinct s.user_id) from public.subscriptions s join biz on biz.id=s.user_id where s.status in ('active','cancel_scheduled')),'supported',true),
      jsonb_build_object('key','renew',    'label','계약 갱신',   'count',null,'supported',false,'note','계약 갱신 이력 부재')
    ),
    'generated_at', now()
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.admin_business_funnel() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) admin_business_growth(p_range) — 시계열 (사업자/브랜드/매장/Player/계약).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_business_growth(p_range text default '30d')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_unit text; v_start date; v_end date; v_result jsonb;
begin
  perform public._admin_growth_guard();

  if p_range='7d' then      v_unit:='day';   v_start:=v_today-6;  v_end:=v_today;
  elsif p_range='30d' then  v_unit:='day';   v_start:=v_today-29; v_end:=v_today;
  elsif p_range='90d' then  v_unit:='day';   v_start:=v_today-89; v_end:=v_today;
  elsif p_range='12m' then  v_unit:='month';
    v_start:=(date_trunc('month',v_today)-interval '11 months')::date; v_end:=date_trunc('month',v_today)::date;
  else raise exception 'invalid range: %, allowed: 7d|30d|90d|12m', p_range using errcode='22023';
  end if;

  with cal as (
    select case when v_unit='day' then gs::date else date_trunc('month',gs)::date end bucket
    from generate_series(v_start::timestamp, v_end::timestamp, case when v_unit='day' then interval '1 day' else interval '1 month' end) gs
  ),
  b(ts, kind) as (
    select created_at, 'business' from public.users where account_type='business'
    union all select created_at, 'brand' from public.brand_accounts where deleted_at is null
    union all select created_at, 'store' from public.franchise_stores
    union all select created_at, 'player' from public.brand_player_sessions
  ),
  bk as (
    select case when v_unit='day' then (ts at time zone 'Asia/Seoul')::date
                else date_trunc('month',(ts at time zone 'Asia/Seoul')::date)::date end bucket, kind
    from b where ts is not null and (ts at time zone 'Asia/Seoul')::date >= v_start
  ),
  agg as (
    select bucket,
      count(*) filter (where kind='business') new_business,
      count(*) filter (where kind='brand')    new_brands,
      count(*) filter (where kind='store')    new_stores,
      count(*) filter (where kind='player')   new_players
    from bk group by bucket
  )
  select jsonb_build_object(
    'range', p_range, 'unit', v_unit, 'start', v_start, 'end', v_end,
    'points', coalesce(jsonb_agg(jsonb_build_object(
      'bucket', c.bucket,
      'new_business', coalesce(a.new_business,0), 'new_brands', coalesce(a.new_brands,0),
      'new_stores', coalesce(a.new_stores,0), 'new_players', coalesce(a.new_players,0)
    ) order by c.bucket), '[]'::jsonb),
    'generated_at', now()
  ) into v_result
  from cal c left join agg a on a.bucket=c.bucket;

  return v_result;
end;
$$;

grant execute on function public.admin_business_growth(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) admin_business_health() — 운영 Health 컴포넌트 (실데이터 신호만).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_business_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_online_cutoff timestamptz := now() - interval '5 minutes';
  v_players int;
  v_online int;
  v_heartbeat int;
  v_playing int;
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select count(*), count(*) filter (where last_seen_at >= v_online_cutoff),
         count(*) filter (where last_seen_at is not null), count(*) filter (where current_track_id is not null)
    into v_players, v_online, v_heartbeat, v_playing
  from public.brand_player_sessions;

  v_result := jsonb_build_object(
    -- 사용 가능한 신호(각 0~100). 프론트가 available 만 평균내어 Health(0~100) 산출.
    'components', jsonb_build_array(
      jsonb_build_object('key','player_online', 'label','Player 온라인율',
        'score', case when v_players>0 then round(v_online::numeric/v_players*100) else null end,
        'available', v_players>0, 'detail', v_online || '/' || v_players),
      jsonb_build_object('key','heartbeat', 'label','Heartbeat 수신율',
        'score', case when v_players>0 then round(v_heartbeat::numeric/v_players*100) else null end,
        'available', v_players>0, 'detail', v_heartbeat || '/' || v_players),
      jsonb_build_object('key','streaming', 'label','재생 활성율',
        'score', case when v_players>0 then round(v_playing::numeric/v_players*100) else null end,
        'available', v_players>0, 'detail', v_playing || '/' || v_players)
    ),
    -- 데이터 부재로 Health 계산에서 제외되는 신호(추정 금지).
    'excluded', jsonb_build_array('Playback Error','Buffer','Queue Delay','Recovery','Crossfade','Streaming Quality'),
    'players', v_players,
    'generated_at', now()
  );

  return v_result;
end;
$$;

grant execute on function public.admin_business_health() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) admin_business_rankings() — TOP 브랜드/매장/Player + 지원 매트릭스.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_business_rankings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_result jsonb;
begin
  perform public._admin_growth_guard();

  select jsonb_build_object(
    -- 브랜드별 매장 수
    'top_brand_stores', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'value', c) order by c desc),'[]'::jsonb)
      from (select coalesce(f.name,'(미지정)') name, count(fs.id) c
            from public.franchise_stores fs left join public.franchises f on f.id=fs.franchise_id
            group by 1 order by c desc limit 10) q),
    -- 브랜드별 Player 수
    'top_brand_players', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'value', c) order by c desc),'[]'::jsonb)
      from (select coalesce(ba.name, bps.brand_id::text,'(미지정)') name, count(*) c
            from public.brand_player_sessions bps left join public.brand_accounts ba on ba.id=bps.brand_id
            group by 1 order by c desc limit 10) q),
    -- 최근 접속 Player (last_seen)
    'recent_players', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(ba.name,'(브랜드 미지정)'), 'last_seen', last_seen_at) order by last_seen_at desc nulls last),'[]'::jsonb)
      from (select brand_id, last_seen_at from public.brand_player_sessions order by last_seen_at desc nulls last limit 10) bps
      left join public.brand_accounts ba on ba.id=bps.brand_id),
    -- 지원 여부 매트릭스
    'support', jsonb_build_object(
      'player_recovery', false, 'heartbeat_history', false, 'store_health', false,
      'streaming_quality', false, 'playback_error', false, 'queue_delay', false,
      'crossfade', false, 'business_ai_score', false, 'region', true, 'country', false
    ),
    'generated_at', now()
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.admin_business_rankings() to authenticated;
