# 16 — Risk Register
| ID | Sev | Object | Evidence | Impact | Fix | Remaining |
|---|---|---|---|---|---|---|
| B-01 | P3 | admin_note/assigned_admin_id to inquiry owner | own-detail returns full row | owner sees internal-ish fields (own inquiry only) | confirm admin_note = reply; split if internal | observation; contract-preserving |
| B-02 | P3 | file_url storage privacy | attachments store path | depends on bucket policy | Storage-layer review | separate phase |
| B-03 | P1 | Clusters C/D/E still Production-only | this phase = B only | 17 RPCs + drift remain | recover C/D/E | pending |
| B-04 | P2 | Cron secret gate (PLATFORM-HOTFIX-1) | prior | daily-metrics 503 | operator sets secret | UNVERIFIED |
P0 0 · P1 1 (completeness) · P2 1 · P3 2. Cluster B itself: no unresolved security defect (ownership + admin verified).
