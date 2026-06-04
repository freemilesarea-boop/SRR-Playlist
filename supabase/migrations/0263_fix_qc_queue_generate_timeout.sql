-- 0263 — Fix: admin_generate_qc_queue_candidates timeout
--
-- 원인 분석:
--   1. fingerprint_duplicate 룰의 audio_fingerprints 자기조인 + _audio_fingerprint_similarity ×3 호출
--   2. 16개 룰 직렬 실행 → 누적 timeout
--   3. LIMIT 없음 → 전체 카탈로그 풀스캔
--
-- 변경:
--   1. admin_generate_qc_queue_candidates(p_limit, p_issue, p_force) — batch + filter
--   2. fingerprint_failed / fingerprint_duplicate → admin_generate_fingerprint_qc_candidates 로 분리
--   3. 각 INSERT 에 LIMIT p_limit
--   4. 누락 인덱스 추가
--   5. uq_qc_queue_open 기존 활용 — 중복 후보 자동 차단

-- ===== A. 누락 인덱스 추가 =====
create index if not exists idx_tracks_active_id
  on public.tracks(id) where removed_at is null;

create index if not exists idx_audio_fp_failed_retry
  on public.audio_fingerprints(retry_count)
  where fingerprint_status = 'failed';

create index if not exists idx_audio_fp_success_duration
  on public.audio_fingerprints(duration_seconds, fingerprint_hash)
  where fingerprint_status = 'success';

-- ===== B. 기존 함수 DROP (시그니처 변경) =====
drop function if exists public.admin_generate_qc_queue_candidates();

-- ===== C. 신규 batch 함수 =====
create or replace function public.admin_generate_qc_queue_candidates(
  p_limit int default 100,
  p_issue text default null,
  p_force boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '60s'
as $function$
declare
  v_admin uuid := auth.uid();
  v_counts jsonb := '{}'::jsonb;
  v_n int;
  r record;
  v_should_run boolean;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_limit is null or p_limit <= 0 then p_limit := 100; end if;
  if p_limit > 1000 then p_limit := 1000; end if;

  -- 헬퍼: rule_key 가 활성이고 p_issue 필터에 매치하면 true
  -- (PL/pgSQL 에는 inline 함수 없어서 inline 체크)

  -- ── placement_rock_in_lounge ──
  select * into r from public.admin_qc_rules where rule_key='placement_rock_in_lounge';
  v_should_run := r.is_active and (p_issue is null or p_issue = 'placement_rock_in_lounge');
  if v_should_run then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select * from (
      select distinct on (t.id)
        t.id as track_id, r.rule_key as issue_type, r.severity, r.source,
        format('Rock 트랙이 %s 플레이리스트에 배치됨', pl.business_category) as reason,
        jsonb_build_object('main_genre', t.main_genre, 'playlist_id', pl.id,
                           'playlist_title', pl.title, 'business_category', pl.business_category) as evidence_json
      from public.tracks t
      join public.playlist_tracks pt on pt.track_id = t.id and pt.removed_at is null
      join public.playlists pl on pl.id = pt.playlist_id
      where (lower(coalesce(t.main_genre,'')) like '%rock%' or lower(coalesce(t.sub_genre,'')) like '%rock%')
        and pl.business_category in ('호텔','와인바','병원')
        and t.removed_at is null
      order by t.id
      limit p_limit
    ) src
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  end if;

  -- ── placement_energetic_in_hospital ──
  select * into r from public.admin_qc_rules where rule_key='placement_energetic_in_hospital';
  v_should_run := r.is_active and (p_issue is null or p_issue = 'placement_energetic_in_hospital');
  if v_should_run then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select * from (
      select distinct on (t.id)
        t.id, r.rule_key, r.severity, r.source,
        'Electronic/energetic 트랙이 병원 플레이리스트에 배치됨',
        jsonb_build_object('main_genre', t.main_genre, 'mood', t.mood,
          'playlist_id', pl.id, 'playlist_title', pl.title)
      from public.tracks t
      join public.playlist_tracks pt on pt.track_id = t.id and pt.removed_at is null
      join public.playlists pl on pl.id = pt.playlist_id
      where (lower(coalesce(t.main_genre,'')) like '%electronic%'
             or lower(coalesce(t.mood,'')) in ('energetic','exciting')
             or 'energetic' = any(coalesce(t.mood_tags,'{}'::text[]))
             or 'exciting' = any(coalesce(t.mood_tags,'{}'::text[])))
        and pl.business_category = '병원'
        and t.removed_at is null
      order by t.id
      limit p_limit
    ) src
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  end if;

  -- ── placement_fitness_in_relaxed ──
  select * into r from public.admin_qc_rules where rule_key='placement_fitness_in_relaxed';
  v_should_run := r.is_active and (p_issue is null or p_issue = 'placement_fitness_in_relaxed');
  if v_should_run then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select * from (
      select distinct on (t.id)
        t.id, r.rule_key, r.severity, r.source,
        format('헬스장/피트니스 트랙이 %s 등 부적합 장소에 배치됨', pl.business_category),
        jsonb_build_object('suitable_store', t.suitable_store,
          'playlist_id', pl.id, 'business_category', pl.business_category)
      from public.tracks t
      join public.playlist_tracks pt on pt.track_id = t.id and pt.removed_at is null
      join public.playlists pl on pl.id = pt.playlist_id
      where t.suitable_store in ('헬스장','피트니스','fitness')
        and pl.business_category in ('병원','호텔','와인바','카페','라운지')
        and t.removed_at is null
      order by t.id
      limit p_limit
    ) src
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  end if;

  -- ── placement_predicted_mismatch ──
  select * into r from public.admin_qc_rules where rule_key='placement_predicted_mismatch';
  v_should_run := r.is_active and (p_issue is null or p_issue = 'placement_predicted_mismatch');
  if v_should_run then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select * from (
      select distinct on (t.id)
        t.id, r.rule_key, r.severity, r.source,
        format('AI 예측 매장 (%s) 과 배치된 %s 가 모두 불일치',
          array_to_string(p.predicted_store_types,','), pl.business_category),
        jsonb_build_object('predicted_store_types', p.predicted_store_types,
          'business_category', pl.business_category,
          'normalized_slug', public.normalize_store_label(pl.business_category))
      from public.tracks t
      join public.playlist_tracks pt on pt.track_id = t.id and pt.removed_at is null
      join public.playlists pl on pl.id = pt.playlist_id
      join public.track_ai_predictions p on p.track_id = t.id and p.model_version='taxonomy-v1'
      where p.predicted_store_types is not null and array_length(p.predicted_store_types,1) > 0
        and t.removed_at is null
        and p.store_type_confidence >= 0.7
        and public.normalize_store_label(pl.business_category) is not null
        and not (public.normalize_store_label(pl.business_category) = any(p.predicted_store_types))
      order by t.id
      limit p_limit
    ) src
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  end if;

  -- ── confidence_low_genre / mood / store ──
  for r in select * from public.admin_qc_rules
    where rule_key in ('confidence_low_genre','confidence_low_mood','confidence_low_store')
      and is_active
      and (p_issue is null or p_issue = rule_key)
  loop
    if r.rule_key = 'confidence_low_genre' then
      insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
      select * from (
        select p.track_id, r.rule_key, r.severity, r.source,
          format('genre_confidence %s 미만', round(p.genre_confidence,2)),
          jsonb_build_object('genre_confidence', p.genre_confidence, 'predicted_main_genre', p.predicted_main_genre)
        from public.track_ai_predictions p
        join public.tracks t on t.id = p.track_id and t.removed_at is null
        where p.model_version='taxonomy-v1' and p.genre_confidence < 0.5
        order by p.genre_confidence
        limit p_limit
      ) src
      on conflict (track_id, issue_type) where status='open' do nothing;
    elsif r.rule_key = 'confidence_low_mood' then
      insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
      select * from (
        select p.track_id, r.rule_key, r.severity, r.source,
          format('mood_confidence %s 미만', round(p.mood_confidence,2)),
          jsonb_build_object('mood_confidence', p.mood_confidence, 'predicted_moods', p.predicted_moods)
        from public.track_ai_predictions p
        join public.tracks t on t.id = p.track_id and t.removed_at is null
        where p.model_version='taxonomy-v1' and p.mood_confidence < 0.5
        order by p.mood_confidence
        limit p_limit
      ) src
      on conflict (track_id, issue_type) where status='open' do nothing;
    elsif r.rule_key = 'confidence_low_store' then
      insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
      select * from (
        select p.track_id, r.rule_key, r.severity, r.source,
          format('store_type_confidence %s 미만', round(p.store_type_confidence,2)),
          jsonb_build_object('store_type_confidence', p.store_type_confidence,
                             'predicted_store_types', p.predicted_store_types)
        from public.track_ai_predictions p
        join public.tracks t on t.id = p.track_id and t.removed_at is null
        where p.model_version='taxonomy-v1' and p.store_type_confidence < 0.5
        order by p.store_type_confidence
        limit p_limit
      ) src
      on conflict (track_id, issue_type) where status='open' do nothing;
    end if;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  end loop;

  -- ── meta_conflict_genre ──
  select * into r from public.admin_qc_rules where rule_key='meta_conflict_genre';
  v_should_run := r.is_active and (p_issue is null or p_issue = 'meta_conflict_genre');
  if v_should_run then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select * from (
      select t.id, r.rule_key, r.severity, r.source,
        format('Manual genre "%s" vs AI predicted "%s" 불일치',
               t.main_genre, coalesce(tg.name_ko, p.predicted_main_genre)),
        jsonb_build_object('manual_genre', t.main_genre, 'predicted_slug', p.predicted_main_genre,
                           'predicted_name_ko', tg.name_ko, 'genre_confidence', p.genre_confidence)
      from public.tracks t
      join public.track_ai_predictions p on p.track_id = t.id and p.model_version='taxonomy-v1'
      left join public.taxonomy_genres tg on tg.slug = p.predicted_main_genre
      where t.removed_at is null and t.main_genre is not null and p.predicted_main_genre is not null
        and p.genre_confidence >= 0.7
        and lower(btrim(t.main_genre)) <> lower(btrim(coalesce(tg.name_ko, p.predicted_main_genre)))
      order by p.genre_confidence desc
      limit p_limit
    ) src
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  end if;

  -- ── exclusion_conflict ──
  select * into r from public.admin_qc_rules where rule_key='exclusion_conflict';
  v_should_run := r.is_active and (p_issue is null or p_issue = 'exclusion_conflict');
  if v_should_run then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select * from (
      select pt.track_id, r.rule_key, r.severity, r.source,
        format('금지 장소 (%s) 에 아직 playlist_tracks 남아있음',
               array_to_string(array_agg(distinct e.store_type_slug), ',')),
        jsonb_build_object('active_exclusions', array_agg(distinct e.store_type_slug),
          'misplaced_playlist_ids', array_agg(distinct pl.id::text),
          'misplaced_playlist_titles', array_agg(distinct pl.title))
      from public.playlist_tracks pt
      join public.playlists pl on pl.id = pt.playlist_id
      join public.tracks t on t.id = pt.track_id and t.removed_at is null
      join public.track_store_exclusions e on e.track_id = pt.track_id and e.is_active
      where pt.removed_at is null
        and public._track_is_excluded_from_playlist(pt.track_id, pl.id)
      group by pt.track_id
      limit p_limit
    ) src
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  end if;

  -- ── behavior_* ──
  for r in select * from public.admin_qc_rules
    where rule_key in ('behavior_high_skip','behavior_low_completion',
                       'behavior_positive_outlier','behavior_negative_outlier')
      and is_active
      and (p_issue is null or p_issue = rule_key)
  loop
    if r.rule_key = 'behavior_high_skip' then
      insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
      select * from (
        select b.track_id, r.rule_key, r.severity, r.source,
          format('skip_rate %s%% (play_count %s)', round(b.skip_rate*100,1), b.play_count),
          jsonb_build_object('skip_rate', b.skip_rate, 'play_count', b.play_count,
                             'completion_rate', b.completion_rate, 'window_days', b.window_days)
        from public.track_behavior_scores b
        join public.tracks t on t.id = b.track_id and t.removed_at is null
        where b.window_days = 30 and b.play_count >= 30 and b.skip_rate > 0.7
        order by b.skip_rate desc
        limit p_limit
      ) src
      on conflict (track_id, issue_type) where status='open' do nothing;
    elsif r.rule_key = 'behavior_low_completion' then
      insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
      select * from (
        select b.track_id, r.rule_key, r.severity, r.source,
          format('completion_rate %s%% (play_count %s)', round(b.completion_rate*100,1), b.play_count),
          jsonb_build_object('completion_rate', b.completion_rate, 'play_count', b.play_count,
                             'skip_rate', b.skip_rate, 'window_days', b.window_days)
        from public.track_behavior_scores b
        join public.tracks t on t.id = b.track_id and t.removed_at is null
        where b.window_days = 30 and b.play_count >= 30 and b.completion_rate < 0.25
        order by b.completion_rate
        limit p_limit
      ) src
      on conflict (track_id, issue_type) where status='open' do nothing;
    elsif r.rule_key = 'behavior_positive_outlier' then
      insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
      select * from (
        select b.track_id, r.rule_key, r.severity, r.source,
          format('승격 후보: behavior_score %s, confidence %s', round(b.behavior_score,1), round(b.confidence,2)),
          jsonb_build_object('behavior_score', b.behavior_score, 'confidence', b.confidence,
                             'completion_rate', b.completion_rate, 'like_rate', b.like_rate,
                             'play_count', b.play_count, 'window_days', b.window_days)
        from public.track_behavior_scores b
        join public.tracks t on t.id = b.track_id and t.removed_at is null
        where b.window_days = 30 and b.behavior_score >= 70 and b.confidence >= 0.30
        order by b.behavior_score desc
        limit p_limit
      ) src
      on conflict (track_id, issue_type) where status='open' do nothing;
    elsif r.rule_key = 'behavior_negative_outlier' then
      insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
      select * from (
        select b.track_id, r.rule_key, r.severity, r.source,
          format('강등 후보: behavior_score %s, confidence %s', round(b.behavior_score,1), round(b.confidence,2)),
          jsonb_build_object('behavior_score', b.behavior_score, 'confidence', b.confidence,
                             'skip_rate', b.skip_rate, 'completion_rate', b.completion_rate,
                             'play_count', b.play_count, 'window_days', b.window_days)
        from public.track_behavior_scores b
        join public.tracks t on t.id = b.track_id and t.removed_at is null
        where b.window_days = 30 and b.behavior_score <= 30 and b.confidence >= 0.30
        order by b.behavior_score
        limit p_limit
      ) src
      on conflict (track_id, issue_type) where status='open' do nothing;
    end if;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  end loop;

  -- ── store_mismatch_behavior ──
  select * into r from public.admin_qc_rules where rule_key='store_mismatch_behavior';
  v_should_run := r.is_active and (p_issue is null or p_issue = 'store_mismatch_behavior');
  if v_should_run then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select * from (
      select distinct b.track_id, r.rule_key, r.severity, r.source,
        format('매장 "%s" 에서 completion_rate 낮음 (%s)', sb.key, sb.value->>'completion_rate'),
        jsonb_build_object('matched_store', sb.key, 'breakdown', sb.value, 'window_days', b.window_days)
      from public.track_behavior_scores b
      join public.tracks t on t.id = b.track_id and t.removed_at is null
      cross join lateral jsonb_each(coalesce(b.store_breakdown_json,'{}'::jsonb)) sb
      where b.window_days = 30
        and (sb.value->>'play_count')::int >= 10
        and (sb.value->>'completion_rate')::numeric < 0.3
      limit p_limit
    ) src
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  end if;

  -- ── store_behavior_high_skip / low_completion / mismatch ──
  for r in select * from public.admin_qc_rules
    where rule_key in ('store_behavior_high_skip','store_behavior_low_completion','store_behavior_mismatch')
      and is_active
      and (p_issue is null or p_issue = rule_key)
  loop
    if r.rule_key = 'store_behavior_high_skip' then
      insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
      select * from (
        select distinct on (s.track_id, s.store_type_slug)
          s.track_id, r.rule_key, r.severity, r.source,
          format('%s 매장에서 skip_rate %s%% (play %s, conf %s)',
                 s.store_type_slug, round(s.skip_rate*100,1), s.play_count, round(s.confidence,2)),
          jsonb_build_object('store_type_slug', s.store_type_slug,
                             'skip_rate', s.skip_rate, 'play_count', s.play_count,
                             'completion_rate', s.completion_rate, 'confidence', s.confidence,
                             'window_days', s.window_days)
        from public.track_store_behavior_scores s
        join public.tracks t on t.id = s.track_id and t.removed_at is null
        where s.window_days = 30 and s.play_count >= 30 and s.skip_rate >= 0.6 and s.confidence >= 0.3
        order by s.track_id, s.store_type_slug
        limit p_limit
      ) src
      on conflict (track_id, issue_type) where status='open' do nothing;
    elsif r.rule_key = 'store_behavior_low_completion' then
      insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
      select * from (
        select distinct on (s.track_id, s.store_type_slug)
          s.track_id, r.rule_key, r.severity, r.source,
          format('%s 매장에서 completion %s%% (play %s, conf %s)',
                 s.store_type_slug, round(s.completion_rate*100,1), s.play_count, round(s.confidence,2)),
          jsonb_build_object('store_type_slug', s.store_type_slug,
                             'completion_rate', s.completion_rate, 'play_count', s.play_count,
                             'skip_rate', s.skip_rate, 'confidence', s.confidence,
                             'window_days', s.window_days)
        from public.track_store_behavior_scores s
        join public.tracks t on t.id = s.track_id and t.removed_at is null
        where s.window_days = 30 and s.play_count >= 30 and s.completion_rate <= 0.25 and s.confidence >= 0.3
        order by s.track_id, s.store_type_slug
        limit p_limit
      ) src
      on conflict (track_id, issue_type) where status='open' do nothing;
    elsif r.rule_key = 'store_behavior_mismatch' then
      insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
      select * from (
        select distinct on (s.track_id, s.store_type_slug)
          s.track_id, r.rule_key, r.severity, r.source,
          format('%s 매장에서 강등 후보 (score %s, conf %s)',
                 s.store_type_slug, round(s.store_behavior_score,1), round(s.confidence,2)),
          jsonb_build_object('store_type_slug', s.store_type_slug,
                             'store_behavior_score', s.store_behavior_score, 'confidence', s.confidence,
                             'skip_rate', s.skip_rate, 'completion_rate', s.completion_rate,
                             'play_count', s.play_count, 'window_days', s.window_days)
        from public.track_store_behavior_scores s
        join public.tracks t on t.id = s.track_id and t.removed_at is null
        where s.window_days = 30 and s.store_behavior_score <= 30 and s.confidence >= 0.3
        order by s.track_id, s.store_type_slug
        limit p_limit
      ) src
      on conflict (track_id, issue_type) where status='open' do nothing;
    end if;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  end loop;

  -- Note: fingerprint_failed / fingerprint_duplicate 는 별도 RPC 로 이관 (heavy self-join)

  insert into public.admin_bulk_operation_audit(
    admin_id, operation_type, track_count, params_json, after_json, status, completed_at
  ) values (v_admin, 'qc_queue_generate', 0,
    jsonb_build_object('limit', p_limit, 'issue', p_issue, 'force', p_force),
    jsonb_build_object('by_rule', v_counts), 'completed', now());

  return jsonb_build_object('ok', true, 'by_rule', v_counts, 'limit', p_limit, 'issue', p_issue,
    'generated_total', (
      select coalesce(sum(case when value::text ~ '^[0-9]+$' then (value::text)::int else 0 end), 0)
      from jsonb_each(v_counts)
    ));
end; $function$;

-- ===== D. admin_generate_fingerprint_qc_candidates (분리) =====
create or replace function public.admin_generate_fingerprint_qc_candidates(
  p_limit int default 100
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '60s'
as $$
declare
  v_admin uuid := auth.uid();
  v_counts jsonb := '{}'::jsonb;
  v_n int;
  r record;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_limit is null or p_limit <= 0 then p_limit := 100; end if;
  if p_limit > 500 then p_limit := 500; end if;

  -- fingerprint_failed (light)
  select * into r from public.admin_qc_rules where rule_key='fingerprint_failed';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select * from (
      select f.track_id, r.rule_key, r.severity, r.source,
        format('Chromaprint 디코딩 실패 (retry %s회)', f.retry_count),
        jsonb_build_object('retry_count', f.retry_count, 'content_type', f.download_content_type,
                           'download_size_bytes', f.download_size_bytes,
                           'fingerprint_error', left(coalesce(f.fingerprint_error,''), 300))
      from public.audio_fingerprints f
      join public.tracks t on t.id = f.track_id and t.removed_at is null
      where f.fingerprint_status = 'failed' and f.retry_count >= 2
      order by f.retry_count desc, f.fingerprint_attempted_at desc
      limit p_limit
    ) src
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  end if;

  -- fingerprint_duplicate (heavy self-join) — exact hash 매치만 fast path,
  -- similarity 함수 호출은 LIMIT 적용된 후보 안에서만
  select * into r from public.admin_qc_rules where rule_key='fingerprint_duplicate';
  if r.is_active then
    -- Step 1: exact hash 매치 (인덱스 활용 — fast)
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select * from (
      select distinct on (a.track_id)
        a.track_id, r.rule_key, 'CRITICAL'::text, r.source,
        'fingerprint_hash 정확 일치',
        jsonb_build_object('candidate_track_id', b.track_id,
          'similarity', 1.0, 'hash_exact', true,
          'duration_a', a.duration_seconds, 'duration_b', b.duration_seconds)
      from public.audio_fingerprints a
      join public.audio_fingerprints b
        on b.fingerprint_hash = a.fingerprint_hash and b.track_id > a.track_id
      join public.tracks ta on ta.id = a.track_id and ta.removed_at is null
      join public.tracks tb on tb.id = b.track_id and tb.removed_at is null
      where a.fingerprint_status='success' and b.fingerprint_status='success'
      order by a.track_id
      limit p_limit
    ) src
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object('fingerprint_duplicate_exact', v_n);

    -- Note: similarity-based fuzzy 매치는 ML 파이프라인에서 별도 처리 권장
    -- (현재 RPC 에서는 timeout 위험으로 제외)
  end if;

  insert into public.admin_bulk_operation_audit(
    admin_id, operation_type, track_count, params_json, after_json, status, completed_at
  ) values (v_admin, 'qc_queue_generate_fingerprint', 0,
    jsonb_build_object('limit', p_limit),
    jsonb_build_object('by_rule', v_counts), 'completed', now());

  return jsonb_build_object('ok', true, 'by_rule', v_counts, 'limit', p_limit,
    'generated_total', (
      select coalesce(sum(case when value::text ~ '^[0-9]+$' then (value::text)::int else 0 end), 0)
      from jsonb_each(v_counts)
    ));
end; $$;

-- ===== E. 권한 =====
revoke all on function public.admin_generate_qc_queue_candidates(int, text, boolean) from public, anon;
revoke all on function public.admin_generate_fingerprint_qc_candidates(int) from public, anon;
grant execute on function public.admin_generate_qc_queue_candidates(int, text, boolean) to authenticated, service_role;
grant execute on function public.admin_generate_fingerprint_qc_candidates(int) to authenticated, service_role;
