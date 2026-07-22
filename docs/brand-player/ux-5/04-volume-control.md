# 04 — Volume Control

`src/components/brand/BrandVolumeControl.tsx` — reuses the existing store, no new volume state.

- **Source** — `usePlayerStore.volume` (0–1, persisted to localStorage by the store; applied to audio by `Player.tsx`).
- **Command** — `setVolume(v)`; UI 0–100 ↔ store 0–1 conversion in the component.
- **Mute** — `toggleMute()`; the store remembers `mutedVolume` and restores it on unmute.
- **Icon states** — `VolumeX` (0), `Volume1` (<50%), `Volume2` (≥50%).
- **Input** — range slider (pointer + touch + keyboard native); `compact` mode on mobile shows only the mute toggle.
- **Auto-hide** — drag calls `onHold(true/false)`; changes call `onActivity()` to keep the bar visible/reset the timer.

## Persistence & continuity
Because volume lives in the shared store (and localStorage), it is unchanged by: next/prev, queue selection, exiting fullscreen, and page refresh (existing persistence). The UI reflects `store.volume` directly, so **UI and audio never diverge** — there is no second source of truth.
