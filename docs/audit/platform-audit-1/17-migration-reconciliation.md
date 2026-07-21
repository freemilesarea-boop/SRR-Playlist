# 17 — Migration Reconciliation

> PLATFORM-AUDIT-1B · READ-ONLY. Machine-readable: `migration-file-registry.csv` (419 rows), `migration-sequence-gaps.json`. No migration executed.

## Reconciliation metrics (direct recount)
| Metric | Value |
|---|---|
| Migration file count | **419** |
| Migration directories | 1 (`supabase/migrations`) — no archive/legacy dir |
| Minimum sequence | `0001` |
| Maximum sequence | **`0456`** |
| Missing sequence-number count | 50 |
| Missing ranges | `0198-0203, 0354, 0365-0366, 0408-0411, 0414-0419, 0421-0451` |
| Duplicate bare prefixes | 3 (`0068`, `0214`, `0388`) |
| Suffix-variant files (0167b, 0367a/b/c, …) | 11 |
| Deleted-from-history migrations | none found above current set |
| Files numbered > 0456 (any branch/any history) | **0** |

## The "419 vs 0571" difference
- The repository's highest migration number is **`0456`**, verified across the working tree **and** all git history (`git log --all --diff-filter=A`). **No file numbered 0457–0571 has ever existed** in this repo.
- 419 files span 0001–0456 with **50 gap-numbers** (squashed/abandoned branches) + **11 suffix variants** + **3 duplicate prefixes**. So `419 ≠ (max−min+1)` purely because of gaps and suffix/duplicate accounting.
- The externally-cited **"0001–0571"** cannot be reconciled to anything here. It is **not applicable to this repository** (different project state or an erroneous record) → **UNVERIFIED external claim, no action**.
- **Manual check to fully close this** (if the 0571 record must be explained): compare this repo's remote against any other repo/environment that reported 571; run `supabase migration list` against the deployed DB to confirm the applied set stops at 0456. Not performed here (no DB access).

## Audit-scope confirmation
- PLATFORM-AUDIT-1's "419 migrations" is **CORRECT**.
- Gap list, duplicate-prefix list, and destructive-op characterization all reproduce.
- No migration directory or archive was missed (only one migrations dir exists).
- **Nothing in the migration corpus was omitted from the audit.**

## Verdict
**MIGRATION COUNT VERIFIED — 419 files, max 0456. The 0571 figure does not correspond to this repository.**
