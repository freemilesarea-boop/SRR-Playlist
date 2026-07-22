-- 0454 — BRAND-DEVICE-BINDING-1 · Trusted Store Device Binding 하드닝
--
-- 재사용: 기존 brand_player_sessions(0407)를 재사용. 중복 Device 테이블 생성 금지.
-- 멱등/자기충족: create table if not exists 로 스키마 부트스트랩.
--   · Production: 테이블이 이미 존재 → create 는 no-op, alter add column if not exists 로 4개 컬럼만 추가.
--   · Test(brand 스키마 부재): 최소 brand 스키마 + full sessions 테이블을 생성해 인증 가능케 한다.
-- 보안: user_id=auth.uid() 강제 + revoked_at + expires_at 강제. anon 차단. Cross-user/Cross-brand 차단.
--
-- 주의:
--   · verify_store_code / get_brand_player_config 본문은 이 마이그레이션에서 재작성하지 않는다.
--     (전자는 _brand_audit, 후자는 media/policy/signage/playlist 서브시스템에 의존 — Prod 최신 로직을
--      blind 로 되돌리지 않기 위함.) 두 함수의 binding guard 강화는 Production Apply Phase 에서
--      본문 확인 후 guard-prepend 로 반영한다. 자동 진입 경로의 보안은 verify_brand_device_binding +
--      강화된 brand_player_heartbeat 가 강제한다(동일 검증 로직).
--   · Production 미적용. 이번 Phase 는 Test(haojpuhztegecbrwqorr)에만 적용.

-- ── 최소 종속 스키마 (Prod no-op / Test bootstrap) ────────────────────────────
create table if not exists public.enterprise_accounts (
  id                uuid primary key default gen_random_uuid(),
  enterprise_name   text not null,
  store_invite_code text,
  status            text not null default 'active',
  auth_user_id      uuid,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now()
);

create table if not exists public.brand_accounts (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  industry_type         text,
  status                text not null default 'active',
  enterprise_account_id uuid,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now()
);

create table if not exists public.brand_player_sessions (
  id                    uuid primary key default gen_random_uuid(),
  brand_id              uuid not null references public.brand_accounts(id) on delete cascade,
  enterprise_account_id uuid,
  session_token_hash    text,
  user_id               uuid references auth.users(id) on delete set null,
  current_track_id      uuid,
  last_seen_at          timestamptz,
  playback_started_at   timestamptz,
  user_agent            text,
  created_at            timestamptz not null default now(),
  -- 0454 additive:
  revoked_at            timestamptz,
  revoked_by            uuid references auth.users(id) on delete set null,
  expires_at            timestamptz,
  device_label          text
);
create index if not exists idx_brand_sessions_token on public.brand_player_sessions (session_token_hash) where session_token_hash is not null;

-- Production(기존 테이블)용 additive 컬럼 (Test 는 위 create 로 이미 포함 → no-op).
alter table public.brand_player_sessions add column if not exists revoked_at   timestamptz;
alter table public.brand_player_sessions add column if not exists revoked_by   uuid references auth.users(id) on delete set null;
alter table public.brand_player_sessions add column if not exists expires_at   timestamptz;
alter table public.brand_player_sessions add column if not exists device_label text;

create index if not exists idx_brand_sessions_user_active
  on public.brand_player_sessions (user_id, brand_id) where revoked_at is null;

-- ── RLS: 직접 테이블 접근은 RPC(정의자) 경유. 자기 것만 select 허용(방어적) ──────
alter table public.brand_player_sessions enable row level security;
drop policy if exists brand_sessions_self_read on public.brand_player_sessions;
create policy brand_sessions_self_read on public.brand_player_sessions for select
  using (user_id = auth.uid());

-- ── 엄격 재검증 RPC (자동 진입 전 서버 검증) ──────────────────────────────────
create or replace function public.verify_brand_device_binding(p_brand_id uuid, p_session_token text)
 returns jsonb language plpgsql security definer set search_path = public, extensions
as $function$
declare v_hash text; v_row public.brand_player_sessions%rowtype; v_brand public.brand_accounts%rowtype;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'not_authenticated'); end if;
  if coalesce(btrim(p_session_token), '') = '' then return jsonb_build_object('ok', false, 'reason', 'no_binding'); end if;
  v_hash := encode(extensions.digest(p_session_token::bytea, 'sha256'), 'hex');
  select * into v_row from public.brand_player_sessions
   where brand_id = p_brand_id and session_token_hash = v_hash limit 1;
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid_binding'); end if;
  if v_row.user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'reason', 'not_owner'); end if;
  if v_row.revoked_at is not null then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;
  if v_row.expires_at is not null and v_row.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  select * into v_brand from public.brand_accounts where id = p_brand_id and deleted_at is null and status = 'active';
  if not found then return jsonb_build_object('ok', false, 'reason', 'store_inactive'); end if;
  update public.brand_player_sessions set last_seen_at = now() where id = v_row.id;
  return jsonb_build_object('ok', true, 'brand_name', v_brand.name, 'device_label', v_row.device_label, 'expires_at', v_row.expires_at);
end;
$function$;

-- ── 자기 기기 연결 해제 ───────────────────────────────────────────────────────
create or replace function public.revoke_brand_device_by_token(p_brand_id uuid, p_session_token text)
 returns jsonb language plpgsql security definer set search_path = public, extensions
as $function$
declare v_hash text; v_id uuid;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'not_authenticated'); end if;
  if coalesce(btrim(p_session_token), '') = '' then return jsonb_build_object('ok', false, 'reason', 'no_binding'); end if;
  v_hash := encode(extensions.digest(p_session_token::bytea, 'sha256'), 'hex');
  update public.brand_player_sessions set revoked_at = now(), revoked_by = auth.uid()
   where brand_id = p_brand_id and session_token_hash = v_hash and user_id = auth.uid() and revoked_at is null
   returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end;
$function$;

-- ── 내 기기 목록 (self) — 비민감 표시정보만 ───────────────────────────────────
create or replace function public.list_my_brand_devices()
 returns table(device_label text, brand_name text, last_seen_at timestamptz, created_at timestamptz, expires_at timestamptz, revoked boolean)
 language plpgsql stable security definer set search_path = public
as $function$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  return query
  select s.device_label, b.name, s.last_seen_at, s.created_at, s.expires_at, (s.revoked_at is not null)
  from public.brand_player_sessions s
  join public.brand_accounts b on b.id = s.brand_id
  where s.user_id = auth.uid()
  order by s.last_seen_at desc nulls last, s.created_at desc;
end;
$function$;

-- ── brand_player_heartbeat 강화 (Production 본문 그대로 + binding guard) ────────
create or replace function public.brand_player_heartbeat(p_brand_id uuid, p_session_token text, p_current_track_id uuid default null::uuid, p_user_agent text default null::text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare v_hash text; v_sid uuid;
begin
  if coalesce(btrim(p_session_token),'') = '' then return jsonb_build_object('success', false); end if;
  if auth.uid() is null then return jsonb_build_object('success', false); end if;
  v_hash := encode(extensions.digest(p_session_token::bytea, 'sha256'), 'hex');
  update public.brand_player_sessions
     set last_seen_at = now(),
         current_track_id = coalesce(p_current_track_id, current_track_id),
         playback_started_at = coalesce(playback_started_at, now()),
         user_agent = coalesce(nullif(p_user_agent,''), user_agent)
   where brand_id = p_brand_id and session_token_hash = v_hash
     and user_id = auth.uid()                                   -- BINDING: 소유자
     and revoked_at is null                                     -- BINDING: 미폐기
     and (expires_at is null or expires_at > now())             -- BINDING: 미만료
   returning id into v_sid;
  return jsonb_build_object('success', v_sid is not null);
end;
$function$;

-- ── Grants (fail-closed) ──────────────────────────────────────────────────────
revoke all on function public.verify_brand_device_binding(uuid, text) from public, anon;
revoke all on function public.revoke_brand_device_by_token(uuid, text) from public, anon;
revoke all on function public.list_my_brand_devices() from public, anon;
revoke all on function public.brand_player_heartbeat(uuid, text, uuid, text) from public, anon;
grant execute on function public.verify_brand_device_binding(uuid, text) to authenticated;
grant execute on function public.revoke_brand_device_by_token(uuid, text) to authenticated;
grant execute on function public.list_my_brand_devices() to authenticated;
grant execute on function public.brand_player_heartbeat(uuid, text, uuid, text) to authenticated;

comment on function public.verify_brand_device_binding(uuid, text) is 'BRAND-DEVICE-BINDING-1: strict binding re-verify (owner + not-revoked + not-expired + active brand).';
comment on function public.brand_player_heartbeat(uuid, text, uuid, text) is 'BRAND-DEVICE-BINDING-1: hardened with binding guard (owner + not-revoked + not-expired).';
