-- 0243 — Phase X2.3 Hotfix: Chromaprint fingerprint int[] → bigint[]
--
-- 문제: Chromaprint raw 값은 unsigned int32 (0 ~ 4294967295) 범위인데
--       0242 는 int[] (signed int32 max 2147483647) 로 저장 → "value out of range" 400.
-- 조치: fingerprint 컬럼 + 4개 RPC 시그니처 모두 bigint[] 로 통일.
-- 기존 데이터: audio_fingerprints 0건 (백필 전부 실패 → 저장된 행 없음).
-- 호환: Modal worker 측 변경 없음 (PostgREST 가 JSON int → bigint 바인딩).

-- ===== A. 함수 DROP (시그니처 변경 위해 필수) =====
drop function if exists public.store_track_fingerprint(uuid, int[], text, text, numeric, numeric, text);
drop function if exists public._audio_fingerprint_similarity(int[], int[], int);
drop function if exists public.admin_find_duplicate_tracks(uuid, numeric, int, numeric);
drop function if exists public.admin_find_all_duplicate_candidates(numeric, int, numeric);

-- ===== B. 컬럼 타입 변경 (table 비어있음 → USING cast 안전) =====
alter table public.audio_fingerprints
  alter column fingerprint type bigint[] using fingerprint::bigint[];

-- ===== C. similarity 함수 — bigint[] 입력, bit(64) 캐스팅 =====
-- Chromaprint 값은 uint32 라 bigint 에 저장되면 upper 32 비트는 0.
-- → bit_count(bigint::bit(64)) == bit_count(원래 uint32 의 popcount)
-- → 비교 단위는 여전히 32 비트 (total_bits += 32, match = 32 - popcount(xor)).
create or replace function public._audio_fingerprint_similarity(a bigint[], b bigint[], max_offset int default 16)
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
        match_bits := match_bits + 32 - bit_count((a[i] # b[j])::bit(64));
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

-- ===== D. worker upsert RPC — bigint[] =====
create or replace function public.store_track_fingerprint(
  p_track_id        uuid,
  p_fingerprint     bigint[],
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

-- ===== E. admin_find_duplicate_tracks — 단일 트랙 vs 전체 =====
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

-- ===== F. admin_find_all_duplicate_candidates — 전수 탐지 =====
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

-- ===== G. 권한 (bigint[] 시그니처 재부여) =====
revoke all on function public.store_track_fingerprint(uuid, bigint[], text, text, numeric, numeric, text) from public;
revoke all on function public.admin_find_duplicate_tracks(uuid, numeric, int, numeric) from public;
revoke all on function public.admin_find_all_duplicate_candidates(numeric, int, numeric) from public;

grant execute on function public.store_track_fingerprint(uuid, bigint[], text, text, numeric, numeric, text) to service_role;
grant execute on function public.admin_find_duplicate_tracks(uuid, numeric, int, numeric) to authenticated, service_role;
grant execute on function public.admin_find_all_duplicate_candidates(numeric, int, numeric) to authenticated, service_role;
