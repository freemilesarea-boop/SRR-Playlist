-- 0096 — HOTFIX: admin_member_detail 의 존재하지 않는 컬럼 참조 정정
--
-- 원인:
--   0042 시점 admin_member_detail 본문이 미래 도입 가정으로 작성된 컬럼을 참조:
--     - revenue_events.sales_agent_id / sales_agent_code   (실제 부재)
--     - sales_agents.linked_at                              (실제 부재 — created_at 만 존재)
--   PostgreSQL 함수 본문은 lazy bind 라 CREATE OR REPLACE 시점엔 검증 안 됨.
--   호출 시점 (runtime) 에 42703 column does not exist 로 fail.
--   0095 가 같은 본문으로 함수를 재정의하며 production runtime 에서 400 오류 발생.
--
-- 수정:
--   - revenue 섹션: sales_agent_id/code 제거, payment_provider/note 만 노출
--     (영업인 정보는 별도 'sales_agent' jsonb 키로 이미 노출)
--   - sales_agent 섹션: linked_at → created_at 으로 대체
--
-- 0095 는 history 보존을 위해 수정하지 않고 본 hotfix migration 으로 prod 동기화.

create or replace function public.admin_member_detail(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  select jsonb_build_object(
    'user', jsonb_build_object(
      'id', u.id, 'email', au.email, 'nickname', u.nickname,
      'role', u.role, 'subscription_type', u.subscription_type,
      'account_type', u.account_type, 'membership_tier', u.membership_tier,
      'business_category', u.business_category, 'created_at', u.created_at,
      'withdrawn_at', u.withdrawn_at, 'withdrawn_reason', u.withdrawn_reason,
      'disabled_at', u.disabled_at, 'disabled_reason', u.disabled_reason,
      'pii_masked_at', u.pii_masked_at,
      'last_sign_in_at', au.last_sign_in_at
    ),
    'subscriptions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'status', s.status, 'plan_type', s.plan_type,
        'price', s.price, 'auto_renew', s.auto_renew,
        'last_paid_at', s.last_paid_at,
        'current_period_start', s.current_period_start,
        'current_period_end', s.current_period_end,
        'canceled_at', s.canceled_at, 'cancel_reason', s.cancel_reason,
        'refunded_at', s.refunded_at,
        'payapp_mul_no', s.payapp_mul_no,
        'payapp_rebill_no', s.payapp_rebill_no,
        'created_at', s.created_at) order by s.created_at desc), '[]'::jsonb)
      from public.subscriptions as s where s.user_id = p_user_id
    ),
    'total_streams', (
      select count(*) from public.stream_events as se
      where se.user_id = p_user_id and se.event_type='milestone_30s'),
    'total_listened_seconds', coalesce((
      select sum(se.listened_seconds) from public.stream_events as se
      where se.user_id = p_user_id and se.event_type in ('milestone_30s','complete')), 0),
    'last_seen_at', (
      select max(ve.created_at) from public.visitor_events as ve where ve.user_id = p_user_id),
    'recent_visits', (
      select coalesce(jsonb_agg(jsonb_build_object('path', v.path, 'created_at', v.created_at) order by v.created_at desc), '[]'::jsonb)
      from (select ve.path, ve.created_at from public.visitor_events as ve
            where ve.user_id = p_user_id order by ve.created_at desc limit 10) as v),
    'recent_plays', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'track_title', rp.track_title, 'playlist_title', rp.playlist_title,
        'completed', rp.completed, 'created_at', rp.created_at) order by rp.created_at desc), '[]'::jsonb)
      from (select se.created_at, t.title as track_title, p.title as playlist_title,
              (se.event_type = 'complete') as completed
            from public.stream_events as se
            left join public.tracks as t on t.id = se.track_id
            left join public.playlists as p on p.id = se.playlist_id
            where se.user_id = p_user_id and se.event_type in ('milestone_30s', 'complete')
            order by se.created_at desc limit 10) as rp),
    'revenue', (
      -- 0096 — sales_agent_id / sales_agent_code 컬럼 실제 부재. 영업인 정보는 'sales_agent' 키에 이미 있음.
      select coalesce(jsonb_agg(jsonb_build_object(
        'amount', re.amount, 'subscription_type', re.subscription_type,
        'status', re.status, 'paid_at', re.paid_at,
        'payment_provider', re.payment_provider,
        'note', re.note) order by re.paid_at desc), '[]'::jsonb)
      from public.revenue_events as re where re.user_id = p_user_id),
    'subscription_requests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'requested_plan', sr.requested_plan, 'status', sr.status, 'created_at', sr.created_at) order by sr.created_at desc), '[]'::jsonb)
      from public.subscription_requests as sr where sr.user_id = p_user_id),
    'sales_agent', (
      -- 0096 — sales_agents.linked_at 부재 → created_at 으로 대체
      select jsonb_build_object(
        'id', sa.id, 'name', sa.name, 'code', sa.code,
        'is_active', sa.is_active, 'commission_rate', sa.commission_rate,
        'linked_at', sa.created_at)
      from public.sales_agents as sa where sa.user_id = p_user_id limit 1)
  )
  into v_result
  from public.users as u
  left join auth.users as au on au.id = u.id
  where u.id = p_user_id;

  return v_result;
end; $$;

revoke execute on function public.admin_member_detail(uuid) from public, anon;
grant execute on function public.admin_member_detail(uuid) to authenticated;

notify pgrst, 'reload schema';
