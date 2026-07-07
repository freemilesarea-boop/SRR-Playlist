-- ============================================================================
-- HOTFIX-B — cafe / study_cafe Guardrail Seed  ⚠️ PLAN ONLY — NOT YET APPLIED ⚠️
-- ============================================================================
-- 배경:
--   normalize_store_label 은 '카페'→'cafe', '스터디카페'→'study_cafe' 를 만들지만
--   store_guardrails 에 'cafe' / 'study_cafe' store_key 규칙이 전혀 없다.
--   (기존엔 cafe_franchise / cafe_independent 만 존재, 그나마 soft_block 뿐)
--   → 매장 category 를 '카페' 로 세팅해도 hard_block 이 실제로 걸리지 않는다.
--
-- 목적:
--   0404 HOTFIX-A 의 원래 동기(rock/metal/EDM 이 카페/스터디 매장에서 재생되는 것 차단)를
--   실제로 강제하기 위한 'cafe' / 'study_cafe' 가드레일 규칙 seed.
--
-- ⚠️ 승인 필요: 아래 severity/threshold 는 "제안값" 이다 (음악 정책 결정).
--   적용 전 STEP A 임팩트 프리뷰로 정상 곡이 과도하게 잘리지 않는지 확인할 것.
--   확정 전까지 실행하지 말 것.
--
-- 규칙 엔진 참고 (_ai_check_store_guardrails):
--   - genre/contains : _ai_norm_genre(value) 가 트랙 정규화 장르에 포함되면 위반
--   - numeric/>      : track_audio_features 값 > value 면 위반 (피처 없으면 skip)
--   - flag/is_true   : tracks.explicit_content = true 면 위반
--   - severity='hard_block' 위반 → 큐에서 제외 / 'soft_block','warning' → 재생 허용(점수만)
-- ============================================================================


-- ── STEP A: 임팩트 프리뷰 (읽기 전용, seed 전에 실행) ────────────────────────
-- 제안 규칙을 적용했을 때 도형준 카페 플리 78곡 중 몇 곡이 hard_block 되는지 시뮬레이션.
-- (실제 seed 없이 규칙을 인라인 평가 — 정상 곡 과다 차단 여부 사전 점검)
with tracks as (
  select (e->>'id')::uuid as tid
  from jsonb_array_elements(public.get_playlist_tracks('64683310-798a-4548-9446-ac5169cd85d1')) e
),
feat as (
  select t.tid,
         tr.main_genre, tr.genre_tags,
         f.energy, f.bpm
  from tracks t
  join public.tracks tr on tr.id = t.tid
  left join public.track_audio_features f on f.track_id = t.tid
),
norm as (
  select tid, energy, bpm,
    (select array_agg(distinct public._ai_norm_genre(z))
       from unnest(array_remove(array[main_genre] || coalesce(genre_tags,'{}'), null)) z) as g
  from feat
)
select
  count(*) filter (where 'edm'=any(g) or 'metal'=any(g) or 'dubstep'=any(g)
                      or 'hardstyle'=any(g) or 'trap'=any(g)
                      or coalesce(energy,0) > 0.90 or coalesce(bpm,0) > 150)  as proposed_cafe_hard_block,
  count(*) filter (where 'edm'=any(g) or 'metal'=any(g) or 'rock'=any(g)
                      or 'hiphop'=any(g) or 'trap'=any(g)
                      or coalesce(energy,0) > 0.70 or coalesce(bpm,0) > 120)  as proposed_study_cafe_hard_block,
  count(*) as total
from norm;


-- ── STEP B: 실제 seed (승인 후에만 실행) ─────────────────────────────────────
-- reason 에 'HOTFIX-B seed' 마커 — 롤백이 정확히 이 행들만 지우도록.
begin;

insert into public.store_guardrails (store_key, rule_type, severity, operator, rule_key, value, enabled, reason)
values
  -- cafe: rock/metal/EDM 계열 hard_block, 과도 에너지/템포 hard_block, 나머지 soft
  ('cafe','genre','hard_block','contains','banned_genre','edm',        true,'HOTFIX-B seed · 카페 부적합 장르'),
  ('cafe','genre','hard_block','contains','banned_genre','metal',      true,'HOTFIX-B seed · 카페 부적합 장르'),
  ('cafe','genre','hard_block','contains','banned_genre','dubstep',    true,'HOTFIX-B seed · 카페 부적합 장르'),
  ('cafe','genre','hard_block','contains','banned_genre','hardstyle',  true,'HOTFIX-B seed · 카페 부적합 장르'),
  ('cafe','genre','hard_block','contains','banned_genre','trap',       true,'HOTFIX-B seed · 카페 부적합 장르'),
  ('cafe','genre','soft_block','contains','banned_genre','rock',       true,'HOTFIX-B seed · 하드록 완화'),
  ('cafe','genre','soft_block','contains','banned_genre','hiphop',     true,'HOTFIX-B seed · 힙합 완화'),
  ('cafe','numeric','hard_block','>','max_energy','0.90',              true,'HOTFIX-B seed · 극단 에너지 차단'),
  ('cafe','numeric','hard_block','>','max_bpm','150',                  true,'HOTFIX-B seed · 극단 템포 차단'),
  ('cafe','numeric','soft_block','>','max_energy','0.80',              true,'HOTFIX-B seed · 에너지 완화'),

  -- study_cafe: 집중 환경 — 더 엄격
  ('study_cafe','genre','hard_block','contains','banned_genre','edm',    true,'HOTFIX-B seed · 스터디 부적합'),
  ('study_cafe','genre','hard_block','contains','banned_genre','metal',  true,'HOTFIX-B seed · 스터디 부적합'),
  ('study_cafe','genre','hard_block','contains','banned_genre','rock',   true,'HOTFIX-B seed · 스터디 부적합'),
  ('study_cafe','genre','hard_block','contains','banned_genre','hiphop', true,'HOTFIX-B seed · 스터디 부적합'),
  ('study_cafe','genre','hard_block','contains','banned_genre','trap',   true,'HOTFIX-B seed · 스터디 부적합'),
  ('study_cafe','numeric','hard_block','>','max_energy','0.70',          true,'HOTFIX-B seed · 저에너지 유지'),
  ('study_cafe','numeric','hard_block','>','max_bpm','120',              true,'HOTFIX-B seed · 저템포 유지'),
  ('study_cafe','numeric','soft_block','>','max_vocal_presence','0.80',  true,'HOTFIX-B seed · 보컬 완화');

commit;


-- ── STEP C: seed 롤백 (필요 시) ─────────────────────────────────────────────
-- delete from public.store_guardrails
--  where store_key in ('cafe','study_cafe') and reason like 'HOTFIX-B seed%';
