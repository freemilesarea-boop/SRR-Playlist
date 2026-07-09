-- ============================================================================
-- Streaming v2 Shadow — 운영 검증 SQL 런북 (ALGO-2B)
-- ============================================================================
-- 관리자가 매일/주기적으로 실행하는 관측 쿼리 모음. 조회 전용.
-- 정산/차트에 영향 없음. v2 데이터는 shadow 관측용.
-- Admin RPC 대안: admin_stream_v2_overview / admin_stream_v2_replay / admin_stream_v2_health
-- (RPC 는 super_admin JWT 로 호출. 아래 SQL 은 DB 콘솔/service_role 로 직접 실행.)
-- ============================================================================

-- 1) 일별 v1 vs v2 비교 (핵심 대사 지표)
select * from public.v2_shadow_reconciliation order by day desc limit 30;

-- 2) player_type 별 차이 (최근 7일)
select player_type,
       count(*) filter (where event_type='play_30s') as play_30s,
       count(*) filter (where event_type='play_30s' and heartbeat_verified and coalesce(verified_seconds,0)>=30) as verified,
       count(*) filter (where event_type='play_30s' and ineligible_reason is null) as passed
from public.stream_ingest_v2
where created_at > now() - interval '7 days'
group by player_type order by play_30s desc;

-- 3) rejection reason 별 집계 (최근 7일, play_30s)
select coalesce(ineligible_reason,'(passed)') as reason, count(*)
from public.stream_ingest_v2
where created_at > now() - interval '7 days' and event_type='play_30s'
group by 1 order by 2 desc;

-- 4) heartbeat fail 집계 (play_30s 인데 heartbeat 미검증)
select date_trunc('day', created_at at time zone 'Asia/Seoul') as kst_day,
       count(*) filter (where event_type='play_30s') as play_30s,
       count(*) filter (where event_type='play_30s' and not heartbeat_verified) as heartbeat_fail
from public.stream_ingest_v2
where created_at > now() - interval '14 days'
group by 1 order by 1 desc;

-- 5) fraud score 상위 (score 부여 후 — ALGO-6 전엔 null)
select id, track_id, player_type, fraud_score, created_at
from public.stream_ingest_v2
where fraud_score is not null
order by fraud_score desc, created_at desc
limit 50;

-- 6) store/brand 별 health 원천 (score 는 admin_stream_v2_health RPC 로 산출)
select coalesce(store_id::text, brand_id::text, 'global') as scope_id,
       count(*) filter (where event_type='play_30s') as play_30s,
       round(avg(case when event_type='play_30s' and heartbeat_verified and coalesce(verified_seconds,0)>=30 then 1 else 0 end)::numeric,3) as verified_rate,
       round(avg(case when event_type='play_30s' and ineligible_reason is null then 1 else 0 end)::numeric,3) as pass_rate
from public.stream_ingest_v2
where created_at > now() - interval '7 days' and (store_id is not null or brand_id is not null)
group by 1 order by play_30s desc;

-- 7) session replay 조회 (특정 세션/트랙 타임라인)
--    :session 또는 :track 중 하나로 필터
select created_at, event_type, player_type, verified_seconds, heartbeat_verified,
       player_volume, player_muted, visibility_state, ineligible_reason, fraud_score, dispute_status
from public.stream_ingest_v2
where session_token = :'session'      -- 또는  track_id = :'track'
order by created_at;

-- 8) shadow 데이터 규모/증가 모니터 (테이블 폭증 감시)
select date_trunc('day', created_at) as day, count(*)
from public.stream_ingest_v2
group by 1 order by 1 desc limit 14;

-- 9) 정산 불변 확인 (v1 dry_run 은 admin_generate_monthly_settlement(month, true) RPC 로).
--    v2 는 어떤 정산 쿼리에도 등장하지 않아야 함 (grep: stream_ingest_v2 in settlement funcs = 0).
