# 07 — Playback Command Review

Every control maps to an existing official command — no new engine, no manual index mutation.

| UI action | Command | Notes |
|---|---|---|
| Play/Pause | `play()` / `pause()` | store toggle; `<Player>` reacts |
| Next | `next()` | shuffle/repeat/scheduler-aware; throttled 400ms |
| Prev | `prev()` | 3s-rewind-or-prev; throttled 400ms |
| Queue item | `jumpTo(i)` | official selection; bounds-checked in store |
| Exit fullscreen | `exitPresentation()` | page-level; audio untouched |

## Guarantees
- **No separate audio element / playback engine** — the global `<Player>` remains sole owner.
- **No fullscreen-only queue, no cloned queue** — reads live `usePlayerStore.queue`.
- **No manual `index` writes** — only via `next`/`prev`/`jumpTo`.
- **No scheduler bypass / no analytics gap** — the `<Player>` performs transitions and its existing side effects (analytics, heartbeat, crossfade, recovery) fire exactly as before.
- **Rapid-click defense** — `navGuard` throttles next/prev to one call per 400ms, preventing double-advance / crossfade re-entry.

## Prev availability
`prev()` exists and is reused. It is disabled only when the queue is empty (`disabled={!hasQueue}`); within a queue it follows the store's existing prev semantics (does not corrupt the queue or bypass scheduler).
