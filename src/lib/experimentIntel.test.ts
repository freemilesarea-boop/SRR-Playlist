import { describe, expect, it } from 'vitest';
import {
  BLOCKED_EXPERIMENT_ACTIONS, EXPOSURE_LIFECYCLE, FIXED_EXPERIMENT_WARNING,
  METRIC_MIN_SAMPLE_PER_ARM, SRM_CHI_SQUARE_THRESHOLD, SRM_MIN_SAMPLE,
  analyzeRateMetric, assignmentBucket, checkSrm, computeExperimentQuality,
  deriveDecision, evaluateGuardrail, evaluateStoreEligibility, isBlockedExperimentAction,
  isLifecycleTransitionValid, isShadowStageAllowed, previewVariant, shouldFallbackToControl,
  type ExperimentQualityInput, type FallbackContext, type StoreEligibilityInput,
} from './experimentIntel';
import { buildExposureKey } from './experimentRuntime';

const ELIGIBLE: StoreEligibilityInput = {
  storeId: 's-1', active: true, recentPlaybackCount: 100, recentCriticalIncidents: 0,
  sessionStable: true, policyAllowsExperiment: true, inAllowlist: true,
  explicitlyExcluded: false, emergencyExcluded: false, inConflictingExperiment: false,
};

describe('Deterministic Assignment(preview)', () => {
  it('동일 입력 → 동일 bucket/variant(sticky 전제), 다른 seed → 분포 변화 가능', () => {
    const a = assignmentBucket('exp-1', 'store-1', 1, 'assign-v1');
    expect(assignmentBucket('exp-1', 'store-1', 1, 'assign-v1')).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(10000);
    const variants = new Set(Array.from({ length: 50 }, (_, i) => previewVariant('exp-1', `store-${i}`, 1, 'assign-v1', 0.5, 'internal_test')));
    expect(variants.has('control')).toBe(true);
    expect(variants.has('treatment')).toBe(true);
  });

  it('Stage 게이트 — Stage 0 은 Treatment 없음, Shadow Stage 는 shadow_treatment', () => {
    const treated = Array.from({ length: 200 }, (_, i) => `store-${i}`)
      .find((s) => previewVariant('exp-1', s, 1, 'assign-v1', 0.5, 'internal_test') === 'treatment') as string;
    expect(previewVariant('exp-1', treated, 1, 'assign-v1', 0.5, 'event_emission_only')).toBe('control');
    expect(previewVariant('exp-1', treated, 1, 'assign-v1', 0.5, 'shadow_assignment')).toBe('shadow_treatment');
  });
});

describe('Eligibility / Allowlist', () => {
  it('모든 조건 충족 시에만 eligible — 자동 완화 없음', () => {
    expect(evaluateStoreEligibility(ELIGIBLE).eligible).toBe(true);
    const cases: Array<[Partial<StoreEligibilityInput>, string]> = [
      [{ inAllowlist: false }, 'not_in_allowlist'],
      [{ active: false }, 'store_inactive'],
      [{ recentPlaybackCount: 3 }, 'insufficient_recent_playback'],
      [{ recentCriticalIncidents: 2 }, 'recent_player_incident'],
      [{ policyAllowsExperiment: null }, 'policy_unverified'],
      [{ explicitlyExcluded: true }, 'explicitly_excluded'],
      [{ inConflictingExperiment: true }, 'conflicting_experiment'],
    ];
    for (const [over, reason] of cases) {
      const r = evaluateStoreEligibility({ ...ELIGIBLE, ...over });
      expect(r.eligible).toBe(false);
      expect(r.reasons).toContain(reason);
    }
  });
});

describe('Treatment Fallback — 항상 Control', () => {
  const OK: FallbackContext = {
    experimentRunning: true, storeAllowlisted: true, hasTreatmentAssignment: true,
    stageAtLeastInternalTest: true, emergencyStop: false, guardrailBreach: false,
    configValid: true, candidatePoolValid: true, hardGatePassed: true,
    recommendationAvailable: true, timedOut: false, lookupFailed: false,
  };
  it('정상 조건에서만 Treatment, 각 실패 조건은 사유와 함께 Control Fallback', () => {
    expect(shouldFallbackToControl(OK).fallback).toBe(false);
    const cases: Array<[Partial<FallbackContext>, string]> = [
      [{ lookupFailed: true }, 'assignment_lookup_failed'],
      [{ experimentRunning: false }, 'experiment_not_running'],
      [{ storeAllowlisted: false }, 'not_allowlisted'],
      [{ stageAtLeastInternalTest: false }, 'stage_below_internal_test'],
      [{ emergencyStop: true }, 'emergency_stop'],
      [{ guardrailBreach: true }, 'guardrail_breach'],
      [{ candidatePoolValid: false }, 'candidate_pool_invalid'],
      [{ hardGatePassed: false }, 'hard_gate_failed'],
      [{ recommendationAvailable: false }, 'no_recommendation_result'],
      [{ timedOut: true }, 'treatment_timeout'],
    ];
    for (const [over, reason] of cases) {
      const r = shouldFallbackToControl({ ...OK, ...over });
      expect(r.fallback).toBe(true);
      expect(r.reason).toBe(reason);
    }
  });
});

describe('SRM', () => {
  it('예상 비율과 크게 어긋나면 감지, 표본 부족은 insufficient_data', () => {
    expect(SRM_MIN_SAMPLE).toBe(100);
    const ok = checkSrm(500, 500, 0.5);
    expect(ok.status).toBe('ok');
    expect(ok.srmDetected).toBe(false);
    const bad = checkSrm(700, 300, 0.5);
    expect(bad.srmDetected).toBe(true);
    expect(bad.chiSquare as number).toBeGreaterThan(SRM_CHI_SQUARE_THRESHOLD);
    const few = checkSrm(10, 5, 0.5);
    expect(few.status).toBe('insufficient_data');
    expect(few.srmDetected).toBe(false);
  });
});

describe('Metric 분석 — 유의성 없이 승자 없음', () => {
  it('표본 부족이면 insufficient_data, CI 가 0 을 포함하면 significant=false', () => {
    const small = analyzeRateMetric('completion', { successes: 5, total: 10 }, { successes: 6, total: 10 });
    expect(small.status).toBe('insufficient_data');
    expect(METRIC_MIN_SAMPLE_PER_ARM).toBe(30);
    const same = analyzeRateMetric('completion', { successes: 50, total: 100 }, { successes: 52, total: 100 });
    expect(same.significant).toBe(false);
    const big = analyzeRateMetric('completion', { successes: 40, total: 100 }, { successes: 70, total: 100 });
    expect(big.significant).toBe(true);
    expect(big.absoluteDelta as number).toBeGreaterThan(0);
    expect(big.confidenceInterval.lower as number).toBeGreaterThan(0);
  });
});

describe('Guardrail — 성과보다 우선', () => {
  it('blocking breach / warning / 측정값 부족을 구분한다', () => {
    expect(evaluateGuardrail({ name: 'playback_failure', kind: 'blocking', controlValue: 0.01, treatmentValue: 0.2, absoluteMax: 0.05, maxDegradation: null, higherIsWorse: true }).status).toBe('breach');
    expect(evaluateGuardrail({ name: 'skip_rate', kind: 'warning', controlValue: 0.2, treatmentValue: 0.28, absoluteMax: null, maxDegradation: 0.05, higherIsWorse: true }).status).toBe('warning');
    expect(evaluateGuardrail({ name: 'store_fit', kind: 'warning', controlValue: 80, treatmentValue: 79, absoluteMax: null, maxDegradation: 5, higherIsWorse: false }).status).toBe('pass');
    expect(evaluateGuardrail({ name: 'ttfa', kind: 'blocking', controlValue: null, treatmentValue: null, absoluteMax: 3, maxDegradation: null, higherIsWorse: true }).status).toBe('insufficient_data');
  });
});

describe('Quality / Decision', () => {
  const GOOD_QUALITY: ExperimentQualityInput = {
    assignmentIntegrity: true, attributionRate: 0.9, eventLossRate: 0.02,
    srm: checkSrm(500, 500, 0.5), sampleSufficient: true, durationHoursMet: true,
    guardrails: [], fallbackRate: 0.02, configChangedMidRun: false, versionMixed: false, leakageDetected: false,
  };

  it('설정 변경/버전 혼합/무결성 실패는 invalid', () => {
    expect(computeExperimentQuality({ ...GOOD_QUALITY, configChangedMidRun: true }).grade).toBe('invalid');
    expect(computeExperimentQuality({ ...GOOD_QUALITY, versionMixed: true }).grade).toBe('invalid');
    const good = computeExperimentQuality(GOOD_QUALITY);
    expect(['A', 'B']).toContain(good.grade);
    expect(good.approvalBlockers).toHaveLength(0);
  });

  it('SRM/Breach 는 승인 차단 + Decision 은 pause/stop', () => {
    const srmBad = computeExperimentQuality({ ...GOOD_QUALITY, srm: checkSrm(700, 300, 0.5) });
    expect(srmBad.approvalBlockers).toContain('srm_detected');
    const primary = analyzeRateMetric('completion', { successes: 40, total: 100 }, { successes: 70, total: 100 });
    const d1 = deriveDecision({ quality: GOOD_QUALITY as never as ReturnType<typeof computeExperimentQuality>, primary, srm: checkSrm(700, 300, 0.5), guardrails: [], minDurationMet: true });
    expect(d1.decision).toBe('pause');
    const breach = [{ name: 'playback_failure', kind: 'blocking' as const, status: 'breach' as const, detail: '' }];
    const d2 = deriveDecision({ quality: computeExperimentQuality(GOOD_QUALITY), primary, srm: checkSrm(500, 500, 0.5), guardrails: breach, minDurationMet: true });
    expect(['pause', 'stop']).toContain(d2.decision);
  });

  it('유의미 개선 + 게이트 전부 통과 시에만 promote_candidate(Global Rollout 아님 명시)', () => {
    const primary = analyzeRateMetric('completion', { successes: 40, total: 100 }, { successes: 70, total: 100 });
    const d = deriveDecision({ quality: computeExperimentQuality(GOOD_QUALITY), primary, srm: checkSrm(500, 500, 0.5), guardrails: [], minDurationMet: true });
    expect(d.decision).toBe('promote_candidate');
    expect(d.reasons.some((r) => r.includes('Global Rollout 이 아니다'))).toBe(true);
    const weak = analyzeRateMetric('completion', { successes: 50, total: 100 }, { successes: 52, total: 100 });
    expect(deriveDecision({ quality: computeExperimentQuality(GOOD_QUALITY), primary: weak, srm: checkSrm(500, 500, 0.5), guardrails: [], minDurationMet: true }).decision).toBe('continue');
    const short = deriveDecision({ quality: computeExperimentQuality(GOOD_QUALITY), primary, srm: checkSrm(500, 500, 0.5), guardrails: [], minDurationMet: false });
    expect(short.decision).toBe('extend');
  });
});

describe('Exposure Lifecycle / Runtime Key / 금지', () => {
  it('Lifecycle 은 전진만 허용, Shadow 는 노출 단계까지만', () => {
    expect(EXPOSURE_LIFECYCLE).toHaveLength(6);
    expect(isLifecycleTransitionValid('recommendation_exposed', 'track_queued')).toBe(true);
    expect(isLifecycleTransitionValid('playback_started', 'recommendation_exposed')).toBe(false);
    expect(isShadowStageAllowed('recommendation_exposed')).toBe(true);
    expect(isShadowStageAllowed('playback_started')).toBe(false);
  });

  it('Exposure Idempotency Key 는 결정론적이며 위치/트랙별로 구분된다', () => {
    const input = { storeId: 's1', playlistId: 'p1', sessionId: 'sess', trackIds: [], source: 'scheduler' as const, dayKey: '2026-07-19-am' };
    expect(buildExposureKey(input, 't1', 0)).toBe(buildExposureKey(input, 't1', 0));
    expect(buildExposureKey(input, 't1', 0)).not.toBe(buildExposureKey(input, 't1', 1));
    expect(buildExposureKey(input, 't1', 0)).not.toBe(buildExposureKey(input, 't2', 0));
  });

  it('Global Rollout/Weight Apply/자동 확장 액션은 전부 차단 목록', () => {
    expect(BLOCKED_EXPERIMENT_ACTIONS).toHaveLength(8);
    for (const a of BLOCKED_EXPERIMENT_ACTIONS) expect(isBlockedExperimentAction(a)).toBe(true);
    expect(isBlockedExperimentAction('automatic_winner_apply')).toBe(true);
    expect(isBlockedExperimentAction('view_experiment')).toBe(false);
    expect(FIXED_EXPERIMENT_WARNING).toContain('전체 Production 적용을 의미하지 않습니다');
  });
});
