-- ============================================================================
-- 0494_settlement_adjustment_separate_column.sql
-- 정산 보정(adjustment)을 이월(carryover)과 분리해 저장한다.
--
-- ── 문제 ────────────────────────────────────────────────────────────────────
-- admin_generate_monthly_settlement 이 보정액을 이월 칸에 합산해 저장한다:
--     v_prev_carried := v_prev_carried + v_adjustments_sum;
--     v_total        := v_artist_net + v_prev_carried;
-- 그 결과 previous_carried_amount 안에 "직전월 이월"과 "보정"이 섞이고,
-- 화면(관리자 '④ 직전월 이월금', 아티스트 '직전월 이월')은 그 합계를 이월로 표시한다.
--
-- 실제로 이 때문에 오독이 발생했다 — 2026-08 정산에서 7월 지급 완료(paid) 아티스트
-- 8명에게 "이월금 있음"이 표시됐다. 이월 엔진은 정상이었고(paid 는 이월 대상에서
-- 정확히 제외된다) 그 값은 전액 보정액이었다. 지급한 돈이 이월된 것이 아니었지만,
-- 표시만으로는 구분할 방법이 없었다.
--
-- ── 조치 ────────────────────────────────────────────────────────────────────
-- (A) artist_settlements.adjustment_amount 추가 — 그 달에 적용된 보정 합계.
--     previous_carried_amount 는 "직전월 이월"만 담는다(의미 회복).
--     total_settlement_amount = artist_net + previous_carried + adjustment (불변).
--
-- (B) 생성 함수 3곳 패치. 0485 와 같은 방식 —
--     pg_get_functiondef + replace, 대상 문자열 미발견 시 예외로 중단한다.
--     (21KB 함수를 통째로 다시 적지 않아 전사 오류 위험이 없다.)
--
-- 금액 영향: 없음. total_settlement_amount 계산 결과는 완전히 동일하고,
--   previous_carried_amount 에서 빠진 만큼이 adjustment_amount 로 이동할 뿐이다.
--
-- 기존 행: 현재 살아있는(미무효) 보정이 0건이므로 backfill 대상이 없다.
--   0491 이 중복 보정 34건을 무효 처리했고 2026-08 은 그 상태로 재생성됐다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (A) 컬럼 추가
-- ----------------------------------------------------------------------------
alter table public.artist_settlements
  add column if not exists adjustment_amount bigint not null default 0;

comment on column public.artist_settlements.adjustment_amount is
  '이 달에 적용된 settlement_adjustments 합계. previous_carried_amount(직전월 이월)와 분리 보관.';

-- ----------------------------------------------------------------------------
-- (B) admin_generate_monthly_settlement 패치 (0485 와 동일 방식)
-- ----------------------------------------------------------------------------
do $patch$
declare
  v_src text;
  v_a_old text; v_a_new text;
  v_b1_old text; v_b1_new text;
  v_b2_old text; v_b2_new text;
  v_c_old text; v_c_new text;
begin
  v_src := pg_get_functiondef('public.admin_generate_monthly_settlement(date,boolean)'::regprocedure);

  -- A. 보정을 이월에 합산하지 않는다. 총액에는 그대로 더한다(결과 동일).
  v_a_old := E'    v_prev_carried := v_prev_carried + v_adjustments_sum;\n'
          || E'    v_total := v_artist_net + v_prev_carried;';
  v_a_new := E'    -- 0494: 보정은 이월에 합산하지 않는다(칸을 분리). 총액에는 동일하게 반영.\n'
          || E'    v_total := v_artist_net + v_prev_carried + v_adjustments_sum;';

  -- B. INSERT — 컬럼/값 목록에 adjustment_amount 추가
  v_b1_old := E'          artist_net_settlement, previous_carried_amount, total_settlement_amount,';
  v_b1_new := E'          artist_net_settlement, previous_carried_amount, adjustment_amount, total_settlement_amount,';
  v_b2_old := E'          v_artist_net, v_prev_carried, v_total,';
  v_b2_new := E'          v_artist_net, v_prev_carried, v_adjustments_sum, v_total,';

  -- C. UPDATE(재생성) — adjustment_amount 갱신
  v_c_old := E'          previous_carried_amount = v_prev_carried,';
  v_c_new := E'          previous_carried_amount = v_prev_carried,\n'
          || E'          adjustment_amount = v_adjustments_sum,';

  if position(v_a_old in v_src) = 0 then
    raise exception '0494(A) patch target not found — function body changed unexpectedly'; end if;
  if position(v_b1_old in v_src) = 0 then
    raise exception '0494(B1) patch target not found'; end if;
  if position(v_b2_old in v_src) = 0 then
    raise exception '0494(B2) patch target not found'; end if;
  if position(v_c_old in v_src) = 0 then
    raise exception '0494(C) patch target not found'; end if;

  v_src := replace(v_src, v_a_old,  v_a_new);
  v_src := replace(v_src, v_b1_old, v_b1_new);
  v_src := replace(v_src, v_b2_old, v_b2_new);
  v_src := replace(v_src, v_c_old,  v_c_new);

  execute v_src;
end $patch$;

-- ----------------------------------------------------------------------------
-- 적용 확인 (무해)
-- ----------------------------------------------------------------------------
do $verify$
declare v_src text; n int;
begin
  v_src := pg_get_functiondef('public.admin_generate_monthly_settlement(date,boolean)'::regprocedure);
  if position('v_prev_carried := v_prev_carried + v_adjustments_sum;' in v_src) > 0 then
    raise exception '0494 verify: 보정이 여전히 이월에 합산되고 있다';
  end if;
  if position('adjustment_amount = v_adjustments_sum' in v_src) = 0 then
    raise exception '0494 verify: UPDATE 경로에 adjustment_amount 가 없다';
  end if;
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='artist_settlements' and column_name='adjustment_amount';
  raise notice '[0494] adjustment_amount column=% · 함수 패치 완료', n;
end $verify$;
