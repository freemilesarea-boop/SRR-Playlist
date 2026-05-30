-- 0229 — Phase X1.0 track_ai_predictions 확장 (taxonomy 예측 컬럼 추가)
--
-- 기존 컬럼:
--   id, track_id, model_version,
--   predicted_energy_level, energy_confidence,
--   predicted_bpm, bpm_confidence,
--   predicted_tempo_feel, energy_label_scores,
--   applied_at, applied_by, created_at
--
-- 추가 (Phase X1.1 AI 메타 추론 엔진이 채울 컬럼):
--   predicted_main_genre        — 단일 슬러그 (DEUDDA 단일 선택 정책)
--   predicted_sub_genres        — 후보 sub 장르 (참고용)
--   predicted_moods             — 단일 선택이지만 멀티 후보 보존
--   predicted_store_types       — 단일 선택이지만 멀티 후보 보존
--   predicted_dayparts          — 단일 선택이지만 멀티 후보 보존
--   genre_confidence            — top-1 softmax 확률
--   mood_confidence
--   store_type_confidence
--   daypart_confidence
--   prediction_scores           — 4 카테고리 전 softmax 분포 (디버그/정확도 분석용)
--
-- 모든 컬럼 nullable — 기존 169 행 그대로 둠. taxonomy.slug 와 soft reference (FK 없음 → 분류 체계 수정 자유).

alter table public.track_ai_predictions
  add column if not exists predicted_main_genre   text,
  add column if not exists predicted_sub_genres   text[],
  add column if not exists predicted_moods        text[],
  add column if not exists predicted_store_types  text[],
  add column if not exists predicted_dayparts     text[],
  add column if not exists genre_confidence       numeric(4,3),
  add column if not exists mood_confidence        numeric(4,3),
  add column if not exists store_type_confidence  numeric(4,3),
  add column if not exists daypart_confidence     numeric(4,3),
  add column if not exists prediction_scores      jsonb;

-- 추론 결과 조회 / 필터링용 인덱스
create index if not exists track_ai_predictions_main_genre_idx
  on public.track_ai_predictions(predicted_main_genre)
  where predicted_main_genre is not null;

-- 배열 컬럼은 GIN 으로 (포함 검색 store_type @> '{cafe}')
create index if not exists track_ai_predictions_moods_gin_idx
  on public.track_ai_predictions using gin (predicted_moods);
create index if not exists track_ai_predictions_store_types_gin_idx
  on public.track_ai_predictions using gin (predicted_store_types);
create index if not exists track_ai_predictions_dayparts_gin_idx
  on public.track_ai_predictions using gin (predicted_dayparts);
