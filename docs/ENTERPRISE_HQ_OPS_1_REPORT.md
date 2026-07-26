# ENTERPRISE-HQ-OPS-1 — Headquarters Franchise Operations Center 완료 보고

> 코드/DB 실측 기준. 추측 없음. Production 미변경 (migration 파일만 추가).
> 작업일: 2026-07-24 · 브랜치: `claude/enterprise-audit-report-aufypa`

---

## 1. Heartbeat 원인 분석 (실측 확정)

`store_policy_sync_status` 실제 컬럼을 확인한 결과:

- 테이블 정의(`0349:176`) + 확장 컬럼(`0353`/`0355`) 어디에도 **`last_heartbeat_at` 컬럼이 존재하지 않음.**
  실제 timestamp 컬럼: `last_synced_at`, `last_seen_at`, `last_policy_sync_at`, `current_track_started_at`, `created_at`, `updated_at`.
- `store_heartbeat` RPC(`0355`)는 `last_seen_at` / `last_synced_at` / `updated_at` 를 **서버 `now()`** 로 기록. → `last_seen_at` 자체는 정확했다 (heartbeat 만 갱신).
- 결함 ①: `store_now_playing` view(`0356`/`0357`)가 `ss.updated_at as last_heartbeat_at` 로 **alias**. 그런데 `updated_at` 은 `_touch_updated_at` 트리거로 **모든 UPDATE 에서** 갱신되고, `admin_force_store_resync` / `hq_force_store_resync` 는 `set last_policy_sync_at = null, updated_at = now()` 로 **heartbeat 없이** `updated_at` 을 올린다. → resync 만 해도 `last_heartbeat_at` 이 최신으로 튄다 (오탐).
- 결함 ②: `_noc_store_health_score`(`0385:103`)는 `select ... last_heartbeat_at ... from store_policy_sync_status` 로 **존재하지 않는 테이블 컬럼**을 직접 조회 (latent 결함).

3개 리더가 서로 다른 기준 사용: `updated_at` alias(view) · 없는 raw 컬럼(health) · `last_seen_at`(is_online flag). → **View/Table 불일치 확정.**

## 2. 수정 내용

- 전용 실제 컬럼 `last_heartbeat_at timestamptz` 도입 → `store_heartbeat` 만 `now()` 로 기록 (resync 오염 원천 차단).
- 표준 판정 함수 `_store_heartbeat_state()`: **ONLINE(≤5m) · DEGRADED(≤15m) · STALE(≤24h) · OFFLINE(>24h) · UNKNOWN(null)** — 단일 진실 소스.
- 미래/역행 timestamp 차단: heartbeat 수신시각은 서버 `now()` 로만, `on conflict` 시 `greatest(기존, now())` 로 역행 불가. client `current_track_started_at` 미래값은 `now()` 로 클램프.
- 중복/동시 요청 안전: 기존 `on conflict (store_id) do update` 유지 (매장당 1행 upsert).
- `store_now_playing` / `store_monitoring_status` view 를 실제 컬럼 기준으로 재정의 + `heartbeat_state` 표준 컬럼 노출. `is_online` 을 `last_heartbeat_at` 기준으로 통일 (Store Health 와 동일 기준).
- `_noc_store_health_score` 를 실제 컬럼 참조로 정정 (점수 규칙/가중치 무변경 — `last_heartbeat_at == last_seen_at` 보장으로 회귀 0).

## 3. DB / RPC 변경 (migration 파일)

**`0456_hq_ops_heartbeat_accuracy.sql`**
- `alter table ... add column last_heartbeat_at` (idempotent) + 백필(`coalesce(last_seen_at, updated_at)`) + 인덱스.
- `_store_heartbeat_state(timestamptz)` (stable) 신규.
- `store_heartbeat(...)` 재정의 (시그니처/보안 불변).
- `store_monitoring_status` / `store_now_playing` view 재정의(drop+create — 의존 view 없음 확인).
- `_noc_store_health_score(uuid)` 재정의.

**`0457_hq_ops_fleet_center.sql`**
- `_store_operational_status(...)` (immutable): **HEALTHY/WARNING/CRITICAL/OFFLINE/UNKNOWN + reasons[]** 표준 판정 (서버 단일 소스).
- `get_my_enterprise_ops_fleet(...)`: HQ 스코프 통합 KPI(8종) + 페이지네이션 매장 목록. 단일 RPC(N+1 없음), billing/contract 는 enterprise 단위 1회 계산 후 부착.
- `get_my_enterprise_ops_store_detail(uuid)`: Overview/Playback/Health/Billing/Device 상세 (소유 검증).

## 4. UI 구현

- `src/lib/hqOpsFleet.ts` — 순수 표시 유틸/타입(Supabase 비의존, 단위테스트 대상). 상태 라벨/tone, D-Day, 상대시간, 부재표기(`미지원`/`데이터 없음`/`수집 전`), 서버 상태 정규화(재계산 아님).
- `src/lib/api/enterpriseHqOpsFleetApi.ts` — RPC wrapper + 타입.
- `src/pages/EnterpriseOpsStoresPage.tsx` — `/enterprise/operations/stores` (KPI 8 + 필터 + 검색 + 페이지네이션 + 매장 행).
- `src/pages/EnterpriseOpsStoreDetailPage.tsx` — `/enterprise/operations/stores/:storeId` (5개 섹션).
- `src/App.tsx` — 라우트 2개(lazy) 추가. `EnterpriseHqMePage` 에 진입 CTA 카드 추가.
- **미구현 데이터는 구현된 것처럼 표시하지 않음**: Queue/다음곡·Scheduler 상세·Streaming Quality·Heartbeat Timeline·매장별 재생량은 상세에서 "현재 미지원" 배너로 명시. Store Code 는 스키마에 없어 "미지원" 표기.

## 5. 권한 및 보안

- 신규 RPC 전부 `SECURITY DEFINER` + `set search_path to 'public'` + `revoke execute from public, anon` + `grant to authenticated`.
- HQ 스코프: `_hq_current_enterprise_account_id()`(auth.uid → enterprise_accounts) 게이트, 아니면 `forbidden` 예외. 상세는 `_hq_owns_store()` 소유 검증 → 타 Enterprise 매장 접근 차단.
- 입력 검증(`store_id` null 체크) + Pagination 강제(limit 1..200 clamp, offset ≥ 0).
- 기존 RPC 보안 정책 **약화 없음**, DEFINER/RLS 우회 없음. 클라이언트 상태 재계산 없음(서버 판정만 표시).

## 6. 테스트 결과

- 단위 테스트 신규 `src/lib/hqOpsFleet.test.ts` (13 tests): 부재표기, D-Day 경계, 상태 정규화 폴백, heartbeat 정규화, 상대시간.
- `npm test` → **8 files, 141 tests PASS** (기존 128 + 신규 13).
- `npm run lint` (eslint --max-warnings=0) → **PASS**.
- `npm run lint:migrations` → **PASS** (0 violations).
- `npm run build` (lint && tsc -b && vite build) → **PASS** (exit 0).
- DB 실행 검증은 미수행 (아래 §9 참조).

## 7. 기존 기능 회귀 결과

- Playback / Queue / Scheduler / Crossfade / 정산 계산 / Invoice 계산 로직 **무변경** (파일 미터치).
- Brand Player / Store Player 관련 파일 미변경. 기존 브랜드/재생 단위테스트 전부 통과.
- 기존 `store_now_playing` / `store_monitoring_status` 소비 RPC(0401/0376/0385)는 컬럼명 동일 유지 → 계약 불변. `last_heartbeat_at` 은 이제 실제 heartbeat 를 반영(정확도 향상), 값 형태 동일.
- `_noc_store_health_score` 점수 규칙 무변경.

## 8. 발견된 추가 이슈

- `store_heartbeat` 는 heartbeat 이력을 남기지 않고 현재 상태 1행만 upsert → **Heartbeat/Online 이력 Timeline** 은 데이터 소스 부재(상세에서 "미지원" 표기). 이력 테이블은 별도 Phase 필요.
- 매장별 Store Code 컬럼이 스키마에 없음(enterprise 단위 `store_invite_code` 만 존재). → "미지원".
- billing/contract 는 enterprise 단위(매장 공유) → 매장 행에 동일 값 부착(라벨 명시). 매장별 개별 청구는 스키마상 불가.
- heartbeat 미수신 매장(= `store_policy_sync_status` 행 없음)은 목록/상세 미표시 — 기존 ops 동작과 동일(회귀 아님).

## 9. Preview 검증 필요 항목

- **migration 0456/0457 실 DB 적용** (Test/Preview 환경): `check_function_bodies` 하에 `_noc_store_health_score` 가 실제로 재생성되는지, view drop+create 가 의존성 없이 통과하는지 확인. (정적 검토·dollar-quote 균형·lint 통과했으나 서버 미실행.)
- HQ 로그인 계정으로 `/enterprise/operations/stores` KPI/목록/필터/검색/페이지네이션, 상세 5섹션, 타 Enterprise 매장 접근 차단(forbidden) 실 확인.
- resync 후 `last_heartbeat_at` 이 튀지 않는지(핵심 결함 수정) 실측.

## 10. 다음 Phase 제안

1. Heartbeat 이력 테이블 + Online/Health Timeline (상세 "미지원" 해소).
2. NOC 알림 실발송(Slack/Discord/Email) — 현재 config-only.
3. 자동결제(PG) + 연체/정산 자동 배치(cron).
4. Queue/다음곡·Scheduler 상세·Streaming QoS 수집(플레이어 telemetry 확장).
5. HQ 세분 RBAC + 멀티유저 HQ.

---

## 완료 기준 점검

| 기준 | 결과 |
|---|---|
| Heartbeat 저장 흐름 실제 확인 | ✅ (§1) |
| `last_heartbeat_at` 정확성 보장 | ✅ 전용 컬럼 + heartbeat-only 기록 |
| 본사 가맹점 통합 목록 구현 | ✅ `/enterprise/operations/stores` |
| Online/Offline 실제 데이터 | ✅ heartbeat_state |
| 현재 재생 곡 실제 데이터 | ✅ store_now_playing |
| 계약·미납 상태 실제 데이터 | ✅ enterprise billing/contract |
| 타 Enterprise 접근 차단 | ✅ `_hq_owns_store` |
| Typecheck | ⚠️ `tsc -b` PASS. `npm run typecheck` 스크립트는 **기존** tsconfig `baseUrl` deprecation(TS5101, clean HEAD 에도 존재, 본 작업 무관) 1건 출력 |
| ESLint / Unit Test / Build | ✅ 전부 PASS |
| Production 변경 없음 | ✅ migration 파일만 |
| 미구현을 구현된 것처럼 표시 안 함 | ✅ "미지원"/"데이터 없음"/"수집 전" |
