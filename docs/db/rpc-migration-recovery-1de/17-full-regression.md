# 17 — Full Regression

| Check | Result |
|---|---|
| Typecheck (`tsc -p tsconfig.app.json`) | **PASS** (0) |
| ESLint (`eslint src --max-warnings=0`) | **PASS** (0) |
| Unit (`vitest run`) | **PASS** — 85/85 (5 files) |
| Production build (`tsc -b && vite build`) | **PASS** (0) |
| Migration lint | **PASS** — 421 files, 0 violations |
| RPC registry guard | **PASS** — 0 undefined, 0 new |
| Cluster A regression | **PASS** — RPCs still locally defined |
| Cluster B regression | **PASS** |
| Cluster C regression | **PASS** |
| Cluster D SQL security | **PASS** — anon/user blocked, admin ok, error paths |
| Cluster E SQL security | **PASS** — anon/user blocked, admin ok, error paths |
| RPC contract tests | **PASS** — 13/13 |
| Application integration | **DEFERRED** — no Test-bound Preview (contract-level verified) |

No existing tests were deleted or weakened. Unverified item (live Preview integration) is reported as DEFERRED, not PASS.
