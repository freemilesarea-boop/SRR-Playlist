-- 0242 — Phase X2.3 Chromaprint Audio Fingerprint
--
-- 목표: 업로드 음원의 Chromaprint 지문을 생성/저장하여
--       중복 업로드, 재인코딩 업로드, 유사 음원 탐지를 관리자에게 경고만 제공한다.
--
-- 정책 (사용자 spec):
--   - 자동 삭제 금지
--   - 자동 차단 금지
--   - 관리자 경고만 수행
--
-- 구성:
--   A. audio_fingerprints 테이블 (track_id PK)
--   B. _audio_fingerprint_similarity(int[], int[]) — Chromaprint hamming-based 유사도 (0~1)
--   C. store_track_fingerprint / list_tracks_needing_fingerprint — worker RPC
--   D. admin_find_duplicate_tracks(target uuid, threshold numeric) — 단일 탐지
--   E. admin_find_all_duplicate_candidates(threshold, max, dur_tol) — 전수 후보

-- ===== A. audio_fingerprints =====
create table if not exists public.audio_fingerprints (
  track_id          uuid primary key references public.tracks(id) on delete cascade,
  fingerprint       int[] not null,
  fingerprint_hash  text not null,
  fingerprint_b64   text,
  duration_seconds  numeric,
  algorithm         text not null default 'chromaprint-v1',
  confidence        numeric default 1.0,
  created_at        timestamptz not null default now()
);

create index if not exists ix_audio_fp_hash      on public.audio_fingerprints(fingerprint_hash);
create index if not exists ix_audio_fp_track     on public.audio_fingerprints(track_id);
create index if not exists ix_audio_fp_duration  on public.audio_fingerprints(duration_seconds);

alter table public.audio_fingerprints enable row level security;

drop policy if exists "audio_fp admin read"  on public.audio_fingerprints;
drop policy if exists "audio_fp admin write" on public.audio_fingerprints;
create policy "audio_fp admin read" on public.audio_fingerprints
  for select to authenticated using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );
create policy "audio_fp admin write" on public.audio_fingerprints
  for all to authenticated using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );
-- service_role 은 RLS 우회 → worker insert/update 그대로 가능

-- ===== B. similarity helper =====
-- Chromaprint = int32 array of subfingerprints (≈0.124s 당 1 int).
-- 유사도 = 모든 offset 윈도우 중 가장 높은 bit-match 비율 (Hamming-based).
-- 비교 비용: O(2 × max_offset × min(len_a, len_b)) bit_count 호출.
create or replace function public._audio_fingerprint_similarity(a int[], b int[], max_offset int default 16)
returns numeric
language plpgsql
immutable
parallel safe
as $$
declare
  len_a int := coalesce(array_length(a, 1), 0);
  len_b int := coalesce(array_length(b, 1), 0);
  best_score numeric := 0;
  match_bits bigint;
  total_bits bigint;
  score numeric;
  i int;
  j int;
  off int;
begin
  if len_a = 0 or len_b = 0 then return 0; end if;

  for off in -max_offset..max_offset loop
    match_bits := 0;
    total_bits := 0;
    for i in 1..len_a loop
      j := i + off;
      if j >= 1 and j <= len_b then
        total_bits := total_bits + 32;
        match_bits := match_bits + 32 - bit_count((a[i] # b[j])::bit(32));
      end if;
    end loop;
    if total_bits > 0 then
      score := match_bits::numeric / total_bits::numeric;
      if score > best_score then
        best_score := score;
      end if;
    end if;
  end loop;

  return round(best_score, 4);
end; $$;

-- ===== C. worker RPC — upsert + list pending =====
create or replace function public.store_track_fingerprint(
  p_track_id        uuid,
  p_fingerprint     int[],
  p_fingerprint_hash text,
  p_fingerprint_b64 text default null,
  p_duration_seconds numeric default null,
  p_confidence      numeric default 1.0,
  p_algorithm       text default 'chromaprint-v1'
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audio_fingerprints(
    track_id, fingerprint, fingerprint_hash, fingerprint_b64,
    duration_seconds, confidence, algorithm
  ) values (
    p_track_id, p_fingerprint, p_fingerprint_hash, p_fingerprint_b64,
    p_duration_seconds, p_confidence, p_algorithm
  )
  on conflict (track_id) do update set
    fingerprint = excluded.fingerprint,
    fingerprint_hash = excluded.fingerprint_hash,
    fingerprint_b64 = excluded.fingerprint_b64,
    duration_seconds = excluded.duration_seconds,
    confidence = excluded.confidence,
    algorithm = excluded.algorithm,
    created_at = now();
$$;

create or replace function public.list_tracks_needing_fingerprint(p_limit int default 50)
returns table (track_id uuid, audio_url text, title text)
language sql
security definer
set search_path = public
as $$
  select t.id, t.audio_url, t.title
  from public.tracks t
  where t.audio_url is not null
    and t.removed_at is null
    and not exists (select 1 from public.audio_fingerprints f where f.track_id = t.id)
  order by t.created_at desc nulls last, t.id
  limit greatest(p_limit, 1);
$$;

-- ===== D. admin_find_duplicate_tracks — 단일 트랙 vs 전체 =====
create or replace function public.admin_find_duplicate_tracks(
  p_target_track_id uuid,
  p_similarity_threshold numeric default 0.85,
  p_max_results int default 20,
  p_duration_tolerance numeric default 5.0
) returns table (
  source_track_id    uuid,
  candidate_track_id uuid,
  similarity         numeric,
  source_title       text,
  source_artist      text,
  candidate_title    text,
  candidate_artist   text,
  source_duration    numeric,
  candidate_duration numeric,
  duration_delta     numeric,
  hash_exact         boolean
)
language sql
security definer
set search_path = public
as $$
  with target as (
    select f.track_id, f.fingerprint, f.fingerprint_hash, f.duration_seconds,
           t.title, t.artist
    from public.audio_fingerprints f
    join public.tracks t on t.id = f.track_id
    where f.track_id = p_target_track_id
  ),
  candidates as (
    select
      tgt.track_id as src_id,
      c.track_id as cand_id,
      case when c.fingerprint_hash = tgt.fingerprint_hash then 1.0
           else public._audio_fingerprint_similarity(tgt.fingerprint, c.fingerprint)
      end as similarity,
      tgt.title as src_title, tgt.artist as src_artist,
      tt.title as cand_title, tt.artist as cand_artist,
      tgt.duration_seconds as src_duration,
      c.duration_seconds as cand_duration,
      abs(coalesce(tgt.duration_seconds, 0) - coalesce(c.duration_seconds, 0)) as dur_delta,
      (c.fingerprint_hash = tgt.fingerprint_hash) as is_hash_exact
    from target tgt
    join public.audio_fingerprints c on c.track_id <> tgt.track_id
    join public.tracks tt on tt.id = c.track_id and tt.removed_at is null
    where abs(coalesce(tgt.duration_seconds, 0) - coalesce(c.duration_seconds, 0)) < p_duration_tolerance
  )
  select src_id, cand_id, similarity, src_title, src_artist, cand_title, cand_artist,
         src_duration, cand_duration, dur_delta, is_hash_exact
  from candidates
  where similarity >= p_similarity_threshold
  order by similarity desc
  limit greatest(p_max_results, 1);
$$;

-- ===== E. admin_find_all_duplicate_candidates — 전수 탐지 =====
-- 운영 주의: 풀 pair-wise cross-join 비용 크다. duration_tolerance(기본 3초) 로 사전 필터.
-- 예상 시간: 373 트랙 × duration_tolerance=3s 기준 후보 pair ≈ 100~500, 분당 처리.
create or replace function public.admin_find_all_duplicate_candidates(
  p_similarity_threshold numeric default 0.85,
  p_max_results int default 100,
  p_duration_tolerance numeric default 3.0
) returns table (
  source_track_id    uuid,
  candidate_track_id uuid,
  similarity         numeric,
  source_title       text,
  source_artist      text,
  candidate_title    text,
  candidate_artist   text,
  source_duration    numeric,
  candidate_duration numeric,
  duration_delta     numeric,
  hash_exact         boolean
)
language sql
security definer
set search_path = public
as $$
  with pairs as (
    select a.track_id as src_id, b.track_id as cand_id,
           a.fingerprint as fa, b.fingerprint as fb,
           a.fingerprint_hash as ha, b.fingerprint_hash as hb,
           a.duration_seconds as da, b.duration_seconds as db
    from public.audio_fingerprints a
    join public.audio_fingerprints b on b.track_id > a.track_id
    where abs(coalesce(a.duration_seconds, 0) - coalesce(b.duration_seconds, 0)) < p_duration_tolerance
  ),
  scored as (
    select src_id, cand_id, da, db, (ha = hb) as is_hash_exact,
           case when ha = hb then 1.0
                else public._audio_fingerprint_similarity(fa, fb)
           end as similarity
    from pairs
  )
  select s.src_id, s.cand_id, s.similarity,
         ta.title, ta.artist, tb.title, tb.artist,
         s.da, s.db,
         abs(coalesce(s.da, 0) - coalesce(s.db, 0)),
         s.is_hash_exact
  from scored s
  join public.tracks ta on ta.id = s.src_id and ta.removed_at is null
  join public.tracks tb on tb.id = s.cand_id and tb.removed_at is null
  where s.similarity >= p_similarity_threshold
  order by s.similarity desc
  limit greatest(p_max_results, 1);
$$;

-- ===== F. 권한 =====
revoke all on function public.store_track_fingerprint(uuid, int[], text, text, numeric, numeric, text) from public;
revoke all on function public.list_tracks_needing_fingerprint(int) from public;
revoke all on function public.admin_find_duplicate_tracks(uuid, numeric, int, numeric) from public;
revoke all on function public.admin_find_all_duplicate_candidates(numeric, int, numeric) from public;

grant execute on function public.store_track_fingerprint(uuid, int[], text, text, numeric, numeric, text) to service_role;
grant execute on function public.list_tracks_needing_fingerprint(int) to service_role;
grant execute on function public.admin_find_duplicate_tracks(uuid, numeric, int, numeric) to authenticated, service_role;
grant execute on function public.admin_find_all_duplicate_candidates(numeric, int, numeric) to authenticated, service_role;
