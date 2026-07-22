# 03 — Test Inventory (pre-recovery)

On Test before this phase:
- Present: brand_player_sessions + 0454 binding RPCs; tracks table (0 rows) with all needed columns; track_audio_features, track_ai_metadata, _ai_norm_genre; minimal enterprise_accounts/brand_accounts (0454 bootstrap).
- Absent: verify_store_code, get_brand_player_config, _brand_generate_playlist, _brand_signage_json, _brand_audit, brand_media_assets, brand_music_policies, brand_signage_settings, brand_audit_logs.
- Result: end-to-end brand player flow could not run.

Test migration history included settlement 0454/0455 + recovery 0457–0461 (Test is a curated replica; brand subsystem never applied).
