# BRAND-PLAYER-UX-FIX-1 — Investigation & Fix

> Branch `claude/brand-player-ux-fix-1` from the latest production branch
> `claude/playlist-mvp-development-2JmTJ` @ `0d61b20` (merge of PR #485 —
> the Production-reflected Brand Player). Working tree clean at branch start.
> **Scope:** Brand Player central visual + Queue interaction UX only. No change
> to Playback Engine, Audio ownership, Crossfade, Scheduler, Queue-generation,
> Shuffle/Repeat, Device Binding, Auth, Heartbeat, Analytics. No migration, no
> Production/DB/data change. PR + Preview only (no direct deploy).

## Baseline
- Brand player tests present: `brandDisplayMode`, `brandDeviceBinding`, `brandSignageSettings`, `brandSlideshow`, `brandMediaType`, `queueSearch`, `playbackTime`. Unit baseline 127 → **128** after this change (no test deleted/weakened).

---

## Symptom 1 — Center shows the logo even when the track has artwork

### Traced cause (not guessed)
Central visual mode is decided in a single selector `resolveBrandDisplayMode()` (`src/lib/brandDisplayMode.ts`), consumed only by `BrandVisualStage` (`src/components/brand/BrandVisualStage.tsx`). The original priority ranked **`BRAND_LOGO` above `TRACK_ARTWORK`**:

```
media>0 → BRAND_MEDIA
logoUrl present → BRAND_LOGO      ← wins whenever a brand/service logo exists
artwork valid → TRACK_ARTWORK
else → DEFAULT_FALLBACK
```

`BrandPlayerPage` passes `logoUrl={brandLogoUrl}` (brand store `logo_url`, effectively always present) and `artworkUrl={current?.cover_url}`. So for any store with a logo and no signage media, the center is pinned to the logo and never shows the current track's album art. The artwork field is already a single normalized one — `TrackRow.cover_url` — so no field guessing is involved.

### Fix (minimal)
Reorder the selector so a **valid (non-failed) current-track artwork wins over the logo**; logo becomes the fallback when artwork is missing/failed; signage media (`BRAND_MEDIA`, a separate intentional paid feature) stays highest:

```
media>0 → BRAND_MEDIA
artwork valid & not failed → TRACK_ARTWORK
logoUrl present → BRAND_LOGO     (fallback: artwork missing or onError)
else → DEFAULT_FALLBACK
```

`BrandVisualStage.ArtworkStage` already: swaps artwork per track (keyed by URL), preloads the next cover, tracks per-URL load failures in a `Set` (no infinite `onError`), and applies a `fadeIn` (250ms mode / 400ms artwork, `motion-safe` only). Those satisfy Part A §5 (150–400ms fade, no Audio/Player remount, reduced-motion respected) — unchanged. On artwork `onError`, the failed URL is added to the set → `artworkFailed` → selector falls to `BRAND_LOGO` (or fallback), so no broken-image icon is shown.

### Tests
`brandDisplayMode.test.ts` updated to assert the corrected priority (artwork wins over logo) and a new case (artwork load-failed + logo → `BRAND_LOGO` fallback). Video-loop invariant (media stays `BRAND_MEDIA`) retained.

## Part A §4 — Center metadata (title / artist)
Added an **optional** caption under the central artwork (current title + artist). Implementation notes matching the constraints:
- Absolutely positioned (`bottom-[5%]`, `pointer-events-none`) → **no layout shift**, does not resize the artwork.
- Title `line-clamp-2`, artist `truncate`; responsive text sizes; drop-shadow for contrast.
- Rendered **only in the normal player view** (`!chromeHidden`). In presentation/fullscreen the existing opt-in `BrandPresentationOverlays` now-playing + control-bar own the label, so there is **no duplicate center display**.
- The existing bottom footer now-playing (normal view) is **kept** (not removed), per spec. Brand logo stays in its top-left header position (untouched).

---

## Symptom 2 — Right Queue panel: cannot scroll to lower tracks / selecting a track does nothing

### Traced cause (not guessed)
Queue panel = `BrandQueueDrawer` (`src/components/brand/BrandQueueDrawer.tsx`), a right side-drawer mounted by `BrandFullscreenControls`. DOM hierarchy of the panel:

```
panel  absolute right-0 top-0 z-[122] h-full flex flex-col   (opaque bg, w≤400px)
 ├ header  (border-b)                    ← was NOT shrink-0
 ├ search  (pt-2)                        ← was NOT shrink-0
 └ list  flex-1 overflow-y-auto ...      ← was MISSING min-h-0
```

**Root cause: the scroll container had `flex-1 overflow-y-auto` but no `min-h-0`.** In a flex column a child's default `min-height:auto` equals its content height, so the `flex-1` list expands to the full height of all rows instead of being capped by the panel — `overflow-y-auto` therefore never engages. The list overflows past the panel's `h-full` (below the viewport), so lower tracks (75+, 200+ queues) are pushed off-screen / behind the bottom control bar and are unreachable. Rows that remain visible are clickable, but the ones users want are simply not on screen — which reads as "scroll doesn't work" **and** "clicking a lower song does nothing."

Selection itself was **not** broken: `onSelect(originalIndex) → jumpTo(originalIndex)`, and `jumpTo` is a single atomic store update (`{ index, currentTime:0, playing:true }`) → exactly one Track Change, no duplicate Audio, engine untouched. Search results and sections already carry the correct `originalIndex` (`queueSearch` — 14 tests). So the interaction defect is entirely the CSS overflow above; no handler change needed.

Z-index/pointer-events were checked and are **not** the cause: panel `z-[122]` sits above the control bar `z-[121]` and its own backdrop `z-[121]`, so visible rows already win pointer events over the controls.

### Fix (minimal, CSS-only, localized to the drawer)
- List container: add **`min-h-0`** (+ `[touch-action:pan-y]`, keep `overscroll-contain`) so it caps at the panel height and scrolls internally — mouse wheel / trackpad / scrollbar / touch all work; full list reachable end-to-end.
- Header + search: add **`shrink-0`** so the fixed regions never compress the list.
- List bottom padding → `pb-[max(1rem,env(safe-area-inset-bottom))]` so the last track clears the safe area / controls.
- No virtualization added: the fix is pure layout; the existing list already renders all rows and now scrolls correctly. Adding a library was unnecessary for this defect (§7).

---

## Constraints honored
Playback Engine / Audio ownership / Crossfade / Scheduler / Queue-gen / Shuffle-Repeat / Device Binding / Auth / Heartbeat / Analytics — **untouched**. No migration, no Production/DB/data change, no secrets/PII. No test deleted or weakened. Direct Production deploy not performed (PR + Preview only).

## Changed files
- `src/lib/brandDisplayMode.ts` — priority reorder (artwork > logo) + docstring.
- `src/lib/brandDisplayMode.test.ts` — assertions for corrected priority (+ fallback case).
- `src/components/brand/BrandVisualStage.tsx` — optional center caption (title/artist), normal-view only.
- `src/pages/BrandPlayerPage.tsx` — pass current track title/artist to the stage.
- `src/components/brand/BrandQueueDrawer.tsx` — `min-h-0` scroll fix + `shrink-0` + safe-area padding.

## Gates
Typecheck ✅ · ESLint (changed files) ✅ · Unit **128 passed** ✅ · Production build ✅.
