# 10 — Test Results

## Automated
| Check | Result |
|---|---|
| Typecheck (`tsc -p tsconfig.app.json`) | **PASS** (0) |
| ESLint (`eslint src --max-warnings=0`) | **PASS** (0) |
| Unit (`vitest run`) | **PASS** — 87/87 (4 files) |
| Production build (`npm run build` = lint + tsc -b + vite build) | **PASS** (0) |

New unit tests: `src/lib/brandDisplayMode.test.ts` (15) — validity + the 6 priority scenarios from §15:
1. media+logo+artwork → BRAND_MEDIA
2. no media, logo, artwork → BRAND_LOGO
3. no media, no logo, artwork → TRACK_ARTWORK
4. none → DEFAULT_FALLBACK
5. invalid media (usable=0) + logo → BRAND_LOGO
6. invalid media + no logo + artwork → TRACK_ARTWORK
(+ artwork-load-failed → DEFAULT_FALLBACK, whitespace-logo treated as absent, filter order/empty.)

Existing brand tests (`brandMediaType`, `brandSignageSettings`, `brandSlideshow`) unchanged and passing — no test deleted or weakened.

## Logic-level verification (code review, not yet browser)
- **Track artwork**: derived from `queue[index].cover_url` → auto/manual next, prev, queue-select all change it; keyed `<img>` fade; hidden preload; failed set; no audio restart (audio owned by `<Player>`, not remounted).
- **Fullscreen controls**: reveal on move/bottom-zone/tap/focus/pause/queue; hide after 3s while playing; hover/focus/pause/queue keep visible; commands = official; throttle guards rapid clicks.
- **Queue viewer**: live store-derived; current highlighted + aria-current; `jumpTo` selection; safe fields only; focus trap.

## Not yet executed
Live browser interaction (needs a Test-bound preview + brand session) — see `11-browser-qa.md`. Not reported as PASS.
