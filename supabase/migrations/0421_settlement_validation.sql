-- 0421 — Phase ALGO-3B: Settlement v2 Validation & Cutover Readiness
--
-- 목적:
--   Settlement v1 vs v2 를 다각도로 비교하여 v2 를 실제 지급 엔진으로 전환할
--   준비가 되었는지(Cutover Readiness) 검증한다. 분석 전용 — 실제 지급/정산 무변경.
--
-- 절대 원칙:
--   • v1 무변경: admin_generate_monthly_settlement / artist_settlements / settlement_items /
--     streaming_revenues / settlement_generation_runs / 지급 UI 전부 그대로.
--   • additive only — 신규 read-only 분석 RPC 만. 기존 테이블/함수 drop·rename·alter 없음.
--   • v2 는 실제 payout 에 사용 금지. 관측·비교·설명(Explain/AI)만.
--   • Readiness Score ≥ 98 이 3개월 연속일 때만 ALGO-4 에서 Cutover 검토.
--
-- 산출 RPC:
--   admin_settlement_validation       — 강화 비교(전 지표 + Difference + % + Reason)
--   admin_settlement_readiness        — Settlement Readiness Score 0~100 + 컴포넌트
--   admin_settlement_difference_ai    — AI Summary(사유별 %) + 12개월 Trend
--   admin_settlement_artist_compare   — Artist 별 비교
--   admin_settlement_track_compare    — Track 별 비교
--   admin_settlement_store_compare    — Store 별 비교(v2 shadow attribution)
--   admin_settlement_brand_compare    — Brand 별 비교
--   (+ 내부 helper _settlement_diff_classify — Difference Classifier)

-- ─────────────────────────────────────────────────────────────────────
-- 0. 공통: 월별 v1 / v2 집계 helper (read-only, 저장 테이블만 조회)
--    v1 money = 저장된 artist_settlements (권위). v1 pool/streams = 최신 v1 run.
--    v2 = 해당 월/소스 최신 run 의 v2 테이블.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._settlement_v1_agg(p_month date)
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  with money as (
    select
      count(distinct a.artist_user_id)               as artist_count,
      coalesce(sum(a.gross_settlement_amount),0)::bigint as gross,
      coalesce(sum(a.company_fee_amount),0)::bigint   as company_fee,
      coalesce(sum(a.sales_agent_fee_amount),0)::bigint as agent_fee,
      coalesce(sum(a.artist_net_settlement),0)::bigint as net,
      coalesce(sum(a.previous_carried_amount),0)::bigint as carry_in,
      coalesce(sum(a.carried_over_amount),0)::bigint  as carried_over,
      coalesce(sum(a.withholding_tax_amount),0)::bigint as tax,
      coalesce(sum(a.final_payout_amount),0)::bigint  as final
    from public.artist_settlements a
    where a.settlement_month = p_month
  ),
  items as (
    select
      count(distinct si.track_id)                      as track_count,
      coalesce(sum(si.eligible_stream_count),0)::bigint as eligible_streams,
      coalesce(sum(si.excluded_stream_count),0)::bigint as rejected_streams
    from public.settlement_items si
    join public.artist_settlements a on a.id = si.settlement_id
    where a.settlement_month = p_month
  ),
  run as (  -- 최신 v1 run (non-dry 우선) → pool/platform/streams 메타
    select platform_revenue, pool_revenue, total_pool_streams, policy_id
    from public.settlement_generation_runs
    where settlement_month = p_month
    order by dry_run asc, run_at desc
    limit 1
  ),
  brands as (  -- v1_basis 브랜드 귀속: stream_events → brand_playlists.brand_id
    select count(distinct bp.brand_id) as brand_count
    from public.stream_events se
    join public.brand_playlists bp on bp.id = se.playlist_id
    where se.event_type='milestone_30s' and se.is_effective and se.eligible_for_payout
      and se.created_at >= (p_month::timestamp at time zone 'Asia/Seoul')
      and se.created_at <  ((p_month + interval '1 month')::timestamp at time zone 'Asia/Seoul')
  )
  select jsonb_build_object(
    'revenue_pool',     coalesce((select pool_revenue from run),0),
    'platform_revenue', coalesce((select platform_revenue from run),0),
    'eligible_streams', (select eligible_streams from items),
    'verified_streams', coalesce((select total_pool_streams from run),(select eligible_streams from items)),
    'revenue_weight',   (select eligible_streams from items),   -- v1: weight == eligible (계수 1)
    'gross',            (select gross from money),
    'company_fee',      (select company_fee from money),
    'agent_fee',        (select agent_fee from money),
    'carry_in',         (select carry_in from money),
    'carried_over',     (select carried_over from money),
    'tax',              (select tax from money),
    'net',              (select net from money),
    'final',            (select final from money),
    'artist_count',     (select artist_count from money),
    'track_count',      (select track_count from items),
    'store_count',      0,
    'brand_count',      coalesce((select brand_count from brands),0),
    'rejected_count',   (select rejected_streams from items),
    'fraud_count',      0,
    'policy_id',        (select policy_id from run),
    'version',          null::int
  );
$$;

create or replace function public._settlement_v2_agg(p_month date, p_source text default 'v1_basis')
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_run public.settlement_generation_runs_v2%rowtype; v jsonb;
begin
  select * into v_run from public.settlement_generation_runs_v2
    where settlement_month = p_month and stream_source = coalesce(p_source,'v1_basis')
    order by version desc limit 1;
  if not found then return null; end if;

  select jsonb_build_object(
    'run_id',           v_run.id,
    'revenue_pool',     coalesce(v_run.pool_revenue,0),
    'platform_revenue', coalesce(v_run.platform_revenue,0),
    'eligible_streams', coalesce(v_run.total_eligible_streams,0),
    'verified_streams', coalesce(v_run.total_verified_streams, v_run.total_eligible_streams,0),
    'revenue_weight',   coalesce(v_run.total_revenue_weight,0),
    'gross',            coalesce(v_run.total_gross,0),
    'company_fee',      coalesce(v_run.total_company_fee,0),
    'agent_fee',        coalesce(v_run.total_agent_fee,0),
    'carry_in',         (select coalesce(sum(previous_carried_amount),0) from public.artist_settlements_v2 where run_id=v_run.id),
    'carried_over',     coalesce(v_run.total_carried_over,0),
    'tax',              (select coalesce(sum(withholding_tax_amount),0) from public.artist_settlements_v2 where run_id=v_run.id),
    'net',              coalesce(v_run.total_net,0),
    'final',            coalesce(v_run.total_final,0),
    'artist_count',     coalesce(v_run.artist_count,0),
    'track_count',      (select count(distinct track_id) from public.settlement_items_v2 where run_id=v_run.id),
    'store_count',      0,
    'brand_count',      0,
    'rejected_count',   coalesce(v_run.rejected_count,0),
    'fraud_count',      coalesce(v_run.fraud_count,0),
    'policy_id',        v_run.policy_id,
    'version',          v_run.version
  ) into v;
  return v;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Difference Classifier — 총 gross 차이를 사유별로 자동 분류/분해
--    반환: { primary_reason, components{DATA_VINTAGE,NEW_STREAM,STREAMING_V2,
--            POLICY,ROUNDING,BUG,UNKNOWN}(각 KRW), pct{...}, invariants{...} }
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._settlement_diff_classify(p_month date, p_source text default 'v1_basis')
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v1 jsonb := public._settlement_v1_agg(p_month);
  v2 jsonb := public._settlement_v2_agg(p_month, p_source);
  v1_gross bigint; v2_gross bigint; total_diff bigint; abs_diff bigint;
  v1_pool bigint; v2_pool bigint; pool_diff bigint;
  v1_streams bigint; v2_streams bigint;
  v1_policy uuid; v2_policy uuid;
  c_vintage bigint:=0; c_newstream bigint:=0; c_streamingv2 bigint:=0;
  c_policy bigint:=0; c_rounding bigint:=0; c_bug bigint:=0; c_unknown bigint:=0;
  v_bug_pool boolean:=false; v_bug_neg boolean:=false;
  v_primary text; v_tol bigint; v_artist_ct int;
begin
  if v2 is null then
    return jsonb_build_object('has_v2', false, 'primary_reason','NO_V2_RUN',
      'components','{}'::jsonb, 'pct','{}'::jsonb);
  end if;
  v1_gross := (v1->>'gross')::bigint; v2_gross := (v2->>'gross')::bigint;
  v1_pool  := (v1->>'revenue_pool')::bigint; v2_pool := (v2->>'revenue_pool')::bigint;
  v1_streams := (v1->>'eligible_streams')::bigint; v2_streams := (v2->>'eligible_streams')::bigint;
  v1_policy := nullif(v1->>'policy_id','')::uuid; v2_policy := nullif(v2->>'policy_id','')::uuid;
  v_artist_ct := greatest((v2->>'artist_count')::int, 1);
  total_diff := v2_gross - v1_gross; abs_diff := abs(total_diff);

  -- invariant(BUG) 검사: v2 gross > pool, 또는 음수 금액
  if v2_gross > v2_pool then v_bug_pool := true; end if;
  if v2_gross < 0 or (v2->>'net')::bigint < 0 or (v2->>'final')::bigint < 0 then v_bug_neg := true; end if;
  if v_bug_pool or v_bug_neg then
    c_bug := abs_diff;  -- 불변식 위반 시 차이 전액 BUG 로 귀속
  else
    -- pool(매출) 변화 → DATA_VINTAGE. p_source 별로 STREAMING_V2 분리.
    pool_diff := v2_pool - v1_pool;
    if p_source = 'v2_shadow' then
      -- 스트림 파이프라인(v2) 차이가 pool 산정과 무관하게 eligible 을 바꾼 부분
      c_streamingv2 := least(abs(pool_diff), abs_diff);
    else
      c_vintage := least(abs(pool_diff), abs_diff);
    end if;
    -- 스트림 수 증가분(총 gross 재분배가 아닌 신규 유입) → NEW_STREAM (설명 보조 지표)
    if v2_streams <> v1_streams and c_vintage = 0 and c_streamingv2 = 0 then
      c_newstream := least(abs_diff, greatest(abs_diff,0));
    end if;
    -- 정책 변경
    if v1_policy is distinct from v2_policy then
      c_policy := greatest(abs_diff - c_vintage - c_streamingv2 - c_newstream, 0);
    end if;
    -- 잔여를 ROUNDING(허용오차 내) 또는 UNKNOWN 으로
    v_tol := v_artist_ct;  -- per-artist floor 오차 상한 ≈ 아티스트 수 (KRW)
    declare v_residual bigint := abs_diff - c_vintage - c_streamingv2 - c_newstream - c_policy;
    begin
      if v_residual < 0 then v_residual := 0; end if;
      if v_residual <= v_tol then c_rounding := v_residual;
      else c_unknown := v_residual; end if;
    end;
  end if;

  -- primary reason = 최대 컴포넌트
  select reason into v_primary from (values
    ('BUG',c_bug),('DATA_VINTAGE',c_vintage),('STREAMING_V2',c_streamingv2),
    ('NEW_STREAM',c_newstream),('POLICY',c_policy),('ROUNDING',c_rounding),('UNKNOWN',c_unknown)
  ) t(reason,amt) order by amt desc, reason limit 1;
  if abs_diff = 0 then v_primary := 'MATCH'; end if;

  return jsonb_build_object(
    'has_v2', true,
    'v1_gross', v1_gross, 'v2_gross', v2_gross, 'total_diff', total_diff, 'abs_diff', abs_diff,
    'v1_pool', v1_pool, 'v2_pool', v2_pool,
    'v1_eligible_streams', v1_streams, 'v2_eligible_streams', v2_streams,
    'primary_reason', v_primary,
    'invariants', jsonb_build_object('gross_le_pool', not v_bug_pool, 'non_negative', not v_bug_neg),
    'components', jsonb_build_object(
      'DATA_VINTAGE', c_vintage, 'NEW_STREAM', c_newstream, 'STREAMING_V2', c_streamingv2,
      'POLICY', c_policy, 'ROUNDING', c_rounding, 'BUG', c_bug, 'UNKNOWN', c_unknown),
    'pct', case when abs_diff = 0 then jsonb_build_object('MATCH',100)
      else jsonb_build_object(
        'DATA_VINTAGE', round(c_vintage::numeric/abs_diff*100,2),
        'NEW_STREAM',   round(c_newstream::numeric/abs_diff*100,2),
        'STREAMING_V2', round(c_streamingv2::numeric/abs_diff*100,2),
        'POLICY',       round(c_policy::numeric/abs_diff*100,2),
        'ROUNDING',     round(c_rounding::numeric/abs_diff*100,2),
        'BUG',          round(c_bug::numeric/abs_diff*100,2),
        'UNKNOWN',      round(c_unknown::numeric/abs_diff*100,2)) end
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. admin_settlement_validation — 강화 비교(전 지표 + diff + % + reason)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_settlement_validation(p_month date, p_stream_source text default 'v1_basis')
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v1 jsonb; v2 jsonb; cls jsonb; v_metrics jsonb; k text;
  v_keys text[] := array['revenue_pool','eligible_streams','verified_streams','revenue_weight',
    'gross','company_fee','agent_fee','carry_in','carried_over','tax','net','final',
    'artist_count','track_count','store_count','brand_count','rejected_count','fraud_count'];
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v1 := public._settlement_v1_agg(p_month);
  v2 := public._settlement_v2_agg(p_month, p_stream_source);
  cls := public._settlement_diff_classify(p_month, p_stream_source);

  if v2 is null then
    return jsonb_build_object('settlement_month', p_month, 'stream_source', p_stream_source,
      'has_v2', false, 'v1', v1, 'note','v2 shadow run 없음 — admin_generate_monthly_settlement_v2 먼저 실행');
  end if;

  v_metrics := '[]'::jsonb;
  foreach k in array v_keys loop
    declare a numeric := coalesce((v1->>k)::numeric,0); b numeric := coalesce((v2->>k)::numeric,0);
    begin
      v_metrics := v_metrics || jsonb_build_object(
        'metric', k, 'v1', a, 'v2', b, 'diff', b - a,
        'diff_pct', case when a = 0 then null else round((b-a)/a*100,2) end);
    end;
  end loop;

  return jsonb_build_object(
    'settlement_month', p_month, 'stream_source', p_stream_source, 'has_v2', true,
    'v2_run_id', v2->>'run_id', 'v2_version', (v2->>'version')::int,
    'metrics', v_metrics,
    'difference_reason', cls->>'primary_reason',
    'classification', cls);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. admin_settlement_artist_compare — Artist 별
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_settlement_artist_compare(p_month date, p_stream_source text default 'v1_basis')
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_run uuid; v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select id into v_run from public.settlement_generation_runs_v2
    where settlement_month=p_month and stream_source=coalesce(p_stream_source,'v1_basis')
    order by version desc limit 1;

  select coalesce(jsonb_agg(row order by row_abs desc), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'artist_user_id', coalesce(v1.artist_user_id, v2.artist_user_id),
      'v1_gross', coalesce(v1.g,0), 'v2_gross', coalesce(v2.gross_amount,0),
      'gross_diff', coalesce(v2.gross_amount,0)-coalesce(v1.g,0),
      'gross_diff_pct', case when coalesce(v1.g,0)=0 then null else round((coalesce(v2.gross_amount,0)-coalesce(v1.g,0))::numeric/v1.g*100,2) end,
      'eligible_stream_diff', coalesce(v2.eligible_stream_count,0)-coalesce(v1.es,0),
      'revenue_weight_diff', coalesce(v2.revenue_weight,0)-coalesce(v1.es,0),
      'carryover_diff', coalesce(v2.carried_over_amount,0)-coalesce(v1.co,0),
      'final_diff', coalesce(v2.final_amount,0)-coalesce(v1.f,0),
      'top_reason', case
        when v2.artist_user_id is null then 'V1_ONLY'
        when v1.artist_user_id is null then 'V2_ONLY_NEW_ARTIST'
        when coalesce(v2.eligible_stream_count,0) <> coalesce(v1.es,0) then 'NEW_STREAM'
        when coalesce(v2.gross_amount,0)=coalesce(v1.g,0) then 'MATCH'
        else 'DATA_VINTAGE' end) as row,
      abs(coalesce(v2.gross_amount,0)-coalesce(v1.g,0)) as row_abs
    from (
      select a.artist_user_id, a.gross_settlement_amount g, a.artist_net_settlement n,
             a.final_payout_amount f, a.carried_over_amount co,
             (select coalesce(sum(si.eligible_stream_count),0) from public.settlement_items si where si.settlement_id=a.id) es
      from public.artist_settlements a where a.settlement_month=p_month
    ) v1
    full outer join (
      select artist_user_id, gross_amount, eligible_stream_count, revenue_weight, final_amount, carried_over_amount
      from public.artist_settlements_v2 where run_id=v_run
    ) v2 on v2.artist_user_id = v1.artist_user_id
  ) s;

  return jsonb_build_object('settlement_month',p_month,'stream_source',p_stream_source,'v2_run_id',v_run,'artists',v);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. admin_settlement_track_compare — Track 별
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_settlement_track_compare(p_month date, p_stream_source text default 'v1_basis')
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_run uuid; v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select id into v_run from public.settlement_generation_runs_v2
    where settlement_month=p_month and stream_source=coalesce(p_stream_source,'v1_basis')
    order by version desc limit 1;

  select coalesce(jsonb_agg(row order by row_abs desc), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'track_id', coalesce(v1.track_id, v2.track_id),
      'track_title', coalesce(v1.track_title, v2.track_title),
      'v1_eligible_stream', coalesce(v1.eligible,0), 'v2_eligible_stream', coalesce(v2.eligible,0),
      'v1_rejected_stream', coalesce(v1.rejected,0),
      'v2_revenue_weight', coalesce(v2.weight,0),
      'v1_gross_contribution', coalesce(v1.gross,0), 'v2_gross_contribution', coalesce(v2.gross,0),
      'diff', coalesce(v2.gross,0)-coalesce(v1.gross,0),
      'diff_reason', case
        when v2.track_id is null then 'V1_ONLY'
        when v1.track_id is null then 'V2_ONLY_NEW_TRACK'
        when coalesce(v2.eligible,0) <> coalesce(v1.eligible,0) then 'NEW_STREAM'
        when coalesce(v2.gross,0)=coalesce(v1.gross,0) then 'MATCH'
        else 'DATA_VINTAGE' end) as row,
      abs(coalesce(v2.gross,0)-coalesce(v1.gross,0)) as row_abs
    from (
      select si.track_id, si.track_title,
             sum(si.eligible_stream_count)::bigint eligible,
             sum(si.excluded_stream_count)::bigint rejected,
             sum(si.pool_revenue_share)::bigint gross
      from public.settlement_items si
      join public.artist_settlements a on a.id=si.settlement_id
      where a.settlement_month=p_month group by si.track_id, si.track_title
    ) v1
    full outer join (
      select track_id, max(track_title) track_title,
             sum(eligible_stream_count)::bigint eligible,
             sum(revenue_weight)::numeric weight,
             sum(pool_revenue_share)::bigint gross
      from public.settlement_items_v2 where run_id=v_run group by track_id
    ) v2 on v2.track_id = v1.track_id
  ) s;

  return jsonb_build_object('settlement_month',p_month,'stream_source',p_stream_source,'v2_run_id',v_run,'tracks',v);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. admin_settlement_store_compare — Store 별 (v2 shadow attribution)
--    store_id 는 v2 스트림 파이프라인에만 존재 → shadow 데이터 기반.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_settlement_store_compare(p_month date)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v jsonb; v_start timestamptz; v_end timestamptz; v_has boolean;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_start := (p_month::timestamp at time zone 'Asia/Seoul');
  v_end   := ((p_month + interval '1 month')::timestamp at time zone 'Asia/Seoul');
  select exists(select 1 from public.v2_eligible_streams where created_at>=v_start and created_at<v_end) into v_has;

  select coalesce(jsonb_agg(row order by eligible desc), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'store_id', st.store_id,
      'enterprise_account_id', st.enterprise_account_id,
      'eligible', st.eligible,
      'rejected', st.rejected,
      'revenue_weight', st.eligible,           -- 계수 1 → weight == eligible
      'health_score', case when (st.eligible+st.rejected)=0 then null
                           else round(st.eligible::numeric/(st.eligible+st.rejected)*100,1) end,
      'fraud_count', st.fraud,
      'top_genres', st.top_genres,
      'top_rejections', st.top_rejections) as row,
      st.eligible
    from (
      select
        s.store_id, min(s.enterprise_account_id::text)::uuid enterprise_account_id,
        count(*) filter (where s.ineligible_reason is null) as eligible,
        count(*) filter (where s.ineligible_reason is not null) as rejected,
        count(*) filter (where coalesce(s.fraud_score,0) >= 0.5) as fraud,
        (select coalesce(jsonb_agg(g order by cnt desc), '[]'::jsonb) from (
           select coalesce(t.main_genre,'unknown') g, count(*) cnt
           from public.v2_eligible_streams s2 left join public.tracks t on t.id=s2.track_id
           where s2.store_id = s.store_id and s2.created_at>=v_start and s2.created_at<v_end
           group by 1 order by 2 desc limit 5) gg) as top_genres,
        (select coalesce(jsonb_agg(r order by cnt desc), '[]'::jsonb) from (
           select coalesce(s3.ineligible_reason,'none') r, count(*) cnt
           from public.v2_verified_streams s3
           where s3.store_id = s.store_id and s3.ineligible_reason is not null
             and s3.created_at>=v_start and s3.created_at<v_end
           group by 1 order by 2 desc limit 5) rr) as top_rejections
      from public.v2_eligible_streams s
      where s.created_at>=v_start and s.created_at<v_end
      group by s.store_id
    ) st
  ) q;

  return jsonb_build_object('settlement_month',p_month,'has_shadow_data',v_has,'stores',v,
    'note', case when not v_has then 'v2 shadow 스트림 미누적 — Streaming v2 데이터 누적 후 store 귀속 가능' else null end);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 6. admin_settlement_brand_compare — Brand 별
--    v1_basis: stream_events → brand_playlists.brand_id 로 귀속(현 데이터).
--    v2_shadow: v2_eligible_streams.brand_id (누적 후).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_settlement_brand_compare(p_month date, p_stream_source text default 'v1_basis')
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v jsonb; v_start timestamptz; v_end timestamptz; v_pool bigint; v_total bigint;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_start := (p_month::timestamp at time zone 'Asia/Seoul');
  v_end   := ((p_month + interval '1 month')::timestamp at time zone 'Asia/Seoul');
  select coalesce(pool_revenue,0) into v_pool from public.settlement_generation_runs_v2
    where settlement_month=p_month and stream_source=coalesce(p_stream_source,'v1_basis')
    order by version desc limit 1;
  v_pool := coalesce(v_pool,0);

  if coalesce(p_stream_source,'v1_basis') = 'v2_shadow' then
    select coalesce(sum(cnt),0) into v_total from (
      select count(*) cnt from public.v2_eligible_streams
      where created_at>=v_start and created_at<v_end and ineligible_reason is null group by brand_id) z;
    select coalesce(jsonb_agg(row order by eligible desc), '[]'::jsonb) into v from (
      select jsonb_build_object('brand_id', brand_id, 'eligible', eligible,
        'contribution_pct', case when v_total=0 then 0 else round(eligible::numeric/v_total*100,2) end,
        'estimated_revenue', case when v_total=0 then 0 else floor(v_pool::numeric*eligible/v_total)::bigint end) as row, eligible
      from (select brand_id, count(*) filter (where ineligible_reason is null) eligible
            from public.v2_eligible_streams where created_at>=v_start and created_at<v_end group by brand_id) b
    ) q;
  else
    select coalesce(count(*),0) into v_total from public.stream_events se
      join public.brand_playlists bp on bp.id=se.playlist_id
      where se.event_type='milestone_30s' and se.is_effective and se.eligible_for_payout
        and se.created_at>=v_start and se.created_at<v_end;
    select coalesce(jsonb_agg(row order by eligible desc), '[]'::jsonb) into v from (
      select jsonb_build_object('brand_id', brand_id, 'eligible', eligible,
        'contribution_pct', case when v_total=0 then 0 else round(eligible::numeric/v_total*100,2) end,
        'estimated_revenue', case when v_total=0 then 0 else floor(v_pool::numeric*eligible/v_total)::bigint end,
        'settlement_note','추정치 — v2 pool × brand eligible share') as row, eligible
      from (
        select bp.brand_id, count(*) eligible
        from public.stream_events se
        join public.brand_playlists bp on bp.id=se.playlist_id
        where se.event_type='milestone_30s' and se.is_effective and se.eligible_for_payout
          and se.created_at>=v_start and se.created_at<v_end
        group by bp.brand_id
      ) b
    ) q;
  end if;

  return jsonb_build_object('settlement_month',p_month,'stream_source',p_stream_source,
    'total_eligible',v_total,'pool_revenue',v_pool,'brands',coalesce(v,'[]'::jsonb));
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 7. admin_settlement_difference_ai — AI Summary(사유별 %) + 12개월 Trend
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_settlement_difference_ai(p_month date, p_stream_source text default 'v1_basis')
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  cls jsonb; v_trend jsonb; m date; i int; v_summary text; v_pct jsonb; v_primary text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  cls := public._settlement_diff_classify(p_month, p_stream_source);

  -- 12개월 Trend
  v_trend := '[]'::jsonb;
  for i in reverse 11..0 loop
    m := (date_trunc('month', p_month) - (i || ' months')::interval)::date;
    declare c jsonb := public._settlement_diff_classify(m, p_stream_source);
    begin
      if (c->>'has_v2')::boolean is true then
        v_trend := v_trend || jsonb_build_object(
          'month', m, 'has_v2', true,
          'v1_gross', (c->>'v1_gross')::bigint, 'v2_gross', (c->>'v2_gross')::bigint,
          'abs_diff', (c->>'abs_diff')::bigint,
          'diff_pct', case when (c->>'v1_gross')::bigint=0 then null
                           else round((c->>'total_diff')::numeric/nullif((c->>'v1_gross')::bigint,0)*100,2) end,
          'primary_reason', c->>'primary_reason');
      else
        v_trend := v_trend || jsonb_build_object('month', m, 'has_v2', false);
      end if;
    end;
  end loop;

  if (cls->>'has_v2')::boolean is not true then
    return jsonb_build_object('settlement_month',p_month,'stream_source',p_stream_source,
      'has_v2', false, 'summary','v2 shadow run 없음 — 비교 불가', 'trend', v_trend);
  end if;

  v_pct := cls->'pct'; v_primary := cls->>'primary_reason';
  -- 자연어 요약 자동 생성
  if v_primary = 'MATCH' then
    v_summary := format('%s v1/v2 정산 총액 일치. 차이 0. 엔진 정상.', to_char(p_month,'YYYY-MM'));
  elsif (cls->'components'->>'BUG')::bigint > 0 then
    v_summary := format('%s 차이의 %s%%가 BUG(불변식 위반)로 분류됨 — 즉시 조사 필요. gross>pool=%s.',
      to_char(p_month,'YYYY-MM'), v_pct->>'BUG', not (cls->'invariants'->>'gross_le_pool')::boolean);
  else
    v_summary := format('%s v1→v2 차이 %s원(%s%%). 주 사유: %s. 분해: Data Vintage %s%%, Streaming v2 %s%%, Rounding %s%%, Bug %s%%.',
      to_char(p_month,'YYYY-MM'),
      (cls->>'total_diff')::bigint,
      case when (cls->>'v1_gross')::bigint=0 then 'n/a'
           else round((cls->>'total_diff')::numeric/nullif((cls->>'v1_gross')::bigint,0)*100,1)::text end,
      v_primary,
      coalesce(v_pct->>'DATA_VINTAGE','0'), coalesce(v_pct->>'STREAMING_V2','0'),
      coalesce(v_pct->>'ROUNDING','0'), coalesce(v_pct->>'BUG','0'));
  end if;

  return jsonb_build_object(
    'settlement_month',p_month,'stream_source',p_stream_source,'has_v2',true,
    'primary_reason', v_primary, 'pct', v_pct, 'components', cls->'components',
    'invariants', cls->'invariants', 'summary', v_summary, 'trend', v_trend);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 8. admin_settlement_readiness — Settlement Readiness Score 0~100
--    Difference(40) + No Bug(25) + Shadow Stable(15) + Replay Stable(10) + Health(10)
--    unexplained = BUG + UNKNOWN 비중. ≤2% 면 Difference 만점.
--    score ≥ 98 이 3개월 연속이면 Cutover 후보.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_settlement_readiness(p_month date, p_stream_source text default 'v1_basis')
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  cls jsonb; v2 jsonb; v1 jsonb;
  abs_diff bigint; unexplained bigint; v2_gross bigint; unexplained_pct numeric;
  s_diff numeric; s_bug numeric; s_shadow numeric; s_replay numeric; s_health numeric; s_total numeric;
  v_bug boolean; v_shadow_ok boolean; v_replay_ok boolean; v_has_v1 boolean;
  v_health numeric; v_streak int := 0; m date; i int; v_cand boolean;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  cls := public._settlement_diff_classify(p_month, p_stream_source);
  v2  := public._settlement_v2_agg(p_month, p_stream_source);
  v1  := public._settlement_v1_agg(p_month);

  if (cls->>'has_v2')::boolean is not true then
    return jsonb_build_object('settlement_month',p_month,'stream_source',p_stream_source,'has_v2',false,
      'readiness_score',0,'cutover_candidate',false,'note','v2 shadow run 없음');
  end if;

  abs_diff := (cls->>'abs_diff')::bigint; v2_gross := greatest((v2->>'gross')::bigint,1);
  unexplained := (cls->'components'->>'BUG')::bigint + (cls->'components'->>'UNKNOWN')::bigint;
  unexplained_pct := round(unexplained::numeric/v2_gross*100, 3);
  -- v1 baseline 존재 여부 (없으면 비교 자체가 무의미 → cutover streak 제외)
  v_has_v1 := exists(select 1 from public.artist_settlements where settlement_month=p_month);
  v_bug := (cls->'components'->>'BUG')::bigint > 0
           or not (cls->'invariants'->>'gross_le_pool')::boolean
           or not (cls->'invariants'->>'non_negative')::boolean;

  -- Difference(40): unexplained ≤2% → 40, 20% 에서 0 선형
  s_diff := round(40 * greatest(0, least(1, (0.20 - least(unexplained_pct/100, 0.20))/0.18)), 1);
  if unexplained_pct <= 2 then s_diff := 40; end if;

  -- No Bug(25)
  s_bug := case when v_bug then 0 else 25 end;

  -- Shadow Stable(15): 해당 월 + 직전 2개월 v2 run 존재
  v_shadow_ok := true;
  for i in 0..2 loop
    m := (date_trunc('month',p_month) - (i||' months')::interval)::date;
    if not exists(select 1 from public.settlement_generation_runs_v2
                  where settlement_month=m and stream_source=coalesce(p_stream_source,'v1_basis')) then
      v_shadow_ok := false;
    end if;
  end loop;
  s_shadow := case when v_shadow_ok then 15 else 15 * (
    select count(distinct settlement_month) from public.settlement_generation_runs_v2
    where stream_source=coalesce(p_stream_source,'v1_basis')
      and settlement_month > (date_trunc('month',p_month) - interval '3 months')::date
      and settlement_month <= p_month) / 3.0 end;
  s_shadow := round(s_shadow,1);

  -- Replay Stable(10): 동일 월 최신 2개 버전의 total_gross 동일(결정성)
  v_replay_ok := (
    select count(distinct total_gross) <= 1
    from (select total_gross from public.settlement_generation_runs_v2
          where settlement_month=p_month and stream_source=coalesce(p_stream_source,'v1_basis')
            and not dry_run order by version desc limit 2) x);
  s_replay := case when v_replay_ok then 10 else 0 end;

  -- Health(10): fraud/rejected 비율 낮을수록. shadow 데이터 없으면 무결점 가정 만점.
  v_health := (v2->>'fraud_count')::numeric + (v2->>'rejected_count')::numeric;
  s_health := case when (v2->>'eligible_streams')::numeric <= 0 then 10
    else round(10 * greatest(0, 1 - v_health/greatest((v2->>'eligible_streams')::numeric,1)),1) end;

  s_total := s_diff + s_bug + s_shadow + s_replay + s_health;

  -- 3개월 연속 ≥98 판정 (streak)
  for i in 0..2 loop
    m := (date_trunc('month',p_month) - (i||' months')::interval)::date;
    declare cc jsonb := public._settlement_diff_classify(m, p_stream_source); ue bigint; g bigint; up numeric; ok boolean;
    begin
      if (cc->>'has_v2')::boolean is true then
        ue := (cc->'components'->>'BUG')::bigint + (cc->'components'->>'UNKNOWN')::bigint;
        g := greatest((cc->>'v2_gross')::bigint,1); up := ue::numeric/g*100;
        ok := up <= 2 and (cc->'components'->>'BUG')::bigint = 0;
        -- cutover streak: v2 run 존재 AND v1 baseline 존재(실제 비교 가능) AND 무버그 AND unexplained ≤2%
        if ok
           and exists(select 1 from public.settlement_generation_runs_v2 where settlement_month=m and stream_source=coalesce(p_stream_source,'v1_basis'))
           and exists(select 1 from public.artist_settlements where settlement_month=m)
        then v_streak := v_streak + 1; else exit; end if;
      else exit; end if;
    end;
  end loop;

  v_cand := s_total >= 98 and v_streak >= 3;

  return jsonb_build_object(
    'settlement_month',p_month,'stream_source',p_stream_source,'has_v2',true,
    'readiness_score', s_total,
    'components', jsonb_build_object(
      'difference', jsonb_build_object('score',s_diff,'max',40,'unexplained_pct',unexplained_pct,'abs_diff',abs_diff),
      'no_bug', jsonb_build_object('score',s_bug,'max',25,'bug', v_bug),
      'shadow_stable', jsonb_build_object('score',s_shadow,'max',15,'ok',v_shadow_ok),
      'replay_stable', jsonb_build_object('score',s_replay,'max',10,'ok',v_replay_ok),
      'health', jsonb_build_object('score',s_health,'max',10,'fraud_plus_rejected',v_health)),
    'consecutive_ready_months', v_streak,
    'has_v1_baseline', v_has_v1,
    'cutover_candidate', v_cand,
    'cutover_rule','readiness_score ≥ 98 AND (v1 baseline 존재하는) 3개월 연속 → ALGO-4 Cutover 검토',
    'primary_reason', cls->>'primary_reason');
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 9. 권한 (전부 super_admin 전용)
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._settlement_v1_agg(date)',
    'public._settlement_v2_agg(date,text)',
    'public._settlement_diff_classify(date,text)',
    'public.admin_settlement_validation(date,text)',
    'public.admin_settlement_readiness(date,text)',
    'public.admin_settlement_difference_ai(date,text)',
    'public.admin_settlement_artist_compare(date,text)',
    'public.admin_settlement_track_compare(date,text)',
    'public.admin_settlement_store_compare(date)',
    'public.admin_settlement_brand_compare(date,text)'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on function public.admin_settlement_validation(date,text) is
  'ALGO-3B — Settlement v1/v2 강화 비교(전 지표 + Difference + % + Reason). 분석 전용, 지급 무관.';
comment on function public.admin_settlement_readiness(date,text) is
  'ALGO-3B — Settlement Readiness Score 0~100. ≥98 3개월 연속 시 ALGO-4 Cutover 검토. 분석 전용.';
comment on function public.admin_settlement_difference_ai(date,text) is
  'ALGO-3B — Difference AI Summary(사유별 %) + 12개월 Trend. 분석 전용.';
