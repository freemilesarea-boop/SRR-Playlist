-- 0405 — Phase BRAND-1: Franchise Brand Player (AI Music + Signage) MVP
--
-- 목적:
--   관리자가 브랜드를 생성(고유 코드 발급) → 매장/사용자가 브랜드 코드 입력 → 검증 후
--   브랜드 전용 플레이어 진입 → 브랜드 음악정책 기반 자동 플레이리스트 재생 +
--   관리자가 업로드한 이미지 사이니지 순차 노출.
--
-- 절대 원칙 (기존 무영향):
--   • 신규 brand_* 테이블 / bucket / RPC 만 추가 (additive). 기존 스키마·함수·플레이어 무변경.
--   • 재생은 기존 전역 <Player> 엔진 재사용 — 여기서는 "큐 소스"(track 목록)만 생성.
--   • 생성기는 playlist_tracks / stream_events 미기록 (get_auto_playlist_tracks 와 동일한 live 계산).
--     → 정산/차트/스트리밍 카운트에 영향 없음. (재생 시 카운트는 기존 store player 와 동일 규칙)
--   • 관리자 게이트: public._is_super_admin() (0391). 플레이어 접근: 브랜드 코드 검증 후.
--   • 코드 평문 미저장 — sha256 code_hash 만 저장. 평문은 생성/재발급 시 1회만 반환.
--
-- 확장 고려 (후속 Phase): Enterprise HQ / Campaign / Holiday Engine / AI Playlist Naming.

-- ============================================================
-- 0) Tables
-- ============================================================
create table if not exists public.brand_accounts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  code_hash     text not null,
  code_hint     text,
  status        text not null default 'active' check (status in ('active','inactive')),
  industry_type text,
  description   text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
-- 코드 해시는 삭제 안 된 브랜드 범위에서 유일
create unique index if not exists idx_brand_accounts_code_hash
  on public.brand_accounts (code_hash) where deleted_at is null;
create index if not exists idx_brand_accounts_status  on public.brand_accounts (status)     where deleted_at is null;
create index if not exists idx_brand_accounts_deleted on public.brand_accounts (deleted_at);

create table if not exists public.brand_music_policies (
  id                    uuid primary key default gen_random_uuid(),
  brand_id              uuid not null references public.brand_accounts(id) on delete cascade,
  preferred_genres      text[] not null default '{}',
  blocked_genres        text[] not null default '{}',
  preferred_moods       text[] not null default '{}',
  blocked_moods         text[] not null default '{}',
  energy_min            numeric check (energy_min is null or (energy_min >= 0 and energy_min <= 1)),
  energy_max            numeric check (energy_max is null or (energy_max >= 0 and energy_max <= 1)),
  vocal_policy          text not null default 'any' check (vocal_policy in ('any','vocal_ok','prefer_instrumental','instrumental_only')),
  daypart_policy        jsonb,
  auto_generate_enabled boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists idx_brand_music_policies_brand on public.brand_music_policies (brand_id);

create table if not exists public.brand_media_assets (
  id                       uuid primary key default gen_random_uuid(),
  brand_id                 uuid not null references public.brand_accounts(id) on delete cascade,
  asset_type               text not null default 'image' check (asset_type in ('image')),
  title                    text,
  image_url                text not null,
  display_duration_seconds integer not null default 10 check (display_duration_seconds between 1 and 600),
  sort_order               integer not null default 0,
  starts_at                timestamptz,
  ends_at                  timestamptz,
  status                   text not null default 'active' check (status in ('active','inactive')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz
);
create index if not exists idx_brand_media_brand_status_sort
  on public.brand_media_assets (brand_id, status, sort_order) where deleted_at is null;

create table if not exists public.brand_player_sessions (
  id                  uuid primary key default gen_random_uuid(),
  brand_id            uuid not null references public.brand_accounts(id) on delete cascade,
  session_token_hash  text,
  user_id             uuid references auth.users(id) on delete set null,
  current_track_id    uuid,
  last_seen_at        timestamptz,
  playback_started_at timestamptz,
  user_agent          text,
  created_at          timestamptz not null default now()
);
create index if not exists idx_brand_sessions_brand_lastseen on public.brand_player_sessions (brand_id, last_seen_at desc);
create index if not exists idx_brand_sessions_token on public.brand_player_sessions (session_token_hash) where session_token_hash is not null;

create table if not exists public.brand_audit_logs (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid,
  admin_user_id uuid,
  action        text not null,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists idx_brand_audit_brand on public.brand_audit_logs (brand_id, created_at desc);

-- updated_at 트리거 (public.set_updated_at 재사용)
do $$
begin
  if not exists (select 1 from pg_trigger where tgname='trg_brand_accounts_updated_at') then
    create trigger trg_brand_accounts_updated_at before update on public.brand_accounts
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_brand_music_policies_updated_at') then
    create trigger trg_brand_music_policies_updated_at before update on public.brand_music_policies
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_brand_media_updated_at') then
    create trigger trg_brand_media_updated_at before update on public.brand_media_assets
      for each row execute function public.set_updated_at();
  end if;
end$$;

-- ============================================================
-- 1) RLS — 직접 접근 차단, 모든 접근은 SECURITY DEFINER RPC 경유
-- ============================================================
alter table public.brand_accounts       enable row level security;
alter table public.brand_music_policies  enable row level security;
alter table public.brand_media_assets    enable row level security;
alter table public.brand_player_sessions enable row level security;
alter table public.brand_audit_logs      enable row level security;

-- admin(super) 만 직접 read 가능(디버그/대시보드 fallback). write 는 RPC 로만.
drop policy if exists brand_accounts_admin_read on public.brand_accounts;
create policy brand_accounts_admin_read on public.brand_accounts for select using (public._is_super_admin());
drop policy if exists brand_policies_admin_read on public.brand_music_policies;
create policy brand_policies_admin_read on public.brand_music_policies for select using (public._is_super_admin());
drop policy if exists brand_media_admin_read on public.brand_media_assets;
create policy brand_media_admin_read on public.brand_media_assets for select using (public._is_super_admin());
drop policy if exists brand_sessions_admin_read on public.brand_player_sessions;
create policy brand_sessions_admin_read on public.brand_player_sessions for select using (public._is_super_admin());
drop policy if exists brand_audit_admin_read on public.brand_audit_logs;
create policy brand_audit_admin_read on public.brand_audit_logs for select using (public._is_super_admin());

-- 클라이언트 direct 권한 제거 (anon/authenticated 는 테이블 직접 접근 불가 → RPC 만)
revoke all on public.brand_accounts, public.brand_music_policies, public.brand_media_assets,
              public.brand_player_sessions, public.brand_audit_logs from anon, authenticated;

-- ============================================================
-- 2) Storage bucket — brand-media (public read, admin write)
-- ============================================================
do $storage$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('brand-media','brand-media', true, 10485760, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
exception when insufficient_privilege or undefined_table then
  raise notice 'brand-media bucket: insufficient privilege — create via dashboard';
end
$storage$;

do $storagepol$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='brand_media_public_read') then
    create policy brand_media_public_read on storage.objects for select
      using (bucket_id = 'brand-media');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='brand_media_admin_write') then
    create policy brand_media_admin_write on storage.objects for insert to authenticated
      with check (bucket_id = 'brand-media' and public._is_super_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='brand_media_admin_update') then
    create policy brand_media_admin_update on storage.objects for update to authenticated
      using (bucket_id = 'brand-media' and public._is_super_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='brand_media_admin_delete') then
    create policy brand_media_admin_delete on storage.objects for delete to authenticated
      using (bucket_id = 'brand-media' and public._is_super_admin());
  end if;
exception when insufficient_privilege or undefined_table then
  raise notice 'brand-media storage policies: insufficient privilege — create via dashboard';
end
$storagepol$;

-- ============================================================
-- 3) Helpers — 코드 해시 / 생성
-- ============================================================
-- sha256(대문자·trim(code)) hex. extensions.digest 스키마 한정.
create or replace function public._brand_hash_code(p_code text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(upper(btrim(coalesce(p_code,'')))::bytea, 'sha256'), 'hex');
$$;
revoke all on function public._brand_hash_code(text) from public, anon, authenticated;

-- 안전 알파벳(혼동 문자 0/O/1/I/L 제외) 10자 코드 생성
create or replace function public._brand_gen_code()
returns text language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text := '';
  b bytea;
  i int;
begin
  b := extensions.gen_random_bytes(10);
  for i in 0..9 loop
    v_code := v_code || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1);
  end loop;
  return v_code;
end$$;
revoke all on function public._brand_gen_code() from public, anon, authenticated;

-- ============================================================
-- 4) Admin RPCs (super admin gate)
-- ============================================================
-- audit 헬퍼
create or replace function public._brand_audit(p_brand_id uuid, p_action text, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.brand_audit_logs (brand_id, admin_user_id, action, metadata)
  values (p_brand_id, auth.uid(), p_action, coalesce(p_meta,'{}'::jsonb));
end$$;
revoke all on function public._brand_audit(uuid, text, jsonb) from public, anon, authenticated;

-- 생성: 코드 자동발급, 평문 1회 반환. music policy row 도 함께 생성.
create or replace function public.admin_create_brand(
  p_name text, p_industry_type text default null, p_description text default null
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_code text; v_hash text; v_tries int := 0;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'brand name required'; end if;

  loop
    v_code := public._brand_gen_code();
    v_hash := public._brand_hash_code(v_code);
    exit when not exists (select 1 from public.brand_accounts where code_hash = v_hash and deleted_at is null);
    v_tries := v_tries + 1;
    if v_tries > 5 then raise exception 'code generation collision'; end if;
  end loop;

  insert into public.brand_accounts (name, code_hash, code_hint, industry_type, description, created_by)
  values (btrim(p_name), v_hash, left(v_code,2) || '••••', nullif(btrim(p_industry_type),''), nullif(btrim(p_description),''), auth.uid())
  returning id into v_id;

  insert into public.brand_music_policies (brand_id) values (v_id);

  perform public._brand_audit(v_id, 'brand.create', jsonb_build_object('name', btrim(p_name)));
  return jsonb_build_object('success', true, 'id', v_id, 'code', v_code, 'code_hint', left(v_code,2)||'••••');
end$$;
revoke execute on function public.admin_create_brand(text, text, text) from public, anon;
grant  execute on function public.admin_create_brand(text, text, text) to authenticated;

create or replace function public.admin_update_brand(
  p_id uuid, p_name text default null, p_industry_type text default null,
  p_description text default null, p_status text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if p_status is not null and p_status not in ('active','inactive') then raise exception 'invalid status'; end if;
  update public.brand_accounts set
    name          = coalesce(nullif(btrim(p_name),''), name),
    industry_type = coalesce(nullif(btrim(p_industry_type),''), industry_type),
    description   = case when p_description is null then description else nullif(btrim(p_description),'') end,
    status        = coalesce(p_status, status)
  where id = p_id and deleted_at is null;
  if not found then raise exception 'brand not found'; end if;
  perform public._brand_audit(p_id, 'brand.update', jsonb_build_object('status', p_status));
  return jsonb_build_object('success', true, 'id', p_id);
end$$;
revoke execute on function public.admin_update_brand(uuid, text, text, text, text) from public, anon;
grant  execute on function public.admin_update_brand(uuid, text, text, text, text) to authenticated;

-- 비활성화(soft): status='inactive'. 완전 삭제는 deleted_at.
create or replace function public.admin_set_brand_deleted(p_id uuid, p_deleted boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  update public.brand_accounts
     set deleted_at = case when p_deleted then now() else null end,
         status = case when p_deleted then 'inactive' else status end
   where id = p_id;
  if not found then raise exception 'brand not found'; end if;
  perform public._brand_audit(p_id, case when p_deleted then 'brand.delete' else 'brand.restore' end, '{}');
  return jsonb_build_object('success', true, 'id', p_id, 'deleted', p_deleted);
end$$;
revoke execute on function public.admin_set_brand_deleted(uuid, boolean) from public, anon;
grant  execute on function public.admin_set_brand_deleted(uuid, boolean) to authenticated;

-- 코드 재발급: 새 평문 1회 반환. 기존 코드 즉시 무효.
create or replace function public.admin_regenerate_brand_code(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_code text; v_hash text; v_tries int := 0;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if not exists (select 1 from public.brand_accounts where id = p_id and deleted_at is null) then
    raise exception 'brand not found';
  end if;
  loop
    v_code := public._brand_gen_code();
    v_hash := public._brand_hash_code(v_code);
    exit when not exists (select 1 from public.brand_accounts where code_hash = v_hash and deleted_at is null and id <> p_id);
    v_tries := v_tries + 1;
    if v_tries > 5 then raise exception 'code generation collision'; end if;
  end loop;
  update public.brand_accounts set code_hash = v_hash, code_hint = left(v_code,2)||'••••' where id = p_id;
  -- 기존 활성 세션 무효화 (다음 config fetch 시 재검증 강제)
  update public.brand_player_sessions set session_token_hash = null where brand_id = p_id;
  perform public._brand_audit(p_id, 'brand.regenerate_code', '{}');
  return jsonb_build_object('success', true, 'id', p_id, 'code', v_code, 'code_hint', left(v_code,2)||'••••');
end$$;
revoke execute on function public.admin_regenerate_brand_code(uuid) from public, anon;
grant  execute on function public.admin_regenerate_brand_code(uuid) to authenticated;

-- 목록 (미디어 수 / 최근 접속 포함)
create or replace function public.admin_list_brands(p_include_deleted boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by (x).created_at desc), '[]'::jsonb) into v
  from (
    select b.id, b.name, b.status, b.industry_type, b.description, b.code_hint,
           b.created_at, b.updated_at, b.deleted_at,
           (select count(*) from public.brand_media_assets m where m.brand_id=b.id and m.deleted_at is null and m.status='active') as active_media_count,
           (select count(*) from public.brand_media_assets m where m.brand_id=b.id and m.deleted_at is null) as total_media_count,
           (select max(s.last_seen_at) from public.brand_player_sessions s where s.brand_id=b.id) as last_seen_at,
           (select p.auto_generate_enabled from public.brand_music_policies p where p.brand_id=b.id) as auto_generate_enabled,
           (select array_length(p.preferred_genres,1) from public.brand_music_policies p where p.brand_id=b.id) as preferred_genre_count,
           (select array_length(p.blocked_genres,1) from public.brand_music_policies p where p.brand_id=b.id) as blocked_genre_count
    from public.brand_accounts b
    where p_include_deleted or b.deleted_at is null
  ) x;
  return v;
end$$;
revoke execute on function public.admin_list_brands(boolean) from public, anon;
grant  execute on function public.admin_list_brands(boolean) to authenticated;

-- 단건 상세 (brand + policy + media[])
create or replace function public.admin_get_brand(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select jsonb_build_object(
    'brand', (select row_to_json(b) from (
        select id, name, status, industry_type, description, code_hint, created_at, updated_at, deleted_at
        from public.brand_accounts where id = p_id) b),
    'policy', (select row_to_json(p) from (
        select brand_id, preferred_genres, blocked_genres, preferred_moods, blocked_moods,
               energy_min, energy_max, vocal_policy, daypart_policy, auto_generate_enabled
        from public.brand_music_policies where brand_id = p_id) p),
    'media', (select coalesce(jsonb_agg(row_to_json(m) order by (m).sort_order, (m).created_at), '[]'::jsonb) from (
        select id, asset_type, title, image_url, display_duration_seconds, sort_order, starts_at, ends_at, status, created_at
        from public.brand_media_assets where brand_id = p_id and deleted_at is null) m)
  ) into v;
  if v->'brand' is null then raise exception 'brand not found'; end if;
  return v;
end$$;
revoke execute on function public.admin_get_brand(uuid) from public, anon;
grant  execute on function public.admin_get_brand(uuid) to authenticated;

-- 음악 정책 upsert
create or replace function public.admin_upsert_brand_music_policy(
  p_brand_id uuid,
  p_preferred_genres text[] default null, p_blocked_genres text[] default null,
  p_preferred_moods  text[] default null, p_blocked_moods  text[] default null,
  p_energy_min numeric default null, p_energy_max numeric default null,
  p_vocal_policy text default null, p_daypart_policy jsonb default null,
  p_auto_generate_enabled boolean default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if not exists (select 1 from public.brand_accounts where id = p_brand_id and deleted_at is null) then
    raise exception 'brand not found';
  end if;
  if p_vocal_policy is not null and p_vocal_policy not in ('any','vocal_ok','prefer_instrumental','instrumental_only') then
    raise exception 'invalid vocal_policy';
  end if;
  insert into public.brand_music_policies (brand_id) values (p_brand_id)
    on conflict (brand_id) do nothing;
  update public.brand_music_policies set
    preferred_genres = coalesce(p_preferred_genres, preferred_genres),
    blocked_genres   = coalesce(p_blocked_genres, blocked_genres),
    preferred_moods  = coalesce(p_preferred_moods, preferred_moods),
    blocked_moods    = coalesce(p_blocked_moods, blocked_moods),
    energy_min       = p_energy_min,
    energy_max       = p_energy_max,
    vocal_policy     = coalesce(p_vocal_policy, vocal_policy),
    daypart_policy   = coalesce(p_daypart_policy, daypart_policy),
    auto_generate_enabled = coalesce(p_auto_generate_enabled, auto_generate_enabled)
  where brand_id = p_brand_id;
  perform public._brand_audit(p_brand_id, 'brand.policy_update', '{}');
  return jsonb_build_object('success', true, 'brand_id', p_brand_id);
end$$;
revoke execute on function public.admin_upsert_brand_music_policy(uuid, text[], text[], text[], text[], numeric, numeric, text, jsonb, boolean) from public, anon;
grant  execute on function public.admin_upsert_brand_music_policy(uuid, text[], text[], text[], text[], numeric, numeric, text, jsonb, boolean) to authenticated;

-- 미디어 추가
create or replace function public.admin_add_brand_media(
  p_brand_id uuid, p_image_url text, p_title text default null,
  p_display_duration_seconds int default 10, p_sort_order int default null,
  p_starts_at timestamptz default null, p_ends_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_sort int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if not exists (select 1 from public.brand_accounts where id = p_brand_id and deleted_at is null) then
    raise exception 'brand not found';
  end if;
  if coalesce(btrim(p_image_url),'') = '' then raise exception 'image_url required'; end if;
  v_sort := coalesce(p_sort_order,
    (select coalesce(max(sort_order),-1)+1 from public.brand_media_assets where brand_id=p_brand_id and deleted_at is null));
  insert into public.brand_media_assets (brand_id, image_url, title, display_duration_seconds, sort_order, starts_at, ends_at)
  values (p_brand_id, btrim(p_image_url), nullif(btrim(p_title),''),
          greatest(1, least(coalesce(p_display_duration_seconds,10), 600)), v_sort, p_starts_at, p_ends_at)
  returning id into v_id;
  perform public._brand_audit(p_brand_id, 'brand.media_add', jsonb_build_object('asset_id', v_id));
  return jsonb_build_object('success', true, 'id', v_id, 'sort_order', v_sort);
end$$;
revoke execute on function public.admin_add_brand_media(uuid, text, text, int, int, timestamptz, timestamptz) from public, anon;
grant  execute on function public.admin_add_brand_media(uuid, text, text, int, int, timestamptz, timestamptz) to authenticated;

-- 미디어 수정 (제목/노출시간/순서/기간/활성)
create or replace function public.admin_update_brand_media(
  p_asset_id uuid, p_title text default null, p_display_duration_seconds int default null,
  p_sort_order int default null, p_starts_at timestamptz default null, p_ends_at timestamptz default null,
  p_status text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_brand uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if p_status is not null and p_status not in ('active','inactive') then raise exception 'invalid status'; end if;
  update public.brand_media_assets set
    title = case when p_title is null then title else nullif(btrim(p_title),'') end,
    display_duration_seconds = coalesce(greatest(1, least(p_display_duration_seconds, 600)), display_duration_seconds),
    sort_order = coalesce(p_sort_order, sort_order),
    starts_at = case when p_starts_at is null then starts_at else p_starts_at end,
    ends_at   = case when p_ends_at   is null then ends_at   else p_ends_at   end,
    status    = coalesce(p_status, status)
  where id = p_asset_id and deleted_at is null
  returning brand_id into v_brand;
  if v_brand is null then raise exception 'media not found'; end if;
  perform public._brand_audit(v_brand, 'brand.media_update', jsonb_build_object('asset_id', p_asset_id));
  return jsonb_build_object('success', true, 'id', p_asset_id);
end$$;
revoke execute on function public.admin_update_brand_media(uuid, text, int, int, timestamptz, timestamptz, text) from public, anon;
grant  execute on function public.admin_update_brand_media(uuid, text, int, int, timestamptz, timestamptz, text) to authenticated;

-- 미디어 soft delete
create or replace function public.admin_delete_brand_media(p_asset_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_brand uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  update public.brand_media_assets set deleted_at = now(), status='inactive'
   where id = p_asset_id and deleted_at is null returning brand_id into v_brand;
  if v_brand is null then raise exception 'media not found'; end if;
  perform public._brand_audit(v_brand, 'brand.media_delete', jsonb_build_object('asset_id', p_asset_id));
  return jsonb_build_object('success', true, 'id', p_asset_id);
end$$;
revoke execute on function public.admin_delete_brand_media(uuid) from public, anon;
grant  execute on function public.admin_delete_brand_media(uuid) to authenticated;

-- ============================================================
-- 5) Brand Auto Playlist Generator (내부, security definer)
--    정책 기반 live 계산 — playlist_tracks / stream_events 미기록.
--    blocked_genres/moods 하드 제외, preferred 가중, vocal/energy 필터, fallback 완화.
-- ============================================================
create or replace function public._brand_generate_playlist(p_brand_id uuid, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v jsonb;
  pol public.brand_music_policies%rowtype;
  v_blocked_g text[]; v_pref_g text[]; v_blocked_m text[]; v_pref_m text[];
  v_limit int := greatest(1, least(coalesce(p_limit,200), 500));
  v_seed text := to_char((now() at time zone 'Asia/Seoul')::date, 'YYYYMMDD') || ':' || p_brand_id::text;
begin
  select * into pol from public.brand_music_policies where brand_id = p_brand_id;
  -- 정규화된 정책 장르/무드 집합
  v_blocked_g := coalesce((select array_agg(distinct public._ai_norm_genre(g)) from unnest(coalesce(pol.blocked_genres,'{}')) g where public._ai_norm_genre(g) <> ''), '{}');
  v_pref_g    := coalesce((select array_agg(distinct public._ai_norm_genre(g)) from unnest(coalesce(pol.preferred_genres,'{}')) g where public._ai_norm_genre(g) <> ''), '{}');
  v_blocked_m := coalesce((select array_agg(distinct lower(btrim(m))) from unnest(coalesce(pol.blocked_moods,'{}')) m where btrim(m) <> ''), '{}');
  v_pref_m    := coalesce((select array_agg(distinct lower(btrim(m))) from unnest(coalesce(pol.preferred_moods,'{}')) m where btrim(m) <> ''), '{}');

  with base as (
    select t.id, t.title, t.artist, t.genre, t.mood, t.audio_url, t.cover_url, t.duration, t.created_at,
           t.owner_user_id, t.instrumental, t.lyric_type, t.vocal_type,
           f.energy as feat_energy,
           coalesce((select array_agg(distinct public._ai_norm_genre(z))
                       from unnest(array_remove(array[t.main_genre, t.genre] || coalesce(t.genre_tags,'{}'), null)) z
                      where public._ai_norm_genre(z) <> ''), '{}') as norm_genres,
           lower(coalesce(t.mood,'') || ' ' || array_to_string(coalesce(t.mood_tags,'{}'),' ') || ' '
                 || array_to_string(coalesce(m.ai_moods,'{}'),' ')) as mood_blob
    from public.tracks t
    left join public.track_audio_features f on f.track_id = t.id
    left join public.track_ai_metadata m on m.track_id = t.id
    where t.audio_url is not null and length(btrim(t.audio_url)) > 0
      and t.cover_url is not null and length(btrim(t.cover_url)) > 0
      and (t.release_status = 'released' or t.release_status is null)
      and t.removed_at is null
      and (t.audio_health_status is null or t.audio_health_status in ('ok','unknown'))
  ),
  filtered as (
    select b.*,
      -- vocal policy
      (case
         when pol.vocal_policy = 'instrumental_only'
           then (b.instrumental is true or b.lyric_type = 'instrumental' or b.vocal_type = 'instrumental')
         else true end) as vocal_ok,
      -- energy range (feature 없으면 통과)
      (case when b.feat_energy is null then true
            else (pol.energy_min is null or b.feat_energy >= pol.energy_min)
             and (pol.energy_max is null or b.feat_energy <= pol.energy_max) end) as energy_ok,
      -- blocked (하드 제외 대상)
      (exists (select 1 from unnest(v_blocked_g) bg where bg = any(b.norm_genres))) as blocked_g_hit,
      (exists (select 1 from unnest(v_blocked_m) bm where b.mood_blob like '%'||bm||'%')) as blocked_m_hit,
      -- preferred (가중)
      (select count(*) from unnest(v_pref_g) pg where pg = any(b.norm_genres)) as pref_g_hits,
      (select count(*) from unnest(v_pref_m) pm where b.mood_blob like '%'||pm||'%') as pref_m_hits
    from base b
  ),
  eligible as (
    -- 하드 제외: blocked genre/mood 는 무조건 제거
    select f.*,
      ( f.pref_g_hits*25 + f.pref_m_hits*15
        + case when f.energy_ok then 5 else 0 end
        + case when pol.vocal_policy='prefer_instrumental'
                    and (f.instrumental is true or f.lyric_type='instrumental') then 10 else 0 end
      )::numeric as score,
      ('x' || substr(md5(f.id::text || v_seed),1,8))::bit(32)::bigint as rot
    from filtered f
    where not f.blocked_g_hit and not f.blocked_m_hit
      and f.vocal_ok
  ),
  -- fallback: energy 만족 우선. 부족 시 완화(에너지 무시)는 order 로 자연 처리.
  diversified as (
    select e.*, row_number() over (
      partition by coalesce(lower(btrim(e.artist)), e.id::text)
      order by (case when e.energy_ok then 1 else 0 end) desc, e.score desc, e.rot
    ) as artist_rank
    from eligible e
  )
  select coalesce(jsonb_agg(
           jsonb_build_object('id', d.id, 'title', d.title, 'artist', d.artist, 'genre', d.genre,
             'mood', d.mood, 'audio_url', d.audio_url, 'cover_url', d.cover_url,
             'duration', d.duration, 'created_at', d.created_at)
           order by (case when d.energy_ok then 1 else 0 end) desc, d.score desc, d.rot
         ), '[]'::jsonb) into v
  from diversified d
  where d.artist_rank <= 4
  limit v_limit;

  return v;
end$$;
revoke all on function public._brand_generate_playlist(uuid, int) from public, anon, authenticated;

-- ============================================================
-- 6) Public/authenticated RPCs — 코드 검증 / 플레이어 config / heartbeat
-- ============================================================
-- 코드 검증 → 세션 토큰 발급(평문 1회 반환, hash 저장)
create or replace function public.verify_brand_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_brand public.brand_accounts%rowtype; v_token text; v_token_hash text;
begin
  if coalesce(btrim(p_code),'') = '' then
    return jsonb_build_object('success', false, 'error', 'empty_code');
  end if;
  select * into v_brand from public.brand_accounts
   where code_hash = public._brand_hash_code(p_code) and deleted_at is null;
  if not found then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;
  if v_brand.status <> 'active' then
    return jsonb_build_object('success', false, 'error', 'inactive_brand');
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_token_hash := encode(extensions.digest(v_token::bytea, 'sha256'), 'hex');
  insert into public.brand_player_sessions (brand_id, session_token_hash, user_id, last_seen_at, user_agent)
  values (v_brand.id, v_token_hash, auth.uid(), now(), null);

  perform public._brand_audit(v_brand.id, 'brand.verify_ok', jsonb_build_object('user', auth.uid()));
  return jsonb_build_object('success', true, 'brand_id', v_brand.id, 'brand_name', v_brand.name,
    'session_token', v_token, 'expires_at', (now() + interval '30 days'));
end$$;
revoke execute on function public.verify_brand_code(text) from public, anon;
grant  execute on function public.verify_brand_code(text) to authenticated;

-- 플레이어 config: 세션 토큰 검증 → brand + policy + media + generated playlist
create or replace function public.get_brand_player_config(p_brand_id uuid, p_session_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_brand public.brand_accounts%rowtype; v_hash text; v_sid uuid;
begin
  if coalesce(btrim(p_session_token),'') = '' then raise exception 'session required' using errcode='42501'; end if;
  v_hash := encode(extensions.digest(p_session_token::bytea, 'sha256'), 'hex');
  select s.id into v_sid from public.brand_player_sessions s
   where s.brand_id = p_brand_id and s.session_token_hash = v_hash limit 1;
  if v_sid is null then raise exception 'invalid session' using errcode='42501'; end if;

  select * into v_brand from public.brand_accounts where id = p_brand_id and deleted_at is null and status='active';
  if not found then raise exception 'brand unavailable'; end if;

  update public.brand_player_sessions set last_seen_at = now() where id = v_sid;

  return jsonb_build_object(
    'brand', jsonb_build_object('id', v_brand.id, 'name', v_brand.name, 'industry_type', v_brand.industry_type),
    'policy', (select row_to_json(p) from (
        select preferred_genres, blocked_genres, preferred_moods, blocked_moods,
               energy_min, energy_max, vocal_policy, auto_generate_enabled
        from public.brand_music_policies where brand_id = p_brand_id) p),
    'media', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', id, 'title', title, 'image_url', image_url,
                'display_duration_seconds', display_duration_seconds, 'sort_order', sort_order)
              order by sort_order, created_at), '[]'::jsonb)
        from public.brand_media_assets
        where brand_id = p_brand_id and deleted_at is null and status='active'
          and (starts_at is null or starts_at <= now())
          and (ends_at   is null or ends_at   >= now())),
    'playlist', public._brand_generate_playlist(p_brand_id, 300)
  );
end$$;
revoke execute on function public.get_brand_player_config(uuid, text) from public, anon;
grant  execute on function public.get_brand_player_config(uuid, text) to authenticated;

-- heartbeat: 세션 last_seen_at / 현재곡 갱신
create or replace function public.brand_player_heartbeat(
  p_brand_id uuid, p_session_token text, p_current_track_id uuid default null, p_user_agent text default null
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text; v_sid uuid;
begin
  if coalesce(btrim(p_session_token),'') = '' then return jsonb_build_object('success', false); end if;
  v_hash := encode(extensions.digest(p_session_token::bytea, 'sha256'), 'hex');
  update public.brand_player_sessions
     set last_seen_at = now(),
         current_track_id = coalesce(p_current_track_id, current_track_id),
         playback_started_at = coalesce(playback_started_at, now()),
         user_agent = coalesce(nullif(p_user_agent,''), user_agent)
   where brand_id = p_brand_id and session_token_hash = v_hash
   returning id into v_sid;
  return jsonb_build_object('success', v_sid is not null);
end$$;
revoke execute on function public.brand_player_heartbeat(uuid, text, uuid, text) from public, anon;
grant  execute on function public.brand_player_heartbeat(uuid, text, uuid, text) to authenticated;

-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare v_tbls int; v_rpcs int;
begin
  select count(*) into v_tbls from information_schema.tables where table_schema='public'
    and table_name in ('brand_accounts','brand_music_policies','brand_media_assets','brand_player_sessions','brand_audit_logs');
  select count(*) into v_rpcs from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
    ('admin_create_brand','admin_update_brand','admin_set_brand_deleted','admin_regenerate_brand_code',
     'admin_list_brands','admin_get_brand','admin_upsert_brand_music_policy','admin_add_brand_media',
     'admin_update_brand_media','admin_delete_brand_media','_brand_generate_playlist',
     'verify_brand_code','get_brand_player_config','brand_player_heartbeat');
  raise notice '0405 BRAND-1 — tables: % / 5, rpcs: % / 14', v_tbls, v_rpcs;
end$$;
