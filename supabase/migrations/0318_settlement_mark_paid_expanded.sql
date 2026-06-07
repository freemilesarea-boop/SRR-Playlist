-- 0318 — admin_mark_settlement_paid 확장 + audit + 안전장치 (X6.29)
--
-- 변경:
--   1) 허용 상태: pending / payable / held → paid 전환
--      (단, 다음 안전장치 모두 통과해야 함)
--   2) 차단 조건:
--      - status='paid'          → no-op return
--      - status='carried_over'  → 이미 이월된 row 는 지급 불가
--      - status='disputed'      → 분쟁 해소 필요
--      - merged_into_settlement_id IS NOT NULL → 다음 달로 흡수된 row
--      - final_payout_amount <= 0  → 지급액 0 (보통 meets_min=false)
--      - status='held' AND held_reason='pii_incomplete' AND p_force_pii=false
--          → PII 미완료는 기본 차단, override 인자 필요
--   3) audit log 자동 기록 (action='mark_paid', before_status/after_status,
--      paid_at, memo, force_used)
--
-- 시그니처 변경:
--   기존: (p_settlement_id, p_payout_memo)
--   신규: (p_settlement_id, p_payout_memo, p_force_pii) — DEFAULT 로 기존 호출 호환
--   반환: jsonb 그대로 + before_status/after_status/audit_id 추가
--
-- 정책 (carryover 와 동일 — 0314):
--   trg_artist_settlements_protect 트리거는 paid 진입 후 변경 차단 (불변).
--   merged_into_settlement_id 보호: 보정 없음 (별도 카리오버 RPC 가 관리).

-- 구 시그니처 (uuid, text) 제거 — 신규 (uuid, text, boolean) 만 유지
drop function if exists public.admin_mark_settlement_paid(uuid, text);

create or replace function public.admin_mark_settlement_paid(
  p_settlement_id uuid,
  p_payout_memo text default null,
  p_force_pii boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sett record;
  v_before_status text;
  v_audit_id bigint;
  v_memo text := nullif(btrim(coalesce(p_payout_memo, '')), '');
begin
  if not public.is_super_admin() then raise exception 'admin only'; end if;
  if p_settlement_id is null then raise exception 'p_settlement_id required'; end if;

  perform pg_advisory_xact_lock(hashtext('settlement_paid:' || p_settlement_id::text));

  select * into v_sett from public.artist_settlements where id = p_settlement_id for update;
  if v_sett.id is null then raise exception 'settlement not found'; end if;

  -- (1) 이미 paid — no-op
  if v_sett.status = 'paid' then
    return jsonb_build_object(
      'ok', true, 'settlement_id', p_settlement_id, 'status', 'paid',
      'already_paid', true, 'paid_at', v_sett.paid_at
    );
  end if;

  -- (2) carried_over / disputed 차단
  if v_sett.status = 'carried_over' then
    raise exception 'cannot mark carried_over settlement as paid (id=%, merged_into=%)',
      p_settlement_id, v_sett.merged_into_settlement_id using errcode = '42501';
  end if;
  if v_sett.status = 'disputed' then
    raise exception 'cannot mark disputed settlement as paid — resolve dispute first (id=%)',
      p_settlement_id using errcode = '42501';
  end if;
  if v_sett.status not in ('pending','payable','held') then
    raise exception 'mark_paid not allowed for status=% (allowed: pending|payable|held)',
      v_sett.status using errcode = '42501';
  end if;

  -- (3) 다음 달로 흡수된 row 차단
  if v_sett.merged_into_settlement_id is not null then
    raise exception 'cannot mark merged settlement as paid (id=%, merged_into=%)',
      p_settlement_id, v_sett.merged_into_settlement_id using errcode = '42501';
  end if;

  -- (4) 지급액 0 차단
  if coalesce(v_sett.final_payout_amount, 0) <= 0 then
    raise exception 'cannot mark as paid: final_payout_amount=% (정산이 finalize 또는 meets_min 통과해야 지급 가능)',
      v_sett.final_payout_amount using errcode = '22023';
  end if;

  -- (5) PII 미완료 차단 (override 가능)
  if v_sett.status = 'held'
     and v_sett.held_reason = 'pii_incomplete'
     and not coalesce(p_force_pii, false) then
    raise exception 'PII 미완료 정산 — p_force_pii=true 로 명시적 override 필요 (id=%)',
      p_settlement_id using errcode = '42501';
  end if;

  v_before_status := v_sett.status;

  update public.artist_settlements set
    status = 'paid',
    paid_at = now(),
    paid_by = v_uid,
    payout_memo = v_memo,
    -- pending/held 에서 직진 시 finalized_at 도 같이 set (audit/UX)
    finalized_at = coalesce(finalized_at, now()),
    updated_at = now()
  where id = p_settlement_id;

  -- (6) audit log
  insert into public.settlement_admin_audit_logs (
    settlement_id, artist_id, action, amount, from_month, to_month,
    admin_user_id, reason, detail
  ) values (
    p_settlement_id, v_sett.artist_user_id, 'mark_paid',
    v_sett.final_payout_amount, v_sett.settlement_month, null,
    v_uid, v_memo,
    jsonb_build_object(
      'before_status', v_before_status,
      'after_status', 'paid',
      'force_pii', coalesce(p_force_pii, false),
      'held_reason_at_mark', v_sett.held_reason,
      'total_settlement_amount', v_sett.total_settlement_amount,
      'previous_carried_amount', v_sett.previous_carried_amount,
      'withholding_tax_amount', v_sett.withholding_tax_amount
    )
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'ok', true,
    'settlement_id', p_settlement_id,
    'status', 'paid',
    'before_status', v_before_status,
    'audit_id', v_audit_id,
    'final_payout_amount', v_sett.final_payout_amount,
    'paid_at', now()
  );
end;
$$;

grant execute on function public.admin_mark_settlement_paid(uuid, text, boolean) to authenticated;
