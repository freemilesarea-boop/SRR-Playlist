# 02 — Production Inventory (read-only)

Brand player backend on Production (`nso…zvol`), metadata only — no rows read.

## Tables (structures captured)
enterprise_accounts, brand_accounts, brand_player_sessions, brand_media_assets, brand_music_policies, brand_signage_settings, brand_audit_logs.

## Functions (bodies captured for recovery)
- verify_store_code(text) — authenticated; issues token, stores sha256 hash, user_id=auth.uid(); no expires_at enforced; no user check on config.
- get_brand_player_config(uuid,text) — validates token hash + brand active; **no user_id/revoke/expiry check**; returns brand/policy/media/signage/playlist.
- brand_player_heartbeat(uuid,text,uuid,text) — token-hash only (hardened separately in 0454).
- _brand_audit(uuid,text,jsonb); _brand_signage_json(uuid); _brand_generate_playlist(uuid,int) — complex recommendation using tracks + track_audio_features + track_ai_metadata + _ai_norm_genre + policy.

## Dependencies of _brand_generate_playlist
brand_music_policies, tracks (many cols), track_audio_features(energy), track_ai_metadata(ai_moods), _ai_norm_genre. (Test has the aux tables + _ai_norm_genre, but 0 tracks.)

No pg_dump; no bulk copy; no Production rows/PII/store-codes/secrets read.
