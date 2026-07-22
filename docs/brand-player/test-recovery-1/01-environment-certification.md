# 01 — Environment Certification

| Role | Ref | Name |
|---|---|---|
| Test | `haojpuhztegecbrwqorr` | SRR Playlist **Test** |
| Production | `nsoesrvwkxqifjcxzvol` | SRR Playlist |

Distinct refs/hosts/names → isolated (via list_projects). All writes (apply_migration + seed) targeted **Test only**; Production accessed **read-only** for metadata/function defs (no rows, no writes, no deploy). Branch `claude/brand-test-recovery-1` from `91cac07` (incl. binding `9358d5e`); working tree clean at start; next migration number `0455`.

Rollback strategy: `docs/brand-player/test-recovery-1/rollback.sql` (Test only) removes the synthetic seed + 0455 RPCs/tables, preserving the 0454 binding structures.
