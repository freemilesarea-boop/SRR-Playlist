# 09 — RPC Registry Update

- **Removed from allowlist (now local defs via 0457):** get_site_settings, list_active_site_notices, admin_list_site_notices, admin_upsert_site_notice, admin_toggle_site_notice, admin_delete_site_notice, admin_update_site_settings (7).
- **Remaining allowlisted:** 24 (clusters B–E) — each tied to its pending recovery migration.
- **`lint:rpc` result:** 725 call names, **953 local defs (+7)**, **24 undefined (−7), all allowlisted, 0 new → PASS**.
- Goal of 0 remote-only entries reached for Cluster A; 24 remain with explicit follow-up (`_recovered` note in the allowlist file).
