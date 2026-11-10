-- 0541_hq_brand_content_requests.sql
--
-- 본사(엔터프라이즈)가 자기 브랜드의 음악·매장 화면 광고·안내방송을 직접 바꾼다 — 단, 우리 검수 후 반영.
--
-- 왜
--   지금은 운영사가 관리자 페이지에서 대신 바꿔 준다. 본사가 원할 때 바로 요청하고,
--   우리는 검수만 하면 되게 한다(내용·저작권 사고 방지).
--
-- 흐름
--   본사: hq_submit_content_request(kind, payload) → hq_content_requests(pending)
--   관리자: admin_review_hq_content_request(id, 승인/반려) → 승인 시 기존 admin_* RPC 로 그대로 적용
--   결과는 본사 알림센터(enterprise_notifications)로 알린다.
--
-- 함께 고치는 것
--   · 안내방송 '본사 전체' 범위 일정이 다른 본사 매장까지 나가던 문제(0389 store_get_*_announcements).
--     지금까지 이 범위 일정이 0건이라 실제 오송출은 없었다.
--   · 음악 미리듣기 계산을 내부 함수로 분리해 본사 미리듣기에서도 쓴다(관리자 동작 동일).

-- ============================================================================
-- 1) 매장 ↔ 본사 소속 판정 + 안내방송 범위 버그 수정
-- ============================================================================
create or replace function public._store_in_enterprise(p_store_id uuid, p_ea_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select p_store_id is not null and p_ea_id is not null and (
    exists (select 1 from public.franchise_stores fs
              join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id and ef.deleted_at is null
             where fs.store_id = p_store_id and ef.enterprise_account_id = p_ea_id)
    or exists (select 1 from public.brand_player_sessions bps
                where bps.user_id = p_store_id and bps.enterprise_account_id = p_ea_id
                  and bps.revoked_at is null and (bps.expires_at is null or bps.expires_at > now()))
  );
$$;
revoke all on function public._store_in_enterprise(uuid, uuid) from public, anon, authenticated;

create or replace function public.store_get_upcoming_announcements(
  p_store_id          uuid default null,
  p_lookahead_seconds int  default 900
) returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_uid         uuid := coalesce(p_store_id, auth.uid());
  v_now         timestamptz := now();
  v_today_start timestamptz;
  v_recovery    int := 900;
  v_lookahead   int := least(greatest(coalesce(p_lookahead_seconds, 900), 60), 3600);
  v_horizon     timestamptz;
  v_results     jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if v_uid <> auth.uid() and not public._is_super_admin() then raise exception 'forbidden'; end if;

  v_today_start := ((v_now at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul';
  v_horizon     := v_now + make_interval(secs => v_lookahead);

  with base as (
    select s.id as schedule_id, s.asset_id, s.name as schedule_name, s.play_mode,
           s.max_plays_per_day, coalesce(s.timezone, 'Asia/Seoul') as tz,
           public._announcement_next_occurrence(
             s.recurrence_rule, s.starts_at, s.ends_at, v_now,
             coalesce(s.timezone, 'Asia/Seoul'), v_recovery
           ) as scheduled_at,
           a.title     as asset_title,
           a.file_url  as asset_file_url,
           a.file_path as asset_file_path,
           a.duration_seconds as asset_duration, a.mime_type as asset_mime_type,
           (select count(*) from public.enterprise_announcement_play_logs pl
             where pl.schedule_id = s.id and pl.store_id = v_uid
               and pl.played_at >= v_today_start and pl.status = 'played')::int as today_count,
           (select max(pl.played_at) from public.enterprise_announcement_play_logs pl
             where pl.schedule_id = s.id and pl.store_id = v_uid and pl.status = 'played') as last_played_at
      from public.enterprise_announcement_schedules s
      join public.enterprise_announcement_assets a
        on a.id = s.asset_id and a.deleted_at is null and a.status = 'active'
     where s.deleted_at is null and s.status = 'active'
       and (
         (s.scope_type = 'enterprise' and (s.enterprise_account_id is null
              or public._store_in_enterprise(v_uid, s.enterprise_account_id)))
         or (s.scope_type = 'region' and exists (
              select 1 from public.store_policy_sync_status sps
               where sps.store_id = v_uid and sps.enterprise_region_id = s.region_id))
         or (s.scope_type = 'store' and v_uid = any(s.scope_store_ids))
       )
  ),
  eligible as (
    select b.*,
           b.schedule_id::text || ':' ||
           to_char(b.scheduled_at at time zone b.tz, 'YYYY-MM-DD:HH24:MI') as occurrence_key
      from base b
     where b.scheduled_at is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'schedule_id',       e.schedule_id,
           'asset_id',          e.asset_id,
           'schedule_name',     e.schedule_name,
           'asset_title',       e.asset_title,
           'asset_file_url',    e.asset_file_url,
           'asset_file_path',   e.asset_file_path,
           'asset_duration',    e.asset_duration,
           'asset_mime_type',   e.asset_mime_type,
           'play_mode',         e.play_mode,
           'today_count',       e.today_count,
           'max_plays_per_day', e.max_plays_per_day,
           'last_played_at',    e.last_played_at,
           'scheduled_at',      e.scheduled_at,
           'occurrence_key',    e.occurrence_key
         ) order by e.scheduled_at), '[]'::jsonb)
    into v_results
    from eligible e
   where e.scheduled_at <= v_horizon
     and e.today_count < e.max_plays_per_day
     and not exists (
       select 1 from public.enterprise_announcement_play_logs pl
        where pl.schedule_id = e.schedule_id and pl.store_id = v_uid
          and pl.occurrence_key = e.occurrence_key
          and pl.status in ('played','started','failed')
     );

  return jsonb_build_object(
    'success', true, 'store_id', v_uid, 'now_at', v_now,
    'lookahead_seconds', v_lookahead, 'data', v_results
  );
end;
$$;

create or replace function public.store_get_due_announcements(
  p_store_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_uid          uuid := coalesce(p_store_id, auth.uid());
  v_now          timestamptz := now();
  v_today_start  timestamptz;
  v_results      jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if v_uid <> auth.uid() and not public._is_super_admin() then raise exception 'forbidden'; end if;

  v_today_start := ((v_now at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul';

  with base as (
    select s.id as schedule_id, s.asset_id, s.name as schedule_name, s.play_mode,
           s.max_plays_per_day, coalesce(s.timezone, 'Asia/Seoul') as tz,
           public._announcement_next_occurrence(
             s.recurrence_rule, s.starts_at, s.ends_at, v_now,
             coalesce(s.timezone, 'Asia/Seoul'), 900
           ) as scheduled_at,
           a.title     as asset_title,
           a.file_url  as asset_file_url,
           a.file_path as asset_file_path,
           a.duration_seconds as asset_duration, a.mime_type as asset_mime_type,
           (select count(*) from public.enterprise_announcement_play_logs pl
             where pl.schedule_id = s.id and pl.store_id = v_uid
               and pl.played_at >= v_today_start and pl.status = 'played')::int as today_count,
           (select max(pl.played_at) from public.enterprise_announcement_play_logs pl
             where pl.schedule_id = s.id and pl.store_id = v_uid and pl.status = 'played') as last_played_at
      from public.enterprise_announcement_schedules s
      join public.enterprise_announcement_assets a
        on a.id = s.asset_id and a.deleted_at is null and a.status = 'active'
     where s.deleted_at is null and s.status = 'active'
       and public._announcement_is_due_now(s.recurrence_rule, s.starts_at, s.ends_at, v_now, coalesce(s.timezone, 'Asia/Seoul'))
       and (
         (s.scope_type = 'enterprise' and (s.enterprise_account_id is null
              or public._store_in_enterprise(v_uid, s.enterprise_account_id)))
         or (s.scope_type = 'region' and exists (
              select 1 from public.store_policy_sync_status sps
               where sps.store_id = v_uid and sps.enterprise_region_id = s.region_id))
         or (s.scope_type = 'store' and v_uid = any(s.scope_store_ids))
       )
  ),
  eligible as (
    select b.*,
           case when b.scheduled_at is null then null
                else b.schedule_id::text || ':' ||
                     to_char(b.scheduled_at at time zone b.tz, 'YYYY-MM-DD:HH24:MI') end as occurrence_key
      from base b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'schedule_id',     e.schedule_id,
           'asset_id',        e.asset_id,
           'schedule_name',   e.schedule_name,
           'asset_title',     e.asset_title,
           'asset_file_url',  e.asset_file_url,
           'asset_file_path', e.asset_file_path,
           'asset_duration',  e.asset_duration,
           'asset_mime_type', e.asset_mime_type,
           'play_mode',       e.play_mode,
           'today_count',     e.today_count,
           'max_plays_per_day', e.max_plays_per_day,
           'last_played_at',  e.last_played_at,
           'scheduled_at',    e.scheduled_at,
           'occurrence_key',  e.occurrence_key
         ) order by e.schedule_id), '[]'::jsonb)
    into v_results
    from eligible e
   where e.today_count < e.max_plays_per_day
     and (e.last_played_at is null or e.last_played_at < (v_now - interval '5 minutes'))
     and (
       e.occurrence_key is null
       or not exists (
         select 1 from public.enterprise_announcement_play_logs pl
          where pl.schedule_id = e.schedule_id and pl.store_id = v_uid
            and pl.occurrence_key = e.occurrence_key
            and pl.status in ('played','started','failed')
       )
     );

  return jsonb_build_object(
    'success', true, 'store_id', v_uid, 'now_at', v_now, 'data', v_results
  );
end;
$$;

-- ============================================================================
-- 1b) 음악 미리듣기 계산 — 관리자/본사 공용 내부 함수
-- ============================================================================
create or replace function public._brand_preview_music_policy(
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
revoke all on function public._brand_preview_music_policy(uuid, jsonb) from public, anon, authenticated;

create or replace function public.admin_preview_brand_music_policy(
  p_brand_id uuid,
  p_overrides jsonb default null
) returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  return public._brand_preview_music_policy(p_brand_id, p_overrides);
end$function$;

-- ============================================================================
-- 2) 본사 콘텐츠 변경 요청 (검수 후 반영)
-- ============================================================================
create table if not exists public.hq_content_requests (
  id uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null references public.enterprise_accounts(id) on delete cascade,
  brand_id uuid references public.brand_accounts(id) on delete set null,
  kind text not null check (kind in (
    'music_policy', 'playback_policy',
    'media_add', 'media_update', 'media_delete',
    'announcement_asset_add', 'announcement_asset_delete',
    'schedule_create', 'schedule_update', 'schedule_delete')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled', 'superseded')),
  requested_by uuid,
  hq_note text,
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  applied_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_hq_content_requests_status on public.hq_content_requests (status, created_at desc);
create index if not exists idx_hq_content_requests_ea on public.hq_content_requests (enterprise_account_id, created_at desc);

alter table public.hq_content_requests enable row level security;
revoke all on public.hq_content_requests from anon, authenticated;

-- 본사 업로드 — 검수 전 파일은 hq/<본사 id>/ 아래에만 올릴 수 있다(덮어쓰기·삭제 불가).
-- 승인되면 같은 파일을 그대로 매장에 쓴다(복사 없음).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'brand_media_hq_upload') then
    create policy brand_media_hq_upload on storage.objects for insert to authenticated
      with check (
        bucket_id = 'brand-media'
        and (storage.foldername(name))[1] = 'hq'
        and (storage.foldername(name))[2] = public._hq_current_enterprise_account_id()::text
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                  and policyname = 'enterprise_announcements_hq_upload') then
    create policy enterprise_announcements_hq_upload on storage.objects for insert to authenticated
      with check (
        bucket_id = 'enterprise-announcements'
        and (storage.foldername(name))[1] = 'hq'
        and (storage.foldername(name))[2] = public._hq_current_enterprise_account_id()::text
      );
  end if;
end;
$$;

-- 본사의 브랜드 플레이어(본사당 활성 1개).
create or replace function public._hq_my_brand_id(p_ea_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select b.id from public.brand_accounts b
   where b.enterprise_account_id = p_ea_id and b.deleted_at is null
   order by (b.status = 'active') desc, b.created_at
   limit 1;
$$;
revoke all on function public._hq_my_brand_id(uuid) from public, anon, authenticated;

-- 요청 내용 검증 — 제출 때와 승인 때 두 번 돈다(그 사이 대상이 지워졌거나 범위가 바뀌었을 수 있다).
-- 본사 소유가 아닌 브랜드·미디어·음원·일정·지역·매장은 절대 건드릴 수 없다.
create or replace function public._hq_validate_content_request(p_ea_id uuid, p_kind text, p_payload jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_brand uuid := public._hq_my_brand_id(p_ea_id);
  v_prefix text := 'hq/' || p_ea_id::text || '/';
  v_scope text;
  v_rule text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload';
  end if;
  if p_kind in ('music_policy', 'playback_policy', 'media_add', 'media_update', 'media_delete') and v_brand is null then
    raise exception 'no_brand: 연결된 브랜드 플레이어가 없습니다';
  end if;

  if p_kind = 'music_policy' then
    if coalesce(p_payload->>'policy_mode', '') not in ('inherit', 'custom') then
      raise exception 'invalid_policy_mode';
    end if;
    if p_payload->>'vocal_policy' is not null
       and p_payload->>'vocal_policy' not in ('any', 'vocal_ok', 'prefer_instrumental', 'instrumental_only') then
      raise exception 'invalid_vocal_policy';
    end if;

  elsif p_kind = 'playback_policy' then
    if coalesce(p_payload->>'playback_mode', '') not in ('always_on', 'business_hours') then
      raise exception 'invalid_playback_mode';
    end if;
    if p_payload->>'playback_mode' = 'business_hours' then
      if p_payload->>'open_time' is null or p_payload->>'close_time' is null then
        raise exception '영업시간 모드는 시작/종료 시각이 필요합니다.';
      end if;
      perform (p_payload->>'open_time')::time, (p_payload->>'close_time')::time;
    end if;

  elsif p_kind = 'media_add' then
    if coalesce(p_payload->>'file_path', '') not like v_prefix || '%'
       or position(p_payload->>'file_path' in coalesce(p_payload->>'url', '')) = 0 then
      raise exception 'invalid_file';
    end if;
    if coalesce(p_payload->>'asset_type', 'image') not in ('image', 'video') then
      raise exception 'invalid_asset_type';
    end if;

  elsif p_kind in ('media_update', 'media_delete') then
    if not exists (select 1 from public.brand_media_assets m
                    where m.id = (p_payload->>'asset_id')::uuid and m.brand_id = v_brand and m.deleted_at is null) then
      raise exception 'media_not_found';
    end if;
    if p_kind = 'media_update' and p_payload->>'status' is not null
       and p_payload->>'status' not in ('active', 'inactive') then
      raise exception 'invalid_status';
    end if;

  elsif p_kind = 'announcement_asset_add' then
    if nullif(btrim(coalesce(p_payload->>'title', '')), '') is null then
      raise exception 'title_required';
    end if;
    if coalesce(p_payload->>'file_path', '') not like v_prefix || '%'
       or position(p_payload->>'file_path' in coalesce(p_payload->>'file_url', '')) = 0 then
      raise exception 'invalid_file';
    end if;

  elsif p_kind = 'announcement_asset_delete' then
    if not exists (select 1 from public.enterprise_announcement_assets a
                    where a.id = (p_payload->>'asset_id')::uuid and a.enterprise_account_id = p_ea_id
                      and a.deleted_at is null) then
      raise exception 'asset_not_found';
    end if;

  elsif p_kind in ('schedule_create', 'schedule_update') then
    if p_kind = 'schedule_update' then
      if not exists (select 1 from public.enterprise_announcement_schedules s
                      where s.id = (p_payload->>'schedule_id')::uuid and s.enterprise_account_id = p_ea_id
                        and s.deleted_at is null) then
        raise exception 'schedule_not_found';
      end if;
    else
      if nullif(btrim(coalesce(p_payload->>'name', '')), '') is null then
        raise exception 'name_required';
      end if;
      if p_payload->>'asset_id' is not null then
        if not exists (select 1 from public.enterprise_announcement_assets a
                        where a.id = (p_payload->>'asset_id')::uuid and a.enterprise_account_id = p_ea_id
                          and a.deleted_at is null) then
          raise exception 'asset_not_found';
        end if;
      elsif p_payload->>'asset_request_id' is not null then
        if not exists (select 1 from public.hq_content_requests r
                        where r.id = (p_payload->>'asset_request_id')::uuid and r.enterprise_account_id = p_ea_id
                          and r.kind = 'announcement_asset_add' and r.status in ('pending', 'approved')) then
          raise exception 'asset_not_found';
        end if;
      else
        raise exception 'asset_required';
      end if;
      if p_payload->>'scope_type' is null then
        raise exception 'scope_required';
      end if;
    end if;

    v_scope := p_payload->>'scope_type';
    if v_scope is not null then
      if v_scope not in ('enterprise', 'region', 'store') then
        raise exception 'invalid_scope';
      end if;
      if v_scope = 'region' and not exists (
           select 1 from public.enterprise_regions r
            where r.id = (p_payload->>'region_id')::uuid and r.enterprise_account_id = p_ea_id and r.deleted_at is null) then
        raise exception 'region_not_found';
      end if;
      if v_scope = 'store' then
        if jsonb_typeof(p_payload->'store_ids') is distinct from 'array' or jsonb_array_length(p_payload->'store_ids') = 0 then
          raise exception 'stores_required';
        end if;
        if exists (select 1 from jsonb_array_elements_text(p_payload->'store_ids') x
                    where not public._store_in_enterprise(x::uuid, p_ea_id)) then
          raise exception 'store_not_in_enterprise';
        end if;
      end if;
    end if;

    v_rule := p_payload->>'recurrence_rule';
    if v_rule is not null and v_rule !~ '^(once:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}|daily:\d{2}:\d{2}|weekly:(SUN|MON|TUE|WED|THU|FRI|SAT)(,(SUN|MON|TUE|WED|THU|FRI|SAT))*:\d{2}:\d{2})$' then
      raise exception 'invalid_recurrence_rule';
    end if;
    if p_payload->>'status' is not null and p_payload->>'status' not in ('active', 'paused') then
      raise exception 'invalid_status';
    end if;

  elsif p_kind = 'schedule_delete' then
    if not exists (select 1 from public.enterprise_announcement_schedules s
                    where s.id = (p_payload->>'schedule_id')::uuid and s.enterprise_account_id = p_ea_id
                      and s.deleted_at is null) then
      raise exception 'schedule_not_found';
    end if;

  else
    raise exception 'invalid_kind';
  end if;

  return v_brand;
end;
$$;
revoke all on function public._hq_validate_content_request(uuid, text, jsonb) from public, anon, authenticated;

-- ============================================================================
-- 3) 본사 RPC
-- ============================================================================
create or replace function public.hq_get_my_brand_content()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ea uuid := public._hq_current_enterprise_account_id();
  v_brand uuid;
begin
  if v_ea is null then
    raise exception 'forbidden: not an enterprise HQ admin' using errcode = '42501';
  end if;
  v_brand := public._hq_my_brand_id(v_ea);

  return jsonb_build_object(
    'enterprise', (select jsonb_build_object('id', ea.id, 'name', ea.enterprise_name, 'brand_code', ea.brand_code)
                     from public.enterprise_accounts ea where ea.id = v_ea),
    'brand', (select jsonb_build_object(
                'id', b.id, 'name', b.name, 'status', b.status, 'industry_type', b.industry_type,
                'playback_mode', b.playback_mode, 'open_time', b.open_time, 'close_time', b.close_time,
                'playback_days', b.playback_days, 'playback_timezone', b.playback_timezone)
                from public.brand_accounts b where b.id = v_brand),
    'music_policy', (select jsonb_build_object(
                'policy_mode', p.policy_mode, 'allowed_genres', p.allowed_genres,
                'preferred_genres', p.preferred_genres, 'blocked_genres', p.blocked_genres,
                'preferred_moods', p.preferred_moods, 'blocked_moods', p.blocked_moods,
                'energy_min', p.energy_min, 'energy_max', p.energy_max,
                'bpm_min', p.bpm_min, 'bpm_max', p.bpm_max, 'vocal_policy', p.vocal_policy,
                'updated_at', p.updated_at)
                from public.brand_music_policies p where p.brand_id = v_brand),
    'today_playlist', (select jsonb_build_object('service_date', d.service_date, 'track_count', d.track_count,
                'generated_at', d.generated_at)
                from public.brand_daily_playlists d
               where d.brand_id = v_brand and d.service_date = (now() at time zone 'Asia/Seoul')::date),
    'media', coalesce((select jsonb_agg(jsonb_build_object(
                'id', m.id, 'asset_type', m.asset_type, 'url', m.image_url, 'thumbnail_url', m.thumbnail_url,
                'title', m.title, 'display_duration_seconds', m.display_duration_seconds, 'sort_order', m.sort_order,
                'starts_at', m.starts_at, 'ends_at', m.ends_at, 'status', m.status, 'mime_type', m.mime_type)
                order by m.sort_order, m.created_at)
                from public.brand_media_assets m where m.brand_id = v_brand and m.deleted_at is null), '[]'::jsonb),
    'announcement_assets', coalesce((select jsonb_agg(jsonb_build_object(
                'id', a.id, 'title', a.title, 'file_url', a.file_url, 'file_path', a.file_path,
                'duration_seconds', a.duration_seconds, 'status', a.status, 'created_at', a.created_at)
                order by a.created_at desc)
                from public.enterprise_announcement_assets a
               where a.enterprise_account_id = v_ea and a.deleted_at is null), '[]'::jsonb),
    'schedules', coalesce((select jsonb_agg(jsonb_build_object(
                'id', s.id, 'name', s.name, 'asset_id', s.asset_id, 'scope_type', s.scope_type,
                'region_id', s.region_id, 'store_ids', coalesce(to_jsonb(s.scope_store_ids), '[]'::jsonb),
                'starts_at', s.starts_at, 'ends_at', s.ends_at, 'recurrence_rule', s.recurrence_rule,
                'status', s.status, 'max_plays_per_day', s.max_plays_per_day)
                order by s.created_at desc)
                from public.enterprise_announcement_schedules s
               where s.enterprise_account_id = v_ea and s.deleted_at is null), '[]'::jsonb),
    'regions', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.region_name) order by r.region_name)
                from public.enterprise_regions r
               where r.enterprise_account_id = v_ea and r.deleted_at is null), '[]'::jsonb),
    'stores', coalesce((select jsonb_agg(jsonb_build_object('id', x.store_id, 'name', x.label) order by x.label)
                from (
                  select distinct on (st.store_id) st.store_id,
                         coalesce(nullif(btrim(st.store_name), ''), nullif(btrim(u.full_name), ''),
                                  nullif(btrim(u.nickname), ''), '매장') as label
                    from (
                      select fs.store_id, fs.store_name
                        from public.franchise_stores fs
                        join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id and ef.deleted_at is null
                       where ef.enterprise_account_id = v_ea
                      union all
                      select bps.user_id, null
                        from public.brand_player_sessions bps
                       where bps.enterprise_account_id = v_ea and bps.user_id is not null
                         and bps.revoked_at is null and (bps.expires_at is null or bps.expires_at > now())
                    ) st
                    left join public.users u on u.id = st.store_id
                   order by st.store_id, st.store_name nulls last
                ) x), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
                'id', r.id, 'kind', r.kind, 'payload', r.payload, 'status', r.status, 'hq_note', r.hq_note,
                'review_note', r.review_note, 'created_at', r.created_at, 'reviewed_at', r.reviewed_at)
                order by r.created_at desc)
                from (select * from public.hq_content_requests
                       where enterprise_account_id = v_ea order by created_at desc limit 100) r), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.hq_get_my_brand_content() from public, anon;
grant execute on function public.hq_get_my_brand_content() to authenticated;

create or replace function public.hq_preview_brand_music_policy(p_overrides jsonb default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ea uuid := public._hq_current_enterprise_account_id();
  v_brand uuid;
begin
  if v_ea is null then
    raise exception 'forbidden: not an enterprise HQ admin' using errcode = '42501';
  end if;
  v_brand := public._hq_my_brand_id(v_ea);
  if v_brand is null then
    raise exception 'no_brand: 연결된 브랜드 플레이어가 없습니다';
  end if;
  return public._brand_preview_music_policy(v_brand, p_overrides);
end;
$$;
revoke all on function public.hq_preview_brand_music_policy(jsonb) from public, anon;
grant execute on function public.hq_preview_brand_music_policy(jsonb) to authenticated;

create or replace function public.hq_submit_content_request(p_kind text, p_payload jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ea uuid := public._hq_current_enterprise_account_id();
  v_brand uuid;
  v_id uuid;
  v_target text;
begin
  if v_ea is null then
    raise exception 'forbidden: not an enterprise HQ admin' using errcode = '42501';
  end if;
  v_brand := public._hq_validate_content_request(v_ea, p_kind, p_payload);

  if (select count(*) from public.hq_content_requests
       where enterprise_account_id = v_ea and status = 'pending') >= 50 then
    raise exception 'too_many_pending: 검수 대기 요청이 너무 많아요. 반영된 뒤 다시 요청해 주세요.';
  end if;

  -- 같은 대상의 이전 대기 요청은 새 요청으로 대체한다(마지막 요청만 검수).
  v_target := coalesce(p_payload->>'asset_id', p_payload->>'schedule_id');
  if p_kind in ('music_policy', 'playback_policy') then
    update public.hq_content_requests set status = 'superseded', updated_at = now()
     where enterprise_account_id = v_ea and kind = p_kind and status = 'pending';
  elsif p_kind in ('media_update', 'schedule_update') and v_target is not null then
    update public.hq_content_requests set status = 'superseded', updated_at = now()
     where enterprise_account_id = v_ea and kind = p_kind and status = 'pending'
       and coalesce(payload->>'asset_id', payload->>'schedule_id') = v_target;
  end if;

  insert into public.hq_content_requests (enterprise_account_id, brand_id, kind, payload, requested_by, hq_note)
  values (v_ea, v_brand, p_kind, p_payload, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;
revoke all on function public.hq_submit_content_request(text, jsonb, text) from public, anon;
grant execute on function public.hq_submit_content_request(text, jsonb, text) to authenticated;

create or replace function public.hq_cancel_content_request(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ea uuid := public._hq_current_enterprise_account_id();
begin
  if v_ea is null then
    raise exception 'forbidden: not an enterprise HQ admin' using errcode = '42501';
  end if;
  update public.hq_content_requests set status = 'cancelled', updated_at = now()
   where id = p_id and enterprise_account_id = v_ea and status = 'pending';
  if not found then
    raise exception 'request_not_pending';
  end if;
  -- 이 음원을 쓰려던 대기 일정도 함께 취소한다.
  update public.hq_content_requests set status = 'cancelled', updated_at = now()
   where enterprise_account_id = v_ea and status = 'pending' and kind = 'schedule_create'
     and payload->>'asset_request_id' = p_id::text;
  return jsonb_build_object('success', true);
end;
$$;
revoke all on function public.hq_cancel_content_request(uuid) from public, anon;
grant execute on function public.hq_cancel_content_request(uuid) to authenticated;

-- ============================================================================
-- 4) 관리자 검수
-- ============================================================================
create or replace function public.admin_list_hq_content_requests(p_status text default 'pending', p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row_data order by created_at desc)
      from (
        select r.created_at, jsonb_build_object(
          'id', r.id, 'kind', r.kind, 'payload', r.payload, 'status', r.status,
          'hq_note', r.hq_note, 'review_note', r.review_note,
          'created_at', r.created_at, 'reviewed_at', r.reviewed_at, 'applied_result', r.applied_result,
          'enterprise_account_id', r.enterprise_account_id,
          'enterprise_name', ea.enterprise_name, 'brand_code', ea.brand_code,
          'brand_id', r.brand_id, 'brand_name', b.name, 'brand_industry', b.industry_type,
          'requester_email', (select au.email from auth.users au where au.id = r.requested_by),
          'current', case r.kind
            when 'music_policy' then (select to_jsonb(p) - 'id' - 'brand_id' - 'daypart_policy'
                                        from public.brand_music_policies p where p.brand_id = r.brand_id)
            when 'playback_policy' then jsonb_build_object('playback_mode', b.playback_mode, 'open_time', b.open_time,
                                        'close_time', b.close_time, 'playback_days', b.playback_days)
            when 'media_update' then (select to_jsonb(m) from public.brand_media_assets m where m.id = (r.payload->>'asset_id')::uuid)
            when 'media_delete' then (select to_jsonb(m) from public.brand_media_assets m where m.id = (r.payload->>'asset_id')::uuid)
            when 'announcement_asset_delete' then (select to_jsonb(a) from public.enterprise_announcement_assets a
                                                    where a.id = (r.payload->>'asset_id')::uuid)
            when 'schedule_update' then (select to_jsonb(s) from public.enterprise_announcement_schedules s
                                          where s.id = (r.payload->>'schedule_id')::uuid)
            when 'schedule_delete' then (select to_jsonb(s) from public.enterprise_announcement_schedules s
                                          where s.id = (r.payload->>'schedule_id')::uuid)
            else null end,
          'asset_title', coalesce(
             (select a.title from public.enterprise_announcement_assets a where a.id = (r.payload->>'asset_id')::uuid),
             (select ar.payload->>'title' from public.hq_content_requests ar where ar.id = (r.payload->>'asset_request_id')::uuid)),
          'asset_request_status', (select ar.status from public.hq_content_requests ar
                                    where ar.id = (r.payload->>'asset_request_id')::uuid),
          'region_name', (select rg.region_name from public.enterprise_regions rg where rg.id = (r.payload->>'region_id')::uuid)
        ) as row_data
          from public.hq_content_requests r
          join public.enterprise_accounts ea on ea.id = r.enterprise_account_id
          left join public.brand_accounts b on b.id = r.brand_id
         where p_status is null or r.status = p_status
         order by r.created_at desc
         limit greatest(1, least(coalesce(p_limit, 100), 300))
      ) q), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_list_hq_content_requests(text, int) from public, anon;
grant execute on function public.admin_list_hq_content_requests(text, int) to authenticated;

create or replace function public.admin_review_hq_content_request(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r public.hq_content_requests%rowtype;
  v_brand uuid;
  v_res jsonb;
  v_asset uuid;
  v_dep public.hq_content_requests%rowtype;
  v_scope text;
  v_hq_user uuid;
  v_label text;
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  select * into r from public.hq_content_requests where id = p_id for update;
  if not found then
    raise exception 'request_not_found';
  end if;
  if r.status <> 'pending' then
    raise exception 'already_reviewed: %', r.status;
  end if;

  if not coalesce(p_approve, false) then
    update public.hq_content_requests
       set status = 'rejected', review_note = nullif(btrim(coalesce(p_note, '')), ''),
           reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
     where id = p_id;
    -- 이 음원을 쓰려던 대기 일정도 함께 반려한다.
    if r.kind = 'announcement_asset_add' then
      update public.hq_content_requests
         set status = 'rejected', review_note = '사용하려던 안내 음원이 반려되었습니다.',
             reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
       where status = 'pending' and kind = 'schedule_create' and payload->>'asset_request_id' = p_id::text;
    end if;
  else
    v_brand := public._hq_validate_content_request(r.enterprise_account_id, r.kind, r.payload);

    if r.kind = 'music_policy' then
      v_res := public.admin_upsert_brand_music_policy(
        v_brand,
        array(select jsonb_array_elements_text(coalesce(r.payload->'preferred_genres', '[]'::jsonb))),
        array(select jsonb_array_elements_text(coalesce(r.payload->'blocked_genres', '[]'::jsonb))),
        array(select jsonb_array_elements_text(coalesce(r.payload->'preferred_moods', '[]'::jsonb))),
        array(select jsonb_array_elements_text(coalesce(r.payload->'blocked_moods', '[]'::jsonb))),
        (r.payload->>'energy_min')::numeric, (r.payload->>'energy_max')::numeric,
        r.payload->>'vocal_policy', null, null,
        r.payload->>'policy_mode',
        array(select jsonb_array_elements_text(coalesce(r.payload->'allowed_genres', '[]'::jsonb))),
        (r.payload->>'bpm_min')::int, (r.payload->>'bpm_max')::int);
      -- 오늘 플레이리스트도 새 정책으로 바로 다시 만든다(매장은 곡 사이에 자연스럽게 교체).
      v_res := v_res || jsonb_build_object('regenerated', public.generate_brand_daily_playlist(v_brand, true));

    elsif r.kind = 'playback_policy' then
      v_res := public.admin_set_brand_playback_policy(
        v_brand, r.payload->>'playback_mode',
        (r.payload->>'open_time')::time, (r.payload->>'close_time')::time,
        coalesce(r.payload->>'timezone', 'Asia/Seoul'),
        case when jsonb_typeof(r.payload->'days') = 'array'
             then array(select jsonb_array_elements_text(r.payload->'days')::int) else null end);

    elsif r.kind = 'media_add' then
      v_res := public.admin_add_brand_media(
        v_brand, r.payload->>'url', r.payload->>'title',
        coalesce((r.payload->>'display_duration_seconds')::int, 10), null,
        (r.payload->>'starts_at')::timestamptz, (r.payload->>'ends_at')::timestamptz,
        coalesce(r.payload->>'asset_type', 'image'), r.payload->>'mime_type',
        r.payload->>'thumbnail_url', (r.payload->>'media_duration_seconds')::numeric);

    elsif r.kind = 'media_update' then
      v_res := public.admin_update_brand_media(
        (r.payload->>'asset_id')::uuid, r.payload->>'title',
        (r.payload->>'display_duration_seconds')::int, (r.payload->>'sort_order')::int,
        (r.payload->>'starts_at')::timestamptz, (r.payload->>'ends_at')::timestamptz,
        r.payload->>'status');

    elsif r.kind = 'media_delete' then
      v_res := public.admin_delete_brand_media((r.payload->>'asset_id')::uuid);

    elsif r.kind = 'announcement_asset_add' then
      v_res := public.admin_create_announcement_asset(
        r.payload->>'title', r.payload->>'file_url', r.payload->>'file_path',
        r.payload->>'file_name', r.payload->>'mime_type',
        (r.payload->>'file_size_bytes')::bigint, (r.payload->>'duration_seconds')::numeric,
        r.payload->>'description', r.enterprise_account_id, 'active');

    elsif r.kind = 'announcement_asset_delete' then
      v_res := public.admin_soft_delete_announcement_asset((r.payload->>'asset_id')::uuid);

    elsif r.kind = 'schedule_create' then
      v_asset := (r.payload->>'asset_id')::uuid;
      if v_asset is null then
        select * into v_dep from public.hq_content_requests where id = (r.payload->>'asset_request_id')::uuid;
        -- 아직 검수 전인 음원이면 함께 승인한다(일정만 승인하고 음원이 없는 상태를 막는다).
        if v_dep.status = 'pending' then
          perform public.admin_review_hq_content_request(v_dep.id, true, p_note);
          select * into v_dep from public.hq_content_requests where id = v_dep.id;
        end if;
        if v_dep.status <> 'approved' then
          raise exception '이 일정이 쓰는 안내 음원이 승인되지 않았습니다.';
        end if;
        v_asset := (v_dep.applied_result->>'asset_id')::uuid;
      end if;
      v_scope := r.payload->>'scope_type';
      v_res := public.admin_create_announcement_schedule(
        v_asset, r.payload->>'name', v_scope, r.enterprise_account_id,
        case when v_scope = 'region' then (r.payload->>'region_id')::uuid else null end,
        case when v_scope = 'store' then array(select jsonb_array_elements_text(r.payload->'store_ids')::uuid) else null end,
        r.payload->>'description', coalesce(r.payload->>'status', 'active'),
        (r.payload->>'starts_at')::timestamptz, (r.payload->>'ends_at')::timestamptz,
        'Asia/Seoul', r.payload->>'recurrence_rule', 'after_current_track',
        coalesce((r.payload->>'max_plays_per_day')::int, 10));

    elsif r.kind = 'schedule_update' then
      v_scope := r.payload->>'scope_type';
      v_res := public.admin_update_announcement_schedule(
        (r.payload->>'schedule_id')::uuid, r.payload->>'name', null, r.payload->>'status',
        (r.payload->>'starts_at')::timestamptz, (r.payload->>'ends_at')::timestamptz, null,
        r.payload->>'recurrence_rule', null, (r.payload->>'max_plays_per_day')::int,
        case when v_scope = 'region' then (r.payload->>'region_id')::uuid else null end,
        v_scope,
        case when v_scope = 'store' then array(select jsonb_array_elements_text(r.payload->'store_ids')::uuid) else null end,
        v_scope is not null and v_scope <> 'region',
        v_scope is not null and v_scope <> 'store');

    elsif r.kind = 'schedule_delete' then
      v_res := public.admin_delete_announcement_schedule((r.payload->>'schedule_id')::uuid);
    end if;

    update public.hq_content_requests
       set status = 'approved', review_note = nullif(btrim(coalesce(p_note, '')), ''),
           reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now(), applied_result = v_res
     where id = p_id;
  end if;

  -- 본사 알림센터에 결과를 남긴다(실패해도 검수 자체는 유지).
  begin
    select ea.auth_user_id into v_hq_user from public.enterprise_accounts ea where ea.id = r.enterprise_account_id;
    v_label := case r.kind
      when 'music_policy' then '브랜드 음악 설정'
      when 'playback_policy' then '재생 시간'
      when 'media_add' then '매장 화면 이미지·영상 추가'
      when 'media_update' then '매장 화면 이미지·영상 수정'
      when 'media_delete' then '매장 화면 이미지·영상 삭제'
      when 'announcement_asset_add' then '안내 음원 추가'
      when 'announcement_asset_delete' then '안내 음원 삭제'
      when 'schedule_create' then '안내방송 일정 추가'
      when 'schedule_update' then '안내방송 일정 수정'
      else '안내방송 일정 삭제' end;
    if v_hq_user is not null then
      insert into public.enterprise_notifications (
        enterprise_account_id, target_type, target_id, recipient_user_id, notification_type,
        title, message, severity, status, action_url, metadata)
      values (
        r.enterprise_account_id, 'user', v_hq_user, v_hq_user, 'content_review',
        case when p_approve then v_label || ' 요청이 반영됐어요' else v_label || ' 요청이 반려됐어요' end,
        coalesce(nullif(btrim(coalesce(p_note, '')), ''),
                 case when p_approve then '전 가맹점에 반영되었습니다.' else '브랜드 콘텐츠 관리에서 내용을 확인해 주세요.' end),
        case when p_approve then 'info' else 'medium' end, 'unread', '/enterprise/content',
        jsonb_build_object('request_id', r.id, 'kind', r.kind));
    end if;
  exception when others then
    null;
  end;

  return jsonb_build_object('success', true, 'status', case when p_approve then 'approved' else 'rejected' end,
                            'result', v_res);
end;
$$;
revoke all on function public.admin_review_hq_content_request(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_hq_content_request(uuid, boolean, text) to authenticated;
