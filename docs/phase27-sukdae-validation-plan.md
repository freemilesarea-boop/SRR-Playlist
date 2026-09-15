# 숙대 실기기 One-Click 복구 검증 계획 (Phase 27)

> **실행하지 않았습니다.** 이 문서는 계획이고, 실행은 형님의 별도 승인 뒤입니다.
> 화정점은 전 과정에서 무접촉입니다.

## 전제 — 이 순서가 먼저다

1. PR #580 (Phase 25) 리뷰·merge
2. Phase 27 stacked PR 리뷰·merge
3. CI 통과
4. Preview 배포에서 A·B·C·E 예행
5. **마이그레이션 순서 고정: 0527 → 0528** (0528 이 0527 의 `_brand_player_liveness` 위에 올라간다)
6. Production merge + migration apply
7. 숙대 태블릿이 새 빌드를 받을 때까지 대기 — Zero-Touch 이므로 배포 감지 60초 +
   stagger 309초 + 다음 트랙 경계. 강제 reload 하지 않는다.
8. 아래 A~E 실행

새 빌드를 받기 전에는 셸 제어면도 `brand_player_shell_poll` 도 기기에 없다.
**받기 전 검증 결과는 이번 변경의 검증이 아니다.**

## 검증 항목

### A. 정상 상태 One-Click

- 전제: 태블릿이 정상 재생 중(`player heartbeat < 60s`).
- 동작: 관리자 화면에서 감시 대상 행의 `[매장 긴급 복구]` 1회.
- 기대: `hard_recovery` 발행 → 문서 유지 → 오디오만 재시작.
- 측정: click → command 행 생성 → `received_at` → 첫 `currentTime` 진행 2회 관측.
- **매장이 영업 중이면 실행하지 않는다.** 소리가 한 번 끊긴다.
  영업 종료 후 또는 점주 동의 후에만.

### B. Player subtree failure injection

- 실기기에서 안전하게 플레이어 계층만 죽이는 수단이 **현재 없다.**
  `__brandPlayerDebug` 는 읽기 전용 덤프이고 주입 훅이 아니다.
- 따라서 B 는 **Preview + 개발자 도구**에서만 수행하고, 실기기에서는 생략한다.
  실기기에 주입 코드를 넣는 것은 이번 Phase 범위 밖이다(기능 확장 금지).
- 대안: 다음 자연 발생 시 C 로 검증한다. 그때를 위해 전역 예외 기록이 붙어 있다.

### C. shell-alive / player-dead 복구  ★ 이번 Phase 의 본 검증

- 전제: 플레이어 heartbeat 가 180초 넘게 끊기고 셸은 살아 있는 상태.
  **인위적으로 만들지 않는다.** 자연 발생(2026-09-15 같은 상황)을 기다린다.
- 감지: `brand_player_sessions.shell_last_seen_at` 이 싱싱한데 `last_seen_at` 이 낡음.
- 동작: `[매장 긴급 복구]` 1회 → `reload` 발행.
- 기대: 셸 제어면이 Realtime(≤1s) 또는 저하 폴링(≤5s)으로 수신 → 문서 재시작 →
  재생 재개 → 실제 진행 2회 관측.
- 실패 시: 명령이 `pending` 으로 TTL 만료되는지 확인하고 **그 사실을 그대로 기록**한다.
  실패를 성공으로 쓰지 않는다.

### D. 다른 기기 세션이 온라인인 상태

- 전제: Windows 세션이 살아 있고 태블릿이 죽어 있는 상태(2026-09-15 재현).
- 기대 1: incident 가 **닫히지 않는다**(0528 canonical pinning).
- 기대 2: 관리자 화면에서 Windows 행에는 긴급 복구 버튼이 뜨지 않고
  "감시 대상 매장 재생기가 아닙니다" 로 표시된다.
- 기대 3: 자리 잡은 install 이 둘이면 **양쪽 다 버튼이 없고** "식별 불가" 로 표시된다.

### E. 실제 진행 검증

- 성공 판정은 오직: 대상 session_id + 플레이어 heartbeat 신선 + `currentTime` 진행
  **2회 이상 연속 관측**.
- 확인 쿼리(읽기 전용):
  ```sql
  select to_char(last_seen_at at time zone 'Asia/Seoul','HH24:MI:SS') as hb,
         to_char(last_audio_progress_at at time zone 'Asia/Seoul','HH24:MI:SS') as progress,
         extract(epoch from (now()-last_audio_progress_at))::int as progress_age
    from public.brand_player_sessions
   where id = '823034d7-7419-4ea5-92b5-7aa6ac49824c';
  ```
  그리고 `stream_sessions_v2` 에서 새 트랙이 `heartbeat_count >= 2` 로 쌓이는지.
- **command issued / received / page loaded / heartbeat only / 다른 기기 heartbeat 는
  성공이 아니다.**

## 60초 SLA 실측 방법

각 구간의 **wall-clock** 을 기록한다(추정치를 쓰지 않는다):

| 구간 | 측정 출처 |
|---|---|
| click → command 행 | `brand_player_commands.issued_at` |
| command → 수신 | `received_at` − `issued_at`, `delivery_source` 함께 |
| 수신 → 플레이어 부팅 | `store_playback_diagnostics.session_start` |
| 부팅 → 첫 진행 | `brand_player_sessions.last_audio_progress_at` |
| **합계** | click 시각 − 첫 진행 시각 |

목표 `CLICK → VERIFIED AUDIO ≤ 60s`. 표본이 1~2회뿐이면 P50/P95 를 계산하지 않고
**관측값 그대로** 적는다.

## 중단 조건

- 매장 영업 중 소리가 끊기면 즉시 중단하고 원인을 기록한다.
- 명령이 2회 연속 배달 실패하면 중단한다 — 반복 발행으로 TTL 쓰레기를 만들지 않는다.
- 점주에게 추가 조작을 요청하지 않는다.

## 이 계획이 증명하지 못하는 것

- 플레이어 계층이 **왜** 멈췄는지. 이 변경은 복구와 관측이지 원인 수정이 아니다.
- 브라우저 프로세스가 실제로 죽은 경우. 그 경우 웹 복구는 불가능하고,
  현재 네이티브 브랜치에도 독립 서버 수신 능력이 없다.
