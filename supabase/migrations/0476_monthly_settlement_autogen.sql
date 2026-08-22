-- ============================================================================
-- 0476_monthly_settlement_autogen.sql
-- 매월 1일 아티스트 정산표 자동 생성 + 관리자 지급 검토 알람.
--
-- 요구: 매월 1일에 (전월) 정산표가 관리자 정산 탭에 자동 생성되고, 관리자 로그인 시
--   "정산 지급 검토" 알람이 뜨게 한다.
--
-- ⚠️ 안전 원칙: 자동화는 "PENDING 정산표 생성"까지만이다. 실제 지급(송금)은 하지
--   않는다 — 관리자가 자동 생성된 표를 검토한 뒤 수동으로 지급한다. 알람이 그 검토를
--   유도한다. (무인 자동 송금 금지.) 생성은 기존 이월분/조정(settlement_adjustments)을
--   모두 자동 반영한다(정산 함수 내장 로직).
--
-- 구성:
--   (1) cron_generate_monthly_settlement(p_month): 전월 정산을 실제 생성(pending).
--       이미 생성됐으면 skip(불변 장치로 재생성 실패 방지). 시스템 admin 컨텍스트로
--       기존 admin_generate_monthly_settlement 를 호출 → 이월 소비 + 조정 적용 자동.
--       생성 후 admin_notifications(kind='settlement_ready')로 지급 검토 알림.
--   (2) admin_pending_settlement_alert(): 관리자 배너용. 지급 대기(pending/held) 최신
--       정산월 + 건수 반환. 관리자만.
--   (3) pg_cron 'srr-monthly-settlement-autogen' 매월 1일 09:00 KST(00:00 UTC).
-- ============================================================================

-- (1) 월간 자동 생성 (전월). p_month 지정 시 해당 월(테스트/수동 재실행용).
create or replace function public.cron_generate_monthly_settlement(p_month date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_month date; v_admin uuid; v_res jsonb; v_exists int;
begin
  v_month := coalesce(p_month, (date_trunc('month', (now() at time zone 'Asia/Seoul')) - interval '1 month')::date);

  -- 이미 생성된 달이면 재생성하지 않음(불변 장치로 실패하므로)
  select count(*) into v_exists from public.artist_settlements where settlement_month = v_month;
  if v_exists > 0 then
    return jsonb_build_object('ok', true, 'skipped', 'already_generated', 'month', v_month);
  end if;

  -- 시스템 admin 컨텍스트 (정산 함수의 admin 게이트 통과 + 감사 created_by)
  select id into v_admin from public.users where role = 'admin' order by created_at limit 1;
  if v_admin is null then
    return jsonb_build_object('ok', false, 'error', 'no_admin', 'month', v_month);
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- 실제 생성(pending) — 이월 소비 + settlement_adjustments 적용은 함수 내장
  select public.admin_generate_monthly_settlement(v_month, false) into v_res;

  insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
  values ('settlement_ready', 'warning',
    to_char(v_month, 'YYYY-MM') || ' 정산 자동 생성 완료 — 지급 검토 필요',
    to_char(v_month, 'YYYY-MM') || '월 아티스트 정산표가 자동 생성되었습니다. 관리자 페이지 정산 탭에서 검토 후 지급을 실행하세요. (자동 생성은 표만 만들며 실제 송금은 하지 않습니다.)',
    jsonb_build_object('settlement_month', v_month, 'result', v_res), 0, now());

  return jsonb_build_object('ok', true, 'generated_month', v_month, 'result', v_res);
exception when others then
  insert into public.admin_notifications (kind, severity, title, body, dispatch_attempts, created_at)
  values ('settlement_ready', 'error',
    '정산 자동 생성 실패 (' || coalesce(v_month::text, '?') || ')',
    '자동 정산 생성 중 오류: ' || sqlerrm || ' — 관리자가 정산 탭에서 수동 생성해 주세요.',
    0, now());
  return jsonb_build_object('ok', false, 'error', sqlerrm, 'month', v_month);
end;
$$;
revoke all on function public.cron_generate_monthly_settlement(date) from public;
grant execute on function public.cron_generate_monthly_settlement(date) to service_role;

-- (2) 관리자 배너용: 지급 대기 최신 정산월 + 건수 (관리자 전용)
create or replace function public.admin_pending_settlement_alert()
returns table(has_pending boolean, settlement_month date, pending_count int, held_count int, total_amount bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_month date;
begin
  if not public._is_super_admin() then
    return query select false, null::date, 0, 0, 0::bigint; return;
  end if;
  select max(a.settlement_month) into v_month
  from public.artist_settlements a where a.status in ('pending', 'held');
  if v_month is null then
    return query select false, null::date, 0, 0, 0::bigint; return;
  end if;
  return query
  select true, v_month,
    count(*) filter (where a.status = 'pending')::int,
    count(*) filter (where a.status = 'held')::int,
    coalesce(sum(a.total_settlement_amount), 0)::bigint
  from public.artist_settlements a
  where a.settlement_month = v_month and a.status in ('pending', 'held');
end;
$$;
revoke all on function public.admin_pending_settlement_alert() from public;
grant execute on function public.admin_pending_settlement_alert() to authenticated, service_role;

-- (3) 매월 1일 09:00 KST(00:00 UTC) 자동 생성
select cron.schedule(
  'srr-monthly-settlement-autogen',
  '0 0 1 * *',
  $cron$select public.cron_generate_monthly_settlement();$cron$
);
