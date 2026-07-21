-- 0456 — SETTLEMENT-UX-2C: 정산 표시용 분리 필드 조회 (Additive, Read-only)
--
-- 목적: 상세 화면(Drawer)이 taxed/untaxed 이월 분리 + snapshot 을 실제로 표시하도록,
--       artist_settlements 에 이미 저장된(0454) 표시용 컬럼을 반환하는 조회 전용 RPC.
--
-- 안전:
--   · 기존 admin_settlement_detail / admin_settlement_list 시그니처 변경 없음 (신규 함수).
--   · 계산 없음, 상태 변경 없음, 지급/이월 없음 — 순수 SELECT.
--   · admin 권한 게이트 (기존 조회 RPC 와 동일 기준).
--   · Production 적용은 별도 검토 후 Runbook 으로 수행 (이번 Phase 는 Test 검증만).

create or replace function public.admin_settlement_display_fields(p_settlement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare v_row public.artist_settlements%rowtype;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  select * into v_row from public.artist_settlements where id = p_settlement_id;
  if v_row.id is null then return null; end if;
  return jsonb_build_object(
    'previous_carryover_untaxed_amount', v_row.previous_carryover_untaxed_amount,
    'previous_carryover_taxed_amount',   v_row.previous_carryover_taxed_amount,
    'carryover_untaxed_amount',          v_row.carryover_untaxed_amount,
    'carryover_taxed_amount',            v_row.carryover_taxed_amount,
    'taxable_base_amount',               v_row.taxable_base_amount,
    'tax_withholding_type_snapshot',     v_row.tax_withholding_type_snapshot,
    'tax_rate_snapshot',                 v_row.tax_rate_snapshot,
    'minimum_payout_snapshot',           v_row.minimum_payout_snapshot,
    'is_manual_carryover',               v_row.is_manual_carryover,
    'merged_into_settlement_id',         v_row.merged_into_settlement_id,
    'paid_at',                           v_row.paid_at,
    'paid_by',                           v_row.paid_by,
    'held_reason',                       v_row.held_reason,
    'created_at',                        v_row.created_at,
    'updated_at',                        v_row.updated_at
  );
end;
$$;

grant execute on function public.admin_settlement_display_fields(uuid) to authenticated;
