# 04 — Dependency Graph

```
verify_store_code
  └─ enterprise_accounts (store_invite_code, active)
       └─ brand_accounts (enterprise_account_id, active)
            └─ brand_player_sessions (INSERT: hash, user_id, expires_at, device_label)   [0454]
  └─ _brand_store_code_rate_limited → brand_store_code_attempts
  └─ _brand_audit → brand_audit_logs

get_brand_player_config
  └─ brand_player_sessions (binding guard: user_id + revoked + expires)                  [0454]
  └─ brand_accounts (active)
  └─ brand_music_policies (policy)
  └─ brand_media_assets (media)
  └─ _brand_signage_json → brand_signage_settings
  └─ _brand_generate_playlist → tracks (+ policy filters)

brand_player_heartbeat  → brand_player_sessions (binding guard)                          [0454]
verify_brand_device_binding / revoke_brand_device_by_token / list_my_brand_devices       [0454]
```

Each object: type / deps / required-for-QA / existing-in-test / recovery-method are recorded in 07–08.
