# 01 — Environment Certification

## Projects (via list_projects)
| Role | Ref | Name | Region |
|---|---|---|---|
| **Test** | `haojpuhztegecbrwqorr` | SRR Playlist **Test** | ap-southeast-1 |
| **Production** | `nsoesrvwkxqifjcxzvol` | SRR Playlist | ap-southeast-1 |

Distinct refs, hosts (`hao…qorr.supabase.co` vs `nso…zvol.supabase.co`), and names → **isolated**.

## Preview env pair — NOT SET (blocked)
```
Supabase URL Host: (not configurable here — Vercel Preview env is operator-controlled)
Anon Key Pair: UNKNOWN (Test anon key not available in this environment)
Production Ref Detected: N/A (no deploy attempted)
```
Because the Test URL + Test anon-key pair cannot be set on the Vercel Preview here, and deploying with the project's existing env could point at the Production host (`nso…zvol`) — a **P0** — **no deploy was attempted**. This is the phase's "Preview 환경변수 변경 권한 없음 / Preview 배포 불가" BLOCKED trigger.

## Test backend readiness — INSUFFICIENT for player QA
Queried Test (`hao…qorr`):
- `verify_store_code`: **absent**
- `get_brand_player_config`: **absent**
- `_brand_generate_playlist` / `_brand_signage_json` / `_brand_audit`: **absent**
- `brand_media_assets` / `brand_music_policies` / `brand_signage_settings`: **absent**
- Only `verify_brand_device_binding` / `revoke_brand_device_by_token` / `list_my_brand_devices` / hardened `brand_player_heartbeat` (from `0454`) exist.

So the end-to-end flow (store code → binding → config → playback) cannot run on Test. The binding **security** is certified; the **player** cannot be exercised.

## No Production access used for writes
Production was not written to and not deployed. All facts above are metadata reads.
