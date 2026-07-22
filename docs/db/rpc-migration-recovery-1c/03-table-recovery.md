# 03 — Table Recovery: `track_ai_predictions`

Migration: `supabase/migrations/0459_track_ai_predictions_recover.sql`.

## Columns (22)
| Column | Type | Null | Note |
|---|---|---|---|
| id | uuid | no | PK, default `gen_random_uuid()` |
| track_id | uuid | no | FK → `tracks(id)` ON DELETE CASCADE |
| model_version | text | no | default `'laion-clap-music-v1+librosa'` |
| predicted_energy_level | integer | yes | |
| energy_confidence | numeric(4,3) | yes | |
| predicted_bpm | integer | yes | |
| bpm_confidence | numeric(4,3) | yes | |
| predicted_tempo_feel | text | yes | |
| energy_label_scores | jsonb | yes | raw payload — **never returned by readers** |
| applied_at | timestamptz | yes | null = pending |
| applied_by | uuid | yes | FK → `users(id)`; audit actor |
| created_at | timestamptz | no | default `now()` |
| predicted_main_genre | text | yes | |
| predicted_sub_genres | text[] | yes | |
| predicted_moods | text[] | yes | |
| predicted_store_types | text[] | yes | |
| predicted_dayparts | text[] | yes | |
| genre_confidence | numeric(4,3) | yes | |
| mood_confidence | numeric(4,3) | yes | |
| store_type_confidence | numeric(4,3) | yes | |
| daypart_confidence | numeric(4,3) | yes | |
| prediction_scores | jsonb | yes | raw payload — **never returned by readers** |

## Constraints / FK
- PK: `id`.
- Unique: `(track_id, model_version)` — one prediction per model per track (upsert key).
- FK `track_id` → `tracks(id)` ON DELETE CASCADE (predictions vanish with the track).
- FK `applied_by` → `users(id)` (nullable; set on apply).

## Indexes (8 total)
- PK index + unique-constraint index.
- `track_ai_predictions_track_idx` btree(track_id).
- `track_ai_predictions_unapplied_idx` btree(created_at desc) **WHERE applied_at is null** (queue scan).
- `track_ai_predictions_main_genre_idx` btree(predicted_main_genre) WHERE not null.
- GIN on `predicted_dayparts`, `predicted_moods`, `predicted_store_types`.

## RLS
- `enable row level security`.
- Policy `track_ai_predictions_admin_read` (SELECT): `auth.uid()` is admin. Direct table access is admin-only; non-admin/anon cannot read rows even if grants were widened.

## Drift-hiding note
`IF NOT EXISTS` is used only because the object is genuinely absent on Test/Repo (Production-only drift being recovered), not to mask an existing divergence. The definition matches Production 1:1.
