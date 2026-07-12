// AI-MUSIC-4 — Controlled Experiments API. Wraps the 0467 read RPCs (per-store experiment signals +
// observational arm outcome + persisted history/recommendations) and runs the rule-based aiExperiments
// engines client-side. Read-only analysis + Draft/Snapshot/Audit writes. Nothing starts a pilot, assigns a
// store to a group, or deploys a playlist — every result is a recommendation/draft requiring operator approval.

import { supabase } from '@/lib/supabase';
import {
  computeEligibility, recommendPilotStores, designGroups, evaluateGuardrails, detectContamination,
  computeOutcome, rolloutRecommendation, buildLearningFeedback, buildExplainV3,
  type StoreExperimentSignal, type Eligibility, type PilotRecommendation, type ControlTreatmentDesign,
  type ExperimentOutcome, type RolloutRecommendation, type LearningFeedback, type ExplainV3,
} from '@/lib/aiExperiments';

// ── Per-store experiment signals (READ-ONLY) ──
type SignalRow = Partial<StoreExperimentSignal> & { storeId: string };
function toSignal(r: SignalRow): StoreExperimentSignal {
  return {
    storeId: r.storeId, storeName: r.storeName ?? null, industry: r.industry ?? null, browser: r.browser ?? null,
    device: r.device ?? null, enterpriseId: r.enterpriseId ?? null,
    playbacks: r.playbacks ?? 0, sessions: r.sessions ?? 0, completes: r.completes ?? 0, skips: r.skips ?? 0,
    likes: r.likes ?? 0, dislikes: r.dislikes ?? 0, completionRate: r.completionRate ?? null, skipRate: r.skipRate ?? null,
    streamingQualityScore: r.streamingQualityScore ?? null, criticalIncidents: r.criticalIncidents ?? null,
    recentRecoveryCount: r.recentRecoveryCount ?? null, recentReleaseRegression: r.recentReleaseRegression ?? null,
    offlineDays: r.offlineDays ?? null, profileCoverage: r.profileCoverage ?? 0, compatibilityCoverage: r.compatibilityCoverage ?? 0,
    recentPlaylistChange: r.recentPlaylistChange ?? false, activeExperiments: r.activeExperiments ?? 0,
  };
}

export async function getExperimentSignals(days = 30, limit = 200): Promise<StoreExperimentSignal[]> {
  const { data, error } = await supabase.rpc('admin_ai_experiment_eligibility', { p_days: days, p_limit: limit });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; stores?: SignalRow[] };
  return res.ok ? (res.stores ?? []).map(toSignal) : [];
}

export interface ExperimentDesignBundle {
  signals: StoreExperimentSignal[];
  eligibility: Eligibility[];
  pilot: PilotRecommendation;
  design: ControlTreatmentDesign;
}
/** Signals → eligibility (per store) → pilot recommendation → recommended control/treatment design. */
export async function getExperimentDesign(days = 30): Promise<ExperimentDesignBundle> {
  const signals = await getExperimentSignals(days);
  const eligibility = signals.map((s) => computeEligibility(s));
  const pilot = recommendPilotStores(signals);
  const pickedIds = new Set(pilot.recommendedStores.map((p) => p.storeId));
  const design = designGroups(signals.filter((s) => pickedIds.has(s.storeId)));
  return { signals, eligibility, pilot, design };
}

// ── Observational outcome for two provided store-id lists (directional only) ──
interface ArmAgg { stores: number; sessions: number; playbacks: number; completes: number; skips: number; likes: number; completionRate: number | null; skipRate: number | null; likeRatio: number | null; }
export interface OutcomeBundle {
  arms: { control: ArmAgg; treatment: ArmAgg };
  outcome: ExperimentOutcome;
  rollout: RolloutRecommendation;
  feedback: LearningFeedback[];
  explain: ExplainV3;
}
export async function getObservationalOutcome(controlIds: string[], treatmentIds: string[], days = 30): Promise<OutcomeBundle | null> {
  const { data, error } = await supabase.rpc('admin_ai_experiment_outcome', { p_control: controlIds, p_treatment: treatmentIds, p_days: days });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; control?: ArmAgg; treatment?: ArmAgg };
  if (!res.ok || !res.control || !res.treatment) return null;
  const c = res.control, t = res.treatment;

  // Guardrail inputs: streaming/incident sources NOT_AVAILABLE in prod → honest NOT_AVAILABLE.
  const guardrail = evaluateGuardrails({});
  const contamination = detectContamination({ controlStoreIds: controlIds, treatmentStoreIds: treatmentIds, guardrailSourcesAvailable: false });

  const outcome = computeOutcome({
    primaryMetric: 'completion_rate', primaryControl: c.completionRate, primaryTreatment: t.completionRate,
    secondary: [
      { metric: 'skip_rate', control: c.skipRate, treatment: t.skipRate },
      { metric: 'like_ratio', control: c.likeRatio, treatment: t.likeRatio },
    ],
    sample: { controlStores: c.stores, treatmentStores: t.stores, controlSessions: c.sessions, treatmentSessions: t.sessions, controlPlaybacks: c.playbacks, treatmentPlaybacks: t.playbacks },
    guardrail, contamination, balanceScore: 0.7, signalCoverage: 0.6,
  });
  const rollout = rolloutRecommendation({ outcome, industriesCovered: 2, browserBias: false, deviceBias: false, driftWithinTolerance: true });
  const feedback = buildLearningFeedback(outcome);
  const explain = buildExplainV3({ design: null, outcome, rollout });
  return { arms: { control: c, treatment: t }, outcome, rollout, feedback, explain };
}

// ── Persisted experiments / recommendations (read) ──
export interface ExperimentRow { id: string; name: string; status: string; targetIndustry: string | null; primaryMetric: string | null; confidence: number | null; controlCount: number; treatmentCount: number; snapshots: number; createdAt: string; }
export async function getExperimentHistory(limit = 50): Promise<ExperimentRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_experiment_history', { p_limit: limit });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; experiments?: ExperimentRow[] };
  return res.ok ? (res.experiments ?? []) : [];
}
export interface RecommendationRow { id: string; experimentId: string; kind: string; recommendation: string | null; reasons: string[]; confidence: number | null; createdAt: string; }
export async function getExperimentRecommendations(experimentId: string | null, limit = 100): Promise<RecommendationRow[]> {
  const { data, error } = await supabase.rpc('admin_ai_experiment_recommendation', { p_experiment: experimentId, p_limit: limit });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; recommendations?: RecommendationRow[] };
  return res.ok ? (res.recommendations ?? []) : [];
}

// ── Advisory writes (Draft / Snapshot / Review — no start/assign/deploy) ──
export async function saveExperimentDraft(input: {
  name: string; hypothesis: string; candidatePlaylistId: string | null; candidateVersion: number | null;
  targetIndustry: string | null; primaryMetric: string; secondaryMetrics: string[]; guardrailMetrics: string[];
  confidence: number | null; controlStoreIds: string[]; treatmentStoreIds: string[];
}): Promise<string | null> {
  const { data, error } = await supabase.rpc('record_ai_experiment_draft', {
    p_name: input.name, p_hypothesis: input.hypothesis, p_candidate: input.candidatePlaylistId, p_version: input.candidateVersion,
    p_industry: input.targetIndustry, p_primary: input.primaryMetric, p_secondary: input.secondaryMetrics, p_guardrail: input.guardrailMetrics,
    p_confidence: input.confidence, p_control: input.controlStoreIds, p_treatment: input.treatmentStoreIds,
  });
  if (error) throw error;
  return ((data ?? {}) as { ok?: boolean; id?: string }).id ?? null;
}
export async function saveExperimentSnapshot(experimentId: string, type: string, payload: unknown): Promise<boolean> {
  const { data, error } = await supabase.rpc('record_ai_experiment_snapshot', { p_experiment: experimentId, p_type: type, p_payload: payload });
  if (error) throw error;
  return ((data ?? {}) as { ok?: boolean }).ok === true;
}
export async function saveExperimentReview(experimentId: string, action: string, note: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('record_ai_experiment_review', { p_experiment: experimentId, p_action: action, p_note: note });
  if (error) throw error;
  return ((data ?? {}) as { ok?: boolean }).ok === true;
}
