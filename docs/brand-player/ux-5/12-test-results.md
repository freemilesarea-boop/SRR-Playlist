# 12 — Test Results

## Automated
| Check | Result |
|---|---|
| Typecheck | **PASS** (0) |
| ESLint (`--max-warnings=0`) | **PASS** (0) |
| Unit (`vitest run`) | **PASS** — 112 (6 files) |
| Production build (`npm run build`) | **PASS** (0) |

### New unit tests (25)
- `src/lib/playbackTime.test.ts` (9) — 0/9/59/60/65/3599/3600/hours, NaN/Infinity/negative; progress divide-by-zero/clamp; ratio→seconds.
- `src/lib/queueSearch.test.ts` (14) — title/artist/album/Korean/English/number/whitespace/empty/no-result; **original-index preservation**; sections (linear, index 0, last, shuffle order, fallback, empty).
- `src/lib/brandDisplayMode.test.ts` (+2) — video-loop invariant (single valid media + artwork stays BRAND_MEDIA) and failed-media re-evaluation.

No existing test deleted or weakened (prior 87 all still pass).

## Logic-level verification (pre-browser)
- **Seek**: owner-only apply with track-identity + crossfade + duration guards; click/drag/touch/keyboard; rAF-coalesced; pointer-cancel + unmount cleanup.
- **Volume**: store-backed; mute/unmute restore; persists across next/prev/select/exit/refresh.
- **Queue search/sections**: original-index safety; no history section (no fake history).
- **Blur / fade**: independent of audio; reduced-motion aware; failure parity.
- **Video loop**: mode stays BRAND_MEDIA while media usable (unit-asserted).

## Not executed
Live browser interaction (needs a Test-bound preview + brand session) — `13-browser-qa.md`. Not reported as PASS.
