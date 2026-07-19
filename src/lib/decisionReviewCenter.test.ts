import { describe, expect, it } from 'vitest';
import {
  AI_OVERSIGHT_ALLOWED, AI_OVERSIGHT_FORBIDDEN, DECISION_BLOCKED_ACTIONS,
  DECISION_OVERSIGHT_MATRIX, HUMAN_DECISION_ACTIONS,
  buildDecisionDetail, buildDecisionInbox, buildDecisionSummaryLines, filterDecisionHistory,
  isAiCapability, isBlockedDecisionAction, normalizeRecommendations, summarizeDecisionAnalytics,
  validateHumanDecisionAction,
  type DecisionAuditRow, type DecisionInboxItem,
} from './decisionReviewCenter';

const INBOX: DecisionInboxItem[] = [
  { key: 'artist', label: 'New Artist Review', type: 'music', priority: 'medium', count: 8 },
  { key: 'incident', label: 'Incident Review', type: 'operations', priority: 'critical', count: 1 },
  { key: 'settlement', label: 'Settlement Review', type: 'financial', priority: 'high', count: 2 },
  { key: 'policy', label: 'Policy Review', type: 'policy', priority: 'low', count: null },
  { key: 'security', label: 'Security Review', type: 'security', priority: 'high', count: null },
  { key: 'zero', label: 'Zero Item', type: 'review', priority: 'low', count: 0 },
];

describe('Decision Inbox', () => {
  it('우선순위→건수→키 정렬, 미관측 항목은 제외 목록으로 공개(0 조작 없음)', () => {
    const r = buildDecisionInbox(INBOX);
    expect(r.queue.map((q) => q.key)).toEqual(['incident', 'settlement', 'artist']);
    expect(r.excludedUnobserved).toEqual(['policy', 'security']);
    expect(r.totalPending).toBe(11);
    expect(r.criticalCount).toBe(1);
  });

  it('빈 입력에서는 빈 큐를 반환한다', () => {
    const r = buildDecisionInbox([]);
    expect(r.queue).toHaveLength(0);
    expect(r.totalPending).toBe(0);
  });
});

describe('Human Decision — AI 는 Approve 를 실행하지 않는다', () => {
  it('사람 액션 5종만 허용, 자동/그 외는 거부', () => {
    for (const a of HUMAN_DECISION_ACTIONS) expect(validateHumanDecisionAction(a).ok).toBe(true);
    expect(validateHumanDecisionAction('execute').ok).toBe(false);
    expect(validateHumanDecisionAction('automatic_approval').ok).toBe(false);
    expect(validateHumanDecisionAction('automatic_rejection').ok).toBe(false);
  });

  it('금지 8종과 automatic_* 전부 차단 판정', () => {
    expect(DECISION_BLOCKED_ACTIONS).toHaveLength(8);
    for (const a of DECISION_BLOCKED_ACTIONS) expect(isBlockedDecisionAction(a)).toBe(true);
    expect(isBlockedDecisionAction('automatic_anything')).toBe(true);
  });

  it('AI 는 recommend/explain/summarize/highlight_risk 만 수행 가능', () => {
    for (const a of AI_OVERSIGHT_ALLOWED) expect(isAiCapability(a)).toBe(true);
    for (const a of AI_OVERSIGHT_FORBIDDEN) expect(isAiCapability(a)).toBe(false);
  });
});

describe('Recommendation Center — 기존 원장 통합(재채점 없음)', () => {
  it('4개 소스를 공통 형태로 변환하고 미관측 소스를 공개한다', () => {
    const r = normalizeRecommendations({
      general: [{ id: 'g1', title: 'Store Reco', category: 'store', state: 'active', confidence: 72, evidence: [{}], message: '근거', created_at: '2026-07-19T01:00:00Z' }],
      executive: [{ id: 'e1', title: 'Exec Reco', category: 'strategy', status: 'proposed', confidence: 61, risk_tier: 'medium', evidence: [], summary: '요약', created_at: '2026-07-19T02:00:00Z' }],
      recovery: null,
      playlist: [{ id: 'p1', rule_key: 'rk', recommended_title: 'PL', state: 'proposed', evidence: [{}, {}], reason: '이유', created_at: '2026-07-19T03:00:00Z' }],
    });
    expect(r.unobservedSources).toEqual(['recovery_0502']);
    expect(r.items.map((i) => i.id)).toEqual(['p1', 'e1', 'g1']); // 최신순
    expect(r.items.find((i) => i.id === 'p1')?.confidence).toBeNull(); // 원본에 없으면 조작 금지
    expect(r.items.find((i) => i.id === 'e1')?.risk).toBe('medium');
  });

  it('전 소스 미관측이면 항목 0 + 미관측 4종 공개', () => {
    const r = normalizeRecommendations({ general: null, executive: null, recovery: null, playlist: null });
    expect(r.items).toHaveLength(0);
    expect(r.unobservedSources).toHaveLength(4);
  });
});

describe('Decision Detail — 원본 그대로, 조작 금지', () => {
  it('Confidence/Risk 부재 시 null + 정직 note', () => {
    const { items } = normalizeRecommendations({
      general: null, executive: null, recovery: null,
      playlist: [{ id: 'p1', rule_key: 'rk', state: 'proposed', evidence: [], created_at: '2026-07-19T03:00:00Z' }],
    });
    const d = buildDecisionDetail(items[0]);
    expect(d.confidence).toBeNull();
    expect(d.confidenceNote).toContain('조작하지 않음');
    expect(d.evidencePresent).toBe(false);
    expect(d.humanActions).toEqual(HUMAN_DECISION_ACTIONS);
  });
});

describe('Decision History / Analytics — 0479 감사 기록 기반', () => {
  const rows: DecisionAuditRow[] = [
    { command_type: 'decision_approve', status: 'success', duration_seconds: 120 },
    { command_type: 'decision_approve', status: 'success', duration_seconds: 240 },
    { command_type: 'decision_reject', status: 'success', duration_seconds: 60 },
    { command_type: 'decision_defer', status: 'pending' },
    { command_type: 'decision_escalate', status: 'success' },
    { command_type: 'executive_review', status: 'success' },
    { command_type: 'force_store_resync', status: 'success' },
  ];

  it('decision_* 만 집계하고 평균 시간은 측정된 건만 사용한다', () => {
    const a = summarizeDecisionAnalytics(rows);
    expect(a?.totalDecisions).toBe(5);
    expect(a?.pending).toBe(1);
    expect(a?.approved).toBe(2);
    expect(a?.rejected).toBe(1);
    expect(a?.escalated).toBe(1);
    expect(a?.avgApprovalMinutes).toBe(3);
    expect(a?.avgReviewMinutes).toBe(2.3);
    expect(a?.measuredCount).toBe(3);
  });

  it('감사 피드 미관측이면 집계를 지어내지 않는다(null)', () => {
    expect(summarizeDecisionAnalytics(null)).toBeNull();
    const empty = summarizeDecisionAnalytics([]);
    expect(empty?.totalDecisions).toBe(0);
    expect(empty?.avgReviewMinutes).toBeNull();
  });

  it('filterDecisionHistory 는 decision_* 행만 남긴다', () => {
    expect(filterDecisionHistory(rows)).toHaveLength(5);
    expect(filterDecisionHistory(null)).toEqual([]);
  });
});

describe('AI Decision Summary — 5줄 이내, 미관측 정직 서술', () => {
  it('관측값 기반 5줄 생성', () => {
    const lines = buildDecisionSummaryLines({ totalPending: 4, settlementReviews: 2, playlistReviews: 1, policyReviews: null, criticalCount: 0 });
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('현재 결정 대기 4건.');
    expect(lines[3]).toContain('관측되지 않았습니다');
    expect(lines[4]).toBe('Critical Decision은 없습니다.');
  });

  it('전부 미관측이면 수치를 지어내지 않는다', () => {
    const lines = buildDecisionSummaryLines({ totalPending: null, settlementReviews: null, playlistReviews: null, policyReviews: null, criticalCount: null });
    expect(lines.every((l) => l.includes('관측되지 않았습니다'))).toBe(true);
  });
});

describe('Human Oversight Matrix', () => {
  it('ai_allowed 4종 = AI 허용 목록 1:1, unavailable 8종 = 금지 목록 1:1, human_only 5종', () => {
    const ai = DECISION_OVERSIGHT_MATRIX.filter((e) => e.level === 'ai_allowed').map((e) => e.capability);
    expect(ai.sort()).toEqual([...AI_OVERSIGHT_ALLOWED].sort());
    const unavailable = DECISION_OVERSIGHT_MATRIX.filter((e) => e.level === 'unavailable').map((e) => e.capability);
    expect(unavailable.sort()).toEqual([...DECISION_BLOCKED_ACTIONS].sort());
    const human = DECISION_OVERSIGHT_MATRIX.filter((e) => e.level === 'human_only').map((e) => e.capability);
    expect(human.sort()).toEqual([...HUMAN_DECISION_ACTIONS].sort());
  });
});
