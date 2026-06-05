-- 0291 — Boutique (편집샵) strict instrumental-only 정책 (X6.5)
--
-- 정책: 편집샵 카테고리는 무드 중심 Instrumental 매장으로 전환.
--   1) instrumental = true 만 허용 (기본)
--   2) vocal 트랙 전체 차단 (auto_place_track → review_needed)
--   3) 우선 허용 장르 (priority 10, instrumental):
--        POP, EDM, Electronic, House, Synthwave, Lounge, Ambient, Chillhop, Lo-fi
--   4) 추가 허용 장르 (priority 10, instrumental):
--        Alternative, Jazzhop, R&B, City Pop
--   5) 명시 차단 (priority 5, vocal):
--        POP, Alternative, Electronic, House, Synthwave, R&B, K-R&B, Ballad,
--        Hip-Hop, Rap, Rock, K-POP, J-POP
--
-- 우선순위: 차단 룰 (5) > strict allow (10) > 일반 매칭 (50)
-- strict — _check_store_genre_placement 안에서 boutique_voice_check CTE 우선 평가.
--
-- 보컬 차단 기준: vocal_type/vocal_presence 무관 — instrumental=false 한 가지로만 차단.
-- (병원과 달리 사람 목소리 자체는 OK; 단 백킹 보컬 instrumental 트랙은 통과)
--
-- 자동 삭제 금지. 위반 트랙은 admin_backfill_store_genre_policy_review 로 review_needed 마킹만.

-- ===== A. 허용 장르 (instrumental, priority 10 strict) =====
insert into public.store_genre_placement_rules
  (store_type, genre, vocal_policy, is_allowed, priority, source) values
-- 핵심 무드 (Boutique Instrumental v1)
('boutique','pop','instrumental',true,10,'admin_md_policy_v1'),
('boutique','edm','instrumental',true,10,'admin_md_policy_v1'),
('boutique','electronic','instrumental',true,10,'admin_md_policy_v1'),
('boutique','house','instrumental',true,10,'admin_md_policy_v1'),
('boutique','synthwave','instrumental',true,10,'admin_md_policy_v1'),
('boutique','lounge','instrumental',true,10,'admin_md_policy_v1'),
('boutique','ambient','instrumental',true,10,'admin_md_policy_v1'),
('boutique','chillhop','instrumental',true,10,'admin_md_policy_v1'),
('boutique','lofi','instrumental',true,10,'admin_md_policy_v1'),
-- 추가 허용
('boutique','alternative','instrumental',true,10,'admin_md_policy_v1'),
('boutique','jazzhop','instrumental',true,10,'admin_md_policy_v1'),
('boutique','rnb','instrumental',true,10,'admin_md_policy_v1'),
('boutique','citypop','instrumental',true,10,'admin_md_policy_v1')
on conflict (store_type, genre, vocal_policy) do update set
  is_allowed = excluded.is_allowed,
  priority = excluded.priority,
  source = excluded.source;

-- ===== B. 차단 장르 (vocal, priority 5 explicit block) =====
-- 기존 boutique 의 4개 vocal allow (alternative/electronic/house/synthwave) 는
-- ON CONFLICT DO UPDATE 로 is_allowed=false 로 뒤집힘.
insert into public.store_genre_placement_rules
  (store_type, genre, vocal_policy, is_allowed, priority, source) values
('boutique','pop','vocal',false,5,'boutique_strict_block'),
('boutique','alternative','vocal',false,5,'boutique_strict_block'),
('boutique','electronic','vocal',false,5,'boutique_strict_block'),
('boutique','house','vocal',false,5,'boutique_strict_block'),
('boutique','synthwave','vocal',false,5,'boutique_strict_block'),
('boutique','rnb','vocal',false,5,'boutique_strict_block'),
('boutique','krnb','vocal',false,5,'boutique_strict_block'),
('boutique','ballad','vocal',false,5,'boutique_strict_block'),
('boutique','hiphop','vocal',false,5,'boutique_strict_block'),
('boutique','rap','vocal',false,5,'boutique_strict_block'),
('boutique','rock','vocal',false,5,'boutique_strict_block'),
('boutique','kpop','vocal',false,5,'boutique_strict_block'),
('boutique','jpop','vocal',false,5,'boutique_strict_block')
on conflict (store_type, genre, vocal_policy) do update set
  is_allowed = excluded.is_allowed,
  priority = excluded.priority,
  source = excluded.source;

-- ===== C. _check_store_genre_placement 강화 =====
-- 병원 strict 검증 유지 + boutique strict 검증 추가:
--   boutique 에서 instrumental=false → 즉시 거부 ('boutique_strict_vocal_blocked')
-- 그 외 매장은 기존 로직 그대로.

create or replace function public._check_store_genre_placement(
  p_track_id uuid, p_store_slug text
) returns jsonb language sql stable parallel safe as $$
  with t as (
    select main_genre, sub_genre,
           coalesce(instrumental, false) as is_inst,
           vocal_type,
           coalesce(vocal_presence, 0) as vp
    from public.tracks where id = p_track_id
  ),
  -- X6.4: 병원 strict — 가사/사람 목소리 흔적 전면 차단
  hospital_voice_check as (
    select case
      when p_store_slug <> 'hospital' then null
      when not (select is_inst from t) then 'hospital_strict_vocal_blocked'
      when (select vocal_type from t) in ('vocal','rap','spoken') then 'hospital_strict_vocal_type_blocked'
      when (select vp from t) > 0 then 'hospital_strict_vocal_presence_blocked'
      else null
    end as reject_reason
  ),
  -- X6.5: 편집샵 strict — instrumental=false 차단 (vocal_type/vocal_presence 는 허용)
  boutique_voice_check as (
    select case
      when p_store_slug <> 'boutique' then null
      when not (select is_inst from t) then 'boutique_strict_vocal_blocked'
      else null
    end as reject_reason
  ),
  norm as (
    select
      public._normalize_genre_for_md(t.main_genre) as mg,
      public._normalize_genre_for_md(t.sub_genre)  as sg,
      t.is_inst
    from t
  ),
  store_has_rules as (
    select exists (select 1 from public.store_genre_placement_rules
                   where store_type = p_store_slug) as ok
  ),
  matched as (
    select r.is_allowed, r.priority, r.genre, r.vocal_policy
    from public.store_genre_placement_rules r, norm n
    where r.store_type = p_store_slug
      and (
        public._normalize_genre_for_md(r.genre) = n.mg
        or public._normalize_genre_for_md(r.genre) = n.sg
        or n.mg like public._normalize_genre_for_md(r.genre) || '%'
        or public._normalize_genre_for_md(r.genre) like n.mg || '%'
      )
      and (
        (r.vocal_policy = 'instrumental' and n.is_inst = true)
        or (r.vocal_policy = 'vocal' and n.is_inst = false)
      )
    order by r.priority asc, r.is_allowed asc, length(r.genre) desc
    limit 1
  )
  select case
    -- 병원 strict 거부
    when (select reject_reason from hospital_voice_check) is not null then
      jsonb_build_object(
        'has_store_policy', true,
        'matched', false,
        'allowed', false,
        'priority', 1,
        'reason', (select reject_reason from hospital_voice_check)
      )
    -- 편집샵 strict 거부
    when (select reject_reason from boutique_voice_check) is not null then
      jsonb_build_object(
        'has_store_policy', true,
        'matched', false,
        'allowed', false,
        'priority', 1,
        'reason', (select reject_reason from boutique_voice_check)
      )
    else
      jsonb_build_object(
        'has_store_policy', (select ok from store_has_rules),
        'matched', exists (select 1 from matched),
        'allowed', coalesce((select is_allowed from matched), false),
        'priority', coalesce((select priority from matched), 100),
        'matched_genre', (select genre from matched),
        'matched_vocal_policy', (select vocal_policy from matched),
        'reason', case
          when not (select ok from store_has_rules) then 'md_policy_undefined_store'
          when exists (select 1 from matched where is_allowed) then 'md_policy_allow'
          when exists (select 1 from matched where not is_allowed) then 'md_policy_explicit_block'
          else 'md_policy_no_match'
        end
      )
  end;
$$;

revoke all on function public._check_store_genre_placement(uuid, text) from public, anon;
grant execute on function public._check_store_genre_placement(uuid, text) to authenticated, service_role;
