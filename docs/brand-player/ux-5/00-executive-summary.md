# BRAND-PLAYER-UX-5 — Executive Summary

> Branch `claude/brand-player-ux-5-final-controls` from `claude/brand-player-ux-4` (`2728979`).
> **Client/UI only. No DB migration, no Production data change.** Playback/Queue/Scheduler/Crossfade/Heartbeat/Analytics/Recovery logic untouched.

## What's added on top of UX-4
- **Playback time + progress bar** — current/total time (`m:ss` / `h:mm:ss`, NaN/Inf/negative-safe), synced to real playback; self-subscribed so ticks don't re-render the visual stage.
- **Safe seek** — no public seek existed, so a minimal `seekTo(sec)` was added **inside the audio owner** (`Player.tsx`) with track-identity + crossfade-skip + duration-clamp guards. The bar is interactive (click/drag/touch/keyboard), not read-only. UI never touches the audio DOM.
- **Volume control** — icon (mute/low/med/high) + slider + mute toggle, reusing the existing store `volume`/`setVolume`/`toggleMute` (no new volume state; persistence/restore preserved).
- **Shuffle / Repeat state** — read-only indicators from real store `shuffle`/`repeat` (no fake toggle; brand 24h policy unaffected).
- **Queue search** — client-side over the current queue (title/artist/album), case/space-insensitive, Korean/English/number, with an empty-result state. Results always carry the **original queue index** → selection calls `jumpTo(originalIndex)` (filtered index never confused with original).
- **Queue sections** — 현재 재생 / 다음 재생 (upcoming follows shuffle order). **최근 재생 omitted** — the player has no history stack (no fake history created).
- **Artwork blur background** — Spotify-style same-cover `object-cover` + strong blur + scale + dark overlay, centered `object-contain` foreground.
- **Logo background** — stable neutral dark gradient (no per-render pixel analysis).
- **Display-mode fade** — 250ms fade between BRAND_MEDIA/LOGO/ARTWORK/FALLBACK, independent of audio crossfade, reduced-motion aware.
- **`F` fullscreen toggle** — page-level, ignored while typing in inputs.
- **Auto-hide reinforced** — stays visible on pause/hover/focus/queue-open/search-focus/progress-drag/volume-drag; restarts on move/touch/keys/track-change/seek/volume/selection.

## Playback safety
`seekTo` changes `currentTime` **only** inside `Player.tsx`; all movement uses existing `next`/`prev`/`jumpTo`/`play`/`pause`/`setVolume`/`toggleMute`. No new audio element, no cloned/second queue, no scheduler bypass, no analytics gap.

## Tests
Typecheck ✅ · ESLint ✅ · Unit ✅ (112: 87 prior + 25 new across `playbackTime`, `queueSearch`, display-mode video-loop) · Build ✅. No test deleted or weakened.

## Verdict
`READY_FOR_PREVIEW_QA` — automated gates green; interactive browser QA pending a Test-bound preview (see `13-browser-qa.md`).
