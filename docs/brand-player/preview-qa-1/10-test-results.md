# 10 — Test Results

## Automated gates (this branch)
| Check | Result |
|---|---|
| Migration lint | **PASS** — 417 files, 0 violations, 0 new duplicate prefix (incl. new `0454`) |
| Typecheck | **PASS** (no source code changed this phase; carried from UX-5) |
| ESLint | **PASS** (no source code changed) |
| Unit | **PASS** — 112 (UX-5 baseline; no tests added/removed) |
| Production build | **PASS** (no source code changed) |

No existing test was deleted or weakened.

## Not executed (BLOCKED / declined)
| Item | Status | Reason |
|---|---|---|
| Test DB migration apply | **NOT RUN** | live Test DB access declined this phase; table drifted since 0407 → must inspect before safe apply |
| RLS / RPC certification | **NOT RUN** | depends on Test apply |
| Auth-persistence browser tests | **BLOCKED** | no Test-bound preview + real browser |
| Store-binding browser tests | **BLOCKED** | same |
| Security browser tests | **BLOCKED** | same |
| Client auth-flow unit tests | **DEFERRED** | client rewire not shipped (would regress security pre-hardening) |

## Certification plan when unblocked
See `09-migration-and-rls.md` (synthetic SQL suite) and `12-browser-qa.md` / `13-long-run-qa.md` (browser + long-run runbooks). Only actually-executed checks will be marked PASS.
