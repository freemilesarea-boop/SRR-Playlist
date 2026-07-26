# ENTERPRISE-HQ-OPS-1-VERIFY — Preview Migration & Runtime Verification 보고

> Test 환경(`SRR Playlist Test` / `haojpuhztegecbrwqorr`) 실 DB 적용 + 런타임 검증.
> Production(`nsoesrvwkxqifjcxzvol`) 무접촉·무변경. Synthetic 데이터만 사용, 검증 후 전량 정리.
> 검증일: 2026-07-24

## 1. Branch / Commit
- Branch: `claude/enterprise-audit-report-aufypa`
- 검증 대상 마이그레이션: `0456_hq_ops_heartbeat_accuracy.sql`, `0457_hq_ops_fleet_center.sql`
- 본 Phase에서 **런타임 결함 1건 수정** → 0457 재커밋 (아래 §10).
- Production Impact: **없음** (migration 파일 + Test DB 검증만; Test 객체는 검증 후 전량 drop).

## 2. Preview Deployment
- **NOT VERIFIED (BLOCKED)** — Vercel Preview 배포 + 브라우저 검증은 조직 egress 정책상 브라우저→Supabase 연결이 차단됨(`403 CONNECT policy denial`, 이전 QA 문서화 사실). 데이터플레인 접근 불가로 실브라우저 확인 불가. **정책 우회 금지 원칙에 따라 수행하지 않음.**

## 3. Migration 적용 결과 (Test DB)
| 단계 | 결과 |
|---|---|
| 대상 DB가 Production 아님 확인 | ✅ `haojpuhztegecbrwqorr` = "SRR Playlist Test" (repo 인증문서 + 별도 Production ref 확인) |
| 사전 스키마 부재 진단 | ✅ franchise/monitoring/enterprise-ops/billing 스택 전부 부재 → 충실 재현 harness 구축 |
| Prerequisites 적용 (실 migration에서 정확 추출한 DDL) | ✅ 의존순 적용, 오류 0 |
| **0456 적용 (unchanged)** | ✅ `last_heartbeat_at` 컬럼 생성, `store_now_playing`/`store_monitoring_status` view 재생성, `_noc_store_health_score` 재생성 — `check_function_bodies` 하 통과 (존재-컬럼 참조로 정정됨을 실증) |
| **0457 적용 (수정본)** | ✅ `_store_operational_status`, `get_my_enterprise_ops_fleet`, `get_my_enterprise_ops_store_detail` 생성. SECURITY DEFINER/search_path/grant 정상 |
| Dependency / Permission / RLS 오류 | ✅ 없음 |

## 4. Heartbeat Runtime 검증 (실 DB before/after)
| Test | 결과 | 근거 |
|---|---|---|
| A. 정상 heartbeat 갱신 | ✅ PASS | `last_heartbeat_at`·`last_seen_at`=서버 now(), state=`ONLINE` |
| B. 중복 heartbeat | ✅ PASS | 반복 호출에도 오류 0, 단일 행 유지(rows=1), timestamp 역행 없음 |
| C. 오래된 값 미덮어씀(monotonic) | ✅ PASS | 저장값을 미래로 세팅 후 heartbeat → `greatest()` 가드로 미하락(kept) |
| D. 미래 timestamp 차단 | ✅ PASS | `current_track_started_at`에 now()+10m 전달 → now()로 clamp |
| E. **강제 Resync가 heartbeat 미변경** | ✅ PASS | `admin_force_store_resync` 후 `last_heartbeat_at` before==after, `last_policy_sync_at`=null (핵심 결함 수정 실증) |

## 5. 상태 전환 검증
`_store_heartbeat_state`: ONLINE(30s)·DEGRADED(8m)·STALE(30m)·OFFLINE(30h)·UNKNOWN(null) — **5종 전부 ✅ PASS**.
`_store_operational_status`: OFFLINE→OFFLINE, ONLINE+정상→HEALTHY, ONLINE+연체→CRITICAL — **✅ PASS**.

## 6. Enterprise Scope 보안 검증 (Synthetic A/B, auth.uid() 시뮬레이션)
| Test | 결과 |
|---|---|
| A: 자기 매장 목록(total=2) + 상세 조회 | ✅ PASS |
| A: 계약(D-20 expiring)·미납/연체 인보이스 노출 | ✅ PASS |
| B: A 매장 상세 요청 → `forbidden: store … not in your brand` | ✅ PASS (차단) |
| B: fleet 격리(total=1, A 매장 미노출) | ✅ PASS |
| 일반 유저 fleet 호출 → `forbidden: not an enterprise HQ admin` | ✅ PASS (차단) |
| Store 계정 상세 호출 → forbidden | ✅ PASS (차단) |
| grant: anon 실행 불가 / authenticated 실행 가능 | ✅ PASS |

DB/RPC 레벨에서 `auth.uid()` 기반으로 차단됨을 실증 (클라이언트 가드에 의존하지 않음).

## 7. Fleet List / Detail 반환 형태
- fleet 반환 키(kpi/billing/contract/data/pagination/computed_at) ✅, 행 키(store_name/heartbeat_state/health_score/operational{status,reasons}/is_active/last_heartbeat_at) ✅
- detail 섹션(overview/playback/health/billing/device) + operational.status ✅
- (참고) 동일 매장 operational=CRITICAL 은 본사 단위 연체 인보이스 반영 — 설계대로 동작.

## 8. Browser Verification
- **NOT VERIFIED (BLOCKED)** — §2 사유(egress 정책). UI 코드는 이전 Phase에서 typecheck/lint/build 통과했으나 실브라우저 렌더/네트워크/콘솔 확인은 이 환경에서 수행 불가.

## 9. 회귀 테스트
- Unit Test: **141 PASS** (신규 13 포함), ESLint PASS, Migration Lint PASS, Build PASS.
- Playback/Queue/Scheduler/Crossfade/Invoice/Settlement 계산 로직 파일 무변경.
- 0456이 재정의한 view/health 함수는 컬럼명 계약 유지 → 기존 소비 RPC 무영향(값 정확도만 향상).
- 실브라우저 회귀(Brand Player/Store Player 등)는 §8 사유로 **NOT VERIFIED**.

## 10. 발견된 이슈 & 최소 수정
- **[FIXED] 0457 `get_my_enterprise_ops_fleet` 런타임 오류**: 행 목록 `ORDER BY` 의 `case when p_sort='name' then store_name end` 에서 `store_name`(SELECT 별칭)이 CASE 식 내부에서는 입력컬럼으로만 해석되어 `column "store_name" does not exist` 발생. **최소 수정**: 별칭 대신 원본식 `coalesce(s.fs_store_name, u.full_name, u.nickname, '(매장명 없음)')` 사용 + status CASE 컬럼을 `sms.` 로 명시. 정적 lint/build로는 잡히지 않던 결함으로, 런타임 검증의 핵심 성과.
- **[별개·미수정] `0401.get_my_enterprise_ops_stores`** 에 동일 패턴(`then store_name end`)이 존재 — 이미 배포된 마이그레이션이라 본 Phase 범위 밖(수정 금지). **후속 조치 권고**로 남김.

## 11. Harness 충실성 & 정리(disposal)
- Prerequisites는 실제 migration에서 **정확 추출한 DDL** 사용. 단, 로드 순서상 ancillary 요소 일부 축약: enterprise_regions의 email/phone CHECK 2건, announcement/emergency의 ends/expires CHECK 2건, store_policy_sync_status.enterprise_region_id 의 FK 1건. 모두 0456/0457이 참조하지 않는 부수 제약이며 검증 결과에 무영향(투명 고지).
- 인덱스/RLS 정책/updated_at 트리거는 harness에서 생략(기능 검증 무관; 접근 통제는 DEFINER+auth.uid() 가드로 직접 검증).
- **정리 완료**: 세션 생성 객체(테이블 16 + view 2 + 함수 10)를 OID 기준으로 식별해 전량 drop. 사전 존재 객체(users/tracks/business_profiles/business_verification_profiles/admin_operation_logs/enterprise_accounts, 함수 `_touch_updated_at`/`admin_log_operation`)는 보존. `users` 13행 등 실데이터 무변경 확인. Synthetic 행은 전부 `BEGIN…ROLLBACK` 로 미영속.
- 참고: 사전 존재 `_touch_updated_at`/`admin_log_operation` 은 prereqs의 `create or replace` 로 **동일 migration 정의로 교체**됨(동작 불변) — 보존 유지.

## 12. 최종 검증 재실행
- Migration Lint ✅ / Unit Test 141 ✅ / ESLint ✅ / Build ✅.
- `npm run typecheck` 스크립트의 기존 `baseUrl` deprecation(TS5101)은 clean HEAD에도 존재하는 환경 이슈로 본 작업 무관, `tsc -b`(build)는 통과.

## 13. Merge Readiness
**MERGE-READY (조건부).** 아래를 근거로 코드/DB 관점 병합 준비 완료로 보고하되, 브라우저/Preview 항목은 **NOT VERIFIED(BLOCKED)** 임을 명시한다.

충족: Test DB migration 적용 성공 · `last_heartbeat_at` 실존 · heartbeat 정확 갱신 · **resync가 heartbeat 미변경** · 상태 5종 · fleet/detail 정상 · Enterprise 간 격리 · 일반/Store 계정 차단 · Unit/ESLint/Migration Lint/Build PASS · Production 무변경 · 미구현을 구현된 척 표기하지 않음.

미충족(환경 제약): Preview 배포·실브라우저 UI·콘솔/네트워크 확인 = **BLOCKED**(조직 egress 정책, 우회 금지). 이 항목들의 최종 확인은 배포 파이프라인/실브라우저 접근이 가능한 환경에서 별도 수행 필요.
