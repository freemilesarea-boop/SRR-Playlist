-- 0233 — 뷰티 카테고리 룰 보강 + 중복 적재 안전망
--
-- 1. genre_block_rules — 미용실 / 뷰티샵 / 네일샵 + 영문 별칭(beauty_shop/salon/hair_salon/cosmetic_shop)
--    × rock / metal / punk / hard rock / hardstyle / hardcore / trap / drill = block
--    soft rock / acoustic / indie acoustic = allow 예외
--
-- 2. placement_risk_flags — UNIQUE (playlist_id, track_id, risk_type) 가 이미 0232 에서 보장됨.
--    본 마이그레이션은 명시적으로 다시 확인 (멱등) + 동일 placement 의 '결정된 플래그' 가 있으면
--    재스캔 시 skip 하도록 admin_flag_placement_risks 정책 강화.
--
-- 3. admin_flag_placement_risks 의 기본 p_business_patterns 갱신 — 뷰티 계열 6 카테고리 자동 포함.

-- ===== A. genre_block_rules 보강 =====

insert into public.genre_block_rules(business_category, block_kind, genre_pattern, reason)
select v.b, v.k, v.p, v.r
from (values
  -- 미용실 block (기존 metal/hardstyle/hardcore/drill 외 rock/punk/hard rock/trap 추가)
  ('미용실', 'block', 'rock', '미용실 부적합'),
  ('미용실', 'block', 'punk', '미용실 부적합'),
  ('미용실', 'block', 'hard rock', '미용실 부적합'),
  ('미용실', 'block', 'trap', '미용실 부적합'),
  -- 미용실 allow 예외
  ('미용실', 'allow', 'soft rock', '미용실 예외 허용 (soft)'),
  ('미용실', 'allow', 'acoustic', '미용실 예외 허용'),
  ('미용실', 'allow', 'indie acoustic', '미용실 예외 허용'),

  -- 뷰티샵 block
  ('뷰티샵', 'block', 'rock', '뷰티샵 부적합'),
  ('뷰티샵', 'block', 'metal', '뷰티샵 부적합'),
  ('뷰티샵', 'block', 'punk', '뷰티샵 부적합'),
  ('뷰티샵', 'block', 'hard rock', '뷰티샵 부적합'),
  ('뷰티샵', 'block', 'hardstyle', '뷰티샵 부적합'),
  ('뷰티샵', 'block', 'hardcore', '뷰티샵 부적합'),
  ('뷰티샵', 'block', 'trap', '뷰티샵 부적합'),
  ('뷰티샵', 'block', 'drill', '뷰티샵 부적합'),
  -- 뷰티샵 allow 예외
  ('뷰티샵', 'allow', 'soft rock', '뷰티샵 예외 허용 (soft)'),
  ('뷰티샵', 'allow', 'acoustic', '뷰티샵 예외 허용'),
  ('뷰티샵', 'allow', 'indie acoustic', '뷰티샵 예외 허용'),
  ('뷰티샵', 'allow', 'k-pop', '뷰티샵 정석'),
  ('뷰티샵', 'allow', 'pop', '뷰티샵 정석'),
  ('뷰티샵', 'allow', 'r&b', '뷰티샵 분위기'),
  ('뷰티샵', 'allow', 'indie pop', '뷰티샵 트렌디'),

  -- 네일샵 block
  ('네일샵', 'block', 'rock', '네일샵 부적합'),
  ('네일샵', 'block', 'metal', '네일샵 부적합'),
  ('네일샵', 'block', 'punk', '네일샵 부적합'),
  ('네일샵', 'block', 'hard rock', '네일샵 부적합'),
  ('네일샵', 'block', 'hardstyle', '네일샵 부적합'),
  ('네일샵', 'block', 'hardcore', '네일샵 부적합'),
  ('네일샵', 'block', 'trap', '네일샵 부적합'),
  ('네일샵', 'block', 'drill', '네일샵 부적합'),
  ('네일샵', 'allow', 'soft rock', '네일샵 예외 허용 (soft)'),
  ('네일샵', 'allow', 'acoustic', '네일샵 예외 허용'),
  ('네일샵', 'allow', 'indie acoustic', '네일샵 예외 허용'),
  ('네일샵', 'allow', 'k-pop', '네일샵 분위기'),
  ('네일샵', 'allow', 'pop', '네일샵 분위기'),

  -- 영문 별칭 (사용자 spec 명시: beauty_shop / salon / hair_salon / cosmetic_shop)
  -- 외국어/영문 슬러그로 카테고리가 만들어질 경우 대비. 같은 정책.
  ('beauty_shop', 'block', 'rock', 'beauty shop unsuitable'),
  ('beauty_shop', 'block', 'metal', 'beauty shop unsuitable'),
  ('beauty_shop', 'block', 'punk', 'beauty shop unsuitable'),
  ('beauty_shop', 'block', 'hard rock', 'beauty shop unsuitable'),
  ('beauty_shop', 'block', 'hardstyle', 'beauty shop unsuitable'),
  ('beauty_shop', 'block', 'hardcore', 'beauty shop unsuitable'),
  ('beauty_shop', 'block', 'trap', 'beauty shop unsuitable'),
  ('beauty_shop', 'block', 'drill', 'beauty shop unsuitable'),
  ('beauty_shop', 'allow', 'soft rock', 'soft exception'),
  ('beauty_shop', 'allow', 'acoustic', 'soft exception'),
  ('beauty_shop', 'allow', 'indie acoustic', 'soft exception'),

  ('salon', 'block', 'rock', 'salon unsuitable'),
  ('salon', 'block', 'metal', 'salon unsuitable'),
  ('salon', 'block', 'punk', 'salon unsuitable'),
  ('salon', 'block', 'hard rock', 'salon unsuitable'),
  ('salon', 'block', 'hardstyle', 'salon unsuitable'),
  ('salon', 'block', 'hardcore', 'salon unsuitable'),
  ('salon', 'block', 'trap', 'salon unsuitable'),
  ('salon', 'block', 'drill', 'salon unsuitable'),
  ('salon', 'allow', 'soft rock', 'soft exception'),
  ('salon', 'allow', 'acoustic', 'soft exception'),
  ('salon', 'allow', 'indie acoustic', 'soft exception'),

  ('hair_salon', 'block', 'rock', 'hair salon unsuitable'),
  ('hair_salon', 'block', 'metal', 'hair salon unsuitable'),
  ('hair_salon', 'block', 'punk', 'hair salon unsuitable'),
  ('hair_salon', 'block', 'hard rock', 'hair salon unsuitable'),
  ('hair_salon', 'block', 'hardstyle', 'hair salon unsuitable'),
  ('hair_salon', 'block', 'hardcore', 'hair salon unsuitable'),
  ('hair_salon', 'block', 'trap', 'hair salon unsuitable'),
  ('hair_salon', 'block', 'drill', 'hair salon unsuitable'),
  ('hair_salon', 'allow', 'soft rock', 'soft exception'),
  ('hair_salon', 'allow', 'acoustic', 'soft exception'),
  ('hair_salon', 'allow', 'indie acoustic', 'soft exception'),

  ('cosmetic_shop', 'block', 'rock', 'cosmetic shop unsuitable'),
  ('cosmetic_shop', 'block', 'metal', 'cosmetic shop unsuitable'),
  ('cosmetic_shop', 'block', 'punk', 'cosmetic shop unsuitable'),
  ('cosmetic_shop', 'block', 'hard rock', 'cosmetic shop unsuitable'),
  ('cosmetic_shop', 'block', 'hardstyle', 'cosmetic shop unsuitable'),
  ('cosmetic_shop', 'block', 'hardcore', 'cosmetic shop unsuitable'),
  ('cosmetic_shop', 'block', 'trap', 'cosmetic shop unsuitable'),
  ('cosmetic_shop', 'block', 'drill', 'cosmetic shop unsuitable'),
  ('cosmetic_shop', 'allow', 'soft rock', 'soft exception'),
  ('cosmetic_shop', 'allow', 'acoustic', 'soft exception'),
  ('cosmetic_shop', 'allow', 'indie acoustic', 'soft exception')
) as v(b,k,p,r)
where not exists (
  select 1 from public.genre_block_rules ex
  where ex.business_category = v.b and ex.block_kind = v.k and ex.genre_pattern = v.p
);

-- ===== B. placement_risk_flags 중복 적재 안전망 =====
-- 1) UNIQUE 제약 명시적 보장 (0232 에서 이미 생성됐지만 멱등하게 확인)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.placement_risk_flags'::regclass
      and conname = 'placement_risk_flags_playlist_id_track_id_risk_type_key'
  ) then
    alter table public.placement_risk_flags
      add constraint placement_risk_flags_playlist_id_track_id_risk_type_key
      unique (playlist_id, track_id, risk_type);
  end if;
end $$;

-- 2) admin_flag_placement_risks 갱신:
--    - 기본 business_patterns 에 뷰티 계열 6 카테고리 포함
--    - 동일 placement 가 이미 어떤 결정 (approve/keep/remove) 받았으면 재플래그 skip
--      → '관리자가 의사결정한 케이스를 다시 묻지 않음'
create or replace function public.admin_flag_placement_risks(
  p_dry_run boolean default false,
  p_business_patterns text[] default array[
    '호텔','라운지','와인바','카페 라운지','칵테일바',
    '미용실','뷰티샵','네일샵',
    'beauty_shop','salon','hair_salon','cosmetic_shop'
  ],
  p_genre_patterns text[] default array['rock','metal','punk','hard rock','hardstyle','hardcore','trap','drill'],
  p_run_id uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidates jsonb;
  v_inserted int := 0;
  v_skipped_decided int := 0;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  -- 후보 = (1) 매칭 placement (2) allow 예외 없음 (3) 이미 결정된 동일 플래그 없음
  with cands as (
    select pt.playlist_id, pt.track_id, p.title as playlist_title, t.title as track_title,
           t.artist, t.main_genre, p.business_category, pt.match_score,
           (select pat from unnest(p_genre_patterns) pat
            where lower(coalesce(t.main_genre,'')) like '%' || lower(pat) || '%'
               or lower(coalesce(t.sub_genre,'')) like '%' || lower(pat) || '%'
            limit 1) as matched_pattern
    from public.playlist_tracks pt
    join public.playlists p on p.id = pt.playlist_id
    join public.tracks t on t.id = pt.track_id
    where t.removed_at is null
      and p.business_category = any(p_business_patterns)
      and exists(select 1 from unnest(p_genre_patterns) pat
                 where lower(coalesce(t.main_genre,'')) like '%' || lower(pat) || '%'
                    or lower(coalesce(t.sub_genre,'')) like '%' || lower(pat) || '%')
      and not exists (
        select 1 from public.genre_block_rules gbr
        where gbr.business_category = p.business_category
          and gbr.block_kind = 'allow'
          and (
            position(lower(gbr.genre_pattern) in lower(coalesce(t.main_genre,''))) > 0
            or position(lower(gbr.genre_pattern) in lower(coalesce(t.sub_genre,''))) > 0
          )
      )
      -- 이미 결정 (approve/keep/remove) 된 동일 플래그가 있으면 재플래그 skip
      and not exists (
        select 1 from public.placement_risk_flags f
        where f.playlist_id = pt.playlist_id and f.track_id = pt.track_id
          and f.risk_type = 'genre_mismatch' and f.decision <> 'pending'
      )
  )
  select coalesce(jsonb_agg(to_jsonb(c) order by c.playlist_title, c.match_score desc nulls last), '[]'::jsonb)
    into v_candidates from cands c;

  if p_dry_run then
    return jsonb_build_object('ok', true, 'dryRun', true,
      'candidate_count', jsonb_array_length(v_candidates),
      'candidates', v_candidates);
  end if;

  -- 이미 결정된 플래그 카운트 (디버그용)
  select count(*) into v_skipped_decided
  from public.placement_risk_flags f
  join public.playlist_tracks pt on pt.playlist_id = f.playlist_id and pt.track_id = f.track_id
  join public.playlists p on p.id = pt.playlist_id
  join public.tracks t on t.id = pt.track_id
  where t.removed_at is null
    and p.business_category = any(p_business_patterns)
    and f.risk_type = 'genre_mismatch' and f.decision <> 'pending'
    and exists(select 1 from unnest(p_genre_patterns) pat
               where lower(coalesce(t.main_genre,'')) like '%' || lower(pat) || '%'
                  or lower(coalesce(t.sub_genre,'')) like '%' || lower(pat) || '%');

  -- 실제 INSERT (UNIQUE 충돌 시 자연 skip — pending 동일 플래그가 이미 있으면 멱등)
  with cands as (
    select pt.playlist_id, pt.track_id, t.main_genre,
           p.business_category, pt.match_score,
           (select pat from unnest(p_genre_patterns) pat
            where lower(coalesce(t.main_genre,'')) like '%' || lower(pat) || '%'
               or lower(coalesce(t.sub_genre,'')) like '%' || lower(pat) || '%'
            limit 1) as matched_pattern
    from public.playlist_tracks pt
    join public.playlists p on p.id = pt.playlist_id
    join public.tracks t on t.id = pt.track_id
    where t.removed_at is null
      and p.business_category = any(p_business_patterns)
      and exists(select 1 from unnest(p_genre_patterns) pat
                 where lower(coalesce(t.main_genre,'')) like '%' || lower(pat) || '%'
                    or lower(coalesce(t.sub_genre,'')) like '%' || lower(pat) || '%')
      and not exists (
        select 1 from public.genre_block_rules gbr
        where gbr.business_category = p.business_category
          and gbr.block_kind = 'allow'
          and (
            position(lower(gbr.genre_pattern) in lower(coalesce(t.main_genre,''))) > 0
            or position(lower(gbr.genre_pattern) in lower(coalesce(t.sub_genre,''))) > 0
          )
      )
      and not exists (
        select 1 from public.placement_risk_flags f
        where f.playlist_id = pt.playlist_id and f.track_id = pt.track_id
          and f.risk_type = 'genre_mismatch' and f.decision <> 'pending'
      )
  ),
  ins as (
    insert into public.placement_risk_flags (
      playlist_id, track_id, risk_type, risk_reason,
      business_category, main_genre, matched_pattern, match_score, detected_by_run_id
    )
    select c.playlist_id, c.track_id, 'genre_mismatch',
      format('main_genre=%s in %s (pattern: %s, score %s)',
             c.main_genre, c.business_category, c.matched_pattern, c.match_score),
      c.business_category, c.main_genre, c.matched_pattern, c.match_score, p_run_id
    from cands c
    on conflict (playlist_id, track_id, risk_type) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  return jsonb_build_object('ok', true, 'dryRun', false,
    'candidate_count', jsonb_array_length(v_candidates),
    'inserted_count', v_inserted,
    'skipped_already_decided', v_skipped_decided,
    'run_id', p_run_id);
end; $$;
revoke all on function public.admin_flag_placement_risks(boolean, text[], text[], uuid) from public, anon;
grant execute on function public.admin_flag_placement_risks(boolean, text[], text[], uuid) to authenticated, service_role;
