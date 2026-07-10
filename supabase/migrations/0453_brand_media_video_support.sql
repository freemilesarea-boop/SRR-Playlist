-- 0453 — Phase BRAND-PLAYER-UX-3: Digital Signage Video Support (additive)
--
-- 목적:
--   브랜드 사이니지가 이미지뿐 아니라 동영상(mp4/webm/mov)을 함께 재생할 수 있도록 확장한다.
--   image → 유지시간(display_duration_seconds) 후 다음 / video → 영상 종료까지 재생 후 다음.
--
-- 설계 (전부 Additive · Backward Compatible):
--   • brand_media_assets 에 nullable 컬럼 추가: mime_type, thumbnail_url, media_duration_seconds.
--   • asset_type CHECK 를 'image' 전용 → in('image','video') 로 완화(기존 image 행 영향 없음).
--   • admin_add_brand_media 에 video 파라미터(뒤에 default 추가) → 기존 7-인자 호출 그대로 동작.
--   • get_brand_player_config / admin_get_brand media select 에 asset_type/mime/thumbnail/길이 추가.
--     (0452 의 signage 확장을 그대로 보존한 상태에서 media 필드만 추가)
--   • Storage 'brand-media' 버킷 allowed_mime_types / file_size_limit 확장(video 허용, 50MB).
--
-- 절대 원칙:
--   • 음악 재생 엔진 / Queue / Crossfade / Playback Runtime / Scheduler / Settlement / Streaming /
--     Heartbeat 관련 어떤 것도 건드리지 않는다(브랜드 미디어 자산 계층만 확장).
--   • Production Apply 금지 — rollback-txn 검증만. 원본 데이터/버킷 변경 없음.
--   • 롤백: 아래 F 참조.

-- ─────────────────────────────────────────────────────────────────────
-- A. Columns (additive, nullable)
-- ─────────────────────────────────────────────────────────────────────
alter table public.brand_media_assets
  add column if not exists mime_type              text,
  add column if not exists thumbnail_url          text,
  add column if not exists media_duration_seconds numeric;  -- video 길이(초). image 는 null.

comment on column public.brand_media_assets.mime_type is 'UX-3: 업로드 파일 MIME (image/* 또는 video/*). 표시/판별 보조.';
comment on column public.brand_media_assets.thumbnail_url is 'UX-3: video 썸네일 URL(선택). null 이면 클라이언트가 video 첫 프레임을 대체 사용.';
comment on column public.brand_media_assets.media_duration_seconds is 'UX-3: video 재생 길이(초, 참고 표시용). image 는 null. 유지시간(display_duration_seconds)과 별개.';

-- ─────────────────────────────────────────────────────────────────────
-- B. asset_type CHECK 완화: image 전용 → image|video
-- ─────────────────────────────────────────────────────────────────────
alter table public.brand_media_assets drop constraint if exists brand_media_assets_asset_type_check;
alter table public.brand_media_assets
  add constraint brand_media_assets_asset_type_check check (asset_type in ('image','video'));

-- ─────────────────────────────────────────────────────────────────────
-- C. admin_add_brand_media — video 파라미터 추가 (기존 7-인자 호출 호환)
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.admin_add_brand_media(uuid,text,text,integer,integer,timestamptz,timestamptz);
create or replace function public.admin_add_brand_media(
  p_brand_id uuid,
  p_image_url text,
  p_title text default null,
  p_display_duration_seconds integer default 10,
  p_sort_order integer default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_asset_type text default 'image',
  p_mime_type text default null,
  p_thumbnail_url text default null,
  p_media_duration_seconds numeric default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_sort int; v_type text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if not exists (select 1 from public.brand_accounts where id = p_brand_id and deleted_at is null) then raise exception 'brand not found'; end if;
  if coalesce(btrim(p_image_url),'') = '' then raise exception 'image_url required'; end if;
  -- asset_type 정규화: video 만 video, 그 외 전부 image
  v_type := case when lower(coalesce(p_asset_type,'image')) = 'video' then 'video' else 'image' end;
  v_sort := coalesce(p_sort_order, (select coalesce(max(sort_order),-1)+1 from public.brand_media_assets where brand_id=p_brand_id and deleted_at is null));
  insert into public.brand_media_assets
    (brand_id, asset_type, image_url, title, display_duration_seconds, sort_order, starts_at, ends_at,
     mime_type, thumbnail_url, media_duration_seconds)
  values
    (p_brand_id, v_type, btrim(p_image_url), nullif(btrim(p_title),''),
     greatest(1, least(coalesce(p_display_duration_seconds,10), 600)), v_sort, p_starts_at, p_ends_at,
     nullif(btrim(p_mime_type),''), nullif(btrim(p_thumbnail_url),''),
     case when v_type='video' and p_media_duration_seconds is not null and p_media_duration_seconds > 0
          then p_media_duration_seconds else null end)
  returning id into v_id;
  perform public._brand_audit(p_brand_id, 'brand.media_add', jsonb_build_object('asset_id', v_id, 'asset_type', v_type));
  return jsonb_build_object('success', true, 'id', v_id, 'sort_order', v_sort, 'asset_type', v_type);
end$$;
revoke execute on function public.admin_add_brand_media(uuid,text,text,integer,integer,timestamptz,timestamptz,text,text,text,numeric) from public, anon;
grant  execute on function public.admin_add_brand_media(uuid,text,text,integer,integer,timestamptz,timestamptz,text,text,text,numeric) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- D. get_brand_player_config — media 에 asset_type/mime/thumbnail/길이 추가
--    (0452 의 signage 확장 그대로 유지)
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
end$$;
revoke execute on function public.get_brand_player_config(uuid, text) from public, anon;
grant  execute on function public.get_brand_player_config(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- E. admin_get_brand — media 에 mime/thumbnail/길이 추가 (asset_type 는 기존 포함)
--    (0452 의 signage 확장 그대로 유지)
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
        select id, asset_type, title, image_url, display_duration_seconds, sort_order, starts_at, ends_at, status, created_at,
               mime_type, thumbnail_url, media_duration_seconds
        from public.brand_media_assets where brand_id = p_id and deleted_at is null) m),
    'signage', public._brand_signage_json(p_id)
  ) into v;
  if v->'brand' is null then raise exception 'brand not found'; end if;
  return v;
end$$;
revoke execute on function public.admin_get_brand(uuid) from public, anon;
grant  execute on function public.admin_get_brand(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- F. Storage 'brand-media' 버킷 — video 허용 + 용량 상향
--    롤백: allowed_mime_types 를 image 3종, file_size_limit 를 10MB(10485760) 로 되돌린다.
-- ─────────────────────────────────────────────────────────────────────
update storage.buckets
   set allowed_mime_types = array[
         'image/jpeg','image/png','image/webp','image/gif',
         'video/mp4','video/webm','video/quicktime'],
       file_size_limit = 52428800  -- 50MB (video)
 where id = 'brand-media';
