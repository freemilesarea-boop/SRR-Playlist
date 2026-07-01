# Migration 작성 규칙

Supabase `supabase/migrations/*.sql` 파일 작성 규칙 + CI Guard.

기존 array-concat 규칙은 [`docs/MIGRATION_RULES.md`](./MIGRATION_RULES.md) 를 참조. 본 문서는
**파일명 prefix 규칙 및 duplicate 방지** 를 다룸.

---

## TL;DR

- 새 migration prefix 는 **현재 최신 prefix + 1** 로.
- 같은 도메인을 여러 파일로 나눌 때는 **suffix (`0395a`, `0395b`)** 로.
- **같은 4자리 prefix 를 두 파일이 공유하면 CI 실패**.
- Legacy `0068`, `0214`, `0388` 는 이미 prod 반영됨 — **rename 금지, allowlist 예외**.

---

## 자동 검사

```bash
npm run lint:migrations
```

내부 규칙 2가지:

| Rule | 검사 대상 | 실패 시 |
|------|-----------|--------|
| `unsafe-array-concat` | `text[]` 변수의 `||` 리터럴 concat | exit 1 |
| `duplicate-prefix` | 같은 `<NNNN>_` prefix 를 사용하는 파일 2개 이상 | exit 1 |

CI 는 매 PR 에서 `.github/workflows/lint-migrations.yml` 이 자동 실행.

---

## Rule: 파일명 prefix 규칙

### ✅ 허용

```
supabase/migrations/
├── 0393_noc_alert_sync.sql
├── 0394_enterprise_contracts_bucket_private.sql
├── 0395_new_feature.sql               ← 최신 + 1
├── 0396a_migration_step1.sql          ← suffix 는 자유
├── 0396b_migration_step2.sql
└── 0397_next_feature.sql
```

### ❌ 금지 — CI 실패

```
supabase/migrations/
├── 0395_first_feature.sql
├── 0395_second_feature.sql            ← 4자리 prefix 중복 → CI FAIL
```

에러 예시:

```
✗ Duplicate migration prefix detected:

  0395
    - 0395_first_feature.sql
    - 0395_second_feature.sql

  Rule: 같은 4자리 prefix 를 2개 이상 파일이 사용할 수 없습니다.
        새 migration 은 최신 prefix + 1 을 사용하세요.
        같은 도메인을 여러 파일로 나눠야 할 때는 suffix (0395a, 0395b) 를 사용하세요.
        legacy allowlist: 0068, 0214, 0388 (이미 prod 반영, rename 금지)
```

---

## 예방 규칙 (개발자 워크플로우)

### A. 새 migration 작성 전

1. `ls supabase/migrations/ | tail -3` 로 최신 prefix 확인.
2. 자기 branch 에서 그 다음 번호를 예약.
3. 팀 채널(Slack/Notion 등) 에 예약 표시:
   ```
   [MIGRATION RESERVED]
   - 0395 → @A  (feat: XYZ)
   - 0396 → @B  (fix: ABC)
   ```
4. 여러 파일을 한 PR 로 병합할 때는 suffix (`0395a`, `0395b`, `0395c`) 사용.

### B. 여러 feature branch 가 동시에 진행 중일 때

1. 각 PR 을 default branch (`claude/playlist-mvp-development-2JmTJ`) 에 rebase.
2. Rebase 후 prefix conflict 발생 시 늦게 rebase 하는 쪽이 다음 번호로 rename.
3. **아직 prod 미적용** 상태에서만 rename 허용.

### C. Prod 적용 이후 절대 rename 금지

Supabase MCP `apply_migration` 은 timestamp version 을 부여함 (예: `20260630032544`).
Prod 는 이 timestamp 로 tracking. 파일 rename 은:
- Prod DB `schema_migrations` 테이블에는 무영향 (timestamp 는 변경 없음)
- 하지만 **로컬/스테이징 fresh env** 에서 `supabase db reset` 재현 시 파일명 기준으로 재실행됨 → prod 와 name mismatch 가능성
- Git 이력 (`git blame`, PR archaeology) 손상
- 이미 문서/PR/이슈에 파일명이 참조된 경우 링크 깨짐

**결론**: 이미 prod 에 적용된 migration 은 파일 rename 하지 말 것.

---

## Legacy Duplicate Allowlist

`0068`, `0214`, `0388` 3쌍은 이미 prod 반영되어 rename 금지. Lint 는 이를 legacy 로
인식하고 skip.

| Prefix | 파일 | 대상 객체 | 겹침 |
|--------|------|-----------|------|
| `0068` | `0068_contract_email_dispatch.sql` | `contract_templates`, `artist_contracts` (ALTER), `contract_email_jobs` | seed 파일 (`0068_contract_template_v1_seed.sql`) 는 이미 별도 mcp INSERT 완료. 파일은 형상관리용. |
| `0214` | `0214_schedule_days_array.sql`, `0214_trial_reminder_emails.sql` | `business_music_schedules` vs `users` | 서로 다른 테이블 |
| `0388` | `0388_announcement_exact_time_trigger_v2.sql`, `0388_artist_settlement_visibility_lockdown.sql` | announcement RPC vs artist settlement RPC/RLS | 서로 다른 도메인 |

Allowlist 를 확장하려면 `scripts/lint-migrations.mjs` 의 `LEGACY_PREFIX_ALLOWLIST` 를 수정.
단, **확장은 이미 prod 반영된 경우에만**.

---

## CI 통합

**Workflow**: `.github/workflows/lint-migrations.yml`

- PR trigger — `supabase/migrations/**` / `scripts/lint-migrations.mjs` / `package.json` /
  `.github/workflows/lint-migrations.yml` 경로 변경 시.
- Default branch push 시에도 실행 (병합 후 회귀 차단).
- Node 20, deps 없이 pure Node `readdirSync/readFileSync` 만 사용 → `npm ci` 불필요.

CI 실패 시 PR merge 차단.

---

## 관련 문서

- [`docs/MIGRATION_RULES.md`](./MIGRATION_RULES.md) — SQL 작성 규칙 (`array_append`, RPC overload 등)
- `scripts/lint-migrations.mjs` — Lint 스크립트 본체
- `.github/workflows/lint-migrations.yml` — CI 실행 정의
