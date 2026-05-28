-- 0215 — 플레이리스트 time_slot 3-슬롯 정규화 (매장 모델과 일치).
--
-- 매장 schedules 가 오전/오후/저녁 3-슬롯 고정이라 플리 분류도 동일하게 정렬.
-- 0215 이전엔 4-slot 타입에 'night' 가 있었고, 실제 데이터에는 enum 밖 'late'/'lunch'
-- 값도 일부 섞여 있었음(데이터 카오스).
--
-- 정리 매핑:
--   'night'  → 'evening'   (밤은 저녁에 흡수, 21시 이후는 매장 마감대로 통합)
--   'late'   → 'evening'   (enum 밖 값, 가장 가까운 의미)
--   'lunch'  → 'afternoon' (점심 → 오후로 흡수, 트랙 태그 시스템과 다른 분류)
--
-- 결과: time_slot 가 'morning' | 'afternoon' | 'evening' | NULL 만 남음.
-- CHECK CONSTRAINT 는 추가 안 함 — 향후 admin UI 에서만 3-slot 입력 가능하도록 제한.
-- (DB level 강제는 마이그 위험 + 외부 INSERT 가능성 대비)

update public.playlists set time_slot = 'evening' where time_slot in ('night', 'late');
update public.playlists set time_slot = 'afternoon' where time_slot = 'lunch';
