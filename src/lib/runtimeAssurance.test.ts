import { describe, expect, it } from 'vitest';
import {
  ASSURANCE_COMPONENTS,
  ASSURANCE_SIGNAL_TYPES,
  buildAssuranceRecommendation,
  buildAssuranceTimeline,
  buildRuntimeIncidentCandidate,
  detectDuplicateCandidate,
  detectStallCandidate,
  detectTimeoutCandidate,
  evaluateConnectorHealth,
  evaluateEscalationReadiness,
  evaluateEvidenceCompleteness,
  evaluateIncidentSeverity,
  evaluateRecoveryReadiness,
  evaluateReviewDelay,
  evaluateRuntimeAssurance,
  evaluateRuntimeProgress,
  evaluateRuntimeResolution,
  evaluateSignalFreshness,
  normalizeRuntimeSignals,
  RUNTIME_ASSURANCE_SUPPORT,
  RUNTIME_INCIDENT_TYPES,
} from './runtimeAssurance';

const NOW = new Date('2026-07-16T10:00:00Z');

describe('signal — Signal ≠ Fact·Missing Signal ≠ Failure', () => {
  it('freshness: null→unavailable·미래 시각→insufficient·stale 유지', () => {
    expect(evaluateSignalFreshness({ observedAt: null, now: NOW, maxAgeSeconds: 60 }).status).toBe('signal_unavailable');
    expect(evaluateSignalFreshness({ observedAt: new Date('2026-07-16T11:00:00Z'), now: NOW, maxAgeSeconds: 60 }).status).toBe('insufficient_data');
    expect(evaluateSignalFreshness({ observedAt: new Date('2026-07-16T09:59:30Z'), now: NOW, maxAgeSeconds: 60 }).status).toBe('available_reference');
    const stale = evaluateSignalFreshness({ observedAt: new Date('2026-07-16T09:00:00Z'), now: NOW, maxAgeSeconds: 60 });
    expect(stale.status).toBe('stale_signal_candidate');
    expect(stale.signalIsNotFact).toBe(true);
  });
  it('normalize: whitelist 밖 type/status 제외 + counts', () => {
    const r = normalizeRuntimeSignals([
      { type: 'runtime_checkpoint_reference', status: 'available_reference' },
      { type: 'evidence_gap_candidate', status: 'partial' },
      { type: 'quantum_signal', status: 'available_reference' },
      { type: 'runtime_started_reference', status: 'super_status' },
    ]);
    expect(r.rows).toHaveLength(2);
    expect(r.invalidSignals).toBe(2);
    expect(r.counts.available_reference).toBe(1);
    expect(r.missingSignalIsNotFailure).toBe(true);
    expect(ASSURANCE_SIGNAL_TYPES).toHaveLength(19);
  });
});

describe('connector health — Health ≠ Action Success', () => {
  const base = { instanceExists: true, connectionStatus: 'available_reference', permissionStatus: 'permission_verified_reference', scopeStatus: 'scope_verified_reference', credentialReferenced: true, lastVerifiedAt: new Date('2026-07-16T09:00:00Z'), now: NOW, staleAfterSeconds: 86400, recentFailures: 0, rateLimited: false };
  it('unavailable/rate_limited/failure/credential/permission/scope/stale 단계별 판정', () => {
    expect(evaluateConnectorHealth({ ...base, instanceExists: false }).result).toBe('connector_unavailable');
    expect(evaluateConnectorHealth({ ...base, connectionStatus: null }).result).toBe('insufficient_data');
    expect(evaluateConnectorHealth({ ...base, rateLimited: true }).result).toBe('connector_rate_limited');
    expect(evaluateConnectorHealth({ ...base, recentFailures: 2 }).result).toBe('connector_failure_candidate');
    expect(evaluateConnectorHealth({ ...base, credentialReferenced: null }).result).toBe('connector_credential_unverified');
    expect(evaluateConnectorHealth({ ...base, permissionStatus: 'connector_permission_unverified' }).result).toBe('connector_permission_unverified');
    expect(evaluateConnectorHealth({ ...base, scopeStatus: 'connector_scope_unverified' }).result).toBe('connector_scope_unverified');
    expect(evaluateConnectorHealth({ ...base, lastVerifiedAt: null }).result).toBe('connector_status_stale');
    expect(evaluateConnectorHealth({ ...base, lastVerifiedAt: new Date('2026-07-01T00:00:00Z') }).result).toBe('connector_status_stale');
    expect(evaluateConnectorHealth({ ...base, connectionStatus: 'partially_available' }).result).toBe('connector_healthy_with_limitation');
    const h = evaluateConnectorHealth(base);
    expect(h.result).toBe('connector_healthy_reference');
    expect(h.healthIsNotActionSuccess).toBe(true);
    expect(h.healthIsNotBusinessOutcome).toBe(true);
  });
});

describe('runtime progress — Checkpoint ≠ Verified Completion', () => {
  it('not_started/ready/active/checkpointed/waiting 단계별 판정', () => {
    expect(evaluateRuntimeProgress({ sessionStatus: null, checkpointCount: null, hasActionAttempt: false, hasConnectorResponse: false, hasResultReview: false }).result).toBe('insufficient_data');
    expect(evaluateRuntimeProgress({ sessionStatus: 'draft', checkpointCount: 0, hasActionAttempt: false, hasConnectorResponse: false, hasResultReview: false }).result).toBe('progress_not_started');
    expect(evaluateRuntimeProgress({ sessionStatus: 'ready_reference', checkpointCount: 0, hasActionAttempt: false, hasConnectorResponse: false, hasResultReview: false }).result).toBe('progress_ready_reference');
    expect(evaluateRuntimeProgress({ sessionStatus: 'started_reference', checkpointCount: 0, hasActionAttempt: false, hasConnectorResponse: false, hasResultReview: false }).result).toBe('progress_active_reference');
    expect(evaluateRuntimeProgress({ sessionStatus: 'started_reference', checkpointCount: 2, hasActionAttempt: false, hasConnectorResponse: false, hasResultReview: false }).result).toBe('progress_checkpointed_reference');
    expect(evaluateRuntimeProgress({ sessionStatus: 'action_reported_reference', checkpointCount: 1, hasActionAttempt: true, hasConnectorResponse: false, hasResultReview: false }).result).toBe('progress_waiting_response');
    expect(evaluateRuntimeProgress({ sessionStatus: 'result_verification_pending', checkpointCount: 1, hasActionAttempt: true, hasConnectorResponse: true, hasResultReview: false }).result).toBe('progress_waiting_verification');
    expect(evaluateRuntimeProgress({ sessionStatus: 'observation_pending', checkpointCount: 1, hasActionAttempt: true, hasConnectorResponse: true, hasResultReview: true }).result).toBe('progress_waiting_observation');
    const r = evaluateRuntimeProgress({ sessionStatus: 'paused_reference', checkpointCount: 1, hasActionAttempt: true, hasConnectorResponse: false, hasResultReview: false });
    expect(r.result).toBe('progress_unverified');
    expect(r.checkpointIsNotVerifiedCompletion).toBe(true);
  });
});

describe('stall — Candidate ≠ Confirmed Stall', () => {
  it('미시작/paused/cancel/활동 없음/stale/expected 없음 구분', () => {
    expect(detectStallCandidate({ started: false, lastActivityAt: null, now: NOW, expectedDurationSeconds: 60, paused: false, cancellationRequested: false }).result).toBe('no_stall_reference');
    expect(detectStallCandidate({ started: true, lastActivityAt: null, now: NOW, expectedDurationSeconds: 60, paused: true, cancellationRequested: false }).result).toBe('pause_state_unverified');
    expect(detectStallCandidate({ started: true, lastActivityAt: null, now: NOW, expectedDurationSeconds: 60, paused: false, cancellationRequested: true }).result).toBe('cancellation_state_unverified');
    const noSignal = detectStallCandidate({ started: true, lastActivityAt: null, now: NOW, expectedDurationSeconds: 60, paused: false, cancellationRequested: false });
    expect(noSignal.result).toBe('stall_candidate');
    expect(noSignal.notes).toContain('external_action_may_continue');
    expect(detectStallCandidate({ started: true, lastActivityAt: new Date('2026-07-16T09:59:00Z'), now: NOW, expectedDurationSeconds: null, paused: false, cancellationRequested: false }).result).toBe('insufficient_data');
    expect(detectStallCandidate({ started: true, lastActivityAt: new Date('2026-07-16T09:58:30Z'), now: NOW, expectedDurationSeconds: 60, paused: false, cancellationRequested: false }).result).toBe('checkpoint_stale_candidate');
    const stall = detectStallCandidate({ started: true, lastActivityAt: new Date('2026-07-16T09:00:00Z'), now: NOW, expectedDurationSeconds: 60, paused: false, cancellationRequested: false });
    expect(stall.result).toBe('stall_candidate');
    expect(stall.candidateIsNotConfirmedStall).toBe(true);
  });
});

describe('timeout — Timeout ≠ Failure', () => {
  it('policy 없음 임의 판정 없음 + approaching/candidate/reference', () => {
    expect(detectTimeoutCandidate({ timeoutPolicySeconds: null, startedAt: new Date('2026-07-16T09:00:00Z'), now: NOW, timeoutReferenceRecorded: false }).result).toBe('insufficient_data');
    expect(detectTimeoutCandidate({ timeoutPolicySeconds: 60, startedAt: null, now: NOW, timeoutReferenceRecorded: false }).result).toBe('timeout_not_detected');
    expect(detectTimeoutCandidate({ timeoutPolicySeconds: 60, startedAt: new Date('2026-07-16T09:59:10Z'), now: NOW, timeoutReferenceRecorded: false }).result).toBe('timeout_approaching_candidate');
    const cand = detectTimeoutCandidate({ timeoutPolicySeconds: 60, startedAt: new Date('2026-07-16T09:58:00Z'), now: NOW, timeoutReferenceRecorded: false });
    expect(cand.result).toBe('timeout_candidate');
    expect(cand.notes).toContain('external_action_may_continue');
    expect(cand.notes).toContain('result_recheck_required');
    const rec = detectTimeoutCandidate({ timeoutPolicySeconds: 60, startedAt: new Date('2026-07-16T09:58:00Z'), now: NOW, timeoutReferenceRecorded: true });
    expect(rec.result).toBe('timeout_reference_recorded');
    expect(rec.notes).toContain('cleanup_review_required');
    expect(rec.timeoutIsNotFailure).toBe(true);
  });
});

describe('duplicate — Candidate ≠ Confirmed·자동 제거 없음', () => {
  it('세션/요청/외부참조 중복 + Write side effect + idempotency 미검증', () => {
    expect(detectDuplicateCandidate({ sameInputHashSessions: null, sameIdempotencyKeyCount: null, sameExternalReferenceCount: null, idempotencyKeyPresent: true, isWriteAction: false }).verdict).toBe('insufficient_data');
    expect(detectDuplicateCandidate({ sameInputHashSessions: 1, sameIdempotencyKeyCount: 1, sameExternalReferenceCount: 1, idempotencyKeyPresent: true, isWriteAction: true }).verdict).toBe('duplicate_not_detected');
    const dup = detectDuplicateCandidate({ sameInputHashSessions: 2, sameIdempotencyKeyCount: 2, sameExternalReferenceCount: 2, idempotencyKeyPresent: true, isWriteAction: true });
    expect(dup.verdict).toBe('duplicate_candidate_detected');
    expect(dup.results).toContain('duplicate_session_candidate');
    expect(dup.results).toContain('duplicate_request_candidate');
    expect(dup.results).toContain('duplicate_external_reference_candidate');
    expect(dup.results).toContain('duplicate_side_effect_risk');
    expect(detectDuplicateCandidate({ sameInputHashSessions: 2, sameIdempotencyKeyCount: 1, sameExternalReferenceCount: 1, idempotencyKeyPresent: false, isWriteAction: true }).verdict).toBe('idempotency_unverified');
    expect(dup.candidateIsNotConfirmedDuplicate).toBe(true);
    expect(dup.autoDeduplication).toBe(false);
    expect(dup.autoCancellation).toBe(false);
  });
});

describe('evidence — Evidence Gap ≠ Execution Failure', () => {
  it('미도달 단계 unknown 유지 + partial/gap 구분', () => {
    const complete = evaluateEvidenceCompleteness({ approval: true, gate: true, start: true, action: true, response: true, verification: true, cleanup: null, observation: null, closure: null });
    expect(complete.result).toBe('evidence_complete_reference');
    expect(complete.notApplicable).toBe(3);
    const partial = evaluateEvidenceCompleteness({ approval: true, gate: true, start: true, action: false, response: null, verification: null, cleanup: null, observation: null, closure: null });
    expect(partial.result).toBe('evidence_partial');
    expect(partial.missing).toEqual(['action_evidence_missing']);
    const gap = evaluateEvidenceCompleteness({ approval: false, gate: false, start: false, action: false, response: null, verification: null, cleanup: null, observation: null, closure: null });
    expect(gap.result).toBe('evidence_gap');
    expect(gap.missing).toContain('approval_evidence_missing');
    expect(gap.missing).toContain('gate_evidence_missing');
    expect(gap.evidenceGapIsNotFailure).toBe(true);
  });
});

describe('review delay — SLA 없으면 임의 판정 없음', () => {
  it('reviewer_missing/insufficient/on_time/delayed 구분', () => {
    expect(evaluateReviewDelay({ kind: 'result', slaSeconds: 3600, waitingSeconds: 100, reviewerAssigned: false }).result).toBe('reviewer_missing');
    const noSla = evaluateReviewDelay({ kind: 'result', slaSeconds: null, waitingSeconds: 999999, reviewerAssigned: true });
    expect(noSla.result).toBe('insufficient_data');
    expect(noSla.slaDefined).toBe(false);
    expect(evaluateReviewDelay({ kind: 'result', slaSeconds: 3600, waitingSeconds: 100, reviewerAssigned: true }).result).toBe('review_on_time_reference');
    expect(evaluateReviewDelay({ kind: 'result', slaSeconds: 3600, waitingSeconds: 7200, reviewerAssigned: true }).result).toBe('result_review_delayed');
    expect(evaluateReviewDelay({ kind: 'closure', slaSeconds: 3600, waitingSeconds: 7200, reviewerAssigned: true }).result).toBe('closure_review_delayed');
  });
});

describe('assurance state — Snapshot·원본 대체 없음', () => {
  it('incident/escalation/stall/timeout/duplicate/gap/unknown 우선순위', () => {
    const base = { connectorHealthy: true, progressResult: 'progress_active_reference', stallResult: 'no_stall_reference', timeoutResult: 'timeout_not_detected', duplicateVerdict: 'duplicate_not_detected', evidenceResult: 'evidence_complete_reference', openIncidentCandidates: 0, escalationsPending: 0 };
    expect(evaluateRuntimeAssurance(base).status).toBe('monitoring_reference');
    expect(evaluateRuntimeAssurance({ ...base, openIncidentCandidates: 1 }).status).toBe('incident_candidate');
    expect(evaluateRuntimeAssurance({ ...base, escalationsPending: 2 }).status).toBe('escalation_pending');
    expect(evaluateRuntimeAssurance({ ...base, stallResult: 'stall_candidate' }).status).toBe('stalled_candidate');
    expect(evaluateRuntimeAssurance({ ...base, timeoutResult: 'timeout_candidate' }).status).toBe('timeout_candidate');
    expect(evaluateRuntimeAssurance({ ...base, duplicateVerdict: 'duplicate_candidate_detected' }).status).toBe('duplicate_candidate');
    expect(evaluateRuntimeAssurance({ ...base, evidenceResult: 'evidence_gap' }).status).toBe('evidence_gap');
    expect(evaluateRuntimeAssurance({ ...base, connectorHealthy: null }).status).toBe('unknown');
    expect(evaluateRuntimeAssurance({ ...base, connectorHealthy: false }).status).toBe('degraded_candidate');
    expect(evaluateRuntimeAssurance({ ...base, evidenceResult: 'evidence_partial' }).status).toBe('healthy_with_limitation');
    expect(evaluateRuntimeAssurance(base).stateIsSnapshotNotSource).toBe(true);
  });
});

describe('severity — 결측 재정규화 없음·Critical ≠ 자동 조치', () => {
  it('전부 결측 insufficient·일부 결측 unverified·계층 판정', () => {
    expect(evaluateIncidentSeverity({ productionProximity: null, externalSideEffect: null, financialImpact: null, dataSensitivity: null, irreversible: null, duplicateSideEffectRisk: null }).severity).toBe('insufficient_data');
    const partial = evaluateIncidentSeverity({ productionProximity: false, externalSideEffect: null, financialImpact: false, dataSensitivity: false, irreversible: false, duplicateSideEffectRisk: false });
    expect(partial.severity).toBe('severity_unverified');
    expect(partial.unknownComponents).toEqual(['externalSideEffect']);
    expect(evaluateIncidentSeverity({ productionProximity: true, externalSideEffect: false, financialImpact: false, dataSensitivity: false, irreversible: false, duplicateSideEffectRisk: false }).severity).toBe('critical');
    expect(evaluateIncidentSeverity({ productionProximity: false, externalSideEffect: false, financialImpact: true, dataSensitivity: false, irreversible: false, duplicateSideEffectRisk: false }).severity).toBe('high');
    expect(evaluateIncidentSeverity({ productionProximity: false, externalSideEffect: true, financialImpact: false, dataSensitivity: false, irreversible: false, duplicateSideEffectRisk: false }).severity).toBe('moderate');
    const low = evaluateIncidentSeverity({ productionProximity: false, externalSideEffect: false, financialImpact: false, dataSensitivity: false, irreversible: false, duplicateSideEffectRisk: false });
    expect(low.severity).toBe('low');
    expect(low.criticalIsNotAutomaticAction).toBe(true);
  });
});

describe('incident candidate / escalation — Candidate ≠ Confirmed·자동 발송 없음', () => {
  it('candidate: whitelist+Evidence 필수 + ai_incidents 자동 등록 없음', () => {
    expect('rejected' in buildRuntimeIncidentCandidate({ type: 'meteor_strike', severity: 'low', evidence: ['e'], reason: 'x' })).toBe(true);
    expect('rejected' in buildRuntimeIncidentCandidate({ type: 'runtime_stall_candidate', severity: 'low', evidence: [], reason: 'x' })).toBe(true);
    const r = buildRuntimeIncidentCandidate({ type: 'timeout_candidate', severity: 'moderate', evidence: ['elapsed 실측'], reason: 'timeout policy 초과' });
    if ('candidateIsNotConfirmedIncident' in r) {
      expect(r.candidateIsNotConfirmedIncident).toBe(true);
      expect(r.autoRegisteredToIncidents).toBe(false);
      expect(r.autoActionTaken).toBe(false);
    }
    expect(RUNTIME_INCIDENT_TYPES).toHaveLength(15);
  });
  it('escalation: severity 기반 권고 + 자동 메시지 없음', () => {
    const base = { severity: 'low', acknowledged: false, investigationStarted: false, specialistRequired: false, executiveRequired: false, resolved: false };
    expect(evaluateEscalationReadiness(base).status).toBe('escalation_not_required');
    expect(evaluateEscalationReadiness({ ...base, severity: 'critical' }).status).toBe('escalation_recommended');
    expect(evaluateEscalationReadiness({ ...base, severity: 'severity_unverified' }).status).toBe('escalation_pending');
    expect(evaluateEscalationReadiness({ ...base, acknowledged: true }).status).toBe('acknowledged_reference');
    expect(evaluateEscalationReadiness({ ...base, investigationStarted: true }).status).toBe('investigation_in_progress_reference');
    expect(evaluateEscalationReadiness({ ...base, specialistRequired: true }).status).toBe('specialist_review_required');
    expect(evaluateEscalationReadiness({ ...base, executiveRequired: true }).status).toBe('executive_review_required');
    const resolved = evaluateEscalationReadiness({ ...base, resolved: true });
    expect(resolved.status).toBe('resolved_reference');
    expect(resolved.recommendationIsNotEscalation).toBe(true);
    expect(resolved.autoMessageSent).toBe(false);
  });
});

describe('recovery / resolution — 자동 없음·Outcome 아님', () => {
  it('recovery: not_required/irreversible/manual/unverified/pending/ready', () => {
    const base = { recoveryRequired: true, pauseReviewNeeded: false, cancellationReviewNeeded: false, resultRecheckNeeded: false, cleanupReviewNeeded: false, rollbackReviewNeeded: false, connectorDisableReviewNeeded: false, irreversibleEffect: false, reviewerAssigned: true, observationPlanDefined: true };
    expect(evaluateRecoveryReadiness({ ...base, recoveryRequired: null }).result).toBe('insufficient_data');
    expect(evaluateRecoveryReadiness({ ...base, recoveryRequired: false }).result).toBe('recovery_not_required');
    expect(evaluateRecoveryReadiness({ ...base, irreversibleEffect: true }).result).toBe('irreversible_effect_candidate');
    expect(evaluateRecoveryReadiness({ ...base, reviewerAssigned: false }).result).toBe('manual_intervention_required');
    expect(evaluateRecoveryReadiness({ ...base, observationPlanDefined: false }).result).toBe('recovery_unverified');
    const multi = evaluateRecoveryReadiness({ ...base, pauseReviewNeeded: true, rollbackReviewNeeded: true });
    expect(multi.result).toBe('pause_review_required');
    expect(multi.pendingReviews).toEqual(['pause_review_required', 'rollback_review_required']);
    const ready = evaluateRecoveryReadiness(base);
    expect(ready.result).toBe('recovery_ready_reference');
    expect(ready.autoRecovery).toBe(false);
    expect(ready.recoveryPlanIsNotRecoverySuccess).toBe(true);
  });
  it('resolution: 선행 검토 강제 + limitation 구분 + Outcome 아님', () => {
    const base = { incidentReviewed: true, evidenceReviewed: true, sideEffectReviewed: true, recoveryReviewed: true, observationReviewed: true, followUpRequired: false, limitations: [] as string[] };
    expect(evaluateRuntimeResolution({ ...base, incidentReviewed: false }).result).toBe('resolution_pending');
    expect(evaluateRuntimeResolution({ ...base, sideEffectReviewed: false }).result).toBe('result_unverified');
    expect(evaluateRuntimeResolution({ ...base, recoveryReviewed: false }).result).toBe('recovery_review_required');
    expect(evaluateRuntimeResolution({ ...base, observationReviewed: false }).result).toBe('observation_extension_required');
    expect(evaluateRuntimeResolution({ ...base, followUpRequired: true }).result).toBe('monitoring_required');
    expect(evaluateRuntimeResolution({ ...base, limitations: ['부분 검증'] }).result).toBe('resolved_with_limitation');
    const r = evaluateRuntimeResolution(base);
    expect(r.result).toBe('resolved_reference');
    expect(r.resolutionIsNotOutcomeSuccess).toBe(true);
    expect(r.humanResolutionRequired).toBe(true);
  });
});

describe('recommendation / timeline / components / support', () => {
  it('recommendation: whitelist+Evidence 필수 + confidence clamp + 자동 조치 없음', () => {
    expect('rejected' in buildAssuranceRecommendation({ type: 'pause_runtime_now', reason: 'x', evidence: ['e'], confidence: null })).toBe(true);
    expect('rejected' in buildAssuranceRecommendation({ type: 'review_stall_candidate', reason: 'x', evidence: [], confidence: null })).toBe(true);
    const r = buildAssuranceRecommendation({ type: 'request_pause_review', reason: 'Stall 후보 — Pause 검토 필요(실행 아님)', evidence: ['stall 실측'], confidence: 500 });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.autoActionTaken).toBe(false);
      expect(r.confidence).toBe(100);
      expect(r.limitations).toContain('Candidate ≠ Confirmed Incident');
    }
  });
  it('timeline: 9단계 + 원본 없는 단계 insufficient_data', () => {
    const r = buildAssuranceTimeline([
      { stage: 'signal', count: 5, source: 'signals 실측' },
      { stage: 'incident_candidate', count: 1, source: 'candidates 실측' },
      { stage: 'warp', count: 9, source: 'x' },
    ]);
    expect(r.stages).toHaveLength(9);
    expect(r.stages.find((s) => s.stage === 'resolution')?.status).toBe('insufficient_data');
    expect(r.invalidStages).toBe(1);
    expect(r.timelineIsNotCompletionClaim).toBe(true);
  });
  it('components: sentry/timestamps 실존 + heartbeat/metrics/queue/alert 없음', () => {
    expect(ASSURANCE_COMPONENTS.find((c) => c.key === 'sentry_error_tracking')?.available).toBe(true);
    expect(ASSURANCE_COMPONENTS.find((c) => c.key === 'session_timestamps_0536')?.available).toBe(true);
    for (const key of ['connector_success_failure_columns', 'runtime_heartbeat', 'runtime_metrics', 'worker_queue_dlq', 'lease_cancellation_token', 'alert_integration']) {
      expect(ASSURANCE_COMPONENTS.find((c) => c.key === key)?.available).toBe(false);
    }
  });
  it('SUPPORT: 38항목 + automatic_* 8종 전부 unsupported', () => {
    expect(RUNTIME_ASSURANCE_SUPPORT).toHaveLength(38);
    for (const key of ['automatic_runtime_pause', 'automatic_runtime_cancellation', 'automatic_connector_disable', 'automatic_retry', 'automatic_cleanup', 'automatic_rollback', 'automatic_incident_resolution', 'automatic_production_execution']) {
      expect(RUNTIME_ASSURANCE_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
  });
});
