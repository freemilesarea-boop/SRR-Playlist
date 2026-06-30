-- 0393 — NOC 알림 감시 워커: active alerts → admin_notifications 영속화 (Phase 1-3)
--
-- 배경 (운영 감사 K/F23):
--   NOC(0385) 의 admin_noc_active_alerts 가 오프라인/정책 배포 실패/재생 오류/기기
--   미연결 등을 "조회 시 실시간 계산" 하지만, admin_notifications 로 영속화·발송되지
--   않아 운영자가 능동적으로 알림을 받지 못했음. (탐지는 있으나 알림 생성 미연결.)
--
-- 수정 (탐지 재구현 X — NOC 재사용):
--   admin_noc_sync_alerts_to_notifications() 가 admin_noc_active_alerts 결과 중
--   major+critical 을 create_admin_notification 으로 영속화. 이후 enterprise-ops cron
--   의 dispatch 단계(0392 멱등)가 Slack/이메일 발송.
--
-- 중복 방지:
--   dedup key = '<store_id>:<category>' (store + condition). context->>'noc_dedup_key' 에 저장.
--   cooldown(기본 6h) 내 같은 key 알림이 이미 있으면 생성 skip → 지속 상태가 매 cron tick
--   마다 새 알림을 만들지 않음. (발송 단위 중복은 0392 dispatched_at 이 별도 차단.)
--
-- severity 매핑: NOC critical→'error', major→'warning' (create_admin_notification 제약:
--   info/warning/error). dispatch min_severity 기본 'warning' → major+critical 모두 발송.
--
-- 절대 무수정:
--   - admin_noc_active_alerts / NOC RPC 본문, create_admin_notification, 알림 UI,
--     dispatch-admin-notifications, 기존 cron 구조(스캔 단계만 추가) 무수정.
--   - 신규 RPC + dedup 조회용 index 만 추가.

-- ============================================================
-- 1) cooldown dedup 조회용 index (additive)
-- ============================================================
create index if not exists idx_admin_notif_noc_dedup
  on public.admin_notifications ((context ->> 'noc_dedup_key'), created_at desc)
  where kind = 'noc_alert';

-- ============================================================
-- 2) admin_noc_sync_alerts_to_notifications — 감시 워커
-- ============================================================
create or replace function public.admin_noc_sync_alerts_to_notifications(
  p_cooldown_hours int default 6
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cooldown interval := make_interval(hours => greatest(coalesce(p_cooldown_hours, 6), 1));
  v_alerts   jsonb;
  v_a        jsonb;
  v_noc_sev  text;
  v_sev      text;
  v_cat      text;
  v_store    uuid;
  v_key      text;
  v_scanned  int := 0;
  v_created  int := 0;
  v_skipped  int := 0;
begin
  -- service_role(cron, 0391) 또는 super_admin 만
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  -- NOC 탐지 재사용 (재구현 금지). 상위 200건 (severity 정렬 critical→major→minor).
  v_alerts := public.admin_noc_active_alerts(200, null) -> 'data';

  for v_a in
    select value from jsonb_array_elements(coalesce(v_alerts, '[]'::jsonb))
  loop
    v_noc_sev := v_a ->> 'severity';
    -- major + critical 만 영속화 (minor 제외)
    if v_noc_sev not in ('critical', 'major') then
      continue;
    end if;
    v_scanned := v_scanned + 1;

    v_cat   := v_a ->> 'category';
    v_store := nullif(v_a ->> 'store_id', '')::uuid;
    -- dedup key = store + condition
    v_key   := coalesce(v_store::text, '-') || ':' || coalesce(v_cat, '-');

    -- cooldown: 같은 key 알림이 cooldown 내 이미 있으면 skip
    if exists (
      select 1 from public.admin_notifications n
       where n.kind = 'noc_alert'
         and n.context ->> 'noc_dedup_key' = v_key
         and n.created_at >= now() - v_cooldown
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_sev := case v_noc_sev when 'critical' then 'error' else 'warning' end;

    perform public.create_admin_notification(
      'noc_alert',
      v_sev,
      coalesce(nullif(btrim(coalesce(v_a ->> 'message', '')), ''), 'NOC alert'),
      v_a ->> 'error_message',
      jsonb_build_object(
        'noc_dedup_key',  v_key,
        'noc_severity',   v_noc_sev,
        'category',       v_cat,
        'store_id',       v_store,
        'store_name',     v_a ->> 'store_name',
        'franchise_name', v_a ->> 'franchise_name',
        'region_name',    v_a ->> 'region_name',
        'ref_id',         v_a ->> 'ref_id',
        'event_at',       v_a ->> 'event_at'
      ),
      null  -- track_id 없음 (store-level 알림)
    );
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'scanned', v_scanned,
    'created', v_created,
    'skipped_cooldown', v_skipped,
    'cooldown_hours', greatest(coalesce(p_cooldown_hours, 6), 1),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_noc_sync_alerts_to_notifications(int) from public, anon;
grant   execute on function public.admin_noc_sync_alerts_to_notifications(int) to authenticated, service_role;

-- ============================================================
-- 3) Diagnostics
-- ============================================================
do $$
declare v_fn int; v_idx int;
begin
  select count(*) into v_fn from pg_proc
   where pronamespace='public'::regnamespace and proname='admin_noc_sync_alerts_to_notifications';
  select count(*) into v_idx from pg_indexes where indexname='idx_admin_notif_noc_dedup';
  raise notice '====== 0393 NOC alert sync worker ======';
  raise notice 'sync rpc: % / 1 ; dedup index: % / 1', v_fn, v_idx;
  if v_fn = 1 and v_idx = 1 then
    raise notice '0393 COMPLETE — NOC active alerts → admin_notifications (major+critical, store:condition dedup, cooldown)';
  else
    raise warning '0393 INCOMPLETE';
  end if;
end$$;
