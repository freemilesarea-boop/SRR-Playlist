# 02 — Brand Asset Priority

## Single selector
`resolveBrandDisplayMode()` in `src/lib/brandDisplayMode.ts` is the only place the mode is decided. Every component reads the result; no duplicated conditionals.

```ts
type BrandPlayerDisplayMode = 'BRAND_MEDIA' | 'BRAND_LOGO' | 'TRACK_ARTWORK' | 'DEFAULT_FALLBACK';
```

## Decision
```
usableMediaCount > 0            → BRAND_MEDIA
else logoUrl (non-empty)        → BRAND_LOGO
else artworkUrl & !failed       → TRACK_ARTWORK
else                            → DEFAULT_FALLBACK
```

## Inputs
- `usableMediaCount` = `filterValidSignageItems(media)` minus runtime-broken (reported by `BrandSignage.onUsableCountChange`). Array length alone is never used.
- `logoUrl` = `useBrandStore((s) => s.logo_url)` (service/brand logo; trimmed non-empty).
- `artworkUrl` = current track `cover_url`; `artworkFailed` tracked in a failed-URL set.

## Media validity (`isValidSignageItem`)
Invalid → excluded: empty/whitespace URL; unsupported format (mime not image/*·video/* when no `asset_type`). Server RPC already excludes deleted/inactive/out-of-window assets. Runtime load failures are excluded via the broken set (no infinite retry).

## Logo priority note
The phase's ideal chain is Player/Store → Brand → Enterprise/HQ → artwork. The data model currently has only the **service-level** `brand_settings.logo_url` (no per-franchise/enterprise logo columns). Rather than add speculative columns/admin flows (out of scope, and the phase forbids duplicate columns when a field exists), UX-4 uses the existing service logo as the single logo source. A future phase can introduce per-brand logos and slot them ahead in the same selector without touching call sites.
