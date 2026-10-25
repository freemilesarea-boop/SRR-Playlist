# 매장 플레이어 감시 루틴 — 판정 독트린 · 사고 기록

예약 작업(scheduled task) 2개가 이 문서의 판정 모델을 따른다.

| 루틴 | cron | 역할 |
|---|---|---|
| 매장 감시 (`trig_019SwELvgXtre3VfXrTWhHPi`) | `38 */4 * * *` | 조용한 감시. 세 경우에만 보고 |
| 매장 정기 점검 (`trig_015SBmSN8dCqvB41d25gv6Y5`) | `1 0,12 * * *` | 09:00 / 21:00 KST 정기 보고 |

두 루틴의 프롬프트는 **하드 룰 + 쿼리 + 출력 규칙만** 담는다. 역사·배경·사고 기록은
이 문서가 보관한다. 프롬프트 본문은 발사마다 알림 큐에 그대로 쌓이므로, 길면
그 자체가 비용이 된다 (2026-10 백로그 사고 — 아래 참조).

---

## 1. 판정 모델 (RC-30.2) — DEVICE HEALTH ≠ STORE SERVICE HEALTH

기기가 살아 있는가와 매장에 소리가 나는가는 **다른 질문**이다. 섞으면 둘 다 틀린다.

### install 단위 상태 — `brand_player_sessions` 기준 (문턱 300초)

1. `progress_age < 300` → **playing**
   단, 반증 조건(§2 교훈 A)에 걸리면 `stalled_progress` 로 내린다.
2. `progress_age is null` AND `hb_age < 300` → **unproven**
3. 그 외 → **silent**

### 매장 실제 재생 여부 — `continue_listening` 이 최종 판단

`cl_age = now() - continue_listening.updated_at`

| 상태 | 조건 | 의미 |
|---|---|---|
| **A** | 행 존재 + `cl_age < 300` | 최근 재생 증거 있음 |
| **B** | 행 존재 + `cl_age >= 300` | stale = 매장 재생 증거 없음 |
| **C** | **행 자체가 없음** (`cl_age` NULL) | **UNKNOWN / SAMPLE_MISSING** |

A 는 70초 이상 간격의 2차 표본으로 `position_sec` 증가 또는 `track_id` 변경을
확인해야 "매장 재생 확인"이 된다. 두 표본이 완전히 동일하면 일시정지 의심 → UNKNOWN.

**C 를 B 와 같게 취급하는 것을 절대 금지한다.** 행 부재는 장애 증거가 아니라
**관측 불확실성**이다. 쓰기 경로가 곡 경계에서 행을 delete+insert 하는 사이에
조회가 행을 순간적으로 놓친다 — 2026-10-02 · 10-05 분당미금역점에서 두 번
실제로 관측됐고, 두 번 다 재조회에서 행이 멀쩡히 돌아왔다.

C 를 만나면 70초 뒤 재표본하고, 2차에도 없으면 `user_id` 로 직접 확인한다:

```sql
select count(*) as cl_rows,
       extract(epoch from (now()-updated_at))::int as cl_age
  from public.continue_listening where user_id = '<store_id>'::uuid;
```

그래도 없으면 SAMPLE_MISSING 지속으로 적고, **독립적인 다른 증거 없이는 장애로 쓰지 않는다.**

### 매장 판정

- brand 세션 중 playing 이 하나라도 있다 → **STORE PLAYING**
- 또는 매장 재생 확인 → **STORE PLAYING** (감시선 결함은 따로 적는다)
- 둘 다 아니고 unproven / stalled_progress 만 → **UNKNOWN**
- brand 세션 전부 silent 또는 stalled_progress **그리고** 매장 재생 증거 없음 → **STORE OUTAGE**

"매장 재생 증거 없음"은 **B, 또는 행은 싱싱한데 position·track 이 70초 간격 두 표본에서
완전히 동일한 경우**다. **C 는 포함되지 않는다.** UNKNOWN 이 하나라도 섞이면 FAIL CLOSED.

### 쓰지 말아야 할 신호

- heartbeat 만으로 "재생 중" 판정 금지.
- `audio_ready_state = 4` 는 소리의 증거가 아니다 — 2026-10-05 화정점이 ars=4 인 채 38분 정지.
- brand 세션 사망만으로 무음 판정 금지 (§2 교훈 2026-09-29).
- `verified_seconds` 를 "검증된 재생"으로 쓰지 않는다 — heartbeat 벽시계 누적이다.
- `business_mode` 로 매장/개인을 가르지 않는다 — 정상 재생 중인 매장이 false 이고
  정지한 매장이 true 인 사례가 있다.
- mobile/desktop·UA 를 감시 신원으로 쓰지 않는다. install 수명(24시간)으로 가른다.
  (장애 조사에서 환경 특성 파악용 UA 읽기는 허용)

### 복구 대상 지정

**ALERT CLASSIFICATION = store 단위 / RECOVERY TARGETING = install·session 단위.**
`continue_listening` 은 store 단위 신호이므로 **복구 대상 지정에 절대 쓰지 않는다.**
매장이 다른 세션에서 살아 있다고 해서 죽은 기기의 incident 를 그 세션으로 resolve
하지 않고, 복구 명령을 그 세션으로 보내지 않는다.

감시 대상 install 고르기:
- 열린 incident 가 있으면 → `incident.session_id`
- 없으면 → `age_h >= 24` 인 세션이 **정확히 하나**일 때 그것
- 2개 이상 → 식별 불가, 고르지 않는다 (FAIL CLOSED)
- 0개인데 재생 중 → C-2 (감시선 결함) 로 보고

---

## 2. 사고 기록 — 각 규칙이 왜 생겼는가

### 2026-09-15 FALSE RECOVERY
incident 가 잘못 닫히고 점주가 직접 복구했다. 마이그레이션 0528 이 incident device
pinning 을 추가해 막았다. 14:05 숙대: 플레이어 계층만 정지, 셸은 14:32:54 까지 200 OK.
→ `shell_age` 가 싱싱한데 `hb_age` 가 낡았다 = **플레이어만 죽었다.**

### 2026-09-15 12:17 숙대 AUDIO_PIPELINE_FROZEN
27분 / 26곡을 무음으로 흘려보냈다. **heartbeat 는 그 내내 정상이었다.**

### 2026-09-29 brand 세션 사망 ≠ 무음 (거짓 [긴급])
숙대 brand 세션 `53489270` 이 11:32 이후 14시간 죽어 있었다. STORE OUTAGE 로 판정하고
[긴급] 푸시를 보냈다. **틀렸다.** 그 시간 내내 브랜드 플레이리스트 곡이 정상 재생
중이었다(`continue_listening` 실시간 전진).
→ brand 세션 사망 = **감시선 끊김**이지 무음이 아니다.

### 매장 목록의 기준
분당미금역점(2026-09-28 합류)은 `brand_player_sessions` 이력이 0건인데 재생 중이었다.
세션 없는 매장을 조용히 건너뛰면 매장 하나가 통째로 안 보인다.
→ **매장 목록의 기준은 `franchise_stores` 다. `brand_player_sessions` 가 아니다.**

### 2026-10-05 교훈 A — `progress_age` 거짓 양성
화정점 16:50:44 ~ 16:58:46 **8분간**:
- `continue_listening.position_sec = 15 / 162` **고정** (실제로 소리가 안 났다)
- `brand_player_sessions.last_audio_progress_at` 은 **계속 전진**

→ **반증 조건**: `progress_age < 300` 인데 그 매장 `continue_listening` 의
`position_sec` · `track_id` 가 **70초 이상 간격 두 표본에서 완전히 동일**하면
playing 으로 세지 않는다. `stalled_progress` 로 분류하고 매장 판정은
`continue_listening` 에만 맡긴다.

고아 행 주의: 숙대 `b356da81` 이 2시간 22분 / heartbeat 153회를 찍는 동안 실제 재생은
다른 곡들로 정상 진행 중이었다.

### 2026-10-05 교훈 B — heartbeat 간격이 정지의 선행 지표
stream heartbeat 는 `window.setInterval(10000)` — **메인 스레드 타이머이고 오디오와
무관하다.** 그래서 간격이 길어지는 것은 "브라우저가 타이머를 조였다"는 뜻밖에 안 되고,
**오디오 정지가 타이머를 늦출 수는 없다** — 인과 방향이 한쪽으로만 성립한다.

3일 실측 (세 매장 3,790 트랙):

| heartbeat 간격 | 물린 트랙 |
|---|---|
| ≤ 12초 | 1.9% (대부분 310~350초 장척 곡, 진짜 정지 아님) |
| 20~40초 | **2/2 = 100%** |
| > 40초 | **8/8 = 100%** |

화정 2026-10-05: 정상 10.3초 → `374a5c94` 구간 33.6초 → `39497734` 구간 **43.8초(4.4배)**.

`stream_sessions_v2` 는 세션당 1행이고 heartbeat 이력을 남기지 않는다. 간격은
`(last_heartbeat_at - created_at) / (heartbeat_count - 1)` 로 구한다.

### 2026-10-05 교훈 C — 워치독은 스로틀링을 받지 않는다
자가 복구 사다리 tick 은 `src/lib/backgroundTicker.ts` 의 **Web Worker** 로 3초마다
돈다. 메인 스레드 타이머 스로틀링을 피하기 위해 일부러 그렇게 만든 장치다(숙대점
2026-09-10).
→ **사다리가 안 올랐다는 것은 "워치독이 잠들었다"가 아니라 "게이트 하나가 참이었다"**
는 뜻이다. 어느 게이트인지는 `gate_blocked` 진단의 `gate` 필드가 답한다.

### 2026-10-05 "83회 취소" 사고
승인 요청이 1시간 방치되고 다음 발사가 그 대기를 닫아버렸다.
→ `execute_sql` 을 **턴의 첫 호출**로 낸다. `ReadNotifications` 와 한 블록에 묶지 않는다.
→ 취소 오류가 오면 **그 턴 안에서 즉시 재발행**한다.
→ 쿼리가 끝내 실행되지 않으면 "No response requested." 로 닫지 말고 감시 불능을
  한 줄 보고한다(하루 1회 집계). **사후 쿼리로 "그때 이상 없었다"고 쓰지 않는다.**
→ 재표본 간격을 `pg_sleep` 으로 만들지 않는다 — MCP 도구가 60초에서 타임아웃된다.
  표본 A·B 를 **별개 호출**로 내고 간격을 실측해 70초 이상을 확인한다.

### 2026-10 알림 백로그 사고 — 이 문서가 생긴 이유
예약 작업이 지속 세션(persistent session)으로 발사되는데 그 세션이 알림을 소비하지
않는 동안 발사가 큐에 쌓였다. 10-14 20:38 UTC ~ 10-17 00:01 UTC 사이 57건이 누적됐고,
드레인에 약 3M 토큰이 들었다. 57건 전부가 **같은 프롬프트 본문의 바이트 동일 복사본**
이었고 새 정보는 0이었다.

원인은 발사 빈도만이 아니라 **알림 1건당 페이로드 크기**였다 — 프롬프트 본문이
그대로 큐에 적재된다.

조치:
1. cron 완화 — 감시 매시간 → `38 */4 * * *`, 보고 → `1 0,12 * * *` (합계 8회/일)
2. 긴 역사·배경을 **이 문서로 이관**하고 프롬프트는 하드 룰·쿼리·출력 규칙만 유지
3. 루틴 자체에 **백로그 흡수 규칙** 추가 — 같은 루틴의 미처리 알림이 큐에 여러 건
   쌓여 있으면 **가장 최근 1건만 처리하고 나머지는 읽어서 버린다.** 과거 시점의
   상태를 지금 보고하는 것은 소음이며, 사후 쿼리로 그때를 재구성해 보고하지 않는다.

---

## 3. 매장 맥락

카공시대 (franchise `f5d17859`, brand `682c08e1-55b7-4324-8572-39afabfe6519`) 매장 3곳:

| 매장 | store_id | 비고 |
|---|---|---|
| 화정점 | `3caef236-d025-4141-8c96-3eb5067a53e0` | 2026-08-31. 장기 control 이었으나 10-05 이후 정지 반복 |
| 숙대점 | `1311d900-c451-4b9b-8ced-27f164bdc337` | 2026-09-06. `823034d7` = 태블릿 |
| 분당미금역점 | `5b5f2e59-…` | 2026-09-28 합류. brand 세션 이력 0건(C-2, 보고 완료) |

- `ai@swk.today` 는 테스트 계정 — 보고에서 제외한다.
- 데모 계정(데모 매장 1·2)은 공용 테스트 계정 — **실제 매장 이름 추측 금지.**
- 감시 제외는 `brand_player_monitoring_exempt` 로 관리한다.

### 감지 파이프라인
감지는 pg_cron `srr-brand-player-health`(1분)가 **단독으로** 한다. 전달은
`srr-dispatch-notifications`(1분). 둘 다 `* * * * *` 이고 **각각 정확히 1행**이어야 한다.

기준: ONLINE <180초 · SUSPECTED_DOWN ≥180초(Slack 없음) · DOWN ≥300초(Slack 1회)
· heartbeat 복귀 + 연속 2회 정상 → RECOVERED.
`detection`: `silence` · `stalled` · `frozen`(0527).

**suspected 단계가 Slack 을 보내지 않는 것은 정상이다.** 누락으로 쓰지 않는다.
TTL 지난 명령이 `status='pending'` 으로 남는 것은 알려진 P2 — 장애로 쓰지 않는다.

### 빌드 신원
기대 buildHash 는 **하드코딩하지 않는다.** 매번 직접 읽는 값이 정답이다:

```bash
git fetch origin claude/playlist-mvp-development-2JmTJ -q &&
git rev-parse origin/claude/playlist-mvp-development-2JmTJ | cut -c1-12
```

```sql
select store_label, seconds_since_heartbeat as hb, page_build_hash, sw_build_hash,
       sw_controlled, navigation_type, freshness, page_sw_mismatch
  from public.brand_player_build_identity('<위에서 읽은 12자>', 4320)
 order by seconds_since_heartbeat;
```

`freshness` 컬럼을 그대로 쓴다: CURRENT / STALE / UNKNOWN(`page_build_hash` null).
**UNKNOWN 을 CURRENT 로 쓰지 않는다.** page↔SW 매트릭스는 둘 다 값이 있을 때만 쓴다.
`page_sw_mismatch = true` 는 **관측 이벤트일 뿐**이며 장애가 아니다.

### 자가 복구 사다리 게이트 (PR #594 계측)
`gate_blocked` 진단의 `gate` 값이 사다리를 막은 이유다:

| gate | 의미 |
|---|---|
| `autoplay_blocked` | 자동재생 차단. **코드로 복구 불가 — 사람이 화면을 눌러야 한다** |
| `ended` | 엘리먼트가 "정상 종료"라고 보고해 워치독이 손을 뗐다 |
| `crossfading` | 크로스페이드 진행 중 |
| `not_playing` | **재생 의도(`store.playing`)가 꺼졌다** |
| `suppressed` | 본사 스케줄 억제 |
| `subscription_blocked` / `hard_reset_verify` / `below_threshold` / `open` | — |

`gate_blocked` 가 0건인데 매장이 정지 중이면 그 매장이 아직 새 빌드를 못 받았을 수
있다 — `page_build` 를 확인하고 구 빌드면 "계측 미수신"으로 적는다.

---

## 4. 금지 표현

- Hard/Remote Recovery 동작만으로 "장애 해결" · "ROOT CAUSE PROVEN" 금지.
- incident RECOVERED 나 복구 Slack 을 **매장 재생기 복구의 증거로 쓰지 않는다.**
- `delivery_source = heartbeat` 는 실패가 아니다(폴링 fallback). 최대 60초 지연됐다는
  뜻으로만 적는다.
- `result_code = REMOTE_RELOAD_AUTOPLAY_BLOCKED` 는 점주 터치가 필요한 상태 — 성공이 아니다.
- `OFFLINE_RELOAD_SUPPRESSED` / `NETWORK_RECONNECT_RESET` 은 설계된 정상 동작 — 장애가 아니다.
- `page_frozen` / `page_hidden` 은 브라우저가 정상적으로 탭을 정리한 기록이다.
- 실기기 검증을 코드 테스트 결과로 대체해 쓰지 않는다.
- **웹 기술로 해결 불가능한 것을 코드로 해결 가능하다고 보고하지 않는다.**
  자동재생 차단(`NotAllowedError`)은 코드로 뚫을 수 없다. 메인 스레드 타이머
  스로틀링도 메인 스레드에서는 못 막는다.
- 다른 기기 세션의 progress 를 특정 태블릿 복구의 증거로 쓰지 않는다.

---

## 5. 절대 조건 (두 루틴 공통)

- **READ ONLY.** 원격 복구 명령(`request_store_recovery` /
  `admin_enqueue_brand_player_command`) 자동 실행 금지 — 명시적 지시가 있을 때만.
- **`detect_brand_player_incidents()` 를 절대 부르지 않는다.** incident 행·세션 행에
  쓰지 않는다. 세션을 revoke 하지 않는다.
- 강제 refresh 금지 · SW 강제 업데이트 금지 · cache clear 금지 · SW unregister 금지.
- 스키마·함수를 임의 SQL 로 고치지 않는다. 이상하면 STOP 후 보고.
- 카드 청구(`rebillPay`)는 절대 실행하지 않는다 — 감지·보고까지만.
- 점주에게 새로고침을 요청하지 않는다. 자연 갱신을 기다린다.
- **사용자가 이 대화에 사람으로서 응답 중이면 push 를 보내지 않는다** — 중복 소음이다.
  대화 보고로 대체하고 보낼지 묻는다.
- **이미 보고한 건을 매번 다시 적지 않는다.** 상태가 바뀠을 때만 적는다.
