# 06 — Queue Search

`src/lib/queueSearch.ts` (pure) + `src/components/brand/BrandQueueSearch.tsx` + integrated into `BrandQueueDrawer`.

## Fields
Searches **title, artist, album** only. Never searches UUID, storage path, signed URL, internal metadata, AI score, contract/settlement data.

## Rules
- Case-insensitive, trimmed.
- Korean / English / numbers supported (`String.includes` on lowercased values).
- Empty term → full queue (sections view).
- No-result state shown ("검색 결과가 없어요").
- Client-side over the **current** queue only — no new DB query.
- Re-derived via `useMemo(queue, term)`, so queue changes auto-refresh results.

## Original-index safety (critical)
`searchQueue` returns `QueueSearchItem { track, originalIndex }`. The UI selects with `onSelect(item.originalIndex)` → `jumpTo(originalIndex)`. The filtered array index is **never** passed to `jumpTo`. Unit tests assert `originalIndex` is preserved for title/artist/album/Korean/number/whitespace matches.

## Performance
Filtering is a single `.map` + `.filter` over the in-memory queue (O(n)); no debounce needed at typical sizes. Rows use stable `track.id` keys and `loading="lazy"` covers. Tested with the pure function; large-queue behavior covered in `11-performance-review.md`.
