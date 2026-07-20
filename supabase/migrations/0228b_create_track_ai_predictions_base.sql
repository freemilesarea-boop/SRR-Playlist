-- ============================================================
-- 0228b_create_track_ai_predictions_base.sql
--
-- 목적: Empty Database 전체 Migration Replay 시 0229_phase_x1_extend_track_ai_predictions.sql
--       에서 발생하는 실패를 해소한다.
--
--       ERROR: relation "public.track_ai_predictions" does not exist
--
-- Root Cause: public.track_ai_predictions 의 원본 CREATE 가 Repository/git history 어디에도
--   커밋되지 않았다(Production 에 out-of-band 로만 존재). 0229 는 이 테이블을 생성하지 않고
--   `alter table … add column` 으로 확장만 하므로, Empty DB 에서는 0229 의 ALTER 가 첫 접촉에서
--   실패한다.
--
-- Base Schema 근거 (권위 있는 Production schema metadata + store_track_ai_predictions RPC 정의로
--   확정 — AI-ENV-2D-HOTFIX-4-PRODUCTION-SCHEMA-READ 단계에서 read-only 조회):
--     · Production `public.track_ai_predictions` 컬럼 1~12 = Base(아래), 13~22 = 0229 가 add.
--     · store_track_ai_predictions(uuid,integer,numeric,integer,numeric,text,jsonb,text) 파라미터
--       및 INSERT 가 energy 계열 6컬럼의 SQL 타입을 이중 확인.
--
-- Chronology (실측 대조):
--     · 0229 의 ALTER 는 정확히 taxonomy 10컬럼(predicted_main_genre/…/prediction_scores)만 add.
--       Base 12컬럼은 어떤 migration 도 추가하지 않음 → 반드시 0229 이전에 존재해야 함.
--     · 0235/0238 등 이후 migration 은 track_ai_predictions 를 ALTER 하지 않고 사용만 함.
--       → Production 22컬럼 = Base 12 + 0229 10, overlap/gap 없음.
--
-- 이 마이그레이션은 **0229 이전에 존재해야 하는 Base Object 만** 생성한다 (Production 전체 복사 아님):
--   · `create table if not exists` (Production no-op / Empty DB 생성)
--   · Base 컬럼 12개 + 정확한 타입/nullable/default
--   · PK(id), FK(track_id→tracks ON DELETE CASCADE), FK(applied_by→users), UNIQUE(track_id, model_version)
--
-- **의도적으로 제외** (이 Phase 지시: Base Object 만):
--   · RLS / Policy(track_ai_predictions_admin_read) / Trigger — Production 에는 존재하나 Base
--     구조가 아니며 지시상 제외.
--   · Base 성능 인덱스(track_idx, unapplied_idx) 및 0229 이후 taxonomy 인덱스 — 제외.
--   · 0229 이후 컬럼(13~22) 및 후속 migration 객체 — 선반영하지 않음(0229 가 add).
--   · store_track_ai_predictions RPC 등 Runtime 전용 Object — 제외.
-- ============================================================

create table if not exists public.track_ai_predictions (
  id                     uuid            not null default gen_random_uuid(),
  track_id               uuid            not null,
  model_version          text            not null default 'laion-clap-music-v1+librosa'::text,
  predicted_energy_level integer,
  energy_confidence      numeric(4,3),
  predicted_bpm          integer,
  bpm_confidence         numeric(4,3),
  predicted_tempo_feel   text,
  energy_label_scores    jsonb,
  applied_at             timestamptz,
  applied_by             uuid,
  created_at             timestamptz     not null default now(),
  constraint track_ai_predictions_pkey primary key (id),
  constraint track_ai_predictions_track_id_fkey
    foreign key (track_id) references public.tracks(id) on delete cascade,
  constraint track_ai_predictions_applied_by_fkey
    foreign key (applied_by) references public.users(id),
  constraint track_ai_predictions_track_id_model_version_key
    unique (track_id, model_version)
);
