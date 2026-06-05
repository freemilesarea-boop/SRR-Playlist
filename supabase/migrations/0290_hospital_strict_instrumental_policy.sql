-- 0290 — Hospital strict instrumental-only 정책 (X6.4)
--
-- 정책: 병원 카테고리에 가사 있는 음원 절대 차단.
--   1) instrumental = true 만 허용
--   2) vocal_type NOT IN ('vocal','rap','spoken')
--   3) vocal_presence = 0 또는 NULL
--   4) 허용 장르: ambient/piano/jazz/lofi/meditation + classical/new_age/acoustic
--   5) 차단 장르: K-POP, POP Vocal, Ballad, R&B, K-R&B, Hip-Hop, Rap, Rock,
--                EDM, House, Electronic, City Pop, J-Pop, Alternative, Soul, Funk, Blues
--      (가사 유무 무관 — 고에너지 장르)
--
-- 우선순위: 차단 룰 > 허용 룰 > 일반 매칭
-- strict (priority 10) — 다른 정책보다 먼저 평가.

-- ===== A. 허용 장르 추가 시드 =====
insert into public.store_genre_placement_rules
  (store_type, genre, vocal_policy, is_allowed, priority, source) values
-- 추가 허용 장르 (instrumental 만)
('hospital','classical','instrumental',true,10,'admin_md_policy_v1'),
('hospital','new_age','instrumental',true,10,'admin_md_policy_v1'),
('hospital','acoustic','instrumental',true,10,'admin_md_policy_v1')
on conflict (store_type, genre, vocal_policy) do update set
  is_allowed = excluded.is_allowed,
  priority = excluded.priority,
  source = excluded.source;

-- ===== B. 차단 장르 명시 등록 (is_allowed=false) =====
-- 가사/instrumental 무관하게 병원 환경에 부적합한 고에너지 장르.
-- 함수에서 우선 평가됨.
insert into public.store_genre_placement_rules
  (store_type, genre, vocal_policy, is_allowed, priority, source) values
('hospital','k_pop','vocal',false,5,'hospital_strict_block'),
('hospital','k_pop','instrumental',false,5,'hospital_strict_block'),
('hospital','pop','vocal',false,5,'hospital_strict_block'),
('hospital','ballad','vocal',false,5,'hospital_strict_block'),
('hospital','rnb','vocal',false,5,'hospital_strict_block'),
('hospital','rnb','instrumental',false,5,'hospital_strict_block'),
('hospital','k_rnb','vocal',false,5,'hospital_strict_block'),
('hospital','k_rnb','instrumental',false,5,'hospital_strict_block'),
('hospital','hiphop','vocal',false,5,'hospital_strict_block'),
('hospital','hiphop','instrumental',false,5,'hospital_strict_block'),
('hospital','rap','vocal',false,5,'hospital_strict_block'),
('hospital','rap','instrumental',false,5,'hospital_strict_block'),
('hospital','rock','vocal',false,5,'hospital_strict_block'),
('hospital','rock','instrumental',false,5,'hospital_strict_block'),
('hospital','edm','vocal',false,5,'hospital_strict_block'),
('hospital','edm','instrumental',false,5,'hospital_strict_block'),
('hospital','house','vocal',false,5,'hospital_strict_block'),
('hospital','electronic','vocal',false,5,'hospital_strict_block'),
('hospital','citypop','vocal',false,5,'hospital_strict_block'),
('hospital','jpop','vocal',false,5,'hospital_strict_block'),
('hospital','alternative','vocal',false,5,'hospital_strict_block'),
('hospital','soul','vocal',false,5,'hospital_strict_block'),
('hospital','funk','vocal',false,5,'hospital_strict_block'),
('hospital','blues','vocal',false,5,'hospital_strict_block')
on conflict (store_type, genre, vocal_policy) do update set
  is_allowed = excluded.is_allowed,
  priority = excluded.priority,
  source = excluded.source;

-- ===== C. _check_store_genre_placement 강화 =====
-- hospital 인 경우 가장 먼저 strict 검증:
--   instrumental=false 또는 vocal_type/vocal_presence 가 음성 존재 시 즉시 거부.
-- 다른 매장은 기존 로직 그대로.

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
  -- X6.4: 병원 strict 검증 — 사람 목소리 존재 여부 우선 차단
  hospital_voice_check as (
    select case
      when p_store_slug <> 'hospital' then null  -- 다른 매장은 건너뜀
      when not (select is_inst from t) then 'hospital_strict_vocal_blocked'
      when (select vocal_type from t) in ('vocal','rap','spoken') then 'hospital_strict_vocal_type_blocked'
      when (select vp from t) > 0 then 'hospital_strict_vocal_presence_blocked'
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
  -- 매칭 룰 — priority asc (5 = block, 10 = strict allow, 50 = normal)
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
    -- 병원 strict 거부 — 다른 평가 무시
    when (select reject_reason from hospital_voice_check) is not null then
      jsonb_build_object(
        'has_store_policy', true,
        'matched', false,
        'allowed', false,
        'priority', 1,
        'reason', (select reject_reason from hospital_voice_check)
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
