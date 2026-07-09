# ALGO-8B — Runtime Apply Specification

> **Phase 성격:** 명세(Specification) 전용. **코드 수정 없음 · Migration 없음.**
> ALGO-8A(`0446_runtime_fix_readiness`)에서 정의된 Runtime Change Plan 6건을 실제로 적용할 때
> 손대야 하는 **모든 실제 Runtime 코드(함수·RPC·Trigger·SQL·Type·API·React Flow)를 100% 식별**하고,
> 파일 목록 / 함수 목록 / 영향도 / Rollback Plan / Test Matrix / Production Apply Sequence 를 문서화한다.
>
> 본 문서는 실제 적용을 수행하지 않는다. 적용은 human approval + governance pass 를 요구하는 후속 Phase 대상이다.
> (근거: ALGO-8A `runtime_readiness_checklist` = not_ready, `runtime_safe_apply_plan` Stage 2+ = blocked)

---

## 0. 진단 근거 (현재 Runtime 진실)

프로덕션 DB(`nsoesrvwkxqifjcxzvol`)에서 확인한 **유효(effective) 정의**:

**Funnel view chain — 전부 `0412_streaming_v2_foundation.sql`, 이후 미재정의:**

```
v2_verified_streams  (0412:123-128)
  = stream_ingest_v2
    WHERE event_type='play_30s'
      AND heartbeat_verified = true
      AND coalesce(verified_seconds,0) >= 30
      AND coalesce(visibility_state,'visible') = 'visible'

v2_eligible_streams  (0412:130-137)  -- ★ v2_verified_streams 위에 중첩
  = v2_verified_streams
    WHERE coalesce(player_volume,1) >= 0.1
      AND coalesce(player_muted,false) = false
      AND ineligible_reason IS NULL
      AND player_type NOT IN ('ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM')
      AND coalesce(fraud_score,0) < 60
      AND dispute_status = 'none'

v2_settlement_eligible_streams  (0412:139-141)  -- eligible 위에 중첩
  = v2_eligible_streams e
    WHERE EXISTS (SELECT 1 FROM eligible_settlement_tracks est WHERE est.track_id = e.track_id)
```

**두 근본원인(ALGO-2E/2D 재확인, 체크인 #4 기준 verified=0·eligible=0 지속):**

- **(a) 검증 타이밍 freeze:** `record_stream_event_v2`(0412:259-329)가 `play_30s` insert 시점에
  세션의 `verified_seconds`를 **스냅샷**으로 복사하고 `heartbeat_verified = (verified_seconds>=30)`을 **동결**한다
  (0412:301-305, 319). 그런데 세션의 `verified_seconds`는 `verify_stream_heartbeat_v2`(0412:226-257)가
  **wall-clock 델타(10s 간격, 15s cap)**로 누적하므로, `play_30s`가 fire 되는 currentTime≈30s 시점에는
  아직 heartbeat 이 1~2회밖에 안 돌아 `verified_seconds<30` → milestone 행이 `heartbeat_verified=false`로 동결.
  이후 세션이 120~130s 확정돼도 **milestone 행은 back-fill 되지 않음** → `v2_verified_streams` = 0.
- **(b) 세션 정체성 불일치:** `start_stream_session_v2`(0412:209-224)는 세션 `player_type = upper(p_player_type)`
  = `USER` 로 저장하지만, `record_stream_event_v2`는 `_v2_resolve_player_type`(0412:187-204)로 **재분류**하여
  `/artist%` source_page 또는 track owner 인 경우 `ARTIST_PREVIEW`로 **downgrade**. 클라이언트 `resolvePlayerType()`
  (`streamingV2Api.ts:35-43`)도 pathname 기반으로 동일 downgrade. → session=USER ↔ milestone=ARTIST_PREVIEW →
  `v2_eligible_streams`의 `player_type NOT IN (…'ARTIST_PREVIEW'…)`에서 제외.

> **Trigger 없음:** `stream_ingest_v2` / `stream_sessions_v2` 에 트리거가 존재하지 않음(전체 migration 검색으로 확인).
> 모든 쓰기는 SECURITY DEFINER RPC 를 통해서만 이루어진다.

---

## 1. 변경 파일 목록 (Changed File List)

ALGO-8A 6개 변경 후보를 적용할 때 손대야 하는 **실제 Runtime 파일**. (본 Phase 는 목록만 — 수정하지 않음)

### SQL / DB (신규 additive migration 로만 적용 — 기존 파일 수정 금지, `CREATE OR REPLACE`)

| # | 파일 | 대상 객체 | 변경 후보 |
|---|---|---|---|
| S1 | `supabase/migrations/0412_streaming_v2_foundation.sql` (원본 — **수정 금지**, 신규 migration 에서 `CREATE OR REPLACE`) | `record_stream_event_v2` (259-329) | verified_seconds_backfill, verification_timing, session_identity_normalization |
| S2 | 〃 | `verify_stream_heartbeat_v2` (226-257) | verification_timing, verified_seconds_backfill |
| S3 | 〃 | `_v2_resolve_player_type` (187-204) | session_identity_normalization |
| S4 | 〃 | `v2_verified_streams` (123-128) | verified_seconds_backfill (view 경로 옵션) |
| S5 | 〃 | `v2_eligible_streams` (130-137) | session_identity_normalization, eligible_generation |
| S6 | 〃 | `v2_settlement_eligible_streams` (139-141) | settlement_shadow_linkage |
| S7 | `supabase/migrations/0420_settlement_v2_shadow.sql` | `admin_generate_monthly_settlement_v2` (178-181 join) | settlement_shadow_linkage |
| S8 | **신규** `supabase/migrations/0447_runtime_apply_streaming_fix.sql` (적용 Phase 에서 생성) | back-fill 함수/스케줄 or trigger, 상기 `CREATE OR REPLACE` 묶음 | 전체 |

### Client / TypeScript

| # | 파일 | 대상 | 변경 후보 |
|---|---|---|---|
| C1 | `src/lib/streamingV2Api.ts` | `resolvePlayerType()` (35-43), `recordStreamEventV2` (90-121), `V2PlayerType`(32)/event union(92) | session_identity_normalization |
| C2 | `src/components/player/Player.tsx` | play_completed emit (onEnded, 2283/2324), play_30s emit (1044-1067), heartbeat interval (1078-1095) | user_milestone_completion, verification_timing |

> **React Flow 영향:** 실제 사용자 재생 → `Player.tsx`(4 emit site) → `streamingV2Api.ts`(safeRecordStreamV2/safeHeartbeatV2)
> → RPC(`record_stream_event_v2`/`verify_stream_heartbeat_v2`). 클라이언트는 `verified_seconds`를 계산하지 않고
> `listenedSeconds`(client-reported)만 전송하므로, **verified 판정 로직은 100% 서버측**이다. 따라서 대부분의 변경은
> SQL 측(S1~S6)에서 이루어지며, 클라이언트 변경(C1~C2)은 identity 정규화·completion 보장 목적으로 선택적이다.

---

## 2. 변경 함수 목록 (Changed Function List)

변경 후보별 **정확한 함수·뷰·라인**과 적용 방식.

### 2-1. `verified_seconds_backfill` (impact 0.9)
- **핵심:** milestone 행의 `verified_seconds`/`heartbeat_verified`를 세션 확정값으로 back-fill.
- **적용 옵션 A (권장, view-side, 최소 침습):** `v2_verified_streams`(S4)를 `stream_ingest_v2 i`에
  `stream_sessions_v2 s` LEFT JOIN 으로 재작성하여 판정을 `coalesce(s.verified_seconds, i.verified_seconds)`
  기반으로 변경. 이벤트 행 자체는 불변(읽기 전용 보정) → append-only 원칙 유지, rollback 은 view 복원만.
- **적용 옵션 B (write-side):** 신규 back-fill 함수 `backfill_stream_verified_v2(session_token)`를 만들어
  `verify_stream_heartbeat_v2`(S2) 끝에서 호출하거나 스케줄로 실행 → `stream_ingest_v2`의 play_30s 행
  `verified_seconds/heartbeat_verified` UPDATE. (이벤트 원본 수정 → 감사/append-only 영향 큼, 비권장)
- **결정론적 근거:** ALGO-2E calibration 후보 verified 0→8, ALGO-8A success target `verified~8`.

### 2-2. `verification_timing` (impact 0.8)
- **핵심:** heartbeat 확정 후 verified 판정. `record_stream_event_v2`(S1)의 스냅샷 조기 동결 제거.
- **적용:** 옵션 A 채택 시 timing 문제는 view join 으로 자동 해소(판정 시점 = 조회 시점).
  옵션 B 채택 시 `verify_stream_heartbeat_v2`(S2)에서 `verified_seconds>=30` 도달 시 해당 세션의 play_30s 행을 갱신.

### 2-3. `session_identity_normalization` (impact 0.85)
- **핵심:** milestone `player_type`을 세션(authoritative) 기준으로 정규화.
- **적용 옵션 A (view-side):** `v2_eligible_streams`(S5)의 `player_type NOT IN (…)` 를
  `coalesce(s.player_type, i.player_type)` 기반으로 변경(S4 join 활용).
- **적용 옵션 B (write-side):** `record_stream_event_v2`(S1)에서 세션 존재 시 `v_ptype := coalesce(session.player_type, resolved)`.
- **적용 옵션 C (client):** `resolvePlayerType()`(C1) downgrade 규칙을 세션 시작값과 일치시킴.
- **근거:** ALGO-8A identity_mismatch 20→0.

### 2-4. `user_milestone_completion` (impact 0.7)
- **핵심:** USER `play_completed` 이벤트 확정 경로 확보.
- **현황:** `Player.tsx` onEnded(2283→2324)에서 이미 emit 하지만 자연 종료에만 발생 → 프로덕션 USER play_completed=0.
- **적용:** (선택) skip/next 전환 시에도 completion 계열 이벤트 기록, 또는 verified 판정을 completion 비의존(2-1 옵션 A)으로 전환하여 completion 미발생이 verified 를 막지 않도록 함.

### 2-5. `eligible_generation` (impact 0.75)
- **핵심:** verified 확정 후 eligible funnel 자동 생성.
- **적용:** `v2_eligible_streams`는 `v2_verified_streams` 위 **파생 view** 이므로 2-1(verified 회복) 적용 시
  **추가 코드 없이** eligible 자동 생성. S5 는 identity 정규화(2-3)만 반영하면 됨. success target eligible 0→1.

### 2-6. `settlement_shadow_linkage` (impact 0.6)
- **핵심:** eligible → settlement candidate 연결.
- **현황:** `v2_settlement_eligible_streams`(S6) + `admin_generate_monthly_settlement_v2`(S7, `p_stream_source='v2_shadow'` 경로)가 **이미 배선**됨.
- **적용:** 추가 코드 없이 eligible 회복(2-5)에 의존. 검증만 필요. success target settlement 0→1.

> **의존 순서(ALGO-8A Dependency Graph 와 일치):**
> `verified_seconds_backfill`(+`verification_timing`) → `session_identity_normalization` → `eligible_generation` → `settlement_shadow_linkage`.
> `user_milestone_completion`은 verified back-fill 에 종속(옵션 A 채택 시 비차단).

---

## 3. 영향도 (Impact Analysis)

| 변경 | Blast radius | 영향받는 read 경로 | 실 정산/차트 영향 | 회귀 위험 |
|---|---|---|---|---|
| verified_seconds_backfill (opt A: view) | `v2_verified_streams` 및 그 파생(eligible/settlement/reconciliation) | 관리자 대시보드, `admin_stream_v2_overview`(0413), `v2_shadow_reconciliation` | **없음** (view 는 shadow 전용, v1 `stream_events`/실정산 미참조) | 낮음 — 이벤트 원본 불변 |
| verification_timing | 상동(opt A) / `stream_ingest_v2` 행(opt B) | 상동 | 없음 | 낮음(A)/중간(B, 원본 UPDATE) |
| session_identity_normalization | `v2_eligible_streams` 및 파생 | 상동 + player_type breakdown | 없음 | 낮음 |
| eligible_generation | 파생 view only (코드 변경 없음) | 상동 | 없음 | 매우 낮음 |
| user_milestone_completion | `Player.tsx` emit(클라이언트) | 없음(shadow ingest 만 증가) | 없음 | 낮음 |
| settlement_shadow_linkage | `v2_settlement_eligible_streams`, `admin_generate_monthly_settlement_v2`(v2_shadow 경로만) | shadow settlement 리포트 | **없음** (v1 경로 `p_stream_source<>'v2_shadow'` 불변, 실 지급 미연결) | 낮음 |

**불변 보장 (ALGO-8A Regression 기준):**
- v1 `stream_events`(≈48,333), `record_stream_event_safe`(v1), 실 정산/차트/추천/재생 Runtime — **전부 미접촉**.
- `admin_settings.streaming_v2_shadow_enabled` 플래그 게이팅 유지(flag OFF ⇒ 신규 ingest 없음).
- `eligible_settlement_tracks`(1,147행) 읽기 전용 유지.
- **핵심:** funnel view 는 shadow-only 이며 실 매출 경로와 물리적으로 분리 → verified/eligible 이 0→N 이 되어도 실 지급/차트 0 영향.

---

## 4. Rollback Plan

각 변경은 additive `CREATE OR REPLACE`(신규 migration 0447)로 적용하므로, rollback = **직전 정의로 `CREATE OR REPLACE` 재적용**.

| 변경 | Rollback 방법 | Rollback 대상 | 소요 | 검증 |
|---|---|---|---|---|
| verified_seconds_backfill (opt A) | `v2_verified_streams`를 0412 원본 정의로 `CREATE OR REPLACE` | 1 view | ~5m | `v2_verified` 카운트가 이전(0)으로 복귀 확인 |
| verification_timing | opt A: view 복원 / opt B: back-fill 함수 DROP + 세션-스냅샷 로직 복원 | 1 view or 1 func | ~5m/~15m | 신규 milestone `heartbeat_verified` 동결 재현 확인 |
| session_identity_normalization | `v2_eligible_streams`(+`_v2_resolve_player_type`/`recordStreamEventV2` opt B/C) 원본 복원 | 1 view (+선택 func/client) | ~5m | eligible 제외 규칙 원복 |
| eligible_generation | (파생 view — 별도 rollback 없음, verified rollback 에 종속) | — | — | verified rollback 시 자동 |
| user_milestone_completion | `Player.tsx` emit diff revert + 재배포 | 1 client file | ~15m | completion emit 사이트 원복 |
| settlement_shadow_linkage | (배선 기존 — 신규 없음, eligible rollback 에 종속) | — | — | v2_shadow settlement 카운트 0 복귀 |

**공통 롤백 전제(ALGO-8A `runtime_rollback_readiness` 기준):**
- pre-apply snapshot(view 정의 + funnel 카운트) 확보 → post-apply verify → rollback verify 3-checkpoint.
- owner: runtime-oncall. 전 구간 **feature flag(`streaming_v2_shadow_enabled`) OFF 로 즉시 무력화 가능**
  (flag OFF ⇒ 신규 ingest 중단, 기존 view 는 조회만).
- **실 정산 무연결**이므로 rollback 은 shadow 리포트 수치 복귀만 의미 — 사용자 영향 0.

---

## 5. Test Matrix

| 영역 | 테스트 | 방식 | 성공 기준(ALGO-8A success_criteria) | 실패 기준(ALGO-8A failure_criteria) |
|---|---|---|---|---|
| verified | rollback-txn 에서 view 재정의 후 `count(v2_verified_streams)` | `BEGIN; CREATE OR REPLACE VIEW…; SELECT count; ROLLBACK;` | `verified > 0` (target ≈8) | verified 감소 |
| eligible | 상동 파생 count | 〃 | `eligible > 0` (target ≈1) | eligible 감소 |
| settlement | `count(v2_settlement_eligible_streams)` + `admin_generate_monthly_settlement_v2(p_stream_source='v2_shadow')` rollback-txn | 〃 | settlement candidate 생성(≈1) | — |
| identity | `count where session.player_type='USER' AND milestone player_type<>'USER'` → 정규화 후 0 | 〃 | identity_mismatch → 0 | — |
| v1 불변 | `count(stream_events)` before/after | 읽기 | `no regression` (=48,333 유지) | v1 카운트 변화 |
| fraud | `count(fraud_score>=60)` | 읽기 | `no fraud spike` (=0) | fraud 증가 |
| incident | AI Operations incident delta | 읽기 | `no incident increase` | incident 증가 |
| playback | 재생 시작/30s/완료/heartbeat emit 회귀 | E2E(Player) | playback 정상 | playback_error_rate↑ |
| queue | 큐 진행 무영향 | E2E | queue 정상 | queue_error_rate↑ |
| latency | RPC p95 | 관측 | latency 유지 | p95 > 200ms |
| rollback | 각 변경 rollback 후 원상 복귀 | rollback-txn | 이전 수치 복귀 | 복귀 실패 |

> 모든 테스트는 **`BEGIN … ROLLBACK` 트랜잭션** 또는 **flag-OFF 관찰**로 수행하며, 실제 커밋/적용은 하지 않는다(현 Phase).

---

## 6. Production Apply Sequence

ALGO-8A `runtime_safe_apply_plan`(Stage 0~5)에 매핑. **Stage 2 이후는 blocked — 후속 Phase(human approval + governance pass) 대상.**

```
Stage 0 · Dry Run                [available]  본 명세(ALGO-8B) — 대상 코드 100% 식별, 영향/rollback/test 문서화
   ↓
Stage 1 · Internal Shadow        [available]  현행 ALGO-2E~8A — shadow 테이블에서 verified 후보(0→8) 재현·검증 완료
   ↓  (gate: shadow calibration 통과)
Stage 2 · Synthetic Validation   [blocked]    합성 세션(play_started→heartbeat×N→play_30s→play_completed)으로
                                              view opt A 재정의 후 funnel 무결성 검증 (rollback-txn)
   ↓  (gate: human review 시작)
Stage 3 · Limited Runtime Cand.  [blocked]    신규 migration 0447 로 view 3종 CREATE OR REPLACE (opt A, view-side only,
                                              이벤트 원본 불변) — 제한 관찰. 선행: human approval + rollback ready
   ↓  (gate: governance pass + no regression)
Stage 4 · Canary Candidate       [blocked]    ALGO-7D Canary Simulator 실측 연동 — max_safe_stage 이내 관찰
                                              선행: governance_gate=pass, canary certificate
   ↓  (gate: safety gate pass)
Stage 5 · Production Candidate    [blocked]    전체 checklist ready + success criteria met → 실 funnel 반영 검토
                                              (여전히 실 정산 연결은 별도 결정)
```

**적용 원칙(불변):**
1. 기존 migration 파일 **수정 금지** — 신규 `0447_*` additive migration 에서 `CREATE OR REPLACE`.
2. **view-side(opt A) 우선** — 이벤트 원본(`stream_ingest_v2`) 불변 → append-only·감사 안전, rollback 은 view 복원만.
3. 전 단계 **flag(`streaming_v2_shadow_enabled`) OFF 즉시 무력화** 가능.
4. 각 Stage 전 pre-snapshot, 후 verify, 실패 시 즉시 rollback.
5. 실 정산/차트/추천/재생 Runtime 은 **어느 Stage 에서도 미접촉** — shadow funnel 회복까지만.

---

## 부록 A — 대상 객체 색인 (Object Index)

| 객체 | 종류 | 정의 위치 | 유효 정의 |
|---|---|---|---|
| `record_stream_event_v2` | RPC (ingest) | `0412:259-329` | 유일/최신 |
| `start_stream_session_v2` | RPC (session) | `0412:209-224` | 유일 |
| `verify_stream_heartbeat_v2` | RPC (heartbeat) | `0412:226-257` | 유일 |
| `_v2_resolve_player_type` | helper | `0412:187-204` | 유일 |
| `v2_verified_streams` | view | `0412:123-128` | 미재정의 |
| `v2_eligible_streams` | view | `0412:130-137` | 미재정의 |
| `v2_settlement_eligible_streams` | view | `0412:139-141` | 미재정의 |
| `v2_shadow_reconciliation` | view | `0412:144-182` | 유일 |
| `admin_generate_monthly_settlement_v2` | RPC (settlement) | `0420:137-298` (join 178-181) | 유일 |
| `admin_stream_v2_overview` | RPC (admin read) | `0412:354-388` → `0413:18` | **최신=0413** |
| Trigger on ingest/session tables | — | **없음** | — |
| `resolvePlayerType` | client fn | `src/lib/streamingV2Api.ts:35-43` | — |
| `recordStreamEventV2` / `safeRecordStreamV2` | client API | `streamingV2Api.ts:90-121 / 145-162` | — |
| `verifyStreamHeartbeatV2` / `safeHeartbeatV2` | client API | `streamingV2Api.ts:123-139 / 165-175` | — |
| Player emit: play_started/play_30s/play_completed/heartbeat | React | `Player.tsx:949 / 1063 / 2324 / 1082-1095` | — |
| `V2PlayerType` / event_type union | type | `streamingV2Api.ts:32 / 92` | — |

## 부록 B — 금지 사항 재확인

Queue·Playback·Scheduler·Streaming Runtime·Settlement·Prediction·RL·Decision·Governance 변경 금지 ·
Production Apply·Canary·Release·Rollback·Policy Apply·자동 승인 금지 · 기존 migration 파일 수정 금지 ·
**본 Phase 는 코드/스키마를 일절 수정하지 않는다 — 명세 문서만 생성한다.**
