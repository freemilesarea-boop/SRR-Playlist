-- 0251 — Phase X4.1 Behavior Feedback Engine
--
-- 목표: track_behavior_scores 를 추천 레이어로 활용 (fit_score 직접 변경 X).
--
-- 핵심 설계:
--   - 기존 fit_score 컬럼 절대 수정 금지
--   - 별도 4 컬럼 추가: behavior_score, behavior_confidence, behavior_boost, final_fit_score
--   - behavior_boost = normalized × cap(confidence) — 데이터 적으면 자동으로 작게
--
-- 정책 (사용자 spec):
--   - 자동 삭제/차단/반려/승격/강등 금지
--   - 큐 생성 + 추천만 수행

-- ===== A. playlist_track_fit_scores 신규 컬럼 추가 =====
-- 주의: behavior_score 컬럼은 0241 이전부터 존재 (fit formula 의 behavior contribution, 0..100).
-- → 신규 track-level behavior 점수는 track_behavior_score 로 별도 컬럼 추가 (NULL 허용, 범위 무제한).
alter table public.playlist_track_fit_scores
  add column if not exists track_behavior_score numeric,    -- track_behavior_scores.behavior_score 복사
  add column if not exists behavior_confidence numeric,     -- track_behavior_scores.confidence 복사
  add column if not exists behavior_boost numeric,          -- _compute_behavior_boost 결과 (음수 가능)
  add column if not exists final_fit_score numeric;         -- fit_score + boost (0..100 clamp)

create index if not exists ix_pt_fit_final on public.playlist_track_fit_scores(final_fit_score desc)
  where final_fit_score is not null;

-- ===== B. _compute_behavior_boost helper =====
-- 입력: behavior_score (0~100), confidence (0~1)
-- 출력: boost numeric, normalized × cap(confidence)
-- cap: <0.20 → 2, <0.40 → 4, <0.60 → 6, <0.80 → 8, ≥0.80 → 10
create or replace function public._compute_behavior_boost(p_behavior_score numeric, p_confidence numeric)
returns numeric language sql immutable parallel safe as $$
  select round(
    ((coalesce(p_behavior_score, 50) - 50) / 50.0) *
    case
      when coalesce(p_confidence, 0) < 0.20 then 2
      when coalesce(p_confidence, 0) < 0.40 then 4
      when coalesce(p_confidence, 0) < 0.60 then 6
      when coalesce(p_confidence, 0) < 0.80 then 8
      else 10
    end::numeric, 2);
$$;

-- ===== C. admin_recompute_behavior_boosts =====
-- 모든 playlist_track_fit_scores 행에 대해 behavior_boost + final_fit_score 갱신.
-- fit_score 는 절대 건드리지 않음 (별도 컬럼만 update).
create or replace function public.admin_recompute_behavior_boosts(p_window_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_updated int;
  v_start timestamptz := clock_timestamp();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  with src as (
    select fs.playlist_id, fs.track_id,
           b.behavior_score as track_b_score, b.confidence,
           public._compute_behavior_boost(b.behavior_score, b.confidence) as boost
    from public.playlist_track_fit_scores fs
    left join public.track_behavior_scores b
      on b.track_id = fs.track_id and b.window_days = p_window_days
  )
  update public.playlist_track_fit_scores fs
  set track_behavior_score = src.track_b_score,
      behavior_confidence = src.confidence,
      behavior_boost = src.boost,
      final_fit_score = case when src.boost is not null
                              then greatest(0, least(100, fs.fit_score + src.boost))
                              else fs.fit_score end
  from src
  where fs.playlist_id = src.playlist_id and fs.track_id = src.track_id;
  get diagnostics v_updated = row_count;

  insert into public.admin_bulk_operation_audit(
    admin_id, operation_type, track_count, params_json, after_json, status, completed_at
  ) values (
    v_admin, 'recompute_behavior_boosts', v_updated,
    jsonb_build_object('window_days', p_window_days),
    jsonb_build_object('rows_updated', v_updated,
      'elapsed_ms', extract(milliseconds from clock_timestamp() - v_start)::int),
    'completed', now()
  );

  return jsonb_build_object('ok', true, 'rows_updated', v_updated,
    'elapsed_ms', extract(milliseconds from clock_timestamp() - v_start)::int);
end; $$;

-- ===== D. admin_list_promotion_candidates =====
-- behavior_score >= 70 AND confidence >= 0.30 — 운영자에게 승격 추천
create or replace function public.admin_list_promotion_candidates(
  p_min_behavior numeric default 70, p_min_confidence numeric default 0.30, p_limit int default 100
) returns table (
  track_id uuid, title text, artist text, main_genre text,
  behavior_score numeric, confidence numeric, play_count int,
  completion_rate numeric, skip_rate numeric, like_rate numeric,
  avg_fit_score numeric, avg_final_fit_score numeric, avg_boost numeric,
  current_placement_count int
)
language sql security definer set search_path = public stable as $$
  select b.track_id, t.title, t.artist, t.main_genre,
    b.behavior_score, b.confidence, b.play_count,
    b.completion_rate, b.skip_rate, b.like_rate,
    coalesce(round(avg(fs.fit_score), 2), 0) as avg_fit_score,
    coalesce(round(avg(fs.final_fit_score), 2), 0) as avg_final_fit_score,
    coalesce(round(avg(fs.behavior_boost), 2), 0) as avg_boost,
    coalesce(count(distinct pt.playlist_id) filter (where pt.id is not null), 0)::int as current_placement_count
  from public.track_behavior_scores b
  join public.tracks t on t.id = b.track_id and t.removed_at is null
  left join public.playlist_track_fit_scores fs on fs.track_id = b.track_id
  left join public.playlist_tracks pt on pt.track_id = b.track_id
  where b.window_days = 30
    and b.behavior_score >= p_min_behavior
    and b.confidence >= p_min_confidence
  group by b.track_id, t.title, t.artist, t.main_genre,
           b.behavior_score, b.confidence, b.play_count,
           b.completion_rate, b.skip_rate, b.like_rate
  order by b.behavior_score desc, b.confidence desc
  limit greatest(p_limit, 1);
$$;

-- ===== E. admin_list_demotion_candidates =====
create or replace function public.admin_list_demotion_candidates(
  p_max_behavior numeric default 30, p_min_confidence numeric default 0.30, p_limit int default 100
) returns table (
  track_id uuid, title text, artist text, main_genre text,
  behavior_score numeric, confidence numeric, play_count int,
  completion_rate numeric, skip_rate numeric, like_rate numeric,
  avg_fit_score numeric, avg_final_fit_score numeric, avg_boost numeric,
  current_placement_count int
)
language sql security definer set search_path = public stable as $$
  select b.track_id, t.title, t.artist, t.main_genre,
    b.behavior_score, b.confidence, b.play_count,
    b.completion_rate, b.skip_rate, b.like_rate,
    coalesce(round(avg(fs.fit_score), 2), 0) as avg_fit_score,
    coalesce(round(avg(fs.final_fit_score), 2), 0) as avg_final_fit_score,
    coalesce(round(avg(fs.behavior_boost), 2), 0) as avg_boost,
    coalesce(count(distinct pt.playlist_id) filter (where pt.id is not null), 0)::int as current_placement_count
  from public.track_behavior_scores b
  join public.tracks t on t.id = b.track_id and t.removed_at is null
  left join public.playlist_track_fit_scores fs on fs.track_id = b.track_id
  left join public.playlist_tracks pt on pt.track_id = b.track_id
  where b.window_days = 30
    and b.behavior_score <= p_max_behavior
    and b.confidence >= p_min_confidence
  group by b.track_id, t.title, t.artist, t.main_genre,
           b.behavior_score, b.confidence, b.play_count,
           b.completion_rate, b.skip_rate, b.like_rate
  order by b.behavior_score asc, b.confidence desc
  limit greatest(p_limit, 1);
$$;

-- ===== F. admin_list_behavior_comparison (20 대표 트랙) =====
-- 행동 인사이트 패널 메인 테이블
create or replace function public.admin_list_behavior_comparison(p_limit int default 50)
returns table (
  track_id uuid, title text, artist text, main_genre text,
  play_count int, confidence numeric, behavior_score numeric,
  avg_fit_score numeric, avg_final_fit_score numeric, avg_boost numeric,
  is_promotion_candidate boolean, is_demotion_candidate boolean
)
language sql security definer set search_path = public stable as $$
  select b.track_id, t.title, t.artist, t.main_genre,
    b.play_count, b.confidence, b.behavior_score,
    coalesce(round(avg(fs.fit_score), 2), 0) as avg_fit_score,
    coalesce(round(avg(fs.final_fit_score), 2), 0) as avg_final_fit_score,
    coalesce(round(avg(fs.behavior_boost), 2), 0) as avg_boost,
    (b.behavior_score >= 70 and b.confidence >= 0.30) as is_promotion_candidate,
    (b.behavior_score <= 30 and b.confidence >= 0.30) as is_demotion_candidate
  from public.track_behavior_scores b
  join public.tracks t on t.id = b.track_id and t.removed_at is null
  left join public.playlist_track_fit_scores fs on fs.track_id = b.track_id
  where b.window_days = 30
  group by b.track_id, t.title, t.artist, t.main_genre,
           b.play_count, b.confidence, b.behavior_score
  order by b.play_count desc, b.behavior_score desc
  limit greatest(p_limit, 1);
$$;

-- ===== G. QC Rules — 2 신규 outlier 룰 추가 =====
insert into public.admin_qc_rules (rule_key, name, description, issue_type, severity, source, condition_json, is_active)
values
  ('behavior_positive_outlier', '긍정 outlier (승격 후보)',
   'behavior_score >= 70 AND confidence >= 0.30 — 운영자 승격 검토 권장',
   'behavior_positive_outlier', 'MEDIUM', 'behavior',
   jsonb_build_object('condition', 'behavior_score >= 70 AND confidence >= 0.30', 'window_days', 30),
   true),
  ('behavior_negative_outlier', '부정 outlier (강등 후보)',
   'behavior_score <= 30 AND confidence >= 0.30 — 운영자 강등 검토 권장',
   'behavior_negative_outlier', 'MEDIUM', 'behavior',
   jsonb_build_object('condition', 'behavior_score <= 30 AND confidence >= 0.30', 'window_days', 30),
   true)
on conflict (rule_key) do nothing;

-- admin_generate_qc_queue_candidates v5: 2 outlier 룰 추가
-- (기존 14 룰 본문 그대로 유지 + behavior_positive/negative_outlier 2 룰 추가)
create or replace function public.admin_generate_qc_queue_candidates()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_admin uuid := auth.uid(); v_counts jsonb := '{}'::jsonb; v_n int; r record;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  select * into r from public.admin_qc_rules where rule_key='placement_rock_in_lounge';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct on (t.id) t.id, r.rule_key, r.severity, r.source,
      format('Rock 트랙이 %s 플레이리스트에 배치됨', pl.business_category),
      jsonb_build_object('main_genre', t.main_genre, 'playlist_id', pl.id,
                         'playlist_title', pl.title, 'business_category', pl.business_category)
    from public.tracks t join public.playlist_tracks pt on pt.track_id = t.id
    join public.playlists pl on pl.id = pt.playlist_id
    where (lower(coalesce(t.main_genre,'')) like '%rock%' or lower(coalesce(t.sub_genre,'')) like '%rock%')
      and pl.business_category in ('호텔','와인바','병원') and t.removed_at is null
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='placement_energetic_in_hospital';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct on (t.id) t.id, r.rule_key, r.severity, r.source,
      'Electronic/energetic 트랙이 병원 플레이리스트에 배치됨',
      jsonb_build_object('main_genre', t.main_genre, 'mood', t.mood,
        'playlist_id', pl.id, 'playlist_title', pl.title)
    from public.tracks t join public.playlist_tracks pt on pt.track_id = t.id
    join public.playlists pl on pl.id = pt.playlist_id
    where (lower(coalesce(t.main_genre,'')) like '%electronic%'
           or lower(coalesce(t.mood,'')) in ('energetic','exciting')
           or 'energetic' = any(coalesce(t.mood_tags,'{}'::text[]))
           or 'exciting' = any(coalesce(t.mood_tags,'{}'::text[])))
      and pl.business_category = '병원' and t.removed_at is null
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='placement_fitness_in_relaxed';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct on (t.id) t.id, r.rule_key, r.severity, r.source,
      format('헬스장/피트니스 트랙이 %s 등 부적합 장소에 배치됨', pl.business_category),
      jsonb_build_object('suitable_store', t.suitable_store,
        'playlist_id', pl.id, 'business_category', pl.business_category)
    from public.tracks t join public.playlist_tracks pt on pt.track_id = t.id
    join public.playlists pl on pl.id = pt.playlist_id
    where t.suitable_store in ('헬스장','피트니스','fitness')
      and pl.business_category in ('병원','호텔','와인바','카페','라운지') and t.removed_at is null
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='placement_predicted_mismatch';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct on (t.id) t.id, r.rule_key, r.severity, r.source,
      format('AI 예측 매장 (%s) 과 배치된 %s 가 모두 불일치',
        array_to_string(p.predicted_store_types,','), pl.business_category),
      jsonb_build_object('predicted_store_types', p.predicted_store_types,
        'business_category', pl.business_category,
        'normalized_slug', public.normalize_store_label(pl.business_category))
    from public.tracks t join public.playlist_tracks pt on pt.track_id = t.id
    join public.playlists pl on pl.id = pt.playlist_id
    join public.track_ai_predictions p on p.track_id = t.id and p.model_version='taxonomy-v1'
    where p.predicted_store_types is not null and array_length(p.predicted_store_types,1) > 0
      and t.removed_at is null
      and public.normalize_store_label(pl.business_category) is not null
      and not (public.normalize_store_label(pl.business_category) = any(p.predicted_store_types))
      and p.store_type_confidence >= 0.7
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='fingerprint_failed';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select f.track_id, r.rule_key, r.severity, r.source,
      format('Chromaprint 디코딩 실패 (retry %s회)', f.retry_count),
      jsonb_build_object('retry_count', f.retry_count, 'content_type', f.download_content_type,
                         'download_size_bytes', f.download_size_bytes,
                         'fingerprint_error', left(coalesce(f.fingerprint_error,''), 300))
    from public.audio_fingerprints f
    join public.tracks t on t.id = f.track_id and t.removed_at is null
    where f.fingerprint_status = 'failed' and f.retry_count >= 2
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='fingerprint_duplicate';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct on (a.track_id) a.track_id, r.rule_key,
      case when a.fingerprint_hash = b.fingerprint_hash
           or public._audio_fingerprint_similarity(a.fingerprint, b.fingerprint) >= 0.95
           then 'CRITICAL' else r.severity end,
      r.source,
      format('동일/유사 음원 후보 발견 (sim=%s)',
             case when a.fingerprint_hash = b.fingerprint_hash then '1.0000'
                  else round(public._audio_fingerprint_similarity(a.fingerprint, b.fingerprint), 4)::text end),
      jsonb_build_object('candidate_track_id', b.track_id,
        'similarity', case when a.fingerprint_hash = b.fingerprint_hash then 1.0
                           else public._audio_fingerprint_similarity(a.fingerprint, b.fingerprint) end,
        'hash_exact', a.fingerprint_hash = b.fingerprint_hash,
        'duration_a', a.duration_seconds, 'duration_b', b.duration_seconds)
    from public.audio_fingerprints a
    join public.audio_fingerprints b on b.track_id > a.track_id
      and abs(coalesce(a.duration_seconds,0) - coalesce(b.duration_seconds,0)) < 3.0
    join public.tracks ta on ta.id = a.track_id and ta.removed_at is null
    join public.tracks tb on tb.id = b.track_id and tb.removed_at is null
    where a.fingerprint_status='success' and b.fingerprint_status='success'
      and (a.fingerprint_hash = b.fingerprint_hash
           or public._audio_fingerprint_similarity(a.fingerprint, b.fingerprint) >= 0.90)
    order by a.track_id, public._audio_fingerprint_similarity(a.fingerprint, b.fingerprint) desc
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='confidence_low_genre';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select p.track_id, r.rule_key, r.severity, r.source,
      format('genre_confidence %s 미만', round(p.genre_confidence,2)),
      jsonb_build_object('genre_confidence', p.genre_confidence, 'predicted_main_genre', p.predicted_main_genre)
    from public.track_ai_predictions p
    join public.tracks t on t.id = p.track_id and t.removed_at is null
    where p.model_version='taxonomy-v1' and p.genre_confidence < 0.5
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='confidence_low_mood';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select p.track_id, r.rule_key, r.severity, r.source,
      format('mood_confidence %s 미만', round(p.mood_confidence,2)),
      jsonb_build_object('mood_confidence', p.mood_confidence, 'predicted_moods', p.predicted_moods)
    from public.track_ai_predictions p
    join public.tracks t on t.id = p.track_id and t.removed_at is null
    where p.model_version='taxonomy-v1' and p.mood_confidence < 0.5
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='confidence_low_store';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select p.track_id, r.rule_key, r.severity, r.source,
      format('store_type_confidence %s 미만', round(p.store_type_confidence,2)),
      jsonb_build_object('store_type_confidence', p.store_type_confidence,
                         'predicted_store_types', p.predicted_store_types)
    from public.track_ai_predictions p
    join public.tracks t on t.id = p.track_id and t.removed_at is null
    where p.model_version='taxonomy-v1' and p.store_type_confidence < 0.5
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='meta_conflict_genre';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
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
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='exclusion_conflict';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
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
    where public._track_is_excluded_from_playlist(pt.track_id, pl.id)
    group by pt.track_id
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='behavior_high_skip';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select b.track_id, r.rule_key, r.severity, r.source,
      format('skip_rate %s%% (play_count %s)', round(b.skip_rate*100,1), b.play_count),
      jsonb_build_object('skip_rate', b.skip_rate, 'play_count', b.play_count,
                         'completion_rate', b.completion_rate, 'window_days', b.window_days)
    from public.track_behavior_scores b
    join public.tracks t on t.id = b.track_id and t.removed_at is null
    where b.window_days = 30 and b.play_count >= 30 and b.skip_rate > 0.7
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='behavior_low_completion';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select b.track_id, r.rule_key, r.severity, r.source,
      format('completion_rate %s%% (play_count %s)', round(b.completion_rate*100,1), b.play_count),
      jsonb_build_object('completion_rate', b.completion_rate, 'play_count', b.play_count,
                         'skip_rate', b.skip_rate, 'window_days', b.window_days)
    from public.track_behavior_scores b
    join public.tracks t on t.id = b.track_id and t.removed_at is null
    where b.window_days = 30 and b.play_count >= 30 and b.completion_rate < 0.25
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='store_mismatch_behavior';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct b.track_id, r.rule_key, r.severity, r.source,
      format('매장 "%s" 에서 completion_rate 낮음 (%s)', sb.key, sb.value->>'completion_rate'),
      jsonb_build_object('matched_store', sb.key, 'breakdown', sb.value, 'window_days', b.window_days)
    from public.track_behavior_scores b
    join public.tracks t on t.id = b.track_id and t.removed_at is null
    cross join lateral jsonb_each(coalesce(b.store_breakdown_json,'{}'::jsonb)) sb
    where b.window_days = 30
      and (sb.value->>'play_count')::int >= 10
      and (sb.value->>'completion_rate')::numeric < 0.3
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  -- 🆕 X4.1 behavior outlier 2 룰
  select * into r from public.admin_qc_rules where rule_key='behavior_positive_outlier';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select b.track_id, r.rule_key, r.severity, r.source,
      format('승격 후보: behavior_score %s, confidence %s', round(b.behavior_score,1), round(b.confidence,2)),
      jsonb_build_object('behavior_score', b.behavior_score, 'confidence', b.confidence,
                         'completion_rate', b.completion_rate, 'like_rate', b.like_rate,
                         'play_count', b.play_count, 'window_days', b.window_days)
    from public.track_behavior_scores b
    join public.tracks t on t.id = b.track_id and t.removed_at is null
    where b.window_days = 30 and b.behavior_score >= 70 and b.confidence >= 0.30
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='behavior_negative_outlier';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select b.track_id, r.rule_key, r.severity, r.source,
      format('강등 후보: behavior_score %s, confidence %s', round(b.behavior_score,1), round(b.confidence,2)),
      jsonb_build_object('behavior_score', b.behavior_score, 'confidence', b.confidence,
                         'skip_rate', b.skip_rate, 'completion_rate', b.completion_rate,
                         'play_count', b.play_count, 'window_days', b.window_days)
    from public.track_behavior_scores b
    join public.tracks t on t.id = b.track_id and t.removed_at is null
    where b.window_days = 30 and b.behavior_score <= 30 and b.confidence >= 0.30
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  insert into public.admin_bulk_operation_audit(
    admin_id, operation_type, track_count, params_json, after_json, status, completed_at
  ) values (v_admin, 'qc_queue_generate', 0, null,
    jsonb_build_object('by_rule', v_counts), 'completed', now());

  return jsonb_build_object('ok', true, 'by_rule', v_counts,
    'generated_total', (
      select coalesce(sum(case when value::text ~ '^[0-9]+$' then (value::text)::int else 0 end), 0)
      from jsonb_each(v_counts)
    ));
end; $$;

-- ===== H. 권한 =====
revoke all on function public._compute_behavior_boost(numeric, numeric) from public, anon;
revoke all on function public.admin_recompute_behavior_boosts(int) from public, anon;
revoke all on function public.admin_list_promotion_candidates(numeric, numeric, int) from public, anon;
revoke all on function public.admin_list_demotion_candidates(numeric, numeric, int) from public, anon;
revoke all on function public.admin_list_behavior_comparison(int) from public, anon;

grant execute on function public._compute_behavior_boost(numeric, numeric) to authenticated, service_role;
grant execute on function public.admin_recompute_behavior_boosts(int) to authenticated, service_role;
grant execute on function public.admin_list_promotion_candidates(numeric, numeric, int) to authenticated, service_role;
grant execute on function public.admin_list_demotion_candidates(numeric, numeric, int) to authenticated, service_role;
grant execute on function public.admin_list_behavior_comparison(int) to authenticated, service_role;
