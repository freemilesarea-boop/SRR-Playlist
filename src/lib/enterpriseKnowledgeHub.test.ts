import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_BLOCKED_ACTIONS, KNOWLEDGE_RELATIONSHIP_EDGES, KNOWLEDGE_RELATIONSHIP_FLOW,
  KNOWLEDGE_SOURCES,
  assessKnowledgeQuality, buildKnowledgeOverview, buildKnowledgeRelationships,
  buildKnowledgeSummaryLines, emptyKnowledgeFeeds, isBlockedKnowledgeAction,
  normalizeKnowledgeItems, searchKnowledge,
  type KnowledgeFeeds,
} from './enterpriseKnowledgeHub';

function feedsFixture(): KnowledgeFeeds {
  return {
    actionHistory: [
      { id: 'a1', command_type: 'decision_approve', status: 'success', reason: 'settlement 승인 근거', requested_at: '2026-07-19T03:00:00Z' },
      { id: 'a2', command_type: 'executive_review', status: 'success', reason: 'store offline 검토', requested_at: '2026-07-19T02:00:00Z' },
      { id: 'a3', command_type: 'force_store_resync', status: 'success', reason: null, requested_at: '2026-07-19T01:00:00Z' },
    ],
    policies: [
      { id: 'p1', policy_code: 'POL-1', domain: 'financial', title: 'Settlement 검증 정책', status: 'active', created_at: '2026-07-18T00:00:00Z' },
      { id: 'p2', policy_code: 'POL-2', domain: 'security', title: '접근 통제', status: 'archived', created_at: '2026-07-17T00:00:00Z' },
    ],
    incidents: [
      { id: 'i1', incident_code: 'INC-1', incident_type: 'store_offline', severity: 'high', status: 'resolved', detected_at: '2026-07-16T00:00:00Z', resolved_at: '2026-07-16T01:00:00Z', evidence: [{}] },
    ],
    recoveries: [
      { id: 'r1', recovery_code: 'REC-1', strategy_type: 'restart', status: 'validated', description: 'store offline 복구', created_at: '2026-07-16T02:00:00Z' },
    ],
    accessReviews: [
      { id: 'v1', review_code: 'AR-1', review_scope: 'admin', review_status: 'approved', created_at: '2026-07-15T00:00:00Z' },
    ],
    execRecommendations: [
      { id: 'e1', rec_code: 'ER-1', category: 'strategy', title: 'Store 확장 검토', status: 'proposed', created_at: '2026-07-14T00:00:00Z', evidence: [{}, {}] },
    ],
  };
}

describe('Knowledge 정규화 — 변환만, 생성 없음', () => {
  it('6개 소스로 정규화하고 최신순 정렬한다', () => {
    const { items, unobservedSources } = normalizeKnowledgeItems(feedsFixture());
    expect(unobservedSources).toEqual([]);
    // audit 3 + decision 1 + executive(감사 1 + 0503 1) + policy 2 + incident(1+1) + review 1 = 11
    expect(items).toHaveLength(11);
    expect(items[0].source).toBe('audit'); // 가장 최신 requested_at
    const inc = items.find((i) => i.id === 'incident-i1');
    expect(inc?.evidenceCount).toBe(1);
    const dec = items.find((i) => i.source === 'decision');
    expect(dec?.detail).toContain('settlement');
  });

  it('전 피드 미관측이면 항목 0 + 미관측 소스 6종', () => {
    const { items, unobservedSources } = normalizeKnowledgeItems(emptyKnowledgeFeeds());
    expect(items).toHaveLength(0);
    expect(unobservedSources).toEqual([...KNOWLEDGE_SOURCES]);
  });
});

describe('Knowledge Overview — Null→0 금지', () => {
  it('소스별 인덱스 수와 커버리지를 집계한다', () => {
    const card = buildKnowledgeOverview(feedsFixture());
    expect(card.totalKnowledge).toBe(11);
    expect(card.decisionsIndexed).toBe(1);
    expect(card.incidentsIndexed).toBe(2);
    expect(card.policiesIndexed).toBe(2);
    expect(card.knowledgeCoveragePct).toBe(100);
  });

  it('전부 미관측이면 전 필드 null + 커버리지 0', () => {
    const card = buildKnowledgeOverview(emptyKnowledgeFeeds());
    expect(card.totalKnowledge).toBeNull();
    expect(card.decisionsIndexed).toBeNull();
    expect(card.auditRecords).toBeNull();
    expect(card.knowledgeCoveragePct).toBe(0);
  });
});

describe('Knowledge Search — 기존 데이터 부분 문자열 매칭(엔진 아님)', () => {
  it('대소문자 무시 검색 + 소스별 카운트', () => {
    const { items } = normalizeKnowledgeItems(feedsFixture());
    const r = searchKnowledge(items, 'STORE');
    expect(r.totalMatches).toBeGreaterThanOrEqual(3); // executive 검토 + incident + recovery + exec reco
    expect(r.countsBySource.find((c) => c.source === 'incident')?.count).toBe(2);
    expect(r.note).toContain('신규 검색 엔진');
  });

  it('소스 필터가 적용된다', () => {
    const { items } = normalizeKnowledgeItems(feedsFixture());
    const r = searchKnowledge(items, 'store', 'incident');
    expect(r.matches.every((m) => m.source === 'incident')).toBe(true);
  });

  it('빈 검색어는 결과를 생성하지 않는다', () => {
    const { items } = normalizeKnowledgeItems(feedsFixture());
    const r = searchKnowledge(items, '   ');
    expect(r.totalMatches).toBe(0);
    expect(r.matches).toHaveLength(0);
  });
});

describe('AI Knowledge Summary — 5줄 이내, 지식 조작 금지', () => {
  it('검색 결과 기반 소스별 요약을 생성한다', () => {
    const { items } = normalizeKnowledgeItems(feedsFixture());
    const lines = buildKnowledgeSummaryLines(searchKnowledge(items, 'store'));
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines.some((l) => l.includes('Incident'))).toBe(true);
  });

  it('일치 없음/검색어 없음은 정직하게 서술한다', () => {
    const { items } = normalizeKnowledgeItems(feedsFixture());
    expect(buildKnowledgeSummaryLines(searchKnowledge(items, 'zzz-none'))[0]).toContain('지어내지 않습니다');
    expect(buildKnowledgeSummaryLines(searchKnowledge(items, ''))[0]).toContain('생성하지 않습니다');
  });
});

describe('Relationships / Quality / 금지 목록', () => {
  it('관계 흐름 6단계/5연결 — knowledge 단계는 별도 저장소 없음(정직)', () => {
    expect(KNOWLEDGE_RELATIONSHIP_FLOW).toHaveLength(6);
    expect(KNOWLEDGE_RELATIONSHIP_EDGES).toHaveLength(5);
    const rel = buildKnowledgeRelationships(feedsFixture());
    expect(rel.find((r) => r.stage === 'incident')?.observed).toBe(true);
    expect(rel.find((r) => r.stage === 'knowledge')?.observed).toBe(false);
    expect(buildKnowledgeRelationships(emptyKnowledgeFeeds()).filter((r) => r.observed)).toHaveLength(0);
  });

  it('Quality: 미관측 insufficient / 0건 partial / 전건 보관 archived / 그 외 available', () => {
    const q = assessKnowledgeQuality(feedsFixture());
    expect(q.find((e) => e.source === 'policies_0512')?.level).toBe('available');
    expect(q.find((e) => e.source === 'policies_0512')?.archivedCount).toBe(1);
    const empty = assessKnowledgeQuality(emptyKnowledgeFeeds());
    expect(empty.every((e) => e.level === 'insufficient_data')).toBe(true);
    const zero = assessKnowledgeQuality({ ...emptyKnowledgeFeeds(), incidents: [] });
    expect(zero.find((e) => e.source === 'incidents_0502')?.level).toBe('partial');
    const archived = assessKnowledgeQuality({
      ...emptyKnowledgeFeeds(),
      policies: [{ id: 'p', policy_code: 'P', domain: 'security', title: 't', status: 'archived', created_at: '2026-01-01T00:00:00Z' }],
    });
    expect(archived.find((e) => e.source === 'policies_0512')?.level).toBe('archived');
  });

  it('금지 8종 + automatic_* 차단', () => {
    expect(KNOWLEDGE_BLOCKED_ACTIONS).toHaveLength(8);
    for (const a of KNOWLEDGE_BLOCKED_ACTIONS) expect(isBlockedKnowledgeAction(a)).toBe(true);
    expect(isBlockedKnowledgeAction('search')).toBe(false);
  });
});
