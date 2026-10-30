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
     and u.email not ilike '%@swk.today'              -- 내부 도메인 전체
     and lower(u.email) not in ('qa-store@deudda.test',
                                'mingseomm99@gmail.com')  -- 직원 테스트 계정
     and s.revoked_at is null
     and s.last_seen_at > now() - interval '30 days'  -- 묵은 세션 차단용(필터가 아니다)
     and not exists (select 1 from public.brand_player_monitoring_exempt e
                      where e.store_user_id = u.id)
     and not exists (select 1 from public.franchise_stores fs2
                      where fs2.store_id = u.id))
```

두 번째 arm 을 **브랜드 id 로 고정하지 않고 일반화**했다. 앞으로 `franchise_stores`
행 없는 브랜드가 또 생기면 자동으로 명부에 들어온다 — 이번 공백이 재발하지 않는다.
마지막 `not exists` 가 가맹 arm 과의 중복을 막는다.

#### ★ 직원 테스트 계정은 신원으로 제외한다 — 활동 기간으로 거르지 않는다

처음 쓴 arm 은 창을 30일로 두고 내부 도메인을 `ai@swk.today` 하나만 제외했다.
그 결과 명부가 9곳이 되면서 **매장이 아닌 계정 2개**가 끌려왔다. 둘 다 브랜드는
**카공시대**이고 `franchise_stores` 행이 없다.

| 계정 | 생성 | 마지막 접속 | 정체 |
|---|---|---|---|
| `minseo@swk.today` `957c240c` | 05-17 | 10-12 | **직원 테스트 계정** (형님 확인 2026-10-30) |
| `mingseomm99@gmail.com` `36100712` | 10-16 | 10-16 | **직원 테스트 계정** (형님 확인 2026-10-30) |

형님 확인: "우리 직원이 테스트용으로만 이리저리 쓰려고 만든 계정들이다. 자유롭게
냅둬도 된다."

처음엔 창을 7일로 좁혀서 걸렀는데 **그 방식은 틀렸다.** 두 가지 이유다.

1. `mingseomm99@gmail.com` 은 **gmail 이라 도메인 제외에 걸리지 않는다.** 직원이
   자유롭게 쓰면 7일 창 안으로 들어와 **매장으로 잡힌다.** 그리고 테스트를 끝내고
   탭을 닫는 순간 "매장 무음"이 된다.
2. 활동 기간을 필터로 쓰면 **실제 매장이 조용할 때 명부에서 빠진다.** 연휴로 8일
   쉬는 매장은 감시가 가장 필요한 시점에 명부에서 사라진다 — 그것이 바로 EROOMING
   과 같은 실패 방식(명부 밖이라 안 보임)이다.

→ **제외는 신원으로 한다.** 창은 묵은 세션을 막는 보조 장치로만 두고 30일로 넓혔다.
창을 **365일로 열어도 결과가 정확히 7곳**임을 실행 검증했다(2026-10-30) — 즉 지금
명부를 지키는 것은 창이 아니라 신원 제외다.

★ 직원 테스트 계정이 **개인 메일 주소를 쓸 수 있다**는 것이 핵심 교훈이다. 도메인
  제외로는 못 잡는다. 새 계정이 나타나면 **명부 행수 불일치(≠7)로 드러나므로** 그때
  형님께 확인하고 신원 제외에 추가한다. 행수 점검을 빼지 않는다.

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

## 2026-10-30 재설계 — 이용매장 점검 (매시간 점검 · 09/21시 보고)

형님 지시 전문:
> 이용매장 점검에 대해서 정리해서 다시 해야겠다. SQL 은 나한테 허락받지 말고 바로바로
> 진행하도록 할 것. 모든 사업자 계정, 브랜드 계정, 본사, 가맹 전부 확인할것.
> 보고는 `매장1 정상 / 매장4 비정상 끊김 (끊김 원인: 우리쪽 또는 매장쪽 정확하게 자동 파악)`.
> 우리쪽 끊김이면 자동 분석해서 슬랙에 남길 것. 우리쪽이 아니면 방어 문자 메시지를
> 슬랙에 쌓아둘 것. 아침 9시 · 밤 9시에 보고, 너는 매시간 점검. 특별한 문제 없으면
> 09/21시에만 보고. 특별한 문제가 있으면 클로드 앱 알람, 그 외 알람 금지.

### SQL 승인 제거

`.claude/settings.json` 의 `permissions.allow` 에 Supabase 읽기 도구를 등록했다.
`mcp__Supabase__execute_sql` 포함 — 이제 매 호출마다 승인 창이 뜨지 않는다.

```json
"allow": ["mcp__Supabase__execute_sql", "mcp__Supabase__query_logs",
          "mcp__Supabase__list_tables", "mcp__Supabase__list_edge_functions",
          "mcp__Supabase__get_edge_function", "mcp__Supabase__get_advisors"]
```

`apply_migration` 은 **넣지 않았다.** 스키마 변경은 절대 조건이 금지하므로 승인 창이
남아 있는 것이 안전장치다. 점검에는 필요 없다.

### 전수 조사 결과 — 사업자 6곳 · 가맹 6곳 · 실매장 8곳

`enterprise_accounts` 6건, 각각 가맹 1곳씩 연결돼 있다.

| 사업자(본사) | 가맹 | 가맹매장 행 | 과금 | 활성구독 |
|---|---|---|---|---|
| 카공시대 | 카공시대 | 3 | per_store | 2 |
| 이루밍 스터디카페 | 이루밍 스터디카페 | **0** | per_store | 0 |
| 주식회사 뺑스톡 | 주식회사 뺑스톡 | 2 | hq_consolidated | 0 |
| ming | ming | **0** | hq_consolidated | 0 |
| Deudda 데모 본사 | Deudda 데모 본사 | 3 | — | — |
| 루베르 콘텐츠 스튜디오 | 루베르 콘텐츠 스튜디오 | 5 | — | — |

제외: 데모 매장 1~3, TEST_스튜디오오감 5곳 = 테스트·데모 8곳.

**개인 구독(`subscriptions`)에 사업자 플랜이 따로 있다**: `plan_type='business'`
= 듣다 사업자 정기이용권 6,900원. 활성 4건 중 3건은 이미 가맹 매장이고,
**1건(`offidewings@gmail.com`)은 어느 가맹에도 없었다** — 가맹 기준 명부로는 영원히
안 잡히는 유료 사업자다.

### 명부 정의 — 3-arm union, uid 중복 제거

이용매장 = **가맹 매장 ∪ 브랜드 플레이어 계정 ∪ 사업자 플랜 유료 구독자**.
어느 하나만 쓰면 반드시 빠지는 매장이 생긴다(실측으로 세 번 확인됐다).

```sql
with cand as (
  -- arm 1: 가맹 매장 (매장명이 있다) — 테스트 가맹 제외
  select fs.store_id as uid, fs.store_name as label, 1 as pri, f.name as owner
    from public.franchise_stores fs join public.franchises f on f.id = fs.franchise_id
   where f.name not in ('Deudda 데모 본사', '루베르 콘텐츠 스튜디오')
  union all
  -- arm 2: 브랜드 플레이어를 쓰는 계정 (가맹 행 없는 브랜드까지 포함)
  select u.id, u.email, 2, ba.name
    from public.brand_player_sessions s
    join public.brand_accounts ba on ba.id = s.brand_id and ba.deleted_at is null
    join auth.users u on u.id = s.user_id
   where ba.name not in ('데모', '루베르 콘텐츠 스튜디오')
     and s.revoked_at is null
     and s.last_seen_at > now() - interval '30 days'
  union all
  -- arm 3: 사업자 플랜 유료 구독자 (가맹 미소속 개별 사업자)
  select u.id, u.email, 3, '개별 사업자'
    from public.subscriptions sub join auth.users u on u.id = sub.user_id
   where sub.plan_type = 'business' and sub.status = 'active'
), ranked as (
  select cand.uid, cand.label, cand.owner, cand.pri,
         row_number() over (partition by cand.uid order by cand.pri, cand.label) as rn
    from cand
   where cand.label not ilike 'TEST_%'
     and not exists (select 1 from public.brand_player_monitoring_exempt e
                      where e.store_user_id = cand.uid)
     -- ★★ 제외는 **계정 신원(auth.users.email)** 으로 한다. 라벨로 걸지 않는다.
     and not exists (select 1 from auth.users us
                      where us.id = cand.uid
                        and (us.email ilike '%@swk.today'
                          or lower(us.email) in ('qa-store@deudda.test',
                                                 'mingseomm99@gmail.com')))
)
select uid, label, owner from ranked where rn = 1;
```

#### ★★ 2026-10-30 11:06 — 라벨 기준 제외가 실제로 뚫렸다

재설계 직후 첫 실행에서 명부가 **9행**으로 나왔다. 새로 들어온 행은
**"이루밍 분리송출 테스트점"** 이었고, 정체는 `minseo@swk.today` `957c240c` —
형님이 직원 테스트 계정이라고 확인해 준 그 계정이다.

원인은 내 쿼리였다. 제외 조건을 `label not ilike '%@swk.today'` 로 **라벨에**
걸어놨는데, arm 1(가맹)은 라벨이 **`store_name`** 이다. 그 계정에 `franchise_stores`
행이 생기는 순간 라벨이 이메일에서 매장명으로 바뀌고 **도메인 제외를 그대로
빠져나간다.** 실제로 11:06 경에 이루밍 가맹에 그 매장 행이 생겼다(10:55 조사
시점에는 `franchise_stores` 행이 0개였다).

→ 제외는 **`cand.uid` 로 `auth.users` 를 조회해 이메일을 보고** 판단한다. 라벨은
  사람이 읽는 표시값일 뿐이고 **신원이 아니다.** 고친 뒤 다시 8행으로 돌아왔다.
→ `TEST_` 접두 라벨 제외도 함께 넣었다(루베르 가맹 이름이 바뀌어도 걸리도록).

이것이 "직원 테스트 계정은 개인 메일을 쓸 수 있다"에 이어 같은 교훈의 두 번째
사례다. **표시값으로 거르면 표시값이 바뀌는 순간 뚫린다.**

★ **uid 중복 제거가 필수다.** 숙대점·분당미금역·성수는 가맹 매장이면서 사업자 구독자라
세 arm 에 동시에 걸린다. `pri` 로 **가맹 매장명을 우선**해 사람이 읽을 이름을 쓴다.
★ 2026-10-30 실행 검증: **정확히 8행.**

| 매장 | 소속 | uid |
|---|---|---|
| 카공시대 화정점 | 카공시대 | `3caef236` |
| 르하임스터디카페s 워크라운지 숙대점 | 카공시대 | `1311d900` |
| 카공시대 분당미금역점 | 카공시대 | `5b5f2e59` |
| 마포점 | 주식회사 뺑스톡 | `fcb14222` |
| 성수 | 주식회사 뺑스톡 | `6c0011ce` |
| `erooming2023@naver.com` | EROOMING | `0b26659f` |
| `minnnnng27@gmail.com` | EROOMING·카공시대 | `09363876` |
| `offidewings@gmail.com` | 개별 사업자 | `b2293441` |

★ `minnnnng27@gmail.com` 은 **EROOMING 과 카공시대 두 브랜드에 모두 세션이 있다.**
  소속 표기는 최근 세션 기준으로 적고, 설명되지 않는 상태이므로 관측으로 남긴다.
★ 매장명이 없는 3곳은 **계정 이메일을 그대로 쓴다.** 이름을 추측하지 않는다.

### 상태 4분류 — 정상 / 비정상 끊김 / 미사용 / 판정 불가

| 상태 | 조건 | 보고 문구 |
|---|---|---|
| **정상** | cl 전진 확인(70초 이상 간격 재표본에서 position 증가 또는 track 교체) | `<매장명> 정상` |
| **비정상 끊김** | cl_age≥300 **또는** 3표본 고정 — 그리고 전진 증거 없음 | `<매장명> 비정상 끊김` + 원인 |
| **미사용** | cl_age > 7일 **그리고** 세션 이력 없음 | `<매장명> 미사용 (N일)` |
| **판정 불가** | cl 행 부재(C) · 3표본 미완 · UNKNOWN 혼입 | `<매장명> 판정 불가 — 재표본` |

★★ **미사용을 끊김으로 쓰지 않는다.** `offidewings@gmail.com` 은 사업자 플랜을 계속
  결제하면서 플레이어가 **115일째** 조용하다. 이것은 장애가 아니라 이탈 신호이고,
  매시간 "끊김"으로 올리면 순수 소음이다. 09/21시 보고에 한 줄로만 적는다.
★★ **cl 행 부재(C)를 끊김으로 쓰지 않는다.** 2026-10-30 10:4x 실측에서 마포점과
  분당미금역이 **30초 사이에 cl 행이 사라졌다** — 직전 표본에서 둘 다 cl_age 2~5초로
  정상 재생 중이었다. 곡 경계 delete+insert write gap 이 실시간으로 재현된 것이다.
  C 는 무조건 재표본이다.

### 끊김 원인 자동 판정 — 우리 쪽 / 매장 쪽

판정은 **두 시계를 비교**해서 한다. `hb_age`(heartbeat, 메인 스레드 타이머)와
`progress_age`(`last_audio_progress_at`, 오디오 진행)다. 오디오가 막혀도 heartbeat 은
살아 있으므로 **인과가 한쪽으로만 성립한다**(교훈 B).

| 관측 | 판정 | 근거 |
|---|---|---|
| `hb_age` 와 `progress_age` 가 **비슷한 값으로 동시 정지** | **매장 쪽** | 탭 닫힘·전원 off·절전. 오디오만 막히면 heartbeat 은 살아야 한다 |
| `hb_age` 싱싱 + `progress_age` 만 낡음 | **우리 쪽** | 플레이어는 살아 있는데 소리가 안 난다 = 오디오 파이프라인 |
| `shell_age` 싱싱 + `hb_age` 낡음 | **우리 쪽** | 껍데기는 살았고 플레이어만 죽었다 |
| `gate_blocked` = `autoplay_blocked` / `ended` | **매장 쪽** | NotAllowedError — 사람이 눌러야 풀린다. 코드로 못 뚫는다 |
| `gate_blocked` = `not_playing` + `paused=true` | **매장 쪽** | 사람이 멈췄다 |
| incident 열려 있는데 cl 전진 중 | **우리 쪽** | 감지 오탐 |
| cl 전진 없는데 incident 없음 | **우리 쪽** | 감지 누락 |
| `freshness=STALE` | **우리 쪽** | 구 빌드가 매장에 남아 있다 |
| 크론 실패 · 미발송 · 플레이리스트 service_date 지연 | **우리 쪽** | 인프라 |
| `realtime_status=CHANNEL_ERROR` 상태의 정지 | **매장 쪽** + 단서 | 원격 복구가 안 닿아 점주 조작만 남았다고 함께 적는다 |
| 위 어느 것도 확정 안 됨 | **판정 불가** | 단정하지 않는다 |

★ **증거 없이 매장 쪽이라고 쓰지 않는다.** 책임 전가가 가장 비싼 오판이다.

### 슬랙 적재 — `admin_notifications` 에 INSERT 하면 1분 안에 슬랙으로 간다

경로 확인(2026-10-30): `admin_settings.notification_slack_webhook_url` 이 설정돼 있고
(`https://hooks.slack.com/...`), `notification_min_severity='info'`,
pg_cron `srr-dispatch-notifications`(매분)이 `cron_dispatch_pending_notifications(15)` 로
`dispatched_at is null` 행을 집어 슬랙에 POST 한다. 30일 236건 전부 오류 0건.

★ `dispatch_slack_at` 컬럼은 **함수가 쓰지 않는 유물이다.** 이 값이 null 인 것을
  "슬랙 미발송"으로 읽지 않는다 — 실제 발송 여부는 `dispatched_at` 과
  `dispatch_error` 로 판단한다. (2026-10-30 내가 이걸로 한 번 오판했다.)

**우리 쪽 문제 → 분석을 적재**

```sql
insert into public.admin_notifications (kind, severity, title, body, context)
select 'store_check_ours', 'error',
       '[점검·우리 쪽] ' || :label || ' — ' || :symptom,
       :analysis,
       jsonb_build_object('store_uid', :uid, 'side', 'ours', 'source', 'store_check')
 where not exists (
   select 1 from public.admin_notifications
    where kind = 'store_check_ours'
      and context->>'store_uid' = :uid
      and created_at > now() - interval '6 hours');
```

**매장 쪽 문제 → 방어 문자 초안을 적재**

```sql
insert into public.admin_notifications (kind, severity, title, body, context)
select 'store_check_defense_sms', 'warning',
       '[방어문자 대기] ' || :label || ' — ' || :cause,
       :sms_draft,
       jsonb_build_object('store_uid', :uid, 'side', 'store',
                          'source', 'store_check', 'draft_sms', true)
 where not exists (
   select 1 from public.admin_notifications
    where kind = 'store_check_defense_sms'
      and context->>'store_uid' = :uid
      and created_at > now() - interval '6 hours');
```

★★ **`where not exists` 6시간 쿨다운을 절대 빼지 않는다.** 매시간 점검이므로 빼면
  같은 매장 건으로 하루 24건이 슬랙에 쌓인다. 그것이 백로그 사고의 재발이다.
★ 이 두 INSERT 는 **점검 루틴이 유일하게 허용된 쓰기**다. incident 행·세션 행·스키마는
  여전히 금지다.

**방어 문자 초안 템플릿** — 점주에게 보낼 문장이다. 우리 책임이 아님을 기록으로
남기는 것이 목적이므로 관측 사실만 쓰고 추측을 넣지 않는다.

```
[듣다] <매장명> 음악 재생이 <HH:MM>부터 중단된 것으로 확인됩니다.
서버·음원 전송은 정상이며, 매장 기기에서 재생이 멈춘 상태입니다.
(확인된 상태: <hb_age/progress_age 동시 정지 | 자동재생 차단 | 일시정지>)
매장 태블릿/PC 화면을 한 번 터치하거나 새로고침해 주시면 복구됩니다.
계속 재생되지 않으면 이 메시지에 회신해 주세요.
```

★ 이 초안은 **슬랙에 쌓아두는 것까지**다. 점주에게 직접 보내지 않는다 —
  절대 조건(점주에게 직접 연락 금지)은 그대로다. 보내는 것은 사람이 결정한다.

### 주기 — 매시간 점검 · 09/21시 보고 · 문제 있을 때만 알람

| 루틴 | 주기 | 출력 |
|---|---|---|
| 매시간 점검 | `CRON_TZ=Asia/Seoul 34 * * * *` | 문제 없으면 **완전 침묵**. 문제 있으면 슬랙 적재 + 푸시 1회 |
| 09/21시 보고 | `CRON_TZ=Asia/Seoul 9 9,21 * * *` | 결과와 무관하게 대화 보고. 푸시는 **문제 있을 때만** |

★ 분을 :00 이 아닌 :34 / :09 로 둔 것은 의도적이다 — 정시에 몰리는 지연을 피한다.
★ **매시간 점검은 가벼워야 한다.** 기본은 명부+상태 **쿼리 1발**이고, 비정상이
  나온 매장에 대해서만 진단 쿼리로 내려간다. 24회 모두 전체 진단을 돌리지 않는다.
★ 이전 규칙과 달라진 점: **09/21시 보고도 문제 없으면 푸시를 보내지 않는다.**
  형님 지시가 "특별한 문제가 있다면 알람, 그 외에는 알람을 주지 말것" 이다.

### 이 설계가 안고 있는 위험 — 숨기지 않고 적는다

매시간 루틴이 **이 영속 세션으로 발사된다.** 하루 24회이므로 미처리 알림이 쌓이면
백로그 사고가 재발할 여지가 커진다. 그래서 **백로그 흡수 규칙을 매시간 루틴에
최우선으로 둔다**: 같은 루틴의 미처리 알림이 여러 건이면 **가장 최근 1건만 처리하고
나머지는 읽어서 버린다.** 과거 시점 상태를 지금 보고하는 것은 소음이다.

새 세션으로 발사(`create_new_session_on_fire`)하면 백로그가 구조적으로 없어지지만,
새 세션이 Supabase MCP 연결을 물려받는다는 보장이 없어 **점검 자체가 불가능해질
위험**이 있다. 그 교환이 더 나빠서 영속 세션을 유지했다. 백로그가 실제로 재발하면
그때 바꾼다.

---

### 2026-10-30 명부 기준 2차 변경 — "아티스트가 아니면 전부" · 신규 자동 포함

형님 지시:
> 새로 가입되는 사업자들이 있으면 리스트에 자동으로 추가하고, 아티스트로 회원가입이
> 되어있는 계정이 아니라면 전부 포함시켜라.

#### 왜 이 기준이 맞는가 — 사업자 플랜 기준은 실제로 매장을 놓쳤다

직전 설계는 arm 3 을 `subscriptions.plan_type='business'` 로 잡았다. 그런데
**카공시대 화정점은 `individual` 플랜(4,900원)으로 결제한다.** 실매장인데 사업자
플랜이 아니다. 가맹 매장 행이 있어서 arm 1 로 겨우 잡혔을 뿐, 가맹에 안 묶인 매장이
개인 플랜으로 결제하면 **영원히 안 잡힌다.**

반대로 "아티스트가 아니면 전부"는 놓칠 수가 없다. 아티스트는 음원을 올리는 쪽이고
매장이 될 일이 없으므로, 그것만 빼면 나머지는 전부 잠재적 이용매장이다.

#### 아티스트 판별 — `users.account_type = 'artist'`

| 기준 | 건수 |
|---|---|
| `users` 전체 | 329 |
| `account_type = 'artist'` | 206 |
| `artist_profiles` 행 | 206 |

두 수가 **정확히 일치한다.** 그래서 아티스트는 `account_type='artist'` 로 판별하고,
안전하게 `artist_profiles` 존재 여부도 **OR 로 함께** 본다(한쪽만 찍힌 계정이 나중에
생겨도 걸리도록).

★ `subscriptions.plan_type` 으로 아티스트를 가리지 않는다. 구독이 없는 아티스트가
  있고(`plan_type` null 인 artist 65건), 플랜 이름 체계가 `users.plan_type` 과
  `subscriptions.plan_type` 에서 서로 다르다(`student_artist` vs `artist_student`).

#### 새 명부 정의 — 신규 가입이 자동으로 들어온다

```sql
with roster as (
  select u.id as uid, au.email, u.account_type, u.membership_tier
    from public.users u
    join auth.users au on au.id = u.id
   where coalesce(u.account_type, '') <> 'artist'
     and not exists (select 1 from public.artist_profiles ap where ap.user_id = u.id)
     and u.withdrawn_at is null
     and u.disabled_at is null
     -- 테스트·데모·내부 계정은 신원으로 제외한다 (라벨로 걸지 않는다)
     and au.email not ilike '%@swk.today'
     and au.email not ilike '%@deudda.local'
     and au.email not ilike '%@deudda.com'
     and au.email not ilike '%@deudda.test'
     and lower(au.email) <> 'mingseomm99@gmail.com'
     and not exists (select 1 from public.brand_player_monitoring_exempt e
                      where e.store_user_id = u.id)
)
```

라벨과 소속은 있는 것을 쓰고, 없으면 이메일로 떨어진다:

```sql
coalesce((select fs.store_name from public.franchise_stores fs
           where fs.store_id = r.uid limit 1), r.email) as label,
coalesce((select f.name from public.franchise_stores fs
            join public.franchises f on f.id = fs.franchise_id
           where fs.store_id = r.uid limit 1),
         (select ba.name from public.brand_player_sessions s
            join public.brand_accounts ba on ba.id = s.brand_id
           where s.user_id = r.uid order by s.last_seen_at desc limit 1),
         case when exists (select 1 from public.subscriptions sb
                            where sb.user_id = r.uid and sb.status = 'active'
                              and sb.plan_type = 'business') then '사업자 구독'
              else '미분류' end) as owner
```

★★ **arm 3 종류의 union 이 더 이상 필요 없다.** `users` 전수에서 아티스트만 빼면
  가맹 매장·브랜드 계정·사업자 구독자가 **모두 이미 포함**된다. 3-arm union 은
  폐기했다 — union 을 쓰던 이유가 "어느 하나만 보면 빠진다"였는데, 이제 모집단이
  `users` 자체이므로 빠질 수가 없다. 중복 제거(uid 기준 row_number)도 불필요해졌다.
★★ **신규 가입은 자동으로 들어온다.** 사람이 명부를 고칠 일이 없다. 아티스트로
  가입하면 자동으로 빠지고, 그 외로 가입하면 그 시각부터 명부에 있다.
★ 제외는 전부 **계정 신원(이메일 / `monitoring_exempt`)** 기준이다. 라벨로 걸면
  가맹 매장명이 붙는 순간 뚫린다(10-30 11:06 사례).

#### 2026-10-30 11:25 실측 — 명부 81곳

| 구간 | 건수 |
|---|---|
| **재생 중**(cl_age<300) | 5 |
| **cl 행 부재지만 다른 축 싱싱** | 1 |
| **끊김**(cl_age 300초~7일) | 1 |
| **미사용**(cl_age 7일 초과) | 25 |
| **재생 이력 자체 없음** | 49 |
| 합계 | **81** |

실제로 쓰고 있는 것은 **7곳**이고 나머지 74곳은 미사용 또는 미개시다.

#### 보고 분량 — 미사용은 묶어서 적는다

81줄을 매 회차 적는 것은 형님이 줄이라고 한 소음이다. 그래서:

- **재생 중 · 끊김 · 판정 불가**는 **한 줄씩 매장명으로** 전부 적는다(형님 요청 형식).
- **미사용 · 미개시**는 **건수 한 줄**로 묶고, 그중 **유료 결제 중인 계정만** 이름을
  적는다(돈을 내면서 안 쓰는 것은 이탈 신호이므로 알 가치가 있다).
- 미사용 계정이 **재생을 시작하면 그 회차부터 자동으로 한 줄씩** 올라온다.

★ 이것은 명부에서 빼는 것이 아니다. 81곳 전부 매 회차 조회하고, 상태가 바뀌는
  즉시 개별 줄로 올라온다. **표시만 묶는다.**

#### 유료인데 안 쓰는 계정 (2026-10-30 기준)

| 계정 | 상태 | 마지막 재생 |
|---|---|---|
| `offidewings@gmail.com` | `business:active` 6,900원 결제 중 | **115일** |
| `loviz3467@gmail.com` | `business:cancel_scheduled` | **5.4일** |

둘 다 장애가 아니다. 전자는 돈만 내고 안 쓰는 상태, 후자는 해지 예정이다.
**끊김으로 올리지 않고 푸시도 보내지 않는다.**

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
