-- 0268 — MD 기반 매장별 장르 배치 정책 (X5.4)
--
-- Source of Truth: 2026-06-01 사용자 채팅 첨부 MD "매장별 장르 배치"
-- 20 매장 × 195 allow rules (MD 명시 허용 항목만; 미명시 = 미허용 = review_needed 후보)
--
-- 핵심 원칙:
--   1. allow 룰만 등록 (MD 가 명시한 것만 통과)
--   2. 자동 삭제 절대 금지 — 기존 곡은 review_needed 마킹만
--   3. p_dry_run=true 기본 — false 실행은 사용자 승인 필요
--   4. genre 정규화: lower + remove(-, space) 양쪽 적용
--   5. strict 매장 (priority 10): hospital, hotel, bookstore, fine_dining
--      → 정책 미정의 트랙도 skip (보수적)
--   6. 기존 X5 genre_store_guardrails / store_audio_profiles 는 보존 (별개 시스템)

-- ===== A. store_genre_placement_rules =====
create table if not exists public.store_genre_placement_rules (
  id              uuid primary key default gen_random_uuid(),
  store_type      text not null,
  genre           text not null,
  vocal_policy    text not null check (vocal_policy in ('vocal', 'instrumental')),
  is_allowed      boolean not null default true,
  priority        int not null default 50,
  source          text not null default 'admin_md_policy_v1',
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists uq_sgpr_store_genre_vocal
  on public.store_genre_placement_rules(store_type, genre, vocal_policy);
create index if not exists ix_sgpr_store
  on public.store_genre_placement_rules(store_type);
create index if not exists ix_sgpr_allowed
  on public.store_genre_placement_rules(store_type, is_allowed) where is_allowed;

alter table public.store_genre_placement_rules enable row level security;
drop policy if exists "sgpr admin all" on public.store_genre_placement_rules;
create policy "sgpr admin all" on public.store_genre_placement_rules for all to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== B. MD 시드 (195 allow rules) =====
-- 멱등 — ON CONFLICT DO UPDATE 로 정책 갱신 시 재실행 가능
insert into public.store_genre_placement_rules
  (store_type, genre, vocal_policy, is_allowed, priority, source) values
-- 1. cafe (priority 50) — 4 vocal + 6 instrumental
('cafe','indie_pop','vocal',true,50,'admin_md_policy_v1'),
('cafe','k_rnb','vocal',true,50,'admin_md_policy_v1'),
('cafe','jazz','vocal',true,50,'admin_md_policy_v1'),
('cafe','rnb','vocal',true,50,'admin_md_policy_v1'),
('cafe','lofi','instrumental',true,50,'admin_md_policy_v1'),
('cafe','jazzhop','instrumental',true,50,'admin_md_policy_v1'),
('cafe','cafe_music','instrumental',true,50,'admin_md_policy_v1'),
('cafe','indie_pop','instrumental',true,50,'admin_md_policy_v1'),
('cafe','rnb','instrumental',true,50,'admin_md_policy_v1'),
('cafe','k_rnb','instrumental',true,50,'admin_md_policy_v1'),
-- 2. hospital (priority 10 strict) — 5 instrumental
('hospital','piano','instrumental',true,10,'admin_md_policy_v1'),
('hospital','ambient','instrumental',true,10,'admin_md_policy_v1'),
('hospital','meditation','instrumental',true,10,'admin_md_policy_v1'),
('hospital','lofi','instrumental',true,10,'admin_md_policy_v1'),
('hospital','jazz','instrumental',true,10,'admin_md_policy_v1'),
-- 3. boutique — 4 vocal + 4 instrumental
('boutique','alternative','vocal',true,50,'admin_md_policy_v1'),
('boutique','house','vocal',true,50,'admin_md_policy_v1'),
('boutique','electronic','vocal',true,50,'admin_md_policy_v1'),
('boutique','synthwave','vocal',true,50,'admin_md_policy_v1'),
('boutique','electronic','instrumental',true,50,'admin_md_policy_v1'),
('boutique','house','instrumental',true,50,'admin_md_policy_v1'),
('boutique','synthwave','instrumental',true,50,'admin_md_policy_v1'),
('boutique','alternative','instrumental',true,50,'admin_md_policy_v1'),
-- 4. salon — 4 vocal + 6 instrumental
('salon','pop','vocal',true,50,'admin_md_policy_v1'),
('salon','k_rnb','vocal',true,50,'admin_md_policy_v1'),
('salon','city_pop','vocal',true,50,'admin_md_policy_v1'),
('salon','indie_pop','vocal',true,50,'admin_md_policy_v1'),
('salon','lounge','instrumental',true,50,'admin_md_policy_v1'),
('salon','disco','instrumental',true,50,'admin_md_policy_v1'),
('salon','house','instrumental',true,50,'admin_md_policy_v1'),
('salon','pop','instrumental',true,50,'admin_md_policy_v1'),
('salon','indie_pop','instrumental',true,50,'admin_md_policy_v1'),
('salon','rnb','instrumental',true,50,'admin_md_policy_v1'),
-- 5. korean_restaurant — 2 vocal + 4 instrumental
('korean_restaurant','ballad','vocal',true,50,'admin_md_policy_v1'),
('korean_restaurant','indie_pop','vocal',true,50,'admin_md_policy_v1'),
('korean_restaurant','acoustic','instrumental',true,50,'admin_md_policy_v1'),
('korean_restaurant','piano','instrumental',true,50,'admin_md_policy_v1'),
('korean_restaurant','folk','instrumental',true,50,'admin_md_policy_v1'),
('korean_restaurant','ballad','instrumental',true,50,'admin_md_policy_v1'),
-- 6. japanese_restaurant — 2 vocal + 6 instrumental
('japanese_restaurant','j_pop','vocal',true,50,'admin_md_policy_v1'),
('japanese_restaurant','city_pop','vocal',true,50,'admin_md_policy_v1'),
('japanese_restaurant','jazz','instrumental',true,50,'admin_md_policy_v1'),
('japanese_restaurant','lofi','instrumental',true,50,'admin_md_policy_v1'),
('japanese_restaurant','lounge','instrumental',true,50,'admin_md_policy_v1'),
('japanese_restaurant','city_pop','instrumental',true,50,'admin_md_policy_v1'),
('japanese_restaurant','j_pop','instrumental',true,50,'admin_md_policy_v1'),
('japanese_restaurant','piano','instrumental',true,50,'admin_md_policy_v1'),
-- 7. chinese_restaurant — 4 vocal + 8 instrumental
('chinese_restaurant','retro_pop','vocal',true,50,'admin_md_policy_v1'),
('chinese_restaurant','pop','vocal',true,50,'admin_md_policy_v1'),
('chinese_restaurant','hiphop','vocal',true,50,'admin_md_policy_v1'),
('chinese_restaurant','soul','vocal',true,50,'admin_md_policy_v1'),
('chinese_restaurant','funk','instrumental',true,50,'admin_md_policy_v1'),
('chinese_restaurant','disco','instrumental',true,50,'admin_md_policy_v1'),
('chinese_restaurant','house','instrumental',true,50,'admin_md_policy_v1'),
('chinese_restaurant','hiphop','instrumental',true,50,'admin_md_policy_v1'),
('chinese_restaurant','retro_pop','instrumental',true,50,'admin_md_policy_v1'),
('chinese_restaurant','lounge','instrumental',true,50,'admin_md_policy_v1'),
('chinese_restaurant','jazzhop','instrumental',true,50,'admin_md_policy_v1'),
('chinese_restaurant','soul','instrumental',true,50,'admin_md_policy_v1'),
-- 8. western_restaurant — 2 vocal + 6 instrumental
('western_restaurant','jazz','vocal',true,50,'admin_md_policy_v1'),
('western_restaurant','soul','vocal',true,50,'admin_md_policy_v1'),
('western_restaurant','lounge','instrumental',true,50,'admin_md_policy_v1'),
('western_restaurant','piano','instrumental',true,50,'admin_md_policy_v1'),
('western_restaurant','acoustic','instrumental',true,50,'admin_md_policy_v1'),
('western_restaurant','jazz','instrumental',true,50,'admin_md_policy_v1'),
('western_restaurant','pop','instrumental',true,50,'admin_md_policy_v1'),
('western_restaurant','soul','instrumental',true,50,'admin_md_policy_v1'),
-- 9. fine_dining (priority 10 strict) — 6 instrumental
('fine_dining','classical','instrumental',true,10,'admin_md_policy_v1'),
('fine_dining','piano','instrumental',true,10,'admin_md_policy_v1'),
('fine_dining','ambient','instrumental',true,10,'admin_md_policy_v1'),
('fine_dining','blues','instrumental',true,10,'admin_md_policy_v1'),
('fine_dining','jazz','instrumental',true,10,'admin_md_policy_v1'),
('fine_dining','soul','instrumental',true,10,'admin_md_policy_v1'),
-- 10. izakaya — 3 vocal + 4 instrumental
('izakaya','j_rock','vocal',true,50,'admin_md_policy_v1'),
('izakaya','j_pop','vocal',true,50,'admin_md_policy_v1'),
('izakaya','city_pop','vocal',true,50,'admin_md_policy_v1'),
('izakaya','city_pop','instrumental',true,50,'admin_md_policy_v1'),
('izakaya','funk','instrumental',true,50,'admin_md_policy_v1'),
('izakaya','lofi','instrumental',true,50,'admin_md_policy_v1'),
('izakaya','j_pop','instrumental',true,50,'admin_md_policy_v1'),
-- 11. pub — 10 vocal + 10 instrumental
('pub','rock','vocal',true,50,'admin_md_policy_v1'),
('pub','hiphop','vocal',true,50,'admin_md_policy_v1'),
('pub','alternative','vocal',true,50,'admin_md_policy_v1'),
('pub','drum_and_bass','vocal',true,50,'admin_md_policy_v1'),
('pub','pop','vocal',true,50,'admin_md_policy_v1'),
('pub','electronic','vocal',true,50,'admin_md_policy_v1'),
('pub','phonk','vocal',true,50,'admin_md_policy_v1'),
('pub','funk','vocal',true,50,'admin_md_policy_v1'),
('pub','blues','vocal',true,50,'admin_md_policy_v1'),
('pub','kpop','vocal',true,50,'admin_md_policy_v1'),
('pub','blues','instrumental',true,50,'admin_md_policy_v1'),
('pub','funk','instrumental',true,50,'admin_md_policy_v1'),
('pub','drum_and_bass','instrumental',true,50,'admin_md_policy_v1'),
('pub','hiphop','instrumental',true,50,'admin_md_policy_v1'),
('pub','pop','instrumental',true,50,'admin_md_policy_v1'),
('pub','electronic','instrumental',true,50,'admin_md_policy_v1'),
('pub','phonk','instrumental',true,50,'admin_md_policy_v1'),
('pub','rock','instrumental',true,50,'admin_md_policy_v1'),
('pub','uk_garage','instrumental',true,50,'admin_md_policy_v1'),
('pub','kpop','instrumental',true,50,'admin_md_policy_v1'),
-- 12. winebar — 3 vocal + 6 instrumental
('winebar','jazz','vocal',true,50,'admin_md_policy_v1'),
('winebar','rnb','vocal',true,50,'admin_md_policy_v1'),
('winebar','blues','vocal',true,50,'admin_md_policy_v1'),
('winebar','jazz','instrumental',true,50,'admin_md_policy_v1'),
('winebar','lounge','instrumental',true,50,'admin_md_policy_v1'),
('winebar','piano','instrumental',true,50,'admin_md_policy_v1'),
('winebar','rnb','instrumental',true,50,'admin_md_policy_v1'),
('winebar','blues','instrumental',true,50,'admin_md_policy_v1'),
('winebar','city_pop','instrumental',true,50,'admin_md_policy_v1'),
-- 13. fitness — 4 vocal + 8 instrumental
('fitness','hiphop','vocal',true,50,'admin_md_policy_v1'),
('fitness','k_hiphop','vocal',true,50,'admin_md_policy_v1'),
('fitness','reggaeton','vocal',true,50,'admin_md_policy_v1'),
('fitness','rock','vocal',true,50,'admin_md_policy_v1'),
('fitness','phonk','instrumental',true,50,'admin_md_policy_v1'),
('fitness','drum_and_bass','instrumental',true,50,'admin_md_policy_v1'),
('fitness','electronic','instrumental',true,50,'admin_md_policy_v1'),
('fitness','reggaeton','instrumental',true,50,'admin_md_policy_v1'),
('fitness','uk_garage','instrumental',true,50,'admin_md_policy_v1'),
('fitness','rock','instrumental',true,50,'admin_md_policy_v1'),
('fitness','hiphop','instrumental',true,50,'admin_md_policy_v1'),
('fitness','k_hiphop','instrumental',true,50,'admin_md_policy_v1'),
-- 14. hotel (priority 10 strict) — 7 instrumental
('hotel','lounge','instrumental',true,10,'admin_md_policy_v1'),
('hotel','ambient','instrumental',true,10,'admin_md_policy_v1'),
('hotel','piano','instrumental',true,10,'admin_md_policy_v1'),
('hotel','house','instrumental',true,10,'admin_md_policy_v1'),
('hotel','jazz','instrumental',true,10,'admin_md_policy_v1'),
('hotel','rnb','instrumental',true,10,'admin_md_policy_v1'),
('hotel','soul','instrumental',true,10,'admin_md_policy_v1'),
-- 15. office — 3 vocal + 11 instrumental
('office','indie_pop','vocal',true,50,'admin_md_policy_v1'),
('office','acoustic','vocal',true,50,'admin_md_policy_v1'),
('office','folk','vocal',true,50,'admin_md_policy_v1'),
('office','chillhop','instrumental',true,50,'admin_md_policy_v1'),
('office','lofi','instrumental',true,50,'admin_md_policy_v1'),
('office','piano','instrumental',true,50,'admin_md_policy_v1'),
('office','folk','instrumental',true,50,'admin_md_policy_v1'),
('office','indie_pop','instrumental',true,50,'admin_md_policy_v1'),
('office','acoustic','instrumental',true,50,'admin_md_policy_v1'),
('office','jazz','instrumental',true,50,'admin_md_policy_v1'),
('office','blues','instrumental',true,50,'admin_md_policy_v1'),
('office','jazzhop','instrumental',true,50,'admin_md_policy_v1'),
('office','soul','instrumental',true,50,'admin_md_policy_v1'),
('office','ambient','instrumental',true,50,'admin_md_policy_v1'),
-- 16. nail_shop — 7 vocal + 8 instrumental
('nail_shop','k_rnb','vocal',true,50,'admin_md_policy_v1'),
('nail_shop','pop','vocal',true,50,'admin_md_policy_v1'),
('nail_shop','city_pop','vocal',true,50,'admin_md_policy_v1'),
('nail_shop','indie_pop','vocal',true,50,'admin_md_policy_v1'),
('nail_shop','rnb','vocal',true,50,'admin_md_policy_v1'),
('nail_shop','jazzhop','vocal',true,50,'admin_md_policy_v1'),
('nail_shop','jazz','vocal',true,50,'admin_md_policy_v1'),
('nail_shop','jazzhop','instrumental',true,50,'admin_md_policy_v1'),
('nail_shop','lounge','instrumental',true,50,'admin_md_policy_v1'),
('nail_shop','cafe_music','instrumental',true,50,'admin_md_policy_v1'),
('nail_shop','piano','instrumental',true,50,'admin_md_policy_v1'),
('nail_shop','acoustic','instrumental',true,50,'admin_md_policy_v1'),
('nail_shop','jazz','instrumental',true,50,'admin_md_policy_v1'),
('nail_shop','indie_pop','instrumental',true,50,'admin_md_policy_v1'),
('nail_shop','rnb','instrumental',true,50,'admin_md_policy_v1'),
-- 17. studio — 6 vocal + 6 instrumental
('studio','alternative','vocal',true,50,'admin_md_policy_v1'),
('studio','rnb','vocal',true,50,'admin_md_policy_v1'),
('studio','hiphop','vocal',true,50,'admin_md_policy_v1'),
('studio','jazzhop','vocal',true,50,'admin_md_policy_v1'),
('studio','soul','vocal',true,50,'admin_md_policy_v1'),
('studio','house','vocal',true,50,'admin_md_policy_v1'),
('studio','jazzhop','instrumental',true,50,'admin_md_policy_v1'),
('studio','soul','instrumental',true,50,'admin_md_policy_v1'),
('studio','house','instrumental',true,50,'admin_md_policy_v1'),
('studio','hiphop','instrumental',true,50,'admin_md_policy_v1'),
('studio','alternative','instrumental',true,50,'admin_md_policy_v1'),
('studio','rnb','instrumental',true,50,'admin_md_policy_v1'),
-- 18. bookstore (priority 10 strict) — 7 instrumental
('bookstore','classical','instrumental',true,10,'admin_md_policy_v1'),
('bookstore','piano','instrumental',true,10,'admin_md_policy_v1'),
('bookstore','ambient','instrumental',true,10,'admin_md_policy_v1'),
('bookstore','acoustic','instrumental',true,10,'admin_md_policy_v1'),
('bookstore','jazz','instrumental',true,10,'admin_md_policy_v1'),
('bookstore','lofi','instrumental',true,10,'admin_md_policy_v1'),
('bookstore','jazzhop','instrumental',true,10,'admin_md_policy_v1'),
-- 19. flower_shop — 3 vocal + 7 instrumental
('flower_shop','acoustic','vocal',true,50,'admin_md_policy_v1'),
('flower_shop','indie_pop','vocal',true,50,'admin_md_policy_v1'),
('flower_shop','jazz','vocal',true,50,'admin_md_policy_v1'),
('flower_shop','folk','instrumental',true,50,'admin_md_policy_v1'),
('flower_shop','piano','instrumental',true,50,'admin_md_policy_v1'),
('flower_shop','cafe_music','instrumental',true,50,'admin_md_policy_v1'),
('flower_shop','indie_pop','instrumental',true,50,'admin_md_policy_v1'),
('flower_shop','acoustic','instrumental',true,50,'admin_md_policy_v1'),
('flower_shop','ballad','instrumental',true,50,'admin_md_policy_v1'),
('flower_shop','jazz','instrumental',true,50,'admin_md_policy_v1'),
-- 20. showroom — 4 vocal + 5 instrumental
('showroom','rnb','vocal',true,50,'admin_md_policy_v1'),
('showroom','alternative','vocal',true,50,'admin_md_policy_v1'),
('showroom','house','vocal',true,50,'admin_md_policy_v1'),
('showroom','soul','vocal',true,50,'admin_md_policy_v1'),
('showroom','lounge','instrumental',true,50,'admin_md_policy_v1'),
('showroom','house','instrumental',true,50,'admin_md_policy_v1'),
('showroom','rnb','instrumental',true,50,'admin_md_policy_v1'),
('showroom','alternative','instrumental',true,50,'admin_md_policy_v1'),
('showroom','blues','instrumental',true,50,'admin_md_policy_v1')
on conflict (store_type, genre, vocal_policy) do update set
  is_allowed = excluded.is_allowed,
  priority   = excluded.priority,
  source     = excluded.source,
  updated_at = now();

-- ===== C. genre 정규화 헬퍼 =====
create or replace function public._normalize_genre_for_md(p text)
returns text language sql immutable parallel safe as $$
  -- 'J-Pop' / 'J Pop' / 'J_Pop' / 'jpop' → 'jpop'
  -- 'Hip-Hop' / 'Hip Hop' → 'hiphop'
  -- 'R&B' / 'RnB' → 'rnb'
  -- 'K-R&B' → 'krnb'
  select regexp_replace(
    lower(coalesce(p, '')),
    '[-_ &]+', '', 'g'
  );
$$;

-- ===== D. _check_store_genre_placement =====
create or replace function public._check_store_genre_placement(
  p_track_id uuid, p_store_slug text
) returns jsonb language sql stable parallel safe as $$
  with t as (
    select main_genre, sub_genre, instrumental from public.tracks where id = p_track_id
  ),
  norm as (
    select
      public._normalize_genre_for_md(t.main_genre) as mg,
      public._normalize_genre_for_md(t.sub_genre)  as sg,
      coalesce(t.instrumental, false) as is_inst
    from t
  ),
  -- 매장 정책 존재 여부
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
    order by r.priority asc, length(r.genre) desc
    limit 1
  )
  select jsonb_build_object(
    'has_store_policy', (select ok from store_has_rules),
    'matched', exists (select 1 from matched),
    'allowed', coalesce((select is_allowed from matched), false),
    'priority', coalesce((select priority from matched), 100),
    'matched_genre', (select genre from matched),
    'matched_vocal_policy', (select vocal_policy from matched),
    'reason', case
      when not (select ok from store_has_rules) then 'md_policy_undefined_store'
      when exists (select 1 from matched where is_allowed) then 'md_policy_allow'
      else 'md_policy_no_match'
    end
  );
$$;

-- ===== E. auto_place_track v4 (MD 정책 통합) =====
-- 신규 분기: MD 정책 매칭 안 됨 → skip + skip_md_policy 카운트
-- strict 매장 (priority 10) 정책 미정의 → skip
create or replace function public.auto_place_track(p_track_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  t record; a record; r record; pred record;
  v_artist_key text;
  v_threshold numeric := 30; v_max int := 5; v_artist_cap int := 3;
  v_placed int := 0; v_cand int := 0; v_log jsonb := '[]'::jsonb;
  v_skip_block int := 0; v_skip_gate int := 0; v_skip_excl int := 0;
  v_skip_genre_hard int := 0; v_skip_admin_feedback int := 0;
  v_skip_md_policy int := 0;
  v_pl_slug text; v_gr jsonb; v_gr_soft numeric; v_gr_bonus numeric;
  v_fb jsonb; v_fb_delta numeric;
  v_md jsonb;
  v_score_adj numeric;
  v_strict_stores text[] := array['hospital','hotel','bookstore','fine_dining'];
begin
  select * into t from public.tracks where id = p_track_id;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'track_not_found'); end if;
  if coalesce(t.audio_url,'') = '' or not (t.release_status = 'released' or t.release_status is null) then
    insert into public.auto_placement_runs(track_id,status,candidate_count,placed_count,log_json)
      values (p_track_id,'skipped',0,0, jsonb_build_object('reason','not_released_or_no_audio'));
    return jsonb_build_object('ok', true, 'status', 'skipped');
  end if;

  perform public.derive_track_analysis(p_track_id);
  select * into a from public.track_analysis where track_id = p_track_id;
  select * into pred from public.track_ai_predictions
    where track_id = p_track_id and model_version = 'taxonomy-v1';
  v_artist_key := lower(btrim(coalesce(t.artist,'')));
  select count(*) into v_cand from public.playlists where is_auto_generated = true and status = 'released';

  select count(*) into v_skip_excl
  from public.playlists p
  where p.is_auto_generated = true and p.status = 'released'
    and public._track_is_excluded_from_playlist(p_track_id, p.id);

  for r in
    select p.id, p.title, p.business_category, p.ai_store_key,
      (
        coalesce(case when (a.genre is not null and exists(select 1 from unnest(p.genre_tags) g where lower(g)=lower(a.genre)))
                       or exists(select 1 from unnest(p.genre_tags) g where lower(g) = any(select lower(x) from unnest(coalesce(t.genre_tags,'{}')) x))
                  then 25 else 0 end,0)
      + coalesce((select count(*) from unnest(p.mood_tags) m where m = any(a.mood_tags) or lower(coalesce(t.mood,'')) = lower(m)) * 15, 0)
      + coalesce(case when p.business_category is not null and (t.suitable_store = p.business_category or p.business_category = any(coalesce(t.business_tags,'{}'))) then 20 else 0 end,0)
      + coalesce(case when p.daypart is not null and (p.daypart = any(coalesce(t.time_slots,'{}')) or 'all' = any(coalesce(t.time_slots,'{}'))) then 10 else 0 end,0)
      + coalesce(case when p.bpm_min is not null and a.bpm is not null then (case when a.bpm between p.bpm_min and coalesce(p.bpm_max,9999) then 10 else -10 end) else 0 end,0)
      + coalesce(case when p.energy_min is not null and a.energy is not null then (case when a.energy between p.energy_min and coalesce(p.energy_max,100) then 10 else -5 end) else 0 end,0)
      + coalesce(case when p.vocal_preference='vocal' then (case when coalesce(t.instrumental,false) then -10 else 10 end)
                      when p.vocal_preference='instrumental' then (case when coalesce(t.instrumental,false) then 10 else -10 end)
                      else 0 end,0)
      + coalesce(a.quality_score - 70, 0)
      + case when t.created_at >= now() - interval '30 days' then 5 else 0 end
      + coalesce(case when pred.predicted_main_genre is not null
                       and exists(select 1 from unnest(p.genre_tags) g
                                  where lower(g) = lower(pred.predicted_main_genre))
                  then 5 else 0 end, 0)
      + coalesce(least(
          (select count(*) from unnest(coalesce(pred.predicted_moods,'{}'::text[])) pm
           join public.taxonomy_moods tm on tm.slug = pm
           where tm.name_ko = any(coalesce(p.mood_tags,'{}'::text[]))) * 3,
          9), 0)
      + coalesce(least(
          (select count(*) from unnest(coalesce(pred.predicted_store_types,'{}'::text[])) ps
           join public.taxonomy_store_types ts on ts.slug = ps
           where ts.name_ko = p.business_category) * 10,
          20), 0)
      )::numeric as score,
      ((a.genre is not null and exists(select 1 from unnest(p.genre_tags) g where lower(g)=lower(a.genre)))
        or exists(select 1 from unnest(p.genre_tags) g where lower(g) = any(select lower(x) from unnest(coalesce(t.genre_tags,'{}')) x))) as genre_match,
      exists(select 1 from unnest(p.mood_tags) m where m = any(a.mood_tags) or lower(coalesce(t.mood,'')) = lower(m)) as mood_match,
      (p.business_category is not null and (t.suitable_store = p.business_category or p.business_category = any(coalesce(t.business_tags,'{}')))) as business_match,
      exists(
        select 1 from public.track_ai_predictions ap
        where ap.track_id = p_track_id and ap.model_version = 'taxonomy-v1' and ap.predicted_store_types is not null
          and ((p.ai_store_key is not null and p.ai_store_key = any(ap.predicted_store_types))
            or exists(select 1 from public.taxonomy_store_types ts where ts.name_ko = p.business_category and ts.slug = any(ap.predicted_store_types)))
      ) as ai_store_match,
      (p.business_category is not null and exists(
        select 1 from public.genre_block_rules gbr
        where gbr.business_category = p.business_category and gbr.block_kind = 'allow'
          and (position(lower(gbr.genre_pattern) in lower(coalesce(t.main_genre,''))) > 0
            or position(lower(gbr.genre_pattern) in lower(coalesce(t.sub_genre,''))) > 0
            or exists(select 1 from unnest(coalesce(t.genre_tags, '{}'::text[])) gt where position(lower(gbr.genre_pattern) in lower(gt)) > 0))
      )) as allow_match,
      (p.business_category is not null and exists(
        select 1 from public.genre_block_rules gbr
        where gbr.business_category = p.business_category and gbr.block_kind = 'block'
          and ((a.genre is not null and position(lower(gbr.genre_pattern) in lower(a.genre)) > 0)
            or lower(coalesce(t.main_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
            or lower(coalesce(t.sub_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
            or exists(select 1 from unnest(coalesce(t.genre_tags, '{}'::text[])) gt where lower(gt) like '%' || lower(gbr.genre_pattern) || '%'))
      )) as block_match,
      (select string_agg(distinct gbr.genre_pattern, ',') from public.genre_block_rules gbr
       where gbr.business_category = p.business_category and gbr.block_kind = 'block'
         and ((a.genre is not null and position(lower(gbr.genre_pattern) in lower(a.genre)) > 0)
           or lower(coalesce(t.main_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
           or lower(coalesce(t.sub_genre,'')) like '%' || lower(gbr.genre_pattern) || '%')) as matched_block_pattern
    from public.playlists p
    where p.is_auto_generated = true and p.status = 'released'
      and not public._track_is_excluded_from_playlist(p_track_id, p.id)
    order by score desc
  loop
    exit when v_placed >= v_max or r.score < v_threshold;

    if r.block_match and not r.allow_match then
      v_skip_block := v_skip_block + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'decision', 'skip_blocked');
      continue;
    end if;

    v_pl_slug := public.normalize_store_label(r.business_category);
    v_score_adj := r.score;

    if v_pl_slug is not null then
      -- 🆕 X5.4: MD 정책 체크 (가드레일 / store_audio / admin_feedback 전)
      v_md := public._check_store_genre_placement(p_track_id, v_pl_slug);
      if (v_md->>'has_store_policy')::bool then
        if not (v_md->>'matched')::bool then
          v_skip_md_policy := v_skip_md_policy + 1;
          v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1),
            'decision', 'skip_md_policy_no_match', 'reason', v_md->>'reason');
          continue;
        end if;
      elsif v_pl_slug = any(v_strict_stores) then
        -- strict 매장 정책 미정의 → skip (보수적)
        v_skip_md_policy := v_skip_md_policy + 1;
        v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1),
          'decision', 'skip_md_policy_undefined_strict');
        continue;
      end if;

      -- 기존: admin_feedback
      v_fb := public._check_admin_feedback(p_track_id, v_pl_slug);
      if (v_fb->>'hard_skip')::boolean then
        v_skip_admin_feedback := v_skip_admin_feedback + 1;
        v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1),
          'decision', 'skip_admin_feedback');
        continue;
      end if;
      v_fb_delta := coalesce((v_fb->>'score_delta')::numeric, 0);

      -- 기존: X5 genre guardrail
      v_gr := public._check_genre_guardrail(p_track_id, v_pl_slug);
      if (v_gr->>'hard_block')::boolean then
        v_skip_genre_hard := v_skip_genre_hard + 1;
        v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1),
          'decision', 'skip_genre_hard_block');
        continue;
      end if;
      v_gr_soft := coalesce((v_gr->>'soft_penalty_delta')::numeric, 0);
      v_gr_bonus := coalesce((v_gr->>'bonus_delta')::numeric, 0);
      v_score_adj := r.score + v_gr_soft + v_gr_bonus + v_fb_delta;
      if v_score_adj < v_threshold then
        v_log := v_log || jsonb_build_object('playlist', r.title, 'adj_score', round(v_score_adj,1),
          'decision', 'skip_below_threshold_after_guardrail');
        continue;
      end if;
    end if;

    if not (r.genre_match or r.mood_match or r.business_match or r.ai_store_match or r.allow_match) then
      v_skip_gate := v_skip_gate + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'decision', 'skip_gate_failed');
      continue;
    end if;
    if v_artist_key <> '' and (
      select count(*) from public.playlist_tracks pt join public.tracks tt on tt.id = pt.track_id
      where pt.playlist_id = r.id and lower(btrim(coalesce(tt.artist,''))) = v_artist_key
    ) >= v_artist_cap then
      v_log := v_log || jsonb_build_object('playlist', r.title, 'skip', 'artist_cap');
      continue;
    end if;
    begin
      insert into public.playlist_tracks(playlist_id, track_id, order_index, match_score, placement_reason, placed_by)
      values (r.id, p_track_id,
        coalesce((select max(order_index)+1 from public.playlist_tracks where playlist_id = r.id), 0),
        round(v_score_adj,1),
        format('자동 배치 X5.4 (score %s · gate: %s)', round(v_score_adj,1),
          array_to_string(array_remove(array[
            case when r.genre_match then 'genre' end,
            case when r.mood_match then 'mood' end,
            case when r.business_match then 'business' end,
            case when r.ai_store_match then 'ai_store' end,
            case when r.allow_match then 'allow' end
          ], null), '+')),
        'auto');
      v_placed := v_placed + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'decision', 'auto_place');
    exception when unique_violation then
      v_log := v_log || jsonb_build_object('playlist', r.title, 'skip', 'already_placed');
    end;
  end loop;

  insert into public.auto_placement_runs(track_id,status,candidate_count,placed_count,log_json)
  values (p_track_id, case when v_placed > 0 then 'placed' else 'review' end, v_cand, v_placed,
          v_log || jsonb_build_object(
            'skip_blocked', v_skip_block,
            'skip_gate_failed', v_skip_gate,
            'skip_admin_exclusion', v_skip_excl,
            'skip_genre_hard_block', v_skip_genre_hard,
            'skip_admin_feedback', v_skip_admin_feedback,
            'skip_md_policy', v_skip_md_policy));
  return jsonb_build_object('ok', true, 'placed', v_placed, 'candidates', v_cand,
    'skip_blocked', v_skip_block, 'skip_gate_failed', v_skip_gate,
    'skip_admin_exclusion', v_skip_excl, 'skip_genre_hard_block', v_skip_genre_hard,
    'skip_admin_feedback', v_skip_admin_feedback, 'skip_md_policy', v_skip_md_policy,
    'status', case when v_placed > 0 then 'placed' else 'review' end);
end; $function$;

-- ===== F. admin_backfill_store_genre_policy_review (dry_run 기본 true) =====
create or replace function public.admin_backfill_store_genre_policy_review(
  p_dry_run boolean default true
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_total int := 0;
  v_with_policy int := 0;
  v_violations int := 0;
  v_already_admin int := 0;
  v_marked int := 0;
  v_by_store jsonb;
  v_by_genre jsonb;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  create temp table _v on commit drop as
  select pt.playlist_id, pt.track_id,
         public.normalize_store_label(pl.business_category) as slug,
         t.main_genre, coalesce(t.instrumental,false) as is_inst,
         public._check_store_genre_placement(pt.track_id, public.normalize_store_label(pl.business_category)) as ck,
         f.status as cur_status, f.source as cur_source
  from public.playlist_tracks pt
  join public.playlists pl on pl.id = pt.playlist_id
  join public.tracks t on t.id = pt.track_id
  left join public.playlist_track_fit_scores f on f.playlist_id=pt.playlist_id and f.track_id=pt.track_id
  where pt.removed_at is null
    and public.normalize_store_label(pl.business_category) is not null;

  select count(*) into v_total from _v;
  select count(*) into v_with_policy from _v where (ck->>'has_store_policy')::bool;
  select count(*) into v_violations from _v
    where (ck->>'has_store_policy')::bool and not (ck->>'allowed')::bool;
  select count(*) into v_already_admin from _v
    where (ck->>'has_store_policy')::bool and not (ck->>'allowed')::bool
      and cur_source = 'admin';

  select jsonb_object_agg(slug, n) into v_by_store from (
    select slug, count(*) as n from _v
    where (ck->>'has_store_policy')::bool and not (ck->>'allowed')::bool
    group by slug
  ) s;

  select jsonb_object_agg(coalesce(main_genre,'(null)'), n) into v_by_genre from (
    select main_genre, count(*) as n from _v
    where (ck->>'has_store_policy')::bool and not (ck->>'allowed')::bool
    group by main_genre order by 2 desc limit 30
  ) g;

  if not p_dry_run then
    -- review_needed 처리 (admin source 는 보존)
    insert into public.playlist_track_fit_scores
      (playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score,
       reason, source, status, updated_at, reason_codes)
    select v.playlist_id, v.track_id,
           coalesce((select fit_score from public.playlist_track_fit_scores f2
                     where f2.playlist_id=v.playlist_id and f2.track_id=v.track_id), 50),
           0,0,0,0,
           format('[md_policy_violation] %s · genre=%s · vocal=%s',
                  v.slug, v.main_genre,
                  case when v.is_inst then 'instrumental' else 'vocal' end),
           'algorithm', 'review_needed', now(),
           array['md_policy_violation:'||v.slug, 'md_policy_v1']
    from _v v
    where (v.ck->>'has_store_policy')::bool and not (v.ck->>'allowed')::bool
    on conflict (playlist_id, track_id) do update set
      status = case when public.playlist_track_fit_scores.source = 'admin'
                    then public.playlist_track_fit_scores.status
                    else 'review_needed' end,
      reason = case when public.playlist_track_fit_scores.source = 'admin'
                    then public.playlist_track_fit_scores.reason
                    else excluded.reason end,
      reason_codes = case when public.playlist_track_fit_scores.source = 'admin'
                          then public.playlist_track_fit_scores.reason_codes
                          else array_cat(coalesce(public.playlist_track_fit_scores.reason_codes,'{}'::text[]),
                                          excluded.reason_codes) end,
      updated_at = now();
    get diagnostics v_marked = row_count;
  end if;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'total_playlist_tracks_scanned', v_total,
    'with_policy_defined', v_with_policy,
    'violations', v_violations,
    'admin_overrides_protected', v_already_admin,
    'marked_review_needed', v_marked,
    'by_store', coalesce(v_by_store, '{}'::jsonb),
    'by_genre', coalesce(v_by_genre, '{}'::jsonb),
    'note', case when p_dry_run then 'DRY RUN — no DB changes'
                 else 'APPLIED — review_needed marked' end
  );
end; $$;

-- ===== G. admin_list_md_policy_violations =====
create or replace function public.admin_list_md_policy_violations(
  p_store text default null, p_limit int default 200
) returns table (
  playlist_id uuid, playlist_name text, track_id uuid, track_title text, artist text,
  main_genre text, instrumental boolean, store_slug text, reason text,
  fit_score numeric, fit_status text, fit_source text
)
language plpgsql stable security definer set search_path = public as $$
declare v_admin uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return query
    select pt.playlist_id, pl.title, pt.track_id, t.title, t.artist,
           t.main_genre, coalesce(t.instrumental, false),
           public.normalize_store_label(pl.business_category),
           (public._check_store_genre_placement(pt.track_id,
              public.normalize_store_label(pl.business_category)))->>'reason',
           f.fit_score, f.status, f.source
    from public.playlist_tracks pt
    join public.playlists pl on pl.id = pt.playlist_id
    join public.tracks t on t.id = pt.track_id
    left join public.playlist_track_fit_scores f on f.playlist_id=pt.playlist_id and f.track_id=pt.track_id
    where pt.removed_at is null
      and (p_store is null or public.normalize_store_label(pl.business_category) = p_store)
      and (
        public._check_store_genre_placement(pt.track_id,
          public.normalize_store_label(pl.business_category))->>'reason'
      ) in ('md_policy_no_match','md_policy_undefined_store')
    limit coalesce(p_limit, 200);
end; $$;

-- ===== H. admin_md_policy_summary =====
create or replace function public.admin_md_policy_summary()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_admin uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return jsonb_build_object(
    'total_rules', (select count(*) from public.store_genre_placement_rules),
    'distinct_stores', (select count(distinct store_type) from public.store_genre_placement_rules),
    'by_store', (
      select jsonb_object_agg(store_type, n) from (
        select store_type, count(*) as n
        from public.store_genre_placement_rules
        group by store_type
      ) s
    ),
    'by_vocal_policy', (
      select jsonb_object_agg(vocal_policy, n) from (
        select vocal_policy, count(*) as n
        from public.store_genre_placement_rules
        group by vocal_policy
      ) s
    )
  );
end; $$;

-- ===== I. 권한 =====
revoke all on function public._normalize_genre_for_md(text) from public, anon;
revoke all on function public._check_store_genre_placement(uuid, text) from public, anon;
revoke all on function public.admin_backfill_store_genre_policy_review(boolean) from public, anon;
revoke all on function public.admin_list_md_policy_violations(text, int) from public, anon;
revoke all on function public.admin_md_policy_summary() from public, anon;

grant execute on function public._normalize_genre_for_md(text) to authenticated, service_role;
grant execute on function public._check_store_genre_placement(uuid, text) to authenticated, service_role;
grant execute on function public.admin_backfill_store_genre_policy_review(boolean) to authenticated, service_role;
grant execute on function public.admin_list_md_policy_violations(text, int) to authenticated, service_role;
grant execute on function public.admin_md_policy_summary() to authenticated, service_role;
