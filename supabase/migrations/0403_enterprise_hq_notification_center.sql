-- 0403 — Phase 3-5: Enterprise HQ Notification & Incident Center
--
-- 목표:
--   HQ 운영자가 운영센터를 지속적으로 지켜보지 않아도 매장 장애/정책 지연/재생 오류/
--   정산 이슈가 발생하면 Incident 를 자동 생성하고 내부 알림센터에서 확인할 수 있는
--   시스템 구축.
--
-- 이번 Phase 스코프:
--   - 신규 테이블 4 (incidents/notifications/policies/events)
--   - 신규 RPC 11 (KPI · list · detail · ack · resolve · notifications · read · policies · scan)
--   - 수동 스캔 RPC (Cron 없음 · Phase 3-5b 분리)
--   - Internal 알림만 (email/kakao/slack 발송 없음 · Phase 3-5b 분리)
--   - HQ scope 만 (super admin 우회 없음 · 다른 브랜드 데이터 접근 금지)
--
-- 절대 원칙:
--   - 기존 admin_* RPC / 정산/계약/carryover 로직 무변경
--   - HQ Ops/Intel/PDF Edge Function 회귀 0
--   - 기존 monitoring 인프라 (store_monitoring_status, store_policy_sync_status,
--     store_now_playing, enterprise_monthly_settlements, admin_operation_logs) 재사용만
--   - HF1~GC UI contrast 정책 UI 별도 유지

-- ============================================================
-- 1) enterprise_incidents
-- ============================================================
create table if not exists public.enterprise_incidents (
  id uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null
    references public.enterprise_accounts(id) on delete cascade,
  store_id uuid,  -- nullable (브랜드 단위 incident)
  incident_type text not null check (incident_type in (
    'store_offline',
    'heartbeat_stale',
    'policy_sync_stale',
    'playback_error',
    'now_playing_missing',
    'carryover_created',
    'settlement_paid_blocked'
  )),
  severity text not null check (severity in ('critical','high','medium','low','info')),
  status text not null default 'open'
    check (status in ('open','acknowledged','resolved')),
  title text not null,
  message text,
  source text not null default 'scan',
  source_ref_id text,
  detected_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  last_seen_at timestamptz not null default now(),
  occurrence_count int not null default 1 check (occurrence_count > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- HQ 리스트 조회 (필터 + 정렬)
create index if not exists idx_incidents_ea_status
  on public.enterprise_incidents (enterprise_account_id, status, detected_at desc);

-- 중복 방지 partial unique (open/acknowledged 시 같은 (ea, store_id 또는 sentinel, type) 조합 1개만)
create unique index if not exists uniq_incident_open_per_scope
  on public.enterprise_incidents (
    enterprise_account_id,
    coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid),
    incident_type
  )
  where status in ('open','acknowledged');

drop trigger if exists trg_incidents_updated_at on public.enterprise_incidents;
create trigger trg_incidents_updated_at before update on public.enterprise_incidents
  for each row execute function public._touch_updated_at();

alter table public.enterprise_incidents enable row level security;
drop policy if exists incidents_select on public.enterprise_incidents;
create policy incidents_select on public.enterprise_incidents
  for select using (
    exists (
      select 1 from public.enterprise_accounts ea
       where ea.id = enterprise_incidents.enterprise_account_id
         and ea.auth_user_id is not null
         and ea.auth_user_id = auth.uid()
         and ea.deleted_at is null
    )
  );
revoke all on public.enterprise_incidents from anon;
revoke insert, update, delete on public.enterprise_incidents from authenticated;

comment on table public.enterprise_incidents is
  'Phase 3-5 (0403) — HQ Incident 엔티티. Scan 시 자동 생성 · Ack/Resolve 상태 관리.';


-- ============================================================
-- 2) enterprise_notifications
--    확장성: target_type/target_id/delivery_channels (Phase 3-5b · 3-6)
-- ============================================================
create table if not exists public.enterprise_notifications (
  id uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null
    references public.enterprise_accounts(id) on delete cascade,
  incident_id uuid references public.enterprise_incidents(id) on delete cascade,
  target_type text not null default 'user'
    check (target_type in ('user','role','region')),
  target_id uuid,
  recipient_user_id uuid not null references public.users(id) on delete cascade,
  notification_type text not null,
  title text not null,
  message text not null,
  severity text not null
    check (severity in ('critical','high','medium','low','info')),
  status text not null default 'unread' check (status in ('unread','read')),
  read_at timestamptz,
  action_url text,
  delivery_channels jsonb not null default '{"internal": true}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- unread 우선 조회
create index if not exists idx_notifications_recipient_unread
  on public.enterprise_notifications (recipient_user_id, created_at desc)
  where read_at is null;

create index if not exists idx_notifications_ea
  on public.enterprise_notifications (enterprise_account_id, created_at desc);

alter table public.enterprise_notifications enable row level security;
drop policy if exists notifications_select on public.enterprise_notifications;
create policy notifications_select on public.enterprise_notifications
  for select using (
    recipient_user_id = auth.uid()
    or exists (
      select 1 from public.enterprise_accounts ea
       where ea.id = enterprise_notifications.enterprise_account_id
         and ea.auth_user_id is not null
         and ea.auth_user_id = auth.uid()
         and ea.deleted_at is null
    )
  );
revoke all on public.enterprise_notifications from anon;
revoke insert, update, delete on public.enterprise_notifications from authenticated;

comment on table public.enterprise_notifications is
  'Phase 3-5 (0403) — HQ 내부 알림 피드. target_type/delivery_channels 는 확장용 · 이번 Phase 는 user + internal 만.';


-- ============================================================
-- 3) enterprise_notification_policies
--    scope_type/scope_id 확장성 확보. 이번 Phase 는 scope_type='brand' 만 UI 노출.
-- ============================================================
create table if not exists public.enterprise_notification_policies (
  id uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null
    references public.enterprise_accounts(id) on delete cascade,
  scope_type text not null default 'brand'
    check (scope_type in ('brand','region','franchise','store')),
  scope_id uuid,
  incident_type text not null check (incident_type in (
    'store_offline',
    'heartbeat_stale',
    'policy_sync_stale',
    'playback_error',
    'now_playing_missing',
    'carryover_created',
    'settlement_paid_blocked'
  )),
  enabled boolean not null default true,
  severity text not null default 'medium'
    check (severity in ('critical','high','medium','low','info')),
  threshold_minutes int not null default 60 check (threshold_minutes >= 0),
  cooldown_minutes int not null default 60 check (cooldown_minutes >= 0),
  channels jsonb not null default '{"internal": true, "email": false, "kakao": false, "slack": false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uniq_notif_policy
  on public.enterprise_notification_policies (
    enterprise_account_id,
    scope_type,
    coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
    incident_type
  );

drop trigger if exists trg_notif_policy_updated_at on public.enterprise_notification_policies;
create trigger trg_notif_policy_updated_at before update on public.enterprise_notification_policies
  for each row execute function public._touch_updated_at();

alter table public.enterprise_notification_policies enable row level security;
drop policy if exists notif_policy_select on public.enterprise_notification_policies;
create policy notif_policy_select on public.enterprise_notification_policies
  for select using (
    exists (
      select 1 from public.enterprise_accounts ea
       where ea.id = enterprise_notification_policies.enterprise_account_id
         and ea.auth_user_id is not null
         and ea.auth_user_id = auth.uid()
         and ea.deleted_at is null
    )
  );
revoke all on public.enterprise_notification_policies from anon;
revoke insert, update, delete on public.enterprise_notification_policies from authenticated;

comment on table public.enterprise_notification_policies is
  'Phase 3-5 (0403) — 브랜드 · scope 별 incident 정책. scope_type 확장은 3-5b.';


-- ============================================================
-- 4) enterprise_incident_events
--    Incident 전용 timeline (audit log 와 별개 · Phase 3-6 Automation 연계).
-- ============================================================
create table if not exists public.enterprise_incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null
    references public.enterprise_incidents(id) on delete cascade,
  event_type text not null check (event_type in (
    'created',           -- 최초 감지
    'acknowledged',      -- ack 처리
    'resolved',          -- resolve 처리
    'recurrence',        -- 재발생 카운트 증가
    'scan_updated',      -- 스캔에서 last_seen 갱신
    'notification_sent', -- 알림 전송 (내부)
    'metadata_updated'   -- Automation/AI 필드 등 metadata 갱신
  )),
  message text,
  actor_user_id uuid references public.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_incident_events_incident
  on public.enterprise_incident_events (incident_id, created_at desc);

alter table public.enterprise_incident_events enable row level security;
drop policy if exists incident_events_select on public.enterprise_incident_events;
create policy incident_events_select on public.enterprise_incident_events
  for select using (
    exists (
      select 1 from public.enterprise_incidents ei
        join public.enterprise_accounts ea on ea.id = ei.enterprise_account_id
       where ei.id = enterprise_incident_events.incident_id
         and ea.auth_user_id is not null
         and ea.auth_user_id = auth.uid()
         and ea.deleted_at is null
    )
  );
revoke all on public.enterprise_incident_events from anon;
revoke insert, update, delete on public.enterprise_incident_events from authenticated;

comment on table public.enterprise_incident_events is
  'Phase 3-5 (0403) — Incident 전용 timeline. audit log 와 병행 · Automation 연계.';


-- ============================================================
-- 5) Helper: 기본 정책 seed (RPC 최초 접근 시 자동)
--    이번 Phase 는 scope_type='brand' 만 seed
-- ============================================================
create or replace function public._hq_ensure_default_policies(p_ea_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  insert into public.enterprise_notification_policies
    (enterprise_account_id, scope_type, incident_type, enabled, severity, threshold_minutes, cooldown_minutes)
  values
    (p_ea_id, 'brand', 'store_offline',           true, 'critical', 60,  60),
    (p_ea_id, 'brand', 'heartbeat_stale',         true, 'high',     60,  60),
    (p_ea_id, 'brand', 'policy_sync_stale',       true, 'high',     60,  60),
    (p_ea_id, 'brand', 'playback_error',          true, 'critical', 30,  30),
    (p_ea_id, 'brand', 'now_playing_missing',     true, 'medium',   30,  60),
    (p_ea_id, 'brand', 'carryover_created',       true, 'medium',   0,  120),
    (p_ea_id, 'brand', 'settlement_paid_blocked', true, 'critical', 0,  120)
  on conflict do nothing;
end;
$$;
revoke execute on function public._hq_ensure_default_policies(uuid) from public, anon;
grant   execute on function public._hq_ensure_default_policies(uuid) to authenticated;


-- ============================================================
-- 6) RPC: get_my_enterprise_incident_kpi
-- ============================================================
create or replace function public.get_my_enterprise_incident_kpi()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
begin
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  return jsonb_build_object(
    'success', true,
    'open',
      (select count(*) from public.enterprise_incidents
        where enterprise_account_id = v_ea_id and status = 'open'),
    'acknowledged',
      (select count(*) from public.enterprise_incidents
        where enterprise_account_id = v_ea_id and status = 'acknowledged'),
    'critical_open',
      (select count(*) from public.enterprise_incidents
        where enterprise_account_id = v_ea_id
          and status in ('open','acknowledged')
          and severity = 'critical'),
    'resolved_today',
      (select count(*) from public.enterprise_incidents
        where enterprise_account_id = v_ea_id
          and status = 'resolved'
          and resolved_at >= date_trunc('day', now())),
    'unread_notifications',
      (select count(*) from public.enterprise_notifications
        where enterprise_account_id = v_ea_id
          and recipient_user_id = auth.uid()
          and read_at is null),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_incident_kpi() from public, anon;
grant   execute on function public.get_my_enterprise_incident_kpi() to authenticated;


-- ============================================================
-- 7) RPC: get_my_enterprise_incidents
-- ============================================================
create or replace function public.get_my_enterprise_incidents(
  p_status   text default null,
  p_severity text default null,
  p_type     text default null,
  p_limit    int  default 50,
  p_offset   int  default 0
)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_rows jsonb;
begin
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  select count(*) into v_total
    from public.enterprise_incidents ei
   where ei.enterprise_account_id = v_ea_id
     and (p_status   is null or ei.status = p_status)
     and (p_severity is null or ei.severity = p_severity)
     and (p_type     is null or ei.incident_type = p_type);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ei.id,
    'enterprise_account_id', ei.enterprise_account_id,
    'store_id', ei.store_id,
    'store_name', coalesce(u.business_name, u.nickname),
    'incident_type', ei.incident_type,
    'severity', ei.severity,
    'status', ei.status,
    'title', ei.title,
    'message', ei.message,
    'source', ei.source,
    'source_ref_id', ei.source_ref_id,
    'detected_at', ei.detected_at,
    'last_seen_at', ei.last_seen_at,
    'occurrence_count', ei.occurrence_count,
    'acknowledged_at', ei.acknowledged_at,
    'resolved_at', ei.resolved_at,
    'metadata', ei.metadata,
    'created_at', ei.created_at,
    'updated_at', ei.updated_at
  ) order by ei.detected_at desc), '[]'::jsonb)
    into v_rows
    from (
      select ei2.* from public.enterprise_incidents ei2
       where ei2.enterprise_account_id = v_ea_id
         and (p_status   is null or ei2.status = p_status)
         and (p_severity is null or ei2.severity = p_severity)
         and (p_type     is null or ei2.incident_type = p_type)
       order by ei2.detected_at desc
       limit v_limit offset v_offset
    ) ei
    left join public.users u on u.id = ei.store_id;

  return jsonb_build_object(
    'success', true,
    'data', v_rows,
    'pagination', jsonb_build_object(
      'total', v_total, 'limit', v_limit, 'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total
    )
  );
end;
$$;
revoke execute on function public.get_my_enterprise_incidents(text, text, text, int, int) from public, anon;
grant   execute on function public.get_my_enterprise_incidents(text, text, text, int, int) to authenticated;


-- ============================================================
-- 8) RPC: get_my_enterprise_incident_detail
--    Incident 상세 + timeline (enterprise_incident_events)
-- ============================================================
create or replace function public.get_my_enterprise_incident_detail(p_incident_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_incident public.enterprise_incidents;
  v_events jsonb;
  v_store_name text;
begin
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  select * into v_incident from public.enterprise_incidents where id = p_incident_id;
  if v_incident.id is null then
    raise exception 'incident not found: %', p_incident_id;
  end if;
  if v_incident.enterprise_account_id <> v_ea_id then
    raise exception 'forbidden: incident % not in your brand', p_incident_id;
  end if;

  if v_incident.store_id is not null then
    select coalesce(u.business_name, u.nickname) into v_store_name
      from public.users u where u.id = v_incident.store_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ev.id,
    'event_type', ev.event_type,
    'message', ev.message,
    'actor_user_id', ev.actor_user_id,
    'metadata', ev.metadata,
    'created_at', ev.created_at
  ) order by ev.created_at asc), '[]'::jsonb)
    into v_events
    from public.enterprise_incident_events ev
   where ev.incident_id = p_incident_id;

  return jsonb_build_object(
    'success', true,
    'incident', jsonb_build_object(
      'id', v_incident.id,
      'enterprise_account_id', v_incident.enterprise_account_id,
      'store_id', v_incident.store_id,
      'store_name', v_store_name,
      'incident_type', v_incident.incident_type,
      'severity', v_incident.severity,
      'status', v_incident.status,
      'title', v_incident.title,
      'message', v_incident.message,
      'source', v_incident.source,
      'source_ref_id', v_incident.source_ref_id,
      'detected_at', v_incident.detected_at,
      'acknowledged_at', v_incident.acknowledged_at,
      'acknowledged_by', v_incident.acknowledged_by,
      'resolved_at', v_incident.resolved_at,
      'resolved_by', v_incident.resolved_by,
      'last_seen_at', v_incident.last_seen_at,
      'occurrence_count', v_incident.occurrence_count,
      'metadata', v_incident.metadata,
      'created_at', v_incident.created_at,
      'updated_at', v_incident.updated_at
    ),
    'events', v_events
  );
end;
$$;
revoke execute on function public.get_my_enterprise_incident_detail(uuid) from public, anon;
grant   execute on function public.get_my_enterprise_incident_detail(uuid) to authenticated;


-- ============================================================
-- 9) RPC: acknowledge_my_enterprise_incident
-- ============================================================
create or replace function public.acknowledge_my_enterprise_incident(p_incident_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_incident public.enterprise_incidents;
begin
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  select * into v_incident from public.enterprise_incidents where id = p_incident_id;
  if v_incident.id is null then raise exception 'incident not found: %', p_incident_id; end if;
  if v_incident.enterprise_account_id <> v_ea_id then
    raise exception 'forbidden: incident % not in your brand', p_incident_id;
  end if;
  if v_incident.status <> 'open' then
    raise exception 'invalid transition: current status = %', v_incident.status;
  end if;

  update public.enterprise_incidents
     set status = 'acknowledged',
         acknowledged_at = now(),
         acknowledged_by = auth.uid()
   where id = p_incident_id;

  insert into public.enterprise_incident_events (incident_id, event_type, message, actor_user_id)
  values (p_incident_id, 'acknowledged', 'Incident acknowledged by HQ operator', auth.uid());

  perform public.admin_log_operation(
    'enterprise_incidents', 'hq', 'info', 'incident.acknowledged',
    format('HQ acknowledged incident %s (type=%s)', p_incident_id, v_incident.incident_type),
    jsonb_build_object(
      'action', 'incident.acknowledged',
      'incident_id', p_incident_id,
      'enterprise_account_id', v_ea_id),
    auth.uid(), p_incident_id::text, null, null, null
  );

  return jsonb_build_object('success', true, 'incident_id', p_incident_id, 'status', 'acknowledged');
end;
$$;
revoke execute on function public.acknowledge_my_enterprise_incident(uuid) from public, anon;
grant   execute on function public.acknowledge_my_enterprise_incident(uuid) to authenticated;


-- ============================================================
-- 10) RPC: resolve_my_enterprise_incident
-- ============================================================
create or replace function public.resolve_my_enterprise_incident(p_incident_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_incident public.enterprise_incidents;
begin
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  select * into v_incident from public.enterprise_incidents where id = p_incident_id;
  if v_incident.id is null then raise exception 'incident not found: %', p_incident_id; end if;
  if v_incident.enterprise_account_id <> v_ea_id then
    raise exception 'forbidden: incident % not in your brand', p_incident_id;
  end if;
  if v_incident.status not in ('open','acknowledged') then
    raise exception 'invalid transition: current status = %', v_incident.status;
  end if;

  update public.enterprise_incidents
     set status = 'resolved',
         resolved_at = now(),
         resolved_by = auth.uid(),
         -- open 상태에서 바로 resolve 하면 ack 도 세팅 (감사 흐름 일관)
         acknowledged_at = coalesce(acknowledged_at, now()),
         acknowledged_by = coalesce(acknowledged_by, auth.uid())
   where id = p_incident_id;

  insert into public.enterprise_incident_events (incident_id, event_type, message, actor_user_id)
  values (p_incident_id, 'resolved', 'Incident resolved by HQ operator', auth.uid());

  perform public.admin_log_operation(
    'enterprise_incidents', 'hq', 'info', 'incident.resolved',
    format('HQ resolved incident %s (type=%s)', p_incident_id, v_incident.incident_type),
    jsonb_build_object(
      'action', 'incident.resolved',
      'incident_id', p_incident_id,
      'enterprise_account_id', v_ea_id),
    auth.uid(), p_incident_id::text, null, null, null
  );

  return jsonb_build_object('success', true, 'incident_id', p_incident_id, 'status', 'resolved');
end;
$$;
revoke execute on function public.resolve_my_enterprise_incident(uuid) from public, anon;
grant   execute on function public.resolve_my_enterprise_incident(uuid) to authenticated;


-- ============================================================
-- 11) RPC: get_my_enterprise_notifications
-- ============================================================
create or replace function public.get_my_enterprise_notifications(
  p_limit int default 50,
  p_offset int default 0,
  p_unread_only boolean default false
)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_uid uuid := auth.uid();
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_unread int;
  v_rows jsonb;
begin
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  select count(*) into v_total
    from public.enterprise_notifications
   where enterprise_account_id = v_ea_id
     and recipient_user_id = v_uid
     and (not p_unread_only or read_at is null);

  select count(*) into v_unread
    from public.enterprise_notifications
   where enterprise_account_id = v_ea_id
     and recipient_user_id = v_uid
     and read_at is null;

  select coalesce(jsonb_agg(row_to_json(n) order by n.created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select n2.* from public.enterprise_notifications n2
       where n2.enterprise_account_id = v_ea_id
         and n2.recipient_user_id = v_uid
         and (not p_unread_only or n2.read_at is null)
       order by n2.created_at desc
       limit v_limit offset v_offset
    ) n;

  return jsonb_build_object(
    'success', true,
    'data', v_rows,
    'unread_count', v_unread,
    'pagination', jsonb_build_object(
      'total', v_total, 'limit', v_limit, 'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total
    )
  );
end;
$$;
revoke execute on function public.get_my_enterprise_notifications(int, int, boolean) from public, anon;
grant   execute on function public.get_my_enterprise_notifications(int, int, boolean) to authenticated;


-- ============================================================
-- 12) RPC: mark_my_enterprise_notification_read
-- ============================================================
create or replace function public.mark_my_enterprise_notification_read(p_notification_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_updated int;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  update public.enterprise_notifications
     set read_at = now(), status = 'read'
   where id = p_notification_id
     and recipient_user_id = v_uid
     and read_at is null;
  get diagnostics v_updated = row_count;

  return jsonb_build_object('success', true, 'updated', v_updated);
end;
$$;
revoke execute on function public.mark_my_enterprise_notification_read(uuid) from public, anon;
grant   execute on function public.mark_my_enterprise_notification_read(uuid) to authenticated;


-- ============================================================
-- 13) RPC: mark_all_my_enterprise_notifications_read
-- ============================================================
create or replace function public.mark_all_my_enterprise_notifications_read()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_uid uuid := auth.uid();
  v_updated int;
begin
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  update public.enterprise_notifications
     set read_at = now(), status = 'read'
   where enterprise_account_id = v_ea_id
     and recipient_user_id = v_uid
     and read_at is null;
  get diagnostics v_updated = row_count;

  return jsonb_build_object('success', true, 'updated', v_updated);
end;
$$;
revoke execute on function public.mark_all_my_enterprise_notifications_read() from public, anon;
grant   execute on function public.mark_all_my_enterprise_notifications_read() to authenticated;


-- ============================================================
-- 14) RPC: get_my_enterprise_notification_policies
--    최초 접근 시 default seed 자동 생성.
-- ============================================================
create or replace function public.get_my_enterprise_notification_policies()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_rows jsonb;
begin
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  perform public._hq_ensure_default_policies(v_ea_id);

  select coalesce(jsonb_agg(row_to_json(p) order by
    case p.incident_type
      when 'store_offline' then 1
      when 'heartbeat_stale' then 2
      when 'policy_sync_stale' then 3
      when 'playback_error' then 4
      when 'now_playing_missing' then 5
      when 'carryover_created' then 6
      when 'settlement_paid_blocked' then 7
      else 99
    end
  ), '[]'::jsonb)
    into v_rows
    from public.enterprise_notification_policies p
   where p.enterprise_account_id = v_ea_id
     and p.scope_type = 'brand';

  return jsonb_build_object('success', true, 'data', v_rows);
end;
$$;
revoke execute on function public.get_my_enterprise_notification_policies() from public, anon;
grant   execute on function public.get_my_enterprise_notification_policies() to authenticated;


-- ============================================================
-- 15) RPC: update_my_enterprise_notification_policy
--    brand scope 만 이번 Phase 지원 · region/franchise/store 는 3-5b
-- ============================================================
create or replace function public.update_my_enterprise_notification_policy(
  p_incident_type text,
  p_enabled boolean,
  p_severity text,
  p_threshold_minutes int,
  p_cooldown_minutes int,
  p_channels jsonb default null
)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_row public.enterprise_notification_policies;
begin
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;
  if p_incident_type not in (
    'store_offline','heartbeat_stale','policy_sync_stale','playback_error',
    'now_playing_missing','carryover_created','settlement_paid_blocked'
  ) then
    raise exception 'validation: invalid incident_type %', p_incident_type;
  end if;
  if p_severity not in ('critical','high','medium','low','info') then
    raise exception 'validation: invalid severity %', p_severity;
  end if;
  if p_threshold_minutes < 0 or p_cooldown_minutes < 0 then
    raise exception 'validation: threshold/cooldown must be >= 0';
  end if;

  perform public._hq_ensure_default_policies(v_ea_id);

  update public.enterprise_notification_policies
     set enabled = p_enabled,
         severity = p_severity,
         threshold_minutes = p_threshold_minutes,
         cooldown_minutes = p_cooldown_minutes,
         channels = coalesce(p_channels, channels),
         updated_at = now()
   where enterprise_account_id = v_ea_id
     and scope_type = 'brand'
     and scope_id is null
     and incident_type = p_incident_type
  returning * into v_row;

  return jsonb_build_object(
    'success', true,
    'policy', row_to_json(v_row)
  );
end;
$$;
revoke execute on function public.update_my_enterprise_notification_policy(text, boolean, text, int, int, jsonb) from public, anon;
grant   execute on function public.update_my_enterprise_notification_policy(text, boolean, text, int, int, jsonb) to authenticated;


-- ============================================================
-- 16) RPC: run_my_enterprise_incident_scan
--    HQ 자기 브랜드 매장 + 브랜드 단위 조건을 모두 스캔.
--    Dedup: partial unique 를 활용해 INSERT ON CONFLICT DO UPDATE 로 upsert.
--    Notification: 신규 생성 시 무조건 · 재발 시 cooldown 통과 후 생성.
--    Automation 필드: metadata 에 recommended_action / action_url / recovery_hint 저장.
--
--    반환: scan_started_at · scan_finished_at · duration_ms · scanned_store_count ·
--          created_count · updated_count · notification_created_count · skipped_count ·
--          skipped_reasons · by_type
-- ============================================================
create or replace function public.run_my_enterprise_incident_scan()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_ea_row public.enterprise_accounts;
  v_recipient uuid;
  v_scan_started timestamptz := clock_timestamp();
  v_scanned int := 0;
  v_created int := 0;
  v_updated int := 0;
  v_notifs int := 0;
  v_skipped int := 0;
  v_by_type jsonb := '{}'::jsonb;
  v_skipped_reasons jsonb := '{}'::jsonb;
  v_store record;
  v_policy record;
  v_incident_id uuid;
  v_is_created boolean;
  v_last_notif timestamptz;
  v_month_first date := date_trunc('month', current_date)::date;
  v_settlement record;
  v_paid_blocked record;
  v_now_playing_missing boolean;

  procedure incr(k text) as $incr$
  begin
    -- outer scope 변수 접근을 위해 nested block 대신 helper 로직을 inline 처리
    -- 실제로는 inline update 사용 (아래 CASE 참조)
  end;
  $incr$ language plpgsql;
begin
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  -- 기본 정책 seed 보장
  perform public._hq_ensure_default_policies(v_ea_id);

  select * into v_ea_row from public.enterprise_accounts where id = v_ea_id;
  v_recipient := v_ea_row.auth_user_id;
  if v_recipient is null then
    raise exception 'HQ account has no auth_user_id (recipient)';
  end if;

  -- ==============================
  -- 매장 단위 조건 (5)
  -- ==============================
  for v_store in
    select sms.*,
           coalesce(u.business_name, u.nickname, '(매장명 없음)') as store_name,
           f.name as franchise_name,
           er.region_name as region_name
      from public.store_monitoring_status sms
      join public.enterprise_franchises ef on ef.franchise_id = sms.franchise_id
      join public.users u on u.id = sms.store_id
      left join public.franchises f on f.id = sms.franchise_id
      left join public.enterprise_regions er on er.id = sms.enterprise_region_id
     where ef.enterprise_account_id = v_ea_id
       and ef.deleted_at is null
       and coalesce(u.account_type, 'individual') = 'business'
       and u.withdrawn_at is null
  loop
    v_scanned := v_scanned + 1;

    -- store_offline (24h+)
    if v_store.is_offline_24h then
      select * into v_policy from public.enterprise_notification_policies
       where enterprise_account_id = v_ea_id
         and scope_type = 'brand' and scope_id is null
         and incident_type = 'store_offline';
      if v_policy.enabled then
        select public._hq_emit_incident(
          v_ea_id, v_store.store_id, 'store_offline', v_policy.severity, v_recipient,
          format('%s 매장이 오프라인입니다.', v_store.store_name),
          format('%s 매장이 24시간 이상 heartbeat 를 받지 못했습니다.', v_store.store_name),
          jsonb_build_object(
            'store_name', v_store.store_name,
            'franchise_name', v_store.franchise_name,
            'region_name', v_store.region_name,
            'last_seen_at', v_store.last_seen_at,
            'recommended_action', '매장 네트워크/전원/브라우저 실행 상태를 확인해주세요.',
            'action_url', '/enterprise/ops?status=offline',
            'automation_candidate', false,
            'recovery_hint', '재접속 시 자동 해제 · resolve 로 종료 처리'),
          v_policy.cooldown_minutes
        ) into v_incident_id;

        if v_incident_id is not null then
          -- helper 가 (incident_id, is_created) 튜플을 반환하려면 out 파라미터 필요.
          -- 편의상 v_is_created 는 아래 in-place 판정으로 대체.
          select (created_at = updated_at and occurrence_count = 1) into v_is_created
            from public.enterprise_incidents where id = v_incident_id;
          if v_is_created then
            v_created := v_created + 1;
            v_by_type := jsonb_set(v_by_type, array['store_offline'],
              to_jsonb(coalesce((v_by_type->>'store_offline')::int, 0) + 1));
          else
            v_updated := v_updated + 1;
          end if;

          -- Notification: 신규면 무조건 · 재발 시 cooldown 통과 시
          select max(created_at) into v_last_notif
            from public.enterprise_notifications
           where incident_id = v_incident_id and recipient_user_id = v_recipient;
          if v_is_created or v_last_notif is null
             or v_last_notif < now() - (v_policy.cooldown_minutes || ' minutes')::interval then
            insert into public.enterprise_notifications
              (enterprise_account_id, incident_id, target_type, recipient_user_id,
               notification_type, title, message, severity, action_url, metadata)
            values (v_ea_id, v_incident_id, 'user', v_recipient,
                    'store_offline',
                    format('오프라인 매장: %s', v_store.store_name),
                    format('%s 매장이 24시간 이상 오프라인 상태입니다.', v_store.store_name),
                    v_policy.severity,
                    '/enterprise/notifications',
                    jsonb_build_object('store_id', v_store.store_id));
            v_notifs := v_notifs + 1;
            insert into public.enterprise_incident_events (incident_id, event_type, message)
            values (v_incident_id, 'notification_sent', 'internal notification created');
          end if;
        end if;
      else
        v_skipped := v_skipped + 1;
        v_skipped_reasons := jsonb_set(v_skipped_reasons, array['store_offline'],
          to_jsonb(coalesce((v_skipped_reasons->>'store_offline')::int, 0) + 1));
      end if;
    end if;

    -- heartbeat_stale (1h ~ 24h)
    if v_store.is_idle_1h_to_24h then
      select * into v_policy from public.enterprise_notification_policies
       where enterprise_account_id = v_ea_id and scope_type = 'brand' and scope_id is null
         and incident_type = 'heartbeat_stale';
      if v_policy.enabled then
        select public._hq_emit_incident(
          v_ea_id, v_store.store_id, 'heartbeat_stale', v_policy.severity, v_recipient,
          format('%s 매장 heartbeat 지연', v_store.store_name),
          '매장이 1시간 이상 heartbeat 를 받지 못했습니다.',
          jsonb_build_object(
            'store_name', v_store.store_name,
            'last_seen_at', v_store.last_seen_at,
            'recommended_action', '매장 PC/플레이어 실행 상태를 확인 후 정책 재동기화를 실행해보세요.',
            'action_url', '/enterprise/ops?status=idle_24h',
            'automation_candidate', true,
            'recovery_hint', '5분 이내 heartbeat 재수신 시 자동 해제'),
          v_policy.cooldown_minutes
        ) into v_incident_id;
        if v_incident_id is not null then
          select (created_at = updated_at and occurrence_count = 1) into v_is_created
            from public.enterprise_incidents where id = v_incident_id;
          if v_is_created then v_created := v_created + 1;
            v_by_type := jsonb_set(v_by_type, array['heartbeat_stale'],
              to_jsonb(coalesce((v_by_type->>'heartbeat_stale')::int, 0) + 1));
          else v_updated := v_updated + 1; end if;
          select max(created_at) into v_last_notif from public.enterprise_notifications
           where incident_id = v_incident_id and recipient_user_id = v_recipient;
          if v_is_created or v_last_notif is null
             or v_last_notif < now() - (v_policy.cooldown_minutes || ' minutes')::interval then
            insert into public.enterprise_notifications
              (enterprise_account_id, incident_id, target_type, recipient_user_id,
               notification_type, title, message, severity, action_url, metadata)
            values (v_ea_id, v_incident_id, 'user', v_recipient,
                    'heartbeat_stale',
                    format('Heartbeat 지연: %s', v_store.store_name),
                    '매장이 1시간 이상 heartbeat 를 받지 못했어요.',
                    v_policy.severity, '/enterprise/notifications',
                    jsonb_build_object('store_id', v_store.store_id));
            v_notifs := v_notifs + 1;
            insert into public.enterprise_incident_events (incident_id, event_type, message)
            values (v_incident_id, 'notification_sent', 'internal notification created');
          end if;
        end if;
      else
        v_skipped := v_skipped + 1;
        v_skipped_reasons := jsonb_set(v_skipped_reasons, array['heartbeat_stale'],
          to_jsonb(coalesce((v_skipped_reasons->>'heartbeat_stale')::int, 0) + 1));
      end if;
    end if;

    -- policy_sync_stale (24h+)
    if v_store.has_policy_outdated then
      select * into v_policy from public.enterprise_notification_policies
       where enterprise_account_id = v_ea_id and scope_type = 'brand' and scope_id is null
         and incident_type = 'policy_sync_stale';
      if v_policy.enabled then
        select public._hq_emit_incident(
          v_ea_id, v_store.store_id, 'policy_sync_stale', v_policy.severity, v_recipient,
          format('%s 매장 정책 sync 지연', v_store.store_name),
          '매장이 24시간 이상 정책을 재수신하지 못했습니다.',
          jsonb_build_object(
            'store_name', v_store.store_name,
            'last_policy_sync_at', v_store.last_policy_sync_at,
            'recommended_action', '정책 재동기화를 실행하고 5분 뒤 sync 시간을 확인하세요.',
            'action_url', '/enterprise/ops?status=policy_outdated',
            'automation_candidate', true,
            'recovery_hint', 'hq_force_store_resync 실행 후 자동 해제 후보'),
          v_policy.cooldown_minutes
        ) into v_incident_id;
        if v_incident_id is not null then
          select (created_at = updated_at and occurrence_count = 1) into v_is_created
            from public.enterprise_incidents where id = v_incident_id;
          if v_is_created then v_created := v_created + 1;
            v_by_type := jsonb_set(v_by_type, array['policy_sync_stale'],
              to_jsonb(coalesce((v_by_type->>'policy_sync_stale')::int, 0) + 1));
          else v_updated := v_updated + 1; end if;
          select max(created_at) into v_last_notif from public.enterprise_notifications
           where incident_id = v_incident_id and recipient_user_id = v_recipient;
          if v_is_created or v_last_notif is null
             or v_last_notif < now() - (v_policy.cooldown_minutes || ' minutes')::interval then
            insert into public.enterprise_notifications
              (enterprise_account_id, incident_id, target_type, recipient_user_id,
               notification_type, title, message, severity, action_url, metadata)
            values (v_ea_id, v_incident_id, 'user', v_recipient,
                    'policy_sync_stale',
                    format('정책 sync 지연: %s', v_store.store_name),
                    '24시간 이상 정책 재수신 실패. 강제 동기화를 추천드려요.',
                    v_policy.severity, '/enterprise/notifications',
                    jsonb_build_object('store_id', v_store.store_id));
            v_notifs := v_notifs + 1;
            insert into public.enterprise_incident_events (incident_id, event_type, message)
            values (v_incident_id, 'notification_sent', 'internal notification created');
          end if;
        end if;
      else
        v_skipped := v_skipped + 1;
        v_skipped_reasons := jsonb_set(v_skipped_reasons, array['policy_sync_stale'],
          to_jsonb(coalesce((v_skipped_reasons->>'policy_sync_stale')::int, 0) + 1));
      end if;
    end if;

    -- playback_error
    if v_store.has_playback_error then
      select * into v_policy from public.enterprise_notification_policies
       where enterprise_account_id = v_ea_id and scope_type = 'brand' and scope_id is null
         and incident_type = 'playback_error';
      if v_policy.enabled then
        select public._hq_emit_incident(
          v_ea_id, v_store.store_id, 'playback_error', v_policy.severity, v_recipient,
          format('%s 매장 재생 오류', v_store.store_name),
          coalesce(v_store.playback_error, '재생 오류가 감지되었습니다.'),
          jsonb_build_object(
            'store_name', v_store.store_name,
            'playback_error', v_store.playback_error,
            'recommended_action', '오디오 출력 장치와 플레이어 상태를 확인해주세요.',
            'action_url', '/enterprise/ops?status=playback_error',
            'automation_candidate', false,
            'recovery_hint', '오류 해제 후 자동 해제 후보'),
          v_policy.cooldown_minutes
        ) into v_incident_id;
        if v_incident_id is not null then
          select (created_at = updated_at and occurrence_count = 1) into v_is_created
            from public.enterprise_incidents where id = v_incident_id;
          if v_is_created then v_created := v_created + 1;
            v_by_type := jsonb_set(v_by_type, array['playback_error'],
              to_jsonb(coalesce((v_by_type->>'playback_error')::int, 0) + 1));
          else v_updated := v_updated + 1; end if;
          select max(created_at) into v_last_notif from public.enterprise_notifications
           where incident_id = v_incident_id and recipient_user_id = v_recipient;
          if v_is_created or v_last_notif is null
             or v_last_notif < now() - (v_policy.cooldown_minutes || ' minutes')::interval then
            insert into public.enterprise_notifications
              (enterprise_account_id, incident_id, target_type, recipient_user_id,
               notification_type, title, message, severity, action_url, metadata)
            values (v_ea_id, v_incident_id, 'user', v_recipient,
                    'playback_error',
                    format('재생 오류: %s', v_store.store_name),
                    coalesce(v_store.playback_error, '재생 오류가 감지되었습니다.'),
                    v_policy.severity, '/enterprise/notifications',
                    jsonb_build_object('store_id', v_store.store_id));
            v_notifs := v_notifs + 1;
            insert into public.enterprise_incident_events (incident_id, event_type, message)
            values (v_incident_id, 'notification_sent', 'internal notification created');
          end if;
        end if;
      else
        v_skipped := v_skipped + 1;
        v_skipped_reasons := jsonb_set(v_skipped_reasons, array['playback_error'],
          to_jsonb(coalesce((v_skipped_reasons->>'playback_error')::int, 0) + 1));
      end if;
    end if;

    -- now_playing_missing (온라인 상태인데 재생 정보 없음 · 5분+)
    if v_store.is_online then
      select (
        not exists (
          select 1 from public.store_now_playing np
           where np.store_id = v_store.store_id
             and np.current_track_started_at is not null
             and np.current_track_started_at >= now() - interval '5 minutes'
        )
      ) into v_now_playing_missing;
      if v_now_playing_missing then
        select * into v_policy from public.enterprise_notification_policies
         where enterprise_account_id = v_ea_id and scope_type = 'brand' and scope_id is null
           and incident_type = 'now_playing_missing';
        if v_policy.enabled then
          select public._hq_emit_incident(
            v_ea_id, v_store.store_id, 'now_playing_missing', v_policy.severity, v_recipient,
            format('%s 매장 재생 정보 없음', v_store.store_name),
            '매장은 온라인이지만 최근 5분간 재생 정보가 수신되지 않았어요.',
            jsonb_build_object(
              'store_name', v_store.store_name,
              'recommended_action', '플레이어가 정상 재생 중인지 매장에 확인해주세요.',
              'action_url', '/enterprise/ops',
              'automation_candidate', false,
              'recovery_hint', 'now_playing 재수신 시 자동 해제 후보'),
            v_policy.cooldown_minutes
          ) into v_incident_id;
          if v_incident_id is not null then
            select (created_at = updated_at and occurrence_count = 1) into v_is_created
              from public.enterprise_incidents where id = v_incident_id;
            if v_is_created then v_created := v_created + 1;
              v_by_type := jsonb_set(v_by_type, array['now_playing_missing'],
                to_jsonb(coalesce((v_by_type->>'now_playing_missing')::int, 0) + 1));
            else v_updated := v_updated + 1; end if;
            select max(created_at) into v_last_notif from public.enterprise_notifications
             where incident_id = v_incident_id and recipient_user_id = v_recipient;
            if v_is_created or v_last_notif is null
               or v_last_notif < now() - (v_policy.cooldown_minutes || ' minutes')::interval then
              insert into public.enterprise_notifications
                (enterprise_account_id, incident_id, target_type, recipient_user_id,
                 notification_type, title, message, severity, action_url, metadata)
              values (v_ea_id, v_incident_id, 'user', v_recipient,
                      'now_playing_missing',
                      format('재생 정보 없음: %s', v_store.store_name),
                      '온라인 매장에 재생 정보가 수신되지 않았어요.',
                      v_policy.severity, '/enterprise/notifications',
                      jsonb_build_object('store_id', v_store.store_id));
              v_notifs := v_notifs + 1;
              insert into public.enterprise_incident_events (incident_id, event_type, message)
              values (v_incident_id, 'notification_sent', 'internal notification created');
            end if;
          end if;
        else
          v_skipped := v_skipped + 1;
          v_skipped_reasons := jsonb_set(v_skipped_reasons, array['now_playing_missing'],
            to_jsonb(coalesce((v_skipped_reasons->>'now_playing_missing')::int, 0) + 1));
        end if;
      end if;
    end if;
  end loop;

  -- ==============================
  -- 브랜드 단위 조건 (2)
  -- ==============================
  -- carryover_created — 이번 달 이월 발생 정산
  for v_settlement in
    select ems.id, ems.settlement_month, ems.total_commission, ems.previous_carryover,
           ems.carryover_amount, ems.minimum_payout
      from public.enterprise_monthly_settlements ems
     where ems.enterprise_account_id = v_ea_id
       and coalesce(ems.carryover_amount, 0) > 0
       and coalesce(ems.carryover_applied, false) = false
       and ems.settlement_month >= v_month_first - interval '1 month'
  loop
    select * into v_policy from public.enterprise_notification_policies
     where enterprise_account_id = v_ea_id and scope_type = 'brand' and scope_id is null
       and incident_type = 'carryover_created';
    if v_policy.enabled then
      select public._hq_emit_incident(
        v_ea_id, null, 'carryover_created', v_policy.severity, v_recipient,
        format('정산 이월 발생 (%s)', to_char(v_settlement.settlement_month, 'YYYY-MM')),
        format('최소정산금 미달로 %s원 이월되었어요. 다음 달 누적 지급 조건을 확인해주세요.',
          v_settlement.carryover_amount),
        jsonb_build_object(
          'settlement_id', v_settlement.id,
          'settlement_month', to_char(v_settlement.settlement_month, 'YYYY-MM'),
          'carryover_amount', v_settlement.carryover_amount,
          'minimum_payout', v_settlement.minimum_payout,
          'recommended_action', '다음 달 누적 지급 조건을 확인하세요.',
          'action_url', '/enterprise/me',
          'automation_candidate', false,
          'recovery_hint', '이월 chain 종료 시 자동 해제 후보'),
        v_policy.cooldown_minutes
      ) into v_incident_id;
      if v_incident_id is not null then
        select (created_at = updated_at and occurrence_count = 1) into v_is_created
          from public.enterprise_incidents where id = v_incident_id;
        if v_is_created then v_created := v_created + 1;
          v_by_type := jsonb_set(v_by_type, array['carryover_created'],
            to_jsonb(coalesce((v_by_type->>'carryover_created')::int, 0) + 1));
        else v_updated := v_updated + 1; end if;
        select max(created_at) into v_last_notif from public.enterprise_notifications
         where incident_id = v_incident_id and recipient_user_id = v_recipient;
        if v_is_created or v_last_notif is null
           or v_last_notif < now() - (v_policy.cooldown_minutes || ' minutes')::interval then
          insert into public.enterprise_notifications
            (enterprise_account_id, incident_id, target_type, recipient_user_id,
             notification_type, title, message, severity, action_url, metadata)
          values (v_ea_id, v_incident_id, 'user', v_recipient,
                  'carryover_created',
                  '정산 이월 발생',
                  format('%s에 정산 이월이 발생했어요. 지급 조건을 확인해주세요.',
                    to_char(v_settlement.settlement_month, 'YYYY-MM')),
                  v_policy.severity, '/enterprise/me',
                  jsonb_build_object('settlement_id', v_settlement.id));
          v_notifs := v_notifs + 1;
          insert into public.enterprise_incident_events (incident_id, event_type, message)
          values (v_incident_id, 'notification_sent', 'internal notification created');
        end if;
      end if;
    else
      v_skipped := v_skipped + 1;
      v_skipped_reasons := jsonb_set(v_skipped_reasons, array['carryover_created'],
        to_jsonb(coalesce((v_skipped_reasons->>'carryover_created')::int, 0) + 1));
    end if;
  end loop;

  -- settlement_paid_blocked — 최근 7일 이내 paid_blocked 이벤트
  for v_paid_blocked in
    select aol.id, aol.created_at, aol.details, aol.message
      from public.admin_operation_logs aol
     where aol.status = 'enterprise_monthly_settlement.paid_blocked'
       and aol.created_at >= now() - interval '7 days'
       and aol.details->>'enterprise_account_id' = v_ea_id::text
     order by aol.created_at desc
     limit 20
  loop
    select * into v_policy from public.enterprise_notification_policies
     where enterprise_account_id = v_ea_id and scope_type = 'brand' and scope_id is null
       and incident_type = 'settlement_paid_blocked';
    if v_policy.enabled then
      select public._hq_emit_incident(
        v_ea_id, null, 'settlement_paid_blocked', v_policy.severity, v_recipient,
        '정산 지급 차단',
        coalesce(v_paid_blocked.message, '정산 지급이 차단되었습니다.'),
        jsonb_build_object(
          'log_id', v_paid_blocked.id,
          'details', v_paid_blocked.details,
          'recommended_action', '지급 조건 및 이월 chain 상태를 확인 후 정산센터에서 재검토하세요.',
          'action_url', '/enterprise/me',
          'automation_candidate', false,
          'recovery_hint', '재정산 성공 시 자동 해제 후보'),
        v_policy.cooldown_minutes
      ) into v_incident_id;
      if v_incident_id is not null then
        select (created_at = updated_at and occurrence_count = 1) into v_is_created
          from public.enterprise_incidents where id = v_incident_id;
        if v_is_created then v_created := v_created + 1;
          v_by_type := jsonb_set(v_by_type, array['settlement_paid_blocked'],
            to_jsonb(coalesce((v_by_type->>'settlement_paid_blocked')::int, 0) + 1));
        else v_updated := v_updated + 1; end if;
        select max(created_at) into v_last_notif from public.enterprise_notifications
         where incident_id = v_incident_id and recipient_user_id = v_recipient;
        if v_is_created or v_last_notif is null
           or v_last_notif < now() - (v_policy.cooldown_minutes || ' minutes')::interval then
          insert into public.enterprise_notifications
            (enterprise_account_id, incident_id, target_type, recipient_user_id,
             notification_type, title, message, severity, action_url, metadata)
          values (v_ea_id, v_incident_id, 'user', v_recipient,
                  'settlement_paid_blocked',
                  '정산 지급 차단',
                  '정산 지급이 차단됐어요. 지급 조건을 확인해주세요.',
                  v_policy.severity, '/enterprise/me',
                  jsonb_build_object('log_id', v_paid_blocked.id));
          v_notifs := v_notifs + 1;
          insert into public.enterprise_incident_events (incident_id, event_type, message)
          values (v_incident_id, 'notification_sent', 'internal notification created');
        end if;
      end if;
    else
      v_skipped := v_skipped + 1;
      v_skipped_reasons := jsonb_set(v_skipped_reasons, array['settlement_paid_blocked'],
        to_jsonb(coalesce((v_skipped_reasons->>'settlement_paid_blocked')::int, 0) + 1));
    end if;
  end loop;

  -- Audit log 요약
  perform public.admin_log_operation(
    'enterprise_incidents', 'hq', 'success', 'incident.scan',
    format('HQ scan (ea=%s, scanned=%s, created=%s, updated=%s, notifs=%s)',
      v_ea_id, v_scanned, v_created, v_updated, v_notifs),
    jsonb_build_object(
      'action', 'incident.scan',
      'enterprise_account_id', v_ea_id,
      'scanned_store_count', v_scanned,
      'created_count', v_created,
      'updated_count', v_updated,
      'notification_created_count', v_notifs,
      'by_type', v_by_type),
    auth.uid(), v_ea_id::text, null, null, null
  );

  return jsonb_build_object(
    'success', true,
    'scan_started_at', v_scan_started,
    'scan_finished_at', clock_timestamp(),
    'duration_ms', (extract(epoch from (clock_timestamp() - v_scan_started)) * 1000)::int,
    'scanned_store_count', v_scanned,
    'created_count', v_created,
    'updated_count', v_updated,
    'notification_created_count', v_notifs,
    'skipped_count', v_skipped,
    'skipped_reasons', v_skipped_reasons,
    'by_type', v_by_type
  );
end;
$$;
revoke execute on function public.run_my_enterprise_incident_scan() from public, anon;
grant   execute on function public.run_my_enterprise_incident_scan() to authenticated;


-- ============================================================
-- 17) Helper: _hq_emit_incident
--    partial unique 활용 upsert · 반환 incident_id
-- ============================================================
create or replace function public._hq_emit_incident(
  p_ea_id uuid,
  p_store_id uuid,
  p_type text,
  p_severity text,
  p_recipient uuid,
  p_title text,
  p_message text,
  p_metadata jsonb,
  p_cooldown_minutes int
)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_id uuid;
  v_sentinel uuid := '00000000-0000-0000-0000-000000000000';
begin
  -- ON CONFLICT partial unique index — coalesce 표현식이 정확히 일치해야 매칭
  insert into public.enterprise_incidents
    (enterprise_account_id, store_id, incident_type, severity,
     title, message, source, detected_at, last_seen_at, metadata)
  values (p_ea_id, p_store_id, p_type, p_severity, p_title, p_message, 'scan',
          now(), now(), coalesce(p_metadata, '{}'::jsonb))
  on conflict (enterprise_account_id, (coalesce(store_id, '00000000-0000-0000-0000-000000000000'::uuid)), incident_type)
    where status in ('open','acknowledged')
  do update set
    occurrence_count = enterprise_incidents.occurrence_count + 1,
    last_seen_at = now(),
    -- 정책 severity 는 최신 값으로 refresh (관리자가 정책 바꾼 경우 반영)
    severity = excluded.severity,
    -- automation 필드 metadata 는 최신 hint 로 refresh (다른 key 는 유지)
    metadata = enterprise_incidents.metadata || coalesce(p_metadata, '{}'::jsonb),
    updated_at = now()
  returning id into v_id;

  -- created vs updated 여부는 caller 에서 판정 (occurrence_count = 1)
  if v_id is not null then
    -- created 판정: occurrence_count = 1 AND created_at = updated_at
    -- 이 조건이 참이면 events 에 'created' 기록, 아니면 'recurrence'
    insert into public.enterprise_incident_events (incident_id, event_type, message)
    select v_id,
      case when ei.occurrence_count = 1 and ei.created_at = ei.updated_at
        then 'created' else 'recurrence' end,
      case when ei.occurrence_count = 1 and ei.created_at = ei.updated_at
        then 'Incident detected by scan'
        else format('Recurrence detected (occurrence=%s)', ei.occurrence_count) end
      from public.enterprise_incidents ei where ei.id = v_id;
  end if;

  return v_id;
end;
$$;
revoke execute on function public._hq_emit_incident(uuid, uuid, text, text, uuid, text, text, jsonb, int) from public, anon;
grant   execute on function public._hq_emit_incident(uuid, uuid, text, text, uuid, text, text, jsonb, int) to authenticated;


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_tbl int;
  v_rpc int;
  v_idx int;
begin
  select count(*) into v_tbl from information_schema.tables
   where table_schema='public'
     and table_name in ('enterprise_incidents','enterprise_notifications',
                        'enterprise_notification_policies','enterprise_incident_events');
  select count(*) into v_rpc from pg_proc
   where proname in (
     '_hq_ensure_default_policies',
     '_hq_emit_incident',
     'get_my_enterprise_incident_kpi',
     'get_my_enterprise_incidents',
     'get_my_enterprise_incident_detail',
     'acknowledge_my_enterprise_incident',
     'resolve_my_enterprise_incident',
     'get_my_enterprise_notifications',
     'mark_my_enterprise_notification_read',
     'mark_all_my_enterprise_notifications_read',
     'get_my_enterprise_notification_policies',
     'update_my_enterprise_notification_policy',
     'run_my_enterprise_incident_scan'
   );
  select count(*) into v_idx from pg_indexes
   where schemaname='public'
     and indexname in ('idx_incidents_ea_status', 'uniq_incident_open_per_scope',
                       'idx_notifications_recipient_unread', 'idx_notifications_ea',
                       'uniq_notif_policy', 'idx_incident_events_incident');

  raise notice '====== 0403 HQ Notification Center Diagnostics ======';
  raise notice 'tables: % / 4', v_tbl;
  raise notice 'RPCs (incl helpers): % / 13', v_rpc;
  raise notice 'indexes: % / 6', v_idx;
  raise notice '=====================================================';

  if v_tbl = 4 and v_rpc = 13 and v_idx = 6 then
    raise notice '0403 COMPLETE — HQ Notification & Incident Center ready';
  else
    raise warning '0403 INCOMPLETE — 위 카운트 확인';
  end if;
end$$;
