# 06 — Queue Viewer

`src/components/brand/BrandQueueDrawer.tsx` — right side drawer over the current queue.

## Data source
Reads `usePlayerStore` `queue` + `index` directly — the **existing** queue, no clone, no separate queue.

## Per-item display (safe fields only)
Cover thumbnail, title, artist, now-playing indicator (`Volume2` icon + "재생 중" + `aria-current`), play order (index number). 

**Never shown:** track UUID, storage path, signed URL, user id, AI scores, internal ops state, contract/settlement info. (Only `title`, `artist`, `cover_url` from `TrackRow` are rendered.)

## Selection
Click an item → `onSelect(i)` → `jumpTo(i)` (official command). Analytics/scheduler/queue state preserved because `jumpTo` just moves the index and the global `<Player>` performs the transition. Drawer stays open (convenient consecutive selection); the current-track highlight updates immediately.

## Sync
The list is derived from live store state, so it reflects auto-next, manual next, prev, queue refresh, scheduler queue replacement, skip, recovery, and re-entry with no extra wiring. Current track is highlighted; on open it auto-scrolls the current item into view (`scrollIntoView({block:'center'})`).

## Empty / error
Empty queue → "재생 가능한 곡이 없어요." A per-item cover load error hides the broken image (falls back to the music icon slot) without breaking the row.

## Accessibility
`role="dialog"` + `aria-modal`, focus moves to the close button on open, focus trap on Tab, `Escape` closes (capture + stopPropagation so it doesn't also exit fullscreen), focus returns to the queue button on close, `aria-current` on the playing item.
