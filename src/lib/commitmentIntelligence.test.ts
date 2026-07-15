import { describe, expect, it } from 'vitest';
import {
  buildCommitmentOutcomeLink,
  buildCommitmentRecommendation,
  buildCommitmentTimeline,
  calculateBlockerImpact,
  calculateCommitmentAging,
  calculateCommitmentRisk,
  calculateDeliveryConfidence,
  calculateReportedProgress,
  calculateScheduleVariance,
  calculateVerifiedProgress,
  classifyDeliveryConfidence,
  classifyProgressStatus,
  COMMITMENT_SUPPORT,
  detectRepeatedCommitmentGap,
  detectScopeDrift,
  evaluateAccountability,
  evaluateCompletionVerification,
  evaluateDependencyReadiness,
  evaluateMilestoneEvidence,
  evaluateOutcomeReadiness,
  evaluateOwnershipVerification,
  evaluateSuccessCriteria,
  validateBlocker,
  validateCommitment,
  validateMilestone,
  validateOwnershipAcknowledgement,
} from './commitmentIntelligence';

const NOW = new Date('2026-07-15T00:00:00Z');

describe('validateCommitment — 선택 ≠ 실행·업무 지시 아님', () => {
  it('type/title/evidence 검증, owner 없음은 생성 오류 아님(owner_unverified 추적)', () => {
    expect(validateCommitment(null)).toEqual(['commitment 없음']);
    expect(validateCommitment({ type: 'invalid_type', title: '', evidence: [] })).toHaveLength(3);
    expect(validateCommitment({ type: 'priority_execution_reference', title: 'MRR 방어', evidence: ['e'] })).toEqual([]);
  });
});

describe('ownership — Reference ≠ 실제 배정·인사 평가 아님', () => {
  it('Owner 없음 → owner_unverified, 전부 확인 → verified_reference', () => {
    expect(evaluateOwnershipVerification({ owner: null, sponsor: 's', reviewer: 'r', backup: 'b', ownerAcknowledged: false, sponsorAcknowledged: false, reviewerAcknowledged: false }).verification).toBe('owner_unverified');
    const ok = evaluateOwnershipVerification({ owner: 'o', sponsor: 's', reviewer: 'r', backup: 'b', ownerAcknowledged: true, sponsorAcknowledged: true, reviewerAcknowledged: true });
    expect(ok.verification).toBe('verified_reference');
    expect(ok.notPersonnelEvaluation).toBe(true);
  });
  it('Owner=Reviewer → self_review_risk 경고 보존, 전 역할 동일인 → concentration', () => {
    expect(evaluateOwnershipVerification({ owner: 'a', sponsor: 's', reviewer: 'a', backup: 'b', ownerAcknowledged: true, sponsorAcknowledged: true, reviewerAcknowledged: true }).verification).toBe('self_review_risk');
    expect(evaluateOwnershipVerification({ owner: 'a', sponsor: 'a', reviewer: 'a', backup: 'a', ownerAcknowledged: true, sponsorAcknowledged: true, reviewerAcknowledged: true }).verification).toBe('single_person_concentration');
  });
  it('Backup 없음 → backup_missing, Owner Reference 존재해도 미수락 gap 기록', () => {
    const r = evaluateOwnershipVerification({ owner: 'o', sponsor: 's', reviewer: 'r', backup: null, ownerAcknowledged: false, sponsorAcknowledged: true, reviewerAcknowledged: true });
    expect(r.verification).toBe('backup_missing');
    expect(r.gaps.some((g) => g.includes('책임 수락'))).toBe(true);
  });
  it('Acknowledgement: Evidence 없이 수락 표시 금지', () => {
    expect(validateOwnershipAcknowledgement({ acknowledged: true, evidence: [] }).valid).toBe(false);
    expect(validateOwnershipAcknowledgement({ acknowledged: true, evidence: ['서명 기록'] }).valid).toBe(true);
    expect(validateOwnershipAcknowledgement({ acknowledged: false, evidence: null }).valid).toBe(true);
  });
});

describe('success criteria — 없으면 성공 판정 금지', () => {
  it('없음 → missing, 정성만 → qualitative_reference', () => {
    expect(evaluateSuccessCriteria(null).status).toBe('success_criteria_missing');
    expect(evaluateSuccessCriteria([]).status).toBe('success_criteria_missing');
    expect(evaluateSuccessCriteria([{ metric: null, baseline: null, target: null, verificationMethod: null, qualitative: true }]).status).toBe('qualitative_reference');
  });
  it('baseline 없음 → baseline_unavailable(개선률 계산 금지), 검증 방법 없음 → verification_method_missing', () => {
    expect(evaluateSuccessCriteria([{ metric: 'mrr', baseline: null, target: 100, verificationMethod: 'db', qualitative: false }]).status).toBe('baseline_unavailable');
    expect(evaluateSuccessCriteria([{ metric: 'mrr', baseline: 50, target: 100, verificationMethod: null, qualitative: false }]).status).toBe('verification_method_missing');
    expect(evaluateSuccessCriteria([{ metric: 'mrr', baseline: 50, target: 100, verificationMethod: 'db', qualitative: false }]).status).toBe('defined_reference');
  });
});

describe('milestone — 자동 Task 아님·Evidence 게이트', () => {
  it('type/sequence 검증', () => {
    expect(validateMilestone({ type: 'bogus', title: 'x', sequence: 0 })).toHaveLength(2);
    expect(validateMilestone({ type: 'review', title: '검토', sequence: 1 })).toEqual([]);
  });
  it('Evidence 없음/부족 → milestone_unverified(완료 표시 ≠ 성과)', () => {
    expect(evaluateMilestoneEvidence({ evidenceRequired: 2, evidenceProvided: 0, statusReported: 'completion_reported_reference' }).verdict).toBe('milestone_unverified');
    expect(evaluateMilestoneEvidence({ evidenceRequired: 2, evidenceProvided: 1, statusReported: 'completion_reported_reference' }).verdict).toBe('milestone_unverified');
    const ok = evaluateMilestoneEvidence({ evidenceRequired: 2, evidenceProvided: 2, statusReported: 'completion_reported_reference' });
    expect(ok.verdict).toBe('verified_eligible');
    expect(ok.note).toContain('자동 검증 아님');
  });
});

describe('progress — reported/verified 분리·복사 금지', () => {
  it('reported: 없으면 null(임의 생성 금지), verified: 검증 milestone 실측만', () => {
    expect(calculateReportedProgress(null)).toBeNull();
    expect(calculateReportedProgress([{ pct: 30 }, { pct: 60 }])).toBe(60);
    expect(calculateVerifiedProgress({ verifiedMilestones: 2, totalMilestones: 4 })).toBe(50);
    expect(calculateVerifiedProgress({ verifiedMilestones: null, totalMilestones: 4 })).toBeNull();
    expect(calculateVerifiedProgress({ verifiedMilestones: 1, totalMilestones: 0 })).toBeNull();
  });
  it('reported 100% + verified 미달 → completion_unverified(복사 금지)', () => {
    const r = classifyProgressStatus({ reported: 100, verified: null, activeBlockers: 0, externallyStarted: true, daysSinceLastEvidence: null });
    expect(r.status).toBe('completion_unverified');
    expect(r.reportedCopiedToVerified).toBe(false);
  });
  it('verified 100 → verified_complete(Outcome 아님), blocker → blocked, 정체 → stalled', () => {
    expect(classifyProgressStatus({ reported: 100, verified: 100, activeBlockers: 0, externallyStarted: true, daysSinceLastEvidence: null }).status).toBe('verified_complete_reference');
    expect(classifyProgressStatus({ reported: 50, verified: 20, activeBlockers: 2, externallyStarted: true, daysSinceLastEvidence: null }).status).toBe('blocked_reference');
    expect(classifyProgressStatus({ reported: 50, verified: 20, activeBlockers: 0, externallyStarted: true, daysSinceLastEvidence: 20 }).status).toBe('stalled_candidate');
    expect(classifyProgressStatus({ reported: null, verified: null, activeBlockers: 0, externallyStarted: false, daysSinceLastEvidence: null }).status).toBe('not_started_reference');
    expect(classifyProgressStatus({ reported: null, verified: null, activeBlockers: 0, externallyStarted: true, daysSinceLastEvidence: null }).status).toBe('externally_started_reference');
  });
});

describe('blocker — 자동 해결 없음·능력 평가 아님', () => {
  it('type/summary/evidence 검증', () => {
    expect(validateBlocker({ type: 'nope', summary: '', evidence: [] })).toHaveLength(3);
    expect(validateBlocker({ type: 'security', summary: 'RLS 검토 대기', evidence: ['e'] })).toEqual([]);
  });
  it('Hard Risk → 즉시 critical(희석 없음), 자료 없음 → impact_unverified', () => {
    const hard = calculateBlockerImpact({ milestonesAffected: 0, deadlineAtRisk: false, hardRisk: true, financialExposureKrw: null, reversible: true });
    expect(hard.impact).toBe('critical_candidate');
    expect(hard.notCapabilityJudgement).toBe(true);
    expect(calculateBlockerImpact({ milestonesAffected: null, deadlineAtRisk: null, hardRisk: false, financialExposureKrw: null, reversible: null }).impact).toBe('blocker_impact_unverified');
    expect(calculateBlockerImpact({ milestonesAffected: 3, deadlineAtRisk: true, hardRisk: false, financialExposureKrw: null, reversible: null }).impact).toBe('high_candidate');
  });
});

describe('dependency — 미확인 → clear 금지', () => {
  it('unknown 포함 → dependency_unverified, blocking 우선, 빈 목록 → clear', () => {
    expect(evaluateDependencyReadiness(null).readiness).toBe('dependency_unverified');
    expect(evaluateDependencyReadiness([]).readiness).toBe('dependency_clear_reference');
    expect(evaluateDependencyReadiness([{ name: 'a', status: 'unknown' }, { name: 'b', status: 'ready' }]).readiness).toBe('dependency_unverified');
    expect(evaluateDependencyReadiness([{ name: 'a', status: 'blocking' }, { name: 'b', status: 'waiting' }]).readiness).toBe('blocking_dependency');
    expect(evaluateDependencyReadiness([{ name: 'a', status: 'waiting' }, { name: 'b', status: 'ready' }]).readiness).toBe('partially_ready');
  });
});

describe('schedule — 기준 없으면 계산 금지·자동 변경 없음', () => {
  it('baseline 없음 → unverified, 구간별 variance', () => {
    expect(calculateScheduleVariance({ plannedAt: NOW, actualAt: NOW, baselineExists: false }).verdict).toBe('schedule_baseline_unverified');
    expect(calculateScheduleVariance({ plannedAt: null, actualAt: NOW, baselineExists: true }).verdict).toBe('insufficient_data');
    expect(calculateScheduleVariance({ plannedAt: new Date('2026-07-10'), actualAt: new Date('2026-07-11'), baselineExists: true }).verdict).toBe('on_reference_schedule');
    expect(calculateScheduleVariance({ plannedAt: new Date('2026-07-01'), actualAt: new Date('2026-07-06'), baselineExists: true }).verdict).toBe('minor_variance_candidate');
    const critical = calculateScheduleVariance({ plannedAt: new Date('2026-05-01'), actualAt: new Date('2026-07-01'), baselineExists: true });
    expect(critical.verdict).toBe('critical_variance_candidate');
    expect(critical.autoDeadlineChanged).toBe(false);
  });
});

describe('scope drift — 승인/무단 구분·자동 변경 없음', () => {
  it('baseline 없음 → unverified, 승인 변경만 → approved_scope_change_reference', () => {
    expect(detectScopeDrift({ baselineExists: false, changes: [] }).drift).toBe('scope_baseline_unverified');
    expect(detectScopeDrift({ baselineExists: true, changes: [] }).drift).toBe('no_known_drift');
    expect(detectScopeDrift({ baselineExists: true, changes: [{ kind: 'deadline_changed', approved: true }] }).drift).toBe('approved_scope_change_reference');
  });
  it('무단 criteria 변경 → critical, 무단 2건 → material', () => {
    const r = detectScopeDrift({ baselineExists: true, changes: [{ kind: 'success_criteria_changed', approved: false }] });
    expect(r.drift).toBe('critical_drift_candidate');
    expect(r.autoScopeChanged).toBe(false);
    expect(detectScopeDrift({ baselineExists: true, changes: [{ kind: 'deliverable_added', approved: false }, { kind: 'deadline_changed', approved: false }] }).drift).toBe('material_drift_candidate');
  });
});

describe('aging — Deadline 경과 ≠ 실패·자동 Escalation 없음', () => {
  it('deadline 경과 → overdue 후보(failureDeclared=false), threshold 없음 → unverified', () => {
    const overdue = calculateCommitmentAging({ createdAt: new Date('2026-06-01'), targetAt: new Date('2026-07-10'), now: NOW, thresholds: null });
    expect(overdue.status).toBe('overdue_candidate');
    expect(overdue.failureDeclared).toBe(false);
    expect(overdue.autoEscalated).toBe(false);
    expect(calculateCommitmentAging({ createdAt: new Date('2026-06-01'), targetAt: new Date('2026-06-20'), now: NOW, thresholds: null }).status).toBe('critical_overdue_candidate');
    expect(calculateCommitmentAging({ createdAt: new Date('2026-07-01'), targetAt: null, now: NOW, thresholds: null }).status).toBe('aging_threshold_unverified');
    expect(calculateCommitmentAging({ createdAt: new Date('2026-07-01'), targetAt: null, now: NOW, thresholds: { agingDays: 7, staleDays: 30 } }).status).toBe('aging_candidate');
  });
});

describe('delivery confidence — 재정규화·Hard Risk 희석 금지·점수 단독 금지', () => {
  it('Hard Risk Blocker → critical(점수 없이), 전부 null → unverified', () => {
    const hard = calculateDeliveryConfidence({ ownershipScore: 90, criteriaScore: 90, milestoneScore: 90, evidenceCoverage: 90, dependencyScore: 90, blockerScore: 90, scheduleScore: 90, hardRiskBlocked: true });
    expect(hard.status).toBe('critical_delivery_risk');
    expect(hard.risks[0]).toContain('희석 금지');
    expect(calculateDeliveryConfidence({ ownershipScore: null, criteriaScore: null, milestoneScore: null, evidenceCoverage: null, dependencyScore: null, blockerScore: null, scheduleScore: null, hardRiskBlocked: false }).status).toBe('delivery_confidence_unverified');
  });
  it('부분 구성 재정규화 + supporting/risks/missing 동시 반환 + 완료 보장 없음', () => {
    const r = calculateDeliveryConfidence({ ownershipScore: 80, criteriaScore: 30, milestoneScore: null, evidenceCoverage: null, dependencyScore: null, blockerScore: null, scheduleScore: null, hardRiskBlocked: false });
    expect(r.score).not.toBeNull();
    expect(r.supporting).toContain('ownership');
    expect(r.risks).toContain('criteria');
    expect(r.missing).toContain('milestone');
    expect(r.completionGuaranteed).toBe(false);
    expect(classifyDeliveryConfidence(null)).toBe('delivery_confidence_unverified');
    expect(classifyDeliveryConfidence(80)).toBe('high_confidence_reference');
  });
});

describe('commitment risk — Hard Risk 즉시 critical', () => {
  it('Hard Risk → critical 단독 사유, gap 누적 분기', () => {
    expect(calculateCommitmentRisk({ ownershipGap: false, criteriaGap: false, milestoneGap: false, evidenceGap: false, activeBlockers: 0, dependencyDelay: false, scheduleVariance: 'on_reference_schedule', scopeDrift: 'no_known_drift', hardRisk: true }).level).toBe('critical');
    expect(calculateCommitmentRisk({ ownershipGap: true, criteriaGap: true, milestoneGap: true, evidenceGap: false, activeBlockers: 0, dependencyDelay: false, scheduleVariance: 'on_reference_schedule', scopeDrift: 'no_known_drift', hardRisk: false }).level).toBe('high');
    expect(calculateCommitmentRisk({ ownershipGap: false, criteriaGap: false, milestoneGap: false, evidenceGap: false, activeBlockers: 0, dependencyDelay: false, scheduleVariance: 'on_reference_schedule', scopeDrift: 'no_known_drift', hardRisk: false }).level).toBe('low');
  });
});

describe('completion — Evidence/Criteria/Blocker 게이트·완료 ≠ Outcome', () => {
  it('Evidence 없음 → completion_unverified, Critical Blocker → verification_pending', () => {
    expect(evaluateCompletionVerification({ evidenceCount: 0, criteriaResultCount: 0, criteriaTotal: 2, requiredMilestonesVerified: true, criticalBlockersOpen: 0, reviewerExists: true }).verdict).toBe('completion_unverified');
    expect(evaluateCompletionVerification({ evidenceCount: 3, criteriaResultCount: 2, criteriaTotal: 2, requiredMilestonesVerified: true, criticalBlockersOpen: 1, reviewerExists: true }).verdict).toBe('verification_pending');
    expect(evaluateCompletionVerification({ evidenceCount: 3, criteriaResultCount: 1, criteriaTotal: 2, requiredMilestonesVerified: true, criticalBlockersOpen: 0, reviewerExists: true }).verdict).toBe('success_criteria_partial');
  });
  it('전 조건 충족 → verified_complete_reference(Outcome 달성 아님)', () => {
    const r = evaluateCompletionVerification({ evidenceCount: 3, criteriaResultCount: 2, criteriaTotal: 2, requiredMilestonesVerified: true, criticalBlockersOpen: 0, reviewerExists: true });
    expect(r.verdict).toBe('verified_complete_reference');
    expect(r.outcomeAchieved).toBe(false);
  });
});

describe('outcome readiness — Gate', () => {
  it('실행 Evidence 없음 → execution_unverified, baseline/metric/window 개별 게이트', () => {
    expect(evaluateOutcomeReadiness({ expectedOutcomeDefined: true, baselineExists: true, metricDefined: true, observationWindowDefined: true, dataSourceExists: true, reviewerExists: true, executionEvidenceExists: false }).readiness).toBe('execution_unverified');
    expect(evaluateOutcomeReadiness({ expectedOutcomeDefined: true, baselineExists: false, metricDefined: true, observationWindowDefined: true, dataSourceExists: true, reviewerExists: true, executionEvidenceExists: true }).readiness).toBe('baseline_unavailable');
    expect(evaluateOutcomeReadiness({ expectedOutcomeDefined: true, baselineExists: true, metricDefined: false, observationWindowDefined: true, dataSourceExists: true, reviewerExists: true, executionEvidenceExists: true }).readiness).toBe('metric_definition_missing');
    expect(evaluateOutcomeReadiness({ expectedOutcomeDefined: true, baselineExists: true, metricDefined: true, observationWindowDefined: false, dataSourceExists: true, reviewerExists: true, executionEvidenceExists: true }).readiness).toBe('observation_window_missing');
    const ready = evaluateOutcomeReadiness({ expectedOutcomeDefined: true, baselineExists: true, metricDefined: true, observationWindowDefined: true, dataSourceExists: true, reviewerExists: true, executionEvidenceExists: true });
    expect(ready.readiness).toBe('ready_for_observation_reference');
    expect(ready.autoOutcomeCreated).toBe(false);
  });
});

describe('accountability — 인사 평가 아님·Evidence 없으면 well_documented 금지', () => {
  it('전 항목 충족 + Evidence 70%+ → well_documented, Evidence 부족 시 강등', () => {
    const good = evaluateAccountability({ ownerClear: true, sponsorClear: true, reviewerIndependent: true, criteriaDefined: true, milestonesDefined: true, evidenceCoverage: 90, blockersDisclosed: true, scopeChangesRecorded: true, completionVerified: true, outcomeObserved: true });
    expect(good.verdict).toBe('well_documented_reference');
    expect(good.notPersonnelEvaluation).toBe(true);
    expect(good.notDisciplinary).toBe(true);
    // 결과가 좋아도 Evidence 없으면 well_documented 금지
    const noEvidence = evaluateAccountability({ ownerClear: true, sponsorClear: true, reviewerIndependent: true, criteriaDefined: true, milestonesDefined: true, evidenceCoverage: 20, blockersDisclosed: true, scopeChangesRecorded: true, completionVerified: true, outcomeObserved: true });
    expect(noEvidence.verdict).toBe('partially_documented');
    expect(noEvidence.gaps).toContain('Evidence Coverage 부족(<70%)');
  });
  it('대부분 미비 → gap candidate', () => {
    expect(evaluateAccountability({ ownerClear: false, sponsorClear: false, reviewerIndependent: false, criteriaDefined: false, milestonesDefined: false, evidenceCoverage: null, blockersDisclosed: false, scopeChangesRecorded: false, completionVerified: false, outcomeObserved: false }).verdict).toBe('accountability_gap_candidate');
  });
});

describe('repeated gap — 개인 능력 단정 금지', () => {
  it('반복 패턴 분기 + personBlamed=false', () => {
    expect(detectRepeatedCommitmentGap(null).verdict).toBe('insufficient_data');
    expect(detectRepeatedCommitmentGap([]).verdict).toBe('no_known_pattern');
    expect(detectRepeatedCommitmentGap([{ gapKind: 'owner_gap', commitmentCode: 'c1' }]).verdict).toBe('isolated_gap');
    const repeated = detectRepeatedCommitmentGap([
      { gapKind: 'owner_gap', commitmentCode: 'c1' }, { gapKind: 'owner_gap', commitmentCode: 'c2' },
    ]);
    expect(repeated.verdict).toBe('repeated_gap_candidate');
    expect(repeated.personBlamed).toBe(false);
    const critical = detectRepeatedCommitmentGap(Array.from({ length: 5 }, (_, i) => ({ gapKind: 'completion_unverified_repeat', commitmentCode: `c${i}` })));
    expect(critical.verdict).toBe('critical_commitment_gap');
  });
});

describe('recommendation / outcome link / timeline', () => {
  it('recommendation: whitelist + Evidence 필수 + humanApprovalRequired', () => {
    expect('rejected' in buildCommitmentRecommendation({ type: 'auto_complete_work', reason: 'x', evidence: ['e'], severity: 'high', riskIfDeferred: null })).toBe(true);
    expect('rejected' in buildCommitmentRecommendation({ type: 'request_owner_acknowledgement', reason: 'x', evidence: [], severity: 'high', riskIfDeferred: null })).toBe(true);
    const r = buildCommitmentRecommendation({ type: 'request_owner_acknowledgement', reason: 'Owner 미수락', evidence: ['e'], severity: 'high', riskIfDeferred: null });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.autoExecuted).toBe(false);
      expect(r.riskIfDeferred).toContain('0 아님');
    }
  });
  it('outcome link: 완료 미검증 → 연결 금지, 연결 ≠ 인과', () => {
    expect('insufficient' in buildCommitmentOutcomeLink({ commitmentCode: 'c', decisionMemoryRef: 'dm', completionVerified: false, observationClosed: null, evidence: ['e'] })).toBe(true);
    expect('insufficient' in buildCommitmentOutcomeLink({ commitmentCode: 'c', decisionMemoryRef: null, completionVerified: true, observationClosed: null, evidence: ['e'] })).toBe(true);
    const r = buildCommitmentOutcomeLink({ commitmentCode: 'c', decisionMemoryRef: 'dm-1', completionVerified: true, observationClosed: false, evidence: ['e'] });
    if ('causallyAttributed' in r) {
      expect(r.causallyAttributed).toBe(false);
      expect(r.linkStatus).toBe('outcome_pending');
    }
  });
  it('timeline: 최신순 + truncate 명시', () => {
    const r = buildCommitmentTimeline([
      { at: new Date('2026-07-01'), kind: 'a', label: '1' },
      { at: new Date('2026-07-10'), kind: 'b', label: '2' },
      { at: new Date('2026-07-05'), kind: 'c', label: '3' },
    ], 2);
    expect(r.items.map((i) => i.label)).toEqual(['2', '3']);
    expect(r.truncated).toBe(true);
    expect(buildCommitmentTimeline(null).items).toEqual([]);
  });
});

describe('COMMITMENT_SUPPORT — 실측 기반 지원 매트릭스', () => {
  it('42개 항목 + 자동 생성/배정/일정/진행/완료/인사평가/Production 은 unsupported', () => {
    expect(COMMITMENT_SUPPORT).toHaveLength(42);
    for (const key of ['pm_integration', 'calendar', 'auto_commitment', 'auto_owner_assignment', 'auto_schedule_change', 'auto_progress', 'auto_personnel_eval', 'production_apply']) {
      expect(COMMITMENT_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
    expect(COMMITMENT_SUPPORT.filter((s) => s.status === 'supported').length).toBeGreaterThan(25);
  });
});
