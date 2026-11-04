-- 0538 — 계측 공백을 메우는 독립 진행 축: continue_listening.position_sec 표본
--
-- ── 무엇이 문제인가 (2026-11-04 실측) ─────────────────────────────────────
--
-- 지금 살아서 heartbeat 를 보내는 브랜드 플레이어 세션을 전수 조사했다.
--
--   숙대점          Windows 데스크톱 Chrome   오디오진행 18초   계측 ○
--   분당미금역점     Android SM-F926N  Build/  오디오진행 null   계측 ✗
--   화정점          Android SM-X205N  Build/  오디오진행 null   계측 ✗
--   김포장기역점     Android LM-V500N  Build/  오디오진행 null   계측 ✗
--   일산후곡학원가점  Android SM-X230   Build/  오디오진행 null   계측 ✗
--   minnnnng27      iPhone Safari             오디오진행 ○      계측 ○
--
-- 갈리는 기준이 정확히 하나다. **UA 에 `Build/` 가 있으면 계측이 전부 null.**
-- `Build/` 는 안드로이드 WebView UA 의 표식이고, 이 프로젝트의 WebView 는
-- Capacitor 네이티브 앱(`com.deudda.app`)이다.
--
-- capacitor.config.ts 가 원인을 확정해 준다.
--
--   webDir: 'dist'   // 네이티브는 로컬 번들에서 로드
--   // server.url 은 개발용 라이브 리로드에만 사용 — 배포 빌드에는 절대 넣지 않음
--
-- 즉 **앱 안의 웹 코드는 APK 를 구운 시점에 고정된다.** 웹은 그 뒤로 계속
-- 배포됐지만(빌드 해시 609cc9720d1d → 41ad0979ea1e → 2b5e810e82d3 →
-- 57c5e1ec334e), 앱은 설치된 APK 의 번들을 계속 쓴다. 그 번들은 계측
-- (0524 · 0526 · 0527)이 들어가기 전 코드다. page_build_hash 조차 null 인
-- 것이 바로 그 증거다.
--
-- ── 이 마이그레이션이 하지 않는 것 ────────────────────────────────────────
--
-- **웹 코드를 고치지 않는다. 고칠 게 없다.** 현재 웹 클라이언트는 완전하다:
-- Player.tsx:2891 이 currentTime 이 실제로 늘어난 순간에만 noteAudioProgress
-- 를 부르고, useBrandPlayerHeartbeat 가 매 heartbeat 에 그 값을 싣는다.
-- 문제는 앱이 그 코드를 아직 안 받은 것이다. **진짜 해결은 APK 재출시와
-- 점주의 앱 업데이트이고, 그건 SQL 로도 웹 배포로도 안 된다.**
--
-- **감지 규칙을 바꾸지 않는다.** audio_progress 를 "계정 내 전체 세션의
-- 최댓값" 으로 바꾸려다 멈췄다. 그렇게 하면 지금 정상 재생 중인
-- 분당미금역(최댓값 18일 전) · 화정점(5.9일 전)이 즉시 frozen 으로
-- 오탐된다. 계측을 안 올리는 클라이언트는 "증거가 없다" 이지
-- "얼었다" 가 아니다. 이 둘을 섞으면 책임 전가가 된다.
--
-- ── 이 마이그레이션이 하는 것 ─────────────────────────────────────────────
--
-- APK 없이도 쓸 수 있는 **독립 진행 축**을 만든다.
-- continue_listening.position_sec 은 구 번들도 쓰는 값이고, 메인 스레드
-- 타이머가 아니라 **미디어 타임라인 위의 값**이다. heartbeat 과 독립이다.
--
-- 단, 곡 교체는 진행의 증거로 쓰지 않는다. 2026-09-15 숙대점에서 26곡이
-- 연속으로 얼었다 — 곡은 계속 넘어가는데 소리는 안 났다. 그래서
-- **같은 track_id 안에서 position_sec 이 늘어난 경우만** 진행으로 센다.
-- (mediaProgress.ts 의 track_change ≠ progress 와 같은 기준이다.)
--
-- 표본 간격은 2분이다. 곡이 3~4분이므로 같은 곡에서 두 표본을 잡으려면
-- 간격이 곡 길이보다 뚜렷히 짧아야 한다. 10분 간격으로는 같은 곡 쌍이
-- 거의 안 잡힌다.
--
-- **지금은 관측만 한다. 알림을 걸지 않는다.**
-- 새 감지 축을 검증 없이 알림에 연결하면 오탐이 터진다(바로 위에서 한 번
-- 막았다). 하루치 실데이터가 쌓이면 경계값을 실측으로 정하고, 그때
-- 판정에 올린다. 그 전까지는 09/21시 보고에 관측값으로만 싣는다.

create table if not exists public.store_position_samples (
  id            bigserial primary key,
  user_id       uuid        not null,
  sampled_at    timestamptz not null default now(),
  cl_updated_at timestamptz,
  track_id      uuid,
  position_sec  integer
);

comment on table public.store_position_samples is
  'continue_listening.position_sec 의 시계열 표본. 계측(last_audio_progress_at)을 '
  '올리지 않는 구 번들 안드로이드 앱 매장에도 쓸 수 있는 독립 진행 축을 만들기 위한 것. '
  '같은 track_id 안에서 position_sec 이 늘어난 경우만 진행으로 센다 — 곡 교체는 '
  '진행의 증거가 아니다(2026-09-15 숙대점: 26곡 연속 동결). 2분 간격 수집 · 7일 보관.';

create index if not exists store_position_samples_user_time_idx
  on public.store_position_samples (user_id, sampled_at desc);

-- 같은 곡 안의 전진을 찾는 자기조인용.
create index if not exists store_position_samples_user_track_idx
  on public.store_position_samples (user_id, track_id, sampled_at);

alter table public.store_position_samples enable row level security;

-- 서버(크론)만 쓴다. 클라이언트 경로를 열지 않는다.
-- 조회는 SECURITY DEFINER 함수(srr_store_report)를 통해서만 나간다.

create or replace function public.srr_sample_store_positions()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n int; v_pruned int;
begin
  -- 최근 2시간 안에 움직인 계정만 찍는다. 몇 달 전 값을 2분마다 다시
  -- 적어서 테이블을 불리지 않는다.
  insert into public.store_position_samples (user_id, cl_updated_at, track_id, position_sec)
  select cl.user_id, cl.updated_at, cl.track_id, cl.position_sec
    from public.continue_listening cl
    join public.users u on u.id = cl.user_id
   where u.withdrawn_at is null and u.disabled_at is null
     and not public._is_monitoring_exempt(cl.user_id)
     and cl.updated_at > now() - interval '2 hours';
  get diagnostics v_n = row_count;

  delete from public.store_position_samples
   where sampled_at < now() - interval '7 days';
  get diagnostics v_pruned = row_count;

  return jsonb_build_object('ok', true, 'sampled', v_n, 'pruned', v_pruned, 'at', now());
end;
$function$;

comment on function public.srr_sample_store_positions() is
  '2분마다 재생 중인 매장의 continue_listening 위치를 표본으로 적는다. 알림을 쏘지 않는다 — 관측 전용.';

select cron.unschedule('srr-position-sample')
 where exists (select 1 from cron.job where jobname = 'srr-position-sample');

select cron.schedule('srr-position-sample', '*/2 * * * *',
                     'select public.srr_sample_store_positions();');
