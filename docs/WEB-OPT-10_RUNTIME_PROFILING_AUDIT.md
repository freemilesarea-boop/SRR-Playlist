# WEB-OPT-10 — Runtime Performance, Long Task & Browser Profiling Audit

> Phase deliverable. This is an **audit + procedure** document, not a runtime measurement
> report. Browser Performance traces, React Profiler runs, and heap snapshots are marked
> **NOT RUN** below, with evidence and the exact manual procedure to obtain them.

## 0. Why runtime measurement is NOT RUN in this environment

Per this phase's governing rule — *"Performance trace가 없는 병목을 사실처럼 단정하지 않는다"*,
*"실제 trace로 확인된 항목만 수정"*, *"실행하지 않은 browser profiling을 PASS로 보고 금지"* —
no runtime numbers are fabricated and **no speculative performance code change was applied**.

Evidence that browser profiling could not be run here:

| Capability | Result | Evidence |
|---|---|---|
| Reach the Preview URL | **blocked** | `curl` to the Preview returns `HTTP 000` (agent proxy blocks external hosts) |
| Headless-browser harness | **absent** | `require.resolve('@playwright/test')` → not found; installing one is forbidden ("신규 profiling dependency 설치 금지") |
| Local `vite preview` + Chromium | **not representative** | local build has no `VITE_SUPABASE_URL` → app renders the config-missing state; the phase's scenarios (admin lists, charts, auth, data) cannot be exercised |

Consequently: **Performance trace, Long Task timeline, React DevTools Profiler, and Memory
heap snapshots = NOT RUN.** Sections that require them state so and give a manual procedure.

## A. Static runtime surface audit (code-evidence, no trace needed)

These are the code-level facts that bound runtime behavior. They are verifiable from source
and were checked directly:

- **Forced layout / reflow reads: NONE.** `grep` over `src/` for `getBoundingClientRect`,
  `offsetWidth/Height`, `scrollWidth/Height`, `clientWidth/Height`, `getComputedStyle`,
  `.scrollTop` → **0 matches**. There is no layout-read-then-write thrashing anywhere.
- **Scroll / wheel / touchmove / pointermove / mousemove handlers: NONE.**
  `grep` for those `addEventListener`/`on*` → **0 matches**. No scroll-linked layout work,
  and therefore **no passive-listener correction is applicable** (nothing to make passive).
- **requestAnimationFrame:** only `Player.tsx` (out of scope), `BrandSignage.tsx`
  (digital-signage crossfade, bounded), and `ProfilePage.tsx` (a one-shot **double-rAF**
  mount-ready wait with cleanup — not a loop). No rAF-driven continuous React state churn
  in general UI.
- **Lifecycle (from WEB-OPT-4 & WEB-OPT-8, still intact):** all timers/intervals cleared,
  all listeners removed with matching refs, the single `IntersectionObserver` disconnects,
  all Supabase channels torn down, object URLs revoked (WEB-OPT-8), no `BroadcastChannel`/
  `WebSocket`. `themeStore`/`authStore`/`useFreshFetch` listener guards in place.
- **Derived-render hot paths (from WEB-OPT-5/6/8):** signup forms + Onboarding narrowed to
  selectors; ContentManagement AI fetch deferred to active tab; `StreamingAnalytics`
  aggregates memoized. AdminPage lazy + conditionally mounts each panel.

**Conclusion:** the static runtime surface is clean. There is **no trace-confirmed** and **no
new code-evident** bottleneck to fix in this phase, so no code change is made (honoring the
trace-first rule). The remaining suspected hotspots below are carried forward as
**trace-needed candidates**, not fixes.

## B. Runtime Inventory — NOT RUN

Per-scenario `main-thread work / Long Task / layout / React commit / memory` measurements
require a Preview Performance trace → **NOT RUN** (§0). Scenarios to measure when a browser
is available: first visit, login, admin entry, admin tab ×10, member list, content
management, playlist/artist/enterprise/contract/settlement lists, StreamingAnalytics, chart
screens, playlist detail, modal open/close ×20, search input, filter/sort, pagination, route
round-trips, background→foreground, reload, second visit.

## C / E. Long Tasks — NOT RUN (candidates below)

No Long Task timeline was captured (§0). **Suspected** Long-Task/interaction candidates,
carried from prior audits and code structure, to confirm-or-refute with a trace:

| # | Candidate | Code evidence | Suspected trigger | Priority (pending trace) |
|---|---|---|---|---|
| 1 | `AudioDiagnosticPanel` "probe-all" | `AudioDiagnosticPanel.tsx` — unmemoized full-catalog filters recomputed per probe tick; full unbounded `fetchTracks()` list | O(N²) reconcile during a deliberate admin probe-all | P2 (rare, admin, deliberate) |
| 2 | `StoreNowPlayingPanel` 1s tick | renders desktop table **and** hidden mobile cards (both mounted), `now={nowTick}` changes every 1s | ~200 row-components reconcile/s, half hidden | P2 (live monitor; long-open) |
| 3 | `ContentManagement` / `StreamingAnalytics` big lists | unbounded row lists; StreamingAnalytics compute already memoized (WEB-OPT-8) | full-table DOM on huge catalogs | P2 |
| 4 | Lazy chunk first-eval (recharts / Excel / QR / ffmpeg) | already click-time/route lazy (WEB-OPT-3) | one-time parse/eval on first open | P2/P3 (one-time) |
| 5 | `ArtistDashboardPage` chart IIFE | unmemoized chart data build in render | dozens of a single artist's tracks | P3 (negligible) |

None of these are applied as fixes here: (1)-(2) need a trace to justify + a row-memo /
responsive-switch refactor (deferred in WEB-OPT-8); (4) is one-time by nature.

## D. Applied Fixes

**None.** No trace-confirmed bottleneck was obtainable, and the static runtime surface has no
new code-evident hotspot. Applying a speculative "perf" change would violate the phase's
trace-first rule.

## F. React Profiler — NOT RUN

React DevTools Profiler requires the running Preview (§0) → **NOT RUN**. Manual procedure:
DevTools → Profiler → record while doing AdminPage mount, 10 tab switches, 20-char search,
filter change, pagination, 20 modal open/close, chart-tab switch, playlist-detail enter/exit.
Inspect commit duration, "why did this render", memo bailouts.

## G. Input / Interaction — static notes, runtime NOT RUN

- Search inputs are debounced (MembersList, AdminOperationLogs, ArtistTrackManagementList,
  SearchPage) — **debounce timings left unchanged** (phase forbids arbitrary changes).
- StreamingAnalytics cap-input recompute was already memoized (WEB-OPT-8).
- `useDeferredValue`/`useTransition`: **not applied** — requires a measured input bottleneck
  (§0) and none is confirmed; forbidden fields (login/settlement/contract/permission) excluded.

## H. Layout / Scroll / Paint

**No forced layout, no scroll/resize handlers** in `src` (§A). Nothing to batch or make
passive. Paint/frame-drop measurement → **NOT RUN** (§0).

## I. Chart / Table / List

Charts render only when their tab is active (WEB-OPT-8); AdminPage conditionally mounts
panels. Table candidates (1)-(3) above need a trace. **Virtualization: not introduced**
(no new dependency; row counts unproven at scale without a trace; pagination already present
on the main lists).

## J. Lazy / Route Execution

recharts out of the initial graph (WEB-OPT-3); Excel + QR click-time lazy; ffmpeg dynamic.
Boot-recovery handles chunk-404 (WEB-OPT-2). **No idle prefetch added** — first-interaction
delay is unmeasured (§0), and prefetch conditions (proven delay, no initial-bundle increase)
can't be verified here.

## K. Background / Third-Party

- **Polling with visibility awareness:** several panels already gate on `visibilityState`
  (StoreNowPlayingPanel, focus/visibility refetch paths). General-UI polling visibility-pause
  is a candidate but needs a trace to show foreground-burst cost → **not changed**.
- **Sentry / Supabase / fonts:** Sentry init is intentional observability (not removed);
  Supabase preconnect (WEB-OPT-7) intact; font CDNs preconnected. No duplicate init found.

## L. Memory / GC — NOT RUN

Heap before/after, detached-DOM, retained-object analysis require DevTools Memory (§0) →
**NOT RUN**. WEB-OPT-8 already removed the known object-URL leak and timer/stale-async
retention. Manual procedure: heap snapshot → 20× modal open/close → 10× route round-trip →
force GC → compare retained size / detached nodes / listener count.

## M. Before / After — NOT RUN

No trace pairs (§0). No ms / FPS / TBT / INP / heap deltas are reported.

## N. Tests (static, this branch)

`typecheck` PASS · `lint` (max-warnings=0) PASS · `unit` 91/91 PASS · `build` PASS ·
build artifact unchanged (docs-only). Browser / Performance / React Profiler / Memory /
Lighthouse / Playwright: **NOT RUN**.

## O. WEB-OPT Regression

No source changed → all WEB-OPT-2…9 anchors intact by construction (ErrorBoundary, SW
precache exclusion, boot recovery, Sentry release, recharts split, Excel/QR lazy, themeStore
guard, Zustand selectors, useFreshFetch guard, inactive-query defer, stale-response guard,
cache headers, Supabase preconnect, object-URL revoke, timer cleanup, stale-async guard,
StreamingAnalytics memo, image lazy + decoding async). Initial bundle unchanged.

## P. Data Safety

No music / artist / contract / settlement / playback / Storage / DB / RPC / View / RLS /
migration change. No destructive command. Docs-only.

## Q. Forbidden Scope

Untouched: Player / playerStore / playerSession / Queue / Crossfade / Audio Output / Auth
core / Scheduler / Settlement / Contract / migrations / Service Worker / Vercel cache /
Storage / ffmpeg-wasm. No production deploy.

## R. Risks Found But Not Modified (trace-needed backlog)

Ranked for a future browser-equipped profiling pass:

1. **P2 — `StoreNowPlayingPanel`** dual desktop+hidden-mobile mount on 1s tick →
   confirm with Performance trace (long-open monitor); fix = responsive JS switch so the
   hidden layout isn't mounted. Needs trace + regression on a live panel.
2. **P2 — `AudioDiagnosticPanel` probe-all** O(N²) → confirm with a trace during probe-all;
   fix = memoized row component + batched probe-state updates.
3. **P2 — unbounded admin list DOM** (ContentManagement/StreamingAnalytics on huge catalogs)
   → confirm row count + scroll trace; fix = client pagination or row memo (UX-affecting →
   needs product sign-off).
4. **P3 — lazy chunk first-eval** (recharts/Excel/QR) → one-time; consider hover/focus
   prefetch only if a trace shows a real first-interaction delay and no initial-bundle cost.
5. **P3 — `ArtistDashboardPage` chart IIFE** → negligible; optional `useMemo`.

## Manual profiling procedure (for when a browser + real Preview are available)

1. Open the Preview in Chrome (Incognito, extensions off, to remove DevTools/extension noise).
2. DevTools → Performance → gear: CPU 4×/6× slowdown, Network Fast/Slow 3G, cache on/off.
   Record each §B scenario ≥3× (use the median; separate cold vs warm; separate first
   lazy-chunk eval from re-eval).
3. Classify every Long Task ≥50 ms by top stack → app code vs third-party vs DevTools/toolbar.
4. React DevTools → Profiler for the §F scenarios; note commit duration + render reasons.
5. Memory → heap snapshots around the §L repetition loops; force GC; compare retained size.
6. Only then apply fixes whose stack maps to app code and reproduces ≥2×, comparing
   before/after traces in the same environment/data. Keep Player/Auth/Queue/Crossfade/
   Settlement untouched.
