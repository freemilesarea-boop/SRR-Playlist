# 07 — Queue Sections

`buildQueueSections(queue, index, shuffle, shuffleOrder)` (pure) drives the drawer's non-search view.

## Sections
- **현재 재생 중** — the single current track (`index`), with now-playing indicator.
- **다음 재생** — tracks that will actually play next:
  - shuffle on + valid `shuffleOrder` → items after the current position in `shuffleOrder` (real play order, scheduler order preserved).
  - otherwise → linear items after `index`.
  Each item carries its **original queue index**; click → `jumpTo(originalIndex)`.
- **최근 재생** — **omitted.** The player has no history stack (`prev()` is index-based, not a history pop). Per the phase, no fake history is created and the queue front is not mislabeled as "recent".

## Search mode
When a search term is present, the drawer switches to a **flat result list** (from `searchQueue`), each row still selecting via `originalIndex`. The current track is highlighted if it appears in results.

## Tests
`buildQueueSections` unit-tested for: linear current+upcoming, index 0, last index (no upcoming), shuffle order following, shuffle-order-missing linear fallback, empty queue.
