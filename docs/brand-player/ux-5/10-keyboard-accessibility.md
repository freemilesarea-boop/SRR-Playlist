# 10 — Keyboard & Accessibility

## Shortcuts (fullscreen)
| Key | Action | Guard |
|---|---|---|
| Space | Play/Pause | ignored when a BUTTON/INPUT is focused |
| ← / → | Prev / Next | ignored when an INPUT is focused; on the progress slider they seek (slider `stopPropagation`) |
| Q | Toggle queue | typed normally in the search input |
| F | Toggle fullscreen (page-level) | ignored when an INPUT/TEXTAREA is focused |
| Esc | Close queue, else exit fullscreen | drawer captures Esc first |

- Search input: Q/F/Space type normally (control handler early-returns on INPUT).
- Progress slider focused: ←/→/Home/End seek and `stopPropagation`, so they don't also change tracks.
- Volume slider focused: native arrow handling; the control handler early-returns on INPUT.

## ARIA / a11y
- Progress: `role="slider"`, `aria-valuemin/max/now`, `aria-valuetext` (formatted time), `aria-disabled` when duration pending.
- Volume: labeled button + `aria-valuetext` on the range.
- Shuffle/Repeat: labeled state (`aria-label`/`title`).
- Queue: `role="dialog"` + `aria-modal`, focus trap, focus returns to the queue button on close, `aria-current` on the playing item, search `type="search"` labeled.
- Buttons ≥44px; visible focus rings (`focus-visible:ring-accent`).
- Reduced motion honored across fades/transitions.
