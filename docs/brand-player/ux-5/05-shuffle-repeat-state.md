# 05 — Shuffle / Repeat State

Read from the real store (`shuffle`, `repeat`) — no UI-only fake state.

- **Shuffle** — `Shuffle` icon, accent when `shuffle===true`, dim otherwise. `aria-label`/`title` reflect state.
- **Repeat** — `Repeat` icon (dim) for `off`, accent `Repeat` for `all` (전체 반복), accent `Repeat1` for `one` (한 곡 반복).

## Read-only decision
`setShuffle`/`setRepeat` commands exist, but the brand player enforces `shuffle=true` + `repeat='all'` for 24h continuous playback (set in `BrandPlayerPage.loadConfig`). Exposing toggles here would fight that policy and could be silently reset on the next config refresh. Per the phase ("토글은 기존 command가 있을 때만; 없으면 read-only, fake toggle 금지"), UX-5 provides **accurate read-only indicators** and does not add toggles. The indicators always match the actual queue/playback policy because they read the store directly.
