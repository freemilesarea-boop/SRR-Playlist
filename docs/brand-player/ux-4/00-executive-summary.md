# BRAND-PLAYER-UX-4 — Executive Summary

> Branch `claude/brand-player-ux-4` from `claude/playlist-mvp-development-2JmTJ` (`acebedd`).
> **Client/UI only. 0 DB migrations, 0 Production data changes.** No audio/queue/scheduler/crossfade logic touched.

## What changed
The brand player's empty "브랜드 사이니지 미디어가 아직 등록되지 않았어요" state is gone. Visual content now follows a strict priority chain, and fullscreen gains a real playback control bar + queue viewer.

### Visual priority (single selector — `src/lib/brandDisplayMode.ts`)
1. **BRAND_MEDIA** — ≥1 *valid* signage image/video → existing cycling playback (unchanged).
2. **BRAND_LOGO** — no valid media + brand logo present → centered logo (`object-contain`, max-size clamp, neutral bg), persistent.
3. **TRACK_ARTWORK** — no media/logo → current track cover; auto-swaps on track change with an independent short fade; next cover preloaded.
4. **DEFAULT_FALLBACK** — no artwork or artwork load failed → service `LogoMark` on a safe gradient (no instructional text).

Validity is asset-based (non-empty URL + supported format + not runtime-broken), not array length.

### Fullscreen controls (`BrandFullscreenControls` + `BrandQueueDrawer`)
Prev · Play/Pause · Next · current title/artist/thumbnail · Queue button · Exit. Auto-hide after 3s while playing; stays while paused / hovered / focused / queue-open. Reveals on mouse move, bottom-20% zone, or touch tap. Keyboard: Space, ←/→, Q, Esc. Queue viewer = right drawer over the current queue, current track highlighted (`aria-current`), click → `jumpTo(i)`, live-synced, focus-trapped, auto-scrolls to current.

## Playback safety
All track movement calls the existing official commands (`next`/`prev`/`jumpTo`/`play`/`pause`). No new audio element, no cloned/second queue, no manual index math, no scheduler bypass. The global `<Player>` remains the sole audio owner → analytics/heartbeat/crossfade/recovery intact. Visual changes never restart audio.

## Logo data
No per-franchise logo column exists. The recovery reuses the existing service-level `brand_settings.logo_url` (via `useBrandStore`, anon-granted `get_brand_settings()`), so **no migration and no duplicate column** were added (per the phase's "use existing field" rule). Per-brand logos can be a future phase.

## Tests
Typecheck ✅ · ESLint ✅ · Unit ✅ (87, incl. 15 new for the display-mode selector) · Build ✅.

## Verdict
`READY_FOR_PREVIEW_QA` — automated gates green; live browser QA pending a Test-bound preview (see `11-browser-qa.md`).
