# 01 — Current Architecture

## Entry
Route `/brand/player/:brandId` → `src/pages/BrandPlayerPage.tsx` (kiosk overlay, `fixed inset-0`).

## Audio ownership
The global `<Player>` (`src/components/player/Player.tsx`) owns the single `<audio>` element and reacts to `usePlayerStore` state (`index`/`playing`/queue). The brand player **only consumes** store state and calls store commands — it never mounts an audio element. This is the invariant that keeps analytics/heartbeat/crossfade/scheduler intact.

## Player store commands (`src/store/playerStore.ts`)
- `play()` / `pause()` / `toggle()`
- `next()` — shuffle/repeat-aware, respects `repeat='all'` loopback for brand 24h mode.
- `prev()` — 3s-rewind-or-previous, shuffle-aware.
- `jumpTo(i)` — **official queue-item selection**; sets index → global Player transitions.
All movement flows through these; the `<Player>` handles the audio/analytics side effects.

## Signage
`BrandSignage.tsx` cycles images (display-duration timer) and videos (natural end), with crossfade + bounded preload + broken-asset skip. Fullscreen ("presentation") was already implemented in the page via `requestFullscreen` on the signage container (+ CSS fallback), hiding chrome.

## Data
- `get_brand_player_config` → `BrandPlayerConfig { brand:{id,name,industry_type}, media[], signage, playlist }`. **No logo field.**
- Brand/service logo: singleton `brand_settings.logo_url` (migration `0213`), surfaced by `useBrandStore` / anon-granted `get_brand_settings()`.
- Track artwork: `TrackRow.cover_url`.

## UX-4 additions (all client-side)
- `src/lib/brandDisplayMode.ts` (+ test) — pure priority selector + media validity.
- `src/components/brand/BrandVisualStage.tsx` — renders the chosen mode.
- `src/components/brand/BrandFullscreenControls.tsx` — bottom control bar + auto-hide + input.
- `src/components/brand/BrandQueueDrawer.tsx` — queue viewer.
- `BrandSignage.tsx` — empty-state text removed; reports usable-media count upward.
- `BrandPlayerPage.tsx` — wires the stage + controls; loads brand logo.
