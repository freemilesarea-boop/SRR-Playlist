-- ============================================
-- 0479_admin_action_center.sql
--
-- Phase ADMIN-ACTION-CENTER-1 — Operations Action Center.
--
-- Action Center 는 운영 실행 계층이다. **실행 로직은 기존 admin RPC 를 재사용**하고
-- (admin_disable_user·admin_enable_user·admin_withdraw_user·admin_force_sign_out_user·
--  admin_force_store_resync·admin_bulk_approve_tracks·admin_bulk_reject_tracks·
--  admin_retry_pending_qc·admin_request_policy_retry·admin_grant/revoke_curator 등),
-- 이 마이그레이션은 **실행 로직을 새로 만들지 않는다**(중복 생성 금지).
--
-- 추가하는 것은 오직 **Command 등록/Audit 추적 레지스트리**뿐이다(작업 표준화·권한·
-- 감사 목적). 실제 대상 변경(정지/승인/재동기화 등)은 여전히 기존 RPC 가 수행한다.
--
-- 실행 흐름(프론트):
--   1) admin_action_register(...)  → command 행 생성(pending→running) + 중복/동시 실행 차단
--   2) 기존 admin RPC 호출         → 실제 실행(재사용)
--   3) admin_action_complete(...)  → success/failed + result/error/시간 기록(Audit)
--   ※ 1)이 실패하면 실행하지 않는다 → Audit 누락 방지. (마이그레이션 미적용 프로덕션
--     에서는 레지스트리가 없어 위험 작업이 실행되지 않는다 — 안전 기본값.)
--
-- 정합성: 동일 (command_type,target_type,target_id) 의 pending/running 이 이미 있으면
--   중복 등록을 거부한다(동시/중복 실행 방지). 상태: pending·running·success·failed·canceled.
-- ============================================

-- 관리자 가드는 0472 의 _admin_growth_guard() 재사용.

create table if not exists public.admin_action_commands (
  id           uuid primary key default gen_random_uuid(),
  command_type text not null,
  target_type  text not null,
  target_id    text,
  status       text not null default 'pending'
               check (status in ('pending','running','success','failed','canceled')),
  reason       text,
  requested_by uuid,
  approved_by  uuid,
  requested_at timestamptz not null default now(),
  started_at   timestamptz,
  completed_at timestamptz,
  result       jsonb,
  error        text,
  retry_count  int not null default 0
);

comment on table public.admin_action_commands is
  'ADMIN-ACTION-CENTER-1 — 운영 Command 등록/Audit 레지스트리. 실행 자체는 기존 admin RPC 재사용; 이 표는 추적/감사만.';

-- 동일 대상의 진행중(pending/running) command 중복 방지용 partial unique index.
create unique index if not exists uq_action_commands_inflight
  on public.admin_action_commands (command_type, target_type, coalesce(target_id, ''))
  where status in ('pending','running');

create index if not exists idx_action_commands_requested_at on public.admin_action_commands (requested_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- admin_action_register — command 등록(pending→running). 중복/동시 실행 차단.
--   p_approved = 위험 작업 승인 여부(프론트 승인 절차 통과 시 true).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_action_register(
  p_command_type text,
  p_target_type  text,
  p_target_id    text default null,
  p_reason       text default null,
  p_approved     boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._admin_growth_guard();

  if coalesce(p_command_type,'') = '' or coalesce(p_target_type,'') = '' then
    raise exception 'command_type/target_type required' using errcode = '22023';
  end if;

  begin
    insert into public.admin_action_commands (command_type, target_type, target_id, status, reason, requested_by, approved_by, started_at)
    values (p_command_type, p_target_type, p_target_id, 'running', p_reason, auth.uid(),
            case when p_approved then auth.uid() else null end, now())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'action already in progress for this target (중복/동시 실행 차단)' using errcode = '23505';
  end;

  return jsonb_build_object('ok', true, 'command_id', v_id, 'status', 'running');
end;
$$;

grant execute on function public.admin_action_register(text, text, text, text, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- admin_action_complete — 실행 결과 기록(Audit). success/failed/canceled.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_action_complete(
  p_command_id uuid,
  p_status     text,
  p_result     jsonb default null,
  p_error      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._admin_growth_guard();

  if p_status not in ('success','failed','canceled') then
    raise exception 'invalid status: %', p_status using errcode = '22023';
  end if;

  update public.admin_action_commands
  set status = p_status,
      result = coalesce(p_result, result),
      error = p_error,
      completed_at = now(),
      retry_count = case when p_status = 'failed' then retry_count + 1 else retry_count end
  where id = p_command_id;

  if not found then
    raise exception 'command not found: %', p_command_id using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true, 'command_id', p_command_id, 'status', p_status);
end;
$$;

grant execute on function public.admin_action_complete(uuid, text, jsonb, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- admin_action_history — 최근 command(Audit) 목록.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_action_history(p_limit int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 30), 100));
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.requested_at desc), '[]'::jsonb)
  into v_result
  from (
    select c.id, c.command_type, c.target_type, c.target_id, c.status, c.reason,
           c.requested_by, u.nickname as requested_by_name, c.approved_by,
           c.requested_at, c.started_at, c.completed_at, c.error, c.retry_count,
           extract(epoch from (c.completed_at - c.started_at)) as duration_seconds
    from public.admin_action_commands c
    left join public.users u on u.id = c.requested_by
    order by c.requested_at desc
    limit v_limit
  ) t;

  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_action_history(int) to authenticated;
