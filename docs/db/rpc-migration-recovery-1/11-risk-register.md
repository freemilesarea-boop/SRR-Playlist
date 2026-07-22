# 11 — Risk Register

| ID | Sev | Object | Evidence | Impact | Fix | Remaining |
|---|---|---|---|---|---|---|
| M-01 | P2 | 10 over-exposed admin readers (live in Prod) | metadata: authenticated grant, no guard | any authenticated user reads admin/curation/track data (no PII/money) | admin guard added on replace | 1 fixed (Test); 9 pending clusters C/D/E |
| M-02 | P1 | 24 RPCs + 3 tables still Production-only | this phase partial | Test/Preview can't exercise; repo↔prod drift persists | recover clusters B–E | pending |
| M-03 | P2 | Cron secret gate | DB-SCHEMA-RECONCILIATION-1 | daily-metrics 503 without CRON_SECRET | operator sets secret | UNVERIFIED |
| M-04 | P3 | support_inquiries PII in admin returns | table has contact_email/phone | admin-only exposure | keep admin-gated; mask later | deferred |
| M-05 | P3 | service_role not explicitly granted in 0457 | Test verify | none (service_role bypasses grants) | optional explicit grant | acceptable |
| M-06 | P3 | Cluster A repo/Test stricter than Prod (intended drift) | security fix | prod still over-exposed until apply | RPC-PRODUCTION-APPLY | tracked |

P0 0 · P1 1 (M-02 completeness) · P2 3.
