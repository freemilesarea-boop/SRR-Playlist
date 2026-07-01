# Phase 2-2 Kickoff — Quick Actions 활성화

Phase 2-1 (Enterprise Operations Center) 에서 `disabled` placeholder 로 배치된 6개
Quick Actions 버튼을 **실제 admin 조작으로 활성화** 하는 작업의 킥오프 계획서.

**⚠️ 상태**: **킥오프 (착수 승인 대기)**. 이 문서는 계획 검토용 — 코드/RPC 변경 없음.

---

## 배경 (Phase 2-1 완료 요약)

- **PR #234** merge (`8047bbc`), migration `0395` prod apply 완료 (2026-07-01)
- 6개 검증 통과: RPC 4개 존재 / SECURITY DEFINER / search_path=public / `_is_super_admin()` gate / authenticated grant / anon-public 없음
- UI: `/admin → 운영 관제 (Ops)` 탭에 Quick Actions 6개가 **전부 `disabled`** + "Phase 2-2 에서 활성화 예정" 배지
- 절대 무수정 원칙 준수 — 기존 cron / NOC / dispatch / 자동화 로직 무변경

---

## Phase 2-2 목표

6개 Quick Action 을 **`disabled` → 활성화** 하되:
1. 이미 존재하는 admin RPC / edge function / cron endpoint 를 **재사용** (신규 로직 최소)
2. 모든 mutation 은 **audit log 기록** + **confirmation dialog** 필수
3. 실패 시에도 시스템이 안정 — 부분 실패 허용, silent 실패 금지
4. Rate limit — 10초 debounce (버튼 spam 방지)

**절대 금지**:
- 기존 cron 스케줄 변경 / dispatch 로직 재작성 / NOC 탐지 알고리즘 수정
- 사용자가 실수로 대량 mutation 을 트리거할 수 있는 UI (예: 확인 없이 즉시 실행)

---

## 6개 Quick Action 별 세부 설계

| # | Button | 위험도 | 백엔드 | 신규 필요 | 설계 |
|---|--------|--------|--------|----------|------|
| **QA-1** | **Run Enterprise Cron** | 🟡 낮음 | `POST /api/cron/enterprise-ops` (기존, Bearer CRON_SECRET) | ❌ 신규 없음 | 서버 API route wrapper (`POST /api/admin/enterprise-ops-run`) — CRON_SECRET 을 서버 사이드에서 부착. Client 는 `admin` 세션으로만 호출. |
| **QA-2** | **Dispatch Pending** | 🟢 안전 | `functions/v1/dispatch-admin-notifications` (기존, `x-cron-secret` 또는 admin Bearer) | ❌ 신규 없음 | Client 에서 Bearer admin 토큰 + since_ts 24h 로 호출. 0392 멱등 컬럼이 이미 중복 방지 처리. |
| **QA-3** | **Recalculate NOC** | 🟢 안전 | `admin_noc_sync_alerts_to_notifications(int)` (0393) | ❌ 신규 없음 | authenticated + service_role grant 이미 있음. Client 에서 직접 RPC 호출. |
| **QA-4** | **Refresh Policy** | 🟡 낮음 | `admin_evaluate_policy_automation_rules({p_dry_run:false})` (0378) | ❌ 신규 없음 | `dry_run=false` 로 due 규칙만 실행 (next_run_at 전진 내장) |
| **QA-5** | **Generate Settlement** | 🔴 **높음** | `admin_generate_enterprise_monthly_settlement({p_month, p_enterprise_account_id})` (0372) | ⚠️ enterprise 선택 UI | 임의 트리거 위험 — **modal 로 대상 enterprise + 월 명시** 필수. 자유 실행 금지. |
| **QA-6** | **Export Logs** | 🟢 안전 | (없음) | ✅ **신규 admin RPC** `admin_enterprise_ops_export_logs(p_from, p_to, p_limit)` | JSON/CSV 로 admin_operation_logs (source=cron) 최근 N일 export |

---

## 아키텍처 원칙

### A. 서버 사이드 wrapper (QA-1, QA-6)

QA-1 (Run Enterprise Cron) 은 CRON_SECRET 이 필요하고, QA-6 (Export Logs) 는 페이지네이션이 필요.
브라우저에 CRON_SECRET 노출 금지. 신규 `api/admin/*` route 3개 (또는 필요한 만큼):

```
POST /api/admin/enterprise-ops-run   → CRON_SECRET 서버 부착 후 /api/cron/enterprise-ops 호출
GET  /api/admin/export-cron-logs?days=30  → admin RLS 검증 후 CSV/JSON 반환
```

**공통 인증**:
- Admin session cookie 검증 (RequireAdmin 서버판)
- 재검증: `_is_super_admin()` RPC 호출로 이중 확인
- Rate limit: 10초 debounce (in-memory)

### B. 클라이언트 직접 RPC (QA-2, QA-3, QA-4, QA-5)

기존 admin RPC 를 그대로 호출 — 이미 `_is_super_admin()` 게이트 존재.
`enterpriseOperationsApi.ts` 에 5개 wrapper 함수 추가:

```typescript
export async function runEnterpriseOpsCron(): Promise<...>;
export async function dispatchPendingNotifications(): Promise<...>;
export async function recalculateNoc(): Promise<...>;
export async function refreshPolicyAutomation(): Promise<...>;
export async function generateEnterpriseSettlement(input: {...}): Promise<...>;
export async function exportCronLogs(days: number): Promise<Blob>;
```

### C. UI 패턴 (신규 컴포넌트 없음, 기존 primitive 재사용)

```typescript
<AdminModal open onClose title="정말 실행할까요?">
  <p>이 작업은 X 을 즉시 실행합니다. 취소 불가.</p>
  <p>영향 범위: <b>{scope}</b></p>
  <AdminButton onClick={confirmMutation} tone="danger">실행</AdminButton>
</AdminModal>
```

각 버튼 클릭 → confirmation modal → 확인 시 mutation → 결과 toast (성공/실패 명확 구분).

### D. Audit log 필수

각 mutation 종료 시:
```sql
select public.admin_log_operation(
  'enterprise_operations', 'admin', 'success' or 'failed',
  'quick_action.run_cron' (or dispatch_pending/recalc_noc/...),
  <summary text>,
  jsonb_build_object('result', ...),
  auth.uid(), null, null, null, null
);
```

---

## 예상 변경 파일 (착수 승인 시)

| 파일 | 상태 | 라인 예상 |
|------|------|----------|
| `supabase/migrations/0396_enterprise_ops_export_logs_rpc.sql` (QA-6 신규 RPC) | 신규 | ~80 |
| `api/admin/enterprise-ops-run.ts` (신규 wrapper) | 신규 | ~50 |
| `api/admin/export-cron-logs.ts` (신규 export) | 신규 | ~40 |
| `src/lib/api/enterpriseOperationsApi.ts` | 수정 | +150 (6개 wrapper) |
| `src/components/admin/EnterpriseOperationsPanel.tsx` | 수정 | +200 (modal + confirmation + toast) |

총 예상: **5 파일, ~520 lines** (신규 3, 수정 2).

---

## 검증 계획 (착수 후)

| 단계 | 조치 |
|------|------|
| 1 | `npm run lint:migrations` + `npm run lint` + `typecheck` + `build` |
| 2 | 각 admin RPC BEGIN/ROLLBACK dry-run (특히 QA-5 Generate Settlement 는 실제 데이터 side effect 확인) |
| 3 | 로컬 vite dev 서버 실행 → Chromium 으로 super_admin 세션 → 각 버튼 클릭 → modal → confirm → 결과 확인 |
| 4 | audit log 6개 kind 별 row 생성 확인 |
| 5 | Rate limit 동작 확인 (연속 클릭 시 debounce) |

---

## 리스크 & 완화

| 리스크 | 완화 방안 |
|--------|----------|
| QA-1 (Cron) 이 실행 중일 때 재실행 → 이중 실행 | 서버 wrapper 에서 최근 실행 시각 확인 (1분 debounce) |
| QA-5 (Settlement) 이미 승인된 정산에 대해 실행 → 데이터 손상 | RPC 자체 idempotency + confirmation modal 명시 (`이미 존재하면 skip` 문구) |
| QA-6 (Export) 로 대용량 로그 → 서버 timeout | LIMIT 10000 + cursor pagination |
| Client 에서 admin 세션 만료된 상태로 클릭 → 401 silent | 401 응답 시 toast 로 로그인 안내 + 페이지 새로고침 유도 |
| 다중 super_admin 동시 클릭 → race condition | 개별 RPC 자체 lock / idempotency 재사용 (기존 로직 활용) |

---

## Phase 2-3 (후속) 후보 스코프 (Phase 2-2 밖)

이 작업 완료 후에도 남는 개선 여지:

- **Quick Actions 히스토리 카드** — 최근 N번의 admin 수동 조작 log
- **Confirmation UX 강화** — 최근 5초 내 재실행 방지 UI (client 시각 카운트다운)
- **Slack notification** — mutation 성공/실패를 Slack 로 자동 알림 (0392 dispatch 활용)
- **CSV export 확장** — announcement_play_logs / policy_automation_runs 등 다른 소스

---

## 결정 요청

이 계획으로 Phase 2-2 착수해도 될까요?

**Option A — 승인** → 위 5 파일을 `feat/enterprise-ops-quick-actions` 브랜치로 착수. 완료 후 PR + BEGIN/ROLLBACK dry-run + 리포트 → 승인 시 머지 → prod apply.

**Option B — 스코프 축소** → 예: QA-5 (Generate Settlement) 는 위험도가 높으니 Phase 2-3 로 미루고, 나머지 5개만 활성화. 알려주시면 그에 맞춰 재조정.

**Option C — 우선순위 재조정** → 이 계획서를 base 로 다른 순서/스코프 원하시면 편집 요청 주세요.

---

## 관련 문서

- `docs/PHASE1_DEPLOY_CHECKLIST.md` §12 (Phase 2 후보 우선순위)
- PR #234 (Phase 2-1 구현) — Quick Actions placeholder 위치
- Migration 0395 (Phase 2-1 신규 RPC 4개, prod 적용 완료)
