# 11 — Performance Review

- **Audio element recreations: 0** — seek changes `currentTime` on the existing active element; no new element.
- **Page remount on track change: 0** — only the visual layer swaps keyed images; the `<Player>`/audio is untouched.
- **Progress re-render scope** — `BrandPlaybackProgress` self-subscribes to `currentTime`/`duration`; per-second ticks re-render only it, not the control bar, visual stage, or page.
- **Blur image requests** — background and foreground share the same URL (browser caches → effectively one fetch); keyed by URL so no duplicate requests on re-render.
- **Failed images** — logo/artwork failures recorded in a `Set`, never retried (no infinite loop); signage keeps its own broken set.
- **Queue search** — O(n) in-memory filter over the current queue; stable `track.id` keys; `loading="lazy"` covers → large drawers scroll without loading every thumbnail up front.
- **Large queue (500–1000)** — the drawer renders rows for the current queue; rows are lightweight (thumb + two lines). No large virtualization dependency added — kept simple per the phase ("현재 규모에서 필요 없으면 과도한 최적화 금지"). If a future queue routinely exceeds a few thousand, a lightweight windowing pass can be added behind the same section/search API.
- **Timers / listeners** — hide timer, mousemove, keydown, pointer (via pointer capture), rAF (progress drag), fullscreen listeners are all cleaned up on unmount / `active` change.
- **Blob URLs** — none created (only remote URLs).
