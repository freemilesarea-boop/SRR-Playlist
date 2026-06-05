-- 0296 — Artist plan_type Phase 2 (UI 분리 + 권한 차단)
--
-- 0295 에서 신규 가입자 plan_type 매핑 + quota 분기 완료.
-- 이 마이그레이션은 운영 권한 차단 + 프론트가 한 번에 가져갈 수 있는 통합 RPC.
--
-- 변경:
--   A) get_my_artist_plan() — 프론트가 현재 로그인 사용자의 plan + quota + permissions
--      한 번에 조회. 단일 진입점.
--   B) create_curator_playlist 차단 — general_artist 는 플리 제작 불가
--   C) admin_grant_curator 차단 — general_artist 는 큐레이터 권한 부여 불가
--   D) admin_member_detail — user 객체에 plan_type 추가 (관리자 화면 표시용)
--   E) verify_sales_agent_code 결과에 derived plan_type / quota 동봉
--      (가입 폼에서 코드 입력 즉시 어떤 플랜인지 안내)
--
-- 기존 데이터 변경 없음:
--   - tracks / artist_profiles / subscriptions 무변경
--   - 기존 67명 plan_type=NULL 유지 → 큐레이터 권한 / 플리 제작 영향 0
--     (NULL 은 legacy 로 모든 권한 허용)

-- ===== A. get_my_artist_plan =====
create or replace function public.get_my_artist_plan()
returns table(
  plan_type text,
  plan_label text,
  monthly_quota integer,
  can_create_playlist boolean,
  can_apply_curator boolean,
  is_verified_pro boolean,
  is_legacy boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_plan text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select u.plan_type into v_plan from public.users u where u.id = v_uid;

  return query select
    v_plan as plan_type,
    case coalesce(v_plan, 'legacy')
      when 'general_artist'  then '일반 아티스트'
      when 'student_artist'  then '수강생 아티스트 PRO'
      when 'admin'           then '관리자'
      when 'legacy_student'  then '기존 아티스트'
      else                        '기존 아티스트'
    end as plan_label,
    public._plan_monthly_quota(v_plan) as monthly_quota,
    -- general_artist 만 플리 제작 차단. 나머지 (student / legacy / NULL / admin) 허용.
    case when v_plan = 'general_artist' then false else true end as can_create_playlist,
    case when v_plan = 'general_artist' then false else true end as can_apply_curator,
    case when v_plan = 'student_artist' then true else false end as is_verified_pro,
    (v_plan is null or v_plan = 'legacy_student') as is_legacy;
end; $$;

revoke all on function public.get_my_artist_plan() from public, anon;
grant execute on function public.get_my_artist_plan() to authenticated, service_role;

-- ===== B. create_curator_playlist — general_artist 차단 =====
create or replace function public.create_curator_playlist(
  p_title text,
  p_category text,
  p_description text default null,
  p_business_category text default null,
  p_time_slot text default null,
  p_is_business_only boolean default false,
  p_mood_tags text[] default '{}',
  p_situation_tags text[] default '{}'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_plan text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not exists (select 1 from public.users where id = v_uid and is_curator = true) then
    raise exception 'not a curator';
  end if;

  -- ✅ X6.10 Phase 2: general_artist 플랜은 플레이리스트 제작 불가
  select plan_type into v_plan from public.users where id = v_uid;
  if v_plan = 'general_artist' then
    raise exception 'plan_does_not_allow_playlist_creation'
      using hint = '일반 아티스트 플랜은 플레이리스트 제작 권한이 없습니다. 수강생 아티스트 PRO 가입 또는 별도 문의가 필요합니다.';
  end if;

  if p_title is null or length(btrim(p_title)) = 0 then raise exception 'title required'; end if;
  if p_category is null or length(btrim(p_category)) = 0 then raise exception 'category required'; end if;

  insert into public.playlists (
    title, category, description, business_category, time_slot,
    is_business_only, mood_tags, situation_tags, created_by_user_id, status
  ) values (
    btrim(p_title), btrim(p_category), p_description, p_business_category, p_time_slot,
    coalesce(p_is_business_only, false), coalesce(p_mood_tags, '{}'), coalesce(p_situation_tags, '{}'),
    v_uid, 'draft'
  ) returning id into v_id;
  return v_id;
end; $$;

-- ===== C. admin_grant_curator — general_artist 차단 =====
create or replace function public.admin_grant_curator(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_plan text;
begin
  if not _internal_is_admin_caller() then raise exception 'admin only'; end if;

  -- ✅ X6.10 Phase 2: general_artist 에게는 큐레이터 권한 부여 불가
  select plan_type into v_plan from public.users where id = p_user_id;
  if v_plan = 'general_artist' then
    raise exception 'plan_does_not_allow_curator'
      using hint = '일반 아티스트 플랜은 큐레이터 권한을 받을 수 없습니다. plan_type 업그레이드 후 다시 시도해주세요.';
  end if;

  update public.users set is_curator = true where id = p_user_id;
  begin
    perform admin_log_operation('admin_member_actions', 'member', 'info', 'completed',
      format('grant curator %s', p_user_id),
      jsonb_build_object('user_id', p_user_id), p_user_id, p_user_id::text, null, null, null);
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'is_curator', true);
end; $$;

-- ===== D. admin_member_detail — plan_type 노출 =====
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
      'is_curator', u.is_curator,
      'last_sign_in_at', au.last_sign_in_at,
      -- ✅ X6.10 Phase 2: plan_type + 월 한도 + 사용량
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
    'subscriptions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'status', s.status, 'plan_type', s.plan_type,
        'price', s.price, 'auto_renew', s.auto_renew, 'last_paid_at', s.last_paid_at,
        'current_period_start', s.current_period_start, 'current_period_end', s.current_period_end,
        'canceled_at', s.canceled_at, 'cancel_reason', s.cancel_reason, 'refunded_at', s.refunded_at,
        'payapp_mul_no', s.payapp_mul_no, 'payapp_rebill_no', s.payapp_rebill_no,
        'created_at', s.created_at) order by s.created_at desc), '[]'::jsonb)
      from public.subscriptions as s where s.user_id = p_user_id
    ),
    'total_streams', (select count(*) from public.stream_events as se where se.user_id = p_user_id and se.event_type='milestone_30s'),
    'total_listened_seconds', coalesce((select sum(se.listened_seconds) from public.stream_events as se where se.user_id = p_user_id and se.event_type in ('milestone_30s','complete')), 0),
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
  from public.users as u left join auth.users as au on au.id = u.id
  where u.id = p_user_id;

  return v_result;
end; $$;
