-- ============================================================================
-- HOTFIX-B — Store Category Guardrail Activation (APPLIED RECORD)
-- ============================================================================
-- 목적: Playback Guardrail 이 실제 작동하도록 납품/테스트 매장의
--       users.business_category 를 실제 업종으로 세팅.
--
-- 적용 범위 (전체 일괄 금지 조건 준수):
--   - 대상: 도형준 매장 1건 (id=4aea0cf2-5220-4185-b194-8eef05e70786)
--           account_type='business', 스케줄 42개(카페 28 / 호텔 7 / 와인바 7) — 유일 활성 매장
--   - 미변경: 이승현(2a135fa3, 스케줄 0), 루베르(aa370a93, 스케줄 0)
--   - 업종 확정: 카페 (주 사용 업종 · 사용자 승인)
--
-- 안전:
--   - 함수/플레이어/테이블/New Track/Auto-Curation 무변경 — users 1행 UPDATE 만
--   - business_category is null 가드 → 기존 값 있으면 덮어쓰지 않음
--   - normalize_store_label('카페') = 'cafe' (검증됨)
--
-- 실행 결과 (2026-07-07):
--   - 1 row updated (business_category: null → '카페')
--   - store_key 'cafe' 는 store_guardrails 에 규칙 0건 → 현재 hard_block 0 (회귀 0)
--   - 실제 차단을 켜려면 hotfix_b_cafe_guardrail_seed_PLAN.sql 적용 필요 (별도 승인)
-- ============================================================================

update public.users
   set business_category = '카페'
 where id = '4aea0cf2-5220-4185-b194-8eef05e70786'
   and account_type = 'business'
   and business_category is null
returning id, account_type, business_category;

-- ── 검증 (읽기 전용) ────────────────────────────────────────────────────────
-- normalize 결과 + cafe 규칙 수 + 두-인자/단일-인자 트랙수 비교 + hard_block 수
with store as (select '4aea0cf2-5220-4185-b194-8eef05e70786'::uuid as sid),
     pl    as (select '64683310-798a-4548-9446-ac5169cd85d1'::uuid as pid)  -- 카페·오전(최다 슬롯)
select
  public.normalize_store_label('카페')                                                         as normalized_key,        -- 'cafe'
  (select count(*) from public.store_guardrails g
     where g.store_key = public.normalize_store_label('카페') and g.enabled)                    as cafe_enabled_rules,    -- 0 (현재)
  jsonb_array_length(public.get_playlist_tracks((select pid from pl)))                          as tracks_single_arg,     -- 78
  jsonb_array_length(public.get_playlist_tracks((select pid from pl),(select sid from store)))  as tracks_with_store,     -- 78 (회귀 0)
  (select count(*) from jsonb_array_elements(public.get_playlist_tracks((select pid from pl))) e
    where (public._ai_check_store_guardrails((e->>'id')::uuid,
              public.normalize_store_label('카페'))->>'blocked')::boolean)                       as would_hard_block_cnt;  -- 0
