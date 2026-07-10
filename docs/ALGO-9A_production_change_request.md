# ALGO-9A — Production Change Request & Execution Plan

> **Phase 성격:** 운영 승인 문서(CR) 작성 · 적용 절차 확정 · 실행 체크리스트 확정 **전용**.
> **코드/스키마 무수정 · Migration 없음 · 실제 Apply 없음.**
>
> 본 문서는 0447/0448 Runtime Fix 를 Production 에 적용하기 위한 최종 Change Request 다.
> 실제 적용은 승인(ALGO-8F authorization=authorized) + 명시적 실행 승인이 확인된 뒤 별도 실행 Phase 에서만 수행한다.

---

## 0. 근거 요약 (선행 Phase)

| Phase | 산출물 | 검증 결과 |
|---|---|---|
| ALGO-8B | Runtime Apply Spec (`docs/ALGO-8B_runtime_apply_spec.md`) | 대상 코드 100% 식별 (view-side opt A 권고) |
| ALGO-8C | `0447_streaming_v2_verified_view_fix.sql` (PR #321) | rollback-txn: verified **0→8** |
| ALGO-8D | `0448_streaming_v2_identity_view_fix.sql` (PR #322) | rollback-txn: eligible **0→8** · settlement **0→8** |
| ALGO-8E | `0449` Governance Gate (PR #323) | gate=**needs_human_approval** · append-only 강제 |
| ALGO-8F | `0450` Authorization Workflow (PR #324) | 3of4 정책 authorized 검증 · append-only |
| ALGO-8G | `0451` Apply Rehearsal (PR #325) | dry-run: verified/eligible/settlement **0→10** · live view 불변 |

> 회복치는 organic shadow 트래픽 누적에 따라 8→10 으로 증가(재현 재실행 시 갱신). 본 CR 의 기대치는 **최소 verified≥1·eligible≥1·settlement≥1**, 관측 시점 실측으로 확정한다.

---

## 1. Production Change Request

| 항목 | 내용 |
|---|---|
| **Change ID** | `CR-STREAMING-V2-VIEWFIX-0447-0448` |
| **대상 Migration** | `0447_streaming_v2_verified_view_fix.sql` · `0448_streaming_v2_identity_view_fix.sql` |
| **변경 종류** | `CREATE OR REPLACE VIEW` (view-side only) — `v2_verified_streams`, `v2_eligible_streams` |
| **목적** | play_30s milestone 의 verified_seconds/heartbeat freeze 및 session identity mislabel 로 인한 shadow funnel 병목(verified=0·eligible=0) 해소 |
| **기대 효과** | `v2_verified_streams` 0→N · `v2_eligible_streams` 0→N · `v2_settlement_eligible_streams` 0→N (session-authoritative 판정) |
| **위험도** | **낮음** — view 정의만 교체, 원본 이벤트/세션 row 무수정, 실 정산/차트/재생 경로와 물리 분리(shadow-only) |
| **영향 범위** | `v2_verified_streams`, `v2_eligible_streams`, `v2_settlement_eligible_streams`, `v2_shadow_reconciliation`, 관리자 대시보드(`admin_stream_v2_overview`). **v1 `stream_events`/실 정산/차트/재생/Queue/Scheduler 무영향** |
| **승인자** | AI Owner · Streaming Owner · Backend Owner · Operations Owner (정책 **3 of 4**, ALGO-8F) |
| **예정 시간** | TBD (승인 완료 후 저트래픽 구간 지정) |
| **예상 소요시간** | Apply ~2m (view 2건 교체) · Validation ~3m · 총 ~5m + Observation 24h |
| **적용 방식** | 신규 additive migration 로 `CREATE OR REPLACE VIEW` (기존 0447/0448 파일 그대로 적용) |
| **Feature Flag** | `streaming_v2_shadow_enabled` — 이상 시 OFF 로 신규 ingest 즉시 중단 가능 |

---

## 2. Execution Sequence (실행 순서 — 확정)

```
Step 0 · 사전 Snapshot        pre-apply baseline 캡처 (verified/eligible/settlement/fraud/dispute/ingest/sessions/v1)
   ↓
Step 1 · 0447 Apply           0447_streaming_v2_verified_view_fix.sql 적용 (v2_verified_streams 재정의)
   ↓
Step 2 · Validation           select count(*) from v2_verified_streams;              → > 0 확인
   ↓
Step 3 · 0448 Apply           0448_streaming_v2_identity_view_fix.sql 적용 (v2_eligible_streams 재정의)
   ↓
Step 4 · Validation           select count(*) from v2_eligible_streams;              → > 0 확인
                              select count(*) from v2_settlement_eligible_streams;   → > 0 확인
                              Regression: ingest/sessions/stream_events/playback/playlist_tracks delta = 0
   ↓
Step 5 · Observation          T+0 ~ T+24h 관찰 (§5)
   ↓
Step 6 · 완료 또는 Rollback 판단   Go/No-Go(§3) + Rollback Criteria(§4) 기준 최종 결정
```

**순서 변경 금지.** 각 Step 은 이전 Step 의 Validation 통과를 전제로 진행한다.

---

## 3. Go / No-Go Criteria

### ✅ Go (적용 유지)
- Validation Pass: `v2_verified_streams > 0` **AND** `v2_eligible_streams > 0` **AND** `v2_settlement_eligible_streams > 0`
- Regression 없음: `stream_ingest_v2` · `stream_sessions_v2` · `stream_events` · `playback_events_v2` · `playlist_tracks` row count **delta = 0**
- Fraud 증가 없음: `count(fraud_score>=60)` 불변
- Playback 이상 없음: playback error rate 불변 · v1 `stream_events` 불변(organic 제외)

### ⛔ No-Go (적용 중단 → Rollback)
- Validation Fail: verified/eligible/settlement 중 하나라도 0 또는 예상 대비 급감
- Regression 발생: 원본 row count 변화 또는 v1 오류
- Incident 증가: AI Operations incident 신규 발생
- Fraud Spike: `fraud_score>=60` 또는 dispute 대상이 eligible 로 유입

---

## 4. Rollback Criteria & SQL

### Rollback 조건 (하나라도 충족 시)
- `v2_verified_streams` 감소 (적용 후 이전보다 낮음)
- `v2_eligible_streams` 감소
- `v2_settlement_eligible_streams` 감소
- Playback regression (error rate 상승)
- Fraud spike (`fraud_score>=60` 증가 또는 fraud/dispute 대상 eligible 유입)
- Latency 증가 (view 조회 p95 > 200ms)
- genuine ineligible(unreleased/muted/low_volume) 무력화 또는 preview→USER 오정규화 탐지
- join fan-out (verified > play_30s row count) 또는 duplicate session_token 결과

### Rollback 순서 (역순: 0448 → 0447)

**Step 1 — 0448 원복 (v2_eligible_streams → 0412 원본)**
```sql
create or replace view public.v2_eligible_streams as
select * from public.v2_verified_streams
where coalesce(player_volume, 1) >= 0.1
  and coalesce(player_muted, false) = false
  and ineligible_reason is null
  and player_type not in ('ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM')
  and coalesce(fraud_score, 0) < 60
  and dispute_status = 'none';
```

**Step 2 — 0447 원복 (v2_verified_streams → 0412 원본)**
```sql
create or replace view public.v2_verified_streams as
select * from public.stream_ingest_v2
where event_type = 'play_30s'
  and heartbeat_verified = true
  and coalesce(verified_seconds, 0) >= 30
  and coalesce(visibility_state, 'visible') = 'visible';
```

**Step 3 — Rollback Validation**
```sql
select count(*) from public.v2_verified_streams;              -- expect 이전 baseline(0) 복귀
select count(*) from public.v2_eligible_streams;              -- 파생 자동 복귀
select count(*) from public.v2_settlement_eligible_streams;   -- 파생 자동 복귀
select count(*) from public.stream_ingest_v2;                 -- delta 0 (원본 불변)
select count(*) from public.stream_events;                    -- v1 delta 0
```

- **Rollback Owner:** runtime-oncall · **예상 소요:** ~5m
- 파생 view(eligible/settlement)는 verified 원복 시 자동 복귀. 원본 row 무수정이므로 데이터 손실 없음.
- **즉시 무력화:** `streaming_v2_shadow_enabled = false` 로 신규 ingest 중단(기존 view 는 조회만).

---

## 5. Observation Plan

| 시점 | 확인 지표 |
|---|---|
| **T+0** | verified · eligible · settlement (Validation Pass 즉시 확인) |
| **T+5m** | verified/eligible/settlement 안정 · fraud/dispute 무증가 |
| **T+15m** | 상동 · playback error rate · latency |
| **T+30m** | 상동 · queue 정상 · incident 0 |
| **T+1h** | funnel 안정 추세 · v1 `stream_events` organic-only |
| **T+6h** | 누적 회복 추이 · identity_mismatch 잔여 |
| **T+24h** | 최종 안정 확인 → 완료 확정 또는 Rollback 판단 |

각 시점 체크리스트: `verified / eligible / settlement / identity_mismatch / fraud / dispute / playback_error / queue / latency / incident_count`. (관찰 계획만 — 예약/자동 실행 없음)

---

## 6. Success Report Template

```
Change ID : CR-STREAMING-V2-VIEWFIX-0447-0448
적용 일시 : ____________  (승인자: ____________)

┌─────────────────┬──────────┬──────────┬──────────┐
│ Metric          │ Before   │ After    │ Delta    │
├─────────────────┼──────────┼──────────┼──────────┤
│ Verified        │ 0        │ ____     │ ____     │
│ Eligible        │ 0        │ ____     │ ____     │
│ Settlement      │ 0        │ ____     │ ____     │
│ Regression(base)│ (count)  │ (count)  │ 0 (필수) │
│ Fraud ≥60       │ 0        │ ____     │ 0 (필수) │
│ Incident        │ 0        │ ____     │ 0 (필수) │
└─────────────────┴──────────┴──────────┴──────────┘

Identity mismatch 잔여 : ____   (0448 정규화 후 eligible 회복 확인)
Observation (T+24h)    : 안정 / 이상
Final Result           : ✅ 완료 유지  /  ⛔ Rollback 수행

비고 : ____________________________________________
```

---

## 7. Dashboard (기존 패널 재사용)

별도 신규 대시보드를 만들지 않는다 — 본 CR 의 표시 항목은 이미 구축된 관리자 패널로 렌더된다(운영 surface 중복 회피):

| CR 항목 | 렌더 패널 |
|---|---|
| Change Request · Execution Sequence | **Runtime Apply Gate** (ALGO-8E) — Apply Package·Order·Limited Apply Plan |
| Go / No-Go · Rollback Criteria | **Runtime Apply Gate** (ALGO-8E) — Success/Failure Criteria·Rollback Package |
| Observation | **Runtime Apply Rehearsal** (ALGO-8G) — Observation Procedure |
| Approval Status | **Runtime Authorization** (ALGO-8F) — Authorization Certificate·Vote |
| Validation (예행) | **Runtime Apply Rehearsal** (ALGO-8G) — Validation Pack |

---

## 8. Approval Status (현재)

- **ALGO-8E Governance Gate:** `needs_human_approval` (구조/안전 14/15 pass, human approval 미이행)
- **ALGO-8F Authorization:** 정책 **3 of 4** — 요청 생성 가능, 실제 승인은 4 Owner 의 명시적 vote 필요 (현재 미승인)
- **결론:** **적용 불가.** 4 Owner 중 3인 이상의 명시적 approve → authorization=`authorized` → 실행 승인 확인 후에만 §2 Execution Sequence 진행.

---

## 9. Regression (본 Phase)

- 코드/스키마 변경 없음(신규 md 1개만) · Migration 없음 · **운영 변경 없음**
- Production Apply / Runtime / Queue / Playback / Scheduler / Settlement v1 / Chart / Rollback / Canary **전부 없음**
- 기존 기능 100% 불변

---

## 10. 실제 적용 가능 여부 & 다음 Phase

**현 시점 적용 불가** (Approval 미완료). 후속:
- **ALGO-9B Human-Approved Production Apply** — 4 Owner 승인(authorized) + 명시적 실행 승인 확인 후, §2 Execution Sequence 를 실제 수행하고 §5 Observation 24h 관찰, §6 Success Report 작성. 이 단계가 8-series 전체에서 **처음이자 유일하게 실제 Production Apply 를 수행**하는 Phase이며, Go/No-Go·Rollback Criteria 로 통제된다.

본 Phase(ALGO-9A)는 CR 문서·절차·체크리스트 확정까지만 — 실제 Apply/Runtime 변경 없음(모든 금지 조건 준수).
