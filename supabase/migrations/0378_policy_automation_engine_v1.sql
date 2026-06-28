-- 0378 — Policy Automation Engine V1 (Priority 3)
--
-- 목표:
--   예약 (scheduled) / 반복 (recurring) / 시즌 (season) / 이벤트 (event) 정책 자동화.
--   하나의 공통 엔진(rules) + 실행 로그(runs). 외부 API/복잡한 cron parser 금지.
--
-- 절대 원칙:
--   - 기존 enterprise_policy_deployments / _targets / 8 RPC 무수정 (재사용만)
--   - apply_franchise_policy / store_heartbeat / store_now_playing / artist /
--     settlement / payment / player / queue / crossfade / AI 무관
--   - V1 외부 API 미호출 (event 는 저장만, 수동 trigger)
--   - 자동 cron 트리거는 향후 Edge Function 에서 admin_evaluate_policy_automation_rules
--     를 cron 호출 (본 migration 은 RPC 만 제공)
--
-- 추가 객체:
--   tables: enterprise_policy_automation_rules / _runs
--   helpers: _policy_automation_compute_next_run / _policy_automation_resolve_target_stores
--   RPCs (9):
--     admin_list_policy_automation_rules
--     admin_policy_automation_kpi
--     admin_create_policy_automation_rule
--     admin_update_policy_automation_rule
--     admin_set_policy_automation_status
--     admin_soft_delete_policy_automation_rule
--     admin_list_policy_automation_runs
--     admin_evaluate_policy_automation_rules     (dry_run/실행)
--     admin_run_policy_automation_rule_now       (단건 즉시)

-- ============================================================
-- 1) Tables
-- ============================================================
create table if not exists public.enterprise_policy_automation_rules (
  id                    uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null references public.enterprise_accounts(id) on delete cascade,
  region_id             uuid references public.enterprise_regions(id) on delete set null,
  policy_id             uuid not null references public.franchise_music_policies(id) on delete restrict,
  rule_type             text not null check (rule_type in ('scheduled','recurring','event','season')),
  name                  text not null,
  description           text,
  status                text not null default 'active' check (status in ('active','paused','expired','disabled')),
  priority              integer not null default 100 check (priority between 1 and 999),
  scope_type            text not null check (scope_type in ('enterprise','region','store')),
  scope_store_ids       uuid[] default null,
  starts_at             timestamptz,
  ends_at               timestamptz,
  timezone              text not null default 'Asia/Seoul',
  recurrence_rule       text,
  event_type            text check (event_type in ('rain','snow','holiday','opening','closing','custom') or event_type is null),
  season                text check (season in ('spring','summer','autumn','winter','christmas') or season is null),
  condition_json        jsonb not null default '{}'::jsonb,
  last_evaluated_at     timestamptz,
  last_triggered_at     timestamptz,
  next_run_at           timestamptz,
  created_by            uuid references auth.users(id) on delete set null,
  updated_by            uuid references auth.users(id) on delete set null,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint epar_ends_after_starts check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create index if not exists idx_epar_enterprise on public.enterprise_policy_automation_rules(enterprise_account_id) where deleted_at is null;
create index if not exists idx_epar_region     on public.enterprise_policy_automation_rules(region_id) where region_id is not null and deleted_at is null;
create index if not exists idx_epar_policy     on public.enterprise_policy_automation_rules(policy_id) where deleted_at is null;
create index if not exists idx_epar_status     on public.enterprise_policy_automation_rules(status) where deleted_at is null;
create index if not exists idx_epar_next_run   on public.enterprise_policy_automation_rules(next_run_at) where deleted_at is null and status = 'active';
create index if not exists idx_epar_type       on public.enterprise_policy_automation_rules(rule_type) where deleted_at is null;

create table if not exists public.enterprise_policy_automation_runs (
  id                    uuid primary key default gen_random_uuid(),
  rule_id               uuid not null references public.enterprise_policy_automation_rules(id) on delete cascade,
  enterprise_account_id uuid references public.enterprise_accounts(id) on delete set null,
  deployment_id         uuid references public.enterprise_policy_deployments(id) on delete set null,
  status                text not null default 'pending' check (status in ('pending','running','completed','failed','skipped')),
  target_store_count    integer not null default 0 check (target_store_count >= 0),
  success_count         integer not null default 0 check (success_count >= 0),
  failed_count          integer not null default 0 check (failed_count >= 0),
  skipped_count         integer not null default 0 check (skipped_count >= 0),
  dry_run               boolean not null default false,
  started_at            timestamptz not null default now(),
  completed_at          timestamptz,
  error_message         text,
  details               jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

create index if not exists idx_epar_run_rule    on public.enterprise_policy_automation_runs(rule_id);
create index if not exists idx_epar_run_enterprise on public.enterprise_policy_automation_runs(enterprise_account_id);
create index if not exists idx_epar_run_status  on public.enterprise_policy_automation_runs(status);
create index if not exists idx_epar_run_started on public.enterprise_policy_automation_runs(started_at desc);

-- _touch_updated_at trigger (기존 0349 와 동일 패턴)
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_epar_updated_at') then
    create trigger trg_epar_updated_at
      before update on public.enterprise_policy_automation_rules
      for each row execute function public._touch_updated_at();
  end if;
end$$;

-- ============================================================
-- 2) RLS
-- ============================================================
alter table public.enterprise_policy_automation_rules enable row level security;
alter table public.enterprise_policy_automation_runs  enable row level security;

drop policy if exists epar_select on public.enterprise_policy_automation_rules;
create policy epar_select on public.enterprise_policy_automation_rules
  for select to authenticated
  using (
    public._is_super_admin()
    or exists (
      select 1 from public.enterprise_accounts ea
       where ea.id = enterprise_policy_automation_rules.enterprise_account_id
         and ea.auth_user_id = auth.uid()
    )
  );

drop policy if exists epar_runs_select on public.enterprise_policy_automation_runs;
create policy epar_runs_select on public.enterprise_policy_automation_runs
  for select to authenticated
  using (
    public._is_super_admin()
    or exists (
      select 1 from public.enterprise_accounts ea
       where ea.id = enterprise_policy_automation_runs.enterprise_account_id
         and ea.auth_user_id = auth.uid()
    )
  );

revoke insert, update, delete on public.enterprise_policy_automation_rules from authenticated, anon;
revoke insert, update, delete on public.enterprise_policy_automation_runs  from authenticated, anon;

-- ============================================================
-- 3) Helper — recurrence / season next_run calculator
-- ============================================================
create or replace function public._policy_automation_compute_next_run(
  p_rule_type         text,
  p_recurrence_rule   text,
  p_starts_at         timestamptz,
  p_ends_at           timestamptz,
  p_season            text,
  p_last_triggered_at timestamptz,
  p_now               timestamptz default now(),
  p_tz                text default 'Asia/Seoul'
) returns timestamptz
language plpgsql
immutable
as $$
declare
  v_local_now   timestamp;
  v_today_local date;
  v_parts       text[];
  v_dow_token   text;
  v_dow_num     int;
  v_target_dow  int;
  v_hour        int;
  v_minute      int;
  v_day         int;
  v_year        int;
  v_candidate   timestamptz;
  v_days_ahead  int;
  v_season_start date;
  v_season_end   date;
begin
  -- Scheduled: one-shot
  if p_rule_type = 'scheduled' then
    if p_last_triggered_at is not null then return null; end if;
    if p_starts_at is null then return null; end if;
    if p_ends_at is not null and p_ends_at < p_now then return null; end if;
    return p_starts_at;
  end if;

  -- Event: V1 no auto-schedule (manual trigger only)
  if p_rule_type = 'event' then
    return null;
  end if;

  -- Season
  if p_rule_type = 'season' then
    if p_season is null then return null; end if;
    -- explicit range overrides default
    if p_starts_at is not null and p_ends_at is not null then
      if p_now between p_starts_at and p_ends_at then return p_now; end if;
      if p_now < p_starts_at then return p_starts_at; end if;
      return null;
    end if;
    v_year := extract(year from p_now at time zone p_tz)::int;
    if p_season = 'spring' then
      v_season_start := make_date(v_year, 3, 1);
      v_season_end   := make_date(v_year, 5, 31);
    elsif p_season = 'summer' then
      v_season_start := make_date(v_year, 6, 1);
      v_season_end   := make_date(v_year, 8, 31);
    elsif p_season = 'autumn' then
      v_season_start := make_date(v_year, 9, 1);
      v_season_end   := make_date(v_year, 11, 30);
    elsif p_season = 'winter' then
      v_season_start := make_date(v_year, 12, 1);
      v_season_end   := make_date(v_year + 1, 2, 28);
    elsif p_season = 'christmas' then
      v_season_start := make_date(v_year, 12, 1);
      v_season_end   := make_date(v_year, 12, 25);
    else
      return null;
    end if;
    if (p_now at time zone p_tz)::date between v_season_start and v_season_end then
      return p_now;
    elsif (p_now at time zone p_tz)::date < v_season_start then
      return (v_season_start::timestamp) at time zone p_tz;
    else
      -- next year's start
      return (make_date(v_year + 1, extract(month from v_season_start)::int, extract(day from v_season_start)::int)::timestamp) at time zone p_tz;
    end if;
  end if;

  -- Recurring
  if p_rule_type = 'recurring' then
    if p_recurrence_rule is null then return null; end if;
    v_parts       := string_to_array(p_recurrence_rule, ':');
    v_local_now   := (p_now at time zone p_tz);
    v_today_local := v_local_now::date;

    if v_parts[1] = 'daily' and array_length(v_parts, 1) >= 3 then
      v_hour   := v_parts[2]::int;
      v_minute := v_parts[3]::int;
      v_candidate := (v_today_local + make_time(v_hour, v_minute, 0)) at time zone p_tz;
      if v_candidate <= p_now then
        v_candidate := ((v_today_local + 1) + make_time(v_hour, v_minute, 0)) at time zone p_tz;
      end if;
      return v_candidate;

    elsif v_parts[1] = 'weekly' and array_length(v_parts, 1) >= 4 then
      v_dow_token := upper(v_parts[2]);
      v_target_dow := case v_dow_token
        when 'SUN' then 0 when 'MON' then 1 when 'TUE' then 2 when 'WED' then 3
        when 'THU' then 4 when 'FRI' then 5 when 'SAT' then 6 else null end;
      if v_target_dow is null then return null; end if;
      v_hour       := v_parts[3]::int;
      v_minute     := v_parts[4]::int;
      v_dow_num    := extract(dow from v_local_now)::int;
      v_days_ahead := (v_target_dow - v_dow_num + 7) % 7;
      v_candidate  := ((v_today_local + v_days_ahead) + make_time(v_hour, v_minute, 0)) at time zone p_tz;
      if v_days_ahead = 0 and v_candidate <= p_now then
        v_candidate := ((v_today_local + 7) + make_time(v_hour, v_minute, 0)) at time zone p_tz;
      end if;
      return v_candidate;

    elsif v_parts[1] = 'monthly' and array_length(v_parts, 1) >= 4 then
      v_day    := v_parts[2]::int;
      v_hour   := v_parts[3]::int;
      v_minute := v_parts[4]::int;
      v_candidate := (date_trunc('month', v_today_local)::date + (v_day - 1) + make_time(v_hour, v_minute, 0)) at time zone p_tz;
      if v_candidate <= p_now then
        v_candidate := (date_trunc('month', (v_today_local + interval '1 month'))::date + (v_day - 1) + make_time(v_hour, v_minute, 0)) at time zone p_tz;
      end if;
      return v_candidate;
    end if;

    return null;
  end if;

  return null;
exception when others then
  return null;
end;
$$;

-- ============================================================
-- 4) Helper — store_ids 해석 (scope 기반)
-- ============================================================
create or replace function public._policy_automation_resolve_target_stores(
  p_scope_type            text,
  p_region_id             uuid,
  p_store_ids             uuid[],
  p_policy_id             uuid
) returns uuid[]
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_franchise_id uuid;
  v_result       uuid[];
begin
  select franchise_id into v_franchise_id from public.franchise_music_policies where id = p_policy_id;
  if v_franchise_id is null then return ARRAY[]::uuid[]; end if;

  if p_scope_type = 'enterprise' then
    -- V1: 정책 소속 franchise 의 모든 active 매장
    select array_agg(distinct fs.store_id) into v_result
      from public.franchise_stores fs
     where fs.franchise_id = v_franchise_id and fs.status = 'active';

  elsif p_scope_type = 'region' then
    if p_region_id is null then return ARRAY[]::uuid[]; end if;
    -- enterprise_region 은 store_policy_sync_status 에서 tag 됨 — heartbeat 보고 매장만 포함
    select array_agg(distinct fs.store_id) into v_result
      from public.franchise_stores fs
      join public.store_policy_sync_status sps on sps.store_id = fs.store_id
     where fs.franchise_id = v_franchise_id
       and fs.status = 'active'
       and sps.enterprise_region_id = p_region_id;

  elsif p_scope_type = 'store' then
    if p_store_ids is null or array_length(p_store_ids, 1) = 0 then return ARRAY[]::uuid[]; end if;
    select array_agg(distinct fs.store_id) into v_result
      from public.franchise_stores fs
     where fs.franchise_id = v_franchise_id
       and fs.status = 'active'
       and fs.store_id = any(p_store_ids);
  end if;

  return coalesce(v_result, ARRAY[]::uuid[]);
end;
$$;

-- ============================================================
-- 5) RPCs
-- ============================================================

-- 5.1 list rules ------------------------------------------------------------
create or replace function public.admin_list_policy_automation_rules(
  p_search                text default null,
  p_rule_type             text default null,
  p_status                text default null,
  p_scope_type            text default null,
  p_enterprise_account_id uuid default null,
  p_region_id             uuid default null,
  p_limit                 int  default 50,
  p_offset                int  default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_limit  int := coalesce(nullif(p_limit, 0), 50);
  v_offset int := coalesce(p_offset, 0);
  v_total  int;
  v_rows   jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  with base as (
    select r.*,
           p.name as policy_name,
           p.status as policy_status,
           ea.enterprise_name,
           er.region_name,
           er.region_code,
           (
             select count(*) from public.enterprise_policy_automation_runs run
              where run.rule_id = r.id
           ) as run_count,
           (
             select max(run.started_at) from public.enterprise_policy_automation_runs run
              where run.rule_id = r.id
           ) as last_run_at
      from public.enterprise_policy_automation_rules r
      left join public.franchise_music_policies p   on p.id = r.policy_id
      left join public.enterprise_accounts ea       on ea.id = r.enterprise_account_id
      left join public.enterprise_regions er        on er.id = r.region_id
     where r.deleted_at is null
       and (p_rule_type             is null or r.rule_type = p_rule_type)
       and (p_status                is null or r.status = p_status)
       and (p_scope_type            is null or r.scope_type = p_scope_type)
       and (p_enterprise_account_id is null or r.enterprise_account_id = p_enterprise_account_id)
       and (p_region_id             is null or r.region_id = p_region_id)
       and (
         p_search is null
         or r.name ilike '%' || p_search || '%'
         or coalesce(r.description, '') ilike '%' || p_search || '%'
         or coalesce(p.name, '') ilike '%' || p_search || '%'
         or coalesce(ea.enterprise_name, '') ilike '%' || p_search || '%'
       )
  )
  select
    count(*) over (),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'enterprise_account_id', b.enterprise_account_id,
          'enterprise_name', b.enterprise_name,
          'region_id', b.region_id,
          'region_name', b.region_name,
          'region_code', b.region_code,
          'policy_id', b.policy_id,
          'policy_name', b.policy_name,
          'policy_status', b.policy_status,
          'rule_type', b.rule_type,
          'name', b.name,
          'description', b.description,
          'status', b.status,
          'priority', b.priority,
          'scope_type', b.scope_type,
          'scope_store_ids', b.scope_store_ids,
          'starts_at', b.starts_at,
          'ends_at', b.ends_at,
          'timezone', b.timezone,
          'recurrence_rule', b.recurrence_rule,
          'event_type', b.event_type,
          'season', b.season,
          'condition_json', b.condition_json,
          'last_evaluated_at', b.last_evaluated_at,
          'last_triggered_at', b.last_triggered_at,
          'next_run_at', b.next_run_at,
          'run_count', b.run_count,
          'last_run_at', b.last_run_at,
          'created_at', b.created_at,
          'updated_at', b.updated_at
        )
        order by
          case when b.status = 'active' then 0 else 1 end,
          b.next_run_at asc nulls last,
          b.updated_at desc
      ),
      '[]'::jsonb
    )
  into v_total, v_rows
  from (
    select * from base
     order by case when status = 'active' then 0 else 1 end,
              next_run_at asc nulls last,
              updated_at desc
     limit v_limit offset v_offset
  ) b;

  return jsonb_build_object(
    'success', true,
    'data', coalesce(v_rows, '[]'::jsonb),
    'pagination', jsonb_build_object(
      'total', coalesce(v_total, 0),
      'limit', v_limit,
      'offset', v_offset,
      'has_more', coalesce(v_total, 0) > (v_offset + v_limit)
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_list_policy_automation_rules(text,text,text,text,uuid,uuid,int,int) from public, anon;
grant   execute on function public.admin_list_policy_automation_rules(text,text,text,text,uuid,uuid,int,int) to authenticated;

-- 5.2 KPI -------------------------------------------------------------------
create or replace function public.admin_policy_automation_kpi()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_recent_7d timestamptz := now() - interval '7 days';
  v_next_24h  timestamptz := now() + interval '24 hours';
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  return jsonb_build_object(
    'total_rules',     (select count(*) from public.enterprise_policy_automation_rules where deleted_at is null),
    'active_rules',    (select count(*) from public.enterprise_policy_automation_rules where deleted_at is null and status = 'active'),
    'paused_rules',    (select count(*) from public.enterprise_policy_automation_rules where deleted_at is null and status = 'paused'),
    'disabled_rules',  (select count(*) from public.enterprise_policy_automation_rules where deleted_at is null and status = 'disabled'),
    'expired_rules',   (select count(*) from public.enterprise_policy_automation_rules where deleted_at is null and status = 'expired'),
    'upcoming_24h', (
      select count(*) from public.enterprise_policy_automation_rules
       where deleted_at is null and status = 'active'
         and next_run_at is not null
         and next_run_at <= v_next_24h
         and next_run_at >= now()
    ),
    'recent_7d_runs',  (select count(*) from public.enterprise_policy_automation_runs where started_at >= v_recent_7d),
    'failed_runs_7d',  (select count(*) from public.enterprise_policy_automation_runs where started_at >= v_recent_7d and status = 'failed'),
    'next_run_at', (
      select min(next_run_at) from public.enterprise_policy_automation_rules
       where deleted_at is null and status = 'active' and next_run_at is not null and next_run_at >= now()
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_policy_automation_kpi() from public, anon;
grant   execute on function public.admin_policy_automation_kpi() to authenticated;

-- 5.3 create rule -----------------------------------------------------------
create or replace function public.admin_create_policy_automation_rule(
  p_enterprise_account_id uuid,
  p_policy_id             uuid,
  p_name                  text,
  p_rule_type             text,
  p_scope_type            text,
  p_region_id             uuid     default null,
  p_scope_store_ids       uuid[]   default null,
  p_description           text     default null,
  p_status                text     default 'active',
  p_priority              int      default 100,
  p_starts_at             timestamptz default null,
  p_ends_at               timestamptz default null,
  p_timezone              text     default 'Asia/Seoul',
  p_recurrence_rule       text     default null,
  p_event_type            text     default null,
  p_season                text     default null,
  p_condition_json        jsonb    default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id          uuid;
  v_next_run_at timestamptz;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  -- Validation
  if p_enterprise_account_id is null then raise exception 'enterprise_account_id required'; end if;
  if p_policy_id is null then raise exception 'policy_id required'; end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then raise exception 'name required'; end if;
  if p_rule_type not in ('scheduled','recurring','event','season') then raise exception 'invalid rule_type: %', p_rule_type; end if;
  if p_scope_type not in ('enterprise','region','store') then raise exception 'invalid scope_type: %', p_scope_type; end if;
  if p_priority is null or p_priority < 1 or p_priority > 999 then raise exception 'priority must be 1..999'; end if;
  if p_rule_type = 'scheduled' and p_starts_at is null then raise exception 'scheduled rule requires starts_at'; end if;
  if p_rule_type = 'recurring' and nullif(btrim(coalesce(p_recurrence_rule, '')), '') is null then raise exception 'recurring rule requires recurrence_rule'; end if;
  if p_rule_type = 'season'    and nullif(btrim(coalesce(p_season, '')), '')         is null then raise exception 'season rule requires season'; end if;
  if p_rule_type = 'event'     and nullif(btrim(coalesce(p_event_type, '')), '')     is null then raise exception 'event rule requires event_type'; end if;
  if p_scope_type = 'region' and p_region_id is null then raise exception 'region scope requires region_id'; end if;
  if p_scope_type = 'store'  and (p_scope_store_ids is null or array_length(p_scope_store_ids, 1) = 0) then
    raise exception 'store scope requires non-empty scope_store_ids';
  end if;
  if p_ends_at is not null and p_starts_at is not null and p_ends_at < p_starts_at then
    raise exception 'ends_at must be >= starts_at';
  end if;

  v_next_run_at := public._policy_automation_compute_next_run(
    p_rule_type, p_recurrence_rule, p_starts_at, p_ends_at, p_season, null, now(), p_timezone
  );

  insert into public.enterprise_policy_automation_rules (
    enterprise_account_id, region_id, policy_id, rule_type, name, description, status, priority,
    scope_type, scope_store_ids, starts_at, ends_at, timezone, recurrence_rule, event_type, season,
    condition_json, next_run_at, created_by, updated_by
  ) values (
    p_enterprise_account_id, p_region_id, p_policy_id, p_rule_type, p_name, p_description,
    coalesce(p_status, 'active'), p_priority,
    p_scope_type, p_scope_store_ids, p_starts_at, p_ends_at, coalesce(p_timezone, 'Asia/Seoul'),
    p_recurrence_rule, p_event_type, p_season, coalesce(p_condition_json, '{}'::jsonb),
    v_next_run_at, auth.uid(), auth.uid()
  ) returning id into v_id;

  perform public.admin_log_operation(
    'policy_automation', 'policy_automation.rule.create', 'info', 'created',
    format('rule created — type=%s scope=%s', p_rule_type, p_scope_type),
    jsonb_build_object(
      'rule_id', v_id, 'rule_type', p_rule_type, 'policy_id', p_policy_id,
      'enterprise_account_id', p_enterprise_account_id, 'region_id', p_region_id,
      'next_run_at', v_next_run_at
    ),
    auth.uid(), v_id::text, null, null, null
  );

  return jsonb_build_object('success', true, 'rule_id', v_id, 'next_run_at', v_next_run_at);
end;
$$;
revoke execute on function public.admin_create_policy_automation_rule(uuid,uuid,text,text,text,uuid,uuid[],text,text,int,timestamptz,timestamptz,text,text,text,text,jsonb) from public, anon;
grant   execute on function public.admin_create_policy_automation_rule(uuid,uuid,text,text,text,uuid,uuid[],text,text,int,timestamptz,timestamptz,text,text,text,text,jsonb) to authenticated;

-- 5.4 update rule -----------------------------------------------------------
create or replace function public.admin_update_policy_automation_rule(
  p_id                    uuid,
  p_name                  text default null,
  p_description           text default null,
  p_priority              int  default null,
  p_status                text default null,
  p_starts_at             timestamptz default null,
  p_ends_at               timestamptz default null,
  p_timezone              text default null,
  p_recurrence_rule       text default null,
  p_event_type            text default null,
  p_season                text default null,
  p_region_id             uuid default null,
  p_scope_type            text default null,
  p_scope_store_ids       uuid[] default null,
  p_policy_id             uuid default null,
  p_condition_json        jsonb default null,
  p_clear_region          boolean default false,
  p_clear_scope_stores    boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cur public.enterprise_policy_automation_rules%rowtype;
  v_new_starts timestamptz;
  v_new_ends   timestamptz;
  v_new_type   text;
  v_new_rec    text;
  v_new_season text;
  v_new_tz     text;
  v_next_run_at timestamptz;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_id is null then raise exception 'id required'; end if;

  select * into v_cur from public.enterprise_policy_automation_rules where id = p_id and deleted_at is null;
  if v_cur.id is null then raise exception 'rule not found: %', p_id; end if;

  if p_priority is not null and (p_priority < 1 or p_priority > 999) then
    raise exception 'priority must be 1..999';
  end if;
  if p_status is not null and p_status not in ('active','paused','expired','disabled') then
    raise exception 'invalid status: %', p_status;
  end if;
  if p_scope_type is not null and p_scope_type not in ('enterprise','region','store') then
    raise exception 'invalid scope_type: %', p_scope_type;
  end if;

  v_new_starts := coalesce(p_starts_at, v_cur.starts_at);
  v_new_ends   := coalesce(p_ends_at,   v_cur.ends_at);
  v_new_type   := v_cur.rule_type; -- rule_type 변경 금지 (V1)
  v_new_rec    := coalesce(p_recurrence_rule, v_cur.recurrence_rule);
  v_new_season := coalesce(p_season,        v_cur.season);
  v_new_tz     := coalesce(p_timezone,      v_cur.timezone);

  if v_new_ends is not null and v_new_starts is not null and v_new_ends < v_new_starts then
    raise exception 'ends_at must be >= starts_at';
  end if;

  v_next_run_at := public._policy_automation_compute_next_run(
    v_new_type, v_new_rec, v_new_starts, v_new_ends, v_new_season, v_cur.last_triggered_at, now(), v_new_tz
  );

  update public.enterprise_policy_automation_rules
     set name             = coalesce(p_name, name),
         description      = coalesce(p_description, description),
         priority         = coalesce(p_priority, priority),
         status           = coalesce(p_status, status),
         starts_at        = v_new_starts,
         ends_at          = v_new_ends,
         timezone         = v_new_tz,
         recurrence_rule  = v_new_rec,
         event_type       = coalesce(p_event_type, event_type),
         season           = v_new_season,
         region_id        = case when p_clear_region then null else coalesce(p_region_id, region_id) end,
         scope_type       = coalesce(p_scope_type, scope_type),
         scope_store_ids  = case when p_clear_scope_stores then null else coalesce(p_scope_store_ids, scope_store_ids) end,
         policy_id        = coalesce(p_policy_id, policy_id),
         condition_json   = coalesce(p_condition_json, condition_json),
         next_run_at      = v_next_run_at,
         updated_by       = auth.uid(),
         updated_at       = now()
   where id = p_id;

  perform public.admin_log_operation(
    'policy_automation', 'policy_automation.rule.update', 'info', 'updated',
    format('rule updated — id=%s', p_id),
    jsonb_build_object('rule_id', p_id, 'next_run_at', v_next_run_at),
    auth.uid(), p_id::text, null, null, null
  );

  return jsonb_build_object('success', true, 'rule_id', p_id, 'next_run_at', v_next_run_at);
end;
$$;
revoke execute on function public.admin_update_policy_automation_rule(uuid,text,text,int,text,timestamptz,timestamptz,text,text,text,text,uuid,text,uuid[],uuid,jsonb,boolean,boolean) from public, anon;
grant   execute on function public.admin_update_policy_automation_rule(uuid,text,text,int,text,timestamptz,timestamptz,text,text,text,text,uuid,text,uuid[],uuid,jsonb,boolean,boolean) to authenticated;

-- 5.5 set status ------------------------------------------------------------
create or replace function public.admin_set_policy_automation_status(
  p_id     uuid,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_prev text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_status not in ('active','paused','expired','disabled') then raise exception 'invalid status: %', p_status; end if;

  select status into v_prev from public.enterprise_policy_automation_rules where id = p_id and deleted_at is null;
  if v_prev is null then raise exception 'rule not found: %', p_id; end if;

  update public.enterprise_policy_automation_rules
     set status = p_status, updated_by = auth.uid(), updated_at = now()
   where id = p_id;

  perform public.admin_log_operation(
    'policy_automation', 'policy_automation.rule.status', 'info', p_status,
    format('rule status %s → %s', v_prev, p_status),
    jsonb_build_object('rule_id', p_id, 'previous_status', v_prev, 'new_status', p_status),
    auth.uid(), p_id::text, null, null, null
  );

  return jsonb_build_object('success', true, 'rule_id', p_id, 'status', p_status, 'previous_status', v_prev);
end;
$$;
revoke execute on function public.admin_set_policy_automation_status(uuid, text) from public, anon;
grant   execute on function public.admin_set_policy_automation_status(uuid, text) to authenticated;

-- 5.6 soft delete -----------------------------------------------------------
create or replace function public.admin_soft_delete_policy_automation_rule(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  update public.enterprise_policy_automation_rules
     set deleted_at = now(), status = 'disabled', updated_by = auth.uid(), updated_at = now()
   where id = p_id and deleted_at is null;
  if not found then raise exception 'rule not found or already deleted: %', p_id; end if;

  perform public.admin_log_operation(
    'policy_automation', 'policy_automation.rule.delete', 'warning', 'deleted',
    format('rule soft-deleted — id=%s', p_id),
    jsonb_build_object('rule_id', p_id),
    auth.uid(), p_id::text, null, null, null
  );

  return jsonb_build_object('success', true, 'rule_id', p_id);
end;
$$;
revoke execute on function public.admin_soft_delete_policy_automation_rule(uuid) from public, anon;
grant   execute on function public.admin_soft_delete_policy_automation_rule(uuid) to authenticated;

-- 5.7 list runs -------------------------------------------------------------
create or replace function public.admin_list_policy_automation_runs(
  p_rule_id               uuid default null,
  p_status                text default null,
  p_enterprise_account_id uuid default null,
  p_from                  timestamptz default null,
  p_to                    timestamptz default null,
  p_limit                 int  default 50,
  p_offset                int  default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_limit  int := coalesce(nullif(p_limit, 0), 50);
  v_offset int := coalesce(p_offset, 0);
  v_total  int;
  v_rows   jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  with base as (
    select run.*,
           r.name as rule_name,
           r.rule_type,
           ea.enterprise_name,
           d.deployment_name,
           d.target_store_count as deployment_target_count,
           d.success_count      as deployment_success_count,
           d.failed_count       as deployment_failed_count,
           d.status             as deployment_status
      from public.enterprise_policy_automation_runs run
      left join public.enterprise_policy_automation_rules r on r.id = run.rule_id
      left join public.enterprise_accounts ea on ea.id = run.enterprise_account_id
      left join public.enterprise_policy_deployments d on d.id = run.deployment_id
     where (p_rule_id               is null or run.rule_id = p_rule_id)
       and (p_status                is null or run.status = p_status)
       and (p_enterprise_account_id is null or run.enterprise_account_id = p_enterprise_account_id)
       and (p_from is null or run.started_at >= p_from)
       and (p_to   is null or run.started_at <= p_to)
  )
  select
    count(*) over (),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'rule_id', b.rule_id,
          'rule_name', b.rule_name,
          'rule_type', b.rule_type,
          'enterprise_account_id', b.enterprise_account_id,
          'enterprise_name', b.enterprise_name,
          'deployment_id', b.deployment_id,
          'deployment_name', b.deployment_name,
          'deployment_status', b.deployment_status,
          'deployment_target_count', b.deployment_target_count,
          'deployment_success_count', b.deployment_success_count,
          'deployment_failed_count', b.deployment_failed_count,
          'status', b.status,
          'target_store_count', b.target_store_count,
          'success_count', b.success_count,
          'failed_count', b.failed_count,
          'skipped_count', b.skipped_count,
          'dry_run', b.dry_run,
          'started_at', b.started_at,
          'completed_at', b.completed_at,
          'error_message', b.error_message,
          'details', b.details
        )
        order by b.started_at desc
      ),
      '[]'::jsonb
    )
  into v_total, v_rows
  from (
    select * from base
     order by started_at desc
     limit v_limit offset v_offset
  ) b;

  return jsonb_build_object(
    'success', true,
    'data', coalesce(v_rows, '[]'::jsonb),
    'pagination', jsonb_build_object(
      'total', coalesce(v_total, 0),
      'limit', v_limit,
      'offset', v_offset,
      'has_more', coalesce(v_total, 0) > (v_offset + v_limit)
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_list_policy_automation_runs(uuid,text,uuid,timestamptz,timestamptz,int,int) from public, anon;
grant   execute on function public.admin_list_policy_automation_runs(uuid,text,uuid,timestamptz,timestamptz,int,int) to authenticated;

-- 5.8 evaluate (batch) — dry_run or actual ---------------------------------
create or replace function public.admin_evaluate_policy_automation_rules(
  p_dry_run boolean default true,
  p_now_at  timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rule           public.enterprise_policy_automation_rules%rowtype;
  v_results        jsonb := '[]'::jsonb;
  v_processed      int := 0;
  v_executed       int := 0;
  v_skipped        int := 0;
  v_failed         int := 0;
  v_store_ids      uuid[];
  v_target_count   int;
  v_deployment_id  uuid;
  v_run_id         uuid;
  v_deploy_result  jsonb;
  v_next_run       timestamptz;
  v_item           jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  for v_rule in
    select * from public.enterprise_policy_automation_rules
     where deleted_at is null
       and status = 'active'
       and rule_type in ('scheduled','recurring','season')  -- event 는 자동 평가 제외 (V1)
       and next_run_at is not null
       and next_run_at <= p_now_at
     order by priority asc, updated_at desc
  loop
    v_processed := v_processed + 1;
    v_item := jsonb_build_object(
      'rule_id', v_rule.id,
      'rule_name', v_rule.name,
      'rule_type', v_rule.rule_type,
      'next_run_at', v_rule.next_run_at
    );

    -- 1) 대상 매장 해석
    v_store_ids := public._policy_automation_resolve_target_stores(
      v_rule.scope_type, v_rule.region_id, v_rule.scope_store_ids, v_rule.policy_id
    );
    v_target_count := coalesce(array_length(v_store_ids, 1), 0);

    if v_target_count = 0 then
      v_skipped := v_skipped + 1;
      v_item := v_item || jsonb_build_object('status', 'skipped', 'reason', 'no target stores', 'target_count', 0);
      v_results := v_results || jsonb_build_array(v_item);

      if not p_dry_run then
        insert into public.enterprise_policy_automation_runs (
          rule_id, enterprise_account_id, status, target_store_count, dry_run,
          started_at, completed_at, error_message, details
        ) values (
          v_rule.id, v_rule.enterprise_account_id, 'skipped', 0, false,
          p_now_at, p_now_at, 'no target stores',
          jsonb_build_object('reason','no_targets','rule_type',v_rule.rule_type)
        );
        update public.enterprise_policy_automation_rules
           set last_evaluated_at = p_now_at,
               next_run_at = public._policy_automation_compute_next_run(
                 v_rule.rule_type, v_rule.recurrence_rule, v_rule.starts_at, v_rule.ends_at,
                 v_rule.season, v_rule.last_triggered_at, p_now_at, v_rule.timezone)
         where id = v_rule.id;
      end if;
      continue;
    end if;

    v_item := v_item || jsonb_build_object('target_count', v_target_count);

    if p_dry_run then
      v_executed := v_executed + 1;
      v_item := v_item || jsonb_build_object(
        'status', 'preview',
        'sample_store_ids', to_jsonb(v_store_ids[1:least(5, v_target_count)])
      );
      v_results := v_results || jsonb_build_array(v_item);
      continue;
    end if;

    -- 2) 실제 실행 — pending run row 생성
    insert into public.enterprise_policy_automation_runs (
      rule_id, enterprise_account_id, status, target_store_count, dry_run,
      started_at, details
    ) values (
      v_rule.id, v_rule.enterprise_account_id, 'running', v_target_count, false, p_now_at,
      jsonb_build_object('rule_type', v_rule.rule_type, 'scope_type', v_rule.scope_type)
    ) returning id into v_run_id;

    begin
      -- 기존 admin_create_policy_deployment 재사용
      v_deploy_result := public.admin_create_policy_deployment(
        v_rule.policy_id,
        format('[자동] %s — %s', v_rule.name, to_char(p_now_at at time zone v_rule.timezone, 'YYYY-MM-DD HH24:MI')),
        v_store_ids,
        v_rule.enterprise_account_id
      );
      v_deployment_id := (v_deploy_result ->> 'deployment_id')::uuid;

      v_next_run := public._policy_automation_compute_next_run(
        v_rule.rule_type, v_rule.recurrence_rule, v_rule.starts_at, v_rule.ends_at,
        v_rule.season, p_now_at, p_now_at, v_rule.timezone
      );

      update public.enterprise_policy_automation_runs
         set status = 'completed', completed_at = now(), deployment_id = v_deployment_id,
             success_count = coalesce((v_deploy_result ->> 'target_store_count')::int, 0),
             details = details || jsonb_build_object('deployment_id', v_deployment_id, 'deploy_result', v_deploy_result)
       where id = v_run_id;

      update public.enterprise_policy_automation_rules
         set last_evaluated_at = p_now_at,
             last_triggered_at = p_now_at,
             next_run_at       = v_next_run,
             -- scheduled 1회성 rule 은 실행 직후 expired 처리 (next_run_at = null 보장)
             status            = case when v_rule.rule_type = 'scheduled' then 'expired' else status end
       where id = v_rule.id;

      v_executed := v_executed + 1;
      v_item := v_item || jsonb_build_object('status', 'executed', 'deployment_id', v_deployment_id, 'run_id', v_run_id);
      v_results := v_results || jsonb_build_array(v_item);

      perform public.admin_log_operation(
        'policy_automation', 'policy_automation.run.completed', 'success', 'completed',
        format('rule executed — %s', v_rule.name),
        jsonb_build_object('rule_id', v_rule.id, 'deployment_id', v_deployment_id, 'run_id', v_run_id, 'target_count', v_target_count),
        auth.uid(), v_rule.id::text, null, null, null
      );

    exception when others then
      v_failed := v_failed + 1;
      update public.enterprise_policy_automation_runs
         set status = 'failed', completed_at = now(), error_message = sqlerrm
       where id = v_run_id;
      update public.enterprise_policy_automation_rules
         set last_evaluated_at = p_now_at
       where id = v_rule.id;

      v_item := v_item || jsonb_build_object('status', 'failed', 'run_id', v_run_id, 'error', sqlerrm);
      v_results := v_results || jsonb_build_array(v_item);

      perform public.admin_log_operation(
        'policy_automation', 'policy_automation.run.failed', 'error', 'failed',
        format('rule failed — %s', v_rule.name),
        jsonb_build_object('rule_id', v_rule.id, 'run_id', v_run_id, 'error', sqlerrm),
        auth.uid(), v_rule.id::text, null, null, sqlerrm
      );
    end;
  end loop;

  perform public.admin_log_operation(
    'policy_automation', 'policy_automation.evaluate', 'info',
    case when p_dry_run then 'dry_run' else 'executed' end,
    format('evaluate — processed=%s executed=%s skipped=%s failed=%s', v_processed, v_executed, v_skipped, v_failed),
    jsonb_build_object('dry_run', p_dry_run, 'now_at', p_now_at, 'processed', v_processed),
    auth.uid(), null, null, null, null
  );

  return jsonb_build_object(
    'success', true,
    'dry_run', p_dry_run,
    'now_at', p_now_at,
    'processed', v_processed,
    'executed', v_executed,
    'skipped', v_skipped,
    'failed', v_failed,
    'results', v_results
  );
end;
$$;
revoke execute on function public.admin_evaluate_policy_automation_rules(boolean, timestamptz) from public, anon;
grant   execute on function public.admin_evaluate_policy_automation_rules(boolean, timestamptz) to authenticated;

-- 5.9 run rule now (single) ------------------------------------------------
create or replace function public.admin_run_policy_automation_rule_now(
  p_rule_id uuid,
  p_dry_run boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rule          public.enterprise_policy_automation_rules%rowtype;
  v_store_ids     uuid[];
  v_target_count  int;
  v_deployment_id uuid;
  v_run_id        uuid;
  v_deploy_result jsonb;
  v_next_run      timestamptz;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_rule_id is null then raise exception 'rule_id required'; end if;

  select * into v_rule from public.enterprise_policy_automation_rules where id = p_rule_id and deleted_at is null;
  if v_rule.id is null then raise exception 'rule not found: %', p_rule_id; end if;

  v_store_ids := public._policy_automation_resolve_target_stores(
    v_rule.scope_type, v_rule.region_id, v_rule.scope_store_ids, v_rule.policy_id
  );
  v_target_count := coalesce(array_length(v_store_ids, 1), 0);

  if p_dry_run then
    perform public.admin_log_operation(
      'policy_automation', 'policy_automation.rule.dry_run', 'info', 'dry_run',
      format('rule dry-run — %s', v_rule.name),
      jsonb_build_object('rule_id', p_rule_id, 'target_count', v_target_count),
      auth.uid(), p_rule_id::text, null, null, null
    );
    return jsonb_build_object(
      'success', true,
      'rule_id', p_rule_id,
      'rule_type', v_rule.rule_type,
      'dry_run', true,
      'target_count', v_target_count,
      'sample_store_ids', to_jsonb(v_store_ids[1:least(5, v_target_count)]),
      'would_create_deployment', v_target_count > 0
    );
  end if;

  -- 실제 실행
  insert into public.enterprise_policy_automation_runs (
    rule_id, enterprise_account_id, status, target_store_count, dry_run, started_at, details
  ) values (
    v_rule.id, v_rule.enterprise_account_id, 'running', v_target_count, false, now(),
    jsonb_build_object('rule_type', v_rule.rule_type, 'scope_type', v_rule.scope_type, 'triggered_via','manual')
  ) returning id into v_run_id;

  if v_target_count = 0 then
    update public.enterprise_policy_automation_runs
       set status = 'skipped', completed_at = now(), error_message = 'no target stores'
     where id = v_run_id;
    perform public.admin_log_operation(
      'policy_automation', 'policy_automation.rule.run_now', 'warning', 'skipped',
      format('rule run_now skipped — no targets — %s', v_rule.name),
      jsonb_build_object('rule_id', p_rule_id, 'run_id', v_run_id, 'target_count', 0),
      auth.uid(), p_rule_id::text, null, null, null
    );
    return jsonb_build_object('success', true, 'rule_id', p_rule_id, 'run_id', v_run_id, 'status', 'skipped', 'target_count', 0);
  end if;

  begin
    v_deploy_result := public.admin_create_policy_deployment(
      v_rule.policy_id,
      format('[자동·즉시] %s — %s', v_rule.name, to_char(now() at time zone v_rule.timezone, 'YYYY-MM-DD HH24:MI')),
      v_store_ids,
      v_rule.enterprise_account_id
    );
    v_deployment_id := (v_deploy_result ->> 'deployment_id')::uuid;

    v_next_run := public._policy_automation_compute_next_run(
      v_rule.rule_type, v_rule.recurrence_rule, v_rule.starts_at, v_rule.ends_at,
      v_rule.season, now(), now(), v_rule.timezone
    );

    update public.enterprise_policy_automation_runs
       set status = 'completed', completed_at = now(), deployment_id = v_deployment_id,
           success_count = coalesce((v_deploy_result ->> 'target_store_count')::int, 0),
           details = details || jsonb_build_object('deployment_id', v_deployment_id, 'deploy_result', v_deploy_result)
     where id = v_run_id;

    update public.enterprise_policy_automation_rules
       set last_evaluated_at = now(), last_triggered_at = now(), next_run_at = v_next_run,
           -- scheduled 1회성 rule 은 manual run 후에도 expired 처리
           status = case when v_rule.rule_type = 'scheduled' then 'expired' else status end
     where id = v_rule.id;

    perform public.admin_log_operation(
      'policy_automation', 'policy_automation.rule.run_now', 'success', 'completed',
      format('rule run_now executed — %s', v_rule.name),
      jsonb_build_object('rule_id', p_rule_id, 'run_id', v_run_id, 'deployment_id', v_deployment_id, 'target_count', v_target_count),
      auth.uid(), p_rule_id::text, null, null, null
    );

    return jsonb_build_object(
      'success', true,
      'rule_id', p_rule_id,
      'run_id', v_run_id,
      'status', 'completed',
      'target_count', v_target_count,
      'deployment_id', v_deployment_id,
      'next_run_at', v_next_run
    );
  exception when others then
    update public.enterprise_policy_automation_runs
       set status = 'failed', completed_at = now(), error_message = sqlerrm
     where id = v_run_id;
    perform public.admin_log_operation(
      'policy_automation', 'policy_automation.run.failed', 'error', 'failed',
      format('rule run_now failed — %s', v_rule.name),
      jsonb_build_object('rule_id', p_rule_id, 'run_id', v_run_id, 'error', sqlerrm),
      auth.uid(), p_rule_id::text, null, null, sqlerrm
    );
    raise;
  end;
end;
$$;
revoke execute on function public.admin_run_policy_automation_rule_now(uuid, boolean) from public, anon;
grant   execute on function public.admin_run_policy_automation_rule_now(uuid, boolean) to authenticated;


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_rules_table int; v_runs_table int; v_rpc int;
begin
  select count(*) into v_rules_table from pg_class where relname = 'enterprise_policy_automation_rules';
  select count(*) into v_runs_table  from pg_class where relname = 'enterprise_policy_automation_runs';
  select count(*) into v_rpc from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in (
       'admin_list_policy_automation_rules', 'admin_policy_automation_kpi',
       'admin_create_policy_automation_rule', 'admin_update_policy_automation_rule',
       'admin_set_policy_automation_status', 'admin_soft_delete_policy_automation_rule',
       'admin_list_policy_automation_runs', 'admin_evaluate_policy_automation_rules',
       'admin_run_policy_automation_rule_now',
       '_policy_automation_compute_next_run', '_policy_automation_resolve_target_stores'
     );
  raise notice '====== 0378 Policy Automation Engine V1 ======';
  raise notice 'rules table : % / 1', v_rules_table;
  raise notice 'runs  table : % / 1', v_runs_table;
  raise notice 'functions   : % / 11 (9 RPC + 2 helper)', v_rpc;
  if v_rules_table = 1 and v_runs_table = 1 and v_rpc >= 11 then
    raise notice '0378 COMPLETE — rules + runs + helpers + 9 RPC ready';
  else
    raise warning '0378 INCOMPLETE';
  end if;
end$$;
