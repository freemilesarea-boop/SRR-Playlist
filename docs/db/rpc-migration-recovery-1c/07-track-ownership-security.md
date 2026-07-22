# 07 — Track Ownership & Subject Isolation

## Applicability
There is **no user- or track-owner-facing prediction RPC** in Cluster C. Predictions are not scoped per user — they are internal ops artifacts applied to globally-shared, admin-moderated `tracks`. Therefore per-owner subject isolation does not apply; the isolation boundary is **admin vs everyone else**.

## Enforced isolation properties
1. **Caller must be authenticated** — every RPC guards on `auth.uid()`; anon (`{}` claims) → `auth.uid()` null → guard fails.
2. **Actor determined server-side** — `auth.uid()`; client-supplied `user_id`/`actor_id` is never accepted (no such parameter exists on any RPC).
3. **Non-admin cannot read predictions** — the 2 readers now reject non-admins; direct table access is blocked by the `track_ai_predictions_admin_read` RLS policy (admin-only SELECT).
4. **Object-existence not leaked** — a non-admin gets a uniform `unauthorized` before any row is touched; they cannot probe whether a prediction exists for a given track id.
5. **Removed/unapproved tracks** — readers filter `visibility_status='approved' and removed_at is null`; apply/bulk operate through the same track table and respect its constraints.

## Ownership source
`tracks` ownership/relationship columns were **not assumed**. Because no owner-scoped reader is being created, no ownership column is referenced by Cluster C code. The only track columns touched are the moderation/metadata fields verified to exist (`visibility_status`, `removed_at`, `energy_level`, `bpm`, `tempo_feel`).

## Verification
Synthetic non-admin user was blocked on all 4 RPCs and could not read the table directly (RLS). See `13-sql-security-tests.md`.
