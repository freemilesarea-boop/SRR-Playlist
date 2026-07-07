-- ============================================================================
-- HOTFIX-C — cafe Guardrail Seed (APPLIED RECORD, 2026-07-07)
-- ============================================================================
-- store_key 'cafe' 에 hard/soft 가드레일 규칙 seed. study_cafe 는 이번에 미적용.
--
-- 적용 범위/안전:
--   - store_guardrails INSERT 10건만 (cafe 전용). 함수/플레이어/테이블/New Track/Auto-Curation 무관.
--   - reason 'HOTFIX-C cafe seed%' 마커 → 롤백이 이 행들만 정확히 삭제.
--   - Preview(78곡) 결과 hard 0 / soft 0 → 회귀 위험 0 확인 후 적용.
--
-- 적용 후 검증 결과:
--   cafe enabled rules = 10 (hard 7 / soft 3)
--   get_playlist_tracks(uuid) = 78, get_playlist_tracks(uuid,uuid) = 78 (queue 유지)
--   hard_block = 0, soft_block = 0
-- ============================================================================

insert into public.store_guardrails (store_key, rule_type, severity, operator, rule_key, value, enabled, reason)
values
  ('cafe','genre','hard_block','contains','banned_genre','edm',       true,'HOTFIX-C cafe seed · 카페 부적합 장르'),
  ('cafe','genre','hard_block','contains','banned_genre','metal',     true,'HOTFIX-C cafe seed · 카페 부적합 장르'),
  ('cafe','genre','hard_block','contains','banned_genre','dubstep',   true,'HOTFIX-C cafe seed · 카페 부적합 장르'),
  ('cafe','genre','hard_block','contains','banned_genre','hardstyle', true,'HOTFIX-C cafe seed · 카페 부적합 장르'),
  ('cafe','genre','hard_block','contains','banned_genre','trap',      true,'HOTFIX-C cafe seed · 카페 부적합 장르'),
  ('cafe','genre','soft_block','contains','banned_genre','rock',      true,'HOTFIX-C cafe seed · 하드록 완화'),
  ('cafe','genre','soft_block','contains','banned_genre','hiphop',    true,'HOTFIX-C cafe seed · 힙합 완화'),
  ('cafe','numeric','hard_block','>','max_energy','0.90',             true,'HOTFIX-C cafe seed · 극단 에너지 차단'),
  ('cafe','numeric','hard_block','>','max_bpm','150',                 true,'HOTFIX-C cafe seed · 극단 템포 차단'),
  ('cafe','numeric','soft_block','>','max_energy','0.80',             true,'HOTFIX-C cafe seed · 에너지 완화');
