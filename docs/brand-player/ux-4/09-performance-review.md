# 09 — Performance & Stability

## Guarantees
- **No per-track full remount** — the visual stage swaps images by keyed `<img>`; the audio element (owned by global `<Player>`) is never remounted or recreated.
- **No queue re-fetch on track change** — queue comes from the store.
- **No infinite render** — mode is derived synchronously; `onModeChange`/`onUsableCountChange` use stable setters; effects have precise deps.
- **No repeated image requests** — failed cover/logo URLs are recorded in a `Set` (`failedArtwork`) and not retried; signage keeps its own broken set.
- **No memory/Blob leak** — only remote URLs used (no `URL.createObjectURL`); no blob URLs created.
- **Video/audio isolation** — signage videos are `muted`; audio is the global element. No new video element in logo/artwork/fallback modes.
- **Timer/listener cleanup** — hide timer, mousemove, keydown, fullscreen listeners, and the signage fade timer are all cleared on unmount/`active` change.

## Memoization
- `validMedia` via `useMemo`.
- Display mode computed from primitives (cheap; no memo needed).
- Command wrappers via `useCallback`.

## Preload
Current artwork shown immediately; next cover preloaded via hidden `<img>`. Signage retains its bounded preload (max ~4 mounted media).
