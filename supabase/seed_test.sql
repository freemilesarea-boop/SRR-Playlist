-- ============================================================================
-- AI-ENV-1 — Synthetic Test Seed (격리 Test/Preview DB 전용)
--
-- 절대 원칙: 실제 Production 데이터를 복제하지 않는다. 모든 값은 허구(synthetic)이며
-- 실제 개인정보(이메일/전화/계좌/계약/정산/ISRC)나 Production Row ID 를 포함하지 않는다.
-- Idempotent · Deterministic · Reset 가능 · 최소 데이터.
--
-- 사용: 격리 Test 프로젝트 또는 Local Supabase 에만 적용한다. Production 적용 금지.
--   psql "$TEST_DATABASE_URL" -f supabase/seed_test.sql   (Test Ref 확인 후)
-- 이 파일은 numbered migration 이 아니며 어떤 Production DB 에도 자동 적용되지 않는다.
--
-- 주의: 아래 INSERT 는 각 프로젝트의 실제 스키마(0001~0571 적용 후)에 맞춰 컬럼을
-- 조정해야 할 수 있다. 목적은 Test Store/Playlist/Track 최소 구성 + 명확한 test 표식이다.
-- ============================================================================

-- 결정론적 Test UUID 네임스페이스(고정 prefix 로 Reset 대상 식별 용이).
--   admin  : 00000000-0000-4000-8000-0000000000a1
--   store  : 00000000-0000-4000-8000-0000000000b1
--   brand  : 00000000-0000-4000-8000-0000000000c1
--   plist  : 00000000-0000-4000-8000-0000000000d1
--   track  : 00000000-0000-4000-8000-0000000000e0 + n

begin;

-- 안전장치: Production 으로 오인 적용을 막기 위한 가드(Test 표식 세팅).
-- 실제 실행 환경에서 app.settings 이 없으면 무시된다.
do $$
begin
  perform set_config('srr.seed_context', 'synthetic_test', true);
end $$;

-- Test Users (허구 이메일 @example.com / @srr-test.local — 실제 도메인 금지)
insert into public.users (id, nickname, role, subscription_type, business_category, created_at)
values
  ('00000000-0000-4000-8000-0000000000a1', 'TEST Admin', 'admin', 'business', null, now()),
  ('00000000-0000-4000-8000-0000000000b1', 'TEST Store Owner', 'user', 'business', 'cafe', now())
on conflict (id) do nothing;

-- Test Playlists (business + 일반)
insert into public.playlists (id, title, category, business_category, is_business_only, sort_order, created_at)
values
  ('00000000-0000-4000-8000-0000000000d1', 'TEST 카페 아침', 'business', 'cafe', true, 1000, now()),
  ('00000000-0000-4000-8000-0000000000d2', 'TEST 카페 오후', 'business', 'cafe', true, 1001, now())
on conflict (id) do nothing;

-- Test Tracks (audio_url 은 test-audio 버킷 또는 자체 제작 Test Tone 만 사용 — 유통/계약 음원 금지)
insert into public.tracks (id, title, artist, genre, mood, audio_url, cover_url, duration, created_at)
values
  ('00000000-0000-4000-8000-0000000000e1', 'TEST Tone A', 'Synthetic Artist 1', 'ambient', 'calm', 'https://test.local/test-audio/tone-a.mp3', null, 180, now()),
  ('00000000-0000-4000-8000-0000000000e2', 'TEST Tone B', 'Synthetic Artist 2', 'lofi', 'calm', 'https://test.local/test-audio/tone-b.mp3', null, 200, now()),
  ('00000000-0000-4000-8000-0000000000e3', 'TEST Tone C', 'Synthetic Artist 3', 'jazz', 'warm', 'https://test.local/test-audio/tone-c.mp3', null, 220, now())
on conflict (id) do nothing;

-- Playlist ↔ Track 연결
insert into public.playlist_tracks (id, playlist_id, track_id, order_index)
values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1', 0),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e2', 1),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e3', 2)
on conflict (id) do nothing;

commit;

-- 정직 고지: 이 Seed 에는 실제 회원/매장/아티스트 개인정보, 계약·정산·계좌·결제 데이터,
-- 실제 ISRC, Production Track ID 가 포함되지 않는다. 외부 이메일/SMS/결제/Webhook 은
-- Test 환경 Kill Switch 로 차단된다. Reset 은 test-only 스크립트로만 수행한다.
