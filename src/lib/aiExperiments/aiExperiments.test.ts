// AI-MUSIC-4 — Controlled-experiment engine tests. Rule-based (no LLM/ML/stats-lib); every result is a
// recommendation/draft, never executed (requiresApproval:true, automated:false, actualDeployment:false).
// Store / Session / Playback counts stay distinct; small samples never confirm a winner; no fabricated
// significance. Honest NO_DATA / NOT_AVAILABLE / INSUFFICIENT_DATA.

import { describe, it, expect } from 'vitest';
import {
  computeEligibility, recommendPilotStores, designGroups, buildExperimentPlan, evaluateGuardrails,
  detectContamination, computeOutcome, rolloutRecommendation, buildLearningFeedback, buildExplainV3,
  metricValue, computeLift, getAiExperimentsConfig, __resetAiExperimentsConfig,
} from './index';
import type { StoreExperimentSignal, GuardrailEvaluation, ContaminationResult } from './types';

function store(i: number, o: Partial<StoreExperimentSignal> = {}): StoreExperimentSignal {
  return {
    storeId: `s${i}`, storeName: `Store ${i}`, industry: ['cafe', 'gym', 'hotel', 'office'][i % 4],
    browser: ['chrome', 'safari'][i % 2], device: ['desktop', 'mobile'][i % 2], enterpriseId: null,
    playbacks: 1000, sessions: 120, completes: 700, skips: 150, likes: 40, dislikes: 5,
    completionRate: 0.7, skipRate: 0.15, streamingQualityScore: null, criticalIncidents: null,
    recentRecoveryCount: null, recentReleaseRegression: null, offlineDays: 0,
    profileCoverage: 0.8, compatibilityCoverage: 0.7, recentPlaylistChange: false, activeExperiments: 0, ...o,
  };
}

describe('eligibility', () => {
  it('ELIGIBLE with sufficient sample + coverage', () => {
    const e = computeEligibility(store(1));
    expect(e.status).toBe('ELIGIBLE');
    expect(e.requiresApproval).toBe(true);
    expect(e.automated).toBe(false);
    expect(e.warnings.some((w) => w.includes('NOT_AVAILABLE'))).toBe(true); // streaming/incident honest
  });
  it('INSUFFICIENT_DATA below sample floor (playbacks vs sessions distinct)', () => {
    expect(computeEligibility(store(1, { playbacks: 50 })).status).toBe('INSUFFICIENT_DATA');
    expect(computeEligibility(store(1, { sessions: 5 })).status).toBe('INSUFFICIENT_DATA');
  });
  it('INELIGIBLE when already in an experiment (blocking reason)', () => {
    const e = computeEligibility(store(1, { activeExperiments: 1 }));
    expect(e.status).toBe('INELIGIBLE');
    expect(e.blockingReasons.length).toBeGreaterThan(0);
  });
  it('INELIGIBLE on recent playlist change (baseline contamination)', () => {
    expect(computeEligibility(store(1, { recentPlaylistChange: true })).status).toBe('INELIGIBLE');
  });
  it('TEMPORARILY_EXCLUDED on long offline / low streaming quality', () => {
    expect(computeEligibility(store(1, { offlineDays: 10 })).status).toBe('TEMPORARILY_EXCLUDED');
    expect(computeEligibility(store(1, { streamingQualityScore: 40 })).status).toBe('TEMPORARILY_EXCLUDED');
  });
  it('REVIEW_REQUIRED on low coverage', () => {
    expect(computeEligibility(store(1, { profileCoverage: 0.2 })).status).toBe('REVIEW_REQUIRED');
  });
});

describe('pilot store recommendation', () => {
  it('recommends diverse eligible stores', () => {
    const rec = recommendPilotStores(Array.from({ length: 10 }, (_, i) => store(i)));
    expect(rec.status).toBe('READY');
    expect(rec.recommendedStores.length).toBeGreaterThanOrEqual(4);
    expect(rec.diversityCoverage.industries).toBeGreaterThanOrEqual(2);
    expect(rec.requiresApproval).toBe(true);
  });
  it('INSUFFICIENT_DATA when too few eligible (never invents stores)', () => {
    const rec = recommendPilotStores([store(1, { playbacks: 10 }), store(2, { playbacks: 10 })]);
    expect(rec.status).toBe('INSUFFICIENT_DATA');
    expect(rec.recommendedStores).toHaveLength(0);
  });
  it('excludes ineligible stores with a reason', () => {
    const rec = recommendPilotStores([...Array.from({ length: 6 }, (_, i) => store(i)), store(99, { activeExperiments: 1 })]);
    expect(rec.excludedStores.some((x) => x.storeId === 's99')).toBe(true);
  });
});

describe('control / treatment design', () => {
  it('BALANCED / ACCEPTABLE for uniform stores', () => {
    const d = designGroups(Array.from({ length: 8 }, (_, i) => store(i)));
    expect(['BALANCED', 'ACCEPTABLE']).toContain(d.status);
    expect(d.control.members.length).toBeGreaterThanOrEqual(2);
    expect(d.treatment.members.length).toBeGreaterThanOrEqual(2);
    expect(d.control.note).toContain('기존 Playlist');
    expect(d.treatment.note).toContain('Candidate Preview');
  });
  it('INSUFFICIENT_DATA with too few stores', () => {
    expect(designGroups([store(1), store(2)]).status).toBe('INSUFFICIENT_DATA');
  });
  it('CONTAMINATION_RISK on same-enterprise spillover', () => {
    const d = designGroups(Array.from({ length: 6 }, (_, i) => store(i, { enterpriseId: 'ent1' })));
    expect(d.status).toBe('CONTAMINATION_RISK');
    expect(d.contaminationRisk.length).toBeGreaterThan(0);
  });
  it('keeps Session/Playback distinct in stats', () => {
    const d = designGroups(Array.from({ length: 6 }, (_, i) => store(i, { sessions: 100, playbacks: 900 })));
    expect(d.control.stats.sessions).not.toBe(d.control.stats.playbacks);
  });
});

describe('metrics + lift', () => {
  it('absolute + relative delta, zero-denominator guard', () => {
    const mv = metricValue('completion_rate', 0.6, 0.66);
    expect(mv.absoluteDelta).toBeCloseTo(0.06, 5);
    expect(mv.relativeDelta).toBeCloseTo(0.1, 3);
    expect(metricValue('completion_rate', 0, 0.5).relativeDelta).toBeNull(); // zero denominator
    expect(computeLift('completion_rate', 0, 0.5).note).toContain('분모');
  });
  it('null when a side missing', () => {
    expect(metricValue('skip_rate', null, 0.2).absoluteDelta).toBeNull();
  });
});

describe('guardrail evaluation', () => {
  it('NOT_AVAILABLE when no guardrail source (honest, no fabricated pass)', () => {
    const g = evaluateGuardrails({});
    expect(g.status).toBe('NOT_AVAILABLE');
  });
  it('PASS when metrics healthy', () => {
    const g = evaluateGuardrails({ streamingQuality: { control: 90, treatment: 90 }, stallRate: { control: 0.01, treatment: 0.01 } });
    expect(g.status).toBe('PASS');
  });
  it('WARNING on small streaming drop, FAIL on large drop', () => {
    expect(evaluateGuardrails({ streamingQuality: { control: 90, treatment: 86 } }).status).toBe('WARNING');
    expect(evaluateGuardrails({ streamingQuality: { control: 90, treatment: 80 } }).status).toBe('FAIL');
  });
  it('FAIL on stall increase and on critical incident', () => {
    expect(evaluateGuardrails({ stallRate: { control: 0.01, treatment: 0.08 } }).status).toBe('FAIL');
    expect(evaluateGuardrails({ criticalIncidents: 1 }).status).toBe('FAIL');
  });
});

describe('contamination', () => {
  it('CONTAMINATED when a store is in both arms', () => {
    const c = detectContamination({ controlStoreIds: ['a', 'b'], treatmentStoreIds: ['b', 'c'] });
    expect(c.status).toBe('CONTAMINATED');
    expect(c.affectedStores).toContain('b');
  });
  it('SUSPECTED on mid-experiment version change', () => {
    expect(detectContamination({ controlStoreIds: ['a'], treatmentStoreIds: ['b'], storesWithPlaylistVersionChange: ['a'] }).status).toBe('SUSPECTED');
  });
  it('UNKNOWN when guardrail sources unavailable and no other evidence', () => {
    expect(detectContamination({ controlStoreIds: ['a'], treatmentStoreIds: ['b'], guardrailSourcesAvailable: false }).status).toBe('UNKNOWN');
  });
  it('CLEAN when nothing detected', () => {
    expect(detectContamination({ controlStoreIds: ['a'], treatmentStoreIds: ['b'], guardrailSourcesAvailable: true }).status).toBe('CLEAN');
  });
});

const cleanGuard: GuardrailEvaluation = { status: 'PASS', checks: [], failed: [], warned: [], notes: [] };
const failGuard: GuardrailEvaluation = { status: 'FAIL', checks: [], failed: ['stall_session_rate'], warned: [], notes: [] };
const clean: ContaminationResult = { status: 'CLEAN', evidence: [], affectedStores: [] };
const contaminated: ContaminationResult = { status: 'CONTAMINATED', evidence: [], affectedStores: ['x'] };

function outcomeInput(o: Record<string, unknown> = {}) {
  return {
    primaryMetric: 'completion_rate', primaryControl: 0.6, primaryTreatment: 0.7,
    secondary: [{ metric: 'skip_rate', control: 0.2, treatment: 0.15 }],
    sample: { controlStores: 4, treatmentStores: 4, controlSessions: 400, treatmentSessions: 400, controlPlaybacks: 3000, treatmentPlaybacks: 3000 },
    guardrail: cleanGuard, contamination: clean, balanceScore: 0.9, signalCoverage: 0.8, ...o,
  };
}

describe('outcome classification', () => {
  it('TREATMENT_BETTER on meaningful primary improvement + guardrail PASS', () => {
    const o = computeOutcome(outcomeInput());
    expect(o.classification).toBe('TREATMENT_BETTER');
    expect(o.significance).toBe('DIRECTIONAL_ONLY');
  });
  it('CONTROL_BETTER when treatment worse', () => {
    expect(computeOutcome(outcomeInput({ primaryControl: 0.7, primaryTreatment: 0.6 })).classification).toBe('CONTROL_BETTER');
  });
  it('NO_MEANINGFUL_DIFFERENCE for tiny delta', () => {
    expect(computeOutcome(outcomeInput({ primaryControl: 0.6, primaryTreatment: 0.605 })).classification).toBe('NO_MEANINGFUL_DIFFERENCE');
  });
  it('GUARDRAIL_FAILED even with primary improvement', () => {
    expect(computeOutcome(outcomeInput({ guardrail: failGuard })).classification).toBe('GUARDRAIL_FAILED');
  });
  it('CONTAMINATED overrides', () => {
    expect(computeOutcome(outcomeInput({ contamination: contaminated })).classification).toBe('CONTAMINATED');
  });
  it('INSUFFICIENT_DATA on small per-arm sample (no winner from small sample)', () => {
    const o = computeOutcome(outcomeInput({ sample: { controlStores: 2, treatmentStores: 2, controlSessions: 30, treatmentSessions: 30, controlPlaybacks: 100, treatmentPlaybacks: 100 } }));
    expect(o.classification).toBe('INSUFFICIENT_DATA');
  });
});

describe('rollout recommendation', () => {
  const mk = (o: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    rolloutRecommendation({ outcome: computeOutcome(outcomeInput(o)), industriesCovered: 3, browserBias: false, deviceBias: false, driftWithinTolerance: true, ...extra });
  it('ROLLBACK_RECOMMENDED on guardrail fail', () => {
    expect(mk({ guardrail: failGuard }).recommendation).toBe('ROLLBACK_RECOMMENDED');
  });
  it('DO_NOT_ROLLOUT on contamination / control better', () => {
    expect(mk({ contamination: contaminated }).recommendation).toBe('DO_NOT_ROLLOUT');
    expect(mk({ primaryControl: 0.7, primaryTreatment: 0.6 }).recommendation).toBe('DO_NOT_ROLLOUT');
  });
  it('CONTINUE_PILOT when improved but small sample or bias', () => {
    expect(mk({}, { browserBias: true }).recommendation).toBe('CONTINUE_PILOT');
  });
  it('EXPAND_SMALL / EXPAND_MEDIUM / READY scale with sample', () => {
    const big = (sessions: number) => ({ sample: { controlStores: 6, treatmentStores: 6, controlSessions: sessions, treatmentSessions: sessions, controlPlaybacks: sessions * 10, treatmentPlaybacks: sessions * 10 } });
    expect(mk(big(400)).recommendation).toBe('EXPAND_SMALL');
    expect(mk(big(1000)).recommendation).toBe('EXPAND_MEDIUM');
    expect(mk(big(2000)).recommendation).toBe('READY_FOR_MANUAL_ROLLOUT');
  });
  it('never executes (all guards false)', () => {
    const r = mk({});
    expect(r.automated).toBe(false);
    expect(r.requiresApproval).toBe(true);
    expect(r.remoteControl).toBe(false);
    expect(r.actualDeployment).toBe(false);
  });
});

describe('learning feedback (recommendation only)', () => {
  it('PROMOTE on treatment better, RETIRE on guardrail fail', () => {
    expect(buildLearningFeedback(computeOutcome(outcomeInput())).some((f) => f.kind === 'PROMOTE_CANDIDATE')).toBe(true);
    expect(buildLearningFeedback(computeOutcome(outcomeInput({ guardrail: failGuard }))).some((f) => f.kind === 'RETIRE_CANDIDATE')).toBe(true);
  });
  it('all feedback is recommendationOnly + not applied', () => {
    for (const f of buildLearningFeedback(computeOutcome(outcomeInput()))) {
      expect(f.recommendationOnly).toBe(true);
      expect(f.applied).toBe(false);
      expect(f.requiresApproval).toBe(true);
    }
  });
});

describe('experiment plan (draft)', () => {
  it('DRAFT status, groups recommended, never auto-approved', () => {
    const design = designGroups(Array.from({ length: 8 }, (_, i) => store(i)));
    const plan = buildExperimentPlan({ experimentId: 'exp-1', name: 'T', hypothesis: 'H', candidatePlaylistId: 'pl-1', candidateVersion: 2, targetIndustry: 'cafe', design, primaryMetric: 'completion_rate', secondaryMetrics: ['skip_rate'], guardrailMetrics: ['streaming_quality_score'], confidence: 70 });
    expect(['DRAFT', 'REVIEW_REQUIRED']).toContain(plan.status);
    expect(plan.requiresApproval).toBe(true);
    expect(plan.automated).toBe(false);
    expect(plan.recommendedControlStores.length + plan.recommendedTreatmentStores.length).toBe(plan.targetStoreCount);
  });
});

describe('explainability v3', () => {
  it('explains conclusion + missing signals, no raw internals dump', () => {
    const outcome = computeOutcome(outcomeInput({ guardrail: { status: 'NOT_AVAILABLE', checks: [{ key: 'streaming_quality_score', label: 'Streaming Quality', control: null, treatment: null, status: 'NOT_AVAILABLE', note: '' }], failed: [], warned: [], notes: [] } }));
    const ex = buildExplainV3({ design: null, outcome, rollout: null });
    expect(ex.summary).toContain('추천');
    expect(ex.missingSignals.length).toBeGreaterThan(0);
  });
});

describe('config (flags default OFF)', () => {
  it('experiments/pilot/analysis/rollout/audit default OFF', () => {
    __resetAiExperimentsConfig();
    const c = getAiExperimentsConfig();
    expect(c.experimentsEnabled).toBe(false);
    expect(c.pilotRecommendationEnabled).toBe(false);
    expect(c.analysisEnabled).toBe(false);
    expect(c.rolloutRecommendationEnabled).toBe(false);
    expect(c.auditEnabled).toBe(false);
  });
});
