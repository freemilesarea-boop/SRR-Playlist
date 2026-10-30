# 매장 플레이어 감시 루틴 — 판정 독트린 · 사고 기록

예약 작업(scheduled task) 2개가 이 문서의 판정 모델을 따른다.

| 루틴 | cron | 상태 | 역할 |
|---|---|---|---|
| 매장 점검 보고 (`trig_015SBmSN8dCqvB41d25gv6Y5`) | `CRON_TZ=Asia/Seoul 47 9,21 * * *` | **활성** | 하루 2회. 문제 유무 + **책임 구분** 보고 |
| 매장 감시 (`trig_019SwELvgXtre3VfXrTWhHPi`) | `38 */4 * * *` | **중단** (2026-10-29) | 하루 6회 조용한 감시 — 점검으로 통합 |

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

### 2026-10-26 09:00 KST 정기 보고 누락 — 침묵으로 닫은 턴
정기 점검 루틴이 00:02 UTC 에 발사됐는데, 세션이 알림만 읽고 쿼리 없이
"No response requested." 로 턴을 닫았다. 보고도 푸시도 나가지 않았다.

원인은 두 루틴의 출력 규칙이 **정반대**인데 프롬프트에 그 대비가 없었던 것이다 —
"매장 감시"는 세 경우가 아니면 완전 침묵이고, "정기 점검"은 결과와 무관하게
반드시 보고 + 푸시 1회다. 맥락이 압축된 뒤에는 침묵 쪽 규칙이 더 강하게 남는다.

조치: 정기 점검 프롬프트 맨 앞에 **침묵 금지** 블록을 넣었다 — 발사됐으면
(a) 쿼리 실행 (b) 대화 본문 보고 (c) 푸시 1회를 **반드시 셋 다** 하고,
셋 없이 턴을 닫는 것은 이 루틴의 실패라고 명시한다. 쿼리가 끝내 실행되지
않더라도 감시 불능을 한 줄 보고하고 푸시까지 보낸다. 백로그 흡수 규칙을
"전부 버리고 침묵" 근거로 쓰지 못하도록 단서도 달았다.

### 2026-10-26 3표본 규칙 — 2표본 고정은 장애가 아니다
분당미금역점이 07:56:39 / 07:58:52 두 표본에서 `position_sec=5` · track `5c162f07`
**완전 동일**이었다. 2표본 고정은 "매장 재생 증거 없음" 조건에 해당한다.
그런데 08:15:25 3차 표본에서 track 이 `615d3e5f` 로 교체되고 position 96 /
cl_age 5 로 멀쩡히 전진 중이었다. 곡 경계 write gap 이 두 표본에 걸친 것이다.

→ **position·track 2표본 고정만으로 장애로 쓰지 않는다. 3차 표본으로 확인한다.**
그 매장의 brand 세션은 `progress_age` null / `hb_age` 37 로 unproven 이었으므로
판정은 UNKNOWN(FAIL CLOSED)이었고, OUTAGE 로 올리지 않은 것이 옳았다.

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

### 2026-10-29 점검 주기 축소 — 하루 2회 · 책임 구분 필수

사용자 지시: *"체크를 너무 자주 하는 거 같다. 오전 10시 오후 10시 딱 두 번만 체크를
진행할 것. 해당 체크를 진행할 때는 문제가 있는지, 그 문제가 우리 쪽 문제인지 업체 쪽
문제인지를 확인해서 보고할 것."*

조치:

1. **매장 감시 루틴 중단** — 하루 6회(`38 */4`) 발사를 껐다. 삭제하지 않고 `enabled=false`
   로 두었으므로 되살릴 수 있다.
2. **점검 루틴을 하루 2회로** — `CRON_TZ=Asia/Seoul 47 9,21 * * *` → **09:47 / 21:47 KST**
   발사. 정시가 아니라 13분 앞인 이유는 두 가지다: 정각은 서버 혼잡으로 지연되기 쉽고,
   점검 자체가 70초 이상 간격의 재표본을 포함해 2~5분 걸린다. **보고가 10시·22시에 손에
   들어오도록** 앞당겨 발사한다.
3. **1분 반복 알림(send_later 체인) 금지** — 실제 무음이어도 푸시 1회 + 대화 보고까지다.
   하루 2회 지시와 충돌한다.

#### 책임 구분 — 세 갈래로만 분류한다

| 구분 | 뜻 | 예 |
|---|---|---|
| **우리 쪽** | 코드·인프라·운영으로 우리가 고칠 수 있다 | pg_cron 실행 실패·중복 / `admin_notifications` 미발송 / 플레이리스트 생성 실패 / incident 오탐·미감지 / `freshness=STALE` / 계측 컬럼 누락 / 스키마·함수 오류 / **USER 군 1분 감지 부재** |
| **업체 쪽** | 점주·매장 환경. 코드로 못 고친다 | `paused=true`·`playing=false`(사람이 멈췄다) / gate=`autoplay_blocked`(사람이 눌러야 한다) / 기기 전원·탭 닫힘·heartbeat 중단 / 네트워크 / 볼륨·스피커 / 연체 |
| **판정 불가** | 양쪽 다 가능하거나 증거 부족 | UNKNOWN·SAMPLE_MISSING 혼재 / 3표본 미완 / 곡 경계 write gap 의심 |

- 업체 쪽이면 **점주가 할 일**을 한 줄로 적는다(화면 터치 / 새로고침 / 전원).
- 우리 쪽이면 **고칠 것**을 한 줄로 적는다. 루틴은 READ ONLY 이므로 보고까지만.
- **증거 없이 업체 쪽이라고 쓰지 않는다** — 책임 전가가 가장 비싼 오판이다.
- 판정 불가는 단정하지 않고 "다음 회차 재확인"으로 남긴다.

#### 이 변경이 만드는 공백

- **카공시대(BRAND 3곳)** 은 pg_cron `srr-brand-player-health`(1분)가 계속 감지하고
  Slack 도 나간다. 점검 주기와 무관하게 실제 장애는 자동으로 알려진다.
- **뺑스톡(USER 2곳)** 은 그 크론이 보지 않는다. 매장 감시까지 꺼졌으므로 이제
  **12시간 간격 점검이 유일한 감시선**이다. 최악의 경우 무음을 12시간 뒤에 안다.
  10-28 마포점 37분 무음이 그 공백의 실제 사례였다(그때는 4시간 주기였고, 확인을
  마쳤을 때 이미 스스로 복귀해 있었다).
- 이 공백은 **우리 쪽 문제**로 분류하고 매 회차 한 줄로 적는다. 메우려면
  `srr-brand-player-health` 가 `player_type='USER'` 매장도 보도록 고쳐야 하는데
  스키마·함수 변경이라 루틴의 금지 조건에 걸린다 — 별도 작업이 필요하다.

---

### 감시 범위 — 2026-10-30 기준 매장 7곳 (아래 "EROOMING 감시 대상 승격" 이 최신 정의다)

매장 목록은 `franchise_stores` 에서 **두 franchise_id** 로 뽑는다(`monitoring_exempt` 제외).

| 군 | franchise_id | 가맹 | 매장 |
|---|---|---|---|
| **BRAND** | `f5d17859-5709-41ba-908e-8c2672cc8089` | 카공시대 | 화정점 `3caef236` · 숙대점 `1311d900` · 분당미금역점 `5b5f2e59` |
| **USER** | `85ef70ae-6099-4072-bce7-1a0b0487aa40` | 주식회사 뺑스톡 | 마포점 `fcb14222` · 성수 `6c0011ce` |

```sql
with stores as (
  select fs.store_id, fs.store_name,
         case when fs.franchise_id = 'f5d17859-5709-41ba-908e-8c2672cc8089'
              then 'BRAND' else 'USER' end as grp
    from public.franchise_stores fs
   where fs.franchise_id in ('f5d17859-5709-41ba-908e-8c2672cc8089',
                             '85ef70ae-6099-4072-bce7-1a0b0487aa40')
     and not exists (select 1 from public.brand_player_monitoring_exempt e
                      where e.store_user_id = fs.store_id))
```

**뺑스톡은 브랜드 플레이어를 쓰지 않는다.** `brand_accounts` 도 `brand_player_sessions` 도
구조적으로 0건이고 `stream_sessions_v2.player_type='USER'` 로 일반 플레이어로 튼다.
그래서 RC-30.2 의 install 축(playing / unproven / silent)이 **성립하지 않는다.**

USER 군에 **적용하지 않는 것**:

- brand 세션 상태 판정 — 세션이 없는 것이 정상이다
- **C-2(세션 0건) 보고** — 구조적 정상이므로 감시선 결함이 아니다
- `brand_daily_playlists` 포함 여부 — 브랜드 플레이리스트를 받지 않는다
- `brand_player_build_identity` / freshness — 브랜드 빌드 신원 대상이 아니다

USER 군 판정은 **두 축만** 쓴다:

1. `continue_listening` 전진 — cl_age + 70초 이상 간격 재표본, 3표본 규칙 동일
2. `stream_sessions_v2` heartbeat 간격 — 교훈 B, 20초 초과를 선행 지표로

전진 확인 → STORE PLAYING / B(cl_age≥300) 또는 3표본 고정 → STORE OUTAGE /
행 부재(C) → UNKNOWN, BRAND 군과 똑같이 FAIL CLOSED.

**★ 자동 감지가 없다.** pg_cron `srr-brand-player-health`(1분)는 brand 세션을 보므로
USER 군을 커버하지 않는다. USER 군 무음은 incident 행도, Slack 도, 푸시도 자동으로
나가지 않는다. **두 예약 작업이 유일한 감시선**이고, 매장 감시는 4시간 간격이므로
최악의 경우 무음을 4시간 뒤에 안다. 이 공백은 설계상 열려 있다.

### 2026-10-30 명부 공백 — 감시 범위 밖에 실 운영 브랜드가 있다

형님이 "정기검증 브랜드와 매장 리스트 보고해" 로 전체 명부를 뽑게 해서 드러난 공백이다.

감시 범위를 `franchise_stores` 의 두 franchise_id 로 정의했는데, **`franchise_stores`
행이 없는 브랜드는 이 쿼리에 구조적으로 안 잡힌다.** `brand_accounts` 기준으로 다시
뽑으면 활성 브랜드가 5곳이고, 그중 감시 대상은 카공시대 하나뿐이다.

| 브랜드 | enterprise | 24h 세션 | 미해결 incident | 7일 incident | 감시 |
|---|---|---|---|---|---|
| 카공시대 | active · billing_enabled · per_store · 구독 2 | 7 | 1 | 10 | **O** |
| **EROOMING** | 이루밍 스터디카페 · active · billing_enabled · per_store · 구독 **0** | 4 | **2** | 3 | **X** |
| 데모 | Deudda 데모 본사 · billing off | 1 | 0 | 1 | 제외(테스트) |
| ming | ming · billing off | 0 | 0 | 0 | X |
| 루베르 콘텐츠 스튜디오 | billing off | 0 | 0 | 0 | 제외(TEST_) |

EROOMING 은 `always_on` 이고 당일 `brand_daily_playlists` 도 있다. 즉 **실제로 트는
브랜드**인데 정기검증 명부에서 통째로 빠져 있었다.

#### EROOMING 매장은 이름이 없다 — 라벨이 이메일이다

`franchise_stores` 행이 없으므로 `brand_player_incidents.store_label` 에 매장명 대신
계정 이메일이 찍힌다. 그래서 incident 는 떠도 "어느 매장인지" 가 명부로 연결되지 않는다.

- `erooming2023@naver.com` — incident open, `down_notified_at` 10-30 09:59
- `minnnnng27@gmail.com` — incident open, `down_notified_at` 10-30 07:57
  **브랜드가 EROOMING 으로 찍힌다.** 동명의 `ming` 브랜드가 따로 있는데 이 계정은
  EROOMING 소속이다. 설명되지 않는다 — 관측으로만 남긴다.

#### 두 계정 실측 (2026-10-30 10:1x KST)

| | `erooming2023@naver.com` | `minnnnng27@gmail.com` |
|---|---|---|
| `continue_listening` | **행 부재 → C(UNKNOWN)** | 행 존재, cl_age **14.1일**(10-16) → B |
| brand 세션 hb_age | 1064s (~18분) | 8357s (2.3h) |
| progress_age | null | 8364s (2.3h) |
| page_build | null (구 세션 형태) | `c6687ce56480` **CURRENT** |
| `stream_sessions_v2` | 최신 1044s · verified_seconds **0** ×3 | 최신 8354s · verified 0 / 19.8 |

판정: **두 계정 다 재생 중이 아니다.** 화정점 오진과 달리 전진 증거가 전혀 없다.

**어느 쪽 문제인가** — `minnnnng27` 은 `progress_age`(8364)와 `hb_age`(8357)가 **같이
멈췄다.** 교훈 B 대로 오디오만 막히면 heartbeat 는 살아 있어야 하므로, 두 시계가 동시에
끊긴 것은 **탭/기기가 사라진 신호**(탭 닫힘·절전·영업 종료)다 → 업체 쪽 환경.
`erooming2023` 은 `continue_listening` 행이 아예 없어 **판정 불가**다. C 를 B 로
읽지 않는다.

**우리 쪽 문제는 따로 있다**: 이 브랜드가 감시 명부에 없었다는 것 자체. 감지 cron 은
돌아서 incident 를 띄웠는데 정기검증은 그걸 안 봤다.

#### 명부 쿼리를 바꾼다 — `franchise_stores` 가 아니라 `brand_accounts` 부터

다음 점검부터 명부는 **두 단계**로 뽑는다.

```sql
-- 1단계: 활성 브랜드 전수 (franchise_stores 유무와 무관)
select ba.id, ba.name, ea.enterprise_name, ea.status, ea.billing_enabled
  from public.brand_accounts ba
  left join public.enterprise_accounts ea on ea.id = ba.enterprise_account_id
 where ba.deleted_at is null;

-- 2단계: 미해결 incident 는 브랜드 무관 전수로 본다
select store_label, brand_name, status, detection, opened_at, down_notified_at
  from public.brand_player_incidents where resolved_at is null;
```

2단계가 핵심이다. **미해결 incident 는 감시 범위로 필터하지 않는다.** 범위 밖에서
뜬 incident 가 바로 명부 공백을 알려주는 신호이기 때문이다.

제외는 이름 기준으로만 한다: `데모` · `루베르 콘텐츠 스튜디오`(TEST_ 접두) ·
`ai@swk.today` · `qa-store@deudda.test`.

#### 아직 안 한 것

EROOMING 을 정식 감시 대상으로 승격하려면 `franchise_stores` 행이나 매장명 매핑이
필요한데, 그건 스키마·데이터 쓰기다. **절대 조건(스키마를 임의로 고치지 않는다)에
걸려서 하지 않았다.** 형님 지시가 있어야 한다.

### 2026-10-30 EROOMING 감시 대상 승격 — 명부 정의를 브랜드 기준으로 바꿨다

형님 지시: "EROOMING 감시 대상으로 넣어라."

#### 왜 `franchise_stores` 에 행을 넣지 않았는가

가맹 행 자체는 **존재한다**. 없는 것은 그 가맹의 매장 행이다.

| 가맹 | id | status | `franchise_stores` 행 |
|---|---|---|---|
| 카공시대 | `f5d17859` | active | 3 |
| 주식회사 뺑스톡 | `85ef70ae` | active | 2 |
| Deudda 데모 본사 | `0aa238a1` | active | 3 |
| 루베르 콘텐츠 스튜디오 | `a9e90e0c` | active | 5 |
| **이루밍 스터디카페** | **`ea96f588`** | **active** | **0** |
| **ming** | **`9afe9e8e`** | **active** | **0** |

`franchise_stores` 에 2행을 넣으면 감시에는 잡히지만 **부작용이 둘** 생긴다.

1. 이루밍 enterprise(`01c29230`)는 `billing_enabled=true` · `billing_mode='per_store'`
   인데 활성 구독이 0건이다. 매장 행이 생기면 per_store 과금 파이프라인이 이 매장을
   청구 대상으로 집계하기 시작할 수 있다. **감시를 켜려고 과금을 건드리는 것은
   교환 조건이 맞지 않는다.**
2. `store_name` 을 내가 지어내야 한다. 실제 매장 이름을 모른다. 절대 조건이 매장
   이름 추측을 금지한다.

그래서 **DB 쓰기 없이** 명부 쿼리 정의를 바꿨다. 감시 범위는 루틴 프롬프트와 이 문서가
정의하는 것이므로, 그것을 고치는 것이 곧 감시 대상 추가다.

#### 새 명부 — 매장 7곳 (가맹 2곳 + 브랜드 1곳)

| 군 | 출처 | 대상 |
|---|---|---|
| **BRAND-가맹** | `franchise_stores` / `f5d17859` | 카공시대 화정점 `3caef236` · 숙대점 `1311d900` · 분당미금역점 `5b5f2e59` |
| **BRAND-무가맹** | `brand_player_sessions` / brand `a519eb19` | EROOMING `erooming2023@naver.com` `0b26659f` · `minnnnng27@gmail.com` `09363876` |
| **USER** | `franchise_stores` / `85ef70ae` | 뺑스톡 마포점 `fcb14222` · 성수 `6c0011ce` |

`freemilesarea@gmail.com` `7752d67f` 도 EROOMING 브랜드에 세션이 있지만
`brand_player_monitoring_exempt` 에 등록돼 있어 제외된다 — 형님 본인 계정이다.

```sql
with stores as (
  -- 가맹 매장 (매장명이 있다)
  select fs.store_id, fs.store_name,
         case when fs.franchise_id = 'f5d17859-5709-41ba-908e-8c2672cc8089'
              then 'BRAND' else 'USER' end as grp
    from public.franchise_stores fs
   where fs.franchise_id in ('f5d17859-5709-41ba-908e-8c2672cc8089',
                             '85ef70ae-6099-4072-bce7-1a0b0487aa40')
     and not exists (select 1 from public.brand_player_monitoring_exempt e
                      where e.store_user_id = fs.store_id)
  union all
  -- 가맹 매장 행이 없는 브랜드 — 매장 신원이 계정 이메일이다
  select distinct u.id, u.email, 'BRAND'
    from public.brand_player_sessions s
    join public.brand_accounts ba on ba.id = s.brand_id and ba.deleted_at is null
    join auth.users u on u.id = s.user_id
   where ba.name not in ('데모', '루베르 콘텐츠 스튜디오')
     and u.email not ilike '%@swk.today'          -- 내부 도메인
     and lower(u.email) <> 'qa-store@deudda.test'
     and s.revoked_at is null
     and s.last_seen_at > now() - interval '7 days'   -- ★ 매장은 매일 튼다
     and not exists (select 1 from public.brand_player_monitoring_exempt e
                      where e.store_user_id = u.id)
     and not exists (select 1 from public.franchise_stores fs2
                      where fs2.store_id = u.id))
```

두 번째 arm 을 **브랜드 id 로 고정하지 않고 일반화**했다. 앞으로 `franchise_stores`
행 없는 브랜드가 또 생기면 자동으로 명부에 들어온다 — 이번 공백이 재발하지 않는다.
마지막 `not exists` 가 가맹 arm 과의 중복을 막는다.

#### ★ 7일 창이 필요한 이유 — 브랜드 플레이어를 여는 것은 매장만이 아니다

처음 쓴 arm 은 창을 30일로 두고 내부 도메인을 `ai@swk.today` 하나만 제외했다.
그 결과 명부가 9곳이 되면서 **매장이 아닌 계정 2개**가 끌려왔다. 둘 다 브랜드는
**카공시대**이고 `franchise_stores` 행이 없다.

| 계정 | 생성 | 마지막 접속 | 세션 | 정체 |
|---|---|---|---|---|
| `minseo@swk.today` `957c240c` | 05-17 | 10-12 (18일 전) | 1 | 내부 도메인 — `ai@swk.today` 와 같다 |
| `mingseomm99@gmail.com` `36100712` | 10-16 05:02 | 10-16 05:17 (14일 전) | 1 | **생성 당일 15분만 살았다** — 1회성 로그인 |

즉 `brand_player_sessions` 에 행이 있다는 것은 "이 계정이 브랜드 플레이어를 **한 번
열어봤다**"는 뜻일 뿐이고 매장이라는 뜻이 아니다. 본사 직원·테스터·형님 본인이 열어도
행이 생긴다. **매장은 매일 튼다** — 그래서 창을 7일로 좁혔고, `@swk.today` 는 도메인
단위로 제외했다. EROOMING 두 계정(18분·2.3시간 전)은 남고 위 둘은 빠져 **정확히 7곳**이
된다(2026-10-30 실행 검증).

이 둘은 장애가 아니다. 명부 위생 문제이므로 **관측으로만 남긴다.**

#### EROOMING 판정 규칙 — BRAND 군 그대로

EROOMING 은 `brand_accounts` · `brand_player_sessions` · 당일 `brand_daily_playlists`
를 **다 가지고 있다.** 뺑스톡과 달리 구조가 BRAND 다. 그래서:

- RC-30.2 install 판정(playing / unproven / silent) **적용한다**
- `continue_listening` 최종 판단 · 3표본 규칙 **적용한다**
- C-1~C-4 감시선 결함 **적용한다**
- `brand_player_build_identity` freshness **적용한다**
- pg_cron `srr-brand-player-health` 1분 감지가 **실제로 돈다** — 장애 2건이 그렇게
  떴다. 뺑스톡과 달리 자동 감지 공백이 없다.

단 **매장명이 없다.** 라벨은 계정 이메일이고, 보고에도 이메일로 적는다.
실제 매장 이름을 추측해 적지 않는다.

#### 아직 안 한 것 · 형님 결정이 필요한 것

- 이루밍 `franchise_stores` 정식 등록 — 실제 매장 이름과 과금 의사가 필요하다.
  감시는 위 변경으로 이미 되므로 급하지 않다.
- 이루밍 enterprise 가 `billing_enabled=true` · `per_store` 인데 **활성 구독 0건**이다.
  의도된 상태인지 청구 누락인지 판단할 근거가 없다 — 다음 회차에 `enterprise_billing_gaps`
  로 재확인한다.
- `minnnnng27@gmail.com` 이 `ming` 브랜드가 따로 있는데도 EROOMING 소속으로 찍히는
  이유. **미해결 관측**으로 남긴다.

### 주식회사 뺑스톡 기지 사실

- enterprise_account `5e5c361b` · status **`invited`**(active 아님) · franchise `85ef70ae` active
- 사업자 2428101107 · 대표 박진수 · 초대 클레임 2건 다 success
- `brand_account` 없음 · `enterprise_regions` 없음
- **`billing_enabled=false` · 구독 0건** → `enterprise_billing_gaps` 에 안 나오는 것이
  정상이다. 미청구 누락으로 읽지 않는다.
- heartbeat 간격 실측 10.4~11.2초가 정상 대역(2026-10-28)
- 2026-10-28 05:31:28 / 05:41:00 두 표본에서 두 매장 다 track 교체 확인 — STORE PLAYING
- **미해결 관측**: 성수에 `player_mode='brand'` 로 태깅된 `audio_frozen` 3건
  (최종 10-27 07:54). brand_account 가 없는 매장인데 brand 모드로 찍혔다. 태깅 이유가
  설명되지 않는다 — 장애로도 결함으로도 쓰지 않고 관측으로만 남긴다.

---

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
