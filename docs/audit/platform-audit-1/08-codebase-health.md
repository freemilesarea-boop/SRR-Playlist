# 08 — Codebase Health

> PLATFORM-AUDIT-1 · READ-ONLY. React 18 + TS 5.6 + Vite 5. 443 ts/tsx files. Detection only — nothing modified.

## Static verification (ran this phase, commit `0f3bb57`)
| Check | Command | Result |
|---|---|---|
| Typecheck | `tsc --noEmit -p tsconfig.app.json` | **PASS** (0 errors) |
| Lint | `eslint src --max-warnings=0` | **PASS** (0 warnings) |
| Admin tones | `lint-admin-tones.mjs --strict` | **PASS** |
| Migration lint | `lint-migrations.mjs` | **PASS** (0 violations, 419 files) |
| Tests | `vitest run` | **PASS** (129/129, 7 files) |
| Build | `vite build` | **PASS** (verified earlier this session) |

## Type safety & suppressions — EXCELLENT
- **`any`:** effectively **1** usage in all of `src` (1 `eslint-disable no-explicit-any`). Unusually clean.
- **`@ts-ignore`: 0. `@ts-expect-error`: 0.**
- **`eslint-disable`: 59** — but **54 are `react-hooks/exhaustive-deps`** (deliberate dep-array suppressions), 4 `react-refresh`, 1 `no-explicit-any`. **CH-F1 (P2):** the 54 exhaustive-deps suppressions are the largest latent-bug surface (stale-closure potential), concentrated in effect-heavy components.

## Logging & PII
- `console.log` 15 · `console.error` 201 · `console.warn` 145 in `src`.
- **CH-F2 (P2, security/PII — CONFIRMED):** `src/store/authStore.ts:226` unconditionally `console.log('[auth] signUp request:', { email, data })` — logs user email + full signup payload to the browser console on every signup; `:239` logs the response too. Not DEV-gated. **Remove/gate.**
- `src/lib/supabase.ts:20` logs an env summary unconditionally — verify it never prints keys (**CH-F3, P3, verify**).
- The 201 `console.error` are mostly legitimate API-error logging.

## TODO/FIXME/HACK — negligible
Effectively **0** genuine markers (4 grep hits are Korean business-number `XXX` placeholders + 1 soft refactor note). No FIXME/HACK debt.

## Resource lifecycle
- **Empty catch blocks: 0.**
- Listener pairing (whole src): addEventListener 89 / remove 63; setInterval 56 / clear 52; setTimeout 88 / clear 68; rAF 6 / cancel 5. **No `new AudioContext`** (audio via HTMLAudioElement).
- Most unbalanced listeners are app-lifetime globals (`main.tsx`, `sw.ts`, `authStore.ts`) — attached once, never unmount.
- **CH-F4 (P3, LOW):** two transient-probe-audio listener sites without explicit `removeEventListener` — `DuplicateDetectionTab.tsx:117/123`, `EnterpriseAnnouncementsPanel.tsx:570/574` (elements GC'd after metadata read; not persistent leaks).
- **260 `void <call>`** — deliberate fire-and-forget convention; async effect failures rely on inner try/catch (awareness, not defect).

## Largest files / God components (top 15 LOC)
```
2970  src/components/player/Player.tsx        ← GOD COMPONENT
2300  src/lib/aiCuration.ts
2002  src/components/admin/PolicyAutomationPanel.tsx
1897  src/components/admin/PolicyDeploymentPanel.tsx
1846  src/pages/ArtistDashboardPage.tsx
1788  src/lib/artistApi.ts
1387  src/components/admin/FranchiseManagementPanel.tsx
1370  src/components/admin/ContentManagement.tsx
1307  src/components/admin/EnterpriseAccountsPanel.tsx
1221  src/components/admin/PaymentSyncTool.tsx
1157  src/components/admin/EnterpriseCommandCenterPanel.tsx
1099  src/components/admin/TrackReviewList.tsx
1034  src/components/artist/ArtistBatchUploadForm.tsx
1020  src/components/admin/MemberDetail.tsx
1012  src/pages/EnterpriseHqMePage.tsx
```
- **CH-F5 (P2):** `Player.tsx` (2970 LOC) is the clear God component — 32 `useEffect`, ~100 hook calls, 36 combined timer/RAF/listener calls in one file. Highest-risk file to modify + main leak surface. Refactor candidate (many `src/hooks/useAudio*` already exist → partial extraction underway).
- Secondary cluster: admin `Enterprise*`/`Policy*` panels (1000–2000 LOC each).

## Dead code — MINIMAL
File-level dead code essentially none. Only 4 unreferenced files, all legitimate entry points: `src/sw.ts` (PWA SW), `src/lib/audioAnalysisWorker.ts` + `loudnessWorker.ts` (`new Worker(new URL(...))`), `src/test/setup.ts` (vitest). No action.

## Duplicate-logic candidates
- **Signup forms (8 in `src/components/auth/`):** Artist/Business/Individual/EnterpriseBrand/EnterpriseHq/EnterpriseStore — high overlap; consolidation target.
- **Overlays (4):** Emergency/Announcement/GlobalStoreAudio/BrandPresentation — first two share identical debug-logging idiom.
- **Settlement components (7+):** SettlementV2Panel, EnterpriseSettlementCenterPanel, EnterpriseMonthlySettlementsPanel, ArtistSettlementDetail/List, SettlementParts — large surface, probable overlap.
- **Formatting utils scattered** (no single module): `formatTime`, `formatBytes`, `formatClockHhMm`, `formatSettlementMonth`, `formatBusinessNumber` across ≥5 files — moderate duplication.

## Circular deps — LOW
`madge` not installed. Only one barrel file (`src/components/admin/ui/index.ts`); near-zero barrel usage → classic barrel-cycle risk low.

## Dependency vulnerabilities (`npm audit`, read-only — no fix run)
- **Production only (`--omit=dev`): 2 moderate, 0 high/critical.** Runtime-facing: **`react-router`/`react-router-dom` (moderate)** — worth a patch bump. **CH-F6 (P2).**
- **Full tree: 11 (1 critical, 3 high, 6 moderate, 1 low)** — all critical/high are **build/test toolchain, not shipped code**: critical `vitest`(→esbuild), high `vite`/`brace-expansion`/`fast-uri`. Lower urgency; fixable via Vite/Vitest minor bump. **CH-F7 (P3).**

## Summary
Codebase is remarkably clean on type safety, dead code, empty catches, and TODO debt. Two real liabilities: (1) **test coverage** guards only settlement + brand-player while auth/player/payment/admin go untested (see `09-test-coverage-matrix.md`), and (2) the **`Player.tsx` God component**. Immediate actionable: remove the PII `console.log` in `authStore.ts:226/239`.
