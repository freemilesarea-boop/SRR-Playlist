-- 0247 — Phase X3.2 Bulk Operations System
--
-- 목표: 373 → 1000 → 10000곡 규모 운영 가능한 대량 작업 시스템.
--
-- 절대 원칙 (사용자 spec):
--   - 자동 승인 금지, 자동 삭제 금지, 자동 반영 금지
--   - Preview → Confirm 구조
--   - 모든 bulk 작업 audit

-- ===== A. admin_bulk_operation_audit =====
create table if not exists public.admin_bulk_operation_audit (
  id              uuid primary key default gen_random_uuid(),
  admin_id        uuid references public.users(id) on delete set null,
  operation_type  text not null,
  track_count     int not null default 0,
  params_json     jsonb,
  before_json     jsonb,
  after_json      jsonb,
  status          text not null default 'completed' check (status in ('preview','completed','failed')),
  error_message   text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);
create index if not exists ix_bulk_audit_created on public.admin_bulk_operation_audit(created_at desc);
create index if not exists ix_bulk_audit_type on public.admin_bulk_operation_audit(operation_type, created_at desc);

alter table public.admin_bulk_operation_audit enable row level security;
drop policy if exists "bulk audit admin read" on public.admin_bulk_operation_audit;
create policy "bulk audit admin read" on public.admin_bulk_operation_audit for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== B. admin_bulk_apply_ai_metadata =====
-- track_ids 중 confidence 임계점을 통과하는 트랙만 AI 메타 적용.
-- scope: genre/mood/store 개별 선택.
-- preview=true → 적용 안 하고 통과/제외 카운트만 반환.
create or replace function public.admin_bulk_apply_ai_metadata(
  p_track_ids        uuid[],
  p_apply_genre      boolean default false,
  p_apply_mood       boolean default false,
  p_apply_store      boolean default false,
  p_min_confidence   numeric default 0.0,
  p_confirm          boolean default false,
  p_reason           text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_count int := 0;
  v_skipped_low_conf int := 0;
  v_skipped_no_pred int := 0;
  v_applied int := 0;
  v_failed int := 0;
  v_audit_id uuid;
  v_breakdown jsonb := '[]'::jsonb;
  r record;
  v_pass boolean;
  v_min_conf numeric;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if not (p_apply_genre or p_apply_mood or p_apply_store) then
    raise exception 'at least one of genre/mood/store must be true';
  end if;
  if p_track_ids is null or array_length(p_track_ids, 1) is null then
    return jsonb_build_object('ok', true, 'count', 0, 'preview', not p_confirm,
      'applied', 0, 'skipped_low_conf', 0, 'skipped_no_pred', 0);
  end if;

  -- preview / confirm 모두 동일 통과 검사 수행
  for r in
    select t.id as track_id, t.title, t.artist,
           p.predicted_main_genre, p.predicted_moods, p.predicted_store_types,
           p.genre_confidence, p.mood_confidence, p.store_type_confidence
    from unnest(p_track_ids) as tid
    join public.tracks t on t.id = tid
    left join public.track_ai_predictions p on p.track_id = t.id and p.model_version='taxonomy-v1'
  loop
    v_count := v_count + 1;
    if r.predicted_main_genre is null
       and (r.predicted_moods is null or array_length(r.predicted_moods,1) is null)
       and (r.predicted_store_types is null or array_length(r.predicted_store_types,1) is null) then
      v_skipped_no_pred := v_skipped_no_pred + 1;
      continue;
    end if;

    -- scope 별 confidence 체크 (적용할 항목 중 최소 confidence)
    v_min_conf := 1.0;
    if p_apply_genre and r.genre_confidence is not null then
      v_min_conf := least(v_min_conf, r.genre_confidence);
    end if;
    if p_apply_mood and r.mood_confidence is not null then
      v_min_conf := least(v_min_conf, r.mood_confidence);
    end if;
    if p_apply_store and r.store_type_confidence is not null then
      v_min_conf := least(v_min_conf, r.store_type_confidence);
    end if;

    v_pass := v_min_conf >= p_min_confidence;
    if not v_pass then
      v_skipped_low_conf := v_skipped_low_conf + 1;
      continue;
    end if;

    if not p_confirm then
      -- preview 모드: 변경 시뮬 정보만 누적
      v_breakdown := v_breakdown || jsonb_build_object(
        'track_id', r.track_id, 'title', r.title,
        'min_confidence', v_min_conf,
        'will_apply_genre', p_apply_genre and r.predicted_main_genre is not null,
        'will_apply_mood', p_apply_mood and r.predicted_moods is not null,
        'will_apply_store', p_apply_store and r.predicted_store_types is not null
      );
      v_applied := v_applied + 1;
    else
      -- confirm 모드: 실제 적용 (per-track audit 도 자동)
      begin
        perform public.admin_apply_ai_metadata_with_audit(
          r.track_id, p_apply_genre, p_apply_mood, p_apply_store, p_reason);
        v_applied := v_applied + 1;
      exception when others then
        v_failed := v_failed + 1;
      end;
    end if;
  end loop;

  insert into public.admin_bulk_operation_audit(
    admin_id, operation_type, track_count, params_json,
    after_json, status, completed_at
  ) values (
    v_admin,
    case when p_confirm then 'bulk_apply_ai_metadata' else 'bulk_apply_ai_metadata_preview' end,
    v_count,
    jsonb_build_object(
      'apply_genre', p_apply_genre, 'apply_mood', p_apply_mood, 'apply_store', p_apply_store,
      'min_confidence', p_min_confidence, 'reason', p_reason,
      'track_ids_first_100', (select jsonb_agg(x) from unnest(p_track_ids[1:100]) x)
    ),
    jsonb_build_object('applied', v_applied, 'skipped_low_conf', v_skipped_low_conf,
                       'skipped_no_pred', v_skipped_no_pred, 'failed', v_failed),
    case when p_confirm then 'completed' else 'preview' end,
    now()
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'ok', true, 'audit_id', v_audit_id,
    'preview', not p_confirm,
    'total', v_count,
    'applied', v_applied,
    'skipped_low_conf', v_skipped_low_conf,
    'skipped_no_pred', v_skipped_no_pred,
    'failed', v_failed,
    'breakdown', case when not p_confirm then v_breakdown else null end
  );
end; $$;

-- ===== C. admin_bulk_add_track_exclusions =====
-- track_ids × store_slugs 카르테시안 곱으로 exclusion 추가.
create or replace function public.admin_bulk_add_track_exclusions(
  p_track_ids        uuid[],
  p_store_slugs      text[],
  p_confirm          boolean default false,
  p_reason           text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_inserted int := 0;
  v_already int := 0;
  v_total_combos int := 0;
  v_invalid_slugs text[];
  v_audit_id uuid;
  tid uuid; slug text;
  v_exists boolean;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_track_ids is null or array_length(p_track_ids, 1) is null then
    raise exception 'track_ids required';
  end if;
  if p_store_slugs is null or array_length(p_store_slugs, 1) is null then
    raise exception 'store_slugs required';
  end if;

  -- slug validation
  select array_agg(s) into v_invalid_slugs
  from unnest(p_store_slugs) s
  where not exists (select 1 from public.taxonomy_store_types ts where ts.slug = s);
  if v_invalid_slugs is not null and array_length(v_invalid_slugs,1) > 0 then
    raise exception 'unknown store_type_slugs: %', v_invalid_slugs;
  end if;

  v_total_combos := array_length(p_track_ids,1) * array_length(p_store_slugs,1);

  if not p_confirm then
    -- preview: 이미 활성 exclusion 카운트 vs 신규 카운트
    foreach tid in array p_track_ids loop
      foreach slug in array p_store_slugs loop
        select exists (
          select 1 from public.track_store_exclusions
          where track_id=tid and store_type_slug=slug and is_active=true
        ) into v_exists;
        if v_exists then v_already := v_already + 1; else v_inserted := v_inserted + 1; end if;
      end loop;
    end loop;
  else
    -- confirm: upsert (per-track audit 도 함께)
    foreach tid in array p_track_ids loop
      foreach slug in array p_store_slugs loop
        begin
          perform public.admin_add_track_exclusion(tid, slug, p_reason);
          v_inserted := v_inserted + 1;
        exception when others then
          v_already := v_already + 1;
        end;
      end loop;
    end loop;
  end if;

  insert into public.admin_bulk_operation_audit(
    admin_id, operation_type, track_count, params_json, after_json, status, completed_at
  ) values (
    v_admin,
    case when p_confirm then 'bulk_add_exclusions' else 'bulk_add_exclusions_preview' end,
    array_length(p_track_ids,1),
    jsonb_build_object('store_slugs', p_store_slugs, 'reason', p_reason,
      'track_ids_first_100', (select jsonb_agg(x) from unnest(p_track_ids[1:100]) x)),
    jsonb_build_object('combos_total', v_total_combos, 'inserted', v_inserted, 'already_active', v_already),
    case when p_confirm then 'completed' else 'preview' end,
    now()
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'ok', true, 'audit_id', v_audit_id, 'preview', not p_confirm,
    'track_count', array_length(p_track_ids,1),
    'slug_count', array_length(p_store_slugs,1),
    'combos_total', v_total_combos,
    'inserted', v_inserted, 'already_active', v_already
  );
end; $$;

-- ===== D. admin_bulk_recompute_fit_scores =====
-- track_ids 의 모든 placement / fit_score 행 재계산.
create or replace function public.admin_bulk_recompute_fit_scores(p_track_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_total_recomputed int := 0;
  v_track_count int := 0;
  v_audit_id uuid;
  tid uuid; v_count int;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_track_ids is null then return jsonb_build_object('ok', true, 'count', 0); end if;

  v_track_count := coalesce(array_length(p_track_ids,1), 0);

  foreach tid in array p_track_ids loop
    select count(*) into v_count
    from public.playlists pl
    where pl.is_auto_generated = true and pl.status = 'released'
      and exists (select 1 from public.playlist_track_fit_scores fs
                  where fs.playlist_id = pl.id and fs.track_id = tid);
    -- per-track 재계산 (내부 audit 1건 추가)
    perform public.admin_recompute_track_fit_scores(tid);
    v_total_recomputed := v_total_recomputed + v_count;
  end loop;

  insert into public.admin_bulk_operation_audit(
    admin_id, operation_type, track_count, params_json, after_json, status, completed_at
  ) values (
    v_admin, 'bulk_recompute_fit_scores', v_track_count,
    jsonb_build_object('track_ids_first_100', (select jsonb_agg(x) from unnest(p_track_ids[1:100]) x)),
    jsonb_build_object('total_fit_rows_recomputed', v_total_recomputed),
    'completed', now()
  ) returning id into v_audit_id;

  return jsonb_build_object('ok', true, 'audit_id', v_audit_id,
    'track_count', v_track_count, 'total_recomputed', v_total_recomputed);
end; $$;

-- ===== E. admin_bulk_preview_placement_changes =====
-- 선택 트랙들의 placement 변경 aggregated preview.
create or replace function public.admin_bulk_preview_placement_changes(p_track_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_admin uuid := auth.uid();
  v_total_remove int := 0;
  v_total_keep int := 0;
  v_per_track jsonb := '[]'::jsonb;
  tid uuid;
  v_track_title text;
  v_remove_cnt int;
  v_keep_cnt int;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_track_ids is null then return jsonb_build_object('ok', true, 'total_remove', 0, 'total_keep', 0); end if;

  foreach tid in array p_track_ids loop
    select t.title into v_track_title from public.tracks t where t.id = tid;

    select count(*) into v_remove_cnt
    from public.playlist_tracks pt
    join public.playlists pl on pl.id = pt.playlist_id
    where pt.track_id = tid and public._track_is_excluded_from_playlist(tid, pl.id);

    select count(*) into v_keep_cnt
    from public.playlist_tracks pt
    join public.playlists pl on pl.id = pt.playlist_id
    where pt.track_id = tid and not public._track_is_excluded_from_playlist(tid, pl.id);

    v_total_remove := v_total_remove + v_remove_cnt;
    v_total_keep := v_total_keep + v_keep_cnt;

    if v_remove_cnt > 0 or v_keep_cnt > 0 then
      v_per_track := v_per_track || jsonb_build_object(
        'track_id', tid, 'title', v_track_title,
        'remove_count', v_remove_cnt, 'keep_count', v_keep_cnt
      );
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'track_count', coalesce(array_length(p_track_ids,1), 0),
    'total_remove', v_total_remove,
    'total_keep', v_total_keep,
    'per_track', v_per_track
  );
end; $$;

-- ===== F. admin_bulk_remove_misplaced_playlist_tracks =====
create or replace function public.admin_bulk_remove_misplaced_playlist_tracks(
  p_track_ids uuid[],
  p_confirm   boolean default false,
  p_reason    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_total_removed int := 0;
  v_track_count int := 0;
  v_per_track jsonb := '[]'::jsonb;
  v_audit_id uuid;
  tid uuid;
  v_res jsonb;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_track_ids is null then return jsonb_build_object('ok', true, 'count', 0); end if;
  v_track_count := coalesce(array_length(p_track_ids,1), 0);

  foreach tid in array p_track_ids loop
    v_res := public.admin_remove_misplaced_playlist_tracks(tid, p_confirm, p_reason);
    v_total_removed := v_total_removed + coalesce((v_res->>'count')::int, 0);
    v_per_track := v_per_track || jsonb_build_object(
      'track_id', tid, 'removed', (v_res->>'count')::int);
  end loop;

  insert into public.admin_bulk_operation_audit(
    admin_id, operation_type, track_count, params_json, after_json, status, completed_at
  ) values (
    v_admin,
    case when p_confirm then 'bulk_remove_misplaced' else 'bulk_remove_misplaced_preview' end,
    v_track_count,
    jsonb_build_object('reason', p_reason,
      'track_ids_first_100', (select jsonb_agg(x) from unnest(p_track_ids[1:100]) x)),
    jsonb_build_object('total_removed', v_total_removed),
    case when p_confirm then 'completed' else 'preview' end,
    now()
  ) returning id into v_audit_id;

  return jsonb_build_object('ok', true, 'audit_id', v_audit_id,
    'preview', not p_confirm,
    'track_count', v_track_count, 'total_removed', v_total_removed,
    'per_track', v_per_track);
end; $$;

-- ===== G. admin_bulk_qc_queue_filter =====
-- 조건 필터로 트랙 ID 목록 반환 (검수 큐 후보).
-- filter: { main_genre_in: text[], in_playlist_categories: text[], fingerprint_status: text,
--          store_type_confidence_lt: numeric, mood_confidence_lt: numeric, genre_confidence_lt: numeric,
--          ai_predicted_store_in: text[], limit: int }
create or replace function public.admin_bulk_qc_queue_filter(p_filter jsonb)
returns table (
  track_id uuid, title text, artist text, main_genre text,
  current_playlists text[],
  genre_conf numeric, mood_conf numeric, store_conf numeric,
  fingerprint_status text
)
language sql
security definer
set search_path = public
stable
as $$
  with f as (
    select
      (p_filter->'main_genre_in')              as f_genre_in,
      (p_filter->'in_playlist_categories')     as f_pl_cats,
      p_filter->>'fingerprint_status'          as f_fp,
      nullif(p_filter->>'store_type_confidence_lt','')::numeric as f_store_lt,
      nullif(p_filter->>'mood_confidence_lt','')::numeric       as f_mood_lt,
      nullif(p_filter->>'genre_confidence_lt','')::numeric      as f_genre_lt,
      (p_filter->'ai_predicted_store_in')      as f_ai_store_in,
      coalesce(nullif(p_filter->>'limit','')::int, 500)         as f_limit
  )
  select t.id, t.title, t.artist, t.main_genre,
    (select array_agg(distinct pl.business_category || '|' || pl.title)
     from public.playlist_tracks pt
     join public.playlists pl on pl.id = pt.playlist_id
     where pt.track_id = t.id) as current_playlists,
    p.genre_confidence, p.mood_confidence, p.store_type_confidence,
    af.fingerprint_status
  from public.tracks t
  cross join f
  left join public.track_ai_predictions p on p.track_id = t.id and p.model_version='taxonomy-v1'
  left join public.audio_fingerprints af on af.track_id = t.id
  where t.removed_at is null
    and (f.f_genre_in is null or jsonb_array_length(f.f_genre_in)=0
         or lower(coalesce(t.main_genre,'')) in (
           select lower(x) from jsonb_array_elements_text(f.f_genre_in) x
         ))
    and (f.f_pl_cats is null or jsonb_array_length(f.f_pl_cats)=0
         or exists (
           select 1 from public.playlist_tracks pt
           join public.playlists pl on pl.id = pt.playlist_id
           where pt.track_id = t.id
             and pl.business_category in (
               select x from jsonb_array_elements_text(f.f_pl_cats) x
             )
         ))
    and (f.f_fp is null or coalesce(af.fingerprint_status, 'none') = f.f_fp)
    and (f.f_store_lt is null or coalesce(p.store_type_confidence, 0) < f.f_store_lt)
    and (f.f_mood_lt  is null or coalesce(p.mood_confidence, 0)  < f.f_mood_lt)
    and (f.f_genre_lt is null or coalesce(p.genre_confidence, 0) < f.f_genre_lt)
    and (f.f_ai_store_in is null or jsonb_array_length(f.f_ai_store_in)=0
         or exists (
           select 1 from jsonb_array_elements_text(f.f_ai_store_in) x
           where x = any(coalesce(p.predicted_store_types, '{}'::text[]))
         ))
  order by t.created_at desc nulls last, t.id
  limit (select f_limit from f);
$$;

-- ===== H. admin_list_bulk_audit =====
create or replace function public.admin_list_bulk_audit(p_limit int default 50)
returns table (
  id uuid, operation_type text, track_count int,
  params_json jsonb, after_json jsonb, status text,
  created_at timestamptz, admin_name text
)
language sql security definer set search_path = public stable as $$
  select a.id, a.operation_type, a.track_count, a.params_json, a.after_json, a.status,
         a.created_at, u.full_name
  from public.admin_bulk_operation_audit a
  left join public.users u on u.id = a.admin_id
  order by a.created_at desc
  limit greatest(p_limit, 1);
$$;

-- ===== 권한 =====
revoke all on function public.admin_bulk_apply_ai_metadata(uuid[], boolean, boolean, boolean, numeric, boolean, text) from public, anon;
revoke all on function public.admin_bulk_add_track_exclusions(uuid[], text[], boolean, text) from public, anon;
revoke all on function public.admin_bulk_recompute_fit_scores(uuid[]) from public, anon;
revoke all on function public.admin_bulk_preview_placement_changes(uuid[]) from public, anon;
revoke all on function public.admin_bulk_remove_misplaced_playlist_tracks(uuid[], boolean, text) from public, anon;
revoke all on function public.admin_bulk_qc_queue_filter(jsonb) from public, anon;
revoke all on function public.admin_list_bulk_audit(int) from public, anon;

grant execute on function public.admin_bulk_apply_ai_metadata(uuid[], boolean, boolean, boolean, numeric, boolean, text) to authenticated, service_role;
grant execute on function public.admin_bulk_add_track_exclusions(uuid[], text[], boolean, text) to authenticated, service_role;
grant execute on function public.admin_bulk_recompute_fit_scores(uuid[]) to authenticated, service_role;
grant execute on function public.admin_bulk_preview_placement_changes(uuid[]) to authenticated, service_role;
grant execute on function public.admin_bulk_remove_misplaced_playlist_tracks(uuid[], boolean, text) to authenticated, service_role;
grant execute on function public.admin_bulk_qc_queue_filter(jsonb) to authenticated, service_role;
grant execute on function public.admin_list_bulk_audit(int) to authenticated, service_role;
