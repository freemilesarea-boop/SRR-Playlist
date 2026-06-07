-- 0314 — admin_carryover_settlement 가 held 상태도 허용 (X6.27)
--
-- 변경 요약:
--   X6.25 의 admin_carryover_settlement 는 pending / payable 만 허용했으나,
--   운영상 PII 미완료 등의 사유로 status='held' 가 된 정산도 관리자가
--   "다음 달로 이월" 처리할 수 있어야 함 (실제 운영 정산 31건 중 23건이
--   held 라 기존 정책으로는 이월 불가).
--
-- 정책 (X6.27):
--   허용: pending / payable / held
--   차단: paid (terminal) / carried_over (중복 방지) / disputed
--
-- 보존:
--   - 기존 held_reason (예: 'pii_incomplete', 운영자 메모 등) 은
--     settlement_admin_audit_logs.detail.previous_held_reason 에 영구 보존.
--   - held_reason 은 'manual_carryover' 로 덮어쓰지만 audit 추적 가능.
--   - carryover_reason 은 사용자가 새로 입력 (필수).
--
-- 금액 계산:
--   - status='payable' → final_payout_amount (원천징수 후)
--   - status='pending' → total_settlement_amount (원천징수 전 = 이번 달 net + 직전 carryover)
--   - status='held'    → total_settlement_amount (held 는 finalize 전이라 final_payout=0 인 게 일반적)

create or replace function public.admin_carryover_settlement(
  p_settlement_id uuid,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_row public.artist_settlements%rowtype;
  v_amount bigint;
  v_to_month date;
  v_audit_id bigint;
begin
  if not exists (select 1 from public.users u where u.id = v_admin and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  if p_settlement_id is null then raise exception 'p_settlement_id required'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason_required (수동 이월 사유는 필수)';
  end if;

  select * into v_row from public.artist_settlements where id = p_settlement_id for update;
  if v_row.id is null then raise exception 'settlement_not_found'; end if;

  -- 차단 상태 — X6.27: held 는 이제 허용
  if v_row.status = 'paid' then
    raise exception 'cannot carryover paid settlement (id=%)', p_settlement_id using errcode = '42501';
  end if;
  if v_row.status = 'carried_over' then
    raise exception 'settlement already carried over (id=%, status=%)',
                    p_settlement_id, v_row.status using errcode = '42501';
  end if;
  if v_row.status = 'disputed' then
    raise exception 'cannot carryover disputed settlement (id=%) — resolve dispute first', p_settlement_id using errcode = '42501';
  end if;
  if v_row.status not in ('pending','payable','held') then
    raise exception 'cannot carryover settlement in status=% (allowed: pending|payable|held)',
                    v_row.status using errcode = '42501';
  end if;

  -- 금액 계산
  if v_row.status = 'payable' then
    v_amount := v_row.final_payout_amount;
  else
    -- pending / held → finalize 전이라 final_payout=0 일 수 있어 total 사용
    v_amount := v_row.total_settlement_amount;
  end if;
  if v_amount <= 0 then
    raise exception 'carryover_amount must be > 0 (current=%)', v_amount using errcode = '22023';
  end if;

  v_to_month := (v_row.settlement_month + interval '1 month')::date;

  -- 트리거가 OLD.status='held' 인 경우에도 v_manual_carryover_just_set 체크로
  -- carried_over_amount 변경을 허용함 (0311 의 _artist_settlements_protect).
  update public.artist_settlements as s
  set status = 'carried_over',
      is_manual_carryover = true,
      carryover_applied = false,
      carried_over_amount = v_amount,
      carried_over_to_month = v_to_month,
      carried_over_at = now(),
      carried_over_by = v_admin,
      carryover_reason = btrim(p_reason),
      held_reason = 'manual_carryover',
      updated_at = now()
  where s.id = p_settlement_id;

  insert into public.settlement_admin_audit_logs (
    settlement_id, artist_id, action, amount, from_month, to_month,
    admin_user_id, reason, detail
  ) values (
    p_settlement_id, v_row.artist_user_id, 'manual_carryover',
    v_amount, v_row.settlement_month, v_to_month,
    v_admin, btrim(p_reason),
    jsonb_build_object(
      'previous_status', v_row.status,
      'previous_held_reason', v_row.held_reason,
      'final_payout_amount', v_row.final_payout_amount,
      'total_settlement_amount', v_row.total_settlement_amount,
      'meets_min_payout', v_row.meets_min_payout
    )
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'ok', true,
    'settlement_id', p_settlement_id,
    'audit_id', v_audit_id,
    'carryover_amount', v_amount,
    'carried_over_to_month', v_to_month,
    'previous_status', v_row.status,
    'previous_held_reason', v_row.held_reason,
    'status', 'carried_over'
  );
end; $$;

grant execute on function public.admin_carryover_settlement(uuid, text) to authenticated;
