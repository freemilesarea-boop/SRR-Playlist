-- ============================================================
-- 0228b_create_track_ai_predictions_base.sql
--
-- 목적: Empty Database 전체 Migration Replay 시 0229_phase_x1_extend_track_ai_predictions.sql
--       에서 발생하는 실패를 해소한다.
--
--       ERROR: relation "public.track_ai_predictions" does not exist
--
-- Root Cause (실측 — Repository 내부 증거만 사용, Production 미접근):
--   · Repository 전체(migrations 및 그 외 .sql)에 public.track_ai_predictions 의
--     CREATE TABLE / VIEW / MATERIALIZED VIEW / FOREIGN TABLE 가 **존재하지 않는다**.
--   · 0229 는 이 테이블을 생성하지 않고 `alter table public.track_ai_predictions add column …`
--     로 **확장만** 한다. 0229 주석은 "기존 컬럼 … 기존 169행"을 전제(=이미 존재 가정).
--   · 따라서 원본 CREATE 는 Repository 에 커밋되지 않았고(Production 에 out-of-band 로만 존재하는
--     것으로 **추론**되나, Production DB 는 접근하지 않아 확정하지 않음), Empty DB 에서는
--     0229 의 ALTER 가 첫 접촉에서 실패한다.
--
-- 이 마이그레이션 (0228_ 뒤, 0229_ 앞 정렬):
--   · `create table if not exists` → **Production 에 이미 존재하면 no-op**, Empty DB 에서는 생성.
--   · 0229 의 ALTER(taxonomy 컬럼 add column if not exists) 및 후속 사용 마이그레이션이
--     요구하는 **최소 base 스키마만** 포함한다.
--
-- 포함 컬럼 (모두 Repository 증거로 타입 확인 — 아래 근거):
--   id            uuid       — 예측 row 식별자. src/lib/trackAiPredictionsApi.ts `id: string`,
--                              apply 흐름의 p_prediction_id. (surrogate PK, Supabase 관례)
--   track_id      uuid       — 0230: `p.track_id = t.id`(tracks.id join), insert 대상,
--                              conflict target. NOT NULL.
--   model_version text       — 0230: conflict target, `= 'taxonomy-v1'` 텍스트 비교, insert 대상.
--                              NOT NULL.
--   applied_at    timestamptz— 0230 RETURNS TABLE `applied_at timestamptz`, `set applied_at=now()`,
--                              `applied_at is null`. nullable.
--   applied_by    uuid       — 0230: `applied_by = v_admin` (v_admin uuid := auth.uid()). nullable.
--   created_at    timestamptz— 0230: `p.created_at`, order by. default now().
--
-- 필수 제약:
--   unique (track_id, model_version) — 0230 의 `insert … on conflict (track_id, model_version)`
--                                      가 요구하는 conflict target. 반드시 필요.
--
-- **의도적으로 제외** (추측·미사용 금지 원칙 준수):
--   · energy 계열 base 컬럼(predicted_energy_level, energy_confidence, predicted_bpm,
--     bpm_confidence, predicted_tempo_feel, energy_label_scores):
--       0229 주석에는 있으나 **어떤 migration 도 참조하지 않는다(0회)**. 오직 out-of-band
--       Modal worker + (Repository 에 없는) store_track_ai_predictions RPC 로만 채워진다.
--       정확한 SQL 타입을 DDL 증거로 확정할 수 없어(추측 금지) 이 base 에서 제외한다.
--       Replay 성공에는 불필요하며, Production 은 if-not-exists 로 무영향.
--   · FK(track_id→tracks, applied_by→users): join 사용은 확인되나 FK 제약 존재는
--     Repository 로 확정 불가 → 생략(FK 로 replay 순서를 깨지 않도록).
--   · RLS / Policy / Trigger / 169행 데이터: 증거 없음 → 추가하지 않음.
--   · 0229 이후 migration 이 추가하는 taxonomy 컬럼: 선반영하지 않음(0229 가 add column).
-- ============================================================

create table if not exists public.track_ai_predictions (
  id            uuid primary key default gen_random_uuid(),
  track_id      uuid not null,
  model_version text not null,
  applied_at    timestamptz,
  applied_by    uuid,
  created_at    timestamptz not null default now(),
  constraint track_ai_predictions_track_model_uniq unique (track_id, model_version)
);
