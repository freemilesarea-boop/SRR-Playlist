-- ============================================================================
-- 0493_void_duplicate_backfill_adjustments.sql
-- 8/22 수익 백필 보정 조정 34건(173,341원) 무효 처리 — 중복 보정 제거.
--
-- ── 진단 (실측) ─────────────────────────────────────────────────────────────
-- 2026-08-22, "revenue backfill 0472: recurring-payment under-count 2026-05~07"
-- 사유로 조정 34건(173,341원)이 생성됐고 9/1 8월 정산 생성 때 적용됐다.
--
-- 그런데 8/31 재산정(0484/0485)이 5~7월 정산행 77건을 현재 결제 데이터 기준으로
-- 다시 배분해, 그 시점에 같은 보정이 이미 반영됐다:
--     월     수익풀     배분액     잔차
--     5월    90,650    90,634      16   (floor 반올림)
--     6월   103,900   103,767     133
--     7월   150,450   150,166     284
-- 세 달 모두 풀이 전액 소진 → 조정 173,341원을 뒷받침하는 수익이 없다.
--
-- 또한 조정 이전 금액으로 지급받은 아티스트가 없다. 실제 지급 8건은 전부
-- 8/31 재산정(06:44) 이후인 07:05~07:54 에 보정된 금액으로 집행됐다
-- (정산 합계 142,354원 / 실지급 137,660원). 즉 보전 대상이 존재하지 않는다.
--
-- 증상: 2026-08 정산에서 이월 유입이 100,028 → 273,369 로 부풀었고, 7월 지급
--   완료 아티스트 8명에게 "이월금 있음"이 표시됐다(전액 보정액, 이월 아님).
--   8월은 아직 미지급이라 실제 초과 지급은 발생하지 않았다.
--
-- ── 조치 ────────────────────────────────────────────────────────────────────
-- 조정 행을 삭제하지 않고 무효 표시만 남긴다(회계 흔적 보존).
-- 이미 applied=true 라 재생성 시 다시 집계되지 않으므로, 8월을 재생성하면
-- 이월이 100,028 로 정정된다.
--
-- 되돌리기: voided_at=null, applied=false 로 되돌리면 재적용된다.
--   8월 정산행/조정 원본 스냅샷: public.settlement_fix_20260902_backup
-- ============================================================================

alter table public.settlement_adjustments
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid references public.users(id),
  add column if not exists void_reason text;

comment on column public.settlement_adjustments.voided_at is
  '무효 처리 시각. 회계 흔적을 위해 행을 삭제하지 않고 무효만 표시한다.';

update public.settlement_adjustments
   set voided_at = now(),
       voided_by = (select id from public.users where role='admin' order by created_at limit 1),
       void_reason = '중복 보정: 8/31 재산정(0484/0485)이 2026-05~07 을 현재 결제 데이터로 '
                     || '다시 배분해 동일 보정이 이미 반영됨. 세 달 모두 수익풀 전액 소진 상태이며 '
                     || '조정 이전 금액으로 지급된 아티스트도 없음(지급 8건 전부 재산정 이후 집행).'
 where apply_to_month = '2026-08-01'
   and reason like 'revenue backfill 0472%'
   and voided_at is null;

-- 무효 처리 후 2026-08 재생성 필요:
--   select public.admin_generate_monthly_settlement('2026-08-01', false);
-- (운영 적용 시 실행 완료 — 이월 273,369 → 100,028, 총액 375,940 → 202,599)
