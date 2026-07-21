# 09 — Test Coverage Matrix

> PLATFORM-AUDIT-1 · READ-ONLY · commit `0f3bb57`.

## Runner config
- **Vitest** (`vitest.config.ts`): default env `node`, includes `src/**/*.test.ts(x)`, setup `src/test/setup.ts`, `globals:false`. Component tests opt into jsdom via `// @vitest-environment jsdom`. `@`→`src`. `npm test` → `vitest run`.
- **Playwright: NOT installed / NOT configured.** No `@playwright/test` in deps, no config. The `e2e/*.spec.ts` files self-document "runner not installed; never run"; they live outside `src/` so don't affect typecheck/lint/build. **→ scenario documentation, not executable tests.**
- **SQL tests:** pgTAP-style in `supabase/tests/`, require a Postgres/Supabase test DB + pgTAP; no npm runner wired.

## Executed this phase
`vitest run` → **129 passed / 129 (7 files)**, ~2–3s. tsc/eslint/tones/migration-lint all PASS. Build PASS (earlier this session).

## Test files (13)
### Unit — pure logic (node) — Safe Local / Safe CI
| File | Covers | Cases |
|---|---|---|
| `src/lib/brandMediaType.test.ts` | media-type detection, formatBytes/duration | 14 |
| `src/lib/brandSignageSettings.test.ts` | signage settings + clock format | 33 |
| `src/lib/brandSlideshow.test.ts` | slideshow sequencing | 25 |
| `src/lib/settlementDisplayModel.test.ts` | settlement display model | 17 |
| `src/lib/settlementFilters.test.ts` | settlement filter/search | 17 |

### Component (jsdom + Testing Library) — Safe Local / Safe CI
| File | Covers | Cases |
|---|---|---|
| `src/components/admin/ArtistSettlementsList.test.tsx` | admin settlements list render/interaction (API mocked) | 15 |
| `src/components/admin/settlement/SettlementParts.test.tsx` | settlement sub-components | 8 |

### E2E (Playwright syntax) — Requires browser + **NOT runnable (runner uninstalled)** — Unsafe for Production (drives live app via `BASE_URL`, needs `E2E_BRAND_ID`)
| File | Covers |
|---|---|
| `e2e/brand-player-signage.spec.ts` | brand signage player |
| `e2e/brand-player-slideshow.spec.ts` | brand slideshow |
| `e2e/brand-player-video.spec.ts` | brand video (music-continues invariant) |

### SQL / pgTAP — Requires Test DB — **Unsafe for Production** (mutates settlement tables; disposable branch/local only)
| File | Covers |
|---|---|
| `supabase/tests/settlement_versioning_test.sql` | version+1 on re-gen, partial-unique is_current, sealed lock |
| `supabase/tests/settlement_logic2_compute_test.sql` | compute logic v2 |
| `supabase/tests/settlement_e2e_lifecycle_test.sql` | full lifecycle |

## Feature × test matrix
| Feature | Unit | Component | E2E | SQL | Last result | Gap |
|---|---|---|---|---|---|---|
| Settlement display/filter | ✅ | ✅ | — | ✅ | PASS (129 incl.) | strong |
| Brand player media (type/signage/slideshow) | ✅ | — | ⚠ non-run | — | unit PASS | e2e not runnable |
| Auth / signup (8 forms, authStore) | — | — | — | — | — | **NONE** |
| OAuth / Kakao | — | — | — | — | — | **NONE** |
| Player.tsx (2970 LOC) + `useAudio*` hooks | — | — | — | — | — | **NONE** (highest-risk untested) |
| Admin actions (Policy/Franchise/Enterprise/Content/TrackReview) | — | ✅(settlement only) | — | — | — | mostly NONE |
| Payment (PayApp, PaymentSyncTool) | — | — | — | — | — | **NONE** |
| AI curation (`aiCuration.ts` 2300 LOC) | — | — | — | — | — | **NONE** |
| Supabase API wrappers (`src/lib/api/*`) | — | — | — | — | — | NONE |

## Safe-to-run classification
| Suite | Classification |
|---|---|
| `vitest run` (unit+component) | **Safe Local / Safe CI** |
| `e2e/*.spec.ts` | Requires browser + **runner uninstalled** → cannot run as-is; would need seeded brand + `BASE_URL` |
| `supabase/tests/*.sql` | **Requires Test DB**, mutates settlement tables → **Unsafe for Production** |

## Findings
- **TEST-F1 (P1):** Testing concentrated on settlement + brand-player only. **Auth, OAuth, Player, payment, admin actions, AI curation have zero automated tests** — the highest-risk, most-complex surfaces are unguarded.
- **TEST-F2 (P2):** Playwright runner not installed → 3 e2e specs are documentation, never executed. Either wire the runner or reclassify.
- **TEST-F3 (P3):** SQL settlement tests have no CI wiring; run manually against a disposable branch only.
