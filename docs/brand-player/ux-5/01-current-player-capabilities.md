# 01 — Current Player Capabilities (audit)

| Capability | Source | Reused as-is? |
|---|---|---|
| Audio element owner | global `<Player>` (`audioARef`/`audioBRef`, `activeRef()`) | yes (sole owner) |
| Current time | `usePlayerStore.currentTime` (timeupdate) | yes |
| Duration | `usePlayerStore.duration` | yes |
| Play/Pause | `play()`/`pause()`/`toggle()` | yes |
| Next/Prev | `next()`/`prev()` | yes |
| Queue select | `jumpTo(i)` | yes |
| Volume | `volume` (0–1, localStorage) + `setVolume` | yes |
| Mute | `volume===0` + `toggleMute` + `mutedVolume` restore | yes |
| Shuffle | `shuffle` + `setShuffle` | state read-only in brand UI |
| Repeat | `repeat` + `setRepeat` | state read-only in brand UI |
| Queue | `queue`/`index` | yes (no clone) |
| History | **none** | omit 최근 재생 |
| Seek | **none public** (only MediaSession `seekto` + restore `pendingSeekSec`) | **added** `seekTo` |

## Seek addition
`seekTo(sec)` added to the store; applied to `audio.currentTime` **only** in `Player.tsx` (owner) via a guarded effect:
```
if (audio && curId === liveSeek.trackId && !crossfading && Number.isFinite(d) && d > 0) {
  audio.currentTime = clamp(sec, 0, d - 0.1); setCurrentTime(target);
}
consumeLiveSeek();
```
- **Track identity** (`trackId`) prevents a seek landing on a different track after a change.
- **Crossfade skip** (brand mode has crossfade off anyway).
- **Duration clamp** guards live/unknown-duration tracks.
- No new analytics event (seek within a track); heartbeat reads the synced `currentTime`.
