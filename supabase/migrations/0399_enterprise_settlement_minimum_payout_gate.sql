-- 0399 — Phase 3-1B: Minimum Payout Enforcement (지급완료 서버 gate)
--
-- 정책 변경:
--   기존 0372 admin_mark_paid_enterprise_monthly_settlement 는 minimum_payout 을
--   snapshot 만 저장하고 지급완료 시 threshold 를 강제하지 않았다.
--   본 마이그레이션은 total_commission < minimum_payout 이고 minimum_payout > 0
--   인 경우 서버에서 지급완료를 차단한다.
--   차단 시 audit log 에 blocked reason 을 남겨 감사 가능하게 한다.
--
-- 변경:
--   1) admin_mark_paid_enterprise_monthly_settlement RPC 재생성
--      - status 검증 (approved 만) — 기존 유지
--      - payment_reference 검증 — 기존 유지
--      - 신규: total_commission < minimum_payout && minimum_payout > 0 → 차단
--        · admin_log_operation 에 blocked / minimum_payout_not_met 기록
--        · exception 'minimum_payout_not_met (total=X, minimum=Y)' raise
--
-- 절대 원칙:
--   - 정산 생성 금액 계산식 무변경 (RPC generate/approve/cancel 무관)
--   - monthly_store_price / commission_rate / minimum_payout 정책 무변경
--     (여전히 admin 만 enterprise_settlement_profiles.minimum_payout 수정)
--   - HQ 수정 권한 추가 X · 기존 정산 snapshot 재계산 X
--   - artist settlement / player / audio engine 무관
--
-- 예외 정책:
--   - override 미제공 · 최소정산금 미달 정산은 paid 불가
--   - 필요 시 기존 admin_cancel_enterprise_monthly_settlement (status='cancelled')
--     로 보류 처리 · 재정산은 admin_generate 재실행 (partial-unique index 재활용)

-- ============================================================
-- admin_mark_paid_enterprise_monthly_settlement — minimum_payout gate 추가
-- ============================================================
create or replace function public.admin_mark_paid_enterprise_monthly_settlement(
  p_settlement_id uuid,
  p_payment_reference text,
  p_admin_note text default null
)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.enterprise_monthly_settlements;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if coalesce(btrim(p_payment_reference), '') = '' then
    raise exception 'payment_reference required';
  end if;

  select * into v_row from public.enterprise_monthly_settlements where id = p_settlement_id;
  if v_row.id is null then raise exception 'settlement not found: %', p_settlement_id; end if;
  if v_row.status <> 'approved' then
    raise exception 'invalid transition: status=% (only approved can be marked paid)', v_row.status;
  end if;

  -- Phase 3-1B — minimum_payout enforcement.
  -- minimum_payout > 0 이고 total_commission 이 미달이면 지급완료 차단.
  -- 감사를 위해 blocked 로그를 남긴 뒤 exception 으로 트랜잭션 rollback.
  if coalesce(v_row.minimum_payout, 0) > 0
     and coalesce(v_row.total_commission, 0) < v_row.minimum_payout then
    perform public.admin_log_operation(
      'enterprise_monthly_settlements', 'admin', 'blocked',
      'enterprise_monthly_settlement.paid_blocked',
      format('Enterprise monthly settlement paid blocked (id=%s ea=%s total=%s minimum=%s reason=minimum_payout_not_met)',
        v_row.id, v_row.enterprise_account_id,
        v_row.total_commission, v_row.minimum_payout),
      jsonb_build_object(
        'action', 'enterprise_monthly_settlement.paid_blocked',
        'settlement_id', v_row.id,
        'enterprise_account_id', v_row.enterprise_account_id,
        'settlement_month', to_char(v_row.settlement_month, 'YYYY-MM-DD'),
        'total_commission', v_row.total_commission,
        'minimum_payout', v_row.minimum_payout,
        'reason', 'minimum_payout_not_met',
        'payment_reference_attempted', btrim(p_payment_reference),
        'admin_note_attempted', p_admin_note
      ),
      v_uid, v_row.id::text, null, null, null
    );
    raise exception 'minimum_payout_not_met (total=%, minimum=%)',
      v_row.total_commission, v_row.minimum_payout;
  end if;

  update public.enterprise_monthly_settlements
     set status = 'paid',
         paid_at = now(),
         paid_by = v_uid,
         payment_reference = btrim(p_payment_reference),
         admin_note = coalesce(nullif(btrim(p_admin_note), ''), admin_note),
         updated_at = now()
   where id = p_settlement_id
  returning * into v_row;

  perform public.admin_log_operation(
    'enterprise_monthly_settlements', 'admin', 'success',
    'enterprise_monthly_settlement.paid',
    format('Enterprise monthly settlement paid (%s, ea=%s, total=%s, ref=%s)',
      to_char(v_row.settlement_month, 'YYYY-MM'),
      v_row.enterprise_account_id, v_row.total_commission, btrim(p_payment_reference)),
    jsonb_build_object(
      'action', 'enterprise_monthly_settlement.paid',
      'settlement_id', v_row.id,
      'enterprise_account_id', v_row.enterprise_account_id,
      'settlement_month', to_char(v_row.settlement_month, 'YYYY-MM-DD'),
      'total_commission', v_row.total_commission,
      'minimum_payout', v_row.minimum_payout,
      'payment_reference', btrim(p_payment_reference),
      'admin_note', p_admin_note
    ),
    v_uid, v_row.id::text, null, null, null
  );

  return jsonb_build_object('success', true,
    'settlement_id', v_row.id, 'status', v_row.status, 'paid_at', v_row.paid_at);
end;
$$;
revoke execute on function public.admin_mark_paid_enterprise_monthly_settlement(uuid, text, text) from public, anon;
grant execute on function public.admin_mark_paid_enterprise_monthly_settlement(uuid, text, text) to authenticated;

comment on function public.admin_mark_paid_enterprise_monthly_settlement(uuid, text, text) is
  'Phase 3-1B — approved 상태에서만 paid 처리 · total_commission < minimum_payout 이면 서버 차단 + audit log.';


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_rpc int;
  v_sig_ok int;
begin
  select count(*) into v_rpc from pg_proc
    where proname = 'admin_mark_paid_enterprise_monthly_settlement';
  select count(*) into v_sig_ok from pg_proc
    where proname = 'admin_mark_paid_enterprise_monthly_settlement'
      and pg_get_function_identity_arguments(oid) =
          'p_settlement_id uuid, p_payment_reference text, p_admin_note text';

  raise notice '====== 0399 minimum_payout gate Diagnostics ======';
  raise notice 'admin_mark_paid_enterprise_monthly_settlement (any): % / 1', v_rpc;
  raise notice 'admin_mark_paid_enterprise_monthly_settlement (3-arg sig): % / 1', v_sig_ok;
  raise notice '=================================================';

  if v_rpc = 1 and v_sig_ok = 1 then
    raise notice '0399 COMPLETE — minimum_payout server gate ready';
  else
    raise warning '0399 INCOMPLETE — 위 카운트 확인';
  end if;
end$$;
