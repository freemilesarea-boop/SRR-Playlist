import { describe, expect, it } from 'vitest';
import {
  CONTINUITY_AREAS, READINESS_AREAS, RECOVERY_BLOCKED_ACTIONS, RECOVERY_BUCKETS,
  RECOVERY_RELATIONSHIP_EDGES, RECOVERY_RELATIONSHIP_FLOW,
  assessResilienceQuality, buildRecoveryRelationships, buildRecoverySummaryLines,
  buildResilienceOverview, computeRecoveryAnalytics, emptyRecoveryFeeds,
  isBlockedRecoveryAction, mapRecoveryBucket, summarizeContinuity, summarizeReadiness,
  summarizeRecoveries,
  type RecoveryFeeds,
} from './resilienceRecoveryCenter';

function feedsFixture(): RecoveryFeeds {
  return {
    incidents: [
      { id: 'i1', incident_code: 'INC-1', incident_type: 'store_offline', severity: 'high', status: 'resolved', detected_at: '2026-07-17T00:00:00Z', resolved_at: '2026-07-17T01:00:00Z' },
      { id: 'i2', incident_code: 'INC-2', incident_type: 'stream_error', severity: 'medium', status: 'open', detected_at: '2026-07-18T00:00:00Z', resolved_at: null },
      { id: 'i3', incident_code: 'INC-3', incident_type: 'store_offline', severity: 'low', status: 'resolved', detected_at: '2026-07-18T02:00:00Z', resolved_at: '2026-07-18T02:30:00Z' },
    ],
    recoveries: [
      { id: 'r1', recovery_code: 'REC-1', strategy_type: 'restart', status: 'done', outcome: 'success', validation_status: 'validated', recovery_time_estimate_min: 30, created_at: '2026-07-17T00:30:00Z' },
      { id: 'r2', recovery_code: 'REC-2', strategy_type: 'failover', status: 'done', outcome: 'failed', validation_status: 'validated', recovery_time_estimate_min: 90, created_at: '2026-07-17T01:00:00Z' },
      { id: 'r3', recovery_code: 'REC-3', strategy_type: 'restart', status: 'proposed', outcome: 'unknown', validation_status: 'pending', recovery_time_estimate_min: null, created_at: '2026-07-18T00:10:00Z' },
      { id: 'r4', recovery_code: 'REC-4', strategy_type: 'manual', status: 'pending', outcome: 'unknown', validation_status: 'pending', recovery_time_estimate_min: 60, created_at: '2026-07-18T00:20:00Z' },
      { id: 'r5', recovery_code: 'REC-5', strategy_type: 'manual', status: 'weird', outcome: 'unknown', validation_status: 'pending', recovery_time_estimate_min: null, created_at: '2026-07-18T00:25:00Z' },
    ],
    noc: { total_stores: 40, online_stores: 38, today_incidents: 1, today_recovered: 1 },
    selfHealing: { incidents: {} },
    resilienceSummary: { resilience_actuals: {} },
    govEvents: { violations: 0, overrides: 0, checks: 10 },
    performance: { kpis: {} },
    streaming: { heartbeat_sessions: 10 },
  };
}

describe('Recovery Center — 기존 0502 조회만(실행/생성 없음)', () => {
  it('outcome/status 결정적 매핑 + 매핑 불가 공개', () => {
    expect(mapRecoveryBucket({ status: 'done', outcome: 'success' })).toBe('completed');
    expect(mapRecoveryBucket({ status: 'done', outcome: 'failed' })).toBe('failed');
    expect(mapRecoveryBucket({ status: 'proposed', outcome: 'unknown' })).toBe('candidates');
    expect(mapRecoveryBucket({ status: 'pending', outcome: 'unknown' })).toBe('pending');
    const r = summarizeRecoveries(feedsFixture().recoveries);
    expect(r.buckets.find((b) => b.bucket === 'completed')?.count).toBe(1);
    expect(r.buckets.find((b) => b.bucket === 'failed')?.count).toBe(1);
    expect(r.otherStatuses).toEqual([{ status: 'weird/unknown', count: 1 }]);
    expect(RECOVERY_BUCKETS).toHaveLength(5);
    expect(summarizeRecoveries(null).buckets.every((b) => b.count === null)).toBe(true);
  });
});

describe('Readiness / Continuity — 연결만, 계산/추론 없음', () => {
  it('준비 5영역 관측 여부 + 커버리지 수치 부재 정직', () => {
    const r = summarizeReadiness(feedsFixture());
    expect(r).toHaveLength(READINESS_AREAS.length);
    expect(r.every((e) => e.observed)).toBe(true);
    expect(r.find((e) => e.area === 'detection')?.note).toContain('계측 부재');
    expect(summarizeReadiness(emptyRecoveryFeeds()).every((e) => !e.observed)).toBe(true);
  });

  it('연속성 4영역 — executive 는 전용 피드 부재로 항상 미관측', () => {
    const c = summarizeContinuity(feedsFixture());
    expect(c).toHaveLength(CONTINUITY_AREAS.length);
    expect(c.find((e) => e.area === 'service')?.level).toBe('healthy'); // 38/40=95%
    expect(c.find((e) => e.area === 'operational')?.level).toBe('healthy'); // 미복구 0
    expect(c.find((e) => e.area === 'executive')?.level).toBe('insufficient_data');
    expect(summarizeContinuity(emptyRecoveryFeeds()).every((e) => e.level === 'insufficient_data')).toBe(true);
  });
});

describe('Recovery Analytics — 측정된 기록만, 불가 시 null', () => {
  it('성공률/추정 평균/Incident 지속·빈도/추세 집계', () => {
    const a = computeRecoveryAnalytics(feedsFixture());
    expect(a.recoverySuccessRatePct).toBe(50); // success 1 / (1+1)
    expect(a.avgRecoveryEstimateMin).toBe(60); // (30+90+60)/3
    expect(a.avgIncidentDurationMin).toBe(45); // (60+30)/2
    expect(a.incidentPerDay).toBe(1.5); // 3건 / 2일
    expect(a.incidentTrend).toBe('insufficient_data'); // 일 단위 표본 2(<4)
  });

  it('미관측/분모 0 이면 null (조작 없음)', () => {
    const a = computeRecoveryAnalytics(emptyRecoveryFeeds());
    expect(a.recoverySuccessRatePct).toBeNull();
    expect(a.avgRecoveryEstimateMin).toBeNull();
    expect(a.avgIncidentDurationMin).toBeNull();
    expect(a.incidentPerDay).toBeNull();
    const unknownOnly = computeRecoveryAnalytics({
      ...emptyRecoveryFeeds(),
      recoveries: [{ id: 'r', recovery_code: 'R', strategy_type: 's', status: 'proposed', outcome: 'unknown', validation_status: 'p', recovery_time_estimate_min: null, created_at: '2026-07-01T00:00:00Z' }],
    });
    expect(unknownOnly.recoverySuccessRatePct).toBeNull(); // 결과 미기록 건은 분모 제외
  });
});

describe('Overview / Relationships / Quality / Summary / 금지 목록', () => {
  it('카드 8필드 관측값 기반', () => {
    const { card } = buildResilienceOverview(feedsFixture());
    expect(card.operationalStability).toBe('healthy');
    expect(card.recoveryHealth).toBe('attention'); // 성공률 50
    expect(card.activeIncidents).toBe(1);
    expect(card.recoveryProgressPct).toBe(20); // completed 1/5
    expect(card.incidentReadiness).toBe(5);
    expect(card.executiveConfidencePct).toBe(100);
    expect(card.recoveryRisks).toBe(2); // failed 1 + open 1
  });

  it('전부 미관측이면 insufficient_data/null', () => {
    const { card } = buildResilienceOverview(emptyRecoveryFeeds());
    expect(card.operationalStability).toBe('insufficient_data');
    expect(card.recoveryHealth).toBe('insufficient_data');
    expect(card.activeIncidents).toBeNull();
    expect(card.recoveryProgressPct).toBeNull();
    expect(card.recoveryRisks).toBeNull();
    expect(card.executiveConfidencePct).toBe(0);
  });

  it('관계 6단계/5연결 — executive 단계는 별도 저장소 없음 정직', () => {
    expect(RECOVERY_RELATIONSHIP_FLOW).toHaveLength(6);
    expect(RECOVERY_RELATIONSHIP_EDGES).toHaveLength(5);
    const rel = buildRecoveryRelationships(feedsFixture());
    expect(rel.find((r) => r.stage === 'recovery')?.observed).toBe(true);
    expect(rel.find((r) => r.stage === 'executive')?.observed).toBe(false);
  });

  it('Quality — 미관측 insufficient + 판정 영역 포함', () => {
    const q = assessResilienceQuality(feedsFixture());
    expect(q.find((e) => e.area === 'recovery_health')?.level).toBe('attention');
    expect(assessResilienceQuality(emptyRecoveryFeeds()).filter((e) => e.level === 'insufficient_data').length).toBe(8);
  });

  it('요약 5줄 이내 + 복구 실행 금지 문구, 미관측 정직', () => {
    const lines = buildRecoverySummaryLines({ recoverySuccessRatePct: 90, pendingRecoveries: 2, operationalStability: 'healthy', criticalRecoveryRisks: 0 });
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('안정적');
    expect(lines[2]).toBe('Operational Stability는 Healthy 상태입니다.');
    expect(lines[3]).toBe('새로운 Critical Recovery Risk는 관측되지 않았습니다.');
    expect(lines[4]).toContain('복구를 실행하지 않습니다');
    const none = buildRecoverySummaryLines({ recoverySuccessRatePct: null, pendingRecoveries: null, operationalStability: 'insufficient_data', criticalRecoveryRisks: null });
    expect(none[0]).toContain('판정하지 않습니다');
    expect(none[1]).toContain('관측되지 않았습니다');
  });

  it('금지 9종 + automatic_* 차단', () => {
    expect(RECOVERY_BLOCKED_ACTIONS).toHaveLength(9);
    for (const a of RECOVERY_BLOCKED_ACTIONS) expect(isBlockedRecoveryAction(a)).toBe(true);
    expect(isBlockedRecoveryAction('view_recovery')).toBe(false);
  });
});
