-- ============================================================================
-- 0464_ai_runtime_store_settings.sql — Phase AI-RUNTIME-CONNECTION-1
--
-- Store-scoped, admin-APPROVED feature flag that gates whether a store's live
-- runtime queue may use the AI candidate re-ranking (0463) instead of the
-- static playlist order.
--
-- 절대 원칙 (safety):
--   • Default OFF. 설정 Row 없거나 enabled=false 거나 승인 정보 없으면 → 'off'.
--   • 승인은 오직 platform admin 만 가능(approved_by/approved_at 서버 stamp).
--   • Store = business-plan user (id = store_id). "stores" 테이블 없음.
--   • 이번 Phase 허용 mode: off / preview / shadow  (LIVE 금지).
--   • 기존 객체 변경/삭제 없음. 새 테이블 + 새 함수만 추가(additive).
--   • Idempotent, explicit search_path, SECURITY DEFINER + 내부 auth 체크.
--   • Test DB 전용. Production 미적용 (테이블이 prod 에 없으므로 client 는 OFF fallback).
--
-- 재사용:
--   • _ai_build_store_queue_core / _ai_store_candidate_pool_core (0463) — 이미
--     blocked 제외 + fit desc 정렬 + auth-gate-free. 여기선 store-scoped 권한
--     래퍼 + mode gate 만 얹는다. 새 scoring/provider 없음.
--   • store-ownership 술어는 0462 upsert_store_track_reaction 과 동일 패턴.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Settings table
-- ----------------------------------------------------------------------------
create table if not exists public.ai_runtime_store_settings (
  store_id          uuid primary key references public.users(id) on delete cascade,
  enabled           boolean not null default false,
  mode              text not null default 'off' check (mode in ('off', 'preview', 'shadow')),
  max_ai_tracks     integer not null default 50 check (max_ai_tracks between 1 and 500),
  minimum_fit_score numeric not null default 0 check (minimum_fit_score >= 0 and minimum_fit_score <= 100),
  approved_by       uuid references public.users(id) on delete set null,
  approved_at       timestamptz,
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.ai_runtime_store_settings is
  'AI-RUNTIME-CONNECTION-1: per-store admin-approved gate for AI runtime queue re-ranking. Default OFF; requires platform-admin approval. off/preview/shadow only (no live).';

-- partial index for admin "active AI stores" listing
create index if not exists idx_ai_runtime_settings_active
  on public.ai_runtime_store_settings (mode)
  where enabled = true and mode <> 'off';

-- ----------------------------------------------------------------------------
-- 2. updated_at trigger (self-contained — no dependency on fixture parity)
-- ----------------------------------------------------------------------------
create or replace function public._ai_runtime_touch_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_ai_runtime_store_settings_touch on public.ai_runtime_store_settings;
create trigger trg_ai_runtime_store_settings_touch
  before update on public.ai_runtime_store_settings
  for each row execute function public._ai_runtime_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. RLS — reads allowed to store-self / franchise HQ / platform admin.
--    No direct INSERT/UPDATE/DELETE policy → writes only via admin RPC (definer).
-- ----------------------------------------------------------------------------
alter table public.ai_runtime_store_settings enable row level security;

drop policy if exists ai_runtime_settings_read on public.ai_runtime_store_settings;
create policy ai_runtime_settings_read on public.ai_runtime_store_settings
  for select
  using (
    auth.uid() = store_id
    or exists (
      select 1 from public.franchise_stores fs
        join public.franchise_admins fa
          on fa.franchise_id = fs.franchise_id and fa.user_id = auth.uid()
       where fs.store_id = ai_runtime_store_settings.store_id
    )
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- ----------------------------------------------------------------------------
-- 4. Internal helper: is the caller allowed to READ this store's runtime state?
--    (store-self / managing franchise HQ / platform admin). Fail-closed.
-- ----------------------------------------------------------------------------
create or replace function public._ai_runtime_can_read_store(p_store_id uuid, p_uid uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select
    p_uid is not null and p_store_id is not null and (
      p_uid = p_store_id
      or exists (
        select 1 from public.franchise_stores fs
          join public.franchise_admins fa
            on fa.franchise_id = fs.franchise_id and fa.user_id = p_uid
         where fs.store_id = p_store_id
      )
      or exists (select 1 from public.users u where u.id = p_uid and u.role = 'admin')
    );
$$;

-- ----------------------------------------------------------------------------
-- 5. Runtime read RPC — EFFECTIVE mode, fail-closed to 'off'.
--    Callable by the store player itself (auth.uid() = store_id), its HQ, or admin.
--    Returns 'off' unless enabled AND approved AND mode in (preview, shadow).
-- ----------------------------------------------------------------------------
create or replace function public.get_store_ai_runtime_mode(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.ai_runtime_store_settings;
  v_effective text := 'off';
begin
  if not public._ai_runtime_can_read_store(p_store_id, v_uid) then
    -- fail-closed: no leak of other stores' state, but never error the player → OFF.
    return jsonb_build_object(
      'store_id', p_store_id, 'mode', 'off', 'enabled', false, 'approved', false,
      'max_ai_tracks', 50, 'minimum_fit_score', 0, 'source', 'unauthorized'
    );
  end if;

  select * into v_row from public.ai_runtime_store_settings where store_id = p_store_id;

  if found
     and v_row.enabled
     and v_row.approved_by is not null
     and v_row.approved_at is not null
     and v_row.mode in ('preview', 'shadow')
  then
    v_effective := v_row.mode;
  end if;

  return jsonb_build_object(
    'store_id', p_store_id,
    'mode', v_effective,
    'enabled', coalesce(v_row.enabled, false),
    'approved', (v_row.approved_by is not null and v_row.approved_at is not null),
    'max_ai_tracks', coalesce(v_row.max_ai_tracks, 50),
    'minimum_fit_score', coalesce(v_row.minimum_fit_score, 0),
    'source', case when found then 'settings' else 'default_off' end
  );
end;
$$;

revoke execute on function public.get_store_ai_runtime_mode(uuid) from public, anon;
grant execute on function public.get_store_ai_runtime_mode(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Runtime candidate queue RPC — store-scoped, mode-gated.
--    Reuses 0463 core (blocked-excluded, fit desc). Raises 'ai_runtime_disabled'
--    unless effective mode is preview/shadow. Read-only; nothing persisted.
-- ----------------------------------------------------------------------------
create or replace function public.get_store_ai_runtime_queue(
  p_store_id   uuid,
  p_playlist_id uuid,
  p_limit      integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.ai_runtime_store_settings;
  v_limit integer;
begin
  if not public._ai_runtime_can_read_store(p_store_id, v_uid) then
    raise exception 'store_access_denied';
  end if;

  select * into v_row from public.ai_runtime_store_settings where store_id = p_store_id;

  if not (found
          and v_row.enabled
          and v_row.approved_by is not null
          and v_row.approved_at is not null
          and v_row.mode in ('preview', 'shadow')) then
    raise exception 'ai_runtime_disabled';
  end if;

  v_limit := least(coalesce(p_limit, v_row.max_ai_tracks, 50), v_row.max_ai_tracks, 500);

  -- 0463 core already: candidate-scope = this playlist's tracks only, blocked
  -- excluded, ordered fit_score desc. No new scoring, no full-catalog pull.
  return public._ai_build_store_queue_core(p_store_id, p_playlist_id, v_limit);
end;
$$;

revoke execute on function public.get_store_ai_runtime_queue(uuid, uuid, integer) from public, anon;
grant execute on function public.get_store_ai_runtime_queue(uuid, uuid, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Admin read RPC (management view) — platform admin or franchise HQ.
--    Returns the raw settings row (or defaults) for the admin control UI.
-- ----------------------------------------------------------------------------
create or replace function public.admin_get_ai_runtime_store_settings(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.ai_runtime_store_settings;
begin
  if v_uid is null then
    raise exception 'unauthenticated';
  end if;
  if not public._ai_runtime_can_read_store(p_store_id, v_uid) then
    raise exception 'store_access_denied';
  end if;

  select * into v_row from public.ai_runtime_store_settings where store_id = p_store_id;

  if not found then
    return jsonb_build_object(
      'store_id', p_store_id, 'enabled', false, 'mode', 'off',
      'max_ai_tracks', 50, 'minimum_fit_score', 0,
      'approved_by', null, 'approved_at', null, 'note', null, 'exists', false
    );
  end if;

  return jsonb_build_object(
    'store_id', v_row.store_id, 'enabled', v_row.enabled, 'mode', v_row.mode,
    'max_ai_tracks', v_row.max_ai_tracks, 'minimum_fit_score', v_row.minimum_fit_score,
    'approved_by', v_row.approved_by, 'approved_at', v_row.approved_at,
    'note', v_row.note, 'created_at', v_row.created_at, 'updated_at', v_row.updated_at,
    'exists', true
  );
end;
$$;

revoke execute on function public.admin_get_ai_runtime_store_settings(uuid) from public, anon;
grant execute on function public.admin_get_ai_runtime_store_settings(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. Admin set RPC (approval action) — PLATFORM ADMIN ONLY.
--    Upserts the settings row; stamps approved_by/approved_at when activating a
--    non-off mode. Franchise HQ and store users CANNOT change the mode (approval
--    is a platform decision). Validates inputs; no live mode allowed.
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_ai_runtime_store_settings(
  p_store_id         uuid,
  p_mode             text,
  p_enabled          boolean,
  p_max_ai_tracks    integer default null,
  p_minimum_fit_score numeric default null,
  p_note             text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.ai_runtime_store_settings;
  v_active boolean;
  v_max integer;
  v_min numeric;
begin
  if v_uid is null then
    raise exception 'unauthenticated';
  end if;
  -- platform admin ONLY (approval gate — not store, not HQ).
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin_only';
  end if;
  if p_store_id is null then
    raise exception 'invalid_store';
  end if;
  if not exists (select 1 from public.users u where u.id = p_store_id) then
    raise exception 'unknown_store';
  end if;
  if coalesce(p_mode, 'off') not in ('off', 'preview', 'shadow') then
    raise exception 'invalid_mode';  -- live/unknown rejected
  end if;

  v_max := coalesce(p_max_ai_tracks, 50);
  v_min := coalesce(p_minimum_fit_score, 0);
  if v_max < 1 or v_max > 500 then
    raise exception 'invalid_max_ai_tracks';
  end if;
  if v_min < 0 or v_min > 100 then
    raise exception 'invalid_minimum_fit_score';
  end if;

  -- "active" = enabled AND a non-off mode → requires stamping approval.
  v_active := coalesce(p_enabled, false) and coalesce(p_mode, 'off') <> 'off';

  insert into public.ai_runtime_store_settings
    (store_id, enabled, mode, max_ai_tracks, minimum_fit_score, approved_by, approved_at, note)
  values
    (p_store_id, coalesce(p_enabled, false), coalesce(p_mode, 'off'), v_max, v_min,
     case when v_active then v_uid else null end,
     case when v_active then now() else null end,
     p_note)
  on conflict (store_id) do update set
    enabled           = excluded.enabled,
    mode              = excluded.mode,
    max_ai_tracks     = excluded.max_ai_tracks,
    minimum_fit_score = excluded.minimum_fit_score,
    approved_by       = case when v_active then v_uid else null end,
    approved_at       = case when v_active then now() else null end,
    note              = excluded.note
  returning * into v_row;

  return jsonb_build_object(
    'store_id', v_row.store_id, 'enabled', v_row.enabled, 'mode', v_row.mode,
    'max_ai_tracks', v_row.max_ai_tracks, 'minimum_fit_score', v_row.minimum_fit_score,
    'approved_by', v_row.approved_by, 'approved_at', v_row.approved_at,
    'note', v_row.note, 'updated_at', v_row.updated_at
  );
end;
$$;

revoke execute on function public.admin_set_ai_runtime_store_settings(uuid, text, boolean, integer, numeric, text) from public, anon;
grant execute on function public.admin_set_ai_runtime_store_settings(uuid, text, boolean, integer, numeric, text) to authenticated;
