# 11 — Algorithm & Scoring System Map

> PLATFORM-AUDIT-1 · READ-ONLY. **No score, weight, or threshold was changed.** Structure/inputs/outputs/dependencies/risk only.
> Type key: **RB** rule-based · **SS** statistical-score (SQL/DSP, no model) · **ML** real model inference/embedding.

## Headline
- **Real ML is narrow and off-platform.** The only genuine ML/DSP inference is the **LAION-CLAP** stack (audio embeddings + zero-shot genre/mood/energy/store-type), **pyloudnorm LUFS**, **librosa BPM**, **Chromaprint fingerprint** — all Python on **Modal (A10G GPU)** / local / Colab (`scripts/clap_embedder/modal_app.py`, `local_worker.py`, `notebooks/`). **No external AI API** (OpenAI/Anthropic/etc.) anywhere.
- **Everything labeled "AI" inside the app/SQL is deterministic SQL** (weighted sums, counts/averages, Pearson corr, `regr_slope`/`regr_r2`, Z-score distance, pgvector cosine over pre-computed vectors). `src/lib/aiCuration.ts` (2,300 LOC) is a thin RPC wrapper — no scoring runs client-side.
- **No formal pilot→limited→expanded→global rollout ladder.** Staged rollout = "observe mode"/dual-run shadow (0232, 0255) + admin-gated policy deployment to franchise stores (0377/0378).
- **Settlement (SET-1)** = deterministic `_settlement_compute` (0454, IMMUTABLE), admin-gated, dry_run default — deep-audited in the settlement phases; the only algorithm subsystem with automated tests.

## Master table (46 algorithms)
### Audio measurement & QC
| ID | Name | Type | Rules/loc | Human gate | Tests | Expert |
|---|---|---|---|---|---|---|
| AUD-1 | Loudness EBU R128/BS.1770 | SS/DSP | `src/lib/loudness.ts` | n/a | No | MIR/DSP |
| AUD-2 | Upload quality gate | RB | `src/lib/qualityGate.ts` (LUFS −14..−9, TP>+0.3 reject) | auto-reject at upload; admin relax (0210) | No | — |
| AUD-3 | DSP feature extraction | SS/DSP | `src/lib/audioFeatures.ts` heuristics | admin-triggered | No | MIR |
| AUD-4 | Audio-health reachability (HEAD only) | RB | `functions/check-audio-health` | no | No | — |
| AUD-5 | QC-v2 DSP report | SS/DSP+RB | `modal_app.py:_analyze_qc`, SQL `store_track_qc_report` (0224/0227) | advisory queue | **Yes** `test_qc_scoring.py` | DSP |

### CLAP ML (the only real ML)
| ID | Name | Type | Loc | Human gate | Expert |
|---|---|---|---|---|---|
| ML-1 | CLAP audio embedding (512-d) | **ML** | `modal_app.py` `laion/larger_clap_music_and_speech`; store `store_track_embedding` (0222); queue 0340 | batch | ML |
| ML-2 | CLAP zero-shot genre/mood/energy/store-type | **ML** | `modal_app.py` `_classify_*`; taxonomy 0228/0230/0235/0238 | **1-click admin apply** | **ML/MIR — highest priority** |
| ML-3 | BPM (librosa) | SS/DSP | `modal_app.py librosa.beat` | no | minor |
| ML-4 | Chromaprint fingerprint + dupe | DSP+SS | `modal_app.py fpcalc`; `_audio_fingerprint_similarity` (0242) | warn-only, admin, **no auto-delete** | — |
| ML-5 | CLAP recommendation (playlist/store) | ML-derived+RB | `0221 generate_clap_recommendations`; centroid 0219 | **admin approve/reject** | note ML-derived |
| ML-6 | OpenL3 embedding | ML **DEAD** | `tools/embedding_worker/worker.py` deprecated 2026-05-31 | n/a | — |

### Fit-score curation engine (SS/RB — "AI" is branding)
| ID | Name | Type | Loc | Human gate |
|---|---|---|---|---|
| FIT-1 | Fit score (master) | SS weighted-sum | `0342 _ai_compute_fit`; W=0.50/0.20/0.20/0.10 | score not gated; recompute admin-only |
| FIT-2 | Store-fit audio scoring | SS heuristic | `0164 recompute_track_ai_metadata` | partial admin |
| FIT-3 | Behavior score v1 | SS counts/avg | `0250 _compute_track_behavior_score` | display/score only |
| FIT-4 | Metadata tag-overlap | RB | inside FIT-1 | no |
| FIT-5 | AI boost | RB consts over ML | `0241/0257/0342` | no ("AI never auto-blocks") |
| FIT-6 | AI scoring config store | RB | `0160 admin_update_ai_scoring_config` | **admin-only** |
| FIT-7 | AI suggestion + approval | RB cutoff 70 | `0160 admin_generate/decide_ai_suggestion` | **explicit approve** |
| FIT-8 | Skip-violation detection | RB thresholds | `0162 admin_register_skip_violations` | flag-only |

### Guardrails / trust / genre policy
| ID | Name | Type | Loc | Human gate |
|---|---|---|---|---|
| GRD-1 | Store hard guardrails | RB | `0173b _ai_check_store_guardrails` | hard-block auto fit=0; override admin |
| GRD-2 | Metadata trust score | SS | `0176 admin_recompute_metadata_trust` | auto-computed |
| GRD-3 | Trust tier + review policy | RB | `0175 _metadata_trust_tier` | admin-only |
| GRD-4 | High-risk track ranking | SS | `0176 admin_list_high_risk_tracks` | queue only |
| GRD-5 | Placement-risk flags | RB **OBSERVE** | `0232` (0231 auto-block rolled back) | **shadow/non-enforcing** |
| GRD-6 | Store genre placement policy | RB | `0258/0268 _check_store_genre_placement` | dry_run, review_needed only |
| GRD-7 | Genre-store guardrails (X5) | RB | `0286 _check_genre_guardrail` | partial auto (fit=0/skip) |
| GRD-8 | Hospital/boutique instrumental strict | RB | `0290/0291` | review_needed |
| GRD-9 | Business-owner 1-click exclusion | RB | `businessExclusion.ts business_exclude_track` | self-service |
| GRD-10 | Business early-skip auto-exclusion | RB counter | `0182 record_business_early_skip` | auto-exclude; admin restore |

### Auto-placement
| ID | Name | Type | Loc | Human gate |
|---|---|---|---|---|
| PLACE-1 | Auto-placement engine | SS+RB gate | `0114→0234→0239 auto_place_track` (threshold 30, max 5) | **⚠ NO — DB trigger on release auto-writes catalog** (toggle `auto_placement_enabled` default true) |
| PLACE-2 | Track analysis derivation | RB | `0113 derive_track_analysis` | no |
| PLACE-3 | Admin feedback delta | RB | `0266 _check_admin_feedback` | admin action |

### Behavior learning / reactions / adaptive weights
| ID | Name | Type | Loc | Human gate |
|---|---|---|---|---|
| LRN-1 | Behavior boost→final_fit | SS linear | `0251 _compute_behavior_boost` | admin-run; separate col |
| LRN-2 | Track×store behavior score | SS counts | `0252 recompute_track_store_behavior_scores` | display/QC |
| LRN-3 | Behavior v2 (dual-run shadow) | SS | `0255` | **shadow — no fit impact** |
| LRN-4 | QC rule engine | RB | `0250-0252 admin_generate_qc_queue_candidates` | queue only |
| LRN-5 | Decision-pattern clustering | SS mean/stddev | `0332 refresh_decision_pattern_clusters` (cron 0343) | signal only |
| LRN-6 | Track decision prediction | SS Z-score | `0333/0334 predict_track_decision` (trigger) | advisory badge |
| LRN-7 | Weight diagnostics (Pearson) | SS corr | `0335 admin_weight_diagnostics` | **never auto-applies** |
| LRN-8 | Regression weight optimizer | SS OLS | `0336/0337` (cron weekly Mon 04:00 UTC) | **applied only via `admin_decide_weight_regression(approve)`**; 7-day expire |
| LRN-9 | Per-segment weight resolver | RB specificity | `0337 _ai_resolve_weights` | overrides on approve |
| LRN-10 | Auto-recompute queue + snapshots | RB | `0338 process_fit_recompute_jobs` (cron ~2min) | fires after weight approved |
| LRN-11 | Store-track reactions (collect) | RB capture | `0345 upsert_store_track_reaction` | raw signal |
| LRN-12 | Reaction→soft fit adjustment | SS bounded | `0347 _ai_reaction_adjustment` clamp(−5,+3) | **no gate — auto-applied, bounded** |
| LRN-13 | Store-learning readiness | SS | `0346 admin_store_learning_dashboard` | display |

### Recommendation / flow / scheduling
| ID | Name | Type | Loc | Human gate |
|---|---|---|---|---|
| REC-1 | Personalized rec (warm) | SS weighted | `0135/0136 get_personalized_recommendations` | no |
| REC-2 | Cold-start boost | SS | `0328` | no |
| REC-3 | Collaborative filtering | SS co-occurrence | `0217 recommend_collab_tracks_for` | no |
| REC-4 | Smart auto-playlist (dynamic) | SS rule-weighted | `0103 get_auto_playlist_tracks` | read-only |
| FLOW-1 | Playlist flow scoring | SS penalty | `0180 admin_compute_playlist_flow` | read-only diagnostic |
| FLOW-2 | Playlist auto-reorder | SS greedy NN | `0181 admin_generate_playlist_reorder` | **proposal; apply only via `admin_apply_playlist_reorder`** |
| SCH-1 | Business time-of-day scheduler | RB | `0007` + `useBusinessAutoSwitch.ts` | store owner owns |
| SCH-2 | Daily playlist refresh | RB fit-gate | `0341 cron_daily_playlist_refresh` (cron 08:00 KST, fit≥70) | **⚠ NO — cron auto-mutates released playlists** (toggle only) |
| SCH-3 | Policy automation engine | RB recurrence | `0378 admin_evaluate_policy_automation_rules` | **⚠ dry_run=false batch-deploys, no per-run confirm** |
| SCH-4 | Announcement audio scheduler | RB recurrence | `0381/0388` | automated trigger; admin gates CRUD |

### Settlement (listed only — see settlement audit)
| ID | Name | Type | Loc | Human gate | Tests |
|---|---|---|---|---|---|
| SET-1 | Settlement compute (Logic-2) | SS deterministic | `0454 _settlement_compute` IMMUTABLE; `0455` RPCs | **admin, dry_run, advisory lock, held on unknown rate** | **Yes** `supabase/tests/settlement_*.sql` |

## Groupings
**(a) Rule-based operational (engineering/config review only):** AUD-2/4, GRD-1/5/6/7/8/9/10, PLACE-1 gate + 2/3, LRN-4, REC-4, SCH-1/3/4, FIT-6/7/8. **Catalog-auto-mutating (attention):** PLACE-1 (release trigger), SCH-2 (cron inject), SCH-3 (dry_run=false).

**(b) Statistical/score needing data accumulation (SQL math, no ML):** FIT-1..5, GRD-2/4, LRN-1/2/5/6/7/8/9/10/12/13, REC-1/2/3, FLOW-1/2, PLACE-1 score, SET-1. Hand-tuned; scores will shift as events accumulate.

**(c) Needs ML/MIR expert:** ML-1/ML-2 (CLAP — self-documented overfitting: happy 59%, boutique 100% skew; unversioned prompts; **production ingestion is manual backfill, no pg_cron, `embed_backend_url` empty by default**) — **highest priority**; AUD-1/3/5 (DSP heuristics + crude 4× true-peak); ML-4/ML-5; FIT-5 (blind trust of ML output, no confidence gating).

**(d) Needs statistician / data engineer / royalty expert:**
- **Statistician:** LRN-8 (**each fit sub-score regressed independently then R²-normalized — not a valid joint model**), LRN-5/6 (Z-score/mean-stddev mislabeled "clustering/prediction"), FIT-2/3 (magic constants, no ground-truth), GRD-2 (violation-rate proxy), LRN-12 (auto-applied bounds).
- **Data engineer:** ML-1 pipeline not automated; **no automated tests on any scoring algorithm** (only settlement + brand-media tested); weight-config has no bounds/sum validation.
- **Royalty expert:** SET-1 (already covered; deterministic, admin-gated, dry_run, tested).

## Human-gate summary
- **Gated (safe):** ML-2 apply, ML-5 recs, FIT-6/7, FLOW-2, LRN-8, GRD-3/4/5, SET-1, guardrail overrides.
- **Auto-applied / no per-action gate (ALG-F1, P2 attention):** PLACE-1 (release trigger), SCH-2 (daily cron inject), SCH-3 (dry_run=false), LRN-12 (bounded), GRD-1/7 hard-block (auto fit=0), GRD-10 auto-exclude. Mitigations: hard blocks only zero score / skip (never delete); most policy paths write `review_needed` rather than mutating catalog.

## Findings
- **ALG-F1 (P2):** Three paths auto-mutate the live catalog without per-action human confirm (PLACE-1 release trigger, SCH-2 daily cron, SCH-3 dry_run=false). Recommend explicit confirm or keep observe-mode. No change this phase.
- **ALG-F2 (P2, expert):** LRN-8 regression weighting is statistically invalid (independent per-sub-score regressions). Flag for statistician; do not ship as auto-weighting.
- **ALG-F3 (P3):** CLAP ingestion pipeline not automated (manual operator backfill; `embed_backend_url` empty) → ML features may be stale/absent on new tracks. Downstream fit "AI boost" then contributes 0.
- **ALG-F4 (P3):** No algorithm except settlement + brand-media has automated tests.
