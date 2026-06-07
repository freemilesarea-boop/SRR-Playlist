-- 0316 — 정산 정책 신규: 최소 지급 10,000원 (X6.28)
--
-- 배경:
--   기존 정책 (effective_from=2026-05-01) 의 min_payout_amount = 50,000원
--   이 너무 높아 아티스트 정산 대부분이 자동 carry-over 됨. 사용자 요청에
--   따라 10,000원으로 인하한 신규 정책 row 추가.
--
-- 정책 (append-only):
--   - effective_from = 2026-07-01 (다음 정산 월부터 적용)
--   - min_payout_amount = 10,000원
--   - 그 외 비율은 직전 정책 그대로 (pool 50%, company 20%, 원천징수 3.3%)
--
-- 기존 2026-05 / 2026-06 정산은 기존 50,000원 정책 그대로 유지.
-- (정책 row 는 append-only 트리거 보호됨 — UPDATE/DELETE 불가)

insert into public.settlement_policies (
  effective_from, pool_revenue_ratio, company_fee_ratio, withholding_tax_ratio,
  min_payout_amount, min_payout_basis, note
) values (
  '2026-07-01', 0.5000, 0.2000, 0.0330,
  10000, 'gross',
  'X6.28: 최소 지급 5만원 → 1만원 인하. 풀 50% / 회사 20% / 원천징수 3.3% 유지.'
)
on conflict (effective_from) do nothing;
