# 05 — Fullscreen Controls

`src/components/brand/BrandFullscreenControls.tsx`, rendered inside the presentation container (so it lives in native fullscreen), `active={presentation}`.

## Visibility / auto-hide
- Default visible on entering fullscreen.
- Auto-hides 3s (`AUTO_HIDE_MS`) after the last interaction **only while playing**.
- Always visible (no hide) when: paused, queue open, pointer hovering the bar, or keyboard focus within the bar (`onFocus`/`onBlur` + `hoveringRef`).
- Revealed by: any `mousemove` (window listener), entering the bottom detection zone, touch tap, track change, pause, or queue open.

## Bottom detection zone
A `pointer-events-auto` strip covering the bottom **20%** of the screen (`h-[20%]`) reveals on enter/move (only active while hidden, so it doesn't block content once shown). No 1px-exact requirement.

## Touch
A transparent full-area catcher toggles the bar on tap (reveal when hidden; hide when shown & playing). It sits below the bar (z-120 vs z-121) so bar buttons and the queue drawer aren't blocked, and is disabled while the queue is open (the drawer backdrop handles dismissal). `tabIndex=-1` keeps it out of tab order.

## Keyboard
`Space` play/pause (skipped when a BUTTON/INPUT is focused to avoid double-fire), `ArrowRight` next, `ArrowLeft` prev, `Q` toggle queue, `Escape` closes queue then exits fullscreen.

## Fullscreen persistence
None of next/prev/play-pause/queue-open/select/artwork-change/media-change/image-error/video-end/queue-refresh exits fullscreen — they only mutate store state or local UI. Only `Escape` / the Exit button call `exitPresentation`. Browser-forced exit falls back safely to the normal player screen (existing `fullscreenchange` handler).

## Timers/listeners cleanup
Hide timer, mousemove listener, keydown listener are all cleaned up on `active` change / unmount.
