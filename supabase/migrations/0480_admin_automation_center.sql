-- ============================================
-- 0480_admin_automation_center.sql
--
-- Phase ADMIN-AUTOMATION-1 — Operations Automation Center.
--
-- 운영 자동화(Trigger→Condition→Action→Approval→Execution→Audit)의 표준 기반이다.
-- **실행 로직은 새로 만들지 않는다.** 실제 실행은 기존 Action Center Command 모델
-- (0479: admin_action_register / admin_action_complete)과 기존 admin 실행 RPC
-- (admin_force_store_resync·admin_retry_pending_qc·admin_bulk_approve_tracks 등)을
-- 그대로 재사용한다. 이 마이그레이션은 오직 **규칙 저장 · 안전 게이팅 · 감사 기록**만
-- 추가한다(중복 Rule Engine·중복 실행 로직 금지).
--
-- 안전 기본값(절대 조건):
--   - is_enabled = false, dry_run = true, execution_mode = 'suggest',
--     approval_required = true  (규칙 생성만으로 실행되지 않는다)
--   - Auto 실행은 Kill Switch(global+domain)가 명시적으로 켜져 있고 risk_level='low'
--     이며 실행 RPC 가 존재할 때만 허용. Kill Switch 기본값 = 꺼짐(=Auto 차단).
--   - 회원/결제/정산/계약/Player 데이터를 직접 수정하는 신규 로직 없음. Trigger 지표는
--     프론트가 기존 KPI RPC 로 측정해 넘겨주고(재사용), 이 계층은 게이팅/감사만 한다.
--   - 조건 평가/실행은 동일 Rule+대상의 pending/running Command 가 있으면 차단(중복 방지).
--
-- 평가 흐름(프론트 주도, 서버 게이팅):
--   1) 프론트가 기존 KPI(offline_players·qc_pending·offline_stores·today_incidents·
--      settlement_pending·payment_failures 등)를 측정 → admin_automation_evaluate 에 전달
--   2) 서버가 enabled/dry_run/killswitch/cooldown/max_runs/중복 command/risk 를 재검증
--   3) mode 판정: suggest(추천만) / approval(승인 Command 생성=admin_action_register 재사용)
--      / auto(승인된 Command 생성 → 프론트가 기존 실행 RPC 재사용 실행)
--   4) admin_automation_runs 에 Audit 기록(dry_run 포함 항상 기록)
--   ※ 이 RPC 는 어떤 도메인 데이터도 변경하지 않는다. 실행은 프론트의 기존 재사용 경로.
-- ============================================

-- 관리자 가드는 0472 의 _admin_growth_guard() 재사용.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Automation Rule 저장소
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.admin_automation_rules (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text,
  domain              text not null check (domain in ('store','player','qc','settlement','user','policy','system')),
  trigger_type        text not null check (trigger_type in ('schedule','metric_threshold','incident','alert','stale_state','count_threshold','manual_test')),
  metric              text,
  operator            text check (operator in ('eq','neq','gt','gte','lt','lte','exists','not_exists')),
  threshold           numeric,
  duration_seconds    int check (duration_seconds is null or duration_seconds >= 0),
  scope               text,
  action_type         text not null,            -- Action 카탈로그 id (store_resync 등)
  action_config       jsonb not null default '{}'::jsonb,
  execution_mode      text not null default 'suggest' check (execution_mode in ('suggest','approval','auto')),
  risk_level          text not null default 'low' check (risk_level in ('low','medium','high','critical')),
  approval_required   boolean not null default true,
  cooldown_seconds    int not null default 1800 check (cooldown_seconds >= 0),
  max_runs_per_day    int not null default 24 check (max_runs_per_day >= 0),
  max_targets_per_run int not null default 50 check (max_targets_per_run >= 0),
  is_enabled          boolean not null default false,
  dry_run             boolean not null default true,
  created_by          uuid,
  updated_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  last_evaluated_at   timestamptz,
  last_triggered_at   timestamptz,
  last_executed_at    timestamptz,
  disabled_reason     text
);

comment on table public.admin_automation_rules is
  'ADMIN-AUTOMATION-1 — 운영 자동화 규칙. 실행은 기존 Action Center Command/RPC 재사용; 이 표는 규칙/게이팅 설정만. 기본값: 비활성+dry_run+suggest.';

create index if not exists idx_automation_rules_domain on public.admin_automation_rules (domain);
create index if not exists idx_automation_rules_enabled on public.admin_automation_rules (is_enabled) where is_enabled;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Kill Switch (global + per-domain). 기본 = 없음 = Auto 차단.
--    scope: 'global' 또는 domain 값. auto_enabled=true 여야 Auto 허용.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.admin_automation_kill_switch (
  scope        text primary key check (scope in ('global','store','player','qc','settlement','user','policy','system')),
  auto_enabled boolean not null default false,
  updated_by   uuid,
  updated_at   timestamptz not null default now()
);

comment on table public.admin_automation_kill_switch is
  'ADMIN-AUTOMATION-1 — Auto 실행 Kill Switch. 행이 없거나 auto_enabled=false 면 Auto 차단(안전 기본값). global + 도메인별.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Automation Run(평가/실행) Audit
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.admin_automation_runs (
  id             uuid primary key default gen_random_uuid(),
  rule_id        uuid references public.admin_automation_rules(id) on delete set null,
  rule_name      text,
  domain         text,
  metric         text,
  actual_value   numeric,
  threshold      numeric,
  condition_met  boolean,
  execution_mode text,
  decision       text not null,   -- not_met / suggested / command_created / auto_executed / blocked
  block_reason   text,
  command_id     uuid,
  target_count   int,
  risk_level     text,
  dry_run        boolean not null default true,
  evaluated_at   timestamptz not null default now(),
  requested_by   uuid
);

comment on table public.admin_automation_runs is
  'ADMIN-AUTOMATION-1 — 자동화 평가/시뮬레이션/실행 Audit. dry_run 포함 항상 기록.';

create index if not exists idx_automation_runs_rule on public.admin_automation_runs (rule_id, evaluated_at desc);
create index if not exists idx_automation_runs_evaluated_at on public.admin_automation_runs (evaluated_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) 규칙 목록
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_automation_rule_list(p_domain text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb)
  into v_result
  from public.admin_automation_rules r
  where p_domain is null or r.domain = p_domain;

  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_automation_rule_list(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) 규칙 생성/수정(upsert). enum whitelist·범위 clamp·안전 기본값 강제.
--    p_id = null → 생성(항상 비활성+dry_run 로 생성해 즉시 실행 방지).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_automation_rule_upsert(p_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_mode text := coalesce(p_payload->>'execution_mode', 'suggest');
  v_risk text := coalesce(p_payload->>'risk_level', 'low');
  v_domain text := p_payload->>'domain';
  v_trigger text := p_payload->>'trigger_type';
  v_operator text := nullif(p_payload->>'operator', '');
  v_cooldown int := greatest(0, coalesce((p_payload->>'cooldown_seconds')::int, 1800));
  v_max_runs int := greatest(0, least(coalesce((p_payload->>'max_runs_per_day')::int, 24), 1000));
  v_max_targets int := greatest(1, least(coalesce((p_payload->>'max_targets_per_run')::int, 50), 500));
  v_row public.admin_automation_rules;
begin
  perform public._admin_growth_guard();

  -- enum whitelist(잘못된 값 거부)
  if v_domain is null or v_domain not in ('store','player','qc','settlement','user','policy','system') then
    raise exception 'invalid domain' using errcode = '22023';
  end if;
  if v_trigger is null or v_trigger not in ('schedule','metric_threshold','incident','alert','stale_state','count_threshold','manual_test') then
    raise exception 'invalid trigger_type' using errcode = '22023';
  end if;
  if v_mode not in ('suggest','approval','auto') then
    raise exception 'invalid execution_mode' using errcode = '22023';
  end if;
  if v_risk not in ('low','medium','high','critical') then
    raise exception 'invalid risk_level' using errcode = '22023';
  end if;
  if v_operator is not null and v_operator not in ('eq','neq','gt','gte','lt','lte','exists','not_exists') then
    raise exception 'invalid operator' using errcode = '22023';
  end if;
  if coalesce(p_payload->>'name','') = '' then
    raise exception 'name required' using errcode = '22023';
  end if;
  if coalesce(p_payload->>'action_type','') = '' then
    raise exception 'action_type required' using errcode = '22023';
  end if;

  if p_id is null then
    -- 신규: 안전 기본값 강제(비활성+dry_run). approval_required 는 low 가 아니면 true 강제.
    insert into public.admin_automation_rules(
      name, description, domain, trigger_type, metric, operator, threshold, duration_seconds, scope,
      action_type, action_config, execution_mode, risk_level, approval_required,
      cooldown_seconds, max_runs_per_day, max_targets_per_run, is_enabled, dry_run, created_by, updated_by
    ) values (
      p_payload->>'name', p_payload->>'description', v_domain, v_trigger,
      nullif(p_payload->>'metric',''), v_operator,
      nullif(p_payload->>'threshold','')::numeric, nullif(p_payload->>'duration_seconds','')::int, nullif(p_payload->>'scope',''),
      p_payload->>'action_type', coalesce(p_payload->'action_config', '{}'::jsonb), v_mode, v_risk,
      case when v_risk = 'low' then coalesce((p_payload->>'approval_required')::boolean, true) else true end,
      v_cooldown, v_max_runs, v_max_targets,
      false, true, auth.uid(), auth.uid()
    )
    returning id into v_id;
  else
    update public.admin_automation_rules set
      name = p_payload->>'name',
      description = p_payload->>'description',
      domain = v_domain,
      trigger_type = v_trigger,
      metric = nullif(p_payload->>'metric',''),
      operator = v_operator,
      threshold = nullif(p_payload->>'threshold','')::numeric,
      duration_seconds = nullif(p_payload->>'duration_seconds','')::int,
      scope = nullif(p_payload->>'scope',''),
      action_type = p_payload->>'action_type',
      action_config = coalesce(p_payload->'action_config', '{}'::jsonb),
      execution_mode = v_mode,
      risk_level = v_risk,
      approval_required = case when v_risk = 'low' then coalesce((p_payload->>'approval_required')::boolean, true) else true end,
      cooldown_seconds = v_cooldown,
      max_runs_per_day = v_max_runs,
      max_targets_per_run = v_max_targets,
      updated_by = auth.uid(),
      updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'rule not found: %', p_id using errcode = 'P0002';
    end if;
  end if;

  select * into v_row from public.admin_automation_rules where id = v_id;
  return to_jsonb(v_row);
end;
$$;

grant execute on function public.admin_automation_rule_upsert(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) 규칙 토글(활성/비활성, dry_run on/off).
--    Auto+dry_run=false 활성화는 위험 → risk_level='low' + 실행 RPC 존재는 프론트에서
--    사전 검증하지만, 서버도 evaluate 단계에서 재차 차단한다(defense-in-depth).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_automation_rule_toggle(
  p_id uuid,
  p_enabled boolean default null,
  p_dry_run boolean default null,
  p_disabled_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.admin_automation_rules;
begin
  perform public._admin_growth_guard();

  update public.admin_automation_rules set
    is_enabled = coalesce(p_enabled, is_enabled),
    dry_run = coalesce(p_dry_run, dry_run),
    disabled_reason = case when p_enabled = false then p_disabled_reason else null end,
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'rule not found: %', p_id using errcode = 'P0002';
  end if;

  return to_jsonb(v_row);
end;
$$;

grant execute on function public.admin_automation_rule_toggle(uuid, boolean, boolean, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Kill Switch 조회/설정
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_automation_kill_switch_get()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_object_agg(scope, auto_enabled), '{}'::jsonb)
  into v_result from public.admin_automation_kill_switch;
  -- global 기본 false(행 없으면 차단)
  return jsonb_build_object(
    'global', coalesce((v_result->>'global')::boolean, false),
    'domains', v_result,
    'generated_at', now()
  );
end;
$$;

grant execute on function public.admin_automation_kill_switch_get() to authenticated;

create or replace function public.admin_automation_kill_switch_set(p_scope text, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._admin_growth_guard();
  if p_scope not in ('global','store','player','qc','settlement','user','policy','system') then
    raise exception 'invalid kill switch scope: %', p_scope using errcode = '22023';
  end if;

  insert into public.admin_automation_kill_switch(scope, auto_enabled, updated_by, updated_at)
  values (p_scope, coalesce(p_enabled, false), auth.uid(), now())
  on conflict (scope) do update
    set auto_enabled = excluded.auto_enabled, updated_by = auth.uid(), updated_at = now();

  return public.admin_automation_kill_switch_get();
end;
$$;

grant execute on function public.admin_automation_kill_switch_set(text, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 조건 평가 헬퍼(operator whitelist).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public._automation_condition_met(
  p_operator text, p_actual numeric, p_threshold numeric
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_operator = 'exists' then return coalesce(p_actual, 0) > 0; end if;
  if p_operator = 'not_exists' then return coalesce(p_actual, 0) = 0; end if;
  if p_actual is null or p_threshold is null then return false; end if;
  return case p_operator
    when 'eq'  then p_actual = p_threshold
    when 'neq' then p_actual <> p_threshold
    when 'gt'  then p_actual > p_threshold
    when 'gte' then p_actual >= p_threshold
    when 'lt'  then p_actual < p_threshold
    when 'lte' then p_actual <= p_threshold
    else false
  end;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) 평가/실행 게이트(핵심). 어떤 도메인 데이터도 변경하지 않는다.
--    p_actual: 프론트가 기존 KPI RPC 로 측정한 실제 지표값(재사용, 추정 금지).
--    p_dry_run: true 면 시뮬레이션(Command 생성 금지, Audit 만).
--    p_supported: 프론트가 판정한 '실행 RPC 존재' 여부(카탈로그 기준).
--    반환 decision: not_met / suggested / command_created / auto_executed / blocked
--      auto_executed = 승인된 Command 생성됨 → 프론트가 기존 실행 RPC 재사용 실행.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_automation_evaluate(
  p_rule_id uuid,
  p_actual numeric,
  p_dry_run boolean default true,
  p_supported boolean default false,
  p_target_id text default null,
  p_target_count int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.admin_automation_rules;
  v_met boolean;
  v_decision text;
  v_block text := null;
  v_command uuid := null;
  v_reg jsonb;
  v_ks jsonb;
  v_global boolean;
  v_domain_on boolean;
  v_runs_today int;
  v_cooldown_ok boolean := true;
  v_effective_dry boolean;
begin
  perform public._admin_growth_guard();

  select * into r from public.admin_automation_rules where id = p_rule_id;
  if r.id is null then
    raise exception 'rule not found: %', p_rule_id using errcode = 'P0002';
  end if;

  -- 규칙 자체 dry_run 이 켜져 있으면 강제로 시뮬레이션(실행 금지).
  v_effective_dry := p_dry_run or r.dry_run;

  v_met := public._automation_condition_met(r.operator, p_actual, r.threshold);

  -- 마지막 평가시각 기록(항상)
  update public.admin_automation_rules set last_evaluated_at = now() where id = r.id;

  if not v_met then
    v_decision := 'not_met';
  elsif not r.is_enabled then
    v_decision := 'blocked'; v_block := '규칙 비활성(is_enabled=false)';
  else
    -- Kill Switch 조회
    select public.admin_automation_kill_switch_get() into v_ks;
    v_global := coalesce((v_ks->>'global')::boolean, false);
    v_domain_on := coalesce((v_ks->'domains'->>r.domain)::boolean, false);

    -- Cooldown(마지막 트리거 이후 cooldown_seconds 경과?)
    if r.last_triggered_at is not null and r.cooldown_seconds > 0 then
      v_cooldown_ok := (now() - r.last_triggered_at) >= make_interval(secs => r.cooldown_seconds);
    end if;

    -- 오늘 실행/생성 횟수(KST 기준)
    select count(*) into v_runs_today
    from public.admin_automation_runs
    where rule_id = r.id
      and decision in ('command_created','auto_executed')
      and (evaluated_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date;

    if v_effective_dry then
      v_decision := 'suggested'; v_block := 'dry_run(시뮬레이션) — 실행 안 함';
    elsif r.execution_mode = 'suggest' then
      v_decision := 'suggested';
    elsif not v_cooldown_ok then
      v_decision := 'blocked'; v_block := 'cooldown 미경과';
    elsif v_runs_today >= r.max_runs_per_day then
      v_decision := 'blocked'; v_block := format('일일 최대 실행(%s) 초과', r.max_runs_per_day);
    elsif not p_supported then
      v_decision := 'blocked'; v_block := '실행 RPC 없음(미지원 Action) — 실행 불가';
    elsif r.execution_mode = 'auto'
          and (r.risk_level <> 'low' or not v_global or not v_domain_on) then
      -- Auto 는 low + Kill Switch(global+domain) 모두 ON 이어야 허용. 하나라도 실패 시 승인 대기로 격하.
      v_decision := 'command_created';
      v_block := case
        when r.risk_level <> 'low' then 'Auto 불가(위험도 low 아님) → 승인 대기'
        when not v_global then 'Auto 불가(Global Kill Switch OFF) → 승인 대기'
        else 'Auto 불가(Domain Kill Switch OFF) → 승인 대기' end;
    elsif r.execution_mode = 'auto' then
      v_decision := 'auto_executed';   -- 승인된 Command 생성 → 프론트가 기존 RPC 재사용 실행
    else
      v_decision := 'command_created'; -- approval 모드
    end if;

    -- Command 생성이 필요한 결정이면 기존 Action Center 등록 RPC 재사용(중복 시 차단).
    if v_decision in ('command_created','auto_executed') then
      begin
        v_reg := public.admin_action_register(
          r.action_type, r.domain, p_target_id,
          format('automation:%s', r.name),
          v_decision = 'auto_executed'  -- auto 는 승인된 것으로 등록
        );
        v_command := (v_reg->>'command_id')::uuid;
        update public.admin_automation_rules
          set last_triggered_at = now(),
              last_executed_at = case when v_decision = 'auto_executed' then now() else last_executed_at end
          where id = r.id;
      exception when others then
        v_decision := 'blocked';
        v_block := format('Command 등록 실패(중복/미적용): %s', sqlerrm);
        v_command := null;
      end;
    end if;
  end if;

  -- Audit 기록(항상)
  insert into public.admin_automation_runs(
    rule_id, rule_name, domain, metric, actual_value, threshold, condition_met,
    execution_mode, decision, block_reason, command_id, target_count, risk_level, dry_run, requested_by
  ) values (
    r.id, r.name, r.domain, r.metric, p_actual, r.threshold, v_met,
    r.execution_mode, v_decision, v_block, v_command,
    least(coalesce(p_target_count, 0), r.max_targets_per_run), r.risk_level, v_effective_dry, auth.uid()
  );

  return jsonb_build_object(
    'ok', true, 'rule_id', r.id, 'condition_met', v_met, 'decision', v_decision,
    'block_reason', v_block, 'command_id', v_command, 'dry_run', v_effective_dry,
    'execution_mode', r.execution_mode, 'risk_level', r.risk_level, 'action_type', r.action_type
  );
end;
$$;

grant execute on function public.admin_automation_evaluate(uuid, numeric, boolean, boolean, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) 자동화 Audit 이력
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_automation_history(
  p_limit int default 50,
  p_rule_id uuid default null,
  p_domain text default null,
  p_dry_run boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 200));
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.evaluated_at desc), '[]'::jsonb)
  into v_result
  from (
    select ru.id, ru.rule_id, ru.rule_name, ru.domain, ru.metric, ru.actual_value, ru.threshold,
           ru.condition_met, ru.execution_mode, ru.decision, ru.block_reason, ru.command_id,
           ru.target_count, ru.risk_level, ru.dry_run, ru.evaluated_at,
           u.nickname as requested_by_name
    from public.admin_automation_runs ru
    left join public.users u on u.id = ru.requested_by
    where (p_rule_id is null or ru.rule_id = p_rule_id)
      and (p_domain is null or ru.domain = p_domain)
      and (p_dry_run is null or ru.dry_run = p_dry_run)
    order by ru.evaluated_at desc
    limit v_limit
  ) t;

  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_automation_history(int, uuid, text, boolean) to authenticated;
