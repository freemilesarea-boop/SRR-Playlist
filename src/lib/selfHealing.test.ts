// Phase AI-MUSIC-15 — Self-Healing 순수 로직 단위 테스트.
// Detection(이전 없으면 감지 금지) · RCA(상관 후보) · Recovery 생성(자동 실행 없음) ·
// Twin 게이트(실패 → Governance 금지) · Risk(재정규화) · Knowledge Base(Outcome 2건 미만 금지) ·
// Playbook · Score(Outcome 없으면 insufficient) · Support Matrix.
import { describe, it, expect } from 'vitest';
import {
  detectIncidents, analyzeRootCause, generateRecoveryStrategies, canSubmitToGovernance,
  assessRecoveryRisk, knowledgeSuccessRate, derivePlaybook, calculateSelfHealingScore,
  selfHealingInputHash, INCIDENT_TYPES, HEAL_SUPPORT,
  type TelemetryWindow, type DetectedIncident,
} from './selfHealing';

const W = (over: Partial<TelemetryWindow> = {}): TelemetryWindow => ({
  prevEvents: 500, currEvents: 500, prevErrorRate: 1, currErrorRate: 1,
  prevSkipRate: 8, currSkipRate: 8, prevCompletion: 75, currCompletion: 75, ...over,
});

describe('Incident Detection', () => {
  it('Error rate 2배+1%p 이상 → playback_failure · 10%+ → critical', () => {
    const inc = detectIncidents(W({ currErrorRate: 3 }));
    expect(inc.length).toBe(1); expect(inc[0].incidentType).toBe('playback_failure'); expect(inc[0].severity).toBe('moderate');
    expect(detectIncidents(W({ currErrorRate: 12 }))[0].severity).toBe('critical');
  });
  it('Skip 1.5배+3pp → streaming_degradation · Completion -10pp → streaming_degradation', () => {
    expect(detectIncidents(W({ currSkipRate: 14 }))[0].incidentType).toBe('streaming_degradation');
    expect(detectIncidents(W({ currCompletion: 60 }))[0].incidentType).toBe('streaming_degradation');
  });
  it('이전 구간 데이터 부족 → 감지하지 않음(가짜 장애 생성 금지)', () => {
    expect(detectIncidents(W({ prevEvents: 10, currErrorRate: 20 }))).toEqual([]);
    expect(detectIncidents(W({ prevEvents: null, currErrorRate: 20 }))).toEqual([]);
  });
  it('정상 상태 → 감지 없음 · limitations 에 자동 복구 없음 명시', () => {
    expect(detectIncidents(W())).toEqual([]);
    const inc = detectIncidents(W({ currErrorRate: 3 }))[0];
    expect(inc.limitations.some((l) => l.includes('자동 복구 없음'))).toBe(true);
  });
});

describe('Root Cause Analysis (상관 기반 후보)', () => {
  const inc = (over: Partial<DetectedIncident>): DetectedIncident => ({
    incidentType: 'playback_failure', severity: 'high', scope: 'global', scopeKey: null,
    kpi: { error_rate: 5 }, baseline: { error_rate: 1 }, summary: '', evidence: [], limitations: [], ...over,
  });
  it('playback_failure → CDN/decoder 후보 · confidence 내림차순 정렬', () => {
    const causes = analyzeRootCause(inc({}));
    expect(causes[0].cause).toBe('cdn_or_network_degradation');
    expect(causes.every((c, i) => i === 0 || causes[i - 1].confidence >= c.confidence)).toBe(true);
  });
  it('skip 만 증가(error 정상) → content/rotation 후보', () => {
    const causes = analyzeRootCause(inc({ incidentType: 'streaming_degradation', kpi: { skip_rate: 15 } }));
    expect(causes.map((c) => c.cause)).toContain('content_mismatch');
  });
  it('신호 불충분 → unknown/insufficient_data(단정 없음)', () => {
    const causes = analyzeRootCause(inc({ incidentType: 'streaming_degradation', kpi: {} }));
    expect(causes[0].cause).toBe('unknown'); expect(causes[0].confidence).toBe(0);
  });
});

describe('Recovery Strategy / Twin 게이트', () => {
  it('원인 기반 전략 제안(중복 제거) · 자동 실행 금지 명시', () => {
    const props = generateRecoveryStrategies([
      { cause: 'cdn_or_network_degradation', confidence: 55, chain: [], note: '' },
      { cause: 'streaming_quality_degradation', confidence: 45, chain: [], note: '' },
    ]);
    const types = props.map((p) => p.strategyType);
    expect(types).toContain('alternate_cdn'); expect(new Set(types).size).toBe(types.length);
    expect(props.every((p) => p.limitations.some((l) => l.includes('자동') || l.includes('Draft')))).toBe(true);
  });
  it('Twin 미검증/실패 → Governance 제출 금지', () => {
    expect(canSubmitToGovernance('twin_validated').allowed).toBe(true);
    expect(canSubmitToGovernance('twin_failed').allowed).toBe(false);
    expect(canSubmitToGovernance('not_validated').allowed).toBe(false);
  });
});

describe('Risk Assessment / Knowledge Base', () => {
  it('성분 재정규화 · blast radius penalty · 성분 없으면 null', () => {
    const a = assessRecoveryRisk({ knowledgeSuccessRate: 80, twinConfidence: 60, blastRadius: 'single_store' });
    const b = assessRecoveryRisk({ knowledgeSuccessRate: 80, twinConfidence: 60, blastRadius: 'global' });
    expect(a.successProbability!).toBeGreaterThan(b.successProbability!);
    expect(b.businessImpact).toBe('critical');
    expect(assessRecoveryRisk({}).successProbability).toBeNull();
  });
  it('Knowledge 성공률 — 실제 Outcome 2건 미만 → null(가짜 확률 금지)', () => {
    expect(knowledgeSuccessRate([{ strategyType: 'retry_policy', incidentType: 'playback_failure', outcome: 'succeeded' }], 'retry_policy', 'playback_failure')).toBeNull();
    expect(knowledgeSuccessRate([
      { strategyType: 'retry_policy', incidentType: 'playback_failure', outcome: 'succeeded' },
      { strategyType: 'retry_policy', incidentType: 'playback_failure', outcome: 'failed' },
    ], 'retry_policy', 'playback_failure')).toBe(50);
    expect(knowledgeSuccessRate([
      { strategyType: 'retry_policy', incidentType: 'playback_failure', outcome: 'pending' },
      { strategyType: 'retry_policy', incidentType: 'playback_failure', outcome: 'pending' },
    ], 'retry_policy', 'playback_failure')).toBeNull(); // pending 은 Outcome 아님
  });
});

describe('Playbook / Score', () => {
  it('Playbook 파생 — Twin/Governance 단계 포함 · 전략 없으면 null', () => {
    const pb = derivePlaybook('playback_failure', generateRecoveryStrategies([{ cause: 'cdn_or_network_degradation', confidence: 55, chain: [], note: '' }]), 2)!;
    expect(pb.steps.some((s) => s.action.includes('Twin'))).toBe(true);
    expect(pb.steps[0].order).toBe(1);
    expect(derivePlaybook('playback_failure', [], 2)).toBeNull();
  });
  it('Self-Healing Score — 성분 재정규화 · 전 성분 누락 insufficient_data', () => {
    const r = calculateSelfHealingScore({ detectionSpeedScore: 80, falsePositiveRate: 10, mttrHours: 5 });
    expect(r.score).not.toBeNull(); expect(r.missing).toContain('rca_accuracy');
    expect(calculateSelfHealingScore({}).grade).toBe('insufficient_data');
  });
  it('hash 결정적', () => { expect(selfHealingInputHash(['a', 1])).toBe(selfHealingInputHash(['a', 1])); });
});

describe('Support Matrix', () => {
  it('Infra telemetry 미수집 타입 = unsupported (가짜 감지 없음)', () => {
    for (const t of ['queue_stall', 'scheduler_drift', 'store_offline', 'api_failure', 'db_latency', 'ai_service_failure']) {
      expect(INCIDENT_TYPES.find((x) => x.type === t)!.support).toBe('unsupported');
    }
    expect(INCIDENT_TYPES.find((x) => x.type === 'playback_failure')!.support).toBe('supported');
  });
  it('자동 Recovery/Production Apply = unsupported · Twin Validation = fully · Score = insufficient', () => {
    expect(HEAL_SUPPORT.find((s) => s.key === 'auto_recovery')!.status).toBe('unsupported');
    expect(HEAL_SUPPORT.find((s) => s.key === 'production_apply')!.status).toBe('unsupported');
    expect(HEAL_SUPPORT.find((s) => s.key === 'twin_validation')!.status).toBe('fully_supported');
    expect(HEAL_SUPPORT.find((s) => s.key === 'score')!.status).toBe('insufficient_data');
  });
});
