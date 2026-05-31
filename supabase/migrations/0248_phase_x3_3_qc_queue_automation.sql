-- 0248 — Phase X3.3 QC Queue Automation
--
-- 목표: AI/룰 기반 위험 후보 자동 감지 → admin_qc_queue 적재 → 운영자 검수.
--
-- 절대 원칙 (사용자 spec):
--   - 큐 생성만. playlist_tracks 삭제/메타 수정/자동 반려 금지.
--   - 동일 (track_id, issue_type, status='open') 중복 INSERT 금지.
--
-- 구성:
--   A. admin_qc_queue (이슈 큐 본체)
--   B. admin_generate_qc_queue_candidates (모든 룰 일괄 실행)
--   C. admin_list_qc_queue / admin_qc_queue_summary
--   D. admin_assign / admin_resolve / admin_dismiss / admin_reopen
--   E. 권한

-- ===== A. admin_qc_queue =====
create table if not exists public.admin_qc_queue (
  id            uuid primary key default gen_random_uuid(),
  track_id      uuid not null references public.tracks(id) on delete cascade,
  issue_type    text not null,
  severity      text not null check (severity in ('LOW','MEDIUM','HIGH','CRITICAL')),
  source        text not null check (source in ('rule','ai','chromaprint','fingerprint','placement','manual')),
  reason        text not null,
  evidence_json jsonb,
  status        text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  assigned_to   uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

-- 중복 방지: 같은 (track_id, issue_type) 가 open 상태로 두 개 존재 금지
create unique index if not exists uq_qc_queue_open
  on public.admin_qc_queue(track_id, issue_type) where status='open';
create index if not exists ix_qc_queue_status on public.admin_qc_queue(status, severity, created_at desc);
create index if not exists ix_qc_queue_type on public.admin_qc_queue(issue_type, status);

alter table public.admin_qc_queue enable row level security;
drop policy if exists "qc queue admin all" on public.admin_qc_queue;
create policy "qc queue admin all" on public.admin_qc_queue for all to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== B. admin_generate_qc_queue_candidates =====
-- 5 룰 그룹 일괄 실행. 모두 INSERT ... WHERE NOT EXISTS 로 중복 회피.
-- 반환: {generated_total, by_rule: {placement_rock_hotel: N, fingerprint_failed: N, ...}}
create or replace function public.admin_generate_qc_queue_candidates()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_counts jsonb := '{}'::jsonb;
  v_n int;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  -- ===== A. Placement Risk: Rock × {hotel, winebar, hospital} =====
  insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
  select distinct t.id, 'placement_rock_in_lounge', 'HIGH', 'placement',
         format('Rock 트랙이 %s 플레이리스트에 배치됨', pl.business_category),
         jsonb_build_object(
           'main_genre', t.main_genre,
           'playlist_id', pl.id, 'playlist_title', pl.title,
           'business_category', pl.business_category,
           'matched_rule', 'rock_in_lounge'
         )
  from public.tracks t
  join public.playlist_tracks pt on pt.track_id = t.id
  join public.playlists pl on pl.id = pt.playlist_id
  where (lower(coalesce(t.main_genre,'')) like '%rock%' or lower(coalesce(t.sub_genre,'')) like '%rock%')
    and pl.business_category in ('호텔','와인바','병원')
    and t.removed_at is null
    and not exists (
      select 1 from public.admin_qc_queue q
      where q.track_id = t.id and q.issue_type = 'placement_rock_in_lounge' and q.status = 'open'
    );
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('placement_rock_in_lounge', v_n);

  -- Electronic / energetic / exciting × 병원
  insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
  select distinct t.id, 'placement_energetic_in_hospital', 'HIGH', 'placement',
         format('Electronic/energetic 트랙이 병원 플레이리스트에 배치됨'),
         jsonb_build_object(
           'main_genre', t.main_genre, 'mood', t.mood,
           'playlist_id', pl.id, 'playlist_title', pl.title,
           'business_category', pl.business_category
         )
  from public.tracks t
  join public.playlist_tracks pt on pt.track_id = t.id
  join public.playlists pl on pl.id = pt.playlist_id
  where (lower(coalesce(t.main_genre,'')) like '%electronic%'
         or lower(coalesce(t.mood,'')) in ('energetic','exciting','exhilarating')
         or 'energetic' = any(coalesce(t.mood_tags,'{}'::text[]))
         or 'exciting' = any(coalesce(t.mood_tags,'{}'::text[])))
    and pl.business_category = '병원'
    and t.removed_at is null
    and not exists (
      select 1 from public.admin_qc_queue q
      where q.track_id = t.id and q.issue_type='placement_energetic_in_hospital' and q.status='open'
    );
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('placement_energetic_in_hospital', v_n);

  -- fitness store track 가 hospital/winebar 에 배치됨 (suitable_store mismatch)
  insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
  select distinct t.id, 'placement_fitness_in_relaxed', 'MEDIUM', 'placement',
         format('헬스장/피트니스 트랙이 %s 에 배치됨', pl.business_category),
         jsonb_build_object(
           'suitable_store', t.suitable_store,
           'playlist_id', pl.id, 'playlist_title', pl.title,
           'business_category', pl.business_category
         )
  from public.tracks t
  join public.playlist_tracks pt on pt.track_id = t.id
  join public.playlists pl on pl.id = pt.playlist_id
  where (t.suitable_store in ('헬스장','피트니스','fitness'))
    and pl.business_category in ('병원','호텔','와인바','카페','라운지')
    and t.removed_at is null
    and not exists (
      select 1 from public.admin_qc_queue q
      where q.track_id = t.id and q.issue_type='placement_fitness_in_relaxed' and q.status='open'
    );
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('placement_fitness_in_relaxed', v_n);

  -- predicted_store_types 와 실제 playlist business_category 완전 불일치
  -- (top1 ~ top3 어디에도 해당 매장 슬러그가 없음)
  insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
  select distinct t.id, 'placement_predicted_mismatch', 'MEDIUM', 'ai',
         format('AI 예측 매장 (%s) 과 배치된 %s 가 모두 불일치',
                array_to_string(p.predicted_store_types,','), pl.business_category),
         jsonb_build_object(
           'predicted_store_types', p.predicted_store_types,
           'playlist_id', pl.id, 'playlist_title', pl.title,
           'business_category', pl.business_category,
           'normalized_slug', public.normalize_store_label(pl.business_category)
         )
  from public.tracks t
  join public.playlist_tracks pt on pt.track_id = t.id
  join public.playlists pl on pl.id = pt.playlist_id
  join public.track_ai_predictions p on p.track_id = t.id and p.model_version='taxonomy-v1'
  where p.predicted_store_types is not null and array_length(p.predicted_store_types,1) > 0
    and t.removed_at is null
    and public.normalize_store_label(pl.business_category) is not null
    and not (public.normalize_store_label(pl.business_category) = any(p.predicted_store_types))
    and p.store_type_confidence >= 0.7
    and not exists (
      select 1 from public.admin_qc_queue q
      where q.track_id = t.id and q.issue_type='placement_predicted_mismatch' and q.status='open'
    );
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('placement_predicted_mismatch', v_n);

  -- ===== B. Fingerprint Risk =====
  -- fingerprint_status='failed', retry_count >= 2
  insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
  select f.track_id, 'fingerprint_failed', 'HIGH', 'fingerprint',
         format('Chromaprint 디코딩 실패 (retry %s회)', f.retry_count),
         jsonb_build_object(
           'fingerprint_error', left(coalesce(f.fingerprint_error,''), 300),
           'retry_count', f.retry_count,
           'download_size_bytes', f.download_size_bytes,
           'content_type', f.download_content_type
         )
  from public.audio_fingerprints f
  join public.tracks t on t.id = f.track_id and t.removed_at is null
  where f.fingerprint_status = 'failed' and f.retry_count >= 2
    and not exists (
      select 1 from public.admin_qc_queue q
      where q.track_id = f.track_id and q.issue_type='fingerprint_failed' and q.status='open'
    );
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('fingerprint_failed', v_n);

  -- duplicate similarity >= 0.95 → CRITICAL, >= 0.90 → HIGH
  -- pair 단위라 source 트랙 기준으로 issue 1건 등록.
  insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
  select distinct on (a.track_id)
    a.track_id, 'fingerprint_duplicate',
    case when public._audio_fingerprint_similarity(a.fingerprint, b.fingerprint) >= 0.95
         or a.fingerprint_hash = b.fingerprint_hash then 'CRITICAL' else 'HIGH' end,
    'chromaprint',
    format('동일/유사 음원 후보 발견 (similarity=%s)',
           case when a.fingerprint_hash = b.fingerprint_hash then '1.0000'
                else public._audio_fingerprint_similarity(a.fingerprint, b.fingerprint)::text end),
    jsonb_build_object(
      'candidate_track_id', b.track_id,
      'similarity', case when a.fingerprint_hash = b.fingerprint_hash then 1.0
                         else public._audio_fingerprint_similarity(a.fingerprint, b.fingerprint) end,
      'hash_exact', a.fingerprint_hash = b.fingerprint_hash,
      'duration_a', a.duration_seconds, 'duration_b', b.duration_seconds
    )
  from public.audio_fingerprints a
  join public.audio_fingerprints b on b.track_id > a.track_id
    and abs(coalesce(a.duration_seconds,0) - coalesce(b.duration_seconds,0)) < 3.0
  join public.tracks ta on ta.id = a.track_id and ta.removed_at is null
  join public.tracks tb on tb.id = b.track_id and tb.removed_at is null
  where a.fingerprint_status='success' and b.fingerprint_status='success'
    and (a.fingerprint_hash = b.fingerprint_hash
         or public._audio_fingerprint_similarity(a.fingerprint, b.fingerprint) >= 0.90)
    and not exists (
      select 1 from public.admin_qc_queue q
      where q.track_id = a.track_id and q.issue_type='fingerprint_duplicate' and q.status='open'
    )
  order by a.track_id, public._audio_fingerprint_similarity(a.fingerprint, b.fingerprint) desc;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('fingerprint_duplicate', v_n);

  -- ===== C. Confidence Risk =====
  insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
  select p.track_id, 'confidence_low_genre', 'MEDIUM', 'ai',
         format('genre_confidence %s 미만', round(p.genre_confidence,2)),
         jsonb_build_object('genre_confidence', p.genre_confidence,
                            'predicted_main_genre', p.predicted_main_genre)
  from public.track_ai_predictions p
  join public.tracks t on t.id = p.track_id and t.removed_at is null
  where p.model_version='taxonomy-v1' and p.genre_confidence is not null
    and p.genre_confidence < 0.5
    and not exists (
      select 1 from public.admin_qc_queue q
      where q.track_id = p.track_id and q.issue_type='confidence_low_genre' and q.status='open'
    );
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('confidence_low_genre', v_n);

  insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
  select p.track_id, 'confidence_low_mood', 'MEDIUM', 'ai',
         format('mood_confidence %s 미만', round(p.mood_confidence,2)),
         jsonb_build_object('mood_confidence', p.mood_confidence,
                            'predicted_moods', p.predicted_moods)
  from public.track_ai_predictions p
  join public.tracks t on t.id = p.track_id and t.removed_at is null
  where p.model_version='taxonomy-v1' and p.mood_confidence is not null
    and p.mood_confidence < 0.5
    and not exists (
      select 1 from public.admin_qc_queue q
      where q.track_id = p.track_id and q.issue_type='confidence_low_mood' and q.status='open'
    );
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('confidence_low_mood', v_n);

  insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
  select p.track_id, 'confidence_low_store', 'MEDIUM', 'ai',
         format('store_type_confidence %s 미만', round(p.store_type_confidence,2)),
         jsonb_build_object('store_type_confidence', p.store_type_confidence,
                            'predicted_store_types', p.predicted_store_types)
  from public.track_ai_predictions p
  join public.tracks t on t.id = p.track_id and t.removed_at is null
  where p.model_version='taxonomy-v1' and p.store_type_confidence is not null
    and p.store_type_confidence < 0.5
    and not exists (
      select 1 from public.admin_qc_queue q
      where q.track_id = p.track_id and q.issue_type='confidence_low_store' and q.status='open'
    );
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('confidence_low_store', v_n);

  -- ===== D. Metadata Conflict =====
  -- manual main_genre vs predicted_main_genre name_ko 불일치
  insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
  select t.id, 'meta_conflict_genre', 'LOW', 'ai',
         format('Manual genre "%s" vs AI predicted "%s" 불일치',
                t.main_genre, coalesce(tg.name_ko, p.predicted_main_genre)),
         jsonb_build_object(
           'manual_genre', t.main_genre,
           'predicted_slug', p.predicted_main_genre,
           'predicted_name_ko', tg.name_ko,
           'genre_confidence', p.genre_confidence
         )
  from public.tracks t
  join public.track_ai_predictions p on p.track_id = t.id and p.model_version='taxonomy-v1'
  left join public.taxonomy_genres tg on tg.slug = p.predicted_main_genre
  where t.removed_at is null
    and t.main_genre is not null and p.predicted_main_genre is not null
    and p.genre_confidence >= 0.7
    and lower(btrim(t.main_genre)) <> lower(btrim(coalesce(tg.name_ko, p.predicted_main_genre)))
    and not exists (
      select 1 from public.admin_qc_queue q
      where q.track_id = t.id and q.issue_type='meta_conflict_genre' and q.status='open'
    );
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('meta_conflict_genre', v_n);

  -- ===== E. Exclusion Conflict =====
  -- exclusion 걸렸는데 playlist_tracks 가 아직 남아있음
  insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
  select distinct pt.track_id, 'exclusion_conflict', 'HIGH', 'rule',
         format('금지 장소 (%s) 에 아직 playlist_tracks 남아있음',
                array_to_string(array_agg(distinct e.store_type_slug), ',')),
         jsonb_build_object(
           'active_exclusions', array_agg(distinct e.store_type_slug),
           'misplaced_playlist_ids', array_agg(distinct pl.id::text),
           'misplaced_playlist_titles', array_agg(distinct pl.title)
         )
  from public.playlist_tracks pt
  join public.playlists pl on pl.id = pt.playlist_id
  join public.tracks t on t.id = pt.track_id and t.removed_at is null
  join public.track_store_exclusions e on e.track_id = pt.track_id and e.is_active
  where public._track_is_excluded_from_playlist(pt.track_id, pl.id)
    and not exists (
      select 1 from public.admin_qc_queue q
      where q.track_id = pt.track_id and q.issue_type='exclusion_conflict' and q.status='open'
    )
  group by pt.track_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('exclusion_conflict', v_n);

  -- Bulk audit (admin_bulk_operation_audit)
  insert into public.admin_bulk_operation_audit(
    admin_id, operation_type, track_count, params_json, after_json, status, completed_at
  ) values (
    v_admin, 'qc_queue_generate', 0, null,
    jsonb_build_object('by_rule', v_counts), 'completed', now()
  );

  return jsonb_build_object('ok', true, 'by_rule', v_counts,
    'generated_total', (
      select coalesce(sum((value)::int), 0)
      from jsonb_each_text(v_counts)
    )
  );
end; $$;

-- ===== C. admin_list_qc_queue =====
create or replace function public.admin_list_qc_queue(
  p_status text default 'open',
  p_severity text default null,
  p_issue_type text default null,
  p_source text default null,
  p_limit int default 200
) returns table (
  id uuid, track_id uuid, title text, artist text, main_genre text,
  issue_type text, severity text, source text, reason text, evidence_json jsonb,
  status text, assigned_to_name text, created_at timestamptz, updated_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select q.id, q.track_id, t.title, t.artist, t.main_genre,
         q.issue_type, q.severity, q.source, q.reason, q.evidence_json,
         q.status, u.full_name, q.created_at, q.updated_at
  from public.admin_qc_queue q
  join public.tracks t on t.id = q.track_id
  left join public.users u on u.id = q.assigned_to
  where (p_status is null or p_status = 'all' or q.status = p_status)
    and (p_severity is null or q.severity = p_severity)
    and (p_issue_type is null or q.issue_type = p_issue_type)
    and (p_source is null or q.source = p_source)
  order by
    case q.severity when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end,
    q.created_at desc
  limit greatest(p_limit, 1);
$$;

-- ===== D. admin_qc_queue_summary =====
create or replace function public.admin_qc_queue_summary()
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'total_open',     (select count(*) from public.admin_qc_queue where status='open'),
    'total_reviewing',(select count(*) from public.admin_qc_queue where status='reviewing'),
    'total_resolved', (select count(*) from public.admin_qc_queue where status='resolved'),
    'total_dismissed',(select count(*) from public.admin_qc_queue where status='dismissed'),
    'by_severity', (
      select jsonb_object_agg(severity, cnt) from (
        select severity, count(*) as cnt from public.admin_qc_queue where status='open' group by severity
      ) s
    ),
    'by_issue_type', (
      select jsonb_object_agg(issue_type, cnt) from (
        select issue_type, count(*) as cnt from public.admin_qc_queue where status='open' group by issue_type
      ) s
    ),
    'by_source', (
      select jsonb_object_agg(source, cnt) from (
        select source, count(*) as cnt from public.admin_qc_queue where status='open' group by source
      ) s
    )
  );
$$;

-- ===== E. CRUD =====
create or replace function public.admin_assign_qc_queue(p_id uuid, p_assignee uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_admin uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  update public.admin_qc_queue
  set assigned_to = coalesce(p_assignee, v_admin), status='reviewing', updated_at=now()
  where id = p_id;
end; $$;

create or replace function public.admin_resolve_qc_queue(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_admin uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  update public.admin_qc_queue
  set status='resolved', resolved_at=now(), updated_at=now(),
      evidence_json = coalesce(evidence_json,'{}'::jsonb) || jsonb_build_object('resolve_reason', p_reason, 'resolved_by', v_admin)
  where id = p_id;
end; $$;

create or replace function public.admin_dismiss_qc_queue(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_admin uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  update public.admin_qc_queue
  set status='dismissed', resolved_at=now(), updated_at=now(),
      evidence_json = coalesce(evidence_json,'{}'::jsonb) || jsonb_build_object('dismiss_reason', p_reason, 'dismissed_by', v_admin)
  where id = p_id;
end; $$;

create or replace function public.admin_bulk_resolve_qc_queue(p_ids uuid[], p_status text, p_reason text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_admin uuid := auth.uid(); v_count int;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_status not in ('resolved','dismissed') then
    raise exception 'p_status must be resolved or dismissed';
  end if;
  update public.admin_qc_queue
  set status = p_status, resolved_at = now(), updated_at = now(),
      evidence_json = coalesce(evidence_json,'{}'::jsonb)
        || jsonb_build_object('bulk_status_reason', p_reason, 'bulk_actor', v_admin)
  where id = any(p_ids) and status in ('open','reviewing');
  get diagnostics v_count = row_count;
  insert into public.admin_bulk_operation_audit(
    admin_id, operation_type, track_count, params_json, after_json, status, completed_at
  ) values (
    v_admin, 'bulk_qc_queue_' || p_status, v_count,
    jsonb_build_object('ids_count', array_length(p_ids,1), 'reason', p_reason),
    jsonb_build_object('rows_updated', v_count), 'completed', now()
  );
  return v_count;
end; $$;

-- ===== F. 권한 =====
revoke all on function public.admin_generate_qc_queue_candidates() from public, anon;
revoke all on function public.admin_list_qc_queue(text, text, text, text, int) from public, anon;
revoke all on function public.admin_qc_queue_summary() from public, anon;
revoke all on function public.admin_assign_qc_queue(uuid, uuid) from public, anon;
revoke all on function public.admin_resolve_qc_queue(uuid, text) from public, anon;
revoke all on function public.admin_dismiss_qc_queue(uuid, text) from public, anon;
revoke all on function public.admin_bulk_resolve_qc_queue(uuid[], text, text) from public, anon;

grant execute on function public.admin_generate_qc_queue_candidates() to authenticated, service_role;
grant execute on function public.admin_list_qc_queue(text, text, text, text, int) to authenticated, service_role;
grant execute on function public.admin_qc_queue_summary() to authenticated, service_role;
grant execute on function public.admin_assign_qc_queue(uuid, uuid) to authenticated, service_role;
grant execute on function public.admin_resolve_qc_queue(uuid, text) to authenticated, service_role;
grant execute on function public.admin_dismiss_qc_queue(uuid, text) to authenticated, service_role;
grant execute on function public.admin_bulk_resolve_qc_queue(uuid[], text, text) to authenticated, service_role;
