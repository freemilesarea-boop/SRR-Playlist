# 16 — Security Certification

- **Anonymous**: verify_store_code → not_authenticated; get_brand_player_config → unauthorized. All new RPCs revoke public/anon.
- **Cross-user**: get_brand_player_config + verify_brand_device_binding + heartbeat enforce `user_id = auth.uid()` → other user blocked (not_owner / invalid session); config error does not reveal ownership detail.
- **Cross-brand**: token bound to brand; a token used for a different brand → invalid session (no hash match).
- **Revocation / Expiration**: get_config + heartbeat + verify fail-closed on revoked/expired.
- **Token hash**: only sha256 hash stored; plaintext token returned once; never logged.
- **Store code**: server-verified only; not stored plaintext client-side (client stores the opaque device token).
- **RLS**: enabled on all new tables (default deny + admin-read).
- **RPC hygiene**: SECURITY DEFINER + search_path pinned + fixed safe error tokens; helpers definer-only.
- **Rate limit**: 5-fail/10-min per auth.uid().

All verified by the synthetic SQL suite (`15-runtime-smoke.md`).
