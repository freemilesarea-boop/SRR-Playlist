-- 0095 — 관리자 회원 위험 작업: 신규 컬럼 + RPC 묶음
--
-- 추가 컬럼:
--   users.disabled_at       — 비활성화 시각 (RequireAuth 차단 기준)
--   users.disabled_reason   — 비활성화 사유 (운영 메모)
--   users.pii_masked_at     — PII 마스킹 처리 시각 (마스킹 후 재마스킹 차단)
--
-- 신규 RPC:
--   admin_disable_user(p_user_id, p_reason)     — 비활성화 + 활성 구독 cancel_scheduled
--   admin_enable_user(p_user_id)                — 비활성화 해제
--   admin_withdraw_user(p_user_id, p_reason)    — 운영자 대행 탈퇴 (활성 구독 cancel + tier free)
--   admin_mask_user_pii(p_user_id)              — full_name/phone/address/birth_date null + nickname 익명화
--   admin_force_sign_out_user(p_user_id)        — auth.refresh_tokens 삭제 (sign out everywhere)
--   admin_can_hard_delete_user(p_user_id)       — 진단 only (RESTRICT FK 5개 검사 결과 반환)
--
-- admin_member_detail / admin_member_list 갱신:
--   disabled_at / disabled_reason / pii_masked_at / last_sign_in_at(auth.users) 노출
--
-- 가드:
--   - admin 본인 (auth.uid() = p_user_id) → reject
--   - 마지막 admin 1명 (role='admin' count <= 1 AND target is admin) → reject
--   - withdrawn 후 30일 미만 마스킹은 허용 (정책 — 운영자 재량)
--
-- 정책:
--   - hard delete 는 본 마이그레이션에서 구현하지 않음. 진단 RPC 만 제공.
--   - auth.users.email 은 본 마이그레이션에서 마스킹하지 않음 (정산/환불 분쟁 대비 보존).
--   - 모든 RPC 끝에서 admin_log_operation 호출 (실패해도 silent).

-- ============================================
-- 1) 컬럼 추가
-- ============================================
alter table public.users
  add column if not exists disabled_at      timestamptz,
  add column if not exists disabled_reason  text,
  add column if not exists pii_masked_at    timestamptz;

create index if not exists users_disabled_at_idx
  on public.users(disabled_at) where disabled_at is not null;

create index if not exists users_pii_masked_at_idx
  on public.users(pii_masked_at) where pii_masked_at is not null;

-- ============================================
-- 2) 내부 가드 헬퍼 — 본인 차단 + 마지막 admin 차단
-- ============================================
create or replace function public._admin_user_action_guards(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_target_role text;
  v_admin_count int;
begin
  if v_caller is null then
    raise exception 'unauthorized: no auth context';
  end if;

  if v_caller = p_user_id then
    raise exception 'self-protection: 자기 자신을 대상으로 위험 작업을 수행할 수 없어요.';
  end if;

  select role into v_target_role from public.users where id = p_user_id;
  if v_target_role is null then
    raise exception 'user not found';
  end if;

  if v_target_role = 'admin' then
    select count(*) into v_admin_count
      from public.users
      where role = 'admin'
        and (disabled_at is null)
        and (withdrawn_at is null);
    if v_admin_count <= 1 then
      raise exception 'last-admin guard: 마지막 활성 관리자는 비활성/탈퇴할 수 없어요.';
    end if;
  end if;
end;
$$;

-- ============================================
-- 3) admin_disable_user — 비활성화
-- ============================================
create or replace function public.admin_disable_user(
  p_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canceled_subs int := 0;
begin
  -- admin 권한 + 가드 검증
  if not _internal_is_admin_caller() then
    raise exception 'admin only';
  end if;
  perform public._admin_user_action_guards(p_user_id);

  -- 이미 비활성이면 idempotent (사유만 업데이트)
  update public.users
    set disabled_at = coalesce(disabled_at, now()),
        disabled_reason = coalesce(p_reason, disabled_reason)
    where id = p_user_id;

  -- 활성 구독 → cancel_scheduled 전환 (즉시 환불 X, 잔여 기간 사용)
  update public.subscriptions
    set status = 'cancel_scheduled',
        auto_renew = false,
        cancel_requested_at = coalesce(cancel_requested_at, now()),
        cancel_reason = coalesce(cancel_reason, '[admin disable] ' || coalesce(p_reason, ''))
    where user_id = p_user_id
      and status in ('active', 'payment_waiting');
  get diagnostics v_canceled_subs = row_count;

  -- audit
  begin
    perform admin_log_operation(
      'admin_member_actions', 'member', 'warning', 'completed',
      format('disable user %s', p_user_id),
      jsonb_build_object('user_id', p_user_id, 'reason', p_reason, 'canceled_subs', v_canceled_subs),
      p_user_id, p_user_id::text, null, null, null
    );
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'canceled_subs', v_canceled_subs);
end;
$$;

revoke execute on function public.admin_disable_user(uuid, text) from public, anon;
grant execute on function public.admin_disable_user(uuid, text) to authenticated;

-- ============================================
-- 4) admin_enable_user — 비활성화 해제
-- ============================================
create or replace function public.admin_enable_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not _internal_is_admin_caller() then
    raise exception 'admin only';
  end if;
  -- self / last-admin 가드는 enable 에는 적용 안 함 (해제는 안전한 방향)

  update public.users
    set disabled_at = null,
        disabled_reason = null
    where id = p_user_id;

  begin
    perform admin_log_operation(
      'admin_member_actions', 'member', 'info', 'completed',
      format('enable user %s', p_user_id),
      jsonb_build_object('user_id', p_user_id),
      p_user_id, p_user_id::text, null, null, null
    );
  exception when others then null; end;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.admin_enable_user(uuid) from public, anon;
grant execute on function public.admin_enable_user(uuid) to authenticated;

-- ============================================
-- 5) admin_withdraw_user — 운영자 대행 탈퇴
-- ============================================
create or replace function public.admin_withdraw_user(
  p_user_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canceled_subs int := 0;
begin
  if not _internal_is_admin_caller() then
    raise exception 'admin only';
  end if;
  perform public._admin_user_action_guards(p_user_id);

  -- 활성 구독 자동 cancel
  update public.subscriptions
    set status = 'cancel_scheduled',
        auto_renew = false,
        cancel_requested_at = coalesce(cancel_requested_at, now()),
        cancel_reason = coalesce(cancel_reason, '[admin withdraw] ' || coalesce(p_reason, ''))
    where user_id = p_user_id
      and status in ('active', 'payment_waiting');
  get diagnostics v_canceled_subs = row_count;

  -- withdraw 처리 + tier reset
  update public.users
    set withdrawn_at = coalesce(withdrawn_at, now()),
        withdrawn_reason = coalesce(p_reason, withdrawn_reason),
        membership_tier = 'free',
        subscription_type = 'free'
    where id = p_user_id;

  begin
    perform admin_log_operation(
      'admin_member_actions', 'member', 'warning', 'completed',
      format('withdraw user %s', p_user_id),
      jsonb_build_object('user_id', p_user_id, 'reason', p_reason, 'canceled_subs', v_canceled_subs),
      p_user_id, p_user_id::text, null, null, null
    );
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'canceled_subs', v_canceled_subs);
end;
$$;

revoke execute on function public.admin_withdraw_user(uuid, text) from public, anon;
grant execute on function public.admin_withdraw_user(uuid, text) to authenticated;

-- ============================================
-- 6) admin_mask_user_pii — 개인정보 마스킹
-- ============================================
create or replace function public.admin_mask_user_pii(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anon_nick text;
begin
  if not _internal_is_admin_caller() then
    raise exception 'admin only';
  end if;
  perform public._admin_user_action_guards(p_user_id);

  -- 안전장치: 이미 마스킹된 사용자 재마스킹 차단 (실수 방지)
  if exists (select 1 from public.users where id = p_user_id and pii_masked_at is not null) then
    raise exception 'already masked: 이미 PII 마스킹 처리된 사용자에요.';
  end if;

  v_anon_nick := '탈퇴회원_' || substr(p_user_id::text, 1, 8);

  update public.users
    set nickname = v_anon_nick,
        full_name = null,
        phone = null,
        address = null,
        birth_date = null,
        identity_ci = null,
        identity_di = null,
        business_category = null,
        pii_masked_at = now()
    where id = p_user_id;

  -- artist_profiles 가 있으면 거기서도 PII 마스킹 (정산용 artist_name 은 보존)
  update public.artist_profiles
    set real_name = null,
        phone = null,
        address = null,
        birth_date = '1900-01-01'::date
    where user_id = p_user_id;

  -- business_profiles 의 매장 주소 등은 정산/세금 이력 없음 → null 가능
  update public.business_profiles
    set business_name = null,
        phone = null,
        address = null
    where user_id = p_user_id;

  begin
    perform admin_log_operation(
      'admin_member_actions', 'member', 'warning', 'completed',
      format('mask PII user %s', p_user_id),
      jsonb_build_object('user_id', p_user_id, 'anon_nickname', v_anon_nick),
      p_user_id, p_user_id::text, null, null, null
    );
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'anon_nickname', v_anon_nick);
end;
$$;

revoke execute on function public.admin_mask_user_pii(uuid) from public, anon;
grant execute on function public.admin_mask_user_pii(uuid) to authenticated;

-- ============================================
-- 7) admin_force_sign_out_user — sign out everywhere
-- auth.refresh_tokens.user_id 는 varchar 라 ::text 캐스팅 필수
-- 권한 부족 시 silent fail (RequireAuth 가 disabled_at/withdrawn_at 기반으로 차단)
-- ============================================
create or replace function public.admin_force_sign_out_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_deleted int := 0;
  v_error text := null;
begin
  if not _internal_is_admin_caller() then
    raise exception 'admin only';
  end if;

  begin
    delete from auth.refresh_tokens where user_id = p_user_id::text;
    get diagnostics v_deleted = row_count;
  exception when others then
    v_error := SQLERRM;
    v_deleted := -1;
  end;

  begin
    perform admin_log_operation(
      'admin_member_actions', 'member',
      case when v_error is null then 'info' else 'warning' end,
      'completed',
      format('force sign out user %s', p_user_id),
      jsonb_build_object('user_id', p_user_id, 'deleted_tokens', v_deleted, 'error', v_error),
      p_user_id, p_user_id::text, null, null, v_error
    );
  exception when others then null; end;

  return jsonb_build_object('ok', v_error is null, 'deleted_tokens', v_deleted, 'error', v_error);
end;
$$;

revoke execute on function public.admin_force_sign_out_user(uuid) from public, anon;
grant execute on function public.admin_force_sign_out_user(uuid) to authenticated;

-- ============================================
-- 8) admin_can_hard_delete_user — 진단 only (실제 삭제 안 함)
-- RESTRICT FK 5개 검사 → 결과 jsonb 반환
-- ============================================
create or replace function public.admin_can_hard_delete_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contracts int;
  v_settlements int;
  v_settlement_items int;
  v_streaming_revenues int;
  v_payout_reveals int;
  v_can_delete boolean;
begin
  if not _internal_is_admin_caller() then
    raise exception 'admin only';
  end if;

  select count(*) into v_contracts        from public.artist_contracts        where artist_user_id = p_user_id;
  select count(*) into v_settlements      from public.artist_settlements      where artist_user_id = p_user_id;
  select count(*) into v_streaming_revenues from public.streaming_revenues    where artist_user_id = p_user_id;
  select count(*) into v_payout_reveals   from public.payout_account_reveal_logs where artist_user_id = p_user_id;
  -- settlement_items 는 artist_settlements 의 자식 — 부모만 검사하면 충분
  v_settlement_items := 0;

  v_can_delete := (v_contracts + v_settlements + v_streaming_revenues + v_payout_reveals = 0);

  return jsonb_build_object(
    'can_hard_delete', v_can_delete,
    'blocking', jsonb_build_object(
      'artist_contracts', v_contracts,
      'artist_settlements', v_settlements,
      'streaming_revenues', v_streaming_revenues,
      'payout_account_reveal_logs', v_payout_reveals
    ),
    'note',
      case when v_can_delete then 'RESTRICT FK 0건 — hard delete 가능. 단 이번 기능 범위는 진단 only.'
           else 'RESTRICT FK 가 존재해 hard delete 불가능. 마스킹 + 비활성화 권장.'
      end
  );
end;
$$;

revoke execute on function public.admin_can_hard_delete_user(uuid) from public, anon;
grant execute on function public.admin_can_hard_delete_user(uuid) to authenticated;

-- ============================================
-- 9) admin_member_detail 갱신 — 신규 필드 노출
-- ============================================
create or replace function public.admin_member_detail(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
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
      -- 신규 필드
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
        'created_at', s.created_at
      ) order by s.created_at desc), '[]'::jsonb)
      from public.subscriptions as s where s.user_id = p_user_id
    ),
    'total_streams', (
      select count(*) from public.stream_events as se
      where se.user_id = p_user_id and se.event_type='milestone_30s'
    ),
    'total_listened_seconds', coalesce((
      select sum(se.listened_seconds) from public.stream_events as se
      where se.user_id = p_user_id and se.event_type in ('milestone_30s','complete')
    ), 0),
    'last_seen_at', (
      select max(ve.created_at) from public.visitor_events as ve where ve.user_id = p_user_id
    ),
    'recent_visits', (
      select coalesce(
        jsonb_agg(jsonb_build_object('path', v.path, 'created_at', v.created_at) order by v.created_at desc),
        '[]'::jsonb
      )
      from (
        select ve.path, ve.created_at from public.visitor_events as ve
        where ve.user_id = p_user_id order by ve.created_at desc limit 10
      ) as v
    ),
    'recent_plays', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'track_title', rp.track_title, 'playlist_title', rp.playlist_title,
          'completed', rp.completed, 'created_at', rp.created_at
        ) order by rp.created_at desc),
        '[]'::jsonb
      )
      from (
        select se.created_at,
          t.title as track_title,
          p.title as playlist_title,
          (se.event_type = 'complete') as completed
        from public.stream_events as se
        left join public.tracks as t on t.id = se.track_id
        left join public.playlists as p on p.id = se.playlist_id
        where se.user_id = p_user_id
          and se.event_type in ('milestone_30s', 'complete')
        order by se.created_at desc
        limit 10
      ) as rp
    ),
    'revenue', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'amount', re.amount, 'subscription_type', re.subscription_type,
          'status', re.status, 'paid_at', re.paid_at,
          'sales_agent_id', re.sales_agent_id, 'sales_agent_code', re.sales_agent_code
        ) order by re.paid_at desc),
        '[]'::jsonb
      )
      from public.revenue_events as re where re.user_id = p_user_id
    ),
    'subscription_requests', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'requested_plan', sr.requested_plan, 'status', sr.status, 'created_at', sr.created_at
        ) order by sr.created_at desc),
        '[]'::jsonb
      )
      from public.subscription_requests as sr where sr.user_id = p_user_id
    ),
    'sales_agent', (
      select jsonb_build_object(
        'id', sa.id, 'name', sa.name, 'code', sa.code,
        'is_active', sa.is_active, 'commission_rate', sa.commission_rate,
        'linked_at', sa.linked_at
      )
      from public.sales_agents as sa where sa.user_id = p_user_id
      limit 1
    )
  )
  into v_result
  from public.users as u
  left join auth.users as au on au.id = u.id
  where u.id = p_user_id;

  return v_result;
end;
$$;

revoke execute on function public.admin_member_detail(uuid) from public, anon;
grant execute on function public.admin_member_detail(uuid) to authenticated;

-- ============================================
-- 10) admin_member_list 갱신 — disabled_at / pii_masked_at / last_sign_in_at 추가
-- (기존 6-arg signature 가 다른 return type 이라 DROP 후 재생성)
-- ============================================
drop function if exists public.admin_member_list(integer, integer, text, text, text, text);

create or replace function public.admin_member_list(
  p_limit integer default 100,
  p_offset integer default 0,
  p_search text default null,
  p_plan text default null,
  p_role text default null,
  p_status text default null
)
returns table(
  id uuid,
  email text,
  nickname text,
  role text,
  subscription_type text,
  account_type text,
  membership_tier text,
  signup_completed boolean,
  identity_verified boolean,
  business_verified boolean,
  business_number text,
  created_at timestamptz,
  last_seen_at timestamptz,
  total_streams bigint,
  total_listened_seconds bigint,
  withdrawn_at timestamptz,
  disabled_at timestamptz,
  pii_masked_at timestamptz,
  last_sign_in_at timestamptz,
  has_cancel_scheduled boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_search_pattern text := case
    when p_search is null or length(btrim(p_search)) = 0 then null
    else '%' || lower(btrim(p_search)) || '%'
  end;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  return query
  select
    u.id,
    au.email::text as email,
    u.nickname,
    u.role,
    u.subscription_type,
    u.account_type,
    u.membership_tier,
    u.signup_completed,
    u.identity_verified,
    coalesce(bvp.business_verified, false) as business_verified,
    bvp.business_number,
    u.created_at,
    (select max(ve.created_at) from public.visitor_events as ve where ve.user_id = u.id) as last_seen_at,
    coalesce((select count(*) from public.stream_events as se where se.user_id = u.id and se.event_type='milestone_30s'), 0) as total_streams,
    coalesce((select sum(se.listened_seconds) from public.stream_events as se where se.user_id = u.id and se.event_type in ('milestone_30s','complete')), 0) as total_listened_seconds,
    u.withdrawn_at,
    u.disabled_at,
    u.pii_masked_at,
    au.last_sign_in_at,
    exists(select 1 from public.subscriptions as s where s.user_id = u.id and s.status = 'cancel_scheduled') as has_cancel_scheduled
  from public.users as u
  left join auth.users as au on au.id = u.id
  left join public.business_verification_profiles as bvp on bvp.user_id = u.id
  where
    (v_search_pattern is null
      or lower(coalesce(au.email,'')) like v_search_pattern
      or lower(coalesce(u.nickname,'')) like v_search_pattern
      or u.id::text like v_search_pattern)
    and (p_plan is null or u.subscription_type = p_plan or u.membership_tier = p_plan)
    and (p_role is null or u.role = p_role)
    and (
      p_status is null
      or (p_status = 'active' and u.withdrawn_at is null and u.disabled_at is null)
      or (p_status = 'withdrawn' and u.withdrawn_at is not null)
      or (p_status = 'disabled' and u.disabled_at is not null)
      or (p_status = 'cancel_scheduled' and exists(
            select 1 from public.subscriptions as s where s.user_id = u.id and s.status = 'cancel_scheduled'
          ))
    )
  order by u.created_at desc
  limit p_limit offset p_offset;
end;
$$;

revoke execute on function public.admin_member_list(integer, integer, text, text, text, text) from public, anon;
grant execute on function public.admin_member_list(integer, integer, text, text, text, text) to authenticated;

-- ============================================
-- 끝.
-- ============================================
do $$ begin raise notice '[0095] admin user state RPCs installed'; end $$;
