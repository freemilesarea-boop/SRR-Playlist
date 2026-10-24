# Schema drift 재동기화 런북 (라이브 → repo source-of-truth)

> 목적: 라이브 DB가 MCP `apply_migration`으로 직접 수정되어 repo migration과 어긋난 상태를 복구하고,
> 재발(=라이브만 수정됨)을 CI로 차단. **데이터 변경 없음. 함수/정책/권한 정의(스키마)만 대상.**

## A. 확인된 drift (introspection으로 검증)

### A-1. repo에 파일이 없는 migration (live 히스토리엔 존재)
live `supabase_migrations.schema_migrations`에는 적용됐으나 `supabase/migrations/`에 **파일이 없는** 버전:
- `0193a_rbac_guardrail_override`
- `0193b_rbac_sales`
- `0193b2_rbac_sales_views`
- `0193c_rbac_tracks_reorder_payout`
- `0193d_rbac_bulk_delete`
- `0193e_rbac_reorder_apply`
- `0193f_rbac_approve`
- `0193f2_rbac_meta_approve`

(repo엔 `0193_rbac_enforcement_1.sql`만 존재. 위 8개는 본문 부재.)

### A-2. 함수 body/guard drift (live ≠ repo 최신 정의)
아래 19개는 **live=granular(can_*/is_super_admin)·올바름**, **repo 최신 정의=legacy(`role='admin'`) 또는 필터 누락**:

| 함수 | live | repo 최신 정의 위치 |
|---|---|---|
| admin_bulk_delete_tracks | can_manage_tracks | 0111 (role='admin') |
| admin_apply_playlist_reorder | granular | 0181 (role='admin') |
| admin_approve_artist_release | granular | 0154 (role='admin') |
| admin_update_track_metadata_and_approve | granular | 0188 (role='admin') |
| admin_sales_agent_list / _detail | can_manage_sales | 0054/0055 (role='admin') |
| admin_generate_sales_agent_code | granular | 0054 |
| admin_link_sales_agent_account | granular | (0193b only-live) |
| admin_record_commission_payout | granular | 0185 |
| admin_takedown_track / hide_released / restore_track | granular | 0131/0133 계열 |
| admin_set/bulk_guardrail_override, bulk_guardrail_clear | can_override_guardrails | 0173~0175 |
| **admin_generate_monthly_settlement** | granular **+ `eligible_for_payout` 필터** | **0065 (필터 없음)** ← 정산 정확도 직결 |
| admin_finalize_settlement / mark_settlement_paid / reveal_payout_account | super_admin | **0197 (merged) — 이미 동기화됨** |

> 위험: repo만으로 fresh deploy 시 위 함수들이 **legacy guard(=P0 재오픈) + 정산 eligible 필터 누락**으로 생성됨.
> 0197(merged)은 helper coalesce + 재무 가드만 복구 — 나머지 granular/eligible는 여전히 drift.

## B. 신뢰 가능한 재동기화 메커니즘 (운영자/CI 실행)
이 환경(Claude)에서는 `supabase`/`pg_dump`를 실행할 수 없음(연결정보 부재). **DB 접근권이 있는 운영자/CI가 1회 실행.**

### B-1. 스키마 덤프 (둘 중 하나)
```bash
# (권장) Supabase CLI — functions/RLS/policies/triggers/grants/extensions/search_path 모두 포함
supabase db dump --schema-only -f supabase/schema/public_schema.sql

# 또는 pg_dump (DIRECT connection string)
pg_dump --schema-only --no-owner --schema=public \
  "$SUPABASE_DB_URL" > supabase/schema/public_schema.sql
# 권한(grants)은 --no-privileges 빼야 포함됨. RLS/policy/trigger/index는 기본 포함.
```
포함 확인 항목(요청사항): functions ✅ / grants ✅(--no-privileges 미사용) / RLS+policies ✅ / triggers ✅ / indexes ✅ / extensions ✅ / `SET search_path` ✅ / SECURITY DEFINER|INVOKER ✅.

### B-2. repo 반영 방식 (둘 중 택1)
- **(권장) 스냅샷 파일**: `supabase/schema/public_schema.sql`을 canonical schema로 커밋. 기존 migration은 히스토리로 보존. fresh deploy = migrations 적용 후 이 스냅샷으로 정합성 보장(또는 신규 환경은 스냅샷 우선 적용).
- **(대안) 누락 migration 복원**: A-1의 8개 `0193x_*.sql`를 덤프에서 해당 함수 정의만 추출해 파일로 복원 → 기존 migration 체인에 끼워넣기(번호 충돌 주의, additive).

### B-3. 적용 안전성
- 덤프는 `create or replace function` / `create policy if not exists` 등 **additive**. 라이브에 재적용해도 no-op(이미 동일). 데이터/stream_events/settlement/release_status **무변경**.
- destructive(drop/alter type/delete) 미포함 확인 후 커밋.

## C. diff 검증 절차 (운영자)
덤프 후 repo와 비교해 보고서 작성:
```bash
# live 함수 정의 vs repo 추출 정의 diff (함수명 기준)
# 1) live에만 있는 함수 / repo에만 있는 함수 / body 다른 함수
```
- live에만 있는 함수: A-1의 0193x가 정의한 granular 버전들(위 19개 중 다수).
- repo에만 있는 함수: 현재까지 발견 없음(삭제된 함수는 live에도 부재).
- body 차이: A-2 표.
- grant/policy 차이: 0197로 `expire_free_trials`(service_role 전용) 등 정리됨. 덤프로 전수 확인.

## D. 재발 방지 — CI drift-check (제안)
GitHub Action(예시): PR마다 라이브 스키마와 repo 스냅샷을 비교해 불일치 시 실패.
```yaml
# .github/workflows/schema-drift-check.yml
name: schema-drift-check
on: [pull_request]
jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - run: |
          supabase db dump --schema-only --db-url "${{ secrets.SUPABASE_DB_URL }}" \
            -f /tmp/live_schema.sql
          # repo의 canonical 스냅샷과 비교 (정규화 후 diff)
          if ! diff -q <(grep -v '^--' supabase/schema/public_schema.sql) \
                       <(grep -v '^--' /tmp/live_schema.sql); then
            echo "::error::라이브 스키마가 repo와 다릅니다. 덤프를 커밋하세요."; exit 1
          fi
```
운영 규칙: **모든 스키마 변경은 migration 파일 + PR로만**. MCP/SQL editor 직접 변경 금지(긴급 시 즉시 덤프 커밋).

## E. 현재 단계 결론
- 0197(P0 보안) 이미 라이브 적용 + repo merge 완료.
- 나머지 granular/eligible drift는 **운영자 1회 덤프 → 커밋**으로 해소(이 문서 B). 덤프 파일을 주시면 Claude가 정리/PR 처리.
- 데이터/정산/stream_events 무변경 보장.
