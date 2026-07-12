// AI-MUSIC-4 — Controlled Playlist Experimentation & Pilot Rollout Intelligence types. Rule-based (NO LLM /
// NO ML / NO stats-significance library) experiment DESIGN & ANALYSIS layer over the AI-MUSIC-1~3 outputs +
// READ-ONLY real operation data. This is a design/analysis/recommendation system, NOT an execution system:
// the AI never starts a pilot, assigns a store to a group, deploys a playlist, expands, stops, or rolls back.
// Every output is RECOMMENDATION_ONLY / SIMULATION_ONLY / DRAFT / NOT_STARTED / NO_DATA / NOT_AVAILABLE /
// INSUFFICIENT_DATA and carries requiresApproval:true, automated:false.

export type DataState = 'READY' | 'NO_DATA' | 'NOT_AVAILABLE' | 'INSUFFICIENT_DATA';

// ── Per-store experiment signal (READ-ONLY, aggregated by the 0467 RPC) ─────────
export interface StoreExperimentSignal {
  storeId: string;
  storeName: string | null;
  industry: string | null;         // business_type / store_type_slug
  browser: string | null;          // playback_events_v2.browser
  device: string | null;           // playback_events_v2.device_type
  enterpriseId: string | null;     // franchise_stores → spillover risk

  playbacks: number;               // playback COUNT (not sessions, not tracks)
  sessions: number;                // DISTINCT session_id (not playbacks)
  completes: number;
  skips: number;
  likes: number;
  dislikes: number;
  completionRate: number | null;   // 0..1
  skipRate: number | null;         // 0..1

  // Guardrail-adjacent signals — null when the source is not applied (honest NOT_AVAILABLE)
  streamingQualityScore: number | null;   // 0..100 or null (streaming_quality_events not in prod)
  criticalIncidents: number | null;       // store_fleet_events not in prod → null
  recentRecoveryCount: number | null;
  recentReleaseRegression: boolean | null;
  offlineDays: number | null;

  // Coverage of AI-MUSIC-1~3 derived signals for this store (0..1)
  profileCoverage: number;
  compatibilityCoverage: number;

  recentPlaylistChange: boolean;   // playlist_id changed recently (contamination risk)
  activeExperiments: number;       // count of experiments this store is already in
}

// ── Experiment Eligibility ──────────────────────────────────────────────────────
export type EligibilityStatus = 'ELIGIBLE' | 'REVIEW_REQUIRED' | 'TEMPORARILY_EXCLUDED' | 'INELIGIBLE' | 'INSUFFICIENT_DATA';
export interface Eligibility {
  storeId: string;
  storeName: string | null;
  status: EligibilityStatus;
  reasons: string[];
  blockingReasons: string[];
  warnings: string[];
  sampleSize: { playbacks: number; sessions: number };
  signalCoverage: number;          // 0..1
  confidence: number | null;       // 0..100
  requiresApproval: true;
  automated: false;
}

// ── Pilot Store Recommendation ──────────────────────────────────────────────────
export interface PilotStorePick { storeId: string; storeName: string | null; industry: string | null; browser: string | null; device: string | null; expectedSessions: number; reason: string; }
export interface PilotExclusion { storeId: string; storeName: string | null; reason: string; }
export interface PilotRecommendation {
  status: DataState;
  recommendedStores: PilotStorePick[];
  excludedStores: PilotExclusion[];
  diversityCoverage: { industries: number; browsers: number; devices: number; note: string };
  expectedSample: { stores: number; sessions: number; playbacks: number };
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'NOT_AVAILABLE';
  confidence: number | null;
  requiresApproval: true;
  automated: false;
}

// ── Control / Treatment Design ──────────────────────────────────────────────────
export type GroupBalance = 'BALANCED' | 'ACCEPTABLE' | 'IMBALANCED' | 'CONTAMINATION_RISK' | 'INSUFFICIENT_DATA';
export interface GroupMember { storeId: string; storeName: string | null; industry: string | null; browser: string | null; device: string | null; sessions: number; playbacks: number; baselineSkipRate: number | null; baselineCompletionRate: number | null; }
export interface GroupStats { stores: number; sessions: number; playbacks: number; meanSkipRate: number | null; meanCompletionRate: number | null; industries: Record<string, number>; }
export interface ControlTreatmentDesign {
  status: GroupBalance;
  control: { members: GroupMember[]; stats: GroupStats; note: string };   // Control = keep existing playlist
  treatment: { members: GroupMember[]; stats: GroupStats; note: string }; // Treatment = candidate preview only
  balanceScore: number | null;     // 0..1
  contaminationRisk: string[];     // e.g. same-enterprise spillover, duplicate store
  reasons: string[];
  requiresApproval: true;
  automated: false;
}

// ── Experiment Plan (Draft) ─────────────────────────────────────────────────────
export type ExperimentStatus = 'DRAFT' | 'REVIEW_REQUIRED' | 'APPROVED_FOR_MANUAL_SETUP' | 'NOT_STARTED' | 'OBSERVING' | 'ANALYSIS_READY' | 'COMPLETED' | 'CANCELLED';
export interface ExperimentPlan {
  experimentId: string;
  name: string;
  hypothesis: string;
  candidatePlaylistId: string | null;
  candidateVersion: number | null;
  controlDefinition: string;
  treatmentDefinition: string;
  targetIndustry: string | null;
  targetStoreCount: number;
  recommendedControlStores: string[];
  recommendedTreatmentStores: string[];
  primaryMetric: string;
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  minimumSessions: number;
  minimumPlaybacks: number;
  minimumDurationDays: number;
  maximumDurationDays: number;
  stopConditions: string[];
  expansionConditions: string[];
  contaminationRules: string[];
  confidence: number | null;
  status: ExperimentStatus;
  requiresApproval: true;
  automated: false;
}

// ── Metrics / Lift ──────────────────────────────────────────────────────────────
export interface MetricValue { metric: string; control: number | null; treatment: number | null; absoluteDelta: number | null; relativeDelta: number | null; }
export interface Lift { metric: string; label: string; absoluteDelta: number | null; relativeDelta: number | null; note: string; }

// ── Guardrail Evaluation ────────────────────────────────────────────────────────
export type GuardrailStatus = 'PASS' | 'WARNING' | 'FAIL' | 'NOT_AVAILABLE' | 'INSUFFICIENT_DATA';
export interface GuardrailCheck { key: string; label: string; control: number | null; treatment: number | null; status: GuardrailStatus; note: string; }
export interface GuardrailEvaluation { status: GuardrailStatus; checks: GuardrailCheck[]; failed: string[]; warned: string[]; notes: string[]; }

// ── Experiment Outcome ──────────────────────────────────────────────────────────
export type OutcomeClass = 'TREATMENT_BETTER' | 'CONTROL_BETTER' | 'NO_MEANINGFUL_DIFFERENCE' | 'GUARDRAIL_FAILED' | 'CONTAMINATED' | 'INSUFFICIENT_DATA';
export type SignificanceMode = 'SIGNIFICANCE_NOT_AVAILABLE' | 'DIRECTIONAL_ONLY';
export interface ExperimentOutcome {
  classification: OutcomeClass;
  significance: SignificanceMode;    // this phase never fabricates p-values
  primary: MetricValue;
  secondary: MetricValue[];
  lifts: Lift[];
  sample: { controlStores: number; treatmentStores: number; controlSessions: number; treatmentSessions: number; controlPlaybacks: number; treatmentPlaybacks: number };
  guardrail: GuardrailEvaluation;
  contaminationStatus: ContaminationStatus;
  dataQuality: DataState;
  confidence: number | null;
  notes: string[];
}

// ── Contamination ───────────────────────────────────────────────────────────────
export type ContaminationStatus = 'CLEAN' | 'SUSPECTED' | 'CONTAMINATED' | 'UNKNOWN';
export interface ContaminationResult { status: ContaminationStatus; evidence: string[]; affectedStores: string[]; }

// ── Rollout Recommendation ──────────────────────────────────────────────────────
export type RolloutClass = 'DO_NOT_ROLLOUT' | 'CONTINUE_PILOT' | 'EXPAND_SMALL' | 'EXPAND_MEDIUM' | 'READY_FOR_MANUAL_ROLLOUT' | 'ROLLBACK_RECOMMENDED' | 'INSUFFICIENT_DATA';
export interface RolloutRecommendation {
  recommendation: RolloutClass;
  reasons: string[];
  supportingMetrics: string[];
  risks: string[];
  guardrails: GuardrailStatus;
  confidence: number | null;
  suggestedNextSample: { sessions: number; playbacks: number } | null;
  suggestedNextDurationDays: number | null;
  automated: false;
  requiresApproval: true;
  remoteControl: false;
  actualDeployment: false;
}

// ── Learning Feedback (recommendation only) ─────────────────────────────────────
export type FeedbackKind = 'INCREASE_TRACK_WEIGHT' | 'DECREASE_TRACK_WEIGHT' | 'PROMOTE_CANDIDATE' | 'HOLD_CANDIDATE' | 'RETIRE_CANDIDATE' | 'INCREASE_EXPLORATION' | 'REDUCE_EXPLORATION' | 'UPDATE_INDUSTRY_RULE' | 'UPDATE_TIME_RULE' | 'REVIEW_DRIFT_THRESHOLD';
export interface LearningFeedback { kind: FeedbackKind; reason: string; recommendationOnly: true; applied: false; requiresApproval: true; }

// ── Explainability v3 ───────────────────────────────────────────────────────────
export interface ExplainV3Item { question: string; answer: string; }
export interface ExplainV3 { summary: string; items: ExplainV3Item[]; missingSignals: string[]; }
