-- 0457 — RPC-MIGRATION-RECOVERY-1 · Cluster A: site notices + settings (Production-only drift recovery)
--
-- 배경: DB-SCHEMA-RECONCILIATION-1 에서 site_notices/site_settings 테이블과 7개 RPC 가
--   Production 에만 존재(Repository/Test 부재)함을 read-only 로 확인. 본 마이그레이션은
--   Production 정의를 정확히 복구하여 Repository/Test 를 재현 가능하게 만든다.
--
-- 보안 수정(이 마이그레이션에 포함):
--   · admin_list_site_notices — Production 은 language sql + admin 검사 없음(authenticated 노출).
--     동일 시그니처/반환형을 유지하되 plpgsql 로 전환해 관리자 검사를 추가(과도 노출 교정).
--   · 나머지 admin_* 는 이미 관리자 검사 존재 → Production 정의 그대로 복구.
--   · public reader(get_site_settings, list_active_site_notices)는 anon 유지(공개 콘텐츠, PII 없음).
--
-- 적용 대상: 이번 Phase 는 Test Supabase 에만 적용. Production 은 이미 함수 존재(별도 apply plan).

-- ── 테이블 ───────────────────────────────────────────────────────────────
create table if not exists public.site_settings (
  id                   integer primary key default 1,
  distribution_enabled boolean not null default false,
  notice_enabled       boolean not null default true,
  notice_title         text    not null default '음원 유통 일시 중지 안내',
  notice_body          text    not null default $seed$현재 듣다는 메타데이터 정비 및 음원 품질 전수 검수를 진행하고 있습니다.
검수 기간 동안 신규 음원 유통 접수는 일시적으로 중단됩니다.
기존 등록 음원은 순차적으로 검수되며, 품질 기준에 맞지 않는 음원은 비공개 또는 재검수 처리될 수 있습니다.

서비스 품질 안정화를 위한 조치이니 이용자 여러분의 양해 부탁드립니다.$seed$,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.users(id),
  constraint site_settings_singleton check (id = 1)
);

create table if not exists public.site_notices (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  body             text not null,
  is_active        boolean not null default true,
  audience         text not null default 'all'
                     check (audience = any (array['all','guest','authenticated','artist','admin','business'])),
  display_location text not null default 'home'
                     check (display_location = any (array['home','all_pages'])),
  starts_at        timestamptz,
  ends_at          timestamptz,
  priority         integer not null default 0,
  dismissible      boolean not null default true,
  created_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists site_notices_active_idx
  on public.site_notices using btree (is_active, priority desc) where (is_active = true);

-- 싱글턴 설정 row 시드 (컬럼 기본값으로 채움) — get_site_settings/admin_update 가 id=1 대상.
insert into public.site_settings (id) values (1) on conflict (id) do nothing;

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.site_settings enable row level security;
alter table public.site_notices  enable row level security;

drop policy if exists site_settings_public_read on public.site_settings;
create policy site_settings_public_read on public.site_settings for select using (true);

drop policy if exists site_notices_public_read on public.site_notices;
create policy site_notices_public_read on public.site_notices for select using (
  is_active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

drop policy if exists site_notices_admin_read_all on public.site_notices;
create policy site_notices_admin_read_all on public.site_notices for select using (
  exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
);

-- ── 함수 (Production 복구; admin_list_site_notices 는 보안 교정) ─────────────
create or replace function public.get_site_settings()
 returns public.site_settings language sql stable security definer set search_path to 'public'
as $function$
  select * from public.site_settings where id = 1;
$function$;

create or replace function public.list_active_site_notices()
 returns table(id uuid, title text, body text, audience text, display_location text,
   priority integer, dismissible boolean, starts_at timestamptz, ends_at timestamptz)
 language sql stable security definer set search_path to 'public'
as $function$
  with me as (
    select auth.uid() as uid,
      case when auth.uid() is null then 'guest'
        else (select case
            when u.role = 'admin' then 'admin'
            when u.account_type = 'artist' then 'artist'
            when u.account_type in ('business','store_owner') then 'business'
            else 'authenticated' end
          from public.users u where u.id = auth.uid())
      end as audience_role
  )
  select n.id, n.title, n.body, n.audience, n.display_location,
         n.priority, n.dismissible, n.starts_at, n.ends_at
  from public.site_notices n, me
  where n.is_active = true
    and (n.starts_at is null or n.starts_at <= now())
    and (n.ends_at is null or n.ends_at > now())
    and (n.audience = 'all'
      or (n.audience = 'guest' and me.uid is null)
      or (n.audience = 'authenticated' and me.uid is not null)
      or (n.audience = me.audience_role))
  order by n.priority desc, n.created_at desc;
$function$;

-- SECURITY FIX: Production 은 language sql + 관리자 검사 없음(authenticated 노출). 시그니처/반환형
-- 유지한 채 plpgsql 로 전환하여 관리자 검사 추가 (기존 admin_* 와 동일 패턴).
create or replace function public.admin_list_site_notices()
 returns setof public.site_notices language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;
  return query select * from public.site_notices order by is_active desc, priority desc, created_at desc;
end;
$function$;

create or replace function public.admin_upsert_site_notice(
  p_id uuid, p_title text, p_body text, p_is_active boolean default true,
  p_audience text default 'all', p_display_location text default 'home',
  p_starts_at timestamptz default null, p_ends_at timestamptz default null,
  p_priority integer default 0, p_dismissible boolean default true)
 returns public.site_notices language plpgsql security definer set search_path to 'public'
as $function$
declare v_row public.site_notices;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_title is null or length(trim(p_title))=0 then raise exception 'title required'; end if;
  if p_body is null or length(trim(p_body))=0 then raise exception 'body required'; end if;
  if p_id is null then
    insert into public.site_notices(title, body, is_active, audience, display_location,
      starts_at, ends_at, priority, dismissible, created_by)
    values (p_title, p_body, p_is_active, p_audience, p_display_location,
      p_starts_at, p_ends_at, p_priority, p_dismissible, auth.uid())
    returning * into v_row;
  else
    update public.site_notices set
      title=p_title, body=p_body, is_active=p_is_active, audience=p_audience,
      display_location=p_display_location, starts_at=p_starts_at, ends_at=p_ends_at,
      priority=p_priority, dismissible=p_dismissible, updated_at=now()
    where id=p_id returning * into v_row;
  end if;
  return v_row;
end;
$function$;

create or replace function public.admin_toggle_site_notice(p_id uuid, p_active boolean)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  update public.site_notices set is_active = p_active, updated_at = now() where id = p_id;
end;
$function$;

create or replace function public.admin_delete_site_notice(p_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  delete from public.site_notices where id = p_id;
end;
$function$;

create or replace function public.admin_update_site_settings(
  p_distribution_enabled boolean, p_notice_enabled boolean, p_notice_title text, p_notice_body text)
 returns public.site_settings language plpgsql security definer set search_path to 'public'
as $function$
declare v_row public.site_settings;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;
  if p_notice_title is null or length(trim(p_notice_title)) = 0 then raise exception 'notice_title required'; end if;
  if p_notice_body is null or length(trim(p_notice_body)) = 0 then raise exception 'notice_body required'; end if;
  update public.site_settings set
    distribution_enabled = p_distribution_enabled, notice_enabled = p_notice_enabled,
    notice_title = p_notice_title, notice_body = p_notice_body,
    updated_at = now(), updated_by = auth.uid()
  where id = 1 returning * into v_row;
  return v_row;
end;
$function$;

-- ── Grants (fail-closed: revoke PUBLIC, 최소 부여; admin 은 함수 내부 검사와 병행) ──
revoke all on function public.get_site_settings() from public;
revoke all on function public.list_active_site_notices() from public;
revoke all on function public.admin_list_site_notices() from public;
revoke all on function public.admin_upsert_site_notice(uuid,text,text,boolean,text,text,timestamptz,timestamptz,integer,boolean) from public;
revoke all on function public.admin_toggle_site_notice(uuid,boolean) from public;
revoke all on function public.admin_delete_site_notice(uuid) from public;
revoke all on function public.admin_update_site_settings(boolean,boolean,text,text) from public;

grant execute on function public.get_site_settings() to anon, authenticated;
grant execute on function public.list_active_site_notices() to anon, authenticated;
grant execute on function public.admin_list_site_notices() to authenticated;
grant execute on function public.admin_upsert_site_notice(uuid,text,text,boolean,text,text,timestamptz,timestamptz,integer,boolean) to authenticated;
grant execute on function public.admin_toggle_site_notice(uuid,boolean) to authenticated;
grant execute on function public.admin_delete_site_notice(uuid) to authenticated;
grant execute on function public.admin_update_site_settings(boolean,boolean,text,text) to authenticated;

comment on function public.admin_list_site_notices() is 'RPC-MIGRATION-RECOVERY-1: admin-guarded (was over-exposed to authenticated in Production).';
