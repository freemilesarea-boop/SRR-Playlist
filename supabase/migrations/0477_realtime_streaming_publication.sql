-- ============================================================================
-- 0477_realtime_streaming_publication.sql
-- 앱/웹 스트리밍 이벤트를 Supabase Realtime 으로 발행 — 관리자 페이지에서 실시간 수신.
--
-- 목적(앱 출시 대비 실시간 파이프라인): 웹/모바일 앱이 같은 Supabase 백엔드를 공유하는
--   클라이언트이므로, 앱에서 스트리밍하면 동일한 stream_events 테이블에 기록된다.
--   그 INSERT 를 Realtime publication 에 올려 관리자 대시보드가 라이브로 구독하게 한다.
--
-- 안전: publication 에 테이블을 추가만 함(additive). 데이터/RLS/트리거 무변경.
--   Realtime 구독은 각 테이블의 기존 admin SELECT RLS 로 인가됨(관리자만 수신).
--   현재 supabase_realtime 에는 payment_orders, users 만 있음 → 스트리밍 테이블 추가.
-- ============================================================================

do $$
begin
  -- stream_events (v1, payout-eligible 스트림 — 관리자 실시간 모니터의 주 소스)
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='stream_events'
  ) then
    execute 'alter publication supabase_realtime add table public.stream_events';
  end if;

  -- playback_events_v2 (v2 재생 이벤트)
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='playback_events_v2'
  ) then
    execute 'alter publication supabase_realtime add table public.playback_events_v2';
  end if;

  -- track_play_events (트랙 재생/스킵 이벤트)
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='track_play_events'
  ) then
    execute 'alter publication supabase_realtime add table public.track_play_events';
  end if;
end $$;
