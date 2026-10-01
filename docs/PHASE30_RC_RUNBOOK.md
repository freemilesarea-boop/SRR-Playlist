# Phase 30 — Release Candidate 적용 런북

> **아직 실행하지 않았습니다.** Production merge · migration apply · 숙대 command ·
> 화정 접촉 전부 형님의 별도 승인 뒤입니다. 이 문서는 승인 시 그대로 따라 읽는 절차서입니다.
> **화정점(1177a528)은 전 과정에서 무접촉입니다. 검증 대상이 아닙니다.**

---

## PART A — 이번 RC 가 무엇을 바꾸는가

| 계층 | 변경 | 위험 |
|---|---|---|
| 코드 | 셸 감시자(ShellWatchdog)가 플레이어 실행 정지를 셸 tick 에서 감지 | 오탐 시 불필요한 remount/reload |
| 코드 | 복구 조정자(mutex) — ladder / remote command / shell watchdog 동시 실행 차단 | 없음(순수 함수) |
| DB | `0527` 오디오 파이프라인 frozen 감지 | 감지기 동작 변경 |
| DB | `0528` incident ↔ 기기 고정(device affinity) | FALSE RECOVERY 제거 |

새 타이머 0개, 새 네트워크 요청 0개, 새 storage write 0개, 새 migration 0개(0527·0528 은 Phase 25/27 산출물).

---

## PART B — 마이그레이션 (순서 고정)

### B-0. 절대 규칙

```
0527_audio_pipeline_frozen_detection.sql   ← 먼저
0528_incident_device_affinity.sql          ← 나중
```

**역순 금지.** 역순은 에러 없이 조용히 실패합니다. 두 파일 모두 `_brand_player_liveness`
를 재정의하므로, 나중에 적용된 쪽이 이깁니다. 0528 을 먼저 적용하면 0527 이 device
affinity 픽스를 **덮어써서 되돌립니다.**

로컬 PostgreSQL 16 실측 (2026-09-15):

| 적용 순서 | `healthy_checks` | 결과 |
|---|---|---|
| scaffold → 0522 → **0527 → 0528** | 0 | `DOWN 유지` ✅ |
| scaffold → 0522 → **0528 → 0527** | 2 | `RESOLVED` ❌ **FALSE RECOVERY 재발** |

### B-1. 반환 타입 DROP 규율 (둘 다 확인됨)

`create or replace function` 은 `RETURNS TABLE` 의 반환 타입을 바꾸지 못합니다
(`ERROR: cannot change return type of existing function`). 두 파일 모두 create 앞에
drop 이 있습니다.

| 파일 | drop | create |
|---|---|---|
| `0527` | L116 | L118 |
| `0528` | L168 | L170 |

### B-2. 적용 절차

1. **백업 확인** — Supabase 대시보드에서 직전 자동 백업 시각 확인. 없으면 중단.
2. **적용 창** — 매장 영업시간 밖. 감지기는 pg_cron 으로 도는 중이므로 적용 중
   incident 오판이 생길 수 있습니다.
3. `0527` 적용 → 아래 B-3 확인 → `0528` 적용 → B-3 재확인.
4. **한 번에 두 개를 붙여 넣지 않습니다.** 사이에서 확인합니다.
5. 실패 시: 다음 파일로 넘어가지 않습니다. 에러 원문을 기록하고 중단합니다.

### B-3. 적용 직후 확인 (읽기 전용)

```sql
-- 1) 진단 이벤트 CHECK 가 16종인가
select pg_get_constraintdef(oid) from pg_constraint
 where conname like '%store_playback_diagnostics%event%';

-- 2) liveness 가 열린 incident 의 session 을 고르는가
select session_id, heartbeat_age_seconds from public._brand_player_liveness(1440);

-- 3) 셸 컬럼이 있는가
select column_name from information_schema.columns
 where table_name = 'brand_player_sessions' and column_name = 'shell_last_seen_at';

-- 4) 셸 폴 RPC 가 있는가
select proname from pg_proc where proname = 'brand_player_shell_poll';
```

**주의:** `detect_brand_player_incidents()` 를 손으로 호출하지 않습니다. 부작용이 있습니다
(incident 생성/해소 + 알림). pg_cron 이 도는 것을 기다립니다.

### B-4. 롤백

- `0528` 만 되돌리려면 `0527` 의 `_brand_player_liveness` 정의를 다시 적용합니다
  (= FALSE RECOVERY 로 복귀, 감지 자체는 계속 동작).
- `0527` 롤백은 `0522` 의 `_brand_player_session_health` 기반 정의로 되돌립니다.
  단 `brand_player_incidents.status` 의 `'frozen'` 행이 있으면 CHECK 축소가 실패합니다.
  먼저 그 행을 조회해서 판단합니다. **행을 지워서 예쁘게 만들지 않습니다.**

---

## PART C — 코드 배포

1. PR #580 (Phase 25) merge — **먼저**.
2. PR #581 (Phase 27 + 29 + 30, stacked) merge — 그 다음.
3. Vercel Production 배포 완료 확인.
4. **숙대 태블릿에 강제 reload 를 걸지 않습니다.** Zero-Touch 경로로 받습니다:
   배포 감지 60초 + stagger 최대 309초 + 다음 트랙 경계.
5. 새 빌드 도착 확인 — `brand_player_sessions.page_build_hash` 가 새 해시로 바뀌는지.
   **바뀌기 전 관측은 이번 변경의 검증이 아닙니다.**

---

## PART D — 감지 지연 (실측 아님 · 모델 값)

| 문서 상태 | suspect 임계 | 확정 관측 | 최악 감지 | 근거 |
|---|---|---|---|---|
| visible | 35초 (`SKIP_AFTER_MS`) | ×3 | **50초** | 기존 ladder 의 skip 단 |
| hidden | 150초 (`RELOAD_PAGE_AFTER_MS`) | ×3 | **165초** | 기존 ladder 의 page reload 단 |

임의 숫자가 아니라 `stallWatchdog.ts` 가 이미 쓰는 두 상수를 그대로 가져왔습니다.

**hidden 을 150초로 둔 이유(낮추지 않은 이유):** 백그라운드에서 브라우저가
`setInterval` 을 분당 1회로 스로틀합니다. 60초/90초 후보를 분당 1회 모델에 넣으면
60초는 오탐이 발생하고 90초부터 0 이 됩니다. 150초는 기존 상수이면서 그 선을 넘습니다.
**가장 낮은 숫자가 아니라 FALSE RECOVERY = 0 을 유지하는 값을 골랐습니다.**

> 이 표는 **모델 값이고 실측이 아닙니다.** 실기기 실측 전에는 "보장"이라고 쓰지 않습니다.

---

## PART E — SLA 구분 (혼동 금지)

| 이름 | 무엇을 재는가 | 성공 기준 |
|---|---|---|
| **감지 지연** | 플레이어 실행 정지 → 셸이 확정 | 위 PART D |
| **자가 복구** | 확정 → remount 또는 controlled reload → 실제 오디오 진행 2 샘플 | 실측 필요 |
| **운영자 복구** | `[매장 긴급 복구]` 클릭 → 실제 오디오 진행 2 샘플 | 목표 60초 · **실측 필요** |

`command issued` / `page loaded` / `heartbeat returned` 는 **셋 다 복구 성공이 아닙니다.**
성공은 오직 실제 오디오 진행입니다.

---

## PART F — Preview 검증 상태 (코드 문제 아님)

| 항목 | 상태 | 근거 |
|---|---|---|
| Preview **빌드** | ✅ READY | PR #581 `08b55af` Vercel status `success` "Deployment has completed" |
| Preview **런타임** 체크리스트 | ⛔ 미실행 | 이 컨테이너에서 preview 호스트에 접근 불가 |

접근 불가 근거(재시도 중단됨):

```
CONNECT tunnel failed, response 403
proxy status → connect_rejected · "gateway answered 403 to CONNECT (policy denial)" · vercel.com:443
Vercel MCP 토큰 → 해당 project 미열람 (list_projects [] · get_deployment 404)
```

**환경 문제이고 코드 문제가 아닙니다.** README 지침대로 반복 재시도하지 않았습니다.

**런타임 검증에 필요한 최소 승인/절차 (택1):**
1. 형님이 직접 브라우저로 Preview URL 을 열어 PART G 체크리스트를 읽어 주시는 것, 또는
2. 이 환경의 network policy 에 `*.vercel.app` egress 를 허용하는 것, 또는
3. Preview 를 건너뛰고 Production 배포 후 PART G 를 숙대에서 수행하는 것
   (위험이 가장 큽니다 — 권하지 않습니다).

---

## PART G — 숙대 실기기 검증 런북

> 점주 조작은 **G-6 한 번뿐**입니다. 나머지는 전부 서버 측 읽기입니다.

| # | 단계 | 확인 | 실패 시 |
|---|---|---|---|
| G-1 | `0527` 적용 | PART B-3 | 중단 |
| G-2 | `0528` 적용 | PART B-3 + liveness 가 incident session 을 고름 | 중단 |
| G-3 | Production 배포 | Vercel Production READY | 중단 |
| G-4 | 감시 대상 install 확정 | `resolveMonitoredInstall` 이 `resolved` — 숙대 태블릿 1개 | **중단.** `unknown` 이면 버튼을 쓰지 않습니다(FAIL CLOSED) |
| G-5 | Windows 세션 분리 확인 | 관리자 화면이 태블릿을 감시 대상으로, Windows 를 비대상으로 표시 | 중단 |
| G-6 | 태블릿에서 앱 실행 (**점주 조작 1회**) | `page_build_hash` 가 새 해시 | 중단 |
| G-7 | 실제 오디오 진행 | `last_audio_progress_at` 이 3회 연속 전진 | 중단 |
| G-8 | 무접촉 관찰 24시간 | 트랙 전환 계속 · incident 0 · 오탐 remount/reload 0 | 관측 보존 후 보고 |
| G-9 | 안전 복구 시험 (**영업 종료 후에만**) | `[매장 긴급 복구]` 1회 → 실제 오디오 진행 2 샘플 | 실패 원문 보존 |
| G-10 | 클릭 → 오디오 실측 | 초 단위 기록. 60초 초과면 초과라고 씁니다 | 숫자를 고치지 않습니다 |
| G-11 | 무접촉 관찰 7일 | 점주 개입 0회 | 그대로 보고 |

**G-9 는 매장 영업 중에 실행하지 않습니다.** 소리가 한 번 끊깁니다.

**전 과정에서 화정점에는 어떤 command / reload / refresh / session reset 도 보내지 않습니다.**
화정 건강 확인은 읽기 전용 조회만입니다.

---

## PART H — 이번 RC 가 증명하지 못한 것

- **ROOT CAUSE 는 여전히 UNKNOWN 입니다.** Phase 29·30 은 "플레이어 실행이 멎었을 때
  되살린다" 를 만들었을 뿐, "왜 멎었는가" 를 밝히지 못했습니다.
- `token falsy` 는 **낮은 우선순위 후보**로 남습니다.
- 자가 복구 / 운영자 복구 시간은 **실측 전입니다.** 보장 숫자가 아닙니다.
- 실기기 오탐률은 **실측 전입니다.** 시뮬레이션에서 0 이었다는 것뿐입니다.
