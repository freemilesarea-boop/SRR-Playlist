# 브랜드 플레이어 24시간 무인 운영 (2026-09)

## 1. 끊김의 원인 — "한 번 멈추면 다시 못 켜지는 구조"

`Player.tsx` 의 `onError` 가 아래 상황에서 `pause()` 를 부르고 `store.playing=false` 가 됐다.

| 트리거 |
|---|
| 네트워크 오류(code=2)가 **같은 곡에서 누적 3회** → 재시도 소진 |
| autoplay 차단(`NotAllowedError`) |
| `play()` 재시도 최종 실패 |

그런데 `playing=false` 가 되는 순간 자동 복구가 전부 죽는다.

1. **Health monitor** — `active-stalled` / `neither-playing` 등 모든 감지 조건이 `state.playing === true` 를 요구 → 감지 자체가 안 됨
2. **Recovery Manager** — `shouldAttemptPlay()` 가 `store.playing` 을 보고 차단
3. **Wake Lock** — `useWakeLock(playing)` → 화면 절전 해제 → 모니터/PC 가 잠들어 물리적으로도 복구 불가
4. **`online` 이벤트** — `loadConfig({requeueIfEmpty:true})` 만 호출, `play()` 는 안 부름

→ 사람이 ▶ 를 누를 때까지 영구 정지. 무인 매장에서는 아무도 안 누른다.

### 프로덕션 증거 (카공시대)

| 세션 | 경과 | current_track_id |
|---|---|---|
| `1177a528` (Windows Edge) | **1일 23시간** | 128초짜리 곡에 2일째 고정, heartbeat 는 60초마다 정상 전송 |
| `5780745e` (Mac Chrome) | 3시간 49분 | 같은 곡 고정 |
| `932ba9fe` (Windows Edge) | 3시간 36분 | 정상 진행 |
| `7d2c81fe` (Windows Edge) | 11분 후 종료 | 25초 뒤 새 세션 생성 = 점주가 새로고침한 흔적 |

**배제한 원인**: 음원 파일 손상(55곡 전부 정상, 191~320kbps) / 서명 URL 만료(전곡 public) /
서버측 정지 스케줄(0건) / 세션 만료(없음) / `next()` 로직 버그(없음).

### 추가 결함 2개

- `networkRetriedRef` 가 **정상 재생으로는 초기화되지 않았다.** 수동 ▶ 클릭에서만 삭제.
  24시간 매장은 같은 곡을 하루 9~10회 도는데, 한 곡이 며칠에 걸쳐 순간 끊김 3회를
  누적하면 그 뒤로는 **첫 blip 에 즉시 영구 정지**.
- 매장 자동 스킵 안전망이 `isPermanent`(DECODE/SRC_NOT_SUPPORTED)만 덮었다.
  매장에서 가장 흔한 실패인 **Wi-Fi 순간 끊김(code=2)에는 무인 복구가 없었다.**

## 2. 수정 (BRAND-PLAYER-UNATTENDED-RECOVERY-1)

| 변경 | 파일 |
|---|---|
| 매장모드에서 오류 시 `pause()` 하지 않고 **다음 곡으로 넘긴다**. `playing=true` 를 유지해 health monitor / Recovery Manager / wake lock 을 살려둔다 | `Player.tsx` `onError` |
| 자동 스킵 대상에 **네트워크 재시도 소진**을 포함 | `unattendedRecovery.ts` `shouldAutoSkipUnattended` |
| 연속 자동 스킵 5회부터 3초 → **30초 백오프** (전면 장애 시 큐 무한 순회 방지) | `unattendedRecovery.ts` `autoSkipDelayMs` |
| `playing` 이벤트(실제 소리 남)에서 **네트워크 재시도 예산 + streak 리셋** | `Player.tsx` engine event listener |
| wake lock 을 `playing` → `playing \|\| businessMode` 로 (정지 중에도 화면 유지) | `App.tsx` |

판정 로직은 `src/lib/unattendedRecovery.ts` 로 분리해 단위 테스트를 붙였다.

일반 사용자 동작은 그대로다 — `businessMode`가 아니면 기존처럼 정지 + 에러 표시.

## 3. 어뷰징 정책 면제 (0503)

어뷰징 정책(0275/0086)은 "같은 계정이 같은 곡을 하루 3회 넘게 재생 = 어뷰징" 이라는
**개인 청취 기준**이다. 24시간 매장은 같은 곡을 하루 9~10회 도는 게 정상 운영이라
그대로 두면 재생의 70%가 제외되고 매장이 어뷰저로 잡힌다.
(실측: 최근 7일 milestone_30s 5,077건 중 **3,768건(74%)**이 캡에 걸림)

**결정: 브랜드 플레이어 재생은 어뷰징 정책에서 면제하고, 재생 수를 그대로 차트·정산에 반영한다.**
매장에 특화된 음악을 만드는 아티스트가 차트에 오르는 구조를 의도한 것.

> ⚠ 의도된 영향: 24시간 매장 1곳이 하루 약 550 유효 스트림을 만든다. 현재 서비스 전체
> 유효 스트림이 주당 1,309건이므로, 매장이 늘어날수록 차트·정산 분배가 매장 재생
> 중심으로 재편된다.

### 면제 판정은 서버가 검증한다

`source_page` 는 클라이언트가 보내는 값이라 그것만으로 면제하면 누구나
`/brand/player/x` 를 위조해 무제한 적립할 수 있다. `_is_brand_player_stream()` 이
**살아 있는 `brand_player_sessions` 행**(미폐기 · 미만료 · 15분 내 heartbeat)까지 확인한다.

### 면제하는 것 / 안 하는 것

| 가드 | 브랜드 플레이어 |
|---|---|
| `daily_user_track_cap` (하루 3회) | **면제** |
| `low_player_volume` (<0.1) | **면제** — 매장 배경음악은 낮은 볼륨이 정상 |
| `muted_play` (볼륨 0/음소거) | 유지 — 무음은 어떤 기준으로도 청취가 아니다 |
| `self_play` | 유지 — 아티스트가 자기 곡을 매장에서 돌려 정산받는 것 차단 |
| `dedup_30s_window` | 유지 — 30초 내 중복 적립 방지, 매장 운영과 무관 |
| bot UA / `too_short` / `unreleased` / `admin_preview` / `artist_preview` | 유지 |

`admin_list_abuse_candidates` 에서도 브랜드 플레이어 재생을 제외해, 정상 운영 매장이
어뷰저 목록을 채우지 않게 했다.

차트/정산 RPC 본문은 건드리지 않았다 — 전부 `is_effective=true` 를 보므로 트리거만
바꾸면 자동 반영된다.

## 4. 카공시대 재생 곡 수 (55곡 → 128곡)

| | 전 | 후 |
|---|---|---|
| 곡 수 | 55 | **128** |
| 분량 | 2시간 32분 | **5시간 32분** |
| 아티스트 | — | 26팀 |

두 가지를 바꿨다.

1. **브랜드 정책** (`brand_music_policies`, 카공시대만)
   - `allowed_genres`: `['lofi']` → `['lofi','ambient','jazz']`
   - `energy_max`: `0.2` → `0.5`
     · 실측상 **에너지 값이 있는 곡 중 0.2 이하는 단 한 곡도 없었다.** 기존 55곡은
       "오디오 분석이 안 된 곡"만 통과한 결과였지 정책 의도가 아니었다.
   - `blocked_moods`: 7개 → 2개 (스터디카페 하드필터가 이미 대부분 차단 — 이중 필터로
     곡이 사라지는 것 방지)
   - `vocal_policy='instrumental_only'` 유지 (가사 없는 곡)
2. **아티스트당 곡수 상한 4 → 12** (`_brand_generate_playlist`, 0503)
   · 스터디카페 하드필터(0463)를 통과하는 곡이 170곡/26팀인데 상한 4 때문에 74곡만 나왔다.

> 스터디카페 브랜드는 `_study_cafe_track_eligible`(0463) 하드필터가 **lofi / ambient / jazz
> 계열 + 보컬 없음 + 매우 차분함**만 통과시킨다(fallback 없음). 브랜드 정책으로 더 넓힐 수 없다.
> 곡을 더 늘리려면 해당 조건을 만족하는 음원을 추가해야 한다.

## 5. 관측 공백 (미해결)

`playback_events_v2` 에 최근 14일간 `player_error` **0건**, `play_start` 60건뿐이다
(활성 구독 63건). 브랜드 플레이어에서 재생 이벤트가 사실상 안 올라와, 이런 장애가 나도
DB만 봐서는 알 수 없다. 별도 확인 필요.
