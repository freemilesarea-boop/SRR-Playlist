-- 0537 — 감시 제외를 "신원"으로 판정한다. 명부에 206행을 박지 않는다.
--
-- 배경
--   아티스트 계정이 브랜드 플레이어를 열면 감지가 매장으로 보고 [긴급] 을 쏜다.
--   2026-10-30 에 실제로 터져서 louverabe@gmail.com · gudwns@swk.today ·
--   minseo@swk.today 를 brand_player_monitoring_exempt 에 손으로 넣어 막았다.
--
--   그런데 그건 그날의 명단일 뿐이다. **내일 가입한 아티스트는 또 한 번 쏜다.**
--   형님이 "아티스트 206개 계정 일괄 제외" 를 승인했지만, 206행을 넣는 것은
--   스냅샷이라 같은 구멍을 다시 만든다. 그래서 행을 넣지 않고 규칙으로 막는다.
--
-- 판정 기준 — 계정 신원. 라벨로 하지 않는다.
--   2026-10-30 에 라벨 기준 제외가 실제로 뚫렸다. franchise_stores 에 행이
--   생기는 순간 표시값이 store_name 으로 바뀌어 이메일 도메인 필터를
--   우회했다. 표시값으로 거르면 표시값이 바뀌는 순간 뚫린다.
--
--   그래서 세 가지를 OR 로 본다. 전부 신원이고, 전부 바뀌지 않는 값이다.
--     1) brand_player_monitoring_exempt 에 명시된 계정 (문서화된 예외)
--     2) users.account_type = 'artist'
--     3) artist_profiles 행이 있다
--
--   2)와 3)을 모두 보는 이유: 두 값이 2026-10-30 시점에 206 = 206 으로
--   일치했지만, 한쪽만 세팅되는 경로가 생기면 조용히 뚫린다. 둘 중 하나라도
--   아티스트면 아티스트로 본다. subscriptions.plan_type 은 쓰지 않는다 —
--   student_artist / artist_student 로 표기가 갈리고, 구독 없는 아티스트가
--   65명이다.
--
-- 적용 범위 — 한 곳에서 판정해서 두 곳이 같이 쓴다.
--   판정이 두 곳에 복사돼 있으면 반드시 갈라진다(이번 달에 세 번 겪었다).
--   그래서 _is_monitoring_exempt() 하나를 만들고
--   _brand_player_liveness() 와 detect_brand_player_incidents() 가 같이 쓴다.
--
-- 적용 시점 영향 확인 (2026-11-04 18:0x KST)
--   열려 있던 장애는 1건(이루밍 김포장기역점, business 계정)뿐이라
--   이 변경으로 조용히 닫히는 건은 0건이다. 부작용 없음.
--
-- 건드리지 않는 것
--   · 감지 경계값(p_suspected_seconds / p_down_seconds / stall_threshold) 그대로
--   · frozen / stalled / silence 규칙 자체는 손대지 않는다
--   · incident 행·세션 행에 쓰지 않는다. 이 마이그레이션은 판정 기준만 바꾼다
--   · brand_player_monitoring_exempt 에 행을 넣지 않는다 (명시적 예외 전용으로 남긴다)

create or replace function public._is_monitoring_exempt(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p_user_id is not null and (
       -- 1) 문서화된 명시적 예외 (데모·내부 도메인·운영자 본인·직원 테스트)
       exists (select 1 from public.brand_player_monitoring_exempt e
                where e.store_user_id = p_user_id)
       -- 2)·3) 아티스트 신원 — 매장이 아니다. 둘 중 하나라도 걸리면 아티스트로 본다.
    or exists (select 1 from public.users u
                where u.id = p_user_id and coalesce(u.account_type,'') = 'artist')
    or exists (select 1 from public.artist_profiles ap
                where ap.user_id = p_user_id)
  );
$function$;

comment on function public._is_monitoring_exempt(uuid) is
  '브랜드 플레이어 감시에서 제외할 계정인가. 명시적 예외 테이블 OR 아티스트 신원. '
  '판정은 계정 신원으로만 한다 — 라벨·표시값으로 거르면 표시값이 바뀌는 순간 뚫린다(2026-10-30). '
  '_brand_player_liveness 와 detect_brand_player_incidents 가 이 함수 하나를 공유한다.';

-- ── _brand_player_liveness: monitoring_exempt 판정을 공유 함수로 교체 ──────
-- 나머지 로직(세션 선택·오디오 진행·shell)은 그대로 둔다.
-- 특히 audio_progress_age_seconds 를 "계정 내 전체 세션의 최댓값" 으로
-- 바꾸지 않는다. 그렇게 하면 지금 정상 재생 중인 분당미금역(오디오진행
-- 최댓값 18일 전)·화정점(5.9일 전)이 즉시 frozen 으로 오탐된다. 실측으로
-- 확인했다. 계측을 안 올리는 클라이언트는 "증거가 없다" 이지 "얼었다" 가 아니다.
create or replace function public._brand_player_liveness(p_minutes integer default 1440)
returns table(brand_id uuid, brand_name text, user_id uuid, store_label text,
              heartbeat_age_seconds integer, last_signal_at timestamp with time zone,
              session_id uuid, device text, current_track_title text,
              seconds_on_current_track integer, stall_threshold_seconds integer,
              playback_expected boolean, monitoring_exempt boolean,
              audio_progress_age_seconds integer,
              last_audio_progress_at timestamp with time zone,
              shell_age_seconds integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- 매장별로 "지금 열려 있는 incident 가 지목한 세션".
  with open_inc as (
    select distinct on (i.store_user_id) i.store_user_id, i.session_id
      from public.brand_player_incidents i
     where i.resolved_at is null and i.session_id is not null
     order by i.store_user_id, i.opened_at desc
  ),
  -- _brand_player_session_health 는 이미 revoked_at is null 로 거른다.
  canonical as (
    select distinct on (h.user_id) h.*
      from public._brand_player_session_health(greatest(1, p_minutes)) h
      left join open_inc oi on oi.store_user_id = h.user_id
     order by h.user_id,
              -- ★ 열린 incident 가 가리키는 세션을 **무조건 먼저** 고른다.
              (oi.session_id is not null and h.session_id = oi.session_id) desc,
              h.seconds_since_heartbeat asc
  )
  select c.brand_id, c.brand_name, c.user_id, c.store_label,
         c.seconds_since_heartbeat,
         c.last_seen_at,
         c.session_id, c.device, c.current_track_title,
         c.seconds_on_current_track, c.stall_threshold_seconds,
         coalesce((public.resolve_brand_playback_window(c.brand_id)->>'should_play')::boolean, true),
         public._is_monitoring_exempt(c.user_id),
         case when bps.last_audio_progress_at is null then null
              else extract(epoch from (now() - bps.last_audio_progress_at))::integer end,
         bps.last_audio_progress_at,
         case when bps.shell_last_seen_at is null then null
              else extract(epoch from (now() - bps.shell_last_seen_at))::integer end
    from canonical c
    left join public.brand_player_sessions bps on bps.id = c.session_id
$function$;
