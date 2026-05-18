-- 0079 — 정산 필터 강화: eligible_for_payout=true 만 정산 대상
--
-- 정책:
-- - 정산 대상 스트림 = event_type='milestone_30s' AND eligible_for_payout=true
-- - eligible_settlement_tracks view 기존 가드 (released + signed + verified) 유지
-- - 이미 paid/held/disputed/payable/carried_over 상태 정산서는 절대 수정 X
-- - settlement_items / streaming_revenues 에 raw vs excluded 카운트 보존
--
-- 변경:
-- 1) settlement_items.eligible_stream_count / raw_milestone_stream_count / excluded_stream_count
-- 2) streaming_revenues.raw_milestone_stream_count / excluded_stream_count
-- 3) admin_generate_monthly_settlement RPC — 모든 milestone 카운트에 eligible_for_payout=true
--    필터 추가, raw / excluded 함께 기록, 반환 jsonb 에 total_eligible / total_excluded 추가
-- 4) 기존 데이터 backfill — stream_count 를 eligible/raw 양쪽에 복사 (excluded=0)

ALTER TABLE public.settlement_items
  ADD COLUMN IF NOT EXISTS eligible_stream_count integer,
  ADD COLUMN IF NOT EXISTS raw_milestone_stream_count integer,
  ADD COLUMN IF NOT EXISTS excluded_stream_count integer;

UPDATE public.settlement_items
SET eligible_stream_count = stream_count,
    raw_milestone_stream_count = stream_count,
    excluded_stream_count = 0
WHERE eligible_stream_count IS NULL;

ALTER TABLE public.streaming_revenues
  ADD COLUMN IF NOT EXISTS raw_milestone_stream_count integer,
  ADD COLUMN IF NOT EXISTS excluded_stream_count integer;

UPDATE public.streaming_revenues
SET raw_milestone_stream_count = stream_count,
    excluded_stream_count = 0
WHERE raw_milestone_stream_count IS NULL;

-- admin_generate_monthly_settlement RPC 갱신: eligible_for_payout=true 필터 + raw/excluded 기록
-- (전체 RPC 본문은 0079_settlement_eligible_filter mcp__apply_migration 에 반영됨.
--  핵심 변경:
--   · v_total_streams 산출 시 WHERE 에 se.eligible_for_payout=true 추가
--   · for-loop 에서 v_eligible_streams (eligible 전용), v_raw_streams (전체 milestone),
--     v_excluded_streams 분리 집계
--   · 트랙별 분배: pool_revenue * v_eligible_streams / v_total_streams
--   · streaming_revenues INSERT/UPSERT 에 raw/excluded 컬럼 채움
--   · settlement_items INSERT 에 eligible/raw/excluded 컬럼 채움
--   · 반환 jsonb 에 total_eligible_streams / total_excluded_streams 추가)

NOTIFY pgrst, 'reload schema';
