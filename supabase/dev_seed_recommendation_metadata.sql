-- ============================================
-- 스르륵 플리 추천 엔진용 메타데이터 시드
-- - seed.sql 의 30 개 트랙에 main_genre, lyric_type,
--   mood_tags, situation_tags, time_slots, season_tags,
--   business_tags, energy_level, brightness_level,
--   emotional_intensity, vocal_presence, bpm 등을 채워 넣음.
-- - 이미 메타데이터가 채워진 트랙은 안전하게 덮어쓰기.
-- - migration 0008_recommendation_metadata.sql 적용 이후 실행.
-- ============================================

begin;

-- ----------------------
-- 새벽 감성 라인 (Lo-fi / Ambient · 잔잔 · 새벽~밤)
-- ----------------------
update public.tracks set
  main_genre = 'lofi',
  sub_genre = 'lofi hip hop',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 72,
  energy_level = 2,
  brightness_level = 2,
  emotional_intensity = 3,
  vocal_presence = 1,
  mood_tags = array['calm', 'lonely', 'dreamy', 'cozy'],
  situation_tags = array['sleep', 'reading', 'night_walk', 'rainy_day'],
  time_slots = array['night', 'dawn'],
  season_tags = array['autumn', 'winter', 'all'],
  business_tags = array['cafe', 'study_cafe'],
  visibility = 'public',
  recommendation_priority = 50,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Quiet Window';

update public.tracks set
  main_genre = 'lofi',
  sub_genre = 'chillhop',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 76,
  energy_level = 2,
  brightness_level = 2,
  emotional_intensity = 3,
  vocal_presence = 1,
  mood_tags = array['calm', 'melancholy', 'dreamy'],
  situation_tags = array['sleep', 'night_walk', 'reading'],
  time_slots = array['night', 'dawn'],
  season_tags = array['autumn', 'winter', 'all'],
  business_tags = array['cafe', 'study_cafe'],
  visibility = 'public',
  recommendation_priority = 50,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Night Sketch';

update public.tracks set
  main_genre = 'ambient',
  sub_genre = 'nature ambient',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 60,
  energy_level = 1,
  brightness_level = 2,
  emotional_intensity = 2,
  vocal_presence = 1,
  mood_tags = array['calm', 'mysterious', 'dreamy'],
  situation_tags = array['sleep', 'reading'],
  time_slots = array['night', 'dawn'],
  season_tags = array['winter', 'all'],
  business_tags = array['cafe'],
  visibility = 'public',
  recommendation_priority = 45,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Slow Lantern';

-- ----------------------
-- Deep Focus (Instrumental · 공부 집중)
-- ----------------------
update public.tracks set
  main_genre = 'instrumental',
  sub_genre = 'piano',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 90,
  energy_level = 2,
  brightness_level = 3,
  emotional_intensity = 2,
  vocal_presence = 1,
  mood_tags = array['calm', 'chill'],
  situation_tags = array['study', 'reading', 'cafe'],
  time_slots = array['morning', 'afternoon'],
  season_tags = array['all'],
  business_tags = array['study_cafe', 'cafe'],
  visibility = 'public',
  recommendation_priority = 60,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Deep Focus 1';

update public.tracks set
  main_genre = 'instrumental',
  sub_genre = 'piano',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 92,
  energy_level = 2,
  brightness_level = 3,
  emotional_intensity = 2,
  vocal_presence = 1,
  mood_tags = array['calm', 'chill'],
  situation_tags = array['study', 'reading', 'cafe'],
  time_slots = array['morning', 'afternoon'],
  season_tags = array['all'],
  business_tags = array['study_cafe', 'cafe'],
  visibility = 'public',
  recommendation_priority = 60,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Deep Focus 2';

update public.tracks set
  main_genre = 'instrumental',
  sub_genre = 'guitar',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 88,
  energy_level = 2,
  brightness_level = 3,
  emotional_intensity = 2,
  vocal_presence = 1,
  mood_tags = array['calm', 'chill', 'warm'],
  situation_tags = array['study', 'reading', 'cafe'],
  time_slots = array['morning', 'afternoon'],
  season_tags = array['all'],
  business_tags = array['study_cafe', 'cafe'],
  visibility = 'public',
  recommendation_priority = 55,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Deep Focus 3';

-- ----------------------
-- Bossa / Jazz / Cafe Morning (Bossa Nova / Jazz · 따뜻 · 카페 오전~오후)
-- ----------------------
update public.tracks set
  main_genre = 'bossa nova',
  sub_genre = 'classic bossa',
  language = 'instrumental',
  lyric_type = 'soft_vocal',
  bpm = 102,
  energy_level = 3,
  brightness_level = 4,
  emotional_intensity = 3,
  vocal_presence = 2,
  mood_tags = array['warm', 'bright', 'happy', 'cozy'],
  situation_tags = array['cafe', 'morning', 'travel'],
  time_slots = array['morning', 'afternoon'],
  season_tags = array['spring', 'summer', 'all'],
  business_tags = array['cafe', 'restaurant', 'boutique'],
  visibility = 'public',
  recommendation_priority = 70,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Bossa Morning';

update public.tracks set
  main_genre = 'jazz',
  sub_genre = 'jazz trio',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 110,
  energy_level = 3,
  brightness_level = 4,
  emotional_intensity = 3,
  vocal_presence = 1,
  mood_tags = array['warm', 'classy', 'cozy', 'bright'],
  situation_tags = array['cafe', 'dinner', 'shop'],
  time_slots = array['afternoon', 'evening'],
  season_tags = array['autumn', 'all'],
  business_tags = array['cafe', 'restaurant', 'winebar'],
  visibility = 'public',
  recommendation_priority = 70,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Cafe Jazz Trio';

update public.tracks set
  main_genre = 'bossa nova',
  sub_genre = 'modern bossa',
  language = 'instrumental',
  lyric_type = 'soft_vocal',
  bpm = 98,
  energy_level = 3,
  brightness_level = 4,
  emotional_intensity = 3,
  vocal_presence = 2,
  mood_tags = array['warm', 'cozy', 'happy'],
  situation_tags = array['cafe', 'afternoon', 'shop'],
  time_slots = array['afternoon'],
  season_tags = array['spring', 'summer', 'all'],
  business_tags = array['cafe', 'boutique', 'restaurant'],
  visibility = 'public',
  recommendation_priority = 65,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Latte Hour';

-- ----------------------
-- 드라이브 (Indie / Synthwave · 드라이브 · 오후~저녁)
-- ----------------------
update public.tracks set
  main_genre = 'indie',
  sub_genre = 'indie rock',
  language = 'en',
  lyric_type = 'vocal',
  bpm = 120,
  energy_level = 4,
  brightness_level = 4,
  emotional_intensity = 3,
  vocal_presence = 4,
  mood_tags = array['bright', 'energetic', 'happy'],
  situation_tags = array['drive', 'travel'],
  time_slots = array['afternoon', 'evening'],
  season_tags = array['summer', 'spring'],
  business_tags = array['boutique'],
  visibility = 'public',
  recommendation_priority = 55,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Open Road';

update public.tracks set
  main_genre = 'indie',
  sub_genre = 'dream pop',
  language = 'en',
  lyric_type = 'vocal',
  bpm = 118,
  energy_level = 3,
  brightness_level = 4,
  emotional_intensity = 3,
  vocal_presence = 4,
  mood_tags = array['bright', 'dreamy', 'happy'],
  situation_tags = array['drive', 'travel'],
  time_slots = array['afternoon', 'evening'],
  season_tags = array['summer', 'spring'],
  business_tags = array['boutique'],
  visibility = 'public',
  recommendation_priority = 55,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Coast Run';

update public.tracks set
  main_genre = 'electronic',
  sub_genre = 'synthwave',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 124,
  energy_level = 4,
  brightness_level = 3,
  emotional_intensity = 3,
  vocal_presence = 1,
  mood_tags = array['energetic', 'dreamy', 'mysterious'],
  situation_tags = array['drive', 'night_walk'],
  time_slots = array['evening', 'night'],
  season_tags = array['summer', 'all'],
  business_tags = array['boutique'],
  visibility = 'public',
  recommendation_priority = 55,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Sunset Highway';

-- ----------------------
-- 운동 펌핑 (EDM / House · 에너지 · PT 매장)
-- ----------------------
update public.tracks set
  main_genre = 'electronic',
  sub_genre = 'edm',
  language = 'en',
  lyric_type = 'vocal',
  bpm = 128,
  energy_level = 5,
  brightness_level = 4,
  emotional_intensity = 4,
  vocal_presence = 3,
  mood_tags = array['energetic', 'bright', 'happy'],
  situation_tags = array['workout'],
  time_slots = array['afternoon', 'evening'],
  season_tags = array['all'],
  business_tags = array['pt'],
  visibility = 'public',
  recommendation_priority = 55,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Beat It Up';

update public.tracks set
  main_genre = 'electronic',
  sub_genre = 'edm',
  language = 'en',
  lyric_type = 'vocal',
  bpm = 132,
  energy_level = 5,
  brightness_level = 4,
  emotional_intensity = 4,
  vocal_presence = 3,
  mood_tags = array['energetic', 'bright'],
  situation_tags = array['workout'],
  time_slots = array['afternoon', 'evening'],
  season_tags = array['all'],
  business_tags = array['pt'],
  visibility = 'public',
  recommendation_priority = 55,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Power Hour';

update public.tracks set
  main_genre = 'house',
  sub_genre = 'tech house',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 126,
  energy_level = 5,
  brightness_level = 3,
  emotional_intensity = 4,
  vocal_presence = 2,
  mood_tags = array['energetic', 'classy'],
  situation_tags = array['workout', 'drive'],
  time_slots = array['afternoon', 'evening'],
  season_tags = array['all'],
  business_tags = array['pt'],
  visibility = 'public',
  recommendation_priority = 55,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Cardio Pulse';

-- ----------------------
-- 수면 (Ambient · 수면 · 밤/새벽)
-- ----------------------
update public.tracks set
  main_genre = 'ambient',
  sub_genre = 'space ambient',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 56,
  energy_level = 1,
  brightness_level = 2,
  emotional_intensity = 2,
  vocal_presence = 1,
  mood_tags = array['calm', 'dreamy'],
  situation_tags = array['sleep'],
  time_slots = array['night', 'dawn'],
  season_tags = array['all'],
  business_tags = array['cafe'],
  visibility = 'public',
  recommendation_priority = 40,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Soft Sleep';

update public.tracks set
  main_genre = 'ambient',
  sub_genre = 'drone',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 52,
  energy_level = 1,
  brightness_level = 1,
  emotional_intensity = 2,
  vocal_presence = 1,
  mood_tags = array['calm', 'mysterious', 'lonely'],
  situation_tags = array['sleep'],
  time_slots = array['night', 'dawn'],
  season_tags = array['winter', 'all'],
  business_tags = array['cafe'],
  visibility = 'public',
  recommendation_priority = 40,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Deep Blue Sleep';

update public.tracks set
  main_genre = 'ambient',
  sub_genre = 'nature ambient',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 58,
  energy_level = 1,
  brightness_level = 2,
  emotional_intensity = 2,
  vocal_presence = 1,
  mood_tags = array['calm', 'dreamy', 'lonely'],
  situation_tags = array['sleep', 'night_walk'],
  time_slots = array['night', 'dawn'],
  season_tags = array['all'],
  business_tags = array['cafe'],
  visibility = 'public',
  recommendation_priority = 40,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Whisper Night';

-- ----------------------
-- 와인바 라인 (Jazz · 무드 · 저녁/밤)
-- ----------------------
update public.tracks set
  main_genre = 'jazz',
  sub_genre = 'smooth jazz',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 90,
  energy_level = 3,
  brightness_level = 2,
  emotional_intensity = 4,
  vocal_presence = 2,
  mood_tags = array['classy', 'sensual', 'romantic', 'emotional'],
  situation_tags = array['winebar', 'dinner', 'date'],
  time_slots = array['evening', 'night'],
  season_tags = array['autumn', 'winter', 'all'],
  business_tags = array['winebar', 'restaurant'],
  visibility = 'public',
  recommendation_priority = 75,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Wine & Sax';

update public.tracks set
  main_genre = 'jazz',
  sub_genre = 'cool jazz',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 86,
  energy_level = 3,
  brightness_level = 2,
  emotional_intensity = 4,
  vocal_presence = 1,
  mood_tags = array['classy', 'romantic', 'emotional', 'mysterious'],
  situation_tags = array['winebar', 'dinner', 'date'],
  time_slots = array['evening', 'night'],
  season_tags = array['autumn', 'winter', 'all'],
  business_tags = array['winebar', 'restaurant'],
  visibility = 'public',
  recommendation_priority = 70,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Midnight Brass';

update public.tracks set
  main_genre = 'jazz',
  sub_genre = 'smooth jazz',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 82,
  energy_level = 2,
  brightness_level = 2,
  emotional_intensity = 4,
  vocal_presence = 1,
  mood_tags = array['classy', 'sensual', 'melancholy', 'emotional'],
  situation_tags = array['winebar', 'dinner', 'date', 'night_walk'],
  time_slots = array['evening', 'night'],
  season_tags = array['autumn', 'winter', 'all'],
  business_tags = array['winebar', 'restaurant'],
  visibility = 'public',
  recommendation_priority = 70,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Slow Whisky';

-- ----------------------
-- 필라테스 (Instrumental · 흐름 · 낮)
-- ----------------------
update public.tracks set
  main_genre = 'instrumental',
  sub_genre = 'piano',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 78,
  energy_level = 2,
  brightness_level = 4,
  emotional_intensity = 2,
  vocal_presence = 1,
  mood_tags = array['calm', 'bright', 'chill'],
  situation_tags = array['workout'],
  time_slots = array['morning', 'afternoon'],
  season_tags = array['all'],
  business_tags = array['pilates'],
  visibility = 'public',
  recommendation_priority = 55,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Pilates Flow 1';

update public.tracks set
  main_genre = 'instrumental',
  sub_genre = 'piano',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 80,
  energy_level = 2,
  brightness_level = 4,
  emotional_intensity = 2,
  vocal_presence = 1,
  mood_tags = array['calm', 'bright', 'chill'],
  situation_tags = array['workout'],
  time_slots = array['morning', 'afternoon'],
  season_tags = array['all'],
  business_tags = array['pilates'],
  visibility = 'public',
  recommendation_priority = 55,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Pilates Flow 2';

update public.tracks set
  main_genre = 'instrumental',
  sub_genre = 'guitar',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 82,
  energy_level = 2,
  brightness_level = 4,
  emotional_intensity = 2,
  vocal_presence = 1,
  mood_tags = array['calm', 'bright', 'chill', 'warm'],
  situation_tags = array['workout'],
  time_slots = array['morning', 'afternoon'],
  season_tags = array['all'],
  business_tags = array['pilates'],
  visibility = 'public',
  recommendation_priority = 55,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Pilates Flow 3';

-- ----------------------
-- 네일샵 (Chillhop · 부드러움 · 낮)
-- ----------------------
update public.tracks set
  main_genre = 'lofi',
  sub_genre = 'chillhop',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 88,
  energy_level = 2,
  brightness_level = 4,
  emotional_intensity = 2,
  vocal_presence = 1,
  mood_tags = array['chill', 'cozy', 'warm', 'bright'],
  situation_tags = array['cafe', 'shop'],
  time_slots = array['afternoon'],
  season_tags = array['all'],
  business_tags = array['nailshop', 'cafe', 'boutique'],
  visibility = 'public',
  recommendation_priority = 50,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Nail Salon Vibes 1';

update public.tracks set
  main_genre = 'lofi',
  sub_genre = 'chillhop',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 90,
  energy_level = 2,
  brightness_level = 4,
  emotional_intensity = 2,
  vocal_presence = 1,
  mood_tags = array['chill', 'cozy', 'warm', 'bright'],
  situation_tags = array['cafe', 'shop'],
  time_slots = array['afternoon'],
  season_tags = array['all'],
  business_tags = array['nailshop', 'cafe', 'boutique'],
  visibility = 'public',
  recommendation_priority = 50,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Nail Salon Vibes 2';

update public.tracks set
  main_genre = 'lofi',
  sub_genre = 'lofi jazz',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 86,
  energy_level = 2,
  brightness_level = 3,
  emotional_intensity = 2,
  vocal_presence = 1,
  mood_tags = array['chill', 'cozy', 'classy'],
  situation_tags = array['cafe', 'shop'],
  time_slots = array['afternoon', 'evening'],
  season_tags = array['all'],
  business_tags = array['nailshop', 'cafe', 'boutique'],
  visibility = 'public',
  recommendation_priority = 50,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Nail Salon Vibes 3';

-- ----------------------
-- 편집샵 (Minimal / Electronic · 시그니처)
-- ----------------------
update public.tracks set
  main_genre = 'electronic',
  sub_genre = 'downtempo',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 100,
  energy_level = 3,
  brightness_level = 3,
  emotional_intensity = 3,
  vocal_presence = 1,
  mood_tags = array['classy', 'mysterious', 'chill'],
  situation_tags = array['shop'],
  time_slots = array['afternoon', 'evening'],
  season_tags = array['all'],
  business_tags = array['boutique', 'cafe'],
  visibility = 'public',
  recommendation_priority = 55,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Boutique Beat 1';

update public.tracks set
  main_genre = 'house',
  sub_genre = 'lounge house',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 108,
  energy_level = 3,
  brightness_level = 3,
  emotional_intensity = 3,
  vocal_presence = 1,
  mood_tags = array['classy', 'chill', 'sensual'],
  situation_tags = array['shop'],
  time_slots = array['afternoon', 'evening'],
  season_tags = array['all'],
  business_tags = array['boutique', 'cafe'],
  visibility = 'public',
  recommendation_priority = 55,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Boutique Beat 2';

update public.tracks set
  main_genre = 'electronic',
  sub_genre = 'downtempo',
  language = 'instrumental',
  lyric_type = 'instrumental',
  bpm = 104,
  energy_level = 3,
  brightness_level = 3,
  emotional_intensity = 3,
  vocal_presence = 1,
  mood_tags = array['classy', 'mysterious', 'chill'],
  situation_tags = array['shop'],
  time_slots = array['afternoon', 'evening'],
  season_tags = array['all'],
  business_tags = array['boutique'],
  visibility = 'public',
  recommendation_priority = 55,
  copyright_status = 'owned',
  is_recommendable = true
where title = 'Boutique Beat 3';

commit;

-- ----------------------
-- 확인용 쿼리 (수동 실행):
--   select count(*) from public.tracks where main_genre is not null;
--   select title, main_genre, mood_tags, time_slots, business_tags
--   from public.tracks where main_genre is not null order by title;
-- ----------------------
