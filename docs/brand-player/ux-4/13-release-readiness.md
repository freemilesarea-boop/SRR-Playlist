# 13 — Release Readiness

## Completion checklist (§19)
- [x] Brand media shown first (valid-asset based)
- [x] No valid media → brand logo
- [x] No logo → current track artwork
- [x] No artwork → safe default fallback
- [x] Empty-state instructional text removed
- [x] Artwork auto-changes on track change
- [x] Artwork change does not restart audio
- [x] Fullscreen bottom control bar
- [x] Mouse bottom-zone detection
- [x] Touch control toggle
- [x] Prev / Play-Pause / Next
- [x] Queue button + Queue Viewer
- [x] Current track highlighted
- [x] Queue item select → play (`jumpTo`)
- [x] Fullscreen stays (only ESC/Exit leave)
- [x] Keyboard + accessibility
- [x] No regression: brand media / queue / scheduler / crossfade (code-level; no logic touched)
- [x] Typecheck / ESLint / Unit(87) / Build — PASS
- [ ] Browser QA — DEFERRED (no Test-bound preview; see `11`)
- [x] No Production DB change
- [x] No secret / PII output

## Changed files
- `src/lib/brandDisplayMode.ts` (new) + `src/lib/brandDisplayMode.test.ts` (new)
- `src/components/brand/BrandVisualStage.tsx` (new)
- `src/components/brand/BrandFullscreenControls.tsx` (new)
- `src/components/brand/BrandQueueDrawer.tsx` (new)
- `src/components/brand/BrandSignage.tsx` (empty-state removed; usable-count reporting)
- `src/pages/BrandPlayerPage.tsx` (wire stage + controls; load logo)
- `docs/brand-player/ux-4/*` (this documentation set)

## Verdict
`READY_FOR_PREVIEW_QA` — all automated gates green and behavior verified at code level; the only open item is interactive browser QA, which needs a Test-bound preview environment.
