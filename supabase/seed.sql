-- ============================================
-- 스르륵 플리 시드 데이터
-- - 일반/사업자 플레이리스트
-- - 더미 트랙 연결 (audio_url 은 빈 문자열, UI 가 “샘플 음원 없음” 으로 처리)
-- - 실제 음원은 관리자 페이지에서 업로드 후 audio_url 을 채워주세요.
-- ============================================

begin;

-- ----------------------
-- 플레이리스트 (slug 역할로 title 사용)
-- ----------------------
insert into public.playlists (title, category, thumbnail_url, description, is_business_only, business_category, time_slot, sort_order) values
  -- 일반
  ('새벽 감성 한 잔', '새벽 감성', null, '잠 못 드는 새벽, 마음을 가라앉히는 잔잔한 곡들', false, null, 'night', 1),
  ('공부 집중', '공부 집중', null, '딥워크를 위한 인스트루멘탈', false, null, null, 2),
  ('카페 음악', '카페 음악', null, '카페에서 듣고 싶은 보사노바 & 재즈', false, null, null, 3),
  ('드라이브', '드라이브', null, '창문을 열고 달리고 싶은 날', false, null, null, 4),
  ('운동 펌핑', '운동', null, '심박수를 올려주는 업비트', false, null, null, 5),
  ('수면 음악', '수면 음악', null, '깊은 잠으로 데려다주는 앰비언트', false, null, 'night', 6),

  -- 사업자 전용
  ('잔잔한 카페 (오전)', '카페 음악', null, '아침 손님을 위한 따뜻한 분위기', true, '카페', 'morning', 10),
  ('카페 라운지 (오후)', '카페 음악', null, '오후 햇살에 어울리는 라운지', true, '카페', 'afternoon', 11),
  ('재즈 와인바 (저녁)', '와인바 음악', null, '저녁의 무드를 끌어올리는 재즈', true, '와인바', 'evening', 12),
  ('PT 펌핑', 'PT 음악', null, '운동 텐션을 끌어올리는 비트', true, 'PT샵', null, 13),
  ('필라테스 흐름', '필라테스 음악', null, '호흡에 집중되는 인스트루멘탈', true, '필라테스', null, 14),
  ('네일샵 무드', '네일샵 음악', null, '편안한 네일샵 분위기', true, '네일샵', null, 15),
  ('편집샵 시그니처', '편집샵 음악', null, '브랜드 무드를 살리는 미니멀 비트', true, '편집샵', null, 16)
on conflict do nothing;

-- ----------------------
-- 더미 트랙 (audio_url 은 빈 문자열 placeholder)
-- ----------------------
insert into public.tracks (title, artist, genre, mood, audio_url, cover_url, duration) values
  ('Quiet Window',           '스르륵 데모', 'Lo-fi',         'calm',     '', null, 180),
  ('Night Sketch',           '스르륵 데모', 'Lo-fi',         'calm',     '', null, 200),
  ('Slow Lantern',           '스르륵 데모', 'Ambient',       'calm',     '', null, 220),

  ('Deep Focus 1',           '스르륵 데모', 'Instrumental',  'focus',    '', null, 240),
  ('Deep Focus 2',           '스르륵 데모', 'Instrumental',  'focus',    '', null, 240),
  ('Deep Focus 3',           '스르륵 데모', 'Instrumental',  'focus',    '', null, 240),

  ('Bossa Morning',          '스르륵 데모', 'Bossa Nova',    'warm',     '', null, 195),
  ('Cafe Jazz Trio',         '스르륵 데모', 'Jazz',          'warm',     '', null, 210),
  ('Latte Hour',             '스르륵 데모', 'Bossa Nova',    'warm',     '', null, 200),

  ('Open Road',              '스르륵 데모', 'Indie',         'drive',    '', null, 215),
  ('Coast Run',              '스르륵 데모', 'Indie',         'drive',    '', null, 220),
  ('Sunset Highway',         '스르륵 데모', 'Synthwave',     'drive',    '', null, 235),

  ('Beat It Up',             '스르륵 데모', 'EDM',           'energetic','', null, 200),
  ('Power Hour',             '스르륵 데모', 'EDM',           'energetic','', null, 210),
  ('Cardio Pulse',           '스르륵 데모', 'House',         'energetic','', null, 220),

  ('Soft Sleep',             '스르륵 데모', 'Ambient',       'sleep',    '', null, 300),
  ('Deep Blue Sleep',        '스르륵 데모', 'Ambient',       'sleep',    '', null, 320),
  ('Whisper Night',          '스르륵 데모', 'Ambient',       'sleep',    '', null, 280),

  ('Wine & Sax',             '스르륵 데모', 'Jazz',          'mellow',   '', null, 230),
  ('Midnight Brass',         '스르륵 데모', 'Jazz',          'mellow',   '', null, 240),
  ('Slow Whisky',            '스르륵 데모', 'Jazz',          'mellow',   '', null, 250),

  ('Pilates Flow 1',         '스르륵 데모', 'Instrumental',  'flow',     '', null, 260),
  ('Pilates Flow 2',         '스르륵 데모', 'Instrumental',  'flow',     '', null, 270),
  ('Pilates Flow 3',         '스르륵 데모', 'Instrumental',  'flow',     '', null, 280),

  ('Nail Salon Vibes 1',     '스르륵 데모', 'Chillhop',      'soft',     '', null, 200),
  ('Nail Salon Vibes 2',     '스르륵 데모', 'Chillhop',      'soft',     '', null, 210),
  ('Nail Salon Vibes 3',     '스르륵 데모', 'Chillhop',      'soft',     '', null, 220),

  ('Boutique Beat 1',        '스르륵 데모', 'Minimal',       'cool',     '', null, 200),
  ('Boutique Beat 2',        '스르륵 데모', 'Minimal',       'cool',     '', null, 215),
  ('Boutique Beat 3',        '스르륵 데모', 'Minimal',       'cool',     '', null, 220)
on conflict do nothing;

-- ----------------------
-- 매핑 (각 플레이리스트 → 트랙 3곡 이상)
-- ----------------------
do $$
declare
  pid uuid;
  ids uuid[];
  i int;
begin
  -- 새벽 감성
  select id into pid from public.playlists where title = '새벽 감성 한 잔' limit 1;
  if pid is not null then
    select array_agg(id) into ids from public.tracks where title in ('Quiet Window','Night Sketch','Slow Lantern','Whisper Night');
    for i in 1..coalesce(array_length(ids, 1), 0) loop
      insert into public.playlist_tracks(playlist_id, track_id, order_index) values (pid, ids[i], i - 1) on conflict do nothing;
    end loop;
  end if;

  -- 공부 집중
  select id into pid from public.playlists where title = '공부 집중' limit 1;
  if pid is not null then
    select array_agg(id) into ids from public.tracks where title in ('Deep Focus 1','Deep Focus 2','Deep Focus 3');
    for i in 1..coalesce(array_length(ids, 1), 0) loop
      insert into public.playlist_tracks(playlist_id, track_id, order_index) values (pid, ids[i], i - 1) on conflict do nothing;
    end loop;
  end if;

  -- 카페 음악 (일반)
  select id into pid from public.playlists where title = '카페 음악' limit 1;
  if pid is not null then
    select array_agg(id) into ids from public.tracks where title in ('Bossa Morning','Cafe Jazz Trio','Latte Hour');
    for i in 1..coalesce(array_length(ids, 1), 0) loop
      insert into public.playlist_tracks(playlist_id, track_id, order_index) values (pid, ids[i], i - 1) on conflict do nothing;
    end loop;
  end if;

  -- 드라이브
  select id into pid from public.playlists where title = '드라이브' limit 1;
  if pid is not null then
    select array_agg(id) into ids from public.tracks where title in ('Open Road','Coast Run','Sunset Highway');
    for i in 1..coalesce(array_length(ids, 1), 0) loop
      insert into public.playlist_tracks(playlist_id, track_id, order_index) values (pid, ids[i], i - 1) on conflict do nothing;
    end loop;
  end if;

  -- 운동 펌핑
  select id into pid from public.playlists where title = '운동 펌핑' limit 1;
  if pid is not null then
    select array_agg(id) into ids from public.tracks where title in ('Beat It Up','Power Hour','Cardio Pulse');
    for i in 1..coalesce(array_length(ids, 1), 0) loop
      insert into public.playlist_tracks(playlist_id, track_id, order_index) values (pid, ids[i], i - 1) on conflict do nothing;
    end loop;
  end if;

  -- 수면 음악
  select id into pid from public.playlists where title = '수면 음악' limit 1;
  if pid is not null then
    select array_agg(id) into ids from public.tracks where title in ('Soft Sleep','Deep Blue Sleep','Whisper Night');
    for i in 1..coalesce(array_length(ids, 1), 0) loop
      insert into public.playlist_tracks(playlist_id, track_id, order_index) values (pid, ids[i], i - 1) on conflict do nothing;
    end loop;
  end if;

  -- 사업자: 잔잔한 카페 (오전)
  select id into pid from public.playlists where title = '잔잔한 카페 (오전)' limit 1;
  if pid is not null then
    select array_agg(id) into ids from public.tracks where title in ('Bossa Morning','Cafe Jazz Trio','Latte Hour');
    for i in 1..coalesce(array_length(ids, 1), 0) loop
      insert into public.playlist_tracks(playlist_id, track_id, order_index) values (pid, ids[i], i - 1) on conflict do nothing;
    end loop;
  end if;

  -- 사업자: 카페 라운지 (오후)
  select id into pid from public.playlists where title = '카페 라운지 (오후)' limit 1;
  if pid is not null then
    select array_agg(id) into ids from public.tracks where title in ('Latte Hour','Quiet Window','Bossa Morning');
    for i in 1..coalesce(array_length(ids, 1), 0) loop
      insert into public.playlist_tracks(playlist_id, track_id, order_index) values (pid, ids[i], i - 1) on conflict do nothing;
    end loop;
  end if;

  -- 사업자: 재즈 와인바 (저녁)
  select id into pid from public.playlists where title = '재즈 와인바 (저녁)' limit 1;
  if pid is not null then
    select array_agg(id) into ids from public.tracks where title in ('Wine & Sax','Midnight Brass','Slow Whisky');
    for i in 1..coalesce(array_length(ids, 1), 0) loop
      insert into public.playlist_tracks(playlist_id, track_id, order_index) values (pid, ids[i], i - 1) on conflict do nothing;
    end loop;
  end if;

  -- 사업자: PT 펌핑
  select id into pid from public.playlists where title = 'PT 펌핑' limit 1;
  if pid is not null then
    select array_agg(id) into ids from public.tracks where title in ('Beat It Up','Power Hour','Cardio Pulse');
    for i in 1..coalesce(array_length(ids, 1), 0) loop
      insert into public.playlist_tracks(playlist_id, track_id, order_index) values (pid, ids[i], i - 1) on conflict do nothing;
    end loop;
  end if;

  -- 사업자: 필라테스 흐름
  select id into pid from public.playlists where title = '필라테스 흐름' limit 1;
  if pid is not null then
    select array_agg(id) into ids from public.tracks where title in ('Pilates Flow 1','Pilates Flow 2','Pilates Flow 3');
    for i in 1..coalesce(array_length(ids, 1), 0) loop
      insert into public.playlist_tracks(playlist_id, track_id, order_index) values (pid, ids[i], i - 1) on conflict do nothing;
    end loop;
  end if;

  -- 사업자: 네일샵 무드
  select id into pid from public.playlists where title = '네일샵 무드' limit 1;
  if pid is not null then
    select array_agg(id) into ids from public.tracks where title in ('Nail Salon Vibes 1','Nail Salon Vibes 2','Nail Salon Vibes 3');
    for i in 1..coalesce(array_length(ids, 1), 0) loop
      insert into public.playlist_tracks(playlist_id, track_id, order_index) values (pid, ids[i], i - 1) on conflict do nothing;
    end loop;
  end if;

  -- 사업자: 편집샵 시그니처
  select id into pid from public.playlists where title = '편집샵 시그니처' limit 1;
  if pid is not null then
    select array_agg(id) into ids from public.tracks where title in ('Boutique Beat 1','Boutique Beat 2','Boutique Beat 3');
    for i in 1..coalesce(array_length(ids, 1), 0) loop
      insert into public.playlist_tracks(playlist_id, track_id, order_index) values (pid, ids[i], i - 1) on conflict do nothing;
    end loop;
  end if;
end $$;

commit;
