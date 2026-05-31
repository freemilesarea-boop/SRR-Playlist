-- 0249 — Phase X3.4 QC Rule Management System
--
-- 목표: 0248 에서 하드코딩된 QC 룰을 admin_qc_rules 테이블로 외부화.
--       관리자가 UI 에서 활성/비활성, severity, description 변경 가능.
--
-- 정책:
--   - SQL body 는 함수 안에 유지 (안정성). 룰 테이블은 metadata 만 (is_active, severity, description, condition_json 표시용).
--   - 자동 삭제/차단/반려 금지. 룰 제어는 큐 생성 여부만.

-- ===== A. admin_qc_rules =====
create table if not exists public.admin_qc_rules (
  id             uuid primary key default gen_random_uuid(),
  rule_key       text not null unique,
  name           text not null,
  description    text,
  issue_type     text not null,
  severity       text not null check (severity in ('LOW','MEDIUM','HIGH','CRITICAL')),
  source         text not null check (source in ('rule','ai','chromaprint','fingerprint','placement','manual')),
  condition_json jsonb,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists ix_qc_rules_active on public.admin_qc_rules(is_active);

alter table public.admin_qc_rules enable row level security;
drop policy if exists "qc rules admin all" on public.admin_qc_rules;
create policy "qc rules admin all" on public.admin_qc_rules for all to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== B. admin_qc_rule_audit =====
create table if not exists public.admin_qc_rule_audit (
  id          uuid primary key default gen_random_uuid(),
  rule_id     uuid references public.admin_qc_rules(id) on delete cascade,
  rule_key    text,
  admin_id    uuid references public.users(id) on delete set null,
  action_type text not null,
  before_json jsonb,
  after_json  jsonb,
  reason      text,
  created_at  timestamptz not null default now()
);

create index if not exists ix_qc_rule_audit_rule on public.admin_qc_rule_audit(rule_id, created_at desc);

alter table public.admin_qc_rule_audit enable row level security;
drop policy if exists "qc rule audit admin read" on public.admin_qc_rule_audit;
create policy "qc rule audit admin read" on public.admin_qc_rule_audit for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== C. Seed 11 룰 =====
insert into public.admin_qc_rules (rule_key, name, description, issue_type, severity, source, condition_json, is_active)
values
  ('placement_rock_in_lounge', 'Rock 트랙이 호텔/와인바/병원 배치',
   'Rock 또는 J-Rock 류 트랙이 분위기 맞지 않는 호텔/와인바/병원 플레이리스트에 배치된 경우',
   'placement_rock_in_lounge', 'HIGH', 'placement',
   jsonb_build_object('condition', 'main_genre ILIKE %rock% AND playlist.business_category IN (호텔,와인바,병원)',
                      'dedup', 'DISTINCT ON track_id'),
   true),
  ('placement_energetic_in_hospital', 'Electronic/energetic 트랙이 병원 배치',
   'Electronic 장르 또는 energetic/exciting 무드 트랙이 병원 플레이리스트에 배치',
   'placement_energetic_in_hospital', 'HIGH', 'placement',
   jsonb_build_object('condition', '(main_genre ILIKE %electronic% OR mood IN (energetic,exciting)) AND business_category=병원'),
   true),
  ('placement_fitness_in_relaxed', '헬스/피트니스 트랙이 차분한 매장 배치',
   '헬스장/피트니스 적합 트랙이 병원/호텔/와인바/카페/라운지 등 차분한 매장에 배치',
   'placement_fitness_in_relaxed', 'MEDIUM', 'placement',
   jsonb_build_object('condition', 'suitable_store IN (헬스장,피트니스,fitness) AND business_category IN (병원,호텔,와인바,카페,라운지)'),
   true),
  ('placement_predicted_mismatch', 'AI 예측 매장 ≠ 실제 배치 매장',
   'predicted_store_types top1~3 어디에도 해당 playlist 의 normalized_store_label 이 없음 (confidence ≥ 0.7)',
   'placement_predicted_mismatch', 'MEDIUM', 'ai',
   jsonb_build_object('condition', 'normalize_store_label(business_category) NOT IN predicted_store_types AND store_type_confidence >= 0.7'),
   true),
  ('fingerprint_failed', 'Chromaprint 디코딩 실패',
   '오디오 지문 추출 실패 (fpcalc + ffmpeg 양쪽 실패), retry_count ≥ 2',
   'fingerprint_failed', 'HIGH', 'fingerprint',
   jsonb_build_object('condition', 'fingerprint_status=failed AND retry_count >= 2'),
   true),
  ('fingerprint_duplicate', 'Chromaprint 중복/유사 음원',
   '동일/유사 음원 후보 발견 (similarity ≥ 0.90, sim ≥ 0.95 또는 hash_exact → CRITICAL)',
   'fingerprint_duplicate', 'HIGH', 'chromaprint',
   jsonb_build_object('condition', 'similarity(a,b) >= 0.90 OR hash_exact, duration_delta < 3s',
                      'severity_upgrade', 'CRITICAL if sim>=0.95 or hash_exact'),
   true),
  ('confidence_low_genre', '장르 신뢰도 < 0.5',
   'AI taxonomy-v1 의 genre_confidence 가 0.5 미만 — 메타 검증 필요',
   'confidence_low_genre', 'MEDIUM', 'ai',
   jsonb_build_object('condition', 'genre_confidence < 0.5'),
   true),
  ('confidence_low_mood', '무드 신뢰도 < 0.5',
   'AI taxonomy-v1 의 mood_confidence 가 0.5 미만',
   'confidence_low_mood', 'MEDIUM', 'ai',
   jsonb_build_object('condition', 'mood_confidence < 0.5'),
   true),
  ('confidence_low_store', '매장 신뢰도 < 0.5',
   'AI taxonomy-v1 의 store_type_confidence 가 0.5 미만',
   'confidence_low_store', 'MEDIUM', 'ai',
   jsonb_build_object('condition', 'store_type_confidence < 0.5'),
   true),
  ('meta_conflict_genre', '메타 장르 불일치',
   'Manual main_genre 와 AI predicted_main_genre (name_ko) 가 불일치 (conf ≥ 0.7)',
   'meta_conflict_genre', 'LOW', 'ai',
   jsonb_build_object('condition', 'lower(manual_genre) != lower(predicted_name_ko) AND genre_confidence >= 0.7'),
   true),
  ('exclusion_conflict', '금지 장소 배치 잔존',
   'track_store_exclusions 활성 상태인데 playlist_tracks 가 아직 매칭 매장에 남아있음',
   'exclusion_conflict', 'HIGH', 'rule',
   jsonb_build_object('condition', 'exists(active exclusion) AND _track_is_excluded_from_playlist(track, playlist)'),
   true)
on conflict (rule_key) do nothing;

-- ===== D. admin_generate_qc_queue_candidates v3 (X3.4) =====
-- 각 룰을 admin_qc_rules 에서 lookup → is_active 일 때만 실행.
-- severity 는 룰 테이블 값 사용 (fingerprint_duplicate 만 CRITICAL upgrade 인라인).
create or replace function public.admin_generate_qc_queue_candidates()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_counts jsonb := '{}'::jsonb;
  v_n int;
  r record;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  -- A1. placement_rock_in_lounge
  select * into r from public.admin_qc_rules where rule_key='placement_rock_in_lounge';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct on (t.id) t.id, r.rule_key, r.severity, r.source,
      format('Rock 트랙이 %s 플레이리스트에 배치됨', pl.business_category),
      jsonb_build_object('main_genre', t.main_genre, 'playlist_id', pl.id,
                         'playlist_title', pl.title, 'business_category', pl.business_category)
    from public.tracks t
    join public.playlist_tracks pt on pt.track_id = t.id
    join public.playlists pl on pl.id = pt.playlist_id
    where (lower(coalesce(t.main_genre,'')) like '%rock%' or lower(coalesce(t.sub_genre,'')) like '%rock%')
      and pl.business_category in ('호텔','와인바','병원')
      and t.removed_at is null
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else
    v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive');
  end if;

  -- A2. placement_energetic_in_hospital
  select * into r from public.admin_qc_rules where rule_key='placement_energetic_in_hospital';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct on (t.id) t.id, r.rule_key, r.severity, r.source,
      'Electronic/energetic 트랙이 병원 플레이리스트에 배치됨',
      jsonb_build_object('main_genre', t.main_genre, 'mood', t.mood,
        'playlist_id', pl.id, 'playlist_title', pl.title)
    from public.tracks t
    join public.playlist_tracks pt on pt.track_id = t.id
    join public.playlists pl on pl.id = pt.playlist_id
    where (lower(coalesce(t.main_genre,'')) like '%electronic%'
           or lower(coalesce(t.mood,'')) in ('energetic','exciting')
           or 'energetic' = any(coalesce(t.mood_tags,'{}'::text[]))
           or 'exciting' = any(coalesce(t.mood_tags,'{}'::text[])))
      and pl.business_category = '병원' and t.removed_at is null
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else
    v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive');
  end if;

  -- A3. placement_fitness_in_relaxed
  select * into r from public.admin_qc_rules where rule_key='placement_fitness_in_relaxed';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct on (t.id) t.id, r.rule_key, r.severity, r.source,
      format('헬스장/피트니스 트랙이 %s 등 부적합 장소에 배치됨', pl.business_category),
      jsonb_build_object('suitable_store', t.suitable_store,
        'playlist_id', pl.id, 'business_category', pl.business_category)
    from public.tracks t
    join public.playlist_tracks pt on pt.track_id = t.id
    join public.playlists pl on pl.id = pt.playlist_id
    where t.suitable_store in ('헬스장','피트니스','fitness')
      and pl.business_category in ('병원','호텔','와인바','카페','라운지')
      and t.removed_at is null
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else
    v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive');
  end if;

  -- A4. placement_predicted_mismatch
  select * into r from public.admin_qc_rules where rule_key='placement_predicted_mismatch';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct on (t.id) t.id, r.rule_key, r.severity, r.source,
      format('AI 예측 매장 (%s) 과 배치된 %s 가 모두 불일치',
        array_to_string(p.predicted_store_types,','), pl.business_category),
      jsonb_build_object('predicted_store_types', p.predicted_store_types,
        'business_category', pl.business_category,
        'normalized_slug', public.normalize_store_label(pl.business_category))
    from public.tracks t
    join public.playlist_tracks pt on pt.track_id = t.id
    join public.playlists pl on pl.id = pt.playlist_id
    join public.track_ai_predictions p on p.track_id = t.id and p.model_version='taxonomy-v1'
    where p.predicted_store_types is not null and array_length(p.predicted_store_types,1) > 0
      and t.removed_at is null
      and public.normalize_store_label(pl.business_category) is not null
      and not (public.normalize_store_label(pl.business_category) = any(p.predicted_store_types))
      and p.store_type_confidence >= 0.7
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else
    v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive');
  end if;

  -- B1. fingerprint_failed
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
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else
    v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive');
  end if;

  -- B2. fingerprint_duplicate (CRITICAL 업그레이드)
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
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else
    v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive');
  end if;

  -- C1. confidence_low_genre
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
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else
    v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive');
  end if;

  -- C2. confidence_low_mood
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
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else
    v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive');
  end if;

  -- C3. confidence_low_store
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
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else
    v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive');
  end if;

  -- D. meta_conflict_genre
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
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else
    v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive');
  end if;

  -- E. exclusion_conflict
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
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else
    v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive');
  end if;

  insert into public.admin_bulk_operation_audit(
    admin_id, operation_type, track_count, params_json, after_json, status, completed_at
  ) values (
    v_admin, 'qc_queue_generate', 0, null,
    jsonb_build_object('by_rule', v_counts), 'completed', now()
  );

  return jsonb_build_object('ok', true, 'by_rule', v_counts,
    'generated_total', (
      select coalesce(sum(case when value::text ~ '^[0-9]+$' then (value::text)::int else 0 end), 0)
      from jsonb_each(v_counts)
    ));
end; $$;

-- ===== E. admin_list_qc_rules — 룰 + open count =====
create or replace function public.admin_list_qc_rules()
returns table (
  id uuid, rule_key text, name text, description text,
  issue_type text, severity text, source text,
  condition_json jsonb, is_active boolean,
  open_count int, created_at timestamptz, updated_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select r.id, r.rule_key, r.name, r.description,
         r.issue_type, r.severity, r.source,
         r.condition_json, r.is_active,
         (select count(*)::int from public.admin_qc_queue q
          where q.issue_type = r.issue_type and q.status='open') as open_count,
         r.created_at, r.updated_at
  from public.admin_qc_rules r
  order by r.severity, r.rule_key;
$$;

-- ===== F. admin_update_qc_rule (toggle / severity / description / name) =====
create or replace function public.admin_update_qc_rule(
  p_id uuid,
  p_is_active boolean default null,
  p_severity text default null,
  p_description text default null,
  p_name text default null,
  p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_before jsonb; v_after jsonb;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_severity is not null and p_severity not in ('LOW','MEDIUM','HIGH','CRITICAL') then
    raise exception 'invalid severity: %', p_severity;
  end if;

  select to_jsonb(r) into v_before from public.admin_qc_rules r where r.id = p_id;
  if v_before is null then raise exception 'rule not found: %', p_id; end if;

  update public.admin_qc_rules set
    is_active = coalesce(p_is_active, is_active),
    severity = coalesce(p_severity, severity),
    description = coalesce(p_description, description),
    name = coalesce(p_name, name),
    updated_at = now()
  where id = p_id;

  select to_jsonb(r) into v_after from public.admin_qc_rules r where r.id = p_id;

  insert into public.admin_qc_rule_audit(rule_id, rule_key, admin_id, action_type, before_json, after_json, reason)
  values (p_id, v_after->>'rule_key', v_admin, 'update', v_before, v_after, p_reason);

  return jsonb_build_object('ok', true, 'before', v_before, 'after', v_after);
end; $$;

-- ===== G. admin_list_qc_rule_audit =====
create or replace function public.admin_list_qc_rule_audit(p_rule_id uuid default null, p_limit int default 100)
returns table (
  id uuid, rule_id uuid, rule_key text, admin_name text,
  action_type text, before_json jsonb, after_json jsonb,
  reason text, created_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select a.id, a.rule_id, a.rule_key, u.full_name,
         a.action_type, a.before_json, a.after_json, a.reason, a.created_at
  from public.admin_qc_rule_audit a
  left join public.users u on u.id = a.admin_id
  where (p_rule_id is null or a.rule_id = p_rule_id)
  order by a.created_at desc
  limit greatest(p_limit, 1);
$$;

-- ===== H. 권한 =====
revoke all on function public.admin_list_qc_rules() from public, anon;
revoke all on function public.admin_update_qc_rule(uuid, boolean, text, text, text, text) from public, anon;
revoke all on function public.admin_list_qc_rule_audit(uuid, int) from public, anon;

grant execute on function public.admin_list_qc_rules() to authenticated, service_role;
grant execute on function public.admin_update_qc_rule(uuid, boolean, text, text, text, text) to authenticated, service_role;
grant execute on function public.admin_list_qc_rule_audit(uuid, int) to authenticated, service_role;
