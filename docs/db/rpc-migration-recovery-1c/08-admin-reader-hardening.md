# 08 — Admin Reader Hardening

## Over-exposed readers identified (2)
Both were, in Production, `SECURITY DEFINER` + `language sql` + granted to `authenticated` with **no in-function admin check** → any logged-in user could read internal AI-ops data (RLS bypassed by DEFINER). This is the P2 finding from DB-SCHEMA-RECONCILIATION-1 for Cluster C.

| Reader | Fix |
|---|---|
| `ai_predictions_summary()` | `sql`→`plpgsql`; admin guard prepended; signature/return preserved |
| `list_pending_ai_predictions(integer)` | `sql`→`plpgsql`; admin guard prepended; signature/return preserved |

## Applied controls (both)
- `auth.uid()` existence + real admin role check **before any row is read** (`if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'unauthorized'`).
- Unauthorized caller receives **zero rows / zero columns** (exception, not partial data).
- **Return column minimized** — no jsonb payloads, no actor, no model-internal paths.
- **Limit / ordering:** `list_pending` has `limit p_limit` (default 50) and a stable `order by energy_confidence desc nulls last, created_at desc`. `summary` returns a single aggregate row.
- **No dynamic SQL** — both are static queries; no injection surface. No user-controlled sort/filter string (only a numeric limit).

## Contract preservation
Return column list and identity args are byte-identical to Production; the client (already an admin) sees no behavioral change except that non-admins are now correctly rejected. Verified on Test: both functions report `plpgsql secdef=true` with the original arg/return signatures.

## Write RPCs
`apply_track_ai_predictions` and `bulk_apply_high_confidence_ai_predictions` already contained the identical admin guard in Production and were recovered verbatim (see `09-write-rpc-review.md`).
