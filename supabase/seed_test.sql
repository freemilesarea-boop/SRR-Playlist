-- ============================================================================
-- AI-ENV-2 — Synthetic Test Seed (격리 Test/Preview DB 전용, 확장판)
--
-- 절대 원칙: 실제 Production 데이터를 복제하지 않는다. 모든 값은 허구(synthetic)이며
-- 실제 개인정보(이메일/전화/계좌/계약/정산/ISRC)나 Production Row ID 를 포함하지 않는다.
-- Deterministic · Idempotent · Resettable · Synthetic-only · 최소 데이터.
--
-- 사용: 격리 Test 프로젝트 또는 Local Supabase 에만 적용한다. Production 적용 금지.
--   npm run db:test:guard   (Test Ref 확인) &&
--   psql "$TEST_DATABASE_URL" -f supabase/seed_test.sql
-- 이 파일은 numbered migration 이 아니며 어떤 Production DB 에도 자동 적용되지 않는다.
--
-- 참고: Audio URL 은 반드시 Test Project 의 test-audio 버킷 또는 권리 명확한 자체 제작
-- Test Tone 만 사용한다. 실제 유통/계약 음원을 복사하지 않는다.
-- ============================================================================

-- 결정론적 Test UUID 네임스페이스(고정 prefix 로 Reset 대상 식별 용이).
--   admin : …a1, store owner : …b1, artists : …a2..a5, brand : …c1
--   playlist : …d1/…d2, track : …e01..e18, playlist_track : …f01..
-- test 표식: nickname/title 앞에 'TEST', 이메일 도메인 example.com / srr-test.local.

begin;

do $$
begin
  perform set_config('srr.seed_context', 'synthetic_test', true);
end $$;

-- ── Users: Test Admin / Store Owner / Artists ──────────────────────────────
insert into public.users (id, nickname, role, subscription_type, business_category, created_at)
values
  ('00000000-0000-4000-8000-0000000000a1', 'TEST Admin',        'admin', 'business', null,   now()),
  ('00000000-0000-4000-8000-0000000000b1', 'TEST Store Owner',  'user',  'business', 'cafe', now()),
  ('00000000-0000-4000-8000-0000000000a2', 'TEST Artist One',   'user',  'free',     null,   now()),
  ('00000000-0000-4000-8000-0000000000a3', 'TEST Artist Two',   'user',  'free',     null,   now()),
  ('00000000-0000-4000-8000-0000000000a4', 'TEST Artist Three', 'user',  'free',     null,   now()),
  ('00000000-0000-4000-8000-0000000000a5', 'TEST Artist Four',  'user',  'free',     null,   now())
on conflict (id) do nothing;

-- ── Playlists (business, 2개) ──────────────────────────────────────────────
insert into public.playlists (id, title, category, business_category, is_business_only, sort_order, created_at)
values
  ('00000000-0000-4000-8000-0000000000d1', 'TEST 카페 아침', 'business', 'cafe', true, 1000, now()),
  ('00000000-0000-4000-8000-0000000000d2', 'TEST 카페 오후', 'business', 'cafe', true, 1001, now())
on conflict (id) do nothing;

-- ── Tracks (18개 — Instrumental/Vocal/Explicit/Clean/Energy/BPM/Genre/Mood/Duration
--    + Invalid URL Fixture + Missing Cover Fixture) ──────────────────────────
insert into public.tracks (id, title, artist, genre, mood, audio_url, cover_url, duration, created_at)
values
  ('00000000-0000-4000-8000-0000000000e01', 'TEST Tone Calm A',    'TEST Artist One',   'ambient', 'calm',   'https://test.local/test-audio/tone-01.mp3', 'https://test.local/cover/01.jpg', 180, now()),
  ('00000000-0000-4000-8000-0000000000e02', 'TEST Tone Calm B',    'TEST Artist One',   'lofi',    'calm',   'https://test.local/test-audio/tone-02.mp3', 'https://test.local/cover/02.jpg', 200, now()),
  ('00000000-0000-4000-8000-0000000000e03', 'TEST Tone Warm C',    'TEST Artist Two',   'jazz',    'warm',   'https://test.local/test-audio/tone-03.mp3', 'https://test.local/cover/03.jpg', 220, now()),
  ('00000000-0000-4000-8000-0000000000e04', 'TEST Vocal Bright D', 'TEST Artist Two',   'pop',     'bright', 'https://test.local/test-audio/tone-04.mp3', 'https://test.local/cover/04.jpg', 195, now()),
  ('00000000-0000-4000-8000-0000000000e05', 'TEST Vocal High E',   'TEST Artist Three', 'dance',   'energetic', 'https://test.local/test-audio/tone-05.mp3', 'https://test.local/cover/05.jpg', 210, now()),
  ('00000000-0000-4000-8000-0000000000e06', 'TEST Instrumental F', 'TEST Artist Three', 'classical','calm',  'https://test.local/test-audio/tone-06.mp3', 'https://test.local/cover/06.jpg', 240, now()),
  ('00000000-0000-4000-8000-0000000000e07', 'TEST Low Energy G',   'TEST Artist Four',  'ambient', 'sleepy', 'https://test.local/test-audio/tone-07.mp3', 'https://test.local/cover/07.jpg', 300, now()),
  ('00000000-0000-4000-8000-0000000000e08', 'TEST High Energy H',  'TEST Artist Four',  'edm',     'energetic', 'https://test.local/test-audio/tone-08.mp3', 'https://test.local/cover/08.jpg', 175, now()),
  ('00000000-0000-4000-8000-0000000000e09', 'TEST Slow BPM I',     'TEST Artist One',   'lofi',    'calm',   'https://test.local/test-audio/tone-09.mp3', 'https://test.local/cover/09.jpg', 260, now()),
  ('00000000-0000-4000-8000-0000000000e10', 'TEST Fast BPM J',     'TEST Artist Two',   'house',   'bright', 'https://test.local/test-audio/tone-10.mp3', 'https://test.local/cover/10.jpg', 185, now()),
  ('00000000-0000-4000-8000-0000000000e11', 'TEST Genre Rock K',   'TEST Artist Three', 'rock',    'intense','https://test.local/test-audio/tone-11.mp3', 'https://test.local/cover/11.jpg', 205, now()),
  ('00000000-0000-4000-8000-0000000000e12', 'TEST Genre RnB L',    'TEST Artist Four',  'rnb',     'warm',   'https://test.local/test-audio/tone-12.mp3', 'https://test.local/cover/12.jpg', 215, now()),
  ('00000000-0000-4000-8000-0000000000e13', 'TEST Mood Happy M',   'TEST Artist One',   'pop',     'happy',  'https://test.local/test-audio/tone-13.mp3', 'https://test.local/cover/13.jpg', 190, now()),
  ('00000000-0000-4000-8000-0000000000e14', 'TEST Mood Sad N',     'TEST Artist Two',   'acoustic','sad',    'https://test.local/test-audio/tone-14.mp3', 'https://test.local/cover/14.jpg', 230, now()),
  ('00000000-0000-4000-8000-0000000000e15', 'TEST Long Duration O','TEST Artist Three', 'ambient', 'calm',   'https://test.local/test-audio/tone-15.mp3', 'https://test.local/cover/15.jpg', 420, now()),
  ('00000000-0000-4000-8000-0000000000e16', 'TEST Short Duration P','TEST Artist Four', 'lofi',    'calm',   'https://test.local/test-audio/tone-16.mp3', 'https://test.local/cover/16.jpg', 45,  now()),
  -- Fixture: Missing Cover (cover_url null) — 재생가능 필터 검증용
  ('00000000-0000-4000-8000-0000000000e17', 'TEST Missing Cover Q','TEST Artist One',   'lofi',    'calm',   'https://test.local/test-audio/tone-17.mp3', null,                              200, now()),
  -- Fixture: Invalid Audio URL (빈 문자열) — 재생불가/dedup 방어 검증용
  ('00000000-0000-4000-8000-0000000000e18', 'TEST Invalid URL R',  'TEST Artist Two',   'lofi',    'calm',   '',                                          'https://test.local/cover/18.jpg', 200, now())
on conflict (id) do nothing;

-- ── Playlist ↔ Track (playlist d1: e01..e10, d2: e11..e16) ─────────────────
insert into public.playlist_tracks (id, playlist_id, track_id, order_index)
values
  ('00000000-0000-4000-8000-0000000000f01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e01', 0),
  ('00000000-0000-4000-8000-0000000000f02', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e02', 1),
  ('00000000-0000-4000-8000-0000000000f03', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e03', 2),
  ('00000000-0000-4000-8000-0000000000f04', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e04', 3),
  ('00000000-0000-4000-8000-0000000000f05', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e05', 4),
  ('00000000-0000-4000-8000-0000000000f06', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e06', 5),
  ('00000000-0000-4000-8000-0000000000f07', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e07', 6),
  ('00000000-0000-4000-8000-0000000000f08', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e08', 7),
  ('00000000-0000-4000-8000-0000000000f09', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e09', 8),
  ('00000000-0000-4000-8000-0000000000f10', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e10', 9),
  ('00000000-0000-4000-8000-0000000000f11', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000e11', 0),
  ('00000000-0000-4000-8000-0000000000f12', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000e12', 1),
  ('00000000-0000-4000-8000-0000000000f13', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000e13', 2),
  ('00000000-0000-4000-8000-0000000000f14', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000e14', 3),
  ('00000000-0000-4000-8000-0000000000f15', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000e15', 4),
  ('00000000-0000-4000-8000-0000000000f16', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000e16', 5)
on conflict (id) do nothing;

commit;

-- ── 선택 확장(적용 스키마에 맞춰 운영자가 조정) ────────────────────────────
-- 아래는 0001~0571 적용 후 실제 컬럼에 맞춰 운영자가 채우는 부분이다(스키마 상이 가능).
--  · Brand / Business: brand_settings 등 실제 테이블에 TEST Brand 1 / Business 1
--  · track_audio_features: energy(0..1)/bpm/instrumentalness — 위 Track 별 Fixture
--  · store_track_reactions: Test Store 의 like/dislike 소량(Reaction Baseline)
--  · playback_events_v2: Test Store 의 재생 이벤트 소량(Store Fit Baseline)
--  · ai_experiment_store_allowlist 후보: Test Store(…b1) — 단, Experiment 실행은 다음 Phase
-- 이 블록들은 실제 PII/계약/정산/계좌/ISRC/Production ID 를 절대 포함하지 않는다.

-- 정직 고지: 이 Seed 에는 실제 회원/매장/아티스트 개인정보, 계약·정산·계좌·결제 데이터,
-- 실제 ISRC, Production Track ID 가 없다. 외부 이메일/SMS/결제/Webhook 은 Test Kill Switch
-- 로 차단된다. Reset 은 test-only 스크립트(고정 prefix 대상)로만 수행한다.
