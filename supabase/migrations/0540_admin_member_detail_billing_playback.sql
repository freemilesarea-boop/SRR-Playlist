-- 관리자 회원 상세에 해지방어용 두 블록을 추가한다.
--   billing_failures : 정기결제 청구 시도 이력(실패 포함) + 복구 알림 발송 결과
--   playback_trend   : 최근 6개월 재생량 추이(KST 월 단위)
-- 기존 키는 건드리지 않고 최상위 키만 더한다. admin 게이트는 그대로 유지한다.
CREATE OR REPLACE FUNCTION public.admin_member_detail(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'pii_masked_at', u.pii_masked_at, 'is_curator', u.is_curator,
      'last_sign_in_at', au.last_sign_in_at,
      'plan_type', u.plan_type,
      'plan_monthly_quota', public._plan_monthly_quota(u.plan_type),
      'plan_used_this_month', (
        select count(*)::int from public.tracks t
        where t.owner_user_id = u.id
          and t.source_type = 'artist_upload'
          and t.created_at >= (date_trunc('month', (now() at time zone 'Asia/Seoul'))::timestamp at time zone 'Asia/Seoul')
          and t.created_at <  ((date_trunc('month', (now() at time zone 'Asia/Seoul')) + interval '1 month')::timestamp at time zone 'Asia/Seoul')
          and t.removed_at is null
          and t.release_status in ('submitted','review_pending','changes_requested','approved','scheduled','released')
          and coalesce(t.visibility_status, '') <> 'rejected'
      )
    ),
    -- 해지방어용 연락 정보. pii_masked_at 이 찍힌 회원은 저장된 값 자체가 이미
    -- 마스킹돼 있으므로 여기서 따로 가리지 않는다(화면에서 마스킹 여부를 알린다).
    'contact', jsonb_build_object(
      'full_name', u.full_name,
      'phone', u.phone,
      'address', u.address,
      'birth_date', u.birth_date,
      'identity_verified', u.identity_verified,
      'identity_provider', u.identity_provider,
      'identity_verified_at', u.identity_verified_at,
      'signup_completed', u.signup_completed,
      'sales_agent_code', u.sales_agent_code,
      'free_trial_started_at', u.free_trial_started_at,
      'free_trial_ends_at', u.free_trial_ends_at,
      'is_trial_active', u.is_trial_active,
      'playback_enabled', u.playback_enabled,
      -- 아티스트는 별도 프로필에 연락처가 따로 있다(가입 경로가 달라 값이 다를 수 있다).
      'artist_real_name', ap.real_name,
      'artist_phone', ap.phone,
      'artist_address', ap.address,
      'artist_approval_status', ap.approval_status
    ),
    -- 사업자 회원: 세금계산서·명의 확인·매장 연락에 쓰는 값들.
    'business', (
      select jsonb_build_object(
        'business_number', bv.business_number,
        'business_name', bv.business_name,
        'representative_name', bv.representative_name,
        'business_open_date', bv.business_open_date,
        'business_address', bv.business_address,
        'business_type', bv.business_type,
        'business_verified', bv.business_verified,
        'verification_status', bv.verification_status,
        'business_state', bv.business_state,
        'tax_type', bv.tax_type,
        'verified_at', bv.verified_at,
        'store_name', bp.store_name,
        'store_category', bp.business_type,
        'open_time', bp.open_time,
        'close_time', bp.close_time
      )
      from public.users as u2
      left join public.business_verification_profiles as bv on bv.user_id = u2.id
      left join public.business_profiles as bp on bp.user_id = u2.id
      where u2.id = p_user_id
      limit 1
    ),
    -- 정기결제 청구 시도 이력. 카드 거절·rebill_no 누락은 해지 직전 신호라
    -- 성공 건까지 같이 내려서 화면에서 흐름을 볼 수 있게 한다.
    -- payapp_raw 는 카드사 응답 원문이라 내리지 않는다.
    'billing_failures', jsonb_build_object(
      'failure_count_90d', (
        select count(*)::int from public.subscription_rebill_charges as c
        where c.user_id = p_user_id
          and c.status in ('failed','provider_rejected','unknown','skipped')
          and c.requested_at >= now() - interval '90 days'
      ),
      'last_failure_at', (
        select max(c.requested_at) from public.subscription_rebill_charges as c
        where c.user_id = p_user_id
          and c.status in ('failed','provider_rejected','unknown','skipped')
      ),
      'last_paid_at', (
        select max(coalesce(c.resolved_at, c.requested_at)) from public.subscription_rebill_charges as c
        where c.user_id = p_user_id and c.status = 'paid'
      ),
      'charges', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', x.id,
          'status', x.status,
          'payapp_state', x.payapp_state,
          'error_message', x.error_message,
          'amount', x.amount,
          'plan_type', x.plan_type,
          'operation_type', x.operation_type,
          'cycle_period_end', x.cycle_period_end,
          'requested_at', x.requested_at,
          'resolved_at', x.resolved_at
        ) order by x.requested_at desc nulls last), '[]'::jsonb)
        from (
          select c.* from public.subscription_rebill_charges as c
          where c.user_id = p_user_id
          order by c.requested_at desc nulls last
          limit 10
        ) as x
      ),
      -- 결제 실패 안내가 실제로 전달됐는지(알림 자체가 실패하면 회원은 모른 채 해지된다).
      'notifications', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'channel', n.channel,
          'template_type', n.template_type,
          'status', n.status,
          'failure_code', n.failure_code,
          'scheduled_charge_at', n.scheduled_charge_at,
          'sent_at', n.sent_at,
          'created_at', n.created_at
        ) order by n.created_at desc), '[]'::jsonb)
        from (
          select b.* from public.billing_recovery_notifications as b
          where b.user_id = p_user_id
          order by b.created_at desc
          limit 5
        ) as n
      )
    ),
    -- 최근 6개월 재생량 추이(KST 월). 전월 대비 급감은 이탈 신호다.
    -- 집계 소스는 member_playback_totals 와 동일하게 맞춘다:
    -- v2 컷오버 이후는 stream_sessions_v2, 그 이전은 stream_events.
    'playback_trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'month', to_char(m.month_start, 'YYYY-MM'),
          'plays', coalesce(agg.plays, 0),
          'listened_seconds', coalesce(agg.listened_seconds, 0)
        ) order by m.month_start), '[]'::jsonb)
      from (
        select generate_series(
          date_trunc('month', (now() at time zone 'Asia/Seoul')) - interval '5 months',
          date_trunc('month', (now() at time zone 'Asia/Seoul')),
          interval '1 month'
        )::date as month_start
      ) as m
      left join (
        select date_trunc('month', ev.at_kst)::date as month_start,
               count(*)::int as plays,
               coalesce(sum(ev.seconds), 0)::bigint as listened_seconds
        from (
          select (s.created_at at time zone 'Asia/Seoul') as at_kst,
                 case when s.last_heartbeat_at is null then 0
                      else least(extract(epoch from (s.last_heartbeat_at - s.created_at)), 1800)
                 end as seconds
          from public.stream_sessions_v2 as s
          where s.user_id = p_user_id
          union all
          select (e.created_at at time zone 'Asia/Seoul') as at_kst,
                 coalesce(e.listened_seconds, 0)::numeric as seconds
          from public.stream_events as e
          where e.user_id = p_user_id
            and e.event_type in ('milestone_30s','complete')
            and e.created_at < public._stream_v2_cutover()
        ) as ev
        group by 1
      ) as agg on agg.month_start = m.month_start
    ),
    'subscriptions', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'status', s.status, 'plan_type', s.plan_type, 'price', s.price,
      'auto_renew', s.auto_renew, 'last_paid_at', s.last_paid_at,
      'current_period_start', s.current_period_start, 'current_period_end', s.current_period_end,
      'canceled_at', s.canceled_at, 'cancel_reason', s.cancel_reason, 'refunded_at', s.refunded_at,
      'payapp_mul_no', s.payapp_mul_no, 'payapp_rebill_no', s.payapp_rebill_no,
      'created_at', s.created_at) order by s.created_at desc), '[]'::jsonb)
      from public.subscriptions as s where s.user_id = p_user_id),
    'total_streams', (select t.total_streams from public.member_playback_totals(p_user_id) t),
    'total_listened_seconds', (select t.total_listened_seconds from public.member_playback_totals(p_user_id) t), 'total_verified_seconds', (select t.total_verified_seconds from public.member_playback_totals(p_user_id) t),
    'last_seen_at', (select max(ve.created_at) from public.visitor_events as ve where ve.user_id = p_user_id),
    'recent_visits', (select coalesce(jsonb_agg(jsonb_build_object('path', v.path, 'created_at', v.created_at) order by v.created_at desc), '[]'::jsonb)
      from (select ve.path, ve.created_at from public.visitor_events as ve where ve.user_id = p_user_id order by ve.created_at desc limit 10) as v),
    'recent_plays', (select coalesce(jsonb_agg(jsonb_build_object('track_title', rp.track_title, 'playlist_title', rp.playlist_title, 'completed', rp.completed, 'created_at', rp.created_at) order by rp.created_at desc), '[]'::jsonb)
      from (select se.created_at, t.title as track_title, p.title as playlist_title, (se.event_type = 'complete') as completed
            from public.stream_events as se left join public.tracks as t on t.id = se.track_id left join public.playlists as p on p.id = se.playlist_id
            where se.user_id = p_user_id and se.event_type in ('milestone_30s', 'complete') order by se.created_at desc limit 10) as rp),
    'revenue', (select coalesce(jsonb_agg(jsonb_build_object('amount', re.amount, 'subscription_type', re.subscription_type, 'status', re.status, 'paid_at', re.paid_at, 'payment_provider', re.payment_provider, 'note', re.note) order by re.paid_at desc), '[]'::jsonb)
      from public.revenue_events as re where re.user_id = p_user_id),
    'subscription_requests', (select coalesce(jsonb_agg(jsonb_build_object('requested_plan', sr.requested_plan, 'status', sr.status, 'created_at', sr.created_at) order by sr.created_at desc), '[]'::jsonb)
      from public.subscription_requests as sr where sr.user_id = p_user_id),
    'promotions', (select coalesce(jsonb_agg(jsonb_build_object(
        'code', pc.code, 'name', pc.name, 'discount_type', pc.discount_type,
        'discount_amount', r.discount_amount, 'original_amount', r.original_amount,
        'final_amount', r.final_amount, 'plan_type', r.plan_type, 'redeemed_at', r.redeemed_at) order by r.redeemed_at desc), '[]'::jsonb)
      from public.promotion_code_redemptions as r join public.promotion_codes as pc on pc.id = r.promotion_code_id where r.user_id = p_user_id),
    'sales_agent', (select jsonb_build_object('id', sa.id, 'name', sa.name, 'code', sa.code, 'is_active', sa.is_active, 'commission_rate', sa.commission_rate, 'linked_at', sa.created_at)
      from public.sales_agents as sa where sa.user_id = p_user_id limit 1)
  )
  into v_result
  from public.users as u
  left join auth.users as au on au.id = u.id
  left join public.artist_profiles as ap on ap.user_id = u.id
  where u.id = p_user_id;
  return v_result;
end; $function$;
