-- ============================================
-- 데모용 시드 데이터 (음원이 없어도 UI 확인용)
-- ============================================

insert into public.playlists (title, category, thumbnail_url, description, is_business_only, time_slot, sort_order) values
  ('새벽 감성', '새벽 감성', null, '잠 못 드는 새벽, 마음을 가라앉히는 음악', false, 'night', 1),
  ('공부 집중', '공부 집중', null, '딥워크를 위한 잔잔한 트랙', false, null, 2),
  ('카페 음악', '카페 음악', null, '카페에서 듣고 싶은 보사노바 & 재즈', false, null, 3),
  ('드라이브', '드라이브', null, '창문을 열고 달리고 싶은 날', false, null, 4),
  ('운동', '운동', null, '심박수를 올려주는 업비트', false, null, 5),
  ('수면 음악', '수면 음악', null, '깊은 잠으로 데려다주는 앰비언트', false, 'night', 6),
  ('잔잔한 카페 (오전)', '카페', '', '아침 손님을 위한 따뜻한 분위기', true, 'morning', 10),
  ('재즈 와인바 (저녁)', '와인바', '', '저녁의 무드를 끌어올리는 재즈', true, 'evening', 11),
  ('감성 드라이브 (밤)', '드라이브', '', '도시의 밤을 위한 사운드', true, 'night', 12),
  ('필라테스 흐름', '필라테스', '', '호흡에 집중되는 인스트루멘탈', true, null, 13),
  ('PT 펌핑', 'PT샵', '', '운동 텐션을 끌어올리는 비트', true, null, 14)
on conflict do nothing;
