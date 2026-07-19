import { describe, it, expect } from 'vitest';
import {
  classifyDatabaseIsolation, classifyEnvironment, evaluateReadinessGate, validateControlBaseline,
  computeLatencyStats, evaluateLatencyThreshold, evaluateEventDelivery, evaluatePromotionGate,
  deriveExecutionDecision, normalizeCheck, isBlockedExecutionAction, BLOCKED_EXECUTION_ACTIONS,
  REQUIRED_TABLES, REQUIRED_RUNTIME_RPCS,
  type EnvironmentInput, type PromotionGateInput, type CheckStatus,
} from './experimentExecutionReadiness';

const env = (over: Partial<EnvironmentInput> = {}): EnvironmentInput => ({
  previewConnectedToProduction: false, isolatedTestDb: true, isolatedPreviewDb: false,
  migrationStatus: 'fully_applied', missingTables: [], missingAdminRpcs: [], missingRuntimeRpcs: [],
  testStoreConfirmed: true, emergencyStopTestable: true, ...over,
});

describe('Environment classification', () => {
  it('preview→production → production_connected + blocked', () => {
    const e = env({ previewConnectedToProduction: true });
    expect(classifyDatabaseIsolation(e)).toBe('production_connected');
    expect(classifyEnvironment(e)).toBe('blocked');
  });
  it('isolated test db + 전부 present → ready', () => {
    expect(classifyEnvironment(env())).toBe('ready');
  });
  it('migration 미적용 → partially_ready', () => {
    expect(classifyEnvironment(env({ migrationStatus: 'not_applied' }))).toBe('partially_ready');
  });
  it('migration failed → blocked', () => {
    expect(classifyEnvironment(env({ migrationStatus: 'failed' }))).toBe('blocked');
  });
});

describe('Readiness Gate (Fail-Closed)', () => {
  it('production 연결 → not ready + preview_connected_to_production', () => {
    const r = evaluateReadinessGate(env({ previewConnectedToProduction: true }));
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain('preview_connected_to_production');
  });
  it('migration 미적용 → not ready', () => {
    const r = evaluateReadinessGate(env({ migrationStatus: 'not_applied' }));
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain('migration_not_applied');
  });
  it('runtime RPC 누락 → not ready', () => {
    const r = evaluateReadinessGate(env({ missingRuntimeRpcs: ['experiment_treatment_gate'] }));
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain('missing_runtime_rpcs');
  });
  it('전부 충족 → ready', () => {
    expect(evaluateReadinessGate(env()).ready).toBe(true);
  });
  it('필수 목록 상수 존재', () => {
    expect(REQUIRED_TABLES).toContain('ai_experiment_runtime_events');
    expect(REQUIRED_RUNTIME_RPCS).toContain('experiment_treatment_recommend');
  });
});

describe('Control Baseline', () => {
  const good = {
    storeLogin: true, playlistLoaded: true, queueCreated: true, trackCount: 20, audioStarted: true,
    timeToFirstAudioMs: 800, trackTransitioned: true, completeEvent: true, decoderError: false,
    queueEmptyOccurred: false, eventDelivered: true,
  };
  it('정상 → stable', () => expect(validateControlBaseline(good).stable).toBe(true));
  it('audio 미시작 → unstable', () => expect(validateControlBaseline({ ...good, audioStarted: false }).stable).toBe(false));
  it('decoder error → unstable', () => expect(validateControlBaseline({ ...good, decoderError: true }).issues).toContain('decoder_error'));
});

describe('Latency stats', () => {
  it('Sample 부족(<5) → insufficient_data, p95 null', () => {
    const s = computeLatencyStats([100, 200]);
    expect(s.status).toBe('insufficient_data');
    expect(s.p95).toBeNull();
  });
  it('충분 → p95 계산', () => {
    const s = computeLatencyStats([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(s.status).toBe('available');
    expect(s.p95).not.toBeNull();
    expect(s.max).toBe(100);
  });
  it('임계 평가 — insufficient_data 유지', () => {
    expect(evaluateLatencyThreshold(computeLatencyStats([1, 2]), 500)).toBe('insufficient_data');
  });
  it('임계 초과 → fail', () => {
    const s = computeLatencyStats([600, 700, 800, 900, 1000, 1100]);
    expect(evaluateLatencyThreshold(s, 500)).toBe('fail');
  });
});

describe('Event delivery', () => {
  it('Sample 부족 → insufficient_data', () => {
    expect(evaluateEventDelivery({ expected: 3, received: 3, duplicate: 0, invalid: 0 }).status).toBe('insufficient_data');
  });
  it('손실 허용 이내 → pass', () => {
    expect(evaluateEventDelivery({ expected: 20, received: 20, duplicate: 0, invalid: 0 }).status).toBe('pass');
  });
  it('손실 과다 → fail', () => {
    const r = evaluateEventDelivery({ expected: 20, received: 10, duplicate: 0, invalid: 0 });
    expect(r.status).toBe('fail');
    expect(r.missing).toBe(10);
  });
  it('invalid 존재 → fail', () => {
    expect(evaluateEventDelivery({ expected: 20, received: 20, duplicate: 0, invalid: 2 }).status).toBe('fail');
  });
});

describe('Promotion Gate', () => {
  const P: CheckStatus = 'pass';
  const good = (over: Partial<PromotionGateInput> = {}): PromotionGateInput => ({
    testDbIsolated: true, migrationOk: true, requiredRpcOk: true, rlsOk: true,
    treatmentGatePass: P, queueContractPass: P, actualPlaybackPass: P, currentTrackNotForceStopped: P,
    controlFallbackPass: P, emergencyStopPass: P, storeResumePass: P,
    exposureCreationPass: P, attributionPass: P, eventDeliveryWithinRange: true,
    variantDriftCount: 0, invalidAttributionCount: 0,
    queueEmptyCount: 0, playbackStartFailureCount: 0, decoderErrorCount: 0, duplicatePlaybackCount: 0,
    playerFreezeCount: 0, blockingGuardrailCount: 0, timeToFirstAudioSevereRegression: false,
    runbookComplete: true, stopProcedureComplete: true, controlRecoveryConfirmed: true,
    auditConfirmed: true, humanReviewApproved: true, generalStoreImpact: false, ...over,
  });
  it('전부 PASS → pass', () => expect(evaluatePromotionGate(good()).pass).toBe(true));
  it('환경 미격리 → environment fail', () => {
    const r = evaluatePromotionGate(good({ testDbIsolated: false }));
    expect(r.environment).toBe('fail');
    expect(r.pass).toBe(false);
  });
  it('playback not_run → runtime not_run, gate 미통과', () => {
    const r = evaluatePromotionGate(good({ actualPlaybackPass: 'not_run' }));
    expect(r.runtime).toBe('not_run');
    expect(r.pass).toBe(false);
  });
  it('variant drift → data fail', () => {
    expect(evaluatePromotionGate(good({ variantDriftCount: 1 })).data).toBe('fail');
  });
  it('일반 Store 영향 → operations fail', () => {
    expect(evaluatePromotionGate(good({ generalStoreImpact: true })).operations).toBe('fail');
  });
  it('blocking guardrail → stability fail', () => {
    expect(evaluatePromotionGate(good({ blockingGuardrailCount: 1 })).stability).toBe('fail');
  });
});

describe('Execution Decision', () => {
  const P: CheckStatus = 'pass';
  const gateAll = (over: Partial<PromotionGateInput> = {}) => evaluatePromotionGate({
    testDbIsolated: true, migrationOk: true, requiredRpcOk: true, rlsOk: true,
    treatmentGatePass: P, queueContractPass: P, actualPlaybackPass: P, currentTrackNotForceStopped: P,
    controlFallbackPass: P, emergencyStopPass: P, storeResumePass: P,
    exposureCreationPass: P, attributionPass: P, eventDeliveryWithinRange: true,
    variantDriftCount: 0, invalidAttributionCount: 0,
    queueEmptyCount: 0, playbackStartFailureCount: 0, decoderErrorCount: 0, duplicatePlaybackCount: 0,
    playerFreezeCount: 0, blockingGuardrailCount: 0, timeToFirstAudioSevereRegression: false,
    runbookComplete: true, stopProcedureComplete: true, controlRecoveryConfirmed: true,
    auditConfirmed: true, humanReviewApproved: true, generalStoreImpact: false, ...over,
  });
  const base = (over: Partial<Parameters<typeof deriveExecutionDecision>[0]> = {}) => deriveExecutionDecision({
    readiness: { ready: true, blockers: [] }, promotion: gateAll(),
    treatmentRuntimeRepeatedFailure: false, attributionReliable: true, fallbackRateExcessive: false,
    latencyExcessive: false, sampleSufficient: true, minDurationMet: true, multiSessionDeviceValidated: true,
    minorWarningsOnly: false, ...over,
  });
  it('환경 미준비 → NO_GO', () => {
    expect(base({ readiness: { ready: false, blockers: ['preview_connected_to_production'] } }).decision).toBe('NO_GO');
  });
  it('Gate 하드 실패 → NO_GO', () => {
    expect(base({ promotion: gateAll({ testDbIsolated: false }) }).decision).toBe('NO_GO');
  });
  it('Runtime 반복 실패 → RETURN_TO_SHADOW', () => {
    expect(base({ treatmentRuntimeRepeatedFailure: true }).decision).toBe('RETURN_TO_SHADOW');
  });
  it('Sample 부족 → CONTINUE_INTERNAL', () => {
    expect(base({ sampleSufficient: false }).decision).toBe('CONTINUE_INTERNAL');
  });
  it('멀티 디바이스 미검증 → EXTEND_INTERNAL', () => {
    expect(base({ multiSessionDeviceValidated: false }).decision).toBe('EXTEND_INTERNAL');
  });
  it('전부 충족 → CANARY_CANDIDATE(활성화 아님)', () => {
    const r = base();
    expect(r.decision).toBe('CANARY_CANDIDATE');
    expect(r.reasons.some((x) => x.includes('활성화가 아니'))).toBe(true);
  });
});

describe('Evidence & BLOCKED', () => {
  it('증거 없는 pass → not_run 강등', () => {
    const c = normalizeCheck({ checkKey: 'playback', category: 'playback', status: 'pass', evidenceType: 'none', evidenceSummary: '' });
    expect(c.status).toBe('not_run');
  });
  it('증거 있는 pass 유지', () => {
    const c = normalizeCheck({ checkKey: 'playback', category: 'playback', status: 'pass', evidenceType: 'playback_event_row', evidenceSummary: 'row 123' });
    expect(c.status).toBe('pass');
  });
  it('canary 활성화/production apply/global rollout 차단', () => {
    for (const a of ['activate_canary', 'apply_to_production', 'global_rollout', 'apply_weight', 'auto_rollback']) {
      expect(isBlockedExecutionAction(a)).toBe(true);
    }
    expect(isBlockedExecutionAction('automatic_x')).toBe(true);
    expect(isBlockedExecutionAction('record_execution_check')).toBe(false);
  });
  it('BLOCKED 목록에 canary/rollout 포함', () => {
    expect(BLOCKED_EXECUTION_ACTIONS).toContain('activate_canary');
    expect(BLOCKED_EXECUTION_ACTIONS).toContain('global_rollout');
  });
});
