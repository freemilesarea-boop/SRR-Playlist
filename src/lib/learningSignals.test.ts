import { describe, expect, it } from 'vitest';
import {
  BLOCKED_LEARNING_ACTIONS, EARLY_SKIP_SECONDS, FIXED_LEARNING_WARNING,
  HARD_POLICY_WEIGHT_KEYS, SAMPLE_THRESHOLDS, SIGNAL_VALUES, WEIGHT_DELTA_CAP,
  attributeEvent, backtestProposal, buildAggregate, buildLearningExplanation,
  compareOutcomes, computeLearningQuality, computeSignalConfidence, detectBias,
  evaluateCounterfactual, generateWeightProposal, isBlockedLearningAction,
  normalizeSignal, sampleStatus, scoreWithWeights,
  type BacktestCandidate, type ExposureRef, type LearningEventInput, type LearningEventRow,
} from './learningSignals';
import { REC_WEIGHTS } from './recommendIntelV2';

function mkEvent(over: Partial<LearningEventInput> = {}): LearningEventInput {
  return {
    idempotencyKey: 'k1', eventType: 'playback_completed', trackId: 't-1',
    storeId: 's-1', sessionId: 'sess-1', occurredAt: '2026-07-19T01:00:00Z',
    listenedSeconds: 180, trackDurationSeconds: 200, volume: 0.8, muted: false, exposureId: null,
    ...over,
  };
}
const EXPOSURE: ExposureRef = { id: 'x-1', trackId: 't-1', isShadow: false, exposedAt: '2026-07-19T00:00:00Z', source: 'recommendation_v1' };

describe('Signal Normalization(서버 규칙 동일)', () => {
  it('Like/Replay/Complete/Skip/Early Skip/Dislike 를 상수표대로 정규화한다', () => {
    expect(normalizeSignal(mkEvent({ eventType: 'track_liked' })).normalizedValue).toBe(SIGNAL_VALUES.like);
    expect(normalizeSignal(mkEvent({ eventType: 'track_replayed' })).normalizedValue).toBe(SIGNAL_VALUES.replay);
    expect(normalizeSignal(mkEvent({ eventType: 'playback_completed' })).normalizedValue).toBe(SIGNAL_VALUES.complete);
    expect(normalizeSignal(mkEvent({ eventType: 'playback_skipped', listenedSeconds: 120 })).normalizedValue).toBe(SIGNAL_VALUES.skip);
    const early = normalizeSignal(mkEvent({ eventType: 'playback_skipped', listenedSeconds: EARLY_SKIP_SECONDS - 1 }));
    expect(early.normalizedValue).toBe(SIGNAL_VALUES.early_skip);
    expect(early.reasons).toContain('early_skip');
    expect(normalizeSignal(mkEvent({ eventType: 'track_disliked' })).normalizedValue).toBe(SIGNAL_VALUES.dislike);
  });

  it('재생 실패는 선호 Negative 가 아니라 품질 신호(값 null)', () => {
    const r = normalizeSignal(mkEvent({ eventType: 'playback_failed' }));
    expect(r.signalType).toBe('quality_failure');
    expect(r.normalizedValue).toBeNull();
  });

  it('Muted/저볼륨 재생은 excluded', () => {
    expect(normalizeSignal(mkEvent({ muted: true })).signalStatus).toBe('excluded');
    expect(normalizeSignal(mkEvent({ volume: 0.05 })).signalStatus).toBe('excluded');
  });
});

describe('Attribution(임의 귀속 금지)', () => {
  it('명시 Exposure → attributed, Track 불일치/Shadow/역순서 → invalid', () => {
    expect(attributeEvent(mkEvent(), EXPOSURE, { queueSource: null, candidateSources: [] }).status).toBe('attributed');
    expect(attributeEvent(mkEvent({ trackId: 'other' }), EXPOSURE, { queueSource: null, candidateSources: [] }).status).toBe('invalid');
    expect(attributeEvent(mkEvent(), { ...EXPOSURE, isShadow: true }, { queueSource: null, candidateSources: [] }).status).toBe('invalid');
    expect(attributeEvent(mkEvent({ occurredAt: '2026-07-18T00:00:00Z' }), EXPOSURE, { queueSource: null, candidateSources: [] }).status).toBe('invalid');
  });

  it('Queue Source 추정 → partially, 복수 후보 → ambiguous, 식별자 없음/unknown → unattributed', () => {
    expect(attributeEvent(mkEvent(), null, { queueSource: 'playlist', candidateSources: ['playlist'] }).status).toBe('partially_attributed');
    expect(attributeEvent(mkEvent(), null, { queueSource: 'playlist', candidateSources: ['playlist', 'scheduler'] }).status).toBe('ambiguous');
    expect(attributeEvent(mkEvent(), null, { queueSource: null, candidateSources: [] }).status).toBe('unattributed');
    expect(attributeEvent(mkEvent(), null, { queueSource: 'unknown', candidateSources: ['unknown'] }).status).toBe('unattributed');
  });
});

describe('Confidence / Sufficiency', () => {
  it('Confidence 는 곱 구조이며 0~1 로 고정된다', () => {
    expect(computeSignalConfidence({ attribution: 1, eventValidity: 1, playbackQuality: 1, sample: 1 })).toBe(1);
    expect(computeSignalConfidence({ attribution: 0.6, eventValidity: 0.5, playbackQuality: 1, sample: 1 })).toBe(0.3);
    expect(computeSignalConfidence({ attribution: 2, eventValidity: 1, playbackQuality: 1, sample: 1 })).toBe(1);
  });

  it('Sample 기준 미달은 insufficient_data — 기준을 완화하지 않는다', () => {
    expect(sampleStatus('track', { exposure: 20, playback: 10 })).toBe('sufficient');
    expect(sampleStatus('track', { exposure: 19, playback: 10 })).toBe('insufficient_data');
    expect(sampleStatus('store', { playback: 50, days: 7 })).toBe('sufficient');
    expect(sampleStatus('store', { playback: 50, days: 3 })).toBe('insufficient_data');
    expect(sampleStatus('algorithm', { exposure: 100, validOutcome: 30 })).toBe('sufficient');
    expect(sampleStatus('algorithm', { exposure: 100, validOutcome: 29 })).toBe('insufficient_data');
  });
});

describe('Aggregate / Bias', () => {
  const rows: LearningEventRow[] = [
    { eventType: 'playback_started', trackId: 't-1', storeId: 's-1', signalStatus: 'valid', attributionStatus: 'attributed', normalizedValue: 0, confidence: 0.9 },
    { eventType: 'playback_started', trackId: 't-1', storeId: 's-1', signalStatus: 'valid', attributionStatus: 'attributed', normalizedValue: 0, confidence: 0.9 },
    { eventType: 'playback_completed', trackId: 't-1', storeId: 's-1', signalStatus: 'valid', attributionStatus: 'attributed', normalizedValue: 0.6, confidence: 0.9 },
    { eventType: 'playback_skipped', trackId: 't-1', storeId: 's-1', signalStatus: 'valid', attributionStatus: 'unattributed', normalizedValue: -0.4, confidence: 0.3 },
    { eventType: 'playback_failed', trackId: 't-1', storeId: 's-1', signalStatus: 'valid', attributionStatus: 'attributed', normalizedValue: null, confidence: 0.5 },
  ];

  it('Track Aggregate — 지표/율/attributedRate/sampleStatus 계산', () => {
    const a = buildAggregate('track', 't-1', rows, 5);
    expect(a.playCount).toBe(2);
    expect(a.completionCount).toBe(1);
    expect(a.completionRate).toBe(0.5);
    expect(a.failureCount).toBe(1);
    expect(a.attributedRate).toBe(0.8);
    expect(a.sampleStatus).toBe('insufficient_data'); // Exposure 5 < 20
  });

  it('Bias — Store/Artist 편중, Position Bias, Attribution 누락, Reaction Sparse, 중복 Burst', () => {
    const flags = detectBias({
      storeShares: { 's-1': 0.8 }, artistShares: { a1: 0.4 }, genreShares: { jazz: 0.3 },
      avgExposedRank: 8, avgPlayedRank: 2, unattributedRatio: 0.6,
      reactionCount: 3, duplicateRatio: 0.1, newTrackRatio: 0.01,
    });
    const codes = flags.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining([
      'store_concentration', 'artist_concentration', 'position_bias',
      'missing_attribution', 'reaction_sparse', 'duplicate_burst', 'new_track_underrepresented',
    ]));
    // 자동 보정 없음 — 경고 객체만 반환.
    expect(flags.every((f) => 'message' in f)).toBe(true);
  });
});

describe('v1/v2 비교 / Counterfactual', () => {
  it('v2 는 offline_estimated 로만 표기되고 우열 단정은 허용되지 않는다', () => {
    const agg = buildAggregate('algorithm', 'v1', [], 200);
    const cmp = compareOutcomes(agg, agg);
    expect(cmp.v1.label).toBe('actual');
    expect(cmp.v2.label).toBe('offline_estimated');
    expect(cmp.winnerClaimAllowed).toBe(false);
    expect(cmp.limitations.some((l) => l.includes('A/B'))).toBe(true);
  });

  it('Sample 부족이면 comparable=false', () => {
    const insufficient = buildAggregate('track', 't', [], 1);
    expect(compareOutcomes(insufficient, insufficient).comparable).toBe(false);
  });

  it('Counterfactual — leakage/부족/부분 판정', () => {
    const base = { hasCandidateSnapshot: true, hasV1Result: true, hasOutcome: true, usesFutureReactions: false, usesCurrentAvailabilityAsPast: false, usesCurrentReputationAsPast: false };
    expect(evaluateCounterfactual(base).verdict).toBe('valid');
    expect(evaluateCounterfactual({ ...base, usesFutureReactions: true }).verdict).toBe('invalid');
    expect(evaluateCounterfactual({ ...base, hasCandidateSnapshot: false }).verdict).toBe('partial');
    expect(evaluateCounterfactual({ ...base, usesCurrentReputationAsPast: true }).leakage).toContain('current_reputation_as_past');
    expect(evaluateCounterfactual({ ...base, hasOutcome: false }).verdict).toBe('insufficient_data');
  });
});

describe('Weight Proposal / Backtest', () => {
  it('Δ≤5 · 합 100 유지 · Hard Policy 불변 · Sample 부족 차단', () => {
    const ok = generateWeightProposal({ desiredDeltas: { sequenceCompatibility: 2 }, sampleValidOutcomes: 50 });
    expect(ok.ok).toBe(true);
    expect(Math.round(Object.values(ok.proposedWeights ?? {}).reduce((s, v) => s + v, 0))).toBe(100);
    expect(generateWeightProposal({ desiredDeltas: { sequenceCompatibility: 6 }, sampleValidOutcomes: 50 }).reason).toContain('delta_cap');
    expect(generateWeightProposal({ desiredDeltas: { policyCompliance: 1 }, sampleValidOutcomes: 50 }).reason).toContain('hard_policy');
    expect(generateWeightProposal({ desiredDeltas: { sequenceCompatibility: 2 }, sampleValidOutcomes: 10 }).reason).toContain('insufficient_sample');
    expect(HARD_POLICY_WEIGHT_KEYS).toContain('policyCompliance');
    expect(WEIGHT_DELTA_CAP).toBe(5);
  });

  function mkCand(i: number, over: Partial<BacktestCandidate> = {}): BacktestCandidate {
    return {
      trackId: `t-${i}`, artistKey: `a-${i % 10}`, genre: 'jazz',
      signals: { storeFit: 70 + (i % 20), trackQuality: 80, sequenceCompatibility: 60 + (i % 30), novelty: 50 },
      hardViolation: false, ...over,
    };
  }

  it('Backtest — 결정론 재점수화, Sample 부족 시 insufficient_data', () => {
    const cands = Array.from({ length: 60 }, (_, i) => mkCand(i));
    const cur = { ...REC_WEIGHTS } as Record<string, number>;
    const prop = { ...cur, sequenceCompatibility: cur.sequenceCompatibility + 2, novelty: cur.novelty - 2 };
    const r = backtestProposal(cands, cur, prop, 20);
    expect(['pass', 'fail']).toContain(r.verdict);
    expect(r.sampleCount).toBe(60);
    expect(r.limitations.some((l) => l.includes('Offline'))).toBe(true);
    const few = backtestProposal(cands.slice(0, 5), cur, prop, 5);
    expect(few.verdict).toBe('insufficient_data');
  });

  it('Backtest — Hard 위반 후보는 양쪽에서 제외되고 회귀를 감지한다', () => {
    const cands = [
      ...Array.from({ length: 40 }, (_, i) => mkCand(i)),
      mkCand(99, { hardViolation: true }),
    ];
    const cur = { ...REC_WEIGHTS } as Record<string, number>;
    const bad = { ...cur, storeFit: cur.storeFit - 5, fatigueControl: cur.fatigueControl + 5 };
    const r = backtestProposal(cands, cur, bad, 10);
    expect(r.hardGateViolations).toBe(0);
    expect(r.sampleCount).toBe(40);
    expect(scoreWithWeights({ storeFit: 100 }, { storeFit: 20 })).toBe(100);
  });
});

describe('Quality / Explainability / 금지', () => {
  it('승격 차단 조건과 insufficient_data 판정', () => {
    const bad = computeLearningQuality({
      attributionRate: 0.3, validSignalRate: 0.4, duplicateRate: 0.1, sampleSufficient: false,
      storeCoverage: 1, trackCoverage: 5, biasCriticalCount: 1, backtestVerdict: 'fail', leakageDetected: true,
    });
    expect(bad.grade).toBe('insufficient_data');
    expect(bad.promotionBlockers).toEqual(expect.arrayContaining([
      'attribution_rate_below_threshold', 'sample_insufficient', 'bias_risk_critical',
      'backtest_regression', 'dataset_leakage_detected', 'duplicate_rate_excessive',
    ]));
    const good = computeLearningQuality({
      attributionRate: 0.9, validSignalRate: 0.9, duplicateRate: 0.01, sampleSufficient: true,
      storeCoverage: 12, trackCoverage: 100, biasCriticalCount: 0, backtestVerdict: 'pass', leakageDetected: false,
    });
    expect(good.score).not.toBeNull();
    expect(['A', 'B']).toContain(good.grade);
    expect(good.promotionBlockers).toHaveLength(0);
  });

  it('설명은 결정론적이며 상관≠인과와 고정 경고를 포함한다', () => {
    const proposal = generateWeightProposal({ desiredDeltas: { sequenceCompatibility: 2 }, sampleValidOutcomes: 50 });
    const lines = buildLearningExplanation({
      windowLabel: '최근 28일', storeCount: 12, playCount: 1420, attributionRate: 0.81,
      v1AttributedPlays: 730, reactionCount: 18, proposal, backtest: null,
    });
    expect(lines[0]).toContain('1420회');
    expect(lines.some((l) => l.includes('Reaction 데이터는 18건뿐'))).toBe(true);
    expect(lines.some((l) => l.includes('인과를 단정하지'))).toBe(true);
    expect(lines[lines.length - 1]).toBe(FIXED_LEARNING_WARNING);
    expect(buildLearningExplanation({
      windowLabel: '최근 28일', storeCount: 12, playCount: 1420, attributionRate: 0.81,
      v1AttributedPlays: 730, reactionCount: 18, proposal, backtest: null,
    })).toEqual(lines);
  });

  it('Sample 임계 상수와 금지 Apply 액션 목록', () => {
    expect(SAMPLE_THRESHOLDS.algorithm.validOutcome).toBe(30);
    expect(BLOCKED_LEARNING_ACTIONS).toHaveLength(9);
    for (const a of BLOCKED_LEARNING_ACTIONS) expect(isBlockedLearningAction(a)).toBe(true);
    expect(isBlockedLearningAction('automatic_weight_update')).toBe(true);
    expect(isBlockedLearningAction('view_overview')).toBe(false);
  });
});
