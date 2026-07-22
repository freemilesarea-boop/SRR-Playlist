# 08 — Accessibility

- **aria-labels** on every control (prev/play-pause/next/queue/exit, drawer close, catcher).
- **Keyboard focus visible** — `focus-visible:ring-2 focus-visible:ring-accent` on all interactive controls.
- **Click targets** — transport buttons `p-3` (≥44px), play button 56px.
- **aria-current="true"** on the now-playing queue item.
- **Focus trap** in the queue drawer (Tab cycles within; first/last wrap).
- **Focus return** — closing the drawer returns focus to the queue button (`returnFocusRef`).
- **Dialog semantics** — drawer has `role="dialog"` + `aria-modal="true"` + `aria-label`.
- **Reduced motion** — artwork fade and bar transitions use `motion-safe:`/`motion-reduce:` variants; the signage already honors `prefers-reduced-motion`.
- **Escape** layering — drawer captures Escape first (close), else fullscreen exits.
- **Space guard** — Space is ignored when a BUTTON/INPUT is focused, so it doesn't double-trigger a focused control.

## Touch / mobile (12)
- Tap toggles the control bar; the catcher is disabled while the drawer is open so scrolling the queue doesn't conflict.
- Drawer list is scrollable (`overflow-y-auto overscroll-contain`) and width-capped (`min(92vw,380px)`) for portrait.
- Transport buttons are large; the bar respects `env(safe-area-inset-bottom)`.
- Layout uses relative units → portrait and landscape both hold without breaking.
