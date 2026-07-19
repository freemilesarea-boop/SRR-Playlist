/**
 * decisionReviewCenter — Enterprise E-3 (Decision & Review Center).
 *
 * Enterprise 전역의 Review/Recommendation/Advisory/Incident/Approval Request/
 * Policy Suggestion 을 통합 관리하는 **Human Decision Layer**.
 * 신규 AI Decision Engine/Recommendation Engine 없음 — 입력은 전부 기존
 * adminApi wrapper 반환값(0479 Action Center / 0481 Recommendation /
 * 0502 Recovery Candidate / 0503 Executive Recommendation / 0484 Playlist Reco)
 * 이며, 이 모듈은 결정적(pure)으로 정렬/통합/집계만 수행한다.
 *
 * 원칙:
 *  - AI 는 결정을 내리지 않는다 — Recommend/Explain/Summarize/Highlight Risk 만 수행.
 *  - Approve/Reject/Request Changes/Escalate/Defer 는 사람의 행위이며,
 *    기록은 기존 0479 레지스트리(command_type = decision_<action>)에 남긴다.
 *  - Confidence/Risk 는 원본 값 그대로 노출 — 없으면 조작하지 않고 null(미관측).
 */
import { isFiniteNumber } from './aiMemory';

// ── 상수 (스펙 1:1) ─────────────────────────────────────────────────────

export const DECISION_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type DecisionPriority = (typeof DECISION_PRIORITIES)[number];

export const DECISION_TYPES = ['review', 'approval', 'policy', 'financial', 'music', 'operations', 'security', 'enterprise'] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

/** 사람이 내릴 수 있는 결정 — AI 는 이 중 어떤 것도 실행하지 않는다. */
export const HUMAN_DECISION_ACTIONS = ['approve', 'reject', 'request_changes', 'escalate', 'defer'] as const;
export type HumanDecisionAction = (typeof HUMAN_DECISION_ACTIONS)[number];

/** AI 가 수행 가능한 것 / 수행하지 않는 것 (Human Oversight). */
export const AI_OVERSIGHT_ALLOWED = ['recommend', 'explain', 'summarize', 'highlight_risk'] as const;
export const AI_OVERSIGHT_FORBIDDEN = ['approve', 'reject', 'execute'] as const;

/** 금지 목록 — 스펙 금지 사항 1:1. */
export const DECISION_BLOCKED_ACTIONS = [
  'automatic_approval', 'automatic_rejection', 'automatic_contract_approval', 'automatic_payment',
  'automatic_merge', 'automatic_deploy', 'automatic_production_apply', 'new_ai_decision_generation',
] as const;

/** 0479 감사 기록용 command_type 접두사 — 신규 감사 테이블 없음. */
export const DECISION_COMMAND_PREFIX = 'decision_';

export function isBlockedDecisionAction(action: string): boolean {
  return (DECISION_BLOCKED_ACTIONS as readonly string[]).includes(action) || action.startsWith('automatic_');
}

/** 사람의 결정 기록 액션 검증 — 5종 외에는 기록조차 거부. */
export function validateHumanDecisionAction(action: string): { ok: boolean; reason: string } {
  if (isBlockedDecisionAction(action)) return { ok: false, reason: '자동 승인/거절/지급/배포는 금지되어 있습니다' };
  if (!(HUMAN_DECISION_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, reason: 'Human Decision 은 approve/reject/request_changes/escalate/defer 만 허용됩니다' };
  }
  return { ok: true, reason: '' };
}

/** AI 수행 가능 여부 — Recommend/Explain/Summarize/Highlight Risk 만 true. */
export function isAiCapability(action: string): boolean {
  return (AI_OVERSIGHT_ALLOWED as readonly string[]).includes(action);
}

// ── Decision Inbox ──────────────────────────────────────────────────────

export interface DecisionInboxItem {
  key: string;
  label: string;
  type: DecisionType;
  priority: DecisionPriority;
  count: number | null; // null = 해당 피드 미관측 (0 조작 금지)
}

const PRIORITY_RANK: Record<DecisionPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function buildDecisionInbox(items: DecisionInboxItem[]): {
  queue: DecisionInboxItem[];
  excludedUnobserved: string[];
  totalPending: number;
  criticalCount: number;
} {
  const queue = items
    .filter((i) => isFiniteNumber(i.count) && (i.count as number) > 0)
    .sort((a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (b.count as number) - (a.count as number) || a.key.localeCompare(b.key));
  return {
    queue,
    excludedUnobserved: items.filter((i) => i.count == null).map((i) => i.key).sort((a, b) => a.localeCompare(b)),
    totalPending: queue.reduce((s, i) => s + (i.count as number), 0),
    criticalCount: queue.filter((i) => i.priority === 'critical').reduce((s, i) => s + (i.count as number), 0),
  };
}

// ── Recommendation Center (기존 4개 원장 통합 — 신규 생성/재계산 없음) ────

export type RecommendationSource = 'general_0481' | 'executive_0503' | 'recovery_0502' | 'playlist_0484';

export interface UnifiedRecommendation {
  id: string;
  source: RecommendationSource;
  title: string;
  category: string;
  status: string;
  confidence: number | null; // 원본 값 그대로 — 없으면 null(조작 금지)
  risk: string | null;
  evidenceCount: number;
  createdAt: string | null;
  reason: string;
}

type LooseRow = Record<string, unknown>;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const evCount = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

/** 기존 Recommendation 원장 4종을 표시용 공통 형태로 변환만 한다 (재채점/재정렬 로직 없음). */
export function normalizeRecommendations(input: {
  general: LooseRow[] | null;   // fetchRecommendationHistory (0481)
  executive: LooseRow[] | null; // fetchExecRecommendations (0503)
  recovery: LooseRow[] | null;  // fetchRecoveryCandidates (0502)
  playlist: LooseRow[] | null;  // fetchPlaylistHistory (0484)
}): { items: UnifiedRecommendation[]; unobservedSources: RecommendationSource[] } {
  const items: UnifiedRecommendation[] = [];
  const unobserved: RecommendationSource[] = [];

  if (input.general == null) unobserved.push('general_0481');
  else for (const r of input.general) items.push({
    id: str(r.id), source: 'general_0481', title: str(r.title, '(제목 없음)'), category: str(r.category, 'general'),
    status: str(r.state, 'unknown'), confidence: isFiniteNumber(r.confidence) ? r.confidence : null,
    risk: null, evidenceCount: evCount(r.evidence), createdAt: strOrNull(r.created_at), reason: str(r.message ?? r.title),
  });

  if (input.executive == null) unobserved.push('executive_0503');
  else for (const r of input.executive) items.push({
    id: str(r.id), source: 'executive_0503', title: str(r.title, '(제목 없음)'), category: str(r.category, 'executive'),
    status: str(r.status, 'unknown'), confidence: isFiniteNumber(r.confidence) ? r.confidence : null,
    risk: strOrNull(r.risk_tier), evidenceCount: evCount(r.evidence), createdAt: strOrNull(r.created_at), reason: str(r.summary ?? r.title),
  });

  if (input.recovery == null) unobserved.push('recovery_0502');
  else for (const r of input.recovery) items.push({
    id: str(r.id), source: 'recovery_0502', title: str(r.recovery_code, '(코드 없음)'), category: str(r.strategy_type, 'recovery'),
    status: str(r.status, 'unknown'), confidence: isFiniteNumber(r.confidence) ? r.confidence : null,
    risk: strOrNull(r.business_impact), evidenceCount: evCount(r.evidence), createdAt: strOrNull(r.created_at), reason: str(r.description ?? ''),
  });

  if (input.playlist == null) unobserved.push('playlist_0484');
  else for (const r of input.playlist) items.push({
    id: str(r.id), source: 'playlist_0484', title: str(r.recommended_title ?? r.rule_key, '(제목 없음)'), category: 'playlist',
    status: str(r.state, 'unknown'), confidence: null, risk: null,
    evidenceCount: evCount(r.evidence), createdAt: strOrNull(r.created_at), reason: str(r.reason ?? ''),
  });

  // 표시 순서만 결정적으로: 최신순 → id
  items.sort((a, b) => {
    const ta = a.createdAt == null ? 0 : Date.parse(a.createdAt);
    const tb = b.createdAt == null ? 0 : Date.parse(b.createdAt);
    return tb - ta || a.id.localeCompare(b.id);
  });
  return { items, unobservedSources: unobserved };
}

// ── Decision Detail (Source/Reason/Evidence/Related/Confidence/Risk/Human Action) ──

export interface DecisionDetail {
  source: RecommendationSource;
  reason: string;
  evidenceCount: number;
  evidencePresent: boolean;
  relatedData: string;
  confidence: number | null;
  confidenceNote: string;
  risk: string | null;
  riskNote: string;
  humanActions: readonly HumanDecisionAction[];
}

export function buildDecisionDetail(rec: UnifiedRecommendation): DecisionDetail {
  return {
    source: rec.source,
    reason: rec.reason || '(사유 미기록 — 원본 그대로)',
    evidenceCount: rec.evidenceCount,
    evidencePresent: rec.evidenceCount > 0,
    relatedData: `category=${rec.category} · status=${rec.status}`,
    confidence: rec.confidence,
    confidenceNote: rec.confidence == null ? '원본에 Confidence 없음 — 조작하지 않음' : '원본 기록값 그대로 (재채점 없음)',
    risk: rec.risk,
    riskNote: rec.risk == null ? '원본에 Risk 표기 없음 — 조작하지 않음' : '원본 기록값 그대로',
    humanActions: HUMAN_DECISION_ACTIONS,
  };
}

// ── Decision History / Analytics (0479 감사 기록 기반) ──────────────────

export interface DecisionAuditRow {
  command_type: string;
  status: string;
  reason?: string | null;
  requested_by_name?: string | null;
  requested_at?: string | null;
  duration_seconds?: number | null;
}

export interface DecisionAnalytics {
  totalDecisions: number;
  pending: number;
  approved: number;
  rejected: number;
  deferred: number;
  escalated: number;
  requestChanges: number;
  avgReviewMinutes: number | null;   // decision_* 완료건 duration 평균 — 측정 불가 시 null
  avgApprovalMinutes: number | null; // decision_approve 완료건 평균
  measuredCount: number;
}

const isDecisionRow = (r: DecisionAuditRow) => r.command_type.startsWith(DECISION_COMMAND_PREFIX);

function avgMinutes(rows: DecisionAuditRow[]): { avg: number | null; n: number } {
  const secs = rows.map((r) => r.duration_seconds).filter((s): s is number => isFiniteNumber(s));
  if (secs.length === 0) return { avg: null, n: 0 };
  return { avg: Math.round((secs.reduce((a, b) => a + b, 0) / secs.length / 60) * 10) / 10, n: secs.length };
}

export function summarizeDecisionAnalytics(rows: DecisionAuditRow[] | null): DecisionAnalytics | null {
  if (rows == null) return null; // 감사 피드 미관측 — 집계를 지어내지 않음
  const decisions = rows.filter(isDecisionRow);
  const byAction = (action: HumanDecisionAction) =>
    decisions.filter((r) => r.command_type === `${DECISION_COMMAND_PREFIX}${action}` && r.status === 'success').length;
  const completed = decisions.filter((r) => r.status === 'success');
  const review = avgMinutes(completed);
  const approval = avgMinutes(completed.filter((r) => r.command_type === `${DECISION_COMMAND_PREFIX}approve`));
  return {
    totalDecisions: decisions.length,
    pending: decisions.filter((r) => r.status === 'pending' || r.status === 'running').length,
    approved: byAction('approve'),
    rejected: byAction('reject'),
    deferred: byAction('defer'),
    escalated: byAction('escalate'),
    requestChanges: byAction('request_changes'),
    avgReviewMinutes: review.avg,
    avgApprovalMinutes: approval.avg,
    measuredCount: review.n,
  };
}

export function filterDecisionHistory<T extends DecisionAuditRow>(rows: T[] | null): T[] {
  return (rows ?? []).filter(isDecisionRow);
}

// ── AI Decision Summary (5줄 이내 결정적 — 판단/결정 아님) ──────────────

export function buildDecisionSummaryLines(input: {
  totalPending: number | null;
  settlementReviews: number | null;
  playlistReviews: number | null;
  policyReviews: number | null;
  criticalCount: number | null;
}): string[] {
  const lines: string[] = [];
  lines.push(input.totalPending == null ? '결정 대기 건수는 관측되지 않았습니다.' : `현재 결정 대기 ${input.totalPending}건.`);
  lines.push(input.settlementReviews == null ? 'Settlement 검토 건수는 관측되지 않았습니다.' : `Settlement 검토 ${input.settlementReviews}건.`);
  lines.push(input.playlistReviews == null ? 'Playlist 검토 건수는 관측되지 않았습니다.' : `Playlist 검토 ${input.playlistReviews}건.`);
  lines.push(input.policyReviews == null ? 'Policy 검토 피드는 관측되지 않았습니다.' : `Policy 검토 ${input.policyReviews}건.`);
  if (input.criticalCount == null) lines.push('Critical Decision 상태는 관측되지 않았습니다.');
  else if (input.criticalCount === 0) lines.push('Critical Decision은 없습니다.');
  else lines.push(`Critical Decision ${input.criticalCount}건 — 사람 확인이 필요합니다.`);
  return lines.slice(0, 5);
}

// ── Human Oversight Matrix (정직 고지) ──────────────────────────────────

export interface OversightEntry {
  capability: string;
  level: 'ai_allowed' | 'human_only' | 'unavailable';
  note: string;
}

export const DECISION_OVERSIGHT_MATRIX: OversightEntry[] = [
  { capability: 'recommend', level: 'ai_allowed', note: '기존 Recommendation 원장 통합 표시(신규 생성 없음)' },
  { capability: 'explain', level: 'ai_allowed', note: '원본 Reason/Evidence 그대로 설명' },
  { capability: 'summarize', level: 'ai_allowed', note: '결정 대기 현황 5줄 이내 결정적 요약' },
  { capability: 'highlight_risk', level: 'ai_allowed', note: '원본 Risk 표기 강조(재평가 없음)' },
  { capability: 'approve', level: 'human_only', note: '승인은 사람 — AI 실행 없음' },
  { capability: 'reject', level: 'human_only', note: '거절은 사람 — AI 실행 없음' },
  { capability: 'request_changes', level: 'human_only', note: '변경 요청은 사람' },
  { capability: 'escalate', level: 'human_only', note: '에스컬레이션은 사람' },
  { capability: 'defer', level: 'human_only', note: '보류는 사람' },
  { capability: 'automatic_approval', level: 'unavailable', note: '자동 승인 금지' },
  { capability: 'automatic_rejection', level: 'unavailable', note: '자동 거절 금지' },
  { capability: 'automatic_contract_approval', level: 'unavailable', note: '자동 계약 승인 금지' },
  { capability: 'automatic_payment', level: 'unavailable', note: '자동 지급 금지' },
  { capability: 'automatic_merge', level: 'unavailable', note: '자동 Merge 금지' },
  { capability: 'automatic_deploy', level: 'unavailable', note: '자동 Deploy 금지' },
  { capability: 'automatic_production_apply', level: 'unavailable', note: 'Production Apply 금지' },
  { capability: 'new_ai_decision_generation', level: 'unavailable', note: '새로운 AI Decision 생성 금지' },
];
