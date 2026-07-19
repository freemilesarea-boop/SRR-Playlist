import { describe, expect, it } from 'vitest';
import {
  BLOCKED_EXECUTIVE_ACTIONS, EXECUTIVE_COMMAND_SUPPORT_MATRIX, EXECUTIVE_FEED_KEYS,
  buildAdvisorBrief, buildExecutiveActionQueue, buildExecutiveKpis, buildExecutiveSummaryCard,
  computeEnterpriseHealth, computeLatestMonthlyCost, computeObservationCoverage,
  deriveExecutiveAlerts, deriveObservedHealthDomains, emptyExecutiveFeeds, isBlockedExecutiveAction,
  mergeExecutiveTimeline, numAt, validateExecutiveAuditAction, validateExecutiveRequest,
  type ExecutiveFeeds,
} from './executiveCommandCenter';

function feedsFixture(): ExecutiveFeeds {
  return {
    ...emptyExecutiveFeeds(),
    revenue: { today: 120000, month: 3400000 },
    revenueForecast: { current_mrr: 900000, arr_forecast: 10800000, subs_this_month: 12, subs_last_month: 9 },
    revenueBreakdown: { churn: { churn_numerator: 2, churn_denominator: 40, failed_payments: 3 } },
    artist: { total_artists: 210, active_artists: 80, pending: 25, rejected: 4 },
    artistBreakdown: { tracks: { total: 5400, month: 60 } },
    streaming: { heartbeat_sessions: 33, pb_start: 200, pb_complete: 180, pb_error: 6 },
    noc: { total_stores: 40, online_stores: 36, offline_stores: 4, today_incidents: 2, today_recovered: 2, heartbeat_errors: 0, player_errors: 1 },
    settlementKpi: { month_paid_total: 500000, month_payable_total: 250000, held_count: 0 },
    costSnapshots: [
      { period_start: '2026-06-01', estimated_cost: 100 },
      { period_start: '2026-07-01', estimated_cost: 300 },
      { period_start: '2026-07-08', estimated_cost: 200 },
    ],
    actionHistory: [{ status: 'pending' }, { status: 'running' }, { status: 'success' }],
  };
}

describe('KPI aggregation (Null→0 금지)', () => {
  it('관측된 피드는 observed 로, 미관측 피드는 insufficient_data 로 노출한다', () => {
    const kpis = buildExecutiveKpis(feedsFixture());
    const byKey = Object.fromEntries(kpis.map((k) => [k.key, k]));
    expect(byKey.today_revenue.value).toBe(120000);
    expect(byKey.mrr.status).toBe('observed');
    expect(byKey.subscription_growth.value).toBe(3);
    expect(byKey.churn.value).toBe(5);
    expect(byKey.playback_success.value).toBe(90);
    // resilience/selfHealing 등 미관측 항목은 null 유지
    expect(byKey.queue_health.value).toBeNull();
    expect(byKey.queue_health.status).toBe('insufficient_data');
  });

  it('전부 미관측이면 23개 KPI(스펙 5그룹) 모두 insufficient_data (0 조작 없음)', () => {
    const kpis = buildExecutiveKpis(emptyExecutiveFeeds());
    expect(kpis).toHaveLength(23);
    expect(kpis.every((k) => k.value === null && k.status === 'insufficient_data')).toBe(true);
  });

  it('재생 표본이 적으면 playback_success 는 sample_too_small 로 판정 보류', () => {
    const feeds = { ...feedsFixture(), streaming: { pb_start: 5, pb_complete: 5, pb_error: 0 } };
    const kpi = buildExecutiveKpis(feeds).find((k) => k.key === 'playback_success');
    expect(kpi?.value).toBeNull();
    expect(kpi?.note).toContain('sample_too_small');
  });

  it('monthly_cost 는 최신 기간 스냅샷 합계만 사용한다', () => {
    expect(computeLatestMonthlyCost(feedsFixture().costSnapshots).total).toBe(500);
    expect(computeLatestMonthlyCost(null).total).toBeNull();
    expect(computeLatestMonthlyCost([]).total).toBeNull();
  });

  it('numAt 은 유한 숫자만 반환한다', () => {
    expect(numAt({ a: { b: 3 } }, 'a', 'b')).toBe(3);
    expect(numAt({ a: { b: 'x' } }, 'a', 'b')).toBeNull();
    expect(numAt(null, 'a')).toBeNull();
    expect(numAt({ a: Number.NaN }, 'a')).toBeNull();
  });
});

describe('Alert Center', () => {
  it('관측값 기반 규칙으로 우선순위 정렬된 Alert 를 생성한다', () => {
    const { alerts, unobservedCategories } = deriveExecutiveAlerts(feedsFixture());
    const keys = alerts.map((a) => a.key);
    expect(keys).toContain('stores_offline');
    expect(keys).toContain('artist_approval_backlog');
    expect(keys).toContain('failed_payments');
    // security/compliance 는 실측 피드 미연결 — 조작 없이 미관측 보고
    expect(unobservedCategories).toContain('security');
    expect(unobservedCategories).toContain('compliance');
    const ranks = alerts.map((a) => ['critical', 'high', 'medium', 'low'].indexOf(a.priority));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('offline 비율 50% 이상은 critical', () => {
    const feeds = { ...emptyExecutiveFeeds(), noc: { total_stores: 10, offline_stores: 6 } };
    const { alerts } = deriveExecutiveAlerts(feeds);
    expect(alerts.find((a) => a.key === 'stores_offline')?.priority).toBe('critical');
  });

  it('미관측 피드에서는 Alert 를 조작 생성하지 않는다', () => {
    const { alerts, observedCategories } = deriveExecutiveAlerts(emptyExecutiveFeeds());
    expect(alerts).toHaveLength(0);
    expect(observedCategories).toHaveLength(0);
  });
});

describe('Enterprise Health (과단정 방지)', () => {
  it('관측 도메인 <4 이면 overall insufficient_data', () => {
    const h = computeEnterpriseHealth({ observedDomains: ['platform', 'music'], alerts: [] });
    expect(h.overall).toBe('insufficient_data');
    expect(h.overallScore).toBeNull();
  });

  it('미관측 도메인이 있으면 excellent 승격이 차단된다(healthy 상한)', () => {
    const h = computeEnterpriseHealth({
      observedDomains: ['business', 'platform', 'operations', 'financial', 'music', 'infrastructure'],
      alerts: [],
    });
    expect(h.overall).toBe('healthy');
    expect(h.capped).toBe(true);
    expect(h.unobservedDomains).toEqual(['security', 'compliance']);
  });

  it('critical 도메인이 있으면 overall 은 최대 warning', () => {
    const h = computeEnterpriseHealth({
      observedDomains: [...deriveObservedHealthDomains(feedsFixture()), 'security', 'compliance'],
      alerts: [
        { category: 'platform', priority: 'critical' },
        { category: 'platform', priority: 'critical' },
      ],
    });
    expect(h.domains.find((d) => d.domain === 'platform')?.result).toBe('critical');
    expect(['warning', 'critical']).toContain(h.overall);
  });

  it('deriveObservedHealthDomains 는 security/compliance 를 관측으로 승격하지 않는다', () => {
    const observed = deriveObservedHealthDomains(feedsFixture());
    expect(observed).not.toContain('security');
    expect(observed).not.toContain('compliance');
    expect(observed).toContain('platform');
    expect(deriveObservedHealthDomains(emptyExecutiveFeeds())).toHaveLength(0);
  });
});

describe('Executive Timeline', () => {
  it('이종 소스를 시각 내림차순으로 병합하고 잘못된 timestamp 는 정직하게 drop 집계', () => {
    const merged = mergeExecutiveTimeline([
      { source: 'action', events: [{ at: '2026-07-19T09:10:00Z', label: 'New Artist Approved' }, { at: null, label: 'broken' }] },
      { source: 'settlement', events: [{ at: '2026-07-19T09:18:00Z', label: 'Settlement Generated' }] },
      { source: 'noc', events: [{ at: '2026-07-19T09:42:00Z', label: 'Store Offline' }, { at: 'not-a-date', label: 'bad' }] },
    ]);
    expect(merged.events.map((e) => e.label)).toEqual(['Store Offline', 'Settlement Generated', 'New Artist Approved']);
    expect(merged.droppedInvalid).toBe(2);
    expect(merged.observedSources).toEqual(['action', 'noc', 'settlement']);
  });

  it('동시각 이벤트는 label 사전순으로 결정적 정렬된다', () => {
    const merged = mergeExecutiveTimeline([
      { source: 's', events: [{ at: '2026-07-19T09:00:00Z', label: 'b' }, { at: '2026-07-19T09:00:00Z', label: 'a' }] },
    ]);
    expect(merged.events.map((e) => e.label)).toEqual(['a', 'b']);
  });
});

describe('Human Approval / Action Queue — AI 는 승인하지 않는다', () => {
  it('요청 유형은 review/approval/reject/feedback 만 허용된다', () => {
    expect(validateExecutiveRequest('review').ok).toBe(true);
    expect(validateExecutiveRequest('feedback').ok).toBe(true);
    expect(validateExecutiveRequest('execute').ok).toBe(false);
    expect(validateExecutiveRequest('automatic_approval').ok).toBe(false);
  });

  it('금지 목록과 automatic_* 은 감사 기록 대상조차 아니다', () => {
    for (const blocked of BLOCKED_EXECUTIVE_ACTIONS) {
      expect(isBlockedExecutiveAction(blocked)).toBe(true);
    }
    expect(validateExecutiveAuditAction('automatic_payment').ok).toBe(false);
    expect(validateExecutiveAuditAction('export').ok).toBe(true);
    expect(validateExecutiveAuditAction('report').ok).toBe(true);
  });

  it('큐는 우선순위→건수→키 순으로 정렬하고 미관측 항목은 제외 목록으로 공개한다', () => {
    const r = buildExecutiveActionQueue([
      { key: 'settlement', label: 'Review Settlement', count: 2, priority: 'high', requestType: 'review' },
      { key: 'artist', label: 'Review New Artist', count: 8, priority: 'medium', requestType: 'approval' },
      { key: 'incident', label: 'Review Incident', count: 1, priority: 'critical', requestType: 'review' },
      { key: 'contract', label: 'Review Contract', count: null, priority: 'high', requestType: 'review' },
      { key: 'policy', label: 'Review Enterprise Policy', count: 0, priority: 'low', requestType: 'review' },
    ]);
    expect(r.queue.map((q) => q.key)).toEqual(['incident', 'settlement', 'artist']);
    expect(r.excludedUnobserved).toEqual(['contract']);
    expect(r.totalPending).toBe(11);
  });
});

describe('AI Executive Advisor — 요약 ≠ 판단', () => {
  it('정확히 3줄을 결정적으로 생성한다', () => {
    const brief = buildAdvisorBrief({
      overall: 'healthy', criticalAlerts: 0, todayApprovedArtists: 8,
      pendingSettlements: 250000, offlineStores: 1, incidents: 1, recovered: 1,
    });
    expect(brief).toHaveLength(3);
    expect(brief[0]).toBe('Enterprise는 정상 운영 중입니다.');
    expect(brief[2]).toContain('Recovery 는 완료');
  });

  it('미관측 값은 수치를 지어내지 않고 미관측으로 서술한다', () => {
    const brief = buildAdvisorBrief({
      overall: 'insufficient_data', criticalAlerts: 0, todayApprovedArtists: null,
      pendingSettlements: null, offlineStores: null, incidents: null, recovered: null,
    });
    expect(brief[0]).toContain('부족');
    expect(brief[1]).toContain('관측되지 않았습니다');
    expect(brief[2]).toBe('Recovery 상태는 관측되지 않았습니다.');
  });
});

describe('Honest Boundary — Coverage/Summary Card/Support Matrix', () => {
  it('AI Confidence 는 관측 커버리지이며 미관측 피드 목록을 공개한다', () => {
    const empty = computeObservationCoverage(emptyExecutiveFeeds());
    expect(empty.level).toBe('insufficient_data');
    expect(empty.missing).toHaveLength(EXECUTIVE_FEED_KEYS.length);
    const partial = computeObservationCoverage(feedsFixture());
    expect(partial.observed).toBe(10);
    expect([...partial.missing].sort()).toEqual(['business', 'resilience', 'selfHealing']);
    expect(partial.level).toBe('moderate');
  });

  it('Summary Card 는 미관측 플랫폼 상태를 "미관측" 으로 표기한다', () => {
    const feeds = emptyExecutiveFeeds();
    const health = computeEnterpriseHealth({ observedDomains: [], alerts: [] });
    const card = buildExecutiveSummaryCard({ feeds, health, alerts: [], queueTotal: null });
    expect(card.platformStatus).toBe('미관측');
    expect(card.todayKpi).toBeNull();
    expect(card.enterpriseHealth).toBe('insufficient_data');
    expect(card.aiConfidence).toBe(0);
  });

  it('Support Matrix — unavailable 은 금지 목록 1:1, 신규 엔진 생성 없음', () => {
    const unavailable = EXECUTIVE_COMMAND_SUPPORT_MATRIX.filter((e) => e.level === 'unavailable').map((e) => e.feature);
    expect(unavailable.sort()).toEqual([...BLOCKED_EXECUTIVE_ACTIONS].sort());
    expect(EXECUTIVE_COMMAND_SUPPORT_MATRIX.filter((e) => e.level === 'human_review_only')).toHaveLength(4);
    expect(EXECUTIVE_COMMAND_SUPPORT_MATRIX.filter((e) => e.level === 'insufficient_data')).toHaveLength(6);
  });
});
