-- ============================================================
-- settlement_logic2_compute_test.sql — SETTLEMENT-LOGIC-2 회귀 테스트
--
-- 검증 대상 (0454 + 0455):
--   1) _settlement_tax_rate — enum 라벨 세율 해석 (unknown/NULL → NULL, fallback 금지)
--   2) _settlement_compute — 세금 안전 계산:
--        · 미과세 이월은 다음 달 1회만 과세
--        · 기과세 이월(prev_taxed)은 재과세하지 않음  ← 이중 원천징수 방지 핵심
--        · 미달/세율 미상 → 세금·지급 0, 세금상태 보존 이월
--        · 음수는 이월금에 저장하지 않음 → residual_debit 로 분리
--        · 금액 보존 불변식(§17)
--   3) 스키마: taxed/untaxed 이월 컬럼 + snapshot + 음수 방지 CHECK 존재
--
-- 실행:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/settlement_logic2_compute_test.sql
--
-- 순수 함수(SELECT)만 사용하므로 DB 를 변경하지 않음. 전체 ROLLBACK.
-- 모든 단언은 PL/pgSQL ASSERT — 실패 시 즉시 exception (exit code != 0).
-- ============================================================

begin;
set local client_min_messages = warning;

-- ---------- A) 스키마 불변식 ----------
do $$
declare v_cnt int;
begin
  select count(*) into v_cnt from information_schema.columns
  where table_schema='public' and table_name='artist_settlements'
    and column_name in ('carryover_untaxed_amount','carryover_taxed_amount',
      'previous_carryover_untaxed_amount','previous_carryover_taxed_amount',
      'taxable_base_amount','tax_withholding_type_snapshot','tax_rate_snapshot','minimum_payout_snapshot');
  assert v_cnt = 8, 'LOGIC-2 신규 컬럼 8종이 존재해야 함 (found=' || v_cnt || ')';

  select count(*) into v_cnt from pg_constraint
  where conrelid='public.artist_settlements'::regclass and contype='c' and conname like '%_nonneg';
  assert v_cnt >= 4, '음수 방지 CHECK 4종이 존재해야 함 (found=' || v_cnt || ')';
end$$;

-- ---------- B) 세율 해석 ----------
do $$
begin
  assert public._settlement_tax_rate('business_income_3_3') = 0.033, '3.3% 해석 실패';
  assert public._settlement_tax_rate('other_income_8_8')    = 0.088, '8.8% 해석 실패';
  assert public._settlement_tax_rate('none')                = 0.000, '비원천 0% 해석 실패';
  assert public._settlement_tax_rate('unknown_x')           is null, '알 수 없는 유형 → NULL 이어야 함(fallback 금지)';
  assert public._settlement_tax_rate(null)                  is null, 'NULL 유형 → NULL 이어야 함';
end$$;

-- ---------- C) 계산 시나리오 (정책: company 0.20, min 10000, basis gross) ----------
do $$
declare c jsonb;
begin
  -- B) 정확히 최소 → 1회 과세
  c := public._settlement_compute(12500,0.2,null,0,0,0.033,10000,'gross');
  assert (c->>'withholding_tax')::bigint = 330  and (c->>'final_payout')::bigint = 9670,
    'B exactly-min: 330/9670 기대, got ' || c::text;

  -- C) 미과세 이월 7000 + 당월순 5000 → 12000 을 1회만 과세
  c := public._settlement_compute(6250,0.2,null,7000,0,0.033,10000,'gross');
  assert (c->>'withholding_tax')::bigint = 396 and (c->>'final_payout')::bigint = 11604,
    'C untaxed-carry: 396/11604 기대, got ' || c::text;

  -- D) 기과세 이월 9670 은 재과세 금지 — 당월 10000 에만 과세(330), final=19340
  c := public._settlement_compute(12500,0.2,null,0,9670,0.033,10000,'gross');
  assert (c->>'withholding_tax')::bigint = 330,  'D 이중과세 방지 실패: withholding 은 330 이어야 함(재과세면 649), got ' || (c->>'withholding_tax');
  assert (c->>'final_payout')::bigint = 19340,   'D final 19340 기대, got ' || (c->>'final_payout');

  -- F) 8.8% / G) 0%(none)
  c := public._settlement_compute(12500,0.2,null,0,0,0.088,10000,'gross');
  assert (c->>'withholding_tax')::bigint = 880 and (c->>'final_payout')::bigint = 9120, 'F 8.8% 실패';
  c := public._settlement_compute(12500,0.2,null,0,0,0.000,10000,'gross');
  assert (c->>'withholding_tax')::bigint = 0 and (c->>'final_payout')::bigint = 10000, 'G 0% 실패';

  -- H) 세율 미상(NULL) → 지급 0, 미과세 이월(hold 유도)
  c := public._settlement_compute(12500,0.2,null,0,0,null,10000,'gross');
  assert (c->>'tax_known')::boolean = false and (c->>'final_payout')::bigint = 0
     and (c->>'carry_untaxed_out')::bigint = 10000, 'H unknown-rate hold 실패';

  -- J) 9999 경계 → 미달, 미과세 이월 9999
  c := public._settlement_compute(12498,0.2,null,0,0,0.033,10000,'gross');
  assert (c->>'meets_min')::boolean = false and (c->>'carry_untaxed_out')::bigint = 9999, 'J 경계 실패';

  -- K) 음수 과세조정 → clamp, residual 분리, 이월 음수 미저장
  c := public._settlement_compute(6250,0.2,null,0,0,0.033,10000,'gross',-8000,0);
  assert (c->>'carry_untaxed_out')::bigint = 0 and (c->>'carry_taxed_out')::bigint = 0
     and (c->>'residual_debit')::bigint = 3000, 'K 음수 clamp/residual 실패';

  -- M) 기과세 이월(5000)만 있고 미달 → 재과세 없이 기과세로 보존 이월
  c := public._settlement_compute(0,0.2,null,0,5000,0.033,10000,'gross');
  assert (c->>'withholding_tax')::bigint = 0 and (c->>'carry_taxed_out')::bigint = 5000
     and (c->>'carry_untaxed_out')::bigint = 0, 'M taxed-carry 보존 실패';
end$$;

-- ---------- D) 금액 보존 불변식 (§17) — 무작위 조합 전수 ----------
do $$
declare c jsonb; g bigint; pu bigint; pt bigint; r numeric; lhs bigint; rhs bigint; n int := 0;
begin
  for g in select unnest(array[0,5000,6250,12500,90000]) loop
    for pu in select unnest(array[0,7000,66519]) loop
      for pt in select unnest(array[0,9670]) loop
        foreach r in array array[0.033,0.088,0.000] loop
          c := public._settlement_compute(g,0.2,null,pu,pt,r,10000,'gross');
          -- inflow + residual == withholding + final + carry_untaxed + carry_taxed
          lhs := (c->>'taxable_net')::bigint + pu + pt + (c->>'residual_debit')::bigint;
          rhs := (c->>'withholding_tax')::bigint + (c->>'final_payout')::bigint
               + (c->>'carry_untaxed_out')::bigint + (c->>'carry_taxed_out')::bigint;
          assert lhs = rhs,
            format('보존 불변식 위반: g=%s pu=%s pt=%s r=%s lhs=%s rhs=%s', g,pu,pt,r,lhs,rhs);
          -- 어떤 경우에도 이월/지급/세금은 음수가 아니어야 함
          assert (c->>'carry_untaxed_out')::bigint >= 0 and (c->>'carry_taxed_out')::bigint >= 0
             and (c->>'final_payout')::bigint >= 0 and (c->>'withholding_tax')::bigint >= 0,
            format('음수 산출 위반: g=%s pu=%s pt=%s r=%s', g,pu,pt,r);
          n := n + 1;
        end loop;
      end loop;
    end loop;
  end loop;
  raise notice 'LOGIC-2 보존 불변식 전수 통과: % combinations', n;
end$$;

rollback;
