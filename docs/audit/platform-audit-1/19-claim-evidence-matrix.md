# 19 — Claim → Evidence Matrix

> PLATFORM-AUDIT-1B · READ-ONLY. Machine-readable: `audit-claims.json`. Every quantitative claim linked to a reproducible command/file.

| ID | Claim | Reported | Verified | Evidence command | Match |
|---|---|---|---|---|---|
| C-01 | TS/TSX in src | 443 | 443 | `find src -name '*.ts' -o -name '*.tsx' \| wc -l` | ✓ |
| C-02 | migration files | 419 | 419 | `ls supabase/migrations/*.sql \| wc -l` | ✓ |
| C-03 | max migration no. | 0456 | 0456 | prefix sort; `git log --all` confirms none >0456 | ✓ (0571 N/A) |
| C-04 | edge functions | 20 | 20 | `ls -d supabase/functions/*/ \| wc -l` | ✓ |
| C-05 | serverless handlers | 3 | 3 | `find api -name '*.ts' \| wc -l` | ✓ |
| C-06 | routes | 41 | 41 | `grep -c '<Route ' src/App.tsx` | ✓ |
| C-07 | admin tabs | 68 | **65** | TABS array `{id/key:'…'}` entries | ✗ → 65 |
| C-08 | top-level features | ~65 | ~65 (66 rows) | `feature-registry.json` | ✓ |
| C-09 | algorithms | 46 | 46 | `algorithm-registry.json` | ✓ |
| C-10 | RLS policies | 336 | 336 | `grep -ci 'create policy' migrations` | ✓ |
| C-11 | RLS enable stmts | 203 | **202** | sum `grep 'enable row level security'` | ✗ ≈ |
| C-12 | undefined client RPCs | 29 | **31** enumerated (4/4 confirmed) | `grep function def *.sql` + `git log -S` | ✗ → 31 |
| C-13 | dead tables | 3 | 3 (+4 V2 shadow) | migration scan | ✓ |
| C-14 | deprecated worker | 1 | 1 | `tools/embedding_worker/worker.py` | ✓ |
| C-15 | vitest pass | 129/129 | 129 | `grep -c it/test` + `vitest run` | ✓ |
| C-16 | 1,462 tests (external) | 1462 | **not found** (129/273) | grep + history | ✗ N/A |
| C-17 | P0 | 0 | 0 | risk-register | ✓ |
| C-18 | P1 | 4 | 4 | risk-register | ✓ |
| C-19 | Player.tsx LOC | 2970 | 2970 | `wc -l` | ✓ |
| C-20 | Player useEffect | 32 | **29** | `grep -c 'useEffect('` | ✗ → 29 |
| C-21 | exhaustive-deps suppress | 54 | 54 | `grep exhaustive-deps` | ✓ |
| C-22 | eslint-disable total | 59 | 59 | `grep eslint-disable` | ✓ |
| C-23 | DEFINER no search_path | 5 | 5 | per-file grep | ✓ (same files) |
| C-24 | prod dep vulns | 2 mod | UNVERIFIED | `npm audit` (time-varying, not re-run) | ~ |
| C-25 | dev dep vulns | 1 crit/3 high | UNVERIFIED | `npm audit` (time-varying) | ~ |
| C-26 | Google OAuth risk | at-risk | code confirmed; external UNVERIFIED | `05-*` trace | ~ |

## Tally
- **Verified exact:** 18
- **Minor corrections:** 4 (C-07 68→65, C-11 203→202, C-12 29→31, C-20 32→29)
- **External/time-varying UNVERIFIED:** 3 (C-24, C-25, C-26)
- **External record not applicable:** 1 (C-16 = 1,462 tests; also 0571 migrations under C-03)

**Conclusion:** No fabricated or materially wrong claim. All corrections are small over/under-counts or explicit UNVERIFIED reclassifications; none changes the audit's risk posture.
