# 03 — Seek Decision

## Investigation
Searched the store and audio controller for an official seek command (`seek`, `seekTo`, `setCurrentTime`, `setPlaybackPosition`, `scrubTo`, `setProgress`).
- `setCurrentTime` exists but only updates the **display** value, not the audio element.
- `pendingSeekSec` exists but is consumed only at `loadedmetadata` (session restore).
- A MediaSession `seekto` handler exists inside `Player.tsx` but is not a reusable app command.

**Conclusion: no reusable public seek command.**

## Decision: add a minimal seek on the single official path
Per the phase's "no official command" branch, a minimal `seekTo(sec)` was added to the store and applied **only inside the audio element owner** (`Player.tsx`):
- UI components never touch the audio DOM — they call `store.seekTo(sec)`.
- The store records `{ sec, trackId }`; the owner applies it to the active audio element and clears it (`consumeLiveSeek`).

## Safety
- **Track identity** — the owner applies only if the current track id still matches `trackId` (guards against a track change between request and apply).
- **Crossfade** — skipped while `crossfading` (brand mode has crossfade off).
- **Duration** — applied only when duration is finite & > 0; target clamped to `[0, duration-0.1]`.
- **Buffering / live / unknown-duration** — clamp + finite check makes these no-ops (bar shows `--:--` and is read-only when duration is pending).
- **Rapid drag** — pointermove coalesced via `requestAnimationFrame`; the actual seek fires once on pointer-up.
- **Track change mid-drag** — identity guard drops a stale seek; drag state cleared on unmount / pointercancel.
- **Analytics / Heartbeat** — no new stream event on seek; `currentTime` is kept in sync so heartbeat stays consistent.

Result: **seek is supported and interactive** (not read-only).
