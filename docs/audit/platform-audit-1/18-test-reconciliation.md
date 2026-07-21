# 18 — Test Reconciliation

> PLATFORM-AUDIT-1B · READ-ONLY. Machine-readable: `test-reconciliation.json`. No tests modified; only safe vitest re-run.

## By runner (direct recount)
| Runner | Files | Cases | Executed | Passed | Not executed — reason |
|---|---|---|---|---|---|
| Vitest unit (node) | 5 | 106 | ✓ | 106 | — |
| Vitest component (jsdom) | 2 | 23 | ✓ | 23 | — |
| **Vitest total** | **7** | **129** | ✓ | **129** | — |
| Playwright e2e | 3 | ~14 `test()` | ✗ | — | `@playwright/test` **not installed**; specs never run; need live `BASE_URL` + seeded brand |
| pgTAP SQL | 3 | n/a | ✗ | — | need Postgres/Supabase **Test DB**; mutate settlement tables; unsafe for prod |
| Jest / Cypress / Deno / shell | 0 | 0 | — | — | none present |
| **Total test files** | **13** | | | | |

- `expect()` assertions in src tests = **273** (a common source of inflated "test" counts, but still not 1,462).

## Execution scope
- **`npm test`** = `vitest run` → `src/**/*.test.ts(x)` only (node env) = **129 cases**. Does NOT run e2e or SQL.
- **CI** (`.github/workflows/`): `lint-migrations`, `lint-tones`, `test-db-provision`, `db-apply-recommendation-seed`. **No vitest / tsc / eslint / Playwright in CI.** → the 129 vitest cases are **local-only**; they do not gate PRs.

## The "129 vs 1,462" difference
- Direct recount finds **129 `it()`/`test()` calls across 7 files**, 13 test files total, 273 `expect()` assertions. Verified by grep **and** by executing `vitest run` (129 PASS).
- Git history shows **no larger suite** (no 65-file / 1,462-case state ever existed here).
- The **"65 files / 1,462 tests" prior record does NOT correspond to this repository** → **UNVERIFIED external claim, not applicable**.

## Correctness of PLATFORM-AUDIT-1's conclusion
- "**129/129 PASS**" is **CORRECT**.
- The audit already scoped it honestly (flagged Playwright uninstalled, SQL needs Test DB). The phrase "full tests complete" should be read as **"full runnable vitest suite complete"** — e2e + SQL remain NOT executed (correctly recorded).
- Coverage gap finding (auth/OAuth/player/payment/admin/AI untested) **confirmed**.

## Verdict
**TEST COUNT VERIFIED — 13 files, 129 vitest cases (all PASS), e2e+SQL not runnable here. The 1,462 figure does not correspond to this repository.**
