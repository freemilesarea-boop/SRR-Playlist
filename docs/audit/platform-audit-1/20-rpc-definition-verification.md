# 20 — RPC Definition Verification

> PLATFORM-AUDIT-1B · READ-ONLY. Machine-readable: `rpc-verification.json`. No RPC created/modified. No live DB connection (per absolute conditions).

## Method
For each RPC name called from `src`: searched for `create [or replace] function <name>` across **all** repo SQL (419 migrations + `supabase/schema.sql` + `seed.sql` + `admin.sql` + hotfix SQL), plus `git log -S'function <name>' --all` for deleted/renamed history, plus `grep rpc('<name>'` for the call site.

## Additional SQL sources checked (beyond migrations)
`supabase/schema.sql`, `supabase/seed.sql`, `supabase/admin.sql`, `supabase/admin_member_list_hotfix.sql`, `supabase/payment_hotfix.sql`, dev-seed files, diagnostic SQL — **none define the flagged RPCs**.

## Spot-check (4 of the set)
| RPC | Local def | Git-history def | src call sites | Status |
|---|---|---|---|---|
| `create_support_inquiry` | 0 | 0 | 1 | MISSING_CONFIRMED_LOCAL / UNVERIFIED_REMOTE |
| `admin_list_site_notices` | 0 | 0 | 1 | MISSING_CONFIRMED_LOCAL / UNVERIFIED_REMOTE |
| `get_admin_track_detail` | 0 | 0 | 1 | MISSING_CONFIRMED_LOCAL / UNVERIFIED_REMOTE |
| `apply_track_ai_predictions` | 0 | 0 | 1 | MISSING_CONFIRMED_LOCAL / UNVERIFIED_REMOTE |

## Count correction
PLATFORM-AUDIT-1 headline said **"29"**, but the enumerated list contains **31** distinct names. **Corrected count = 31** client-called RPCs with no local definition (headline undercounted by 2). Clusters: site-notices/settings (7), support-inquiries (7), AI-predictions (9), CLAP (5), track-admin (3).

## Classification
- **MISSING_CONFIRMED_LOCAL: 31** (no definition in any repo SQL or git history).
- **UNVERIFIED_REMOTE: 31** (may exist on the deployed DB if applied out-of-band).
- DEFINED_LOCAL / DEFINED_LEGACY / FALSE_POSITIVE: 0.

## Remote verification (proposed, read-only — NOT executed)
```sql
-- read-only, no mutation; run against the live DB with an appropriate role
select proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = any (array['create_support_inquiry','admin_list_site_notices', /* …31 names… */]);
```
Any name absent from that result is a genuine `MISSING` → runtime `PGRST202` when called. Not run this phase (no DB access) → remains **UNVERIFIED_REMOTE**.

## Verdict
**RPC FINDING CONFIRMED (local).** PLATFORM-AUDIT-1's undefined-RPC finding is real and reproducible; corrected count is **31** (not 29). Live-DB existence is UNVERIFIED and must be checked before treating these as broken. **No RPC was created** (per absolute conditions).
