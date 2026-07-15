import { describe, expect, it } from 'vitest';
import {
  analyzeDependencies,
  analyzeIntegration,
  analyzePartnerPerformance,
  analyzeSupplyChain,
  assessEcosystemRisk,
  buildDependencyGraph,
  buildEcosystemBriefing,
  buildEcosystemCockpit,
  buildEcosystemRecommendation,
  ECOSYSTEM_SUPPORT,
  evaluateEcosystemHealth,
} from './ecosystemIntelligence';

describe('dependency — 읽기 전용·Dependency ≠ Failure', () => {
  it('criticality 집계 + fallback null 은 unknown 유지(false 아님)', () => {
    const r = analyzeDependencies([
      { code: 'D-1', domain: 'database', criticality: 'critical', fallbackAvailable: false },
      { code: 'D-2', domain: 'payment', criticality: 'high', fallbackAvailable: null },
      { code: 'D-3', domain: 'cdn', criticality: 'high', fallbackAvailable: true },
    ]);
    expect(r.total).toBe(3);
    expect(r.byCriticality.high).toBe(2);
    expect(r.noFallback).toEqual(['D-1']);
    expect(r.fallbackUnknown).toEqual(['D-2']);
    expect(r.dependencyIsNotFailure).toBe(true);
    expect(r.readOnlyAnalysis).toBe(true);
  });
});

describe('ecosystem health — 실측 없으면 unavailable', () => {
  it('5 컴포넌트 + Availability ≠ SLA Guarantee', () => {
    const none = evaluateEcosystemHealth({ availabilityProxyPct: null, reliabilitySample: null, latencyMs: null, slaStatus: null, integrationSignal: null });
    expect(none.verdict).toBe('ecosystem_unavailable');
    const r = evaluateEcosystemHealth({ availabilityProxyPct: 99, reliabilitySample: 1000, latencyMs: null, slaStatus: null, integrationSignal: null });
    expect(r.verdict).toBe('partial_measured');
    expect(r.components.find((c) => c.key === 'latency_ms')?.status).toBe('ecosystem_unavailable');
    expect(r.availabilityIsNotSlaGuarantee).toBe(true);
  });
});

describe('partner performance / integration', () => {
  it('performance: Evidence 없음 unverified, 표본<5 sample_too_small, Partner ≠ Trust', () => {
    expect(analyzePartnerPerformance({ partner: 'p', incidentCount: 1, failureRatePct: 2, sample: 100, evidence: [] }).verdict).toBe('ecosystem_unverified');
    expect(analyzePartnerPerformance({ partner: 'p', incidentCount: null, failureRatePct: null, sample: 100, evidence: ['e'] }).verdict).toBe('insufficient_data');
    expect(analyzePartnerPerformance({ partner: 'p', incidentCount: 1, failureRatePct: 2, sample: 3, evidence: ['e'] }).verdict).toBe('sample_too_small');
    const ok = analyzePartnerPerformance({ partner: 'p', incidentCount: 1, failureRatePct: 2, sample: 100, evidence: ['payments'] });
    expect(ok.verdict).toBe('performance_observed');
    expect(ok.partnerIsNotTrust).toBe(true);
  });
  it('integration: coverage + deprecated 집계 + 호환 보장 아님', () => {
    const r = analyzeIntegration([
      { name: 'a', lifecycleStatus: 'active', deprecated: false },
      { name: 'b', lifecycleStatus: 'deprecated', deprecated: null },
      { name: 'c', lifecycleStatus: null, deprecated: null },
      { name: 'd', lifecycleStatus: 'active', deprecated: false },
    ]);
    expect(r.total).toBe(4);
    expect(r.active).toBe(2);
    expect(r.coveragePct).toBe(50);
    expect(r.deprecatedCount).toBe(1);
    expect(r.lifecycleUnknown).toContain('c');
    expect(r.integrationIsNotCompatibilityGuarantee).toBe(true);
    expect(analyzeIntegration([]).coveragePct).toBeNull();
  });
});

describe('dependency graph — 5단계·cycle 원인 단정 아님', () => {
  it('orphan/cycle 감지 + cycleIsNotCauseClaim', () => {
    const r = buildDependencyGraph([
      { id: 'e', level: 'enterprise', label: 'E', parentId: null },
      { id: 'p', level: 'platform', label: 'P', parentId: 'e' },
      { id: 'a', level: 'api', label: 'A', parentId: null },   // orphan
      { id: 'x', level: 'bogus', label: 'X', parentId: null },
    ]);
    expect(r.levels).toHaveLength(5);
    expect(r.orphans).toContain('a');
    expect(r.orphans).not.toContain('p');
    const cyclic = buildDependencyGraph([
      { id: 'i1', level: 'infrastructure', label: 'I1', parentId: 'i2' },
      { id: 'i2', level: 'infrastructure', label: 'I2', parentId: 'i1' },
    ]);
    expect(cyclic.cycles.length).toBeGreaterThan(0);
    expect(cyclic.cycleIsNotCauseClaim).toBe(true);
  });
});

describe('supply chain / risk', () => {
  it('supply chain: 실측/미존재 구분', () => {
    const r = analyzeSupplyChain([
      { key: 'content_supply', measuredValue: 120, note: 'tracks 실측' },
      { key: 'ai_provider', measuredValue: null, note: '사용 로그 없음' },
    ]);
    expect(r.measuredCount).toBe(1);
    expect(r.verdict).toBe('partial_measured');
    expect(r.segments[1].status).toBe('ecosystem_unavailable');
    expect(analyzeSupplyChain([]).verdict).toBe('ecosystem_unavailable');
  });
  it('risk: whitelist + Evidence 없음 unverified + Risk ≠ Incident', () => {
    expect(assessEcosystemRisk({ kind: 'bogus', signal: 90, highThreshold: 80, mediumThreshold: 50, evidence: ['e'] }).verdict).toBe('ecosystem_unverified');
    expect(assessEcosystemRisk({ kind: 'partner_risk', signal: 90, highThreshold: 80, mediumThreshold: 50, evidence: [] }).level).toBe('unknown');
    expect(assessEcosystemRisk({ kind: 'api_risk', signal: 90, highThreshold: 80, mediumThreshold: 50, evidence: ['e'] }).level).toBe('high');
    expect(assessEcosystemRisk({ kind: 'vendor_risk', signal: 60, highThreshold: 80, mediumThreshold: 50, evidence: ['e'] }).level).toBe('medium');
    expect(assessEcosystemRisk({ kind: 'supply_chain_risk', signal: null, highThreshold: 80, mediumThreshold: 50, evidence: ['e'] }).level).toBe('unknown');
  });
});

describe('briefing / recommendation / cockpit / support', () => {
  it('briefing: 5섹션 + 자동 발송 없음', () => {
    const r = buildEcosystemBriefing({ periodKind: 'quarterly', partnerChanges: ['p'], dependencyChanges: [], integrationStatus: ['ok'], unknownFactors: ['u'], recommendations: [] });
    expect(r.valid).toBe(true);
    expect(r.sections).toHaveLength(5);
    expect(r.autoSendDisabled).toBe(true);
    expect(buildEcosystemBriefing({ periodKind: 'hourly', partnerChanges: [], dependencyChanges: [], integrationStatus: [], unknownFactors: [], recommendations: [] }).valid).toBe(false);
  });
  it('recommendation: whitelist + Evidence 필수 + ≠ Business Decision', () => {
    expect('rejected' in buildEcosystemRecommendation({ type: 'switch_provider', reason: 'x', evidence: ['e'], confidence: null, assumptions: [] })).toBe(true);
    expect('rejected' in buildEcosystemRecommendation({ type: 'review_dependency', reason: 'x', evidence: [], confidence: null, assumptions: [] })).toBe(true);
    const r = buildEcosystemRecommendation({ type: 'review_vendor_risk', reason: 'fallback 없는 critical 의존 존재', evidence: ['deps'], confidence: 40, assumptions: ['a'] });
    if ('humanApprovalRequired' in r) {
      expect(r.humanApprovalRequired).toBe(true);
      expect(r.approvalImplied).toBe(false);
      expect(r.limitations).toContain('Recommendation ≠ Business Decision');
    }
  });
  it('cockpit: 7영역 + contractChanged=false', () => {
    const r = buildEcosystemCockpit({ partnersTotal: 2, dependencyTotal: 10, healthVerdict: 'partial_measured', integrationCoverage: null, supplyChainVerdict: 'partial_measured', risksHigh: 0, summaryNote: null });
    expect(r.sections).toHaveLength(7);
    expect(r.humanDecisionRequired).toBe(true);
    expect(r.contractChanged).toBe(false);
    expect(r.sections.find((s) => s.key === 'integration')?.headline).toBe('insufficient_data');
  });
  it('ECOSYSTEM_SUPPORT: 16항목 + SLA/latency/자동 변경 unsupported', () => {
    expect(ECOSYSTEM_SUPPORT).toHaveLength(16);
    for (const key of ['availability_sla', 'latency_measurement', 'auto_partner_registration', 'auto_provider_change']) {
      expect(ECOSYSTEM_SUPPORT.find((s) => s.key === key)?.status).toBe('unsupported');
    }
  });
});
