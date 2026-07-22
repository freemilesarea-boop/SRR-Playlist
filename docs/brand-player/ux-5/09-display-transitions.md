# 09 — Display Transitions

## Mode fade
`BrandVisualStage` wraps the chosen mode's content in `<div key={mode} className="… motion-safe:animate-[fadeIn_250ms_ease-in-out]">`. A fade plays on every mode change:
- Brand Media → Brand Logo
- Brand Logo → Track Artwork
- Track Artwork → Default Fallback
- Failed Media → Logo, Failed Logo → Artwork

## Artwork A → B
Within TRACK_ARTWORK the mode key stays constant (no remount), and the cover swap fades via the URL-keyed foreground `<img>` (`animate-fadeIn`, 400ms).

## Guarantees
- **Independent of audio crossfade** — pure CSS opacity on visual elements; audio state never changes.
- **No full-player remount** — the fade key is `mode`, scoped to the visual stage; the global `<Player>`/audio element is untouched.
- **Timer cleanup** — CSS animations need no JS timers; the signage's own fade timer is cleared on unmount (UX-4). Artwork failed-set prevents infinite retries.
- **Rapid track changes** — keying by URL/mode means a new change simply restarts the CSS animation; no flicker accumulation, no leaked timers.
- **Reduced motion** — all fades are `motion-safe:` (removed under `prefers-reduced-motion`).
