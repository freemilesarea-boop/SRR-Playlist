# Phase 3-6 → 3-9 · AI Music OS Architecture

**Status**: 설계 문서 · 승인 대기 · **구현 착수 전**
**Scope**: 전체 매장 자동 큐레이션 시스템 + AI Music OS 확장 로드맵
**최종 배치**: 이 문서는 CTO / 개발팀 / 운영팀 공통 reference
**변경 이력**: v1.0 (initial)

**절대 원칙 (이 문서 전체에 적용)**:
- 이 문서는 **설계 · 계획** 만 담는다. 코드 · SQL · migration 파일은 별도 착수 시점에 생성한다.
- 모든 신규 시스템은 **기존 기능 회귀 0** · 명시적 kill-switch 필수
- 관리자 · HQ · 매장주의 통제권 침해 금지 (자동은 편의성, 통제는 항상 사람)
- 자동 학습 시스템은 **admin approval + guard rails + rollback** 3중 보호

---

## 목차

- [0. Vision Statement](#0-vision-statement)
- [1. 5-Layer Architecture Overview](#1-5-layer-architecture-overview)
- [2. Design Principles & Constraints](#2-design-principles--constraints)
- [3. Layer 1 · Signal Layer](#3-layer-1--signal-layer)
- [4. Layer 2 · Curation Core (Daily Auto-Curation)](#4-layer-2--curation-core-daily-auto-curation)
- [5. Layer 3 · Context Layer](#5-layer-3--context-layer)
- [6. Layer 2 확장 · Discovery Layer](#6-layer-2-확장--discovery-layer)
- [7. Layer 4 · Creation Layer](#7-layer-4--creation-layer)
- [8. Layer 5 · Meta Layer](#8-layer-5--meta-layer)
- [9. Engine ⑩ · Full Feedback Loop](#9-engine--full-feedback-loop)
- [10. Admin Dashboard 설계](#10-admin-dashboard-설계)
- [11. HQ Dashboard 설계](#11-hq-dashboard-설계)
- [12. Phase 로드맵 (3-6a → 3-9)](#12-phase-로드맵-3-6a--3-9)
- [13. Migration 계획 (계획 only)](#13-migration-계획-계획-only)
- [14. Rollout 전략](#14-rollout-전략)
- [15. Regression Safety Matrix](#15-regression-safety-matrix)
- [16. 결정 필요 항목](#16-결정-필요-항목)
- [17. Success Metrics](#17-success-metrics)
- [18. Appendix — 기존 자산 인벤토리](#18-appendix--기존-자산-인벤토리)

---

## 0. Vision Statement

> **듣다는 "AI 가 매일 자동으로 음악을 관리하는 플랫폼" 이다.**

**핵심 명제 5개**:
1. 매장 · 지역 · 계절 · 이벤트 · 성과 데이터를 **실시간 반영**
2. **스스로 학습**하는 Music Operating System (자동 apply 는 admin approval 필수)
3. 모든 매장 기본값 **Auto ON** · 매장주는 언제든 **Manual 전환** 가능
4. 매일 07:00 KST · AI 가 플레이리스트 회전 (add + remove · cap 150)
5. Store Player → Signal → AI Score → Rotation/Generation → Player · **완전 순환 루프**

---

## 1. 5-Layer Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  L5 · SELF-LEARNING LOOP                    [Engine ⑨]     │
│      결과 → weight 자동 조정 제안 → admin approval → 재실행 │
├─────────────────────────────────────────────────────────────┤
│  L4 · CREATION LAYER                        [Engine ①⑥]    │
│      Playlist Generator · AI Naming (rule-based / LLM)      │
├─────────────────────────────────────────────────────────────┤
│  L3 · CONTEXT LAYER                         [Engine ②③⑦⑧] │
│      Industry AI Profile · Event · Region · Trend           │
├─────────────────────────────────────────────────────────────┤
│  L2 · CURATION LAYER                        [Engine ④⑤]    │
│      Rotation Core · Test Pool · Performance Ranking        │
├─────────────────────────────────────────────────────────────┤
│  L1 · SIGNAL LAYER                          [Engine ⑩ + 기존]│
│      Reactions · Skips · Completions · Now Playing          │
└─────────────────────────────────────────────────────────────┘
                          ↑
                  기존 자산 (0158, 0182, 0340, 0345, 0356)
```

**층별 실행 주기**:

| Layer | 실행 주기 | 트리거 |
|---|---|---|
| L1 Signal | 실시간 | 매 재생/좋아요/스킵마다 |
| L2 Curation Core | 매일 07:00 KST | Vercel cron |
| L2 Test Pool | 주 1회 | Weekly cron |
| L2 Performance Ranking | 주 1회 | Weekly cron |
| L3 Context | Rotation 시 factor 로 반영 | 매일 07:00 KST 이벤트 자동 활성 |
| L4 Creation | admin 트리거 · draft → approve → publish | 수동 |
| L5 Meta | 월 1회 자동 | Monthly cron (proposal 만 · apply 는 수동) |

---

## 2. Design Principles & Constraints

### 2.1 Principles

- **Anthropocentric Automation**: 자동은 편의성 · 통제는 사람
- **Explainable AI**: 모든 add/remove 는 `score_breakdown` 저장 · 이유 자연어 생성
- **Progressive Enhancement**: 5-layer 는 층별 독립 rollout · 상위 없어도 하위 작동
- **Idempotency**: 모든 migration `CREATE OR REPLACE` / `IF NOT EXISTS` · 재실행 안전
- **Fail-safe Defaults**: 실패 시 기존 상태 유지 · 자동 rollback 대상 지정
- **Auditability**: 모든 결정 · 실행 · 상태 변경 이력 저장

### 2.2 Constraints

- **회귀 금지 대상** (§15 참조): 수동 플리 큐레이션 · 정책 배포 · Player · Announcement · Settlement · Enterprise NOC/Ops/Intel/Notification
- **Kill-switch 필수**: 각 Engine 별 `admin_toggle_engine(name, false)` · 30초 이내 정지
- **매장주 통제 우선**: `stores.auto_curation_enabled=false` 시 완전 no-op
- **Cost caps**: 외부 API 호출 (Trend · LLM Naming) 는 monthly budget cap · 초과시 skip
- **Data retention**: rotation events 90일 · snapshots 30일 · weight proposals 30일 후 expired

---

## 3. Layer 1 · Signal Layer

### 3.1 기존 자산 재활용 (신규 구현 없음)

| 신호 | 소스 테이블 | Migration |
|---|---|---|
| Like/Dislike | `store_track_reactions` (unique per store × track) | 0345 |
| Early Skip | `business_early_skip_events` | 0182 |
| Playlist Exclusion | `business_track_playlist_exclusions` | 0182 |
| Now Playing | `store_now_playing` (current track + started_at) | 0356 |
| Store Learning | `store_learning_snapshots` | 0346 |
| Reaction Adjustment | `_ai_reaction_soft_fit_adjust` | 0347 |
| Fit Score | `playlist_track_fit_scores` + `_ai_compute_fit` | 0158 → 0342 |
| Behavior Score | Learning loop closure 자산 | 0343 |
| CLAP Embedding | Track semantic vectors | 0340 |
| Store Track Exclusion | `track_store_exclusions` (업종별 제외) | (early) |
| Playback Heartbeat | `store_policy_sync_status` | 0353 |

### 3.2 Signal Layer 확장 (Phase 3-6a)

**추가 없음** — 기존 자산으로 충분. Layer 2 가 이것들을 소비.

---

## 4. Layer 2 · Curation Core (Daily Auto-Curation)

### 4.1 Data Model (Phase 3-6a 신규)

#### 기존 테이블 ALTER

**`public.users` (매장 = account_type='business')**:
```
+ auto_curation_enabled boolean not null default true
+ auto_curation_switched_at timestamptz
+ auto_curation_switched_by uuid → users(id)
```

**`public.playlists`**:
```
+ max_track_count int not null default 150     -- 상한 (플리 무한 증가 방지)
+ min_track_count int not null default 30      -- 하한 (완전 비지 않도록)
+ rotation_last_run_at timestamptz
+ rotation_last_added int default 0
+ rotation_last_removed int default 0
+ rotation_last_error text
```

**`public.playlist_tracks`**:
```
+ last_ai_score numeric
+ last_scored_at timestamptz
+ removed_reason text          -- 'low_score' | 'aged_out' | 'user_dislike' | 'manual' | 'rollback'
+ is_removable boolean not null default true    -- admin pin (자동 제거 방지)
```

#### 신규 테이블 (5개)

| 테이블 | 목적 |
|---|---|
| `playlist_rotation_events` | Daily audit 상세 (add/remove/keep/skipped 각각 · score_breakdown 저장) |
| `playlist_daily_snapshots` | Rollback 재료 (rotation 직전 상태 · 30일 보관) |
| `track_ai_scores` | 12-factor score cache (playlist × track · TTL 24h) |
| `store_curation_mode_events` | Auto/Manual 전환 audit (누가 · 언제 · 이유) |
| `playlist_rotation_alerts` | 실패/이상 감지 (연속 실패 · 하한 미달 등) |
| `ai_score_weights` | 12-factor 가중치 (admin 튜닝 · 실시간 반영) |

#### 재활용

- `playlist_auto_refresh_runs` (0341) — Run-level summary 유지
- `franchise_policy_versions` (0349) — Version bump 채널 재사용

### 4.2 12-Factor AI Score (Phase 3-6a)

**최종 점수** = Σ (weight_i × normalized_factor_i) · 0~100 scale

| # | Factor | 데이터 소스 | 방향 | 초기 가중치 |
|---|---|---|---|---|
| F1 | 업종 적합도 | `playlist_track_fit_scores.final_fit_score` | + | **18** |
| F2 | 분위기 매칭 | `tracks.mood_tags` × `playlists.mood_seed` | + | 10 |
| F3 | 시간대 적합 | `tracks.time_slot_tags` × 현재 KST | + | 6 |
| F4 | 계절 적합 | `tracks.season_tags` × 현재 월 | + | 5 |
| F5 | 최근 완청률 | `store_now_playing` 30일 aggregate | + | **14** |
| F6 | 좋아요 수 | `store_track_reactions.like` 30일 | + | 10 |
| F7 | 싫어요 수 | `store_track_reactions.dislike` 30일 | − | **12** |
| F8 | 스킵률 | `business_early_skip_events` / 재생수 | − | **10** |
| F9 | 최근 재생 빈도 | `store_now_playing` 7일 (과다시 감점) | − (bell) | 4 |
| F10 | 최근 추가 여부 | `playlist_tracks.added_at` 7일 이내 | + (신선함 보호) | 3 |
| F11 | 인기 상승률 | 지난 7일 - 이전 7일 좋아요 delta | + | 5 |
| F12 | 발매일 가중 | `tracks.released_at` 14일 이내 boost | + (curve) | 3 |

**합계 = 100** (admin 이 `ai_score_weights` 로 튜닝 가능)

**Score 계산 함수** (Phase 3-6a 신규):
- `_ai_compute_track_score(playlist_id, track_id) → numeric`
- `_generate_score_reason(factors jsonb) → text` (자연어 사유)
- Signed factors (F7/F8/F9) 는 감점 · 절댓값 처리
- Cache: `track_ai_scores` (TTL 24h)

**Phase 3-6b 확장** (Engine ②):
- `_ai_compute_track_score_v2(playlist_id, track_id) → numeric`
- 업종별 가중치 우선 · 없으면 global fallback

### 4.3 Rotation Engine (Phase 3-6a)

**알고리즘 (플리 하나 단위)**:

```
BEGIN TRANSACTION
  1. Snapshot 생성: playlist_daily_snapshots INSERT (현재 상태 backup)
  2. 기존 트랙 score 계산 → asc 정렬 (낮은 게 removal 후보)
  3. 신곡 후보 pool: 최근 30일 발매 · audio_url 있음 · 미수록 · 매장타입 제외 없음
  4. 후보 score 계산 → desc 정렬 (높은 게 add 후보)
  5. Add/Remove 결정:
     - target_add = 3 (기본 · playlists.rotation_target_add)
     - target_remove = 3 (기본)
     - CAP: current + add - remove ≤ max_track_count (150)
     - FLOOR: current - remove ≥ min_track_count (30)
     - Pinned 보호: is_removable=false / placement_reason='manual_pin' 제외
  6. INSERT playlist_tracks (add) · UPDATE removed_at (remove)
  7. INSERT playlist_rotation_events (event_type ∈ 'added'|'removed'|'kept'|'skipped'|'pinned')
  8. _bump_policies_for_playlist(playlist_id)
  9. UPDATE playlists (rotation_last_*)
COMMIT
```

**안전장치**:
- **상한 150 강제** (사용자 정책: playlist 무한 증가 금지)
- **하한 30 보호** (완전 비지 않도록)
- **Pinned track 보호** (admin/매장주 수동 지정)
- **연속 실패 감지**: 3일 연속 실패 → `playlist_rotation_alerts` + admin_notifications
- **트랜잭션**: 실패 시 자동 rollback · playlist 원본 무손상

### 4.4 Cron & Execution (Phase 3-6a)

**Vercel Cron 등록**:
```
{ path: "/api/cron/daily-auto-curation", schedule: "0 22 * * *" }
   → UTC 22:00 = KST 07:00
```

**신규 파일**: `api/cron/daily-auto-curation.ts`
- Edge runtime · `CRON_SECRET` 검증 · `SUPABASE_SERVICE_ROLE_KEY` 로 RPC 호출
- Pattern: 기존 `api/cron/enterprise-ops.ts` 복제
- 호출: `run_daily_auto_curation()` RPC
- 결과: `admin_log_operation(source='cron', category='daily_auto_curation')` 감사 기록

**신규 RPC**: `run_daily_auto_curation() → jsonb` (service_role only)
```
1. INSERT playlist_auto_refresh_runs (triggered_by='cron_daily_auto')
2. FOR playlist IN released + auto_attach_enabled:
     TRY: _rotate_one_playlist(pl.id)
     CATCH: INSERT playlist_rotation_alerts (severity='high')
3. CLEANUP: DELETE playlist_daily_snapshots WHERE snapshot_date < now() - '30 days'
4. RETURN summary { total_playlists, total_added, total_removed, total_failed, duration_ms }
```

### 4.5 Queue Refresh & Player (Phase 3-6a)

#### 프랜차이즈 매장

**신규 함수**: `_bump_policies_for_playlist(playlist_id uuid)`
- 이 playlist 를 slot 으로 갖는 모든 franchise_policies 의 `franchise_policy_versions.version_number` bump
- `store_policy_sync_status.active_version_number` 동기 갱신
- 기존 `useFranchisePolicySync` (60초 폴링) 이 key 변경 감지 → `fetchPlaylistTracks` 재실행 → 새 큐 로드
- **현재 재생곡은 끊지 않음**: `setQueue(playable)` 만 호출 · Player 는 다음 곡 시점에 새 큐 사용 (사용자 정책 ⑤)

#### 개인 사업자 매장

**신규 hook**: `src/hooks/useStorePlaylistSync.ts` (Phase 3-6a Stage 4)
- 매장 로그인 후 60초 폴링
- `stores.auto_curation_enabled=false` 시 완전 no-op
- 매 60초 `get_current_playlist_version(playlist_id)` 호출 → hash 변경 시만 재로드
- 현재 재생곡은 안 끊음 (`setQueue` 만)

**신규 RPC**: `get_current_playlist_version(playlist_id) → jsonb`
- `{ playlist_id, version_hash, updated_at }`
- `version_hash = md5(sorted track_ids + rotation_last_run_at)`

### 4.6 `last_policy_sync_at` 실제 갱신 (Phase 3-6a)

기존 결함: 코드 전체 `last_policy_sync_at = null` 리셋만 있고 실제 성공 시 갱신 로직 0건.

**해결**: `get_store_active_music_policy(store_id)` 마지막에 `UPDATE store_policy_sync_status SET last_policy_sync_at = now()`.
- HQ Ops "policy_sync_stale" 감지 정확도 상승
- Phase 3-5 Notification 정확도 상승

### 4.7 Daily Audit (Phase 3-6a)

**데이터 흐름**:
```
run_daily_auto_curation()
  ├─ playlist_daily_snapshots       (rotation 전 backup)
  ├─ playlist_rotation_events       (add/remove/keep/skipped 각각)
  │    - score_breakdown (12 factor 각각 값)
  │    - reason (자연어 사유)
  ├─ playlist_auto_refresh_runs     (0341 재사용 · run summary)
  ├─ playlist_rotation_alerts       (실패/이상 감지)
  └─ admin_operation_logs           (cron-level timeline)
```

**저장 필드**:

| Event | 저장 |
|---|---|
| `added` | ai_score · score_breakdown (12F) · reason ("신규 발매 · 업종 적합 · 완청률 78%") |
| `removed` | ai_score · reason ("싫어요 8회 · 완청률 12%") |
| `kept` | ai_score (상위 100개만 상세 · 성능) |
| `skipped` | reason ("candidate pool 부족" / "admin pinned") |
| `pinned` | admin/매장주 수동 pin 표시 |

### 4.8 Rollback (Phase 3-6a · 사용자 정책 ⑨)

**신규 RPC**: `admin_rollback_playlist_to_snapshot(playlist_id, snapshot_date) → jsonb`

```
1. 권한: is_super_admin() OR HQ 자기 브랜드 (향후 확장)
2. Load snapshot from playlist_daily_snapshots
3. UPDATE playlist_tracks SET removed_at=now(), removed_reason='rollback' (현재 트랙 전체)
4. INSERT playlist_tracks FROM snapshot (원본 복구 · placement_reason='rollback_restored')
5. _bump_policies_for_playlist(playlist_id) → 매장 재수신
6. Audit: rotation_events INSERT (event_type='rollback') · admin_operation_logs
7. RETURN { restored_count, original_count, rolled_back_to }
```

**안전장치**:
- Snapshot 30일 보관 · 그 이상 rollback 불가
- Rollback 도 audit
- 프리뷰 UI (N개 → M개 · 삭제 K · 추가 L · confirm)
- Rollback 후 익일 rotation 정상 실행 (재조정 무한 방지)

### 4.9 Manual Toggle (Phase 3-6a · 사용자 정책 ②)

**매장주 UI** (BusinessPage):
- "AI 자동 큐레이션 ON/OFF" 토글
- OFF 로 전환 시 `stores.auto_curation_enabled=false` · `store_curation_mode_events` 기록
- OFF 매장은 rotation 완전 skip · `useStorePlaylistSync` no-op

**HQ UI** (`/enterprise/me` 또는 `/enterprise/curation`):
- 브랜드 매장별 auto/manual 상태 조회 · 강제 전환 (reason 필수)

**Admin UI**:
- 매장 bulk switch · 감사 로그 기록

---

## 5. Layer 3 · Context Layer

### 5.1 Engine ② Industry AI Profile (Phase 3-6b)

**미션**: 업종별 factor weight/threshold 별도 관리 (카페 vs 병원 vs 헬스는 다른 기준).

**Data 추가**:
- `industry_ai_profiles` — 업종별 seed 6종 (cafe · gym · clinic · wine_bar · pub · office)
  - `factor_weights jsonb` (전역 override)
  - `min_completion_rate numeric`
  - `preferred_bpm_range int4range`
  - `avoid_explicit boolean default true`
- `playlists.industry_slug text` (기존 `business_category` 정규화)

**신규 RPC** (Phase 3-6b):
- `admin_upsert_industry_profile(slug, weights, thresholds)`
- `admin_list_industry_profiles()`
- `_ai_compute_track_score_v2` — industry-aware 확장

**동작**: playlist.business_category → industry_profile 조회 → weights 우선 · 없으면 global fallback.

### 5.2 Engine ③ Event & Holiday Engine (Phase 3-6b + 3-9)

**미션**: 크리스마스 · 설날 · 추석 · 발렌타인 · 비오는 날 · 벚꽃 시즌 자동 반영.

#### Phase 3-6b (Calendar 이벤트만 · 즉시 구현)

**Data**:
- `ai_events` — 이벤트 마스터 (slug · display_name · start/end · boost_tags · score_bump)
- Seed: `xmas` · `valentines` · `lunar_new_year` · `chuseok` · 등 6종
- `tracks.event_tags text[]` (이미 season_tags 있음 · 확장)
- `ai_event_activations` — 발동 이력 audit

**동작**:
```
Rotation 시:
  active_events = SELECT * FROM ai_events WHERE now() BETWEEN start AND end
  for track in candidates:
    for evt in active_events:
      if track.event_tags & evt.boost_tags: score += evt.score_bump
```

**신규 RPC**:
- `admin_upsert_ai_event(slug, params)`
- `_ai_get_active_events(now?) → jsonb[]`
- `_ai_score_with_events(playlist_id, track_id)`

#### Phase 3-9 (Weather Events · 외부 API 통합)

- 기상청 API adapter → 비/눈/맑음 감지
- `rainy_day` · `snowy_day` · `sunny_afternoon` 자동 활성/비활성
- 후순위 · 설계 슬롯만 open

### 5.3 Engine ⑦ Region AI (Phase 3-7)

**미션**: 지역별 선호도 가중치 반영 (강남 vs 홍대 vs 부산 vs 제주).

**Data**:
- `region_preference_snapshots` — 주간 계산 (region × genre × score)
- `playlists.region_slug text` (optional · 지역 지정 플리)
- 재활용: `enterprise_regions` (0352) + `stores.region_id`

**동작**:
```
매주 계산:
  region_pref[slug] = { top_genres, completion_lift, reject_tags }
Rotation 시:
  playlist.region_slug 있으면 region weight → factor bump
```

**신규 RPC**:
- `_compute_region_preferences(region_slug, week)`
- `run_weekly_region_analysis()` (weekly cron)
- `_ai_score_with_region_bump()`

---

## 6. Layer 2 확장 · Discovery Layer

### 6.1 Engine ④ New Track Test Pool (Phase 3-7)

**미션**: 신곡을 전체 매장에 바로 배포하지 말고 · 일부 매장 (5%) 테스트 후 성과 기반 확산.

**Data**:
- `track_test_assignments` — 테스트 batch (assigned_stores · playlist_ids · target_impressions · status)
- `tracks.test_pool_status text default 'untested'` (untested / testing / promoted / rejected)
- `tracks.promoted_at timestamptz`

**동작**:
```
1. 신곡 발매 시 자동 test_pool enroll (trigger)
2. Rotation 시 test 트랙은 별도 slot · 5% 매장에만 노출
3. 24-72h 결과 수집: 완청률 · 스킵률 · 좋아요/싫어요
4. 판정:
   - 완청률 ≥ 70% AND 좋아요 > 싫어요 → promoted (전체 rotation 후보)
   - 완청률 < 30% OR 스킵률 > 60% → rejected
   - 애매하면 다음 주 재테스트
5. Promoted 만 정식 pool 진입
```

**신규 RPC**:
- `_ai_enroll_new_track_to_test_pool(track_id)` (신곡 발매 trigger)
- `_ai_evaluate_test_batch(batch_id)`
- `run_weekly_test_pool_evaluation()` (weekly cron)
- `admin_manual_promote_track(track_id)` (강제 승격)
- `admin_list_test_pool()`

### 6.2 Engine ⑤ Playlist Performance Ranking (Phase 3-7)

**미션**: 업종별 성과 좋은 Playlist 랭킹화 · 우수 Playlist 자동 추천/배포.

**Data**:
- `playlist_performance_snapshots` — 주간 (playlist × week · industry · region · score · rank)
- `playlist_recommendation_events` — 누구에게 언제 추천

**동작**:
```
매주 계산:
  performance_score = weighted (avg 완청률 + net 좋아요 delta + churn 없음 + NOC alert 없음)

활용:
  - 새 매장 온보딩: 업종별 top 3 자동 추천
  - HQ 저성과 매장에 우수 Playlist 이관 제안
  - AI Playlist Generator (Engine ①) 학습 소스
```

**신규 RPC**:
- `_compute_playlist_performance(playlist_id, week)`
- `run_weekly_performance_ranking()` (weekly cron)
- `admin_get_top_playlists_by_industry(industry_slug, limit)`
- `admin_recommend_playlist_to_store(store_id, playlist_id, reason)`

---

## 7. Layer 4 · Creation Layer

### 7.1 Engine ① AI Playlist Generator (Phase 3-8)

**미션**: 계절 · 날씨 · 업종 · 시간대 기반 **신규 Playlist 자동 생성**. 회전 넘어 창조.

**동작**:
```
1. Context 입력: { season, industry, time_slot, mood_intent, target_count }
2. 후보 track pool: L1/L2 factor 조합 상위 500곡
3. Diversity constraint: 아티스트 max 5% · 장르 편중 방지
4. AI Score sort → target_count 선정
5. Engine ⑥ 로 AI 이름 생성
6. draft 상태 저장 → admin approval → published
```

**Data**:
- `ai_generated_playlists` — draft/pending/published/rejected
- `playlists.generation_source text` — 'manual' / 'ai_generated' / 'ai_cloned_from'
- `ai_playlist_generation_requests` — admin 요청 큐

**신규 RPC**:
- `admin_request_ai_playlist_generation(context jsonb) → uuid`
- `admin_approve_ai_playlist(id)` / `admin_reject_ai_playlist(id, reason)`
- `_ai_generate_playlist_from_context(context jsonb) → uuid`

**안전장치**: admin approval 필수 (자동 publish 금지) · draft 30일 만료.

### 7.2 Engine ⑥ AI Playlist Naming (Phase 3-8 + 3-9)

**미션**: AI 가 "Morning Coffee · Rainy Mood · Summer Lounge" 자연스러운 이름 자동 생성.

#### Phase 3-8 (Rule-based · MVP)

**Data**:
- `ai_naming_templates` — 규칙 기반 seed
- `ai_playlist_name_history` — 사용된 이름 (중복 방지)

**동작**:
```
templates = {
  'cafe+morning': ['Morning Coffee', 'Sunrise Latte'],
  'gym+high_energy': ['Push Beats', 'Iron Rhythm'],
  'wine_bar+jazz': ['Late Night Jazz', 'Cellar Session']
}
→ context 매칭 → 3-5개 후보 반환 → admin 선택
```

#### Phase 3-9 (LLM 통합 · optional)

- Anthropic API 호출 (Claude 4.7+ · Haiku 4.5 저비용)
- Cost cap · admin 승인 UI · refusal handling

**신규 RPC**:
- `_ai_suggest_playlist_names(context jsonb) → text[]`
- `admin_accept_ai_name(playlist_id, name)`

---

## 8. Layer 5 · Meta Layer

### 8.1 Engine ⑧ Trend Engine

#### Phase 3-7 (내부 데이터 우선 · 즉시 구현 대상)

**Data**:
- `track_trend_scores` — track × source × score · rank
- source 값 seed: `internal`

**동작**:
```
매일 실행:
  trend_score = (지난 7일 완청 수 / 이전 7일 완청 수) - 1
  → 상위 100곡 = trending_now
Rotation 시: trending_now 트랙 +5 boost
```

**신규 RPC**:
- `_compute_internal_trend_scores()`
- `run_daily_internal_trend()` (daily cron · 07:00 KST 직전 06:50)

#### Phase 3-9 (외부 소스 · 설계 슬롯만 open · **후순위**)

**설계 슬롯 (구현 안 함)**:
- `trend_source_configs` — 외부 adapter 등록 · credential 관리
- source enum 확장: `tiktok · spotify · youtube · apple`
- Adapter interface (설계만):
  - `TikTokTrendAdapter` (3rd-party API or scraping)
  - `SpotifyChartsAdapter` (public playlists)
  - `YouTubeTrendingAdapter`
  - `AppleMusicChartsAdapter`
- Normalize → tracks 매칭 (ISRC / title+artist fuzzy)
- 실제 계약/API 확보 시점에 별도 Phase 로 착수

**절대 원칙**: 외부 API 는 후순위 · 내부 trend 만 우선 구현.

### 8.2 Engine ⑨ Self Learning Engine (Phase 3-9 · 최고 안전장치)

**미션**: rotation 결과 기반 AI Score weight 자동 조정 제안 · **admin approval 필수**.

**동작**:
```
매월 1회 (proposal 생성만):
1. 지난 30일 rotation 결과 분석:
   - 각 factor 가 완청률/좋아요 예측에 기여한 정도
   - Regression: outcome ~ factors → coefficient 재계산
2. Proposed weights 생성 (global · industry · region 각각)
3. Guard rails 적용:
   - 각 factor weight ≤ 30%
   - 이전 값 대비 delta ≤ ±20% (급변 방지)
   - 최소 4주 데이터 + 1000 rotation events + 100 매장
4. admin_notifications 로 제안:
   - "다음 주 weight 변경 제안: F1 18→22, F5 14→11, ..."
5. Admin 이 approve / reject / edit / A/B pilot 선택
6. Approve 시 반영:
   - ai_score_weights 갱신
   - ai_weight_change_history 기록 (rollback 가능)
```

**Data**:
- `ai_weight_change_proposals` (proposal 큐)
- `ai_weight_change_history` (적용 이력 · rollback 원천)

**안전장치 (8단계)**:
1. ✅ **자동 apply 절대 금지** · admin approval only
2. ✅ **Guard rails** — max weight 30% · delta ≤ ±20%
3. ✅ **최소 sample size** — 4주 · 1000+ events · 100+ 매장
4. ✅ **Reasoning transparency** — 통계 · regression · 그래프 첨부
5. ✅ **A/B pilot 옵션** — 5% 매장 2주 시범 → 성과 검증 후 전체
6. ✅ **Rollback 지원** — `admin_rollback_weight_change(history_id)` 1 SQL
7. ✅ **Expiration** — proposal 30일 후 자동 만료
8. ✅ **Multi-admin approval** (옵션) — 2인 이상 승인 (향후 확장)

**신규 RPC**:
- `_generate_weight_proposal(scope_type, scope_slug)`
- `run_monthly_self_learning()` (monthly cron · proposal 만)
- `admin_approve_weight_proposal(id, edits?)`
- `admin_reject_weight_proposal(id, reason)`
- `admin_rollback_weight_change(history_id)`

---

## 9. Engine ⑩ · Full Feedback Loop

**Vision**: 위 모든 엔진을 하나의 순환 구조로 명확화. 매장 재생 → 신호 수집 → AI 계산 → 회전/생성 → 매장 반영.

```
┌────────────────────────────────────────────────────────────────┐
│                     🎧 STORE PLAYER                            │
│              (Player.tsx + usePlayerStore)                     │
└────────────────────────────────────────────────────────────────┘
        │                                              ▲
        ▼                                              │
┌────────────────────┐                    ┌───────────────────────┐
│   SIGNAL COLLECT   │                    │  QUEUE REFRESH        │
│  · Completion      │                    │  · useFranchisePolicy │
│  · Skip event      │                    │  · useStorePlaylist   │
│  · Like/Dislike    │                    │    (신규 · 3-6a)      │
│  · Now Playing     │                    └───────────────────────┘
└────────────────────┘                                ▲
        │                                              │
        ▼                                              │
┌───────────────────────────────────────────┐         │
│  L1 SIGNAL — 기존 자산 재활용              │         │
│  store_track_reactions (0345)             │         │
│  business_early_skip_events (0182)        │         │
│  store_now_playing (0356)                 │         │
└───────────────────────────────────────────┘         │
        │                                              │
        │  ┌───────────────────────────────┐          │
        └─▶│  L2 AI SCORE (Engine ④/12F)   │          │
           │  _ai_compute_track_score()    │          │
           │  → track_ai_scores            │          │
           └───────────────────────────────┘          │
                          │                            │
                          ▼                            │
           ┌───────────────────────────────┐          │
           │  L2 ROTATION ENGINE           │          │
           │  daily 07:00 KST · cron       │          │
           │  add/remove/keep              │          │
           │  playlist_tracks update       │          │
           └───────────────────────────────┘          │
                          │                            │
                          ▼                            │
           ┌───────────────────────────────┐          │
           │  _bump_policies_for_playlist  │          │
           │  franchise_policy_version++   │──────────┘
           │  playlist_version_hash 계산    │
           └───────────────────────────────┘

  Context influencing L2 Rotation:
    ← Engine ② Industry AI Profile (3-6b)
    ← Engine ③ Event & Holiday (3-6b)
    ← Engine ⑦ Region AI (3-7)
    ← Engine ⑧ Trend Engine · 내부 (3-7)
    ← Engine ④ New Track Test Pool (3-7 · input filter)
    ← Engine ⑤ Performance Ranking (3-7 · 플리 선정)
    ← Engine ① AI Playlist Generator (3-8 · 플리 존재 자체 생성)

  Meta-loops:
    Engine ⑨ Self Learning (3-9) — L1+L2 결과 분석 → weight 제안 → admin approval
    Engine ⑥ AI Naming (3-8/3-9) — Engine ① 생성 플리에 이름 부여
```

**Loop Health 지표**:
- Signal Latency: 재생 → 반영까지 24h (다음 rotation)
- Loop Iteration: 매일 1회 (기본) · 주 1회 (test pool · ranking) · 월 1회 (self-learning proposal)
- Feedback Coverage: signal → factor 반영률 target 95%+
- Decision Explainability: 100% (모든 결정에 `score_breakdown` 저장)

---

## 10. Admin Dashboard 설계

**AdminPage 신규 탭**: `Daily Auto-Curation` (Phase 3-6a) · `AI Music OS Control` (통합 · 3-6b+)

### 10.1 Sections (Phase 3-6a)

| # | Section | 데이터 소스 |
|---|---|---|
| 1 | 오늘의 요약 KPI (4장) | `admin_get_curation_today_kpi` |
| 2 | 최근 실행 이력 (30건) | `admin_list_curation_runs(30)` |
| 3 | 플리별 상태 테이블 | `admin_list_playlist_curation_status()` |
| 4 | 실패 매장 · 실패 플리 | `admin_list_curation_failures(7)` |
| 5 | 12 Factor 가중치 튜닝 | `ai_score_weights` + `admin_set_ai_score_weight` |
| 6 | 수동 트리거 | 개별/전체 rotation · confirm |
| 7 | Rollback UI | 플리 × 스냅샷 날짜 → 복구 |

### 10.2 Sections 확장 (Phase 3-6b+)

- Industry Profile Panel (Phase 3-6b · weights per industry)
- Event Manager (Phase 3-6b · calendar view + 신규 이벤트)
- Test Pool Dashboard (Phase 3-7 · 대기/승격/기각)
- Performance Ranking (Phase 3-7 · 업종별 top 10)
- Generator Panel (Phase 3-8 · draft review)
- Self Learning Panel (Phase 3-9 · proposal review · rollback)

---

## 11. HQ Dashboard 설계

**신규 라우트**: `/enterprise/curation` (Phase 3-6a) · HQ scope 게이트 `_hq_current_enterprise_account_id()`

### 11.1 Sections (Phase 3-6a)

| # | Section | 데이터 소스 |
|---|---|---|
| 1 | 오늘 브랜드 매장에서 바뀐 곡 | `get_my_enterprise_curation_today` |
| 2 | 매장별 auto 상태 | `get_my_enterprise_stores_curation_status` |
| 3 | 인기 상승 트랙 (오늘 add · top 완청) | `get_my_enterprise_trending_added` |
| 4 | 저성과 제거 트랙 | `get_my_enterprise_removed_summary` |
| 5 | AI 큐레이션 성과 KPI | `get_my_enterprise_curation_performance_kpi` |

### 11.2 확장 (Phase 3-7+)

- Region Insights (Phase 3-7 · 자기 브랜드 지역 데이터)
- Playlist Recommendations (Phase 3-7 · HQ 에게 우수 플리 제안)

**Rollback**: HQ 는 조회만 · Rollback 은 Admin 전용 (향후 확장 여지)

---

## 12. Phase 로드맵 (3-6a → 3-9)

### 🔴 Phase 3-6a — Rotation Core (즉시 착수 대상 · 3주)

**목표**: 매일 07:00 KST · 모든 매장 auto default · rotation (add/remove/cap 150) · manual toggle · daily audit · rollback

**포함**:
- L2 Curation Core (§4)
- Data model (5 신규 테이블 + ALTER)
- 12-factor AI Score (global)
- Rotation engine + version bump + queue refresh
- Daily audit + snapshot + rollback
- Admin Dashboard (기본 · §10.1)
- HQ Dashboard (기본 · §11.1)
- Vercel cron · store manual toggle

**포함 안 함**: 모든 상위 엔진 (Context/Discovery/Creation/Meta)

### 🟠 Phase 3-6b — Context Layer v1 (Rotation 안정 확인 후 · 2주)

**목표**: 업종별 AI 프로필 + 이벤트/공휴일 자동 반영

**포함**:
- Engine ② Industry AI Profile (§5.1)
- Engine ③ Event & Holiday Engine · calendar only (§5.2)
- Admin Industry/Event Panel
- `_ai_compute_track_score_v2` (industry-aware)

**포함 안 함**: Region · Trend · Test Pool · Weather API

### 🟡 Phase 3-7 — Analytics Layer (3-6b 안정 후 · 4주 · 데이터 4주+ 축적)

**목표**: 성과 기반 자동 확산 · 지역 · 신곡 A/B

**포함**:
- Engine ④ New Track Test Pool (§6.1)
- Engine ⑤ Playlist Performance Ranking (§6.2)
- Engine ⑦ Region AI (§5.3)
- Engine ⑧ Trend Engine (내부만 · §8.1)
- Weekly cron (test/ranking/region)
- Daily cron 확장 (internal trend)

**포함 안 함**: Playlist Generator · Naming · Self Learning · 외부 Trend

### 🟢 Phase 3-8 — Creation Layer (3-7 안정 후 · 6주)

**목표**: 신규 플리 자동 생성 + 이름 부여

**포함**:
- Engine ① AI Playlist Generator (§7.1)
- Engine ⑥ AI Naming · rule-based (§7.2 Phase 3-8 부분)
- Admin Generator Panel · draft 관리
- Diversity constraint 알고리즘

**포함 안 함**: LLM naming · Self Learning

### 🟣 Phase 3-9 — Meta Layer (3-8 안정 후 · 8주+ · 최소 3개월 데이터)

**목표**: 자기 학습 + 외부 트렌드 + LLM

**포함**:
- Engine ⑨ Self Learning · admin approval 필수 (§8.2)
- Engine ⑧ 외부 Trend adapters · 설계만 슬롯 open (§8.1 Phase 3-9)
- Engine ⑥ LLM Naming · optional (§7.2 Phase 3-9)
- Engine ③ Weather Events (§5.2 Phase 3-9)
- Anthropic API 통합 (선택 · cost cap 필수)

**포함 안 함**: 실제 외부 트렌드 API 계약 (별도 논의)

---

## 13. Migration 계획 (계획 only)

**중요**: 이 섹션은 **계획** · 실제 SQL/파일 생성 금지.

### 13.1 Migration 분산

| Phase | Migrations | 예상 lines | Risk |
|---|---|---|---|
| 3-6a | `0404` schema · `0405` score · `0406` rotation · `0407` admin RPC · `0408` HQ RPC | ~3500 | 중간 |
| 3-6b | `0409` industry · `0410` events · `0411` seed | ~1800 | 낮음 |
| 3-7 | `0412` test pool · `0413` ranking · `0414` region · `0415` internal trend | ~2500 | 낮음 |
| 3-8 | `0416` generator · `0417` diversity · `0418` naming | ~2200 | 중간 |
| 3-9 | `0419` self learning · `0420` trend adapter slots · `0421` weather | ~1500 | 낮음 (proposal only) |
| **합계** | **18 migrations** | **~11500** | 분산됨 |

### 13.2 분할 기준 (Phase 3-6a 만약 커지면 재분할)

**단일 migration 상한**:
- 700 lines
- 함수 10개
- 신규 테이블 3개

**초과 시 3-6a 재분할 예시**:
- `3-6a1` = 0404 schema
- `3-6a2` = 0405 score + 0406 rotation core
- `3-6a3` = 0407 admin RPC
- `3-6a4` = 0408 HQ RPC + cron endpoint + admin UI

각 sub-phase 는 독립 PR · 독립 rollout · 독립 QA

### 13.3 절대 원칙

- 각 migration 은 `CREATE OR REPLACE FUNCTION` / `CREATE TABLE IF NOT EXISTS` 만
- 각 파일 끝에 diagnostic block: `raise notice '04XX COMPLETE ...'`
- 순서 준수 강제 (숫자 오름차순)
- 이전 phase migration 미적용 시 오류 명확히 감지 (helper 부재 등)

### 13.4 비-DB Artifacts (계획)

| Artifact | 파일 | Phase |
|---|---|---|
| Cron endpoint | `api/cron/daily-auto-curation.ts` | 3-6a |
| Cron endpoint | `api/cron/weekly-analytics.ts` | 3-7 |
| Vercel cron 등록 | `vercel.json` (crons 배열 확장) | 3-6a Stage 4 |
| API wrapper | `src/lib/api/dailyAutoCurationApi.ts` | 3-6a |
| API wrapper | `src/lib/api/aiMusicOsApi.ts` | 3-6b+ |
| Admin UI | `src/pages/admin/DailyAutoCurationPanel.tsx` | 3-6a |
| Admin UI 확장 | `src/pages/admin/AiMusicOsControlPanel.tsx` | 3-6b+ |
| 매장 UI | `src/components/business/StoreCurationToggle.tsx` | 3-6a Stage 3 |
| Store queue sync | `src/hooks/useStorePlaylistSync.ts` | 3-6a Stage 4 |
| HQ Dashboard | `src/pages/EnterpriseHqCurationPage.tsx` | 3-6a Stage 5 |
| QA doc | `docs/PHASE_3_6a_QA_CHECKLIST.md` | 3-6a Stage 2 |

---

## 14. Rollout 전략

### 14.1 Phase 3-6a — 5 Stages

**Stage 1: Migrations only** (매우 안전)
- 0404~0408 순차 apply
- 트리거 없음 · cron endpoint 미배포
- `_rotate_one_playlist(uuid)` 수동 dry-run 옵션 활용
- 검증: 스키마 diagnostic

**Stage 2: Manual 실행 + Admin Dashboard**
- `api/cron/daily-auto-curation.ts` 파일 배포 · `vercel.json` 미등록
- Admin Dashboard 신규 탭 배포 · 수동 트리거 활성
- QA: 프랜차이즈 + 개인 매장 각 1개씩

**Stage 3: 개인 매장 opt-out UI 추가**
- 매장 프로필 "AI 자동 큐레이션 ON/OFF" 토글
- 매장주 대상 공지 (Email + In-app banner)
- opt-out 통계 관찰

**Stage 4: Vercel Cron 활성화 (Auto 실행 시작)**
- `vercel.json` schedule `"0 22 * * *"` 추가 · 배포
- 첫 07:00 KST 실행 관찰
- 24h 모니터링

**Stage 5: HQ Dashboard 배포 + 전체 활성화**
- `/enterprise/curation` 라우트 배포
- HQ 사용자 공지
- 4주 정착 모니터링 · 튜닝

### 14.2 Phase 3-6b ~ 3-9

각 Phase 별:
- Stage A: Migration only
- Stage B: Admin UI + 수동 테스트
- Stage C: Cron 활성화 or Auto rollout
- Stage D: HQ/매장 공지 · 모니터링

### 14.3 Kill-switch (모든 Phase 공통)

- **Level 1** — Vercel cron entry 제거 → redeploy · 30초
- **Level 2** — `admin_toggle_engine('rotation', false)` (신규 RPC) · SQL 1줄
- **Level 3** — 개별 플리 `admin_set_playlist_auto_refresh(false)`
- **Level 4** — 매장주 개별 Manual 전환 (UI · 언제나 가능)

---

## 15. Regression Safety Matrix

| 기존 기능 | 위험도 | 완화 |
|---|---|---|
| 수동 플리 큐레이션 (admin) | ✅ 없음 | `placement_reason='manual'` + `is_removable=false` (pin) 로 자동 제거 대상 제외 |
| 정책 배포 (0349, 0359, 0377) | ✅ 없음 | `franchise_policy_versions` 이력 추가만 · 기존 배포 로직 read-only |
| 매장 정책 폴링 (useFranchisePolicySync) | ✅ 없음 | 무수정 · version bump 이 정상 채널 |
| 개인 매장 수동 선택 | ⚠️ 중간 | `auto_curation_enabled=false` 시 완전 no-op · Manual 매장 영향 0 |
| Announcement Audio | ✅ 없음 | 별도 시스템 · 무관 |
| Emergency Broadcast | ✅ 없음 | 별도 시스템 · 무관 |
| Settlement (Carryover · Monthly · PDF) | ✅ 없음 | tracks/plays 소비만 · 결제 로직 무관 |
| Enterprise NOC/Ops/Intel/Notification | ✅ 없음 | 각 시스템 독립 · `last_policy_sync_at` 갱신으로 감지 정확도 상승 |
| Player 재생 안정성 | ⚠️ 낮음 | `setQueue` 만 호출 · 현재 재생곡 안 끊음 (사용자 정책 ⑤) |
| `get_store_active_music_policy` 성능 | ⚠️ 중간 | `last_policy_sync_at` 업데이트 · 인덱스 확인 필요 |
| 무한 트랙 증가 위험 | ✅ 완전 방지 | `max_track_count=150` 강제 |
| 매장주 신중 큐레이션 훼손 | ⚠️ 있음 | Auto default 라 opt-out UI + 공지 필수 (Stage 3) |
| 저성과 곡 오제거 | ⚠️ 있음 | Rollback 지원 · pin 기능 · 30일 스냅샷 |
| Self-Learning weight 폭주 | ✅ 완전 방지 | admin approval + guard rails + A/B pilot + rollback (§8.2) |
| 외부 API 비용 폭주 | ✅ 완전 방지 | Monthly cost cap + admin approval (§8.1 Phase 3-9) |

---

## 16. 결정 필요 항목

### 16.1 Phase 3-6a 착수 전 (D 그룹)

| # | 항목 | 옵션 | 추천 |
|---|---|---|---|
| D1 | 기본 스케줄 | 06:00 / 07:00 / 08:00 KST | **07:00 KST** (`"0 22 * * *"` UTC) |
| D2 | 기본 max_track_count | 100 / 150 / 200 | **150** |
| D3 | 기본 min_track_count | 20 / 30 / 50 | **30** |
| D4 | 하루 add/remove 최대 | 3/3 / 5/5 / 10/10 | **3/3** (안전 시작) |
| D5 | 12 factor 초기 가중치 | 제안 표 그대로 / 조정 | **제안 표 그대로** (4주 후 튜닝) |
| D6 | 개인 매장 opt-in 방식 | Auto default + opt-out UI / Manual default + opt-in | **Auto default + opt-out** (사용자 정책 확정) |
| D7 | 매장주 공지 방식 | Email + In-app / In-app 만 | **Email + Banner** |
| D8 | 스냅샷 보관 기간 | 7 / 14 / 30 / 60 / 90 일 | **30일** |
| D9 | Admin dashboard 위치 | AdminPage 신규 탭 / 기존 확장 | **AdminPage 신규 탭** |
| D10 | HQ dashboard 위치 | `/enterprise/curation` 신규 / Intel 확장 | **`/enterprise/curation` 신규** |
| D11 | 실패 알림 채널 | admin_notifications / Slack / Email | **admin_notifications + Slack** |
| D12 | HQ rollback 가능? | Yes / No | **No** (Admin 만) |
| D13 | Announcement 시 rotation skip? | Yes / No | **No** (별도 시스템) |
| D14 | Score cache TTL | 6h / 12h / 24h | **24h** |
| D15 | 첫 배포 Auto ON 대상 | 신규 매장만 / 기존 매장 포함 | **기존 매장 포함** (공지 필수) |

### 16.2 3-6a 이후 (E 그룹)

| # | 항목 | 추천 |
|---|---|---|
| E1 | 다음 세션 착수 범위 | **3-6a 만** (3-6b 는 3-6a 안정 확인 후) |
| E2 | 3-6a 착수 전 D1~D15 확정 | **먼저 확정** (미확정 시 착수 보류) |
| E3 | 3-6b 부터 EDIT vs 신규 Migration | **완전 신규** (역호환 · idempotent) |
| E4 | 외부 API 계약 (Trend · Weather) | **3-9 시점 재검토** (당장 계약 불필요) |
| E5 | Self-Learning 시작 조건 | **3개월 + admin 판단 dual gate** |
| E6 | LLM (Anthropic API) 통합 | **3-9 (optional)** · 비용/refusal 검토 |
| E7 | 매장주 UI 언어 | **한국어 first · 다국어 향후** |
| E8 | Self-Learning A/B 대상 선정 | **랜덤 5%** (편향 없음) |
| E9 | Generator draft admin approve 필수? | **필수 approve** (품질 관리) |
| E10 | Rollback 이력 통합 view | **통합 view** (관리 편의) |

---

## 17. Success Metrics

### 17.1 Phase 3-6a 판정 지표

- **자동 실행 성공률**: ≥ 99% (7일 rolling)
- **rotation duration**: ≤ 30초 (17개 플리)
- **매장 큐 반영률**: 프랜차이즈 100% (60초 이내) · 개인 매장 auto=true 인 매장 100%
- **오제거 사고**: 0건 (rollback 사용률 < 5%)
- **매장주 opt-out 비율**: ≤ 20% (첫 4주)
- **회귀 사고**: 0건 (Announcement · Settlement · Player · admin)

### 17.2 AI Music OS 최종 지표 (Phase 3-9 정착 후)

- **매장 평균 완청률**: 시작 대비 +15% 이상 (12개월 후)
- **좋아요 순증**: 시작 대비 +30% 이상
- **매장주 만족도**: NPS 40+ (매년 조사)
- **HQ 매장 이탈률 감소**: -20% (자동 큐레이션 도입 브랜드)
- **관리자 수동 개입 감소**: -70% (자동화로 대체)
- **Self-Learning weight 채택률**: ≥ 60% (proposal 대비 approve 비율)

---

## 18. Appendix — 기존 자산 인벤토리

### 18.1 재활용 대상 Migrations

| Migration | 자산 | 용도 |
|---|---|---|
| 0158 | `playlist_track_fit_scores` + `_ai_compute_fit` | Factor F1 (업종 적합도) |
| 0182 | `business_early_skip_events` + `business_track_playlist_exclusions` | Factor F8 (스킵률) · 매장 제외 |
| 0246 | `playlist_tracks` placement editor | placement_reason 확장 재활용 |
| 0340 | CLAP embedding · `_ai_compute_fit` 확장 | 향후 Semantic diversity |
| 0341 | `playlist_auto_refresh_runs` + `cron_daily_playlist_refresh` (미사용) | Run summary 재활용 · 함수 replace |
| 0343 | Learning loop closure | Feedback 신호 |
| 0345 | `store_track_reactions` | Factor F6/F7 (좋아요/싫어요) |
| 0346 | `store_learning_snapshots` | 매장별 학습 (향후) |
| 0347 | `_ai_reaction_soft_fit_adjust` | Reaction 반영 |
| 0349 | `franchise_music_policies` + `franchise_policy_versions` | Version bump 채널 |
| 0352 | `enterprise_regions` | Engine ⑦ Region AI 소스 |
| 0353 | `store_policy_sync_status` | `last_policy_sync_at` 갱신 대상 |
| 0356 | `store_now_playing` | Factor F5/F9 (완청률/재생빈도) |
| 0359 | `policy_deployment_success` | 배포 이력 재활용 |
| 0377 | Policy deployment center v2 | 정책 배포 UI 재활용 |
| 0385 | `enterprise_noc` | HQ alert 통합 |
| 0398 | `enterprise_brand_registry` | HQ scope 게이트 |
| 0401 | HQ Ops helpers | `_hq_current_enterprise_account_id` 재활용 |
| 0402 | HQ Intel RPCs | Curation KPI 통합 |
| 0403 | HQ Notification | Rotation alert 발송 채널 |

### 18.2 Cron 인벤토리 (현재)

| Cron | Schedule | 목적 | Phase 3-6+ 영향 |
|---|---|---|---|
| `/api/cron/daily-metrics` | `0 1 * * *` (UTC 01:00) | 무료체험 만료 · daily metrics | 무영향 (별도 시간대) |
| `/api/cron/enterprise-ops` | `*/15 * * * *` | 정책 자동화 · 청구 · 알림 | 무영향 (별도 목적) |
| pg_cron `srr-weight-regression-weekly` | 주 월 04:00 UTC | AI 가중치 회귀 (0337) | 무영향 (별도 스코프) |
| **`/api/cron/daily-auto-curation`** (신규) | `0 22 * * *` (UTC 22:00 = KST 07:00) | Phase 3-6a rotation | 신규 |
| **`/api/cron/weekly-analytics`** (신규 3-7) | `0 20 * * 1` (월요일 20:00 UTC) | test pool + ranking + region | 신규 |
| **`/api/cron/monthly-self-learning`** (신규 3-9) | 월 1일 20:00 UTC | Self learning proposal | 신규 |

---

## 문서 이력

- **v1.0** (initial) · Phase 3-6a Daily Auto-Curation Core + AI Music OS 10 engines 확장 통합
- 향후 Phase 별 update · v2.0 (Phase 3-6a 착수 시점) · v3.0 (Phase 3-7 착수 시점) 등

**작성 원칙**: 이 문서는 "무엇을 · 왜 · 언제 · 어떻게" 를 담고, **실제 SQL/코드는 착수 시점에 별도 파일로 생성**한다. 문서 수정만으로 실제 시스템 변경은 발생하지 않는다.
