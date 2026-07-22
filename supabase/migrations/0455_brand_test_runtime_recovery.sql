-- 0455 — BRAND-TEST-RECOVERY-1 · Brand Player 백엔드 Test Runtime 복구 (Test 전용)
--
-- 목적: Production 에만 존재하는 Brand Player 백엔드(config/playlist/signage/media/policy + verify_store_code
--   + get_brand_player_config)를 Test 에서 실행 가능하도록 최소·기능 동등(functional parity)으로 복구한다.
--   Production 전체 스키마/추천 알고리즘을 그대로 복제하지 않는다. 0454 Binding 구조와 연결한다.
-- 멱등/무해: create if not exists / create or replace. Production 적용해도 기존 Object 파괴 없음(향후 별 Phase).
-- 이번 Phase 는 Test(haojpuhztegecbrwqorr)에만 적용. Production 미변경.

-- ── 종속 테이블 (if not exists) ────────────────────────────────────────────────
create table if not exists public.brand_audit_logs (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid,
  admin_user_id uuid,
  action        text not null,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

create table if not exists public.brand_media_assets (
  id                       uuid primary key default gen_random_uuid(),
  brand_id                 uuid not null references public.brand_accounts(id) on delete cascade,
  asset_type               text not null default 'image',
  title                    text,
  image_url                text not null,
  display_duration_seconds integer not null default 10,
  sort_order               integer not null default 0,
  starts_at                timestamptz,
  ends_at                  timestamptz,
  status                   text not null default 'active',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,
  mime_type                text,
  thumbnail_url            text,
  media_duration_seconds   numeric
);
create index if not exists idx_brand_media_brand on public.brand_media_assets (brand_id, sort_order) where deleted_at is null;

create table if not exists public.brand_music_policies (
  id                    uuid primary key default gen_random_uuid(),
  brand_id              uuid not null references public.brand_accounts(id) on delete cascade,
  preferred_genres      text[] not null default '{}',
  blocked_genres        text[] not null default '{}',
  preferred_moods       text[] not null default '{}',
  blocked_moods         text[] not null default '{}',
  energy_min            numeric,
  energy_max            numeric,
  vocal_policy          text not null default 'any',
  daypart_policy        jsonb,
  auto_generate_enabled boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists uq_brand_music_policies_brand on public.brand_music_policies (brand_id);

create table if not exists public.brand_signage_settings (
  brand_id               uuid primary key references public.brand_accounts(id) on delete cascade,
  transition_effect      text not null default 'fade',
  transition_duration_ms integer not null default 500,
  show_brand_name        boolean not null default false,
  show_now_playing       boolean not null default false,
  show_clock             boolean not null default false,
  show_slide_dots        boolean not null default false,
  updated_at             timestamptz not null default now(),
  updated_by             uuid
);

-- Store code brute-force 방어용 시도 기록 (auth.uid 기준 rate limit).
create table if not exists public.brand_store_code_attempts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid,
  success      boolean not null default false,
  attempted_at timestamptz not null default now()
);
create index if not exists idx_store_code_attempts_user on public.brand_store_code_attempts (user_id, attempted_at desc);

-- ── RLS (default deny; RPC-정의자 경유. 관리자 read 만 허용) ────────────────────
do $$
declare t text;
begin
  foreach t in array array['brand_media_assets','brand_music_policies','brand_signage_settings','brand_audit_logs','brand_store_code_attempts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_admin_read', t);
    execute format('create policy %I on public.%I for select using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = ''admin''))', t||'_admin_read', t);
  end loop;
end$$;

-- ── helper: audit (Production 동등) ───────────────────────────────────────────
create or replace function public._brand_audit(p_brand_id uuid, p_action text, p_meta jsonb default '{}'::jsonb)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  insert into public.brand_audit_logs (brand_id, admin_user_id, action, metadata)
  values (p_brand_id, auth.uid(), p_action, coalesce(p_meta,'{}'::jsonb));
end$function$;

-- ── helper: signage json (Production verbatim) ────────────────────────────────
create or replace function public._brand_signage_json(p_brand_id uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    (select jsonb_build_object(
       'transition_effect', transition_effect,
       'transition_duration_ms', transition_duration_ms,
       'show_brand_name', show_brand_name,
       'show_now_playing', show_now_playing,
       'show_clock', show_clock,
       'show_slide_dots', show_slide_dots)
     from public.brand_signage_settings where brand_id = p_brand_id),
    jsonb_build_object(
       'transition_effect', 'fade', 'transition_duration_ms', 500,
       'show_brand_name', false, 'show_now_playing', false, 'show_clock', false, 'show_slide_dots', false));
$function$;

-- ── helper: playlist 생성 (functional parity — 정책 필터 + 스코어링 + 동일 JSON 계약) ──
-- Production 추천 알고리즘 전체를 복제하지 않는다. Preview QA 에 필요한 재생 가능한 큐를 반환한다.
create or replace function public._brand_generate_playlist(p_brand_id uuid, p_limit integer default 200)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v jsonb; pol public.brand_music_policies%rowtype;
  v_limit int := greatest(1, least(coalesce(p_limit,200),500));
  v_seed text := to_char((now() at time zone 'Asia/Seoul')::date,'YYYYMMDD')||':'||p_brand_id::text;
begin
  select * into pol from public.brand_music_policies where brand_id = p_brand_id;
  select coalesce(jsonb_agg(sub.x order by sub.x_score desc, sub.x_rot), '[]'::jsonb) into v from (
    select jsonb_build_object(
             'id', t.id, 'title', t.title, 'artist', t.artist,
             'genre', coalesce(t.main_genre, t.genre), 'mood', t.mood,
             'audio_url', t.audio_url, 'cover_url', t.cover_url,
             'duration', t.duration, 'created_at', t.created_at) as x,
      ( (case when pol.preferred_genres is not null and lower(coalesce(t.main_genre,t.genre,'')) = any(select lower(g) from unnest(pol.preferred_genres) g) then 25 else 0 end)
      + (case when pol.preferred_moods  is not null and lower(coalesce(t.mood,''))            = any(select lower(m) from unnest(pol.preferred_moods)  m) then 15 else 0 end) )::numeric as x_score,
      ('x'||substr(md5(t.id::text||v_seed),1,8))::bit(32)::bigint as x_rot
    from public.tracks t
    where t.audio_url is not null and length(btrim(t.audio_url)) > 0
      and t.cover_url is not null and length(btrim(t.cover_url)) > 0
      and (t.release_status = 'released' or t.release_status is null)
      and t.removed_at is null
      and (t.visibility_status is null or t.visibility_status in ('approved','public'))
      and (pol.vocal_policy is null or pol.vocal_policy <> 'instrumental_only'
           or t.instrumental is true or t.lyric_type = 'instrumental' or t.vocal_type = 'instrumental')
      and (pol.energy_min is null or t.energy_level is null or t.energy_level >= pol.energy_min)
      and (pol.energy_max is null or t.energy_level is null or t.energy_level <= pol.energy_max)
      and not (pol.blocked_genres is not null and lower(coalesce(t.main_genre,t.genre,'')) = any(select lower(g) from unnest(pol.blocked_genres) g))
      and not (pol.blocked_moods  is not null and lower(coalesce(t.mood,''))            = any(select lower(m) from unnest(pol.blocked_moods)  m))
    limit v_limit
  ) sub;
  return v;
end$function$;

-- ── rate limit helper ─────────────────────────────────────────────────────────
create or replace function public._brand_store_code_rate_limited()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select (select count(*) from public.brand_store_code_attempts
          where user_id = auth.uid() and success = false and attempted_at > now() - interval '10 minutes') >= 5;
$function$;

-- ── verify_store_code (하드닝: rate limit + expires_at + device_label + user_id + anon 차단) ──
create or replace function public.verify_store_code(p_store_code text, p_device_label text default null)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare v_ea public.enterprise_accounts%rowtype; v_brand public.brand_accounts%rowtype; v_token text; v_hash text;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'error', 'not_authenticated');
  end if;
  if public._brand_store_code_rate_limited() then
    return jsonb_build_object('success', false, 'error', 'rate_limited');
  end if;
  if coalesce(btrim(p_store_code),'') = '' then
    return jsonb_build_object('success', false, 'error', 'empty_code');
  end if;
  if length(btrim(p_store_code)) > 64 then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;

  select * into v_ea from public.enterprise_accounts
   where store_invite_code = btrim(p_store_code) and deleted_at is null and status = 'active';
  if not found then
    insert into public.brand_store_code_attempts(user_id, success) values (auth.uid(), false);
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;

  select * into v_brand from public.brand_accounts
   where enterprise_account_id = v_ea.id and deleted_at is null and status = 'active'
   limit 1;
  if not found then
    insert into public.brand_store_code_attempts(user_id, success) values (auth.uid(), false);
    return jsonb_build_object('success', false, 'error', 'brand_not_linked');
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_hash  := encode(extensions.digest(v_token::bytea, 'sha256'), 'hex');
  insert into public.brand_player_sessions
    (brand_id, enterprise_account_id, session_token_hash, user_id, last_seen_at, expires_at, device_label)
  values
    (v_brand.id, v_ea.id, v_hash, auth.uid(), now(), now() + interval '90 days', nullif(btrim(coalesce(p_device_label,'')),''));

  insert into public.brand_store_code_attempts(user_id, success) values (auth.uid(), true);
  perform public._brand_audit(v_brand.id, 'brand.verify_store_ok', jsonb_build_object('enterprise_account_id', v_ea.id));
  return jsonb_build_object('success', true, 'brand_id', v_brand.id, 'store_label', v_ea.enterprise_name,
    'session_token', v_token, 'expires_at', (now() + interval '90 days'));
end$function$;

-- ── get_brand_player_config (하드닝: binding guard user_id + revoke + expiry + brand active) ──
create or replace function public.get_brand_player_config(p_brand_id uuid, p_session_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare v_brand public.brand_accounts%rowtype; v_hash text; v_row public.brand_player_sessions%rowtype;
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode='42501'; end if;
  if coalesce(btrim(p_session_token),'') = '' then raise exception 'session required' using errcode='42501'; end if;
  v_hash := encode(extensions.digest(p_session_token::bytea, 'sha256'), 'hex');
  select * into v_row from public.brand_player_sessions s
   where s.brand_id = p_brand_id and s.session_token_hash = v_hash limit 1;
  if v_row.id is null then raise exception 'invalid session' using errcode='42501'; end if;
  if v_row.user_id is distinct from auth.uid() then raise exception 'invalid session' using errcode='42501'; end if;  -- cross-user 차단(내부사유 비노출)
  if v_row.revoked_at is not null then raise exception 'invalid session' using errcode='42501'; end if;
  if v_row.expires_at is not null and v_row.expires_at <= now() then raise exception 'session expired' using errcode='42501'; end if;

  select * into v_brand from public.brand_accounts where id = p_brand_id and deleted_at is null and status='active';
  if not found then raise exception 'brand unavailable'; end if;

  update public.brand_player_sessions set last_seen_at = now() where id = v_row.id;

  return jsonb_build_object(
    'brand', jsonb_build_object('id', v_brand.id, 'name', v_brand.name, 'industry_type', v_brand.industry_type),
    'policy', (select row_to_json(p) from (
        select preferred_genres, blocked_genres, preferred_moods, blocked_moods,
               energy_min, energy_max, vocal_policy, auto_generate_enabled
        from public.brand_music_policies where brand_id = p_brand_id) p),
    'media', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', id, 'title', title, 'image_url', image_url,
                'display_duration_seconds', display_duration_seconds, 'sort_order', sort_order,
                'asset_type', asset_type, 'mime_type', mime_type,
                'thumbnail_url', thumbnail_url, 'media_duration_seconds', media_duration_seconds)
              order by sort_order, created_at), '[]'::jsonb)
        from public.brand_media_assets
        where brand_id = p_brand_id and deleted_at is null and status='active'
          and (starts_at is null or starts_at <= now())
          and (ends_at   is null or ends_at   >= now())),
    'signage', public._brand_signage_json(p_brand_id),
    'playlist', public._brand_generate_playlist(p_brand_id, 300)
  );
end$function$;

-- ── Grants (fail-closed) ──────────────────────────────────────────────────────
revoke all on function public.verify_store_code(text, text) from public, anon;
revoke all on function public.get_brand_player_config(uuid, text) from public, anon;
grant execute on function public.verify_store_code(text, text) to authenticated;
grant execute on function public.get_brand_player_config(uuid, text) to authenticated;
-- 내부 helper: client grant 없음(정의자 컨텍스트 전용).
revoke all on function public._brand_generate_playlist(uuid, integer) from public, anon;
revoke all on function public._brand_signage_json(uuid) from public, anon;
revoke all on function public._brand_store_code_rate_limited() from public, anon;

comment on function public.verify_store_code(text, text) is 'BRAND-TEST-RECOVERY-1: hardened (auth + rate-limit + expires_at + device_label + user binding).';
comment on function public.get_brand_player_config(uuid, text) is 'BRAND-TEST-RECOVERY-1: hardened with binding guard (owner + not-revoked + not-expired + active brand).';
