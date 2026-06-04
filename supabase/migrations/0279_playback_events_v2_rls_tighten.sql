-- 0279 — playback_events_v2 RLS 잠금 (X6.0.1 — 매장 납품 가드)
--
-- 문제: 기존 정책 `pev2 insert anon` / `pev2 insert authenticated` 는 WITH CHECK (true) —
--       사실상 RLS 우회. 누구나 무제한 INSERT 가능 (spam / 비정상 데이터 주입 가능성).
--       Supabase advisor: rls_policy_always_true 경고.
--
-- 수정:
--   1. 익명 INSERT: anonymous_id + session_id 필수 + event_type 화이트리스트
--   2. 로그인 INSERT: user_id=auth.uid() + session_id 필수 + event_type 화이트리스트
--   3. listened_seconds / track_duration_seconds 비합리적 값 차단 (음수 / 24시간 초과)
--   4. log_playback_event_v2 (security invoker) 는 그대로 — RLS 통과
--
-- 운영 영향:
--   - 정상 클라이언트는 모두 통과 (log_playback_event_v2 로 호출)
--   - 봇/스팸: anon 그룹 INSERT 차단
--   - 데이터 무결성: event_type 오타 / 누락 즉시 거부

drop policy if exists "pev2 insert authenticated" on public.playback_events_v2;
drop policy if exists "pev2 insert anon" on public.playback_events_v2;

-- 허용 event_type 집합 (0253 + 0254 코드와 일치):
--   play_start, play_25, play_50, play_75, play_complete,
--   skip, replay, like, unlike, volume_low, muted, player_error
-- 추후 새 event 추가 시 본 정책도 갱신 필요.

create policy "pev2 insert anon" on public.playback_events_v2
  for insert to anon
  with check (
    -- 익명 사용자는 anonymous_id + session_id 모두 필수
    user_id is null
    and anonymous_id is not null and length(btrim(anonymous_id)) > 0
    and session_id is not null and length(btrim(session_id)) > 0
    and track_id is not null
    and event_type in (
      'play_start','play_progress','play_25','play_50','play_75','play_complete',
      'skip','replay','like','unlike','volume_low','muted','player_error'
    )
    and (listened_seconds is null or (listened_seconds >= 0 and listened_seconds <= 86400))
    and (track_duration_seconds is null or (track_duration_seconds >= 0 and track_duration_seconds <= 86400))
    and (completion_percent is null or (completion_percent >= 0 and completion_percent <= 100))
  );

create policy "pev2 insert authenticated" on public.playback_events_v2
  for insert to authenticated
  with check (
    -- 로그인 사용자는 user_id = auth.uid() 강제 (남의 이름으로 INSERT 차단)
    user_id = auth.uid()
    and session_id is not null and length(btrim(session_id)) > 0
    and track_id is not null
    and event_type in (
      'play_start','play_progress','play_25','play_50','play_75','play_complete',
      'skip','replay','like','unlike','volume_low','muted','player_error'
    )
    and (listened_seconds is null or (listened_seconds >= 0 and listened_seconds <= 86400))
    and (track_duration_seconds is null or (track_duration_seconds >= 0 and track_duration_seconds <= 86400))
    and (completion_percent is null or (completion_percent >= 0 and completion_percent <= 100))
  );

-- 정합성 확인: log_playback_event_v2 RPC 가 위 정책을 통과해야 함.
-- 현재 RPC (0253 line 62) 는 security invoker → RLS 적용 → 위 정책 통과 필요.
-- - track_id 필수: ✓
-- - session_id 필수: 정책상 필수. RPC 는 nullable 로 받음 → 클라이언트가 항상 전달해야 통과.
-- - event_type 화이트리스트: RPC 의 valid_event_types 와 동일.
-- - user_id = auth.uid(): RPC 내부에서 auth.uid() 사용. ✓
-- 클라이언트가 session_id 미전달 시 RPC 가 NULL 로 INSERT 시도 → RLS 거부 → 정상 에러.
