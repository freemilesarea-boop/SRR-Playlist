import { describe, it, expect } from 'vitest';
import {
  evaluateRuntimeGate, normalizeGateReason, adaptTreatmentQueue, validateAttribution,
  detectVariantDrift, computeInternalQuality, deriveInternalDecision, evaluateGoNoGo,
  isBlockedRuntimeAction, BLOCKED_RUNTIME_ACTIONS, INTERNAL_STORE_LIMIT,
  type QueueAdapterContext, type InternalQualityInput, type AttributionInput,
} from './experimentRuntimeRouting';

const adapterCtx = (over: Partial<QueueAdapterContext> = {}): QueueAdapterContext => ({
  experimentId: 'exp1', assignmentId: 'as1', algorithmVersion: 'rec-v2', weightVersion: 'w1',
  currentTrackId: null, recentTrackIds: [], targetCount: 2, ...over,
});

const rawTrack = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `T-${id}`, artist: 'A', genre: 'pop', mood: 'calm',
  audio_url: `https://x/${id}.mp3`, cover_url: null, duration: 200, created_at: '2026-01-01T00:00:00Z',
  ...over,
});

describe('Runtime Gate → route', () => {
  it('lookup 실패 → fallback_control', () => {
    expect(evaluateRuntimeGate({ lookupFailed: true, eligible: false, reason: null, variant: null }))
      .toEqual({ route: 'fallback_control', fallbackReason: 'assignment_lookup_failed' });
  });
  it('shadow_treatment variant → fallback_control(shadow)', () => {
    expect(evaluateRuntimeGate({ lookupFailed: false, eligible: false, reason: 'shadow_assignment', variant: 'shadow_treatment' }))
      .toEqual({ route: 'fallback_control', fallbackReason: 'shadow_assignment' });
  });
  it('control assignment → fallback_control', () => {
    expect(evaluateRuntimeGate({ lookupFailed: false, eligible: false, reason: 'control_assignment', variant: 'control' }).fallbackReason)
      .toBe('control_assignment');
  });
  it('wrong stage → fallback_control', () => {
    expect(evaluateRuntimeGate({ lookupFailed: false, eligible: false, reason: 'wrong_stage', variant: 'treatment' }).fallbackReason)
      .toBe('wrong_stage');
  });
  it('not allowlisted → fallback_control', () => {
    expect(evaluateRuntimeGate({ lookupFailed: false, eligible: false, reason: 'not_allowlisted', variant: 'treatment' }).fallbackReason)
      .toBe('not_allowlisted');
  });
  it('store stopped → fallback_control', () => {
    expect(evaluateRuntimeGate({ lookupFailed: false, eligible: false, reason: 'store_stopped', variant: 'treatment' }).fallbackReason)
      .toBe('store_stopped');
  });
  it('emergency stop → fallback_control', () => {
    expect(evaluateRuntimeGate({ lookupFailed: false, eligible: false, reason: 'emergency_stop', variant: 'treatment' }).fallbackReason)
      .toBe('emergency_stop');
  });
  it('eligible treatment → treatment route', () => {
    expect(evaluateRuntimeGate({ lookupFailed: false, eligible: true, reason: null, variant: 'treatment' }))
      .toEqual({ route: 'treatment', fallbackReason: null });
  });
  it('unknown reason → hard_gate_failed', () => {
    expect(normalizeGateReason('weird')).toBe('hard_gate_failed');
  });
});

describe('Queue Contract Adapter', () => {
  it('정상 2곡 → valid, experimentMeta 부착', () => {
    const r = adaptTreatmentQueue([rawTrack('a'), rawTrack('b')], adapterCtx());
    expect(r.valid).toBe(true);
    expect(r.tracks).toHaveLength(2);
    expect(r.tracks[0].experimentMeta?.recommendationRank).toBe(1);
    expect(r.tracks[0].experimentMeta?.variant).toBe('treatment');
  });
  it('audio_url 누락 → 해당 곡 drop', () => {
    const r = adaptTreatmentQueue([rawTrack('a', { audio_url: '' }), rawTrack('b'), rawTrack('c')], adapterCtx());
    expect(r.issues).toContain('missing_required_field');
    expect(r.droppedCount).toBe(1);
    expect(r.valid).toBe(true); // b,c 로 target(2) 충족
  });
  it('필수 field 누락으로 target 미달 → invalid(Control 사용)', () => {
    const r = adaptTreatmentQueue([rawTrack('a', { id: '' }), rawTrack('b')], adapterCtx());
    expect(r.valid).toBe(false);
    expect(r.issues).toContain('below_target_after_validation');
  });
  it('중복 track → drop', () => {
    const r = adaptTreatmentQueue([rawTrack('a'), rawTrack('a'), rawTrack('b')], adapterCtx());
    expect(r.issues).toContain('duplicate_track');
    expect(r.tracks).toHaveLength(2);
  });
  it('current track 중복 → drop', () => {
    const r = adaptTreatmentQueue([rawTrack('cur'), rawTrack('b'), rawTrack('c')], adapterCtx({ currentTrackId: 'cur' }));
    expect(r.issues).toContain('recent_track_duplicate');
    expect(r.tracks.find((t) => t.id === 'cur')).toBeUndefined();
  });
  it('전부 무효 → empty_after_validation invalid', () => {
    const r = adaptTreatmentQueue([rawTrack('a', { audio_url: '' })], adapterCtx());
    expect(r.valid).toBe(false);
    expect(r.issues).toContain('empty_after_validation');
  });
});

describe('Playback Attribution', () => {
  const base = (over: Partial<AttributionInput> = {}): AttributionInput => ({
    exposureStoreId: 's1', playbackStoreId: 's1', exposureTrackId: 't1', playbackTrackId: 't1',
    assignmentStoreId: 's1', variant: 'treatment', isShadow: false, experimentRunningAtEvent: true,
    exposureAt: 100, playbackStartedAt: 200, sessionMatch: true, algorithmVersionMatch: true,
    weightVersionMatch: true, exposureRecorded: true, ...over,
  });
  it('정합 → attributed', () => {
    expect(validateAttribution(base()).status).toBe('attributed');
  });
  it('store mismatch → invalid', () => {
    expect(validateAttribution(base({ playbackStoreId: 's2' })).status).toBe('invalid');
  });
  it('track mismatch → invalid', () => {
    expect(validateAttribution(base({ playbackTrackId: 't2' })).status).toBe('invalid');
  });
  it('shadow → invalid(treatment 아님)', () => {
    expect(validateAttribution(base({ isShadow: true })).status).toBe('invalid');
  });
  it('session mismatch → ambiguous', () => {
    expect(validateAttribution(base({ sessionMatch: false })).status).toBe('ambiguous');
  });
  it('시간 역순 → ambiguous', () => {
    expect(validateAttribution(base({ exposureAt: 300, playbackStartedAt: 100 })).status).toBe('ambiguous');
  });
  it('exposure 미기록/버전 불일치 → partially_attributed', () => {
    expect(validateAttribution(base({ exposureRecorded: false })).status).toBe('partially_attributed');
    expect(validateAttribution(base({ algorithmVersionMatch: false })).status).toBe('partially_attributed');
  });
});

describe('Variant Drift', () => {
  it('동일 → drift 없음', () => expect(detectVariantDrift('treatment', 'treatment')).toBe(false));
  it('상이 → drift', () => expect(detectVariantDrift('treatment', 'control')).toBe(true));
  it('null → drift 없음', () => expect(detectVariantDrift(null, 'control')).toBe(false));
});

describe('Internal Quality', () => {
  const good = (over: Partial<InternalQualityInput> = {}): InternalQualityInput => ({
    runtimeGateIntegrity: true, allowlistIntegrity: true, assignmentIntegrity: true,
    queueContractIntegrity: true, controlFallbackReliable: true, exposureCompleteness: 0.9,
    playbackAttributionRate: 0.9, sessionIntegrity: true, eventDeliveryRate: 0.95,
    sampleSufficient: true, guardrailCompliant: true, streamingStable: true, treatmentStable: true,
    generalStoreTreatment: false, variantDrift: false, hardPolicyViolation: false,
    algorithmVersionMixed: false, weightVersionMixed: false, ...over,
  });
  it('일반 Store Treatment → invalid', () => {
    expect(computeInternalQuality(good({ generalStoreTreatment: true })).grade).toBe('invalid');
  });
  it('variant drift → invalid', () => {
    expect(computeInternalQuality(good({ variantDrift: true })).grade).toBe('invalid');
  });
  it('version 혼합 → invalid', () => {
    expect(computeInternalQuality(good({ algorithmVersionMixed: true })).grade).toBe('invalid');
  });
  it('표본 부족 → insufficient_data', () => {
    expect(computeInternalQuality(good({ sampleSufficient: false })).grade).toBe('insufficient_data');
  });
  it('건강 → A/B grade', () => {
    const r = computeInternalQuality(good());
    expect(r.score).not.toBeNull();
    expect(['A', 'B']).toContain(r.grade);
  });
});

describe('Internal Decision', () => {
  const base = (over: Partial<Parameters<typeof deriveInternalDecision>[0]> = {}) => deriveInternalDecision({
    quality: { score: 90, grade: 'A', invalidReasons: [] },
    blockingGuardrail: false, srmDetected: false, sampleSufficient: true, minDurationMet: true,
    playbackStable: true, queueStable: true, fallbackRate: 0.05, primaryImproved: false, primaryRegressed: false,
    ...over,
  });
  it('blocking guardrail → pause', () => expect(base({ blockingGuardrail: true }).decision).toBe('pause'));
  it('SRM → pause', () => expect(base({ srmDetected: true }).decision).toBe('pause'));
  it('invalid quality → stop', () => expect(base({ quality: { score: null, grade: 'invalid', invalidReasons: ['x'] } }).decision).toBe('stop'));
  it('playback 불안정 → return_to_shadow', () => expect(base({ playbackStable: false }).decision).toBe('return_to_shadow'));
  it('fallback 과다 → return_to_shadow', () => expect(base({ fallbackRate: 0.8 }).decision).toBe('return_to_shadow'));
  it('표본 부족 + 기간 미달 → extend_internal', () => expect(base({ sampleSufficient: false, minDurationMet: false }).decision).toBe('extend_internal'));
  it('유의미 악화 → stop', () => expect(base({ primaryRegressed: true }).decision).toBe('stop'));
  it('유의미 개선 → canary_candidate(활성화 아님)', () => {
    const r = base({ primaryImproved: true });
    expect(r.decision).toBe('canary_candidate');
    expect(r.reasons.some((x) => x.includes('활성화가 아니다'))).toBe(true);
  });
  it('차이 없음 → continue_internal', () => expect(base().decision).toBe('continue_internal'));
});

describe('Go / No-Go', () => {
  const allGo = {
    internalStoreOnly: true, allowlistConfirmed: true, treatmentAssignmentConfirmed: true,
    emergencyStopTested: true, controlFallbackTested: true, queueContractTested: true,
    playerRegressionFree: true, candidatePoolAvailable: true, hardGatePass: true,
    exposureCreationConfirmed: true, attributionConfirmed: true, noBlockingGuardrail: true,
    sessionVariantIntegrity: true, migrationAndRpcApplied: true,
  };
  it('전부 충족 → go', () => expect(evaluateGoNoGo(allGo).go).toBe(true));
  it('일반 Store 포함 → no-go', () => {
    const r = evaluateGoNoGo({ ...allGo, internalStoreOnly: false });
    expect(r.go).toBe(false);
    expect(r.blockers).toContain('general_store_included');
  });
  it('migration 미적용 → no-go', () => {
    expect(evaluateGoNoGo({ ...allGo, migrationAndRpcApplied: false }).go).toBe(false);
  });
});

describe('BLOCKED actions & scope', () => {
  it('canary 활성화/global rollout/v1 교체/weight apply 전부 차단', () => {
    for (const a of ['enable_canary', 'global_rollout', 'replace_recommendation_v1', 'apply_production_weight', 'auto_winner_apply', 'auto_rollback_execute', 'disable_recommendation_v1']) {
      expect(isBlockedRuntimeAction(a)).toBe(true);
    }
    expect(isBlockedRuntimeAction('automatic_anything')).toBe(true);
    expect(isBlockedRuntimeAction('record_runtime_event')).toBe(false);
  });
  it('BLOCKED 목록에 canary/rollout 포함', () => {
    expect(BLOCKED_RUNTIME_ACTIONS).toContain('enable_canary');
    expect(BLOCKED_RUNTIME_ACTIONS).toContain('global_rollout');
  });
  it('Internal Store 상한 2', () => expect(INTERNAL_STORE_LIMIT).toBe(2));
});
