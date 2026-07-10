-- 0452 — Phase BRAND-PLAYER-UX-2: Brand Signage Settings (transition + presentation display options)
--
-- 목적:
--   브랜드 플레이어(Digital Signage)의 브랜드 레벨 설정을 저장한다.
--   • 이미지 전환 효과/시간 (transition_effect, transition_duration_ms)
--   • Presentation Fullscreen 표시 옵션 (브랜드명/현재곡/시계/슬라이드 점)
--
-- 설계:
--   • brand_music_policies(브랜드 1:1 별도 테이블) 패턴과 일관되게 brand_signage_settings 1:1 테이블 신설.
--   • 모든 컬럼 NOT NULL + 안전한 default → 레거시 브랜드(행 없음)는 RPC 에서 default 로 채워 backward compatible.
--   • get_brand_player_config / admin_get_brand 를 CREATE OR REPLACE 로 확장(기존 필드 유지 + signage 추가).
--   • display_duration_seconds(brand_media_assets, 이미지 유지 시간)는 변경하지 않는다(전환 시간과 별개).
--
-- 절대 원칙:
--   • Additive Only. 기존 테이블/컬럼/RPC 시그니처 변경 없음(RPC 는 반환 JSON 에 필드 추가만).
--   • Production Apply 금지 — rollback-txn 검증만. 원본 데이터 변경 없음.
--   • 권한: admin 경로는 _is_super_admin(), 플레이어 경로는 세션 검증(get_brand_player_config 기존 로직 유지).

-- ─────────────────────────────────────────────────────────────────────
-- A. Table
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.brand_signage_settings (
  brand_id               uuid primary key references public.brand_accounts(id) on delete cascade,
  transition_effect      text    not null default 'fade' check (transition_effect in ('none','fade')),
  transition_duration_ms integer not null default 500  check (transition_duration_ms between 0 and 2000),
  show_brand_name        boolean not null default false,
  show_now_playing       boolean not null default false,
  show_clock             boolean not null default false,
  show_slide_dots        boolean not null default false,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users(id) on delete set null
);

alter table public.brand_signage_settings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polname = 'brand_signage_admin_read') then
    create policy brand_signage_admin_read on public.brand_signage_settings for select using (public._is_super_admin());
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- B. Upsert RPC (super_admin) — 값 정규화/clamp 후 저장
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_upsert_brand_signage_settings(
  p_brand_id uuid,
  p_transition_effect text default null,
  p_transition_duration_ms integer default null,
  p_show_brand_name boolean default null,
  p_show_now_playing boolean default null,
  p_show_clock boolean default null,
  p_show_slide_dots boolean default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_effect text; v_dur integer;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if not exists (select 1 from public.brand_accounts where id = p_brand_id and deleted_at is null) then
    raise exception 'brand not found';
  end if;

  -- 정규화: effect 는 none/fade 만 허용(그 외 fade), duration 0~2000 clamp
  v_effect := case when lower(coalesce(p_transition_effect,'')) in ('none','fade') then lower(p_transition_effect) else 'fade' end;
  v_dur := least(greatest(coalesce(p_transition_duration_ms, 500), 0), 2000);

  insert into public.brand_signage_settings as bss (
    brand_id, transition_effect, transition_duration_ms,
    show_brand_name, show_now_playing, show_clock, show_slide_dots, updated_at, updated_by)
  values (p_brand_id, v_effect, v_dur,
    coalesce(p_show_brand_name,false), coalesce(p_show_now_playing,false),
    coalesce(p_show_clock,false), coalesce(p_show_slide_dots,false), now(), auth.uid())
  on conflict (brand_id) do update set
    transition_effect = v_effect,
    transition_duration_ms = v_dur,
    show_brand_name = coalesce(p_show_brand_name, bss.show_brand_name),
    show_now_playing = coalesce(p_show_now_playing, bss.show_now_playing),
    show_clock = coalesce(p_show_clock, bss.show_clock),
    show_slide_dots = coalesce(p_show_slide_dots, bss.show_slide_dots),
    updated_at = now(), updated_by = auth.uid();

  return jsonb_build_object('success', true, 'brand_id', p_brand_id,
    'transition_effect', v_effect, 'transition_duration_ms', v_dur);
end$$;
revoke execute on function public.admin_upsert_brand_signage_settings(uuid,text,integer,boolean,boolean,boolean,boolean) from public, anon;
grant  execute on function public.admin_upsert_brand_signage_settings(uuid,text,integer,boolean,boolean,boolean,boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- C. Helper — signage jsonb (행 없으면 default) — config/admin_get 공용
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._brand_signage_json(p_brand_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
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
$$;

-- ─────────────────────────────────────────────────────────────────────
-- D. get_brand_player_config — CREATE OR REPLACE (기존 필드 유지 + signage 추가)
-- ─────────────────────────────────────────────────────────────────────
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
    'signage', public._brand_signage_json(p_brand_id),
    'playlist', public._brand_generate_playlist(p_brand_id, 300)
  );
end$$;
revoke execute on function public.get_brand_player_config(uuid, text) from public, anon;
grant  execute on function public.get_brand_player_config(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- E. admin_get_brand — CREATE OR REPLACE (기존 필드 유지 + signage 추가)
-- ─────────────────────────────────────────────────────────────────────
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
        from public.brand_media_assets where brand_id = p_id and deleted_at is null) m),
    'signage', public._brand_signage_json(p_id)
  ) into v;
  if v->'brand' is null then raise exception 'brand not found'; end if;
  return v;
end$$;
revoke execute on function public.admin_get_brand(uuid) from public, anon;
grant  execute on function public.admin_get_brand(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- F. Grants for helper
-- ─────────────────────────────────────────────────────────────────────
revoke execute on function public._brand_signage_json(uuid) from public, anon;
grant  execute on function public._brand_signage_json(uuid) to authenticated;

comment on table public.brand_signage_settings is
  'BRAND-PLAYER-UX-2 — 브랜드 레벨 사이니지 설정(전환효과/시간 + presentation 표시옵션). 행 없으면 RPC default(fade/500/전부 off).';
