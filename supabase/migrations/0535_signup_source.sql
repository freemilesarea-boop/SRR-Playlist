-- 0535_signup_source.sql
--
-- 사업자·가맹(본사/가맹점) 가입 시 "어디서 알게 되셨나요?" 응답을 남긴다.
--
-- 왜
--   주식회사 뺑스톡이 뉴스를 보고 들어온 것 같은데 확인할 방법이 없었다.
--   가입 경로(웹/앱)는 요청 로그로 겨우 추적했지만, 유입 채널은 어디에도 남지 않는다.
--
-- 바뀌는 것
--   · public.users 에 signup_source / signup_source_detail / signup_source_context /
--     signup_source_at 컬럼 추가 (전부 nullable — 기존 회원 무영향).
--   · 이메일 가입(세션이 없을 수 있음)은 signUp metadata 의 signup_source* 를
--     auth.users AFTER INSERT 트리거가 옮겨 담는다. 트리거 이름이
--     on_auth_user_created 뒤에 정렬되므로 handle_new_user 가 만든 행에 쓴다.
--   · 로그인된 상태의 신청(Google 가입 후 사업자등록·본사 신청·가맹 연결)은
--     record_my_signup_source RPC 로 기록한다.
--   · 첫 응답만 남긴다 — 이미 값이 있으면 덮어쓰지 않는다.
--   · 관리자 회원 상세용 admin_member_signup_source RPC.
--
-- prod 에는 동일 정의가 `signup_source` 로 적용돼 있다.

alter table public.users
  add column if not exists signup_source text,
  add column if not exists signup_source_detail text,
  add column if not exists signup_source_context text,
  add column if not exists signup_source_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_signup_source_check') then
    alter table public.users add constraint users_signup_source_check check (
      signup_source is null or signup_source in (
        'news', 'search', 'sns', 'youtube', 'blog_community', 'ad',
        'referral', 'sales_agent', 'hq_notice', 'other'
      )
    );
  end if;
end $$;

-- 입력값 정규화 — 허용되지 않은 값은 null (가입 자체를 막지 않는다).
create or replace function public._normalize_signup_source(p_source text)
returns text
language sql
immutable
as $$
  select case
    when lower(btrim(coalesce(p_source, ''))) in (
      'news', 'search', 'sns', 'youtube', 'blog_community', 'ad',
      'referral', 'sales_agent', 'hq_notice', 'other'
    ) then lower(btrim(p_source))
    else null
  end;
$$;

create or replace function public._capture_signup_source_from_meta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_source text := public._normalize_signup_source(v_meta->>'signup_source');
begin
  if v_source is null then
    return new;
  end if;
  begin
    update public.users set
      signup_source = v_source,
      signup_source_detail = left(nullif(btrim(coalesce(v_meta->>'signup_source_detail', '')), ''), 200),
      signup_source_context = left(nullif(btrim(coalesce(v_meta->>'signup_source_context', '')), ''), 50),
      signup_source_at = now()
    where id = new.id and signup_source is null;
  exception when others then
    raise log 'signup_source capture failed: %', SQLERRM;
  end;
  return new;
end;
$$;

-- drop 없이 교체 — auth.users 에 대한 drop trigger 는 MCP 에서 확인 대기로 멈춘다.
create or replace trigger on_auth_user_created_signup_source
  after insert on auth.users
  for each row execute function public._capture_signup_source_from_meta();

create or replace function public.record_my_signup_source(
  p_source text,
  p_detail text default null,
  p_context text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_source text := public._normalize_signup_source(p_source);
  v_count int;
begin
  if v_uid is null then
    raise exception 'unauthorized';
  end if;
  if v_source is null then
    raise exception 'invalid_signup_source';
  end if;
  update public.users set
    signup_source = v_source,
    signup_source_detail = left(nullif(btrim(coalesce(p_detail, '')), ''), 200),
    signup_source_context = left(nullif(btrim(coalesce(p_context, '')), ''), 50),
    signup_source_at = now()
  where id = v_uid and signup_source is null;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.record_my_signup_source(text, text, text) from public, anon;
grant execute on function public.record_my_signup_source(text, text, text) to authenticated;

create or replace function public.admin_member_signup_source(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_row public.users%rowtype;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;
  select * into v_row from public.users where id = p_user_id;
  if not found or v_row.signup_source is null then
    return null;
  end if;
  return jsonb_build_object(
    'source', v_row.signup_source,
    'detail', v_row.signup_source_detail,
    'context', v_row.signup_source_context,
    'recorded_at', v_row.signup_source_at
  );
end;
$$;

revoke all on function public.admin_member_signup_source(uuid) from public, anon;
grant execute on function public.admin_member_signup_source(uuid) to authenticated;

revoke all on function public._capture_signup_source_from_meta() from public, anon, authenticated;
