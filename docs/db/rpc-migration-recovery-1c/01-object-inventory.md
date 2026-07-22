# 01 — Cluster C Object Inventory

Source: Production metadata (read-only via `pg_catalog`), RPC registry, repository call sites. No Production rows read, no RPC executed.

## Table (1)
| Object | Status (Repo/Test/Prod) | Notes |
|---|---|---|
| `public.track_ai_predictions` | ABSENT / ABSENT / PRESENT → **PRODUCTION_ONLY** | Backing store for CLAP+librosa metadata predictions. Recovered in `0459`. |

## RPCs (4)
| RPC | Signature | Return | Prod security | Class | Action |
|---|---|---|---|---|---|
| `ai_predictions_summary` | `()` | `table(5)` | DEFINER, `language sql`, **no admin check**, granted `authenticated` | Admin reader | SECURITY FIX (plpgsql + admin guard) |
| `list_pending_ai_predictions` | `(p_limit integer default 50)` | `table(16)` | DEFINER, `language sql`, **no admin check**, granted `authenticated` | Admin reader | SECURITY FIX (plpgsql + admin guard) |
| `apply_track_ai_predictions` | `(uuid, boolean, boolean, boolean, boolean)` | `void` | DEFINER, plpgsql, **admin-guarded**, actor=`auth.uid()` | Admin write | VERBATIM |
| `bulk_apply_high_confidence_ai_predictions` | `(numeric, integer)` | `integer` | DEFINER, plpgsql, **admin-guarded**, actor=`auth.uid()` | Admin write | VERBATIM |

## Not present in Cluster C
- No user/track-owner reader RPC (predictions are admin-only ops metadata).
- No service-only RPC (write actor is the admin operator via `auth.uid()`, not a cron/service role).
- No status-enum mutation beyond the `applied_at` stamp (idempotent apply).

## Confirmed pre-state on Test (before apply)
- `public.tracks` present with `energy_level`, `bpm`, `tempo_feel`, `visibility_status`, `removed_at`, `title`, `artist`, `cover_url`, `main_genre`, `sub_genre`.
- `public.track_ai_predictions` absent; all 4 RPCs absent.
- Max migration `0458` (Cluster B). No number collision at `0459`.
