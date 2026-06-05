-- 0295 — Artist plan_type 도입 (X6.10 — 1차)
--
-- 목적: 신규 가입 아티스트부터 sales_agent_code 기반으로 plan_type 분리.
--   - C69947 → student_artist (월 50곡)
--   - PDWSFU → general_artist (월 5곡)
--   - 그 외/NULL → NULL (legacy — 기존 50곡 동작 유지)
--
-- 절대 원칙 (사용자 spec):
--   ❌ tracks 수정 금지
--   ❌ artist_profiles 일괄 UPDATE 금지
--   ❌ 기존 subscription/payment 일괄 변경 금지
--   ❌ 기존 아티스트 plan_type 자동 변경 금지 (기존 67명 NULL 유지)
--   ❌ 기존 업로드 곡 status 변경 금지
--   ❌ 기존 정산 데이터 변경 금지
--
-- 영향 (검증):
--   - users 신규 컬럼 plan_type (nullable, default null) → 기존 행 모두 NULL
--   - handle_new_user / submit_artist_signup_profile 의 update 절에 coalesce
--     기반 자동 매핑 추가 → 기존 행은 plan_type IS NULL 보존
--   - get_my_upload_quota / _tg_enforce_monthly_upload_quota 가 plan_type 분기
--     → NULL/legacy → 50 (현 동작 동일)

-- ===== A. users.plan_type 컬럼 추가 (nullable) =====
alter table public.users
  add column if not exists plan_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'users_plan_type_check'
  ) then
    alter table public.users
      add constraint users_plan_type_check
      check (plan_type is null or plan_type in
        ('general_artist','student_artist','admin','legacy_student'));
  end if;
end $$;

create index if not exists idx_users_plan_type on public.users(plan_type)
  where plan_type is not null;

-- ===== B. 코드 → 플랜 매핑 헬퍼 =====
-- 신규 가입 시에만 호출. 기존 행은 절대 건드리지 않음.
create or replace function public._plan_type_for_code(p_code text)
returns text language sql immutable parallel safe as $$
  select case btrim(coalesce(p_code, ''))
    when 'C69947' then 'student_artist'
    when 'PDWSFU' then 'general_artist'
    else null
  end;
$$;

-- ===== C. 플랜 → 월 한도 헬퍼 (운영 정책 단일 진입점) =====
-- 향후 관리자 설정 테이블로 외부화 가능. 현재는 하드코딩 (요구사항 명시).
create or replace function public._plan_monthly_quota(p_plan_type text)
returns integer language sql immutable parallel safe as $$
  select case coalesce(p_plan_type, 'legacy')
    when 'general_artist'  then 5
    when 'student_artist'  then 50
    when 'admin'           then 9999
    when 'legacy_student'  then 50
    else                        50   -- NULL/legacy → 기존 동작 (50곡)
  end;
$$;

-- ===== D. handle_new_user — sales_agent_code 처리 직후 plan_type 자동 세팅 =====
-- 기존 정의에 update 절 한 줄 (plan_type coalesce) 만 추가.
-- 다른 동작은 변경 없음. coalesce 라 기존 plan_type IS NOT NULL 이면 보존.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_account_type text := nullif(v_meta->>'account_type', '');
  v_full_name    text := nullif(v_meta->>'full_name', '');
  v_birth_date   date;
  v_phone        text := nullif(v_meta->>'phone', '');
  v_address      text := nullif(v_meta->>'address', '');
  v_artist_name  text := nullif(v_meta->>'artist_name', '');
  v_sales_code   text := btrim(coalesce(nullif(v_meta->>'sales_agent_code',''), nullif(v_meta->>'artist_invite_code',''), ''));
  v_nickname     text := coalesce(nullif(v_meta->>'nickname', ''), v_artist_name, split_part(new.email, '@', 1));
  v_base_type    text;
  v_agent_id     uuid;
  v_plan_type    text;
  v_err          text;
begin
  if v_account_type not in ('individual','business','artist') then v_account_type := 'individual'; end if;
  begin v_birth_date := (nullif(v_meta->>'birth_date',''))::date; exception when others then v_birth_date := null; end;
  v_base_type := case when v_account_type = 'artist' then 'individual' else v_account_type end;

  begin
    insert into public.users (
      id, nickname, account_type, full_name, birth_date, phone, address, signup_completed, artist_approval_status
    ) values (
      new.id, v_nickname, v_base_type, v_full_name, v_birth_date, v_phone, v_address,
      (v_full_name is not null and v_phone is not null and v_address is not null), null
    )
    on conflict (id) do update set
      nickname = coalesce(public.users.nickname, excluded.nickname),
      account_type = case when public.users.account_type = 'artist' then 'artist' else excluded.account_type end,
      full_name = coalesce(public.users.full_name, excluded.full_name),
      birth_date = coalesce(public.users.birth_date, excluded.birth_date),
      phone = coalesce(public.users.phone, excluded.phone),
      address = coalesce(public.users.address, excluded.address),
      signup_completed = public.users.signup_completed or excluded.signup_completed;
  exception when others then v_err := SQLERRM; raise log '[handle_new_user] users upsert FAILED: %', v_err; end;

  if v_account_type = 'artist' then
    v_agent_id := public._resolve_active_sales_agent(v_sales_code);
    v_plan_type := public._plan_type_for_code(v_sales_code);
    if v_agent_id is not null then
      perform set_config('app.artist_grant_ok', '1', true);
      begin
        update public.users set
          account_type = 'artist',
          artist_approval_status = coalesce(artist_approval_status, 'pending'),
          sales_agent_id = coalesce(sales_agent_id, v_agent_id),
          sales_agent_code = coalesce(sales_agent_code, v_sales_code),
          -- ✅ X6.10: 기존 plan_type 보존 (coalesce). 신규 가입자만 자동 세팅.
          plan_type = coalesce(plan_type, v_plan_type)
        where id = new.id;
        if v_artist_name is not null then
          insert into public.artist_profiles (
            user_id, real_name, birth_date, artist_name, phone, address, email, approval_status
          ) values (
            new.id, coalesce(v_full_name, v_nickname), coalesce(v_birth_date, '1900-01-01'::date),
            v_artist_name, coalesce(v_phone, ''), coalesce(v_address, ''), new.email, 'pending'
          ) on conflict (user_id) do nothing;
        end if;
      exception when others then v_err := SQLERRM; raise log '[handle_new_user] artist promote FAILED: %', v_err; end;
    end if;
  end if;

  begin
    insert into public.signup_debug_events (
      auth_user_id, email, metadata, account_type, artist_name,
      users_upserted, artist_profile_upserted, error_message
    ) values (new.id, new.email, v_meta, v_account_type, v_artist_name, true, (v_agent_id is not null), v_err);
  exception when others then null; end;

  return new;
end; $$;

-- ===== E. submit_artist_signup_profile — 동일 위치에 plan_type 한 줄 추가 =====
create or replace function public.submit_artist_signup_profile(
  p_real_name text, p_birth_date date, p_artist_name text,
  p_phone text, p_address text, p_email text, p_invite_code text
) returns table(user_id uuid, status text, artist_profile_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ap_id uuid;
  v_agent_id uuid;
  v_code text := btrim(coalesce(p_invite_code,''));
  v_plan_type text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  v_agent_id := public._resolve_active_sales_agent(v_code);
  if v_agent_id is null then
    raise exception '유효하지 않은 영업코드입니다';
  end if;
  v_plan_type := public._plan_type_for_code(v_code);
  perform set_config('app.artist_grant_ok', '1', true);

  update public.users u set
    account_type = 'artist',
    artist_approval_status = coalesce(u.artist_approval_status, 'pending'),
    full_name = coalesce(nullif(u.full_name, ''), p_real_name),
    birth_date = coalesce(u.birth_date, p_birth_date),
    phone = coalesce(nullif(u.phone, ''), p_phone),
    address = coalesce(nullif(u.address, ''), p_address),
    nickname = coalesce(nullif(u.nickname, ''), p_artist_name),
    sales_agent_id = coalesce(u.sales_agent_id, v_agent_id),
    sales_agent_code = coalesce(u.sales_agent_code, v_code),
    -- ✅ X6.10: 기존 plan_type 보존. 신규 INSERT 또는 plan_type IS NULL 인 경우만 세팅.
    plan_type = coalesce(u.plan_type, v_plan_type),
    signup_completed = true
  where u.id = v_uid;

  insert into public.users (
    id, nickname, account_type, full_name, birth_date, phone, address,
    signup_completed, artist_approval_status, sales_agent_id, sales_agent_code, plan_type
  )
  select v_uid, p_artist_name, 'artist', p_real_name, p_birth_date, p_phone, p_address,
         true, 'pending', v_agent_id, v_code, v_plan_type
  where not exists (select 1 from public.users u2 where u2.id = v_uid);

  update public.artist_profiles ap set
    real_name = coalesce(nullif(ap.real_name,''), p_real_name),
    artist_name = coalesce(nullif(ap.artist_name,''), p_artist_name),
    phone = coalesce(nullif(ap.phone,''), p_phone),
    address = coalesce(nullif(ap.address,''), p_address),
    email = coalesce(nullif(ap.email,''), p_email),
    birth_date = coalesce(ap.birth_date, p_birth_date)
  where ap.user_id = v_uid
  returning ap.id into v_ap_id;

  if v_ap_id is null then
    insert into public.artist_profiles (user_id, real_name, birth_date, artist_name, phone, address, email, approval_status)
    values (v_uid, p_real_name, p_birth_date, p_artist_name, p_phone, p_address, p_email, 'pending')
    returning id into v_ap_id;
  end if;

  return query select v_uid, 'ok'::text, v_ap_id;
end; $$;

-- ===== F. quota 함수 — plan_type 분기 적용 =====
create or replace function public.get_my_upload_quota(p_quota integer default null)
returns table(
  used integer, quota integer, remaining integer,
  period_start timestamptz, period_end timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_start timestamptz;
  v_end timestamptz;
  v_used int := 0;
  v_plan text;
  v_quota int;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  v_start := (date_trunc('month', (now() at time zone 'Asia/Seoul'))::timestamp at time zone 'Asia/Seoul');
  v_end   := ((date_trunc('month', (now() at time zone 'Asia/Seoul')) + interval '1 month')::timestamp at time zone 'Asia/Seoul');

  -- 플랜 기반 quota — p_quota 명시 시 override (admin/테스트용)
  select plan_type into v_plan from public.users where id = v_uid;
  v_quota := coalesce(p_quota, public._plan_monthly_quota(v_plan));

  select count(*)::int into v_used
  from public.tracks t
  where t.owner_user_id = v_uid
    and t.source_type = 'artist_upload'
    and t.created_at >= v_start
    and t.created_at <  v_end
    and t.removed_at is null
    and t.release_status in ('submitted','review_pending','changes_requested','approved','scheduled','released')
    and coalesce(t.visibility_status, '') <> 'rejected';

  return query select v_used, v_quota, greatest(0, v_quota - v_used), v_start, v_end;
end; $$;

-- ===== G. 차단 트리거 — plan_type 분기 적용 =====
create or replace function public._tg_enforce_monthly_upload_quota()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_month_start timestamptz := (date_trunc('month', (now() at time zone 'Asia/Seoul'))::timestamp at time zone 'Asia/Seoul');
  v_month_end   timestamptz := ((date_trunc('month', (now() at time zone 'Asia/Seoul')) + interval '1 month')::timestamptz);
  v_plan text;
  v_quota int;
begin
  if new.source_type is distinct from 'artist_upload' then return new; end if;
  if new.owner_user_id is null then return new; end if;

  -- admin role 은 한도 미적용 (기존 동작 유지)
  if exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    return new;
  end if;

  -- 플랜 기반 한도 결정 (NULL/legacy → 50, general → 5, student → 50)
  select plan_type into v_plan from public.users where id = new.owner_user_id;
  v_quota := public._plan_monthly_quota(v_plan);

  select count(*) into v_count
  from public.tracks t
  where t.owner_user_id = new.owner_user_id
    and t.source_type = 'artist_upload'
    and t.created_at >= v_month_start
    and t.created_at <  v_month_end
    and t.removed_at is null
    and t.release_status in ('submitted','review_pending','changes_requested','approved','scheduled','released')
    and coalesce(t.visibility_status, '') <> 'rejected';

  if v_count >= v_quota then
    raise exception 'monthly_upload_quota_exceeded'
      using hint = format(
        '이번 달 음원 등록 한도(%s곡)를 모두 사용하셨습니다. 다음 달 1일부터 다시 등록 가능합니다.',
        v_quota
      );
  end if;

  return new;
end; $$;

-- ===== H. 권한 =====
revoke all on function public._plan_type_for_code(text) from public, anon;
revoke all on function public._plan_monthly_quota(text) from public, anon;
revoke all on function public.get_my_upload_quota(integer) from public, anon;
grant execute on function public._plan_type_for_code(text) to authenticated, service_role;
grant execute on function public._plan_monthly_quota(text) to authenticated, service_role;
grant execute on function public.get_my_upload_quota(integer) to authenticated, service_role;
