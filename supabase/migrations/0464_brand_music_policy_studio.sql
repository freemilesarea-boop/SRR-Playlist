-- ============================================================================
-- 0464_brand_music_policy_studio.sql
-- Phase BRAND-MUSIC-POLICY-STUDIO-1 — 브랜드별 음악 정책 "스튜디오".
--
-- 목적: 관리자가 브랜드마다 (a) 업종 기본 정책 상속 / (b) 브랜드 커스텀 정책 을
--   선택하고, 허용 장르 whitelist · 차단 장르/무드 · 보컬 정책 · 에너지/BPM 범위 를
--   설정하되, 업종(스터디카페 등)의 하드 정책은 절대 완화할 수 없도록 계층 병합한다.
--
-- 절대 불변식 (spec):
--   • 업종 하드 정책(스터디카페 strict)은 브랜드 설정보다 항상 우선 — 브랜드가 완화 불가.
--   • 정책 없는 기존 브랜드 동작 무변경 (모든 신규 필터는 값이 없으면 no-op).
--   • 0463 의 study_cafe 하드필터 graft 및 0455 본문 로직 100% 보존.
--   • Production DB 는 이 마이그레이션 "적용" 시에만 바뀐다(코드는 순수 additive).
--
-- 구성:
--   A. brand_music_policies 컬럼 확장 (policy_mode/allowed_genres/bpm/updated_by 등) + 백필
--   B. _brand_generate_playlist 확장 (allowed_genres whitelist + BPM 범위 — 둘 다 미설정 시 no-op)
--   C. admin_upsert_brand_music_policy 확장 (신규 필드 + 검증 + study 클램프 + before/after 감사)
--   D. admin_preview_brand_music_policy (읽기전용 후보 수 미리보기 — 저장 전 폼값 override 지원)
--   E. grants / revokes
--   F. 진단(diagnostics)
-- ============================================================================

-- ============================================================================
-- A. 스키마 확장 — 전부 additive, 안전한 기본값. 기존 행 동작 보존을 위해 백필.
-- ============================================================================
alter table public.brand_music_policies
  add column if not exists policy_mode text not null default 'inherit',
  add column if not exists allowed_genres text[] not null default '{}'::text[],
  add column if not exists bpm_min int,
  add column if not exists bpm_max int,
  add column if not exists preferred_instruments text[] not null default '{}'::text[], -- 예약(악기 메타 데이터 확보 후 후속 Phase). 현재 UI 미노출.
  add column if not exists updated_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.brand_music_policies'::regclass and conname = 'brand_music_policies_policy_mode_chk'
  ) then
    alter table public.brand_music_policies
      add constraint brand_music_policies_policy_mode_chk check (policy_mode in ('inherit','custom'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.brand_music_policies'::regclass and conname = 'brand_music_policies_bpm_chk'
  ) then
    alter table public.brand_music_policies
      add constraint brand_music_policies_bpm_chk check (
        (bpm_min is null or (bpm_min >= 0 and bpm_min <= 300)) and
        (bpm_max is null or (bpm_max >= 0 and bpm_max <= 300)) and
        (bpm_min is null or bpm_max is null or bpm_min <= bpm_max)
      );
  end if;
end$$;

-- 백필: 기존에 커스텀 신호가 하나라도 있던 브랜드는 'custom' 으로 표기(현행 동작 보존).
-- (신규 컬럼 allowed_genres/bpm 은 기존 행 전부 비어있어 whitelist/BPM 필터는 no-op)
update public.brand_music_policies
set policy_mode = 'custom'
where policy_mode = 'inherit'
  and (
    coalesce(array_length(blocked_genres, 1), 0) > 0
    or coalesce(array_length(preferred_genres, 1), 0) > 0
    or coalesce(array_length(blocked_moods, 1), 0) > 0
    or coalesce(array_length(preferred_moods, 1), 0) > 0
    or energy_min is not null
    or energy_max is not null
    or coalesce(vocal_policy, 'any') <> 'any'
  );

-- ============================================================================
-- B. _brand_generate_playlist — 0463 본문 100% 보존 + 2개 additive 필터만 주입.
--    ① allowed_genres whitelist  (pol.allowed_genres 비었으면 통과 = no-op)
--    ② BPM 범위 필터            (pol.bpm_min/max null 이면 통과 = no-op)
--    → 정책 없는/미설정 브랜드는 동작 완전 동일. study graft/스코어링/다양화/정렬 불변.
-- ============================================================================
create or replace function public._brand_generate_playlist(p_brand_id uuid, p_limit integer default 200)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v jsonb; pol public.brand_music_policies%rowtype;
  v_blocked_g text[]; v_pref_g text[]; v_blocked_m text[]; v_pref_m text[];
  v_allowed_g text[]; -- 🆕 0464: 허용 장르 whitelist (비었으면 미적용)
  v_limit int := greatest(1, least(coalesce(p_limit,200), 500));
  v_seed text := to_char((now() at time zone 'Asia/Seoul')::date, 'YYYYMMDD') || ':' || p_brand_id::text;
  -- 0463: study_cafe 하드필터 graft — Production 기존 로직 100% 보존, study 게이트만 주입.
  v_industry text; v_is_study boolean;
begin
  select * into pol from public.brand_music_policies where brand_id = p_brand_id;
  -- 0463: store-type 판정. study_cafe 브랜드는 strict 하드필터(후보 부족 시에도 fallback 없음).
  select industry_type into v_industry from public.brand_accounts where id = p_brand_id;
  v_is_study := coalesce(public.normalize_store_label(v_industry),'') = 'study_cafe'
    or lower(btrim(coalesce(v_industry,''))) in ('study_cafe','스터디카페','스터디 카페','독서실','study cafe','studycafe');

  v_blocked_g := coalesce((select array_agg(distinct public._ai_norm_genre(g)) from unnest(coalesce(pol.blocked_genres,'{}')) g where public._ai_norm_genre(g) <> ''), '{}');
  v_pref_g    := coalesce((select array_agg(distinct public._ai_norm_genre(g)) from unnest(coalesce(pol.preferred_genres,'{}')) g where public._ai_norm_genre(g) <> ''), '{}');
  v_blocked_m := coalesce((select array_agg(distinct lower(btrim(m))) from unnest(coalesce(pol.blocked_moods,'{}')) m where btrim(m) <> ''), '{}');
  v_pref_m    := coalesce((select array_agg(distinct lower(btrim(m))) from unnest(coalesce(pol.preferred_moods,'{}')) m where btrim(m) <> ''), '{}');
  -- 🆕 0464: 허용 장르 whitelist. policy_mode='custom' 이고 값이 있을 때만 활성(그 외 '{}' = no-op).
  v_allowed_g := coalesce((select array_agg(distinct public._ai_norm_genre(g)) from unnest(coalesce(pol.allowed_genres,'{}')) g where public._ai_norm_genre(g) <> ''), '{}');

  with base as (
    select t.id, t.title, t.artist, t.genre, t.mood, t.audio_url, t.cover_url, t.duration, t.created_at,
           t.owner_user_id, t.instrumental, t.lyric_type, t.vocal_type, f.energy as feat_energy,
           coalesce(t.bpm, f.bpm) as feat_bpm, -- 🆕 0464: BPM 범위 필터용
           coalesce((select array_agg(distinct public._ai_norm_genre(z)) from unnest(array_remove(array[t.main_genre, t.genre] || coalesce(t.genre_tags,'{}'), null)) z where public._ai_norm_genre(z) <> ''), '{}') as norm_genres,
           lower(coalesce(t.mood,'') || ' ' || array_to_string(coalesce(t.mood_tags,'{}'),' ') || ' ' || array_to_string(coalesce(m.ai_moods,'{}'),' ')) as mood_blob
    from public.tracks t
    left join public.track_audio_features f on f.track_id = t.id
    left join public.track_ai_metadata m on m.track_id = t.id
    where t.audio_url is not null and length(btrim(t.audio_url)) > 0
      and t.cover_url is not null and length(btrim(t.cover_url)) > 0
      and (t.release_status = 'released' or t.release_status is null)
      and t.removed_at is null
      and (t.audio_health_status is null or t.audio_health_status in ('ok','unknown'))
      -- 0463: study_cafe strict hard-filter (fallback 없음). 그 외 업종은 조건이 항상 true → 무변경.
      and (not v_is_study or coalesce((public._study_cafe_track_eligible(t.id)->>'eligible')::boolean, false))
  ),
  filtered as (
    select b.*,
      (case when pol.vocal_policy = 'instrumental_only' then (b.instrumental is true or b.lyric_type = 'instrumental' or b.vocal_type = 'instrumental') else true end) as vocal_ok,
      (case when b.feat_energy is null then true else (pol.energy_min is null or b.feat_energy >= pol.energy_min) and (pol.energy_max is null or b.feat_energy <= pol.energy_max) end) as energy_ok,
      -- 🆕 0464: 허용 장르 whitelist(비었으면 통과). norm_genres 중 하나라도 허용목록에 있으면 통과.
      (array_length(v_allowed_g,1) is null or exists (select 1 from unnest(v_allowed_g) ag where ag = any(b.norm_genres))) as allowed_ok,
      -- 🆕 0464: BPM 범위(feat_bpm null 이면 통과 — 분석값 없는 곡은 배제하지 않음).
      (case when b.feat_bpm is null then true else (pol.bpm_min is null or b.feat_bpm >= pol.bpm_min) and (pol.bpm_max is null or b.feat_bpm <= pol.bpm_max) end) as bpm_ok,
      (exists (select 1 from unnest(v_blocked_g) bg where bg = any(b.norm_genres))) as blocked_g_hit,
      (exists (select 1 from unnest(v_blocked_m) bm where b.mood_blob like '%'||bm||'%')) as blocked_m_hit,
      (select count(*) from unnest(v_pref_g) pg where pg = any(b.norm_genres)) as pref_g_hits,
      (select count(*) from unnest(v_pref_m) pm where b.mood_blob like '%'||pm||'%') as pref_m_hits
    from base b
  ),
  eligible as (
    select f.*,
      (f.pref_g_hits*25 + f.pref_m_hits*15 + case when f.energy_ok then 5 else 0 end
        + case when pol.vocal_policy='prefer_instrumental' and (f.instrumental is true or f.lyric_type='instrumental') then 10 else 0 end)::numeric as score,
      ('x' || substr(md5(f.id::text || v_seed),1,8))::bit(32)::bigint as rot
    from filtered f
    where not f.blocked_g_hit and not f.blocked_m_hit and f.vocal_ok
      and f.allowed_ok and f.bpm_ok -- 🆕 0464
  ),
  diversified as (
    select e.*, row_number() over (partition by coalesce(lower(btrim(e.artist)), e.id::text) order by (case when e.energy_ok then 1 else 0 end) desc, e.score desc, e.rot) as artist_rank
    from eligible e
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'artist', d.artist, 'genre', d.genre, 'mood', d.mood, 'audio_url', d.audio_url, 'cover_url', d.cover_url, 'duration', d.duration, 'created_at', d.created_at)
           order by (case when d.energy_ok then 1 else 0 end) desc, d.score desc, d.rot), '[]'::jsonb) into v
  from diversified d where d.artist_rank <= 4 limit v_limit;
  return v;
end$function$;

revoke all on function public._brand_generate_playlist(uuid, integer) from public, anon;
grant execute on function public._brand_generate_playlist(uuid, integer) to service_role;

-- ============================================================================
-- C. admin_upsert_brand_music_policy — 신규 필드 + 검증 + study 클램프 + before/after 감사.
--    구 10-인자 함수를 drop 하고 확장 시그니처로 교체(named-arg 호출 모호성 방지).
--    구 프론트(10 named args)는 신규 필드가 default null → 하위호환 유지.
-- ============================================================================
drop function if exists public.admin_upsert_brand_music_policy(uuid, text[], text[], text[], text[], numeric, numeric, text, jsonb, boolean);

create or replace function public.admin_upsert_brand_music_policy(
  p_brand_id uuid,
  p_preferred_genres text[] default null,
  p_blocked_genres text[] default null,
  p_preferred_moods text[] default null,
  p_blocked_moods text[] default null,
  p_energy_min numeric default null,
  p_energy_max numeric default null,
  p_vocal_policy text default null,
  p_daypart_policy jsonb default null,
  p_auto_generate_enabled boolean default null,
  p_policy_mode text default null,          -- 🆕 'inherit' | 'custom'
  p_allowed_genres text[] default null,     -- 🆕 허용 장르 whitelist
  p_bpm_min int default null,               -- 🆕
  p_bpm_max int default null                -- 🆕
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_industry text; v_is_study boolean;
  v_mode text;
  v_before jsonb; v_after jsonb;
  v_warnings text[] := '{}';
  v_tax_genres text[];
  v_tax_moods text[];
  v_allowed text[]; v_blocked text[]; v_pref_g text[];
  v_bmoods text[]; v_pmoods text[];
  v_emin numeric; v_emax numeric; v_bmin int; v_bmax int; v_vocal text;
  v_bad text;
  STUDY_GENRES constant text[] := array['lofi','ambient','jazz'];
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if not exists (select 1 from public.brand_accounts where id = p_brand_id and deleted_at is null) then raise exception 'brand not found'; end if;

  select industry_type into v_industry from public.brand_accounts where id = p_brand_id;
  v_is_study := coalesce(public.normalize_store_label(v_industry),'') = 'study_cafe'
    or lower(btrim(coalesce(v_industry,''))) in ('study_cafe','스터디카페','스터디 카페','독서실','study cafe','studycafe');

  -- 행 보장 + before 스냅샷.
  insert into public.brand_music_policies (brand_id) values (p_brand_id) on conflict (brand_id) do nothing;
  select to_jsonb(bmp) into v_before from public.brand_music_policies bmp where brand_id = p_brand_id;

  v_mode := coalesce(p_policy_mode, v_before->>'policy_mode', 'inherit');
  if v_mode not in ('inherit','custom') then raise exception 'invalid policy_mode: %', v_mode; end if;
  if p_vocal_policy is not null and p_vocal_policy not in ('any','vocal_ok','prefer_instrumental','instrumental_only') then
    raise exception 'invalid vocal_policy';
  end if;

  -- 'inherit' 모드: 브랜드 커스텀 값을 전부 비워 업종 기본만 적용되게 한다(런타임은 빈 값=no-op).
  if v_mode = 'inherit' then
    update public.brand_music_policies set
      policy_mode = 'inherit',
      preferred_genres = '{}', blocked_genres = '{}', allowed_genres = '{}',
      preferred_moods = '{}', blocked_moods = '{}',
      energy_min = null, energy_max = null, bpm_min = null, bpm_max = null,
      vocal_policy = 'any',
      daypart_policy = coalesce(p_daypart_policy, daypart_policy),
      auto_generate_enabled = coalesce(p_auto_generate_enabled, auto_generate_enabled),
      updated_by = auth.uid(), updated_at = now()
    where brand_id = p_brand_id;
    select to_jsonb(bmp) into v_after from public.brand_music_policies bmp where brand_id = p_brand_id;
    perform public._brand_audit(p_brand_id, 'brand.policy_update',
      jsonb_build_object('policy_mode','inherit','before',v_before,'after',v_after));
    return jsonb_build_object('success', true, 'brand_id', p_brand_id, 'policy_mode', 'inherit', 'warnings', '[]'::jsonb);
  end if;

  -- ── custom 모드: 값 병합(미전달 필드는 기존값 유지) ──────────────────────
  v_allowed := coalesce(p_allowed_genres, (select allowed_genres from public.brand_music_policies where brand_id = p_brand_id));
  v_blocked := coalesce(p_blocked_genres, (select blocked_genres from public.brand_music_policies where brand_id = p_brand_id));
  v_pref_g  := coalesce(p_preferred_genres, (select preferred_genres from public.brand_music_policies where brand_id = p_brand_id));
  v_bmoods  := coalesce(p_blocked_moods, (select blocked_moods from public.brand_music_policies where brand_id = p_brand_id));
  v_pmoods  := coalesce(p_preferred_moods, (select preferred_moods from public.brand_music_policies where brand_id = p_brand_id));
  v_emin    := coalesce(p_energy_min, (select energy_min from public.brand_music_policies where brand_id = p_brand_id));
  v_emax    := coalesce(p_energy_max, (select energy_max from public.brand_music_policies where brand_id = p_brand_id));
  v_bmin    := coalesce(p_bpm_min, (select bpm_min from public.brand_music_policies where brand_id = p_brand_id));
  v_bmax    := coalesce(p_bpm_max, (select bpm_max from public.brand_music_policies where brand_id = p_brand_id));
  v_vocal   := coalesce(p_vocal_policy, (select vocal_policy from public.brand_music_policies where brand_id = p_brand_id), 'any');

  v_allowed := coalesce((select array_agg(distinct lower(btrim(x))) from unnest(v_allowed) x where btrim(x) <> ''), '{}');
  v_blocked := coalesce((select array_agg(distinct lower(btrim(x))) from unnest(v_blocked) x where btrim(x) <> ''), '{}');
  v_pref_g  := coalesce((select array_agg(distinct lower(btrim(x))) from unnest(v_pref_g) x where btrim(x) <> ''), '{}');
  v_bmoods  := coalesce((select array_agg(distinct lower(btrim(x))) from unnest(v_bmoods) x where btrim(x) <> ''), '{}');
  v_pmoods  := coalesce((select array_agg(distinct lower(btrim(x))) from unnest(v_pmoods) x where btrim(x) <> ''), '{}');

  -- 분류체계(taxonomy) 소속 검증 — 사용자 정의 슬러그 방지.
  select array_agg(slug) into v_tax_genres from public.taxonomy_genres;
  select array_agg(slug) into v_tax_moods from public.taxonomy_moods;

  select x into v_bad from unnest(v_allowed) x where x <> all(v_tax_genres) limit 1;
  if v_bad is not null then raise exception 'unknown genre in allowed_genres: %', v_bad; end if;
  select x into v_bad from unnest(v_blocked) x where x <> all(v_tax_genres) limit 1;
  if v_bad is not null then raise exception 'unknown genre in blocked_genres: %', v_bad; end if;
  select x into v_bad from unnest(v_pref_g) x where x <> all(v_tax_genres) limit 1;
  if v_bad is not null then raise exception 'unknown genre in preferred_genres: %', v_bad; end if;
  select x into v_bad from unnest(v_bmoods) x where x <> all(v_tax_moods) limit 1;
  if v_bad is not null then raise exception 'unknown mood in blocked_moods: %', v_bad; end if;
  select x into v_bad from unnest(v_pmoods) x where x <> all(v_tax_moods) limit 1;
  if v_bad is not null then raise exception 'unknown mood in preferred_moods: %', v_bad; end if;

  -- 구조적 충돌 → 하드 거부.
  if exists (select 1 from unnest(v_allowed) a where a = any(v_blocked)) then
    raise exception 'allowed_genres and blocked_genres overlap';
  end if;
  if v_emin is not null and (v_emin < 0 or v_emin > 1) then raise exception 'energy_min out of range (0..1)'; end if;
  if v_emax is not null and (v_emax < 0 or v_emax > 1) then raise exception 'energy_max out of range (0..1)'; end if;
  if v_emin is not null and v_emax is not null and v_emin > v_emax then raise exception 'energy_min > energy_max'; end if;
  if v_bmin is not null and (v_bmin < 0 or v_bmin > 300) then raise exception 'bpm_min out of range (0..300)'; end if;
  if v_bmax is not null and (v_bmax < 0 or v_bmax > 300) then raise exception 'bpm_max out of range (0..300)'; end if;
  if v_bmin is not null and v_bmax is not null and v_bmin > v_bmax then raise exception 'bpm_min > bpm_max'; end if;

  -- ── 업종 하드 클램프(스터디카페): 완화 불가 필드는 조용히 클램프 + warnings 안내 ──
  if v_is_study then
    -- 허용 장르는 study 허용집합으로 교집합(비면 study 기본 3종으로 대체는 preview/effective 에서 처리).
    if array_length(v_allowed,1) is not null then
      declare v_keep text[]; begin
        select coalesce(array_agg(a),'{}') into v_keep from unnest(v_allowed) a where a = any(STUDY_GENRES);
        if v_keep <> v_allowed then v_warnings := array_append(v_warnings, 'allowed_genres_clamped_to_study'); end if;
        v_allowed := v_keep;
      end;
    end if;
    if v_vocal <> 'instrumental_only' then v_warnings := array_append(v_warnings, 'vocal_forced_instrumental_only'); v_vocal := 'instrumental_only'; end if;
    if v_emax is null or v_emax > 0.5 then
      if v_emax is not null and v_emax > 0.5 then v_warnings := array_append(v_warnings, 'energy_max_clamped_0.5'); end if;
      v_emax := least(coalesce(v_emax, 0.5), 0.5);
    end if;
    if v_bmax is null or v_bmax > 110 then
      if v_bmax is not null and v_bmax > 110 then v_warnings := array_append(v_warnings, 'bpm_max_clamped_110'); end if;
      v_bmax := least(coalesce(v_bmax, 110), 110);
    end if;
    if v_emin is not null and v_emin > v_emax then v_emin := v_emax; end if;
    if v_bmin is not null and v_bmax is not null and v_bmin > v_bmax then v_bmin := v_bmax; end if;
  end if;

  update public.brand_music_policies set
    policy_mode = 'custom',
    preferred_genres = v_pref_g,
    blocked_genres = v_blocked,
    allowed_genres = v_allowed,
    preferred_moods = v_pmoods,
    blocked_moods = v_bmoods,
    energy_min = v_emin, energy_max = v_emax,
    bpm_min = v_bmin, bpm_max = v_bmax,
    vocal_policy = v_vocal,
    daypart_policy = coalesce(p_daypart_policy, daypart_policy),
    auto_generate_enabled = coalesce(p_auto_generate_enabled, auto_generate_enabled),
    updated_by = auth.uid(), updated_at = now()
  where brand_id = p_brand_id;

  select to_jsonb(bmp) into v_after from public.brand_music_policies bmp where brand_id = p_brand_id;
  perform public._brand_audit(p_brand_id, 'brand.policy_update',
    jsonb_build_object('policy_mode','custom','warnings',to_jsonb(v_warnings),'before',v_before,'after',v_after));

  return jsonb_build_object('success', true, 'brand_id', p_brand_id, 'policy_mode', 'custom', 'warnings', to_jsonb(v_warnings));
end$function$;

revoke all on function public.admin_upsert_brand_music_policy(uuid, text[], text[], text[], text[], numeric, numeric, text, jsonb, boolean, text, text[], int, int) from public, anon;
grant execute on function public.admin_upsert_brand_music_policy(uuid, text[], text[], text[], text[], numeric, numeric, text, jsonb, boolean, text, text[], int, int) to authenticated, service_role;

-- ============================================================================
-- D. admin_preview_brand_music_policy — 저장 전 후보 수 미리보기(읽기전용, 민감정보 없음).
--    런타임(_brand_generate_playlist)과 동일한 필터를 카운트로 재현.
--    p_overrides(jsonb)로 미저장 폼값을 반영해 "저장하면 몇 곡 남는가"를 계산.
--    반환: total / industry_pass / eligible / block-reason 카운트 + 허용 장르 분포(수치만).
-- ============================================================================
create or replace function public.admin_preview_brand_music_policy(
  p_brand_id uuid,
  p_overrides jsonb default null
) returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  pol public.brand_music_policies%rowtype;
  v_industry text; v_is_study boolean;
  v_mode text;
  v_blocked_g text[]; v_pref_g text[]; v_blocked_m text[]; v_allowed_g text[];
  v_vocal text; v_emin numeric; v_emax numeric; v_bmin int; v_bmax int;
  o jsonb := coalesce(p_overrides, '{}'::jsonb);
  v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if not exists (select 1 from public.brand_accounts where id = p_brand_id and deleted_at is null) then raise exception 'brand not found'; end if;

  select * into pol from public.brand_music_policies where brand_id = p_brand_id;
  select industry_type into v_industry from public.brand_accounts where id = p_brand_id;
  v_is_study := coalesce(public.normalize_store_label(v_industry),'') = 'study_cafe'
    or lower(btrim(coalesce(v_industry,''))) in ('study_cafe','스터디카페','스터디 카페','독서실','study cafe','studycafe');

  -- override 우선, 없으면 저장값. policy_mode='inherit' 이면 커스텀 필터는 전부 무시.
  v_mode := coalesce(o->>'policy_mode', pol.policy_mode, 'inherit');
  if v_mode = 'inherit' then
    v_allowed_g := '{}'; v_blocked_g := '{}'; v_pref_g := '{}'; v_blocked_m := '{}';
    v_vocal := 'any'; v_emin := null; v_emax := null; v_bmin := null; v_bmax := null;
  else
    v_allowed_g := coalesce(
      case when o ? 'allowed_genres' then array(select jsonb_array_elements_text(o->'allowed_genres')) else pol.allowed_genres end, '{}');
    v_blocked_g := coalesce(
      case when o ? 'blocked_genres' then array(select jsonb_array_elements_text(o->'blocked_genres')) else pol.blocked_genres end, '{}');
    v_pref_g := coalesce(
      case when o ? 'preferred_genres' then array(select jsonb_array_elements_text(o->'preferred_genres')) else pol.preferred_genres end, '{}');
    v_blocked_m := coalesce(
      case when o ? 'blocked_moods' then array(select jsonb_array_elements_text(o->'blocked_moods')) else pol.blocked_moods end, '{}');
    v_vocal := coalesce(o->>'vocal_policy', pol.vocal_policy, 'any');
    v_emin := coalesce((o->>'energy_min')::numeric, pol.energy_min);
    v_emax := coalesce((o->>'energy_max')::numeric, pol.energy_max);
    v_bmin := coalesce((o->>'bpm_min')::int, pol.bpm_min);
    v_bmax := coalesce((o->>'bpm_max')::int, pol.bpm_max);
  end if;

  -- 정규화(런타임과 동일).
  v_allowed_g := coalesce((select array_agg(distinct public._ai_norm_genre(g)) from unnest(v_allowed_g) g where public._ai_norm_genre(g) <> ''), '{}');
  v_blocked_g := coalesce((select array_agg(distinct public._ai_norm_genre(g)) from unnest(v_blocked_g) g where public._ai_norm_genre(g) <> ''), '{}');
  v_blocked_m := coalesce((select array_agg(distinct lower(btrim(m))) from unnest(v_blocked_m) m where btrim(m) <> ''), '{}');

  with base as (
    select t.id, t.instrumental, t.lyric_type, t.vocal_type,
           f.energy as feat_energy, coalesce(t.bpm, f.bpm) as feat_bpm,
           coalesce((select array_agg(distinct public._ai_norm_genre(z)) from unnest(array_remove(array[t.main_genre, t.genre] || coalesce(t.genre_tags,'{}'), null)) z where public._ai_norm_genre(z) <> ''), '{}') as norm_genres,
           lower(coalesce(t.mood,'') || ' ' || array_to_string(coalesce(t.mood_tags,'{}'),' ') || ' ' || array_to_string(coalesce(m.ai_moods,'{}'),' ')) as mood_blob,
           (not v_is_study or coalesce((public._study_cafe_track_eligible(t.id)->>'eligible')::boolean, false)) as industry_ok
    from public.tracks t
    left join public.track_audio_features f on f.track_id = t.id
    left join public.track_ai_metadata m on m.track_id = t.id
    where t.audio_url is not null and length(btrim(t.audio_url)) > 0
      and t.cover_url is not null and length(btrim(t.cover_url)) > 0
      and (t.release_status = 'released' or t.release_status is null)
      and t.removed_at is null
      and (t.audio_health_status is null or t.audio_health_status in ('ok','unknown'))
  ),
  scored as (
    select b.*,
      (case when v_vocal = 'instrumental_only' then (b.instrumental is true or b.lyric_type = 'instrumental' or b.vocal_type = 'instrumental') else true end) as vocal_ok,
      (case when b.feat_energy is null then true else (v_emin is null or b.feat_energy >= v_emin) and (v_emax is null or b.feat_energy <= v_emax) end) as energy_ok,
      (array_length(v_allowed_g,1) is null or exists (select 1 from unnest(v_allowed_g) ag where ag = any(b.norm_genres))) as allowed_ok,
      (case when b.feat_bpm is null then true else (v_bmin is null or b.feat_bpm >= v_bmin) and (v_bmax is null or b.feat_bpm <= v_bmax) end) as bpm_ok,
      (exists (select 1 from unnest(v_blocked_g) bg where bg = any(b.norm_genres))) as blocked_g_hit,
      (exists (select 1 from unnest(v_blocked_m) bm where b.mood_blob like '%'||bm||'%')) as blocked_m_hit
    from base b
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'industry_pass', (select count(*) from base where industry_ok),
    'eligible', (select count(*) from scored where industry_ok and not blocked_g_hit and not blocked_m_hit and vocal_ok and energy_ok and allowed_ok and bpm_ok),
    'blocked_by', jsonb_build_object(
      'industry', (select count(*) from base where not industry_ok),
      'genre_block', (select count(*) from scored where industry_ok and blocked_g_hit),
      'genre_not_allowed', (select count(*) from scored where industry_ok and not blocked_g_hit and not allowed_ok),
      'mood_block', (select count(*) from scored where industry_ok and blocked_m_hit),
      'vocal', (select count(*) from scored where industry_ok and not vocal_ok),
      'energy', (select count(*) from scored where industry_ok and not energy_ok),
      'bpm', (select count(*) from scored where industry_ok and not bpm_ok)
    ),
    'is_study', v_is_study,
    'policy_mode', v_mode
  ) into v;
  return v;
end$function$;

revoke all on function public.admin_preview_brand_music_policy(uuid, jsonb) from public, anon;
grant execute on function public.admin_preview_brand_music_policy(uuid, jsonb) to authenticated, service_role;

-- ============================================================================
-- E2. admin_get_brand — 읽기 경로에 신규 정책 컬럼 노출(스튜디오 폼 prefill).
--    기존 본문 100% 보존 + policy 서브셀렉트에 4개 컬럼만 additive 로 추가.
--    (policy_mode / allowed_genres / bpm_min / bpm_max — 나머지 로직/컬럼 불변)
-- ============================================================================
create or replace function public.admin_get_brand(p_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select jsonb_build_object(
    'brand', (select row_to_json(b) from (
        select id, name, status, industry_type, description, code_hint, created_at, updated_at, deleted_at
        from public.brand_accounts where id = p_id) b),
    'policy', (select row_to_json(p) from (
        select brand_id, preferred_genres, blocked_genres, preferred_moods, blocked_moods,
               energy_min, energy_max, vocal_policy, daypart_policy, auto_generate_enabled,
               policy_mode, allowed_genres, bpm_min, bpm_max
        from public.brand_music_policies where brand_id = p_id) p),
    'media', (select coalesce(jsonb_agg(row_to_json(m) order by (m).sort_order, (m).created_at), '[]'::jsonb) from (
        select id, asset_type, title, image_url, display_duration_seconds, sort_order, starts_at, ends_at, status, created_at,
               mime_type, thumbnail_url, media_duration_seconds
        from public.brand_media_assets where brand_id = p_id and deleted_at is null) m),
    'signage', public._brand_signage_json(p_id)
  ) into v;
  if v->'brand' is null then raise exception 'brand not found'; end if;
  return v;
end$function$;

-- ============================================================================
-- F. 진단(diagnostics) — 적용 후 즉시 확인용(무해).
-- ============================================================================
do $$
declare n_cols int; n_fn int;
begin
  select count(*) into n_cols from information_schema.columns
    where table_schema='public' and table_name='brand_music_policies'
      and column_name in ('policy_mode','allowed_genres','bpm_min','bpm_max','updated_by','preferred_instruments');
  select count(*) into n_fn from pg_proc
    where proname in ('admin_upsert_brand_music_policy','admin_preview_brand_music_policy','_brand_generate_playlist');
  raise notice '[0464] brand_music_policies 신규 컬럼 %/6, 대상 함수 % 개', n_cols, n_fn;
end$$;
