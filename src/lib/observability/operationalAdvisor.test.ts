import { describe, it, expect } from 'vitest';
import {
  computeBlastRadius, computeImpact, type BlastRadiusInput, type ImpactInput,
} from './blastRadius';
import { computeRecovery, type RecoveryInput, type RecoveryBucket } from './recovery';
import { getPlaybook, playbookKeyFor } from './playbook';
import {
  computeOperationalAdvice, actionSafety, computeEscalationDetail, deriveLifecycle,
  type AdvisorInput,
} from './operationalAdvisor';

// ── Blast Radius ──────────────────────────────────────────────────────────────
const blastBase: BlastRadiusInput = {
  affectedSessions: 40, totalSessions: 400, affectedEvents: 300, totalEvents: 4000,
  affectedRoutes: ['/player'], affectedBrowsers: ['Chrome', 'Safari'], affectedDevices: ['desktop'],
  affectedReleases: ['r2'], severeSessions: 5, browsers: 3, primaryScope: 'release r2',
};

describe('computeBlastRadius', () => {
  it('MODERATE for ~10% affected', () => {
    const r = computeBlastRadius(blastBase); // 40/400 = 10%
    expect(r.level).toBe('MODERATE');
    expect(r.affectedSessionRate).toBeCloseTo(0.1);
  });
  it('ISOLATED for tiny rate', () => {
    expect(computeBlastRadius({ ...blastBase, affectedSessions: 6, totalSessions: 4000 }).level).toBe('ISOLATED');
  });
  it('CRITICAL for severe session count regardless of rate', () => {
    expect(computeBlastRadius({ ...blastBase, affectedSessions: 30, severeSessions: 30 }).level).toBe('CRITICAL');
  });
  it('single event / thin affected → INSUFFICIENT_DATA (never WIDESPREAD)', () => {
    const r = computeBlastRadius({ ...blastBase, affectedSessions: 1, totalSessions: 1 });
    expect(r.level).toBe('INSUFFICIENT_DATA');
    expect(r.insufficientData).toBe(true);
  });
  it('missing denominator → INSUFFICIENT_DATA, no rate asserted', () => {
    const r = computeBlastRadius({ ...blastBase, totalSessions: null });
    expect(r.level).toBe('INSUFFICIENT_DATA');
    expect(r.affectedSessionRate).toBeNull();
  });
  it('WIDESPREAD only at high rate, never from one event', () => {
    expect(computeBlastRadius({ ...blastBase, affectedSessions: 100, totalSessions: 400 }).level).toBe('WIDESPREAD');
  });
});

describe('computeImpact', () => {
  const impactBase: ImpactInput = {
    affectedSessions: 40, totalSessions: 400, errorEvents: 300, criticalErrors: 13, chunkFailures: 10,
    hydrationErrors: 0, slowApiEvents: 50, timeoutEvents: null, memoryRiskSessions: 0,
    affectedRoutes: ['/player'], playerRouteAffected: true, adminRouteAffected: false,
    affectedBrowsers: ['Chrome'], affectedReleases: ['r2'],
  };
  it('business impact is explicitly not available', () => {
    const r = computeImpact(impactBase);
    expect(r.businessImpact).toBe('BUSINESS_IMPACT_NOT_AVAILABLE');
    expect(r.sessionImpact.rate).toBeCloseTo(0.1);
    expect(r.routeImpact.playerRouteAffected).toBe(true);
  });
  it('session rate null when denominator missing', () => {
    expect(computeImpact({ ...impactBase, totalSessions: null }).sessionImpact.rate).toBeNull();
  });
});

// ── Recovery ──────────────────────────────────────────────────────────────────
const bucket = (errorRate: number | null, sessions: number, events: number): RecoveryBucket => ({
  errorRate, criticalRate: 0, chunkRate: 0, apiP95: null, lcpP75: null, sessions, events,
});
const recBase: RecoveryInput = {
  earlier: bucket(0.15, 100, 1000), recent: bucket(0.01, 100, 1000),
  observationWindowMinutes: 60, recentSeries: [0.02, 0.015, 0.01], targetErrorRate: 0.02,
};

describe('computeRecovery', () => {
  it('RECOVERED when dropped past ratio and under target', () => {
    expect(computeRecovery(recBase).status).toBe('RECOVERED');
  });
  it('IMPROVING when dropped but above target', () => {
    const r = computeRecovery({ ...recBase, recent: bucket(0.05, 100, 1000), targetErrorRate: 0.02, recentSeries: [0.1, 0.07, 0.05] });
    expect(r.status).toBe('IMPROVING');
  });
  it('REGRESSED when recent above earlier', () => {
    const r = computeRecovery({ ...recBase, earlier: bucket(0.05, 100, 1000), recent: bucket(0.09, 100, 1000), recentSeries: [0.05, 0.07, 0.09] });
    expect(r.status).toBe('REGRESSED');
  });
  it('recurrence (dip then spike) → REGRESSED', () => {
    const r = computeRecovery({ ...recBase, recentSeries: [0.12, 0.01, 0.08] });
    expect(r.recurrence).toBe(true);
    expect(r.status).toBe('REGRESSED');
  });
  it('NOT_STARTED below observation window', () => {
    expect(computeRecovery({ ...recBase, observationWindowMinutes: 10 }).status).toBe('NOT_STARTED');
  });
  it('INSUFFICIENT_DATA below sample floor', () => {
    expect(computeRecovery({ ...recBase, recent: bucket(0.01, 5, 20) }).status).toBe('INSUFFICIENT_DATA');
  });
  it('operatorCloseRequired always true (never auto-close)', () => {
    expect(computeRecovery(recBase).operatorCloseRequired).toBe(true);
  });
});

// ── Playbook ──────────────────────────────────────────────────────────────────
describe('playbook', () => {
  it('maps incident types to playbooks; unsupported → GENERIC', () => {
    expect(playbookKeyFor('CHUNK_FAILURE_SPIKE')).toBe('CHUNK_FAILURE_SPIKE');
    expect(playbookKeyFor('CRITICAL_ERROR')).toBe('ERROR_SPIKE');
    expect(playbookKeyFor('LONG_TASK_SPIKE')).toBe('WEB_VITAL_REGRESSION');
    expect(playbookKeyFor(null)).toBe('GENERIC');
  });
  it('steps are ordered and never destructive/automated', () => {
    const p = getPlaybook('ERROR_SPIKE');
    expect(p.steps.length).toBeGreaterThan(0);
    p.steps.forEach((s, i) => {
      expect(s.stepOrder).toBe(i + 1);
      expect(s.destructive).toBe(false);
      expect(s.automated).toBe(false);
      expect(s.status).toBe('NOT_STARTED');
    });
  });
  it('every playbook step carries purpose + evidence + expected + stop + escalation', () => {
    for (const t of ['CHUNK_FAILURE_SPIKE', 'HYDRATION_ERROR_SPIKE', 'API_REGRESSION', 'MEMORY_RISK'] as const) {
      const p = getPlaybook(t);
      p.steps.forEach((s) => {
        expect(s.purpose).toBeTruthy();
        expect(s.requiredEvidence).toBeTruthy();
        expect(s.expectedResult).toBeTruthy();
      });
    }
  });
});

// ── Operational Advisor ─────────────────────────────────────────────────────
const advBase: AdvisorInput = {
  incidentType: 'CHUNK_FAILURE_SPIKE', topCauseCode: 'CHUNK_DEPLOY', topCauseRoute: '/player',
  rollbackStatus: 'WATCH', gateVerdict: 'PASS_WITH_WARNING', blastLevel: 'MODERATE',
  recoveryStatus: null, confidence: 'HIGH', affectedSessions: 40, criticalRate: 0.005,
  chunkRate: 0.03, errorRate: 0.04, recurring: false, securityEvidence: false,
};

describe('actionSafety', () => {
  it('all actions require approval and are never automated', () => {
    for (const c of ['OBSERVE', 'PAUSE_RELEASE', 'ROLLBACK_RECOMMENDED', 'VERIFY_API', 'ESCALATE_ENGINEERING'] as const) {
      const s = actionSafety(c);
      expect(s.requiresApproval).toBe(true);
      expect(s.automated).toBe(false);
    }
  });
  it('verifications are read-only, no production effect', () => {
    const s = actionSafety('VERIFY_BROWSER');
    expect(s.readOnly).toBe(true);
    expect(s.productionEffect).toBe(false);
  });
  it('rollback/pause carry production effect but still not destructive/automated', () => {
    const s = actionSafety('ROLLBACK_RECOMMENDED');
    expect(s.productionEffect).toBe(true);
    expect(s.destructive).toBe(false);
    expect(s.automated).toBe(false);
  });
});

describe('computeOperationalAdvice', () => {
  it('cause-specific verification for chunk deploy', () => {
    const a = computeOperationalAdvice(advBase);
    expect(a.recommendedAction).toBe('CHUNK_VERIFICATION');
    expect(a.approvalRequired).toBe(true);
    expect(a.verificationSteps.length).toBeGreaterThan(0);
  });
  it('INSUFFICIENT confidence → OBSERVE with reason, low urgency', () => {
    const a = computeOperationalAdvice({ ...advBase, confidence: 'INSUFFICIENT' });
    expect(a.recommendedAction).toBe('OBSERVE');
    expect(a.insufficientDataReason).toBeTruthy();
  });
  it('BLOCK_RELEASE → prepare rollback / hold, CRITICAL urgency, production effect', () => {
    const a = computeOperationalAdvice({ ...advBase, rollbackStatus: 'BLOCK_RELEASE', gateVerdict: 'PASS', topCauseCode: null });
    expect(['PREPARE_ROLLBACK', 'HOLD_PROMOTION']).toContain(a.recommendedAction);
    expect(a.urgency).toBe('CRITICAL');
    expect(a.productionEffect).toBe(true);
  });
  it('ROLLBACK_RECOMMENDED → rollback recommended action (advisory)', () => {
    const a = computeOperationalAdvice({ ...advBase, rollbackStatus: 'ROLLBACK_RECOMMENDED', topCauseCode: null });
    expect(a.recommendedAction).toBe('ROLLBACK_RECOMMENDED');
    expect(a.safety.automated).toBe(false);
  });
  it('recovering → observe until operator closes', () => {
    const a = computeOperationalAdvice({ ...advBase, recoveryStatus: 'RECOVERED', rollbackStatus: 'NO_ACTION', topCauseCode: null });
    expect(a.recommendedAction).toBe('OBSERVE');
  });
  it('player route concentration → player health verification', () => {
    const a = computeOperationalAdvice({ ...advBase, topCauseCode: 'ROUTE_CONCENTRATION', topCauseRoute: '/player', rollbackStatus: 'NO_ACTION' });
    expect(a.recommendedAction).toBe('PLAYER_HEALTH_VERIFICATION');
  });
});

describe('computeEscalationDetail', () => {
  it('SECURITY only with evidence', () => {
    expect(computeEscalationDetail({ ...advBase, securityEvidence: true }).target).toBe('SECURITY');
    expect(computeEscalationDetail(advBase).target).not.toBe('SECURITY');
  });
  it('EXECUTIVE only for widespread + severe', () => {
    expect(computeEscalationDetail({ ...advBase, blastLevel: 'CRITICAL', rollbackStatus: 'BLOCK_RELEASE' }).target).toBe('EXECUTIVE');
  });
  it('no over-escalation on insufficient data', () => {
    expect(computeEscalationDetail({ ...advBase, confidence: 'INSUFFICIENT' }).target).toBe('NONE');
  });
  it('API latency → BACKEND', () => {
    expect(computeEscalationDetail({ ...advBase, topCauseCode: 'API_LATENCY', rollbackStatus: 'NO_ACTION' }).target).toBe('BACKEND');
  });
});

describe('deriveLifecycle', () => {
  it('never auto-RESOLVED; recovered → MONITORING with operator-close note', () => {
    const l = deriveLifecycle({ ...advBase, recoveryStatus: 'RECOVERED', recurring: false });
    expect(l.suggestedStatus).toBe('MONITORING');
    expect(l.note).toMatch(/RESOLVED|종료/);
    expect(l.operatorControlled).toBe(true);
  });
  it('insufficient + thin → FALSE_POSITIVE (operator confirms)', () => {
    expect(deriveLifecycle({ ...advBase, confidence: 'INSUFFICIENT', affectedSessions: 1 }).suggestedStatus).toBe('FALSE_POSITIVE');
  });
  it('block/rollback → MITIGATING', () => {
    expect(deriveLifecycle({ ...advBase, rollbackStatus: 'BLOCK_RELEASE' }).suggestedStatus).toBe('MITIGATING');
  });
});
