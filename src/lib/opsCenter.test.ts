// Phase AI-OPS-1 — Operations Center 순수 로직 단위 테스트.
// 상태 전이 whitelist · 승인 정책 게이트(자동 승인 없음) · Executive Inbox 우선순위 ·
// Feedback→Learning Signal(자동 반영 없음) · Analytics(표본 부족 insufficient) · Support Matrix.
import { describe, it, expect } from 'vitest';
import {
  canTransition, approvalGate, isExecutiveInboxItem, rankInbox, feedbackToLearningSignal,
  computeReviewAnalytics, opsInputHash, OPS_SOURCES, OPS_SUPPORT, APPROVAL_REQUIRED,
  type OpsItemLike, type ReviewLike,
} from './opsCenter';

describe('상태 전이 whitelist', () => {
  it('허용 전이 · finalized 후 전이 차단(archived 만)', () => {
    expect(canTransition('new', 'reviewing')).toBe(true);
    expect(canTransition('reviewing', 'approved')).toBe(true);
    expect(canTransition('waiting_evidence', 'reviewing')).toBe(true);
    expect(canTransition('approved', 'reviewing')).toBe(false);
    expect(canTransition('approved', 'archived')).toBe(true);
    expect(canTransition('archived', 'new')).toBe(false);
  });
});

describe('승인 정책 게이트 (자동 승인 없음)', () => {
  it('single: 1인 · dual: 서로 다른 2인 필요', () => {
    expect(APPROVAL_REQUIRED.single).toBe(1); expect(APPROVAL_REQUIRED.dual).toBe(2);
    expect(approvalGate({ policy: 'single', distinctApprovers: 1, hasRejection: false }).canFinalize).toBe(true);
    const dual1 = approvalGate({ policy: 'dual', distinctApprovers: 1, hasRejection: false });
    expect(dual1.canFinalize).toBe(false); expect(dual1.missing).toBe(1);
    expect(approvalGate({ policy: 'dual', distinctApprovers: 2, hasRejection: false }).canFinalize).toBe(true);
  });
  it('거절 이력 존재 → finalize 불가', () => {
    expect(approvalGate({ policy: 'single', distinctApprovers: 1, hasRejection: true }).canFinalize).toBe(false);
  });
});

describe('Executive Inbox', () => {
  const item = (over: Partial<OpsItemLike>): OpsItemLike => ({ id: 'a', category: 'opportunity', riskTier: 'low', impact: 'low', status: 'new', createdAt: '2026-07-01', ...over });
  it('High Risk/Impact/Recovery/Strategy 만 Inbox 대상', () => {
    expect(isExecutiveInboxItem(item({ riskTier: 'critical' }))).toBe(true);
    expect(isExecutiveInboxItem(item({ impact: 'high' }))).toBe(true);
    expect(isExecutiveInboxItem(item({ category: 'recovery' }))).toBe(true);
    expect(isExecutiveInboxItem(item({}))).toBe(false);
  });
  it('결정적 우선순위(risk+impact 합산 → 생성순 → id)', () => {
    const ranked = rankInbox([
      item({ id: 'b', riskTier: 'high', impact: 'low' }),
      item({ id: 'a', riskTier: 'critical', impact: 'critical' }),
      item({ id: 'c', riskTier: 'high', impact: 'low' }),
    ]);
    expect(ranked[0].id).toBe('a'); expect(ranked[1].id).toBe('b'); expect(ranked[2].id).toBe('c');
  });
});

describe('Feedback Loop (자동 반영 없음)', () => {
  it('4종 feedback → signal 매핑 + 자동 학습 없음 명시', () => {
    expect(feedbackToLearningSignal('executive_recommendation', 'accurate', 'r').signal).toBe('reinforce');
    expect(feedbackToLearningSignal('x', 'inaccurate', 'r').signal).toBe('contradict');
    expect(feedbackToLearningSignal('x', 'needs_modification', 'r').signal).toBe('refine');
    const s = feedbackToLearningSignal('x', 'insufficient_evidence', 'r');
    expect(s.signal).toBe('evidence_gap'); expect(s.note).toContain('자동 학습 없음');
  });
});

describe('Feedback Analytics', () => {
  const rv = (action: ReviewLike['action'], at: string, fb: ReviewLike['feedbackType'] = null): ReviewLike => ({ action, feedbackType: fb, createdAt: at });
  it('결정 2건 미만 → insufficient(가짜 지표 없음)', () => {
    const a = computeReviewAnalytics([rv('approve', '2026-07-01')]);
    expect(a.approvalRate).toBeNull(); expect(a.aiAccuracyTrend).toBe('insufficient_data');
  });
  it('승인율/거절율 계산 · 추이(전/후 절반 비교)', () => {
    const reviews = [
      rv('reject', '2026-07-01'), rv('reject', '2026-07-02'),
      rv('approve', '2026-07-03'), rv('approve', '2026-07-04'),
    ];
    const a = computeReviewAnalytics(reviews);
    expect(a.approvalRate).toBe(50); expect(a.rejectionRate).toBe(50);
    expect(a.aiAccuracyTrend).toBe('improving');
  });
  it('hold/request_review 는 결정으로 세지 않음 · 수정요청율은 feedback 2건 이상만', () => {
    const a = computeReviewAnalytics([rv('hold', '2026-07-01'), rv('approve', '2026-07-02'), rv('approve', '2026-07-03', 'needs_modification')]);
    expect(a.totalDecisions).toBe(2);
    expect(a.modificationRate).toBeNull();
  });
});

describe('Hash / Source / Support Matrix', () => {
  it('hash 결정적 · Source 6종(기존 테이블 참조)', () => {
    expect(opsInputHash(['a', 1])).toBe(opsInputHash(['a', 1]));
    expect(OPS_SOURCES.length).toBe(6);
  });
  it('Auto Approval/Production Apply = unsupported · Dual = partially(단일 admin 환경) · Feedback = evidence_only', () => {
    expect(OPS_SUPPORT.find((s) => s.key === 'auto_approval')!.status).toBe('unsupported');
    expect(OPS_SUPPORT.find((s) => s.key === 'production_apply')!.status).toBe('unsupported');
    expect(OPS_SUPPORT.find((s) => s.key === 'approval_dual')!.status).toBe('partially_supported');
    expect(OPS_SUPPORT.find((s) => s.key === 'feedback_loop')!.status).toBe('evidence_only');
    expect(OPS_SUPPORT.find((s) => s.key === 'execution_queue')!.status).toBe('evidence_only');
  });
});
