/**
 * opsCenter — AI Operations Center & Human-AI Collaboration 순수 로직 (Phase AI-OPS-1).
 *
 * AI 가 생성한 모든 제안(Executive/Recovery/Fleet/Best Practice/Strategy/Context)을
 * 하나의 Operations Queue 로 관리하고, 사람의 검토·승인·거절·피드백 워크플로를 계산한다.
 * AI 는 제안만 — 자동 승인/실행/Production Apply 없음. 피드백은 기록 기반 참고
 * Evidence(자동 모델/가중치 변경 없음).
 */
import { isFiniteNumber, clampScore } from './aiMemory';

export { isFiniteNumber, clampScore };

export const OPS_SOURCE_VERSION = 'ops_v1(0504)';

/* ── Source 카탈로그(기존 Recommendation 테이블 참조 — 복제 없음) ────────── */
export type OpsSourceType = 'executive_recommendation' | 'recovery_candidate' | 'fleet_opportunity' | 'best_practice' | 'strategy_snapshot' | 'context_recommendation';
export const OPS_SOURCES: Array<{ type: OpsSourceType; label: string; origin: string; category: string }> = [
  { type: 'executive_recommendation', label: 'Executive Recommendation', origin: '0503 AI Music OS', category: 'strategy' },
  { type: 'recovery_candidate', label: 'Recovery Candidate', origin: '0502 Self-Healing', category: 'recovery' },
  { type: 'fleet_opportunity', label: 'Fleet Opportunity', origin: '0500 Fleet Intelligence', category: 'opportunity' },
  { type: 'best_practice', label: 'Best Practice', origin: '0500 Fleet Intelligence', category: 'opportunity' },
  { type: 'strategy_snapshot', label: 'Strategy Snapshot', origin: '0493 Optimization Strategy', category: 'strategy' },
  { type: 'context_recommendation', label: 'Context Recommendation', origin: '0491 Context Learning', category: 'context' },
];

/* ── 상태 전이 whitelist ────────────────────────────────────────────────── */
export type OpsStatus = 'new' | 'reviewing' | 'waiting_evidence' | 'approved' | 'rejected' | 'archived';
export type ReviewAction = 'approve' | 'hold' | 'reject' | 'request_review';
const TRANSITIONS: Record<OpsStatus, OpsStatus[]> = {
  new: ['reviewing', 'waiting_evidence', 'approved', 'rejected', 'archived'],
  reviewing: ['waiting_evidence', 'approved', 'rejected', 'archived'],
  waiting_evidence: ['reviewing', 'approved', 'rejected', 'archived'],
  approved: ['archived'], rejected: ['archived'], archived: [],
};
export function canTransition(from: OpsStatus, to: OpsStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }

/* ── 승인 정책 게이트(자동 승인 없음) ───────────────────────────────────── */
export type ApprovalPolicy = 'single' | 'dual' | 'executive';
export const APPROVAL_REQUIRED: Record<ApprovalPolicy, number> = { single: 1, dual: 2, executive: 1 };
export function approvalGate(inp: { policy: ApprovalPolicy; distinctApprovers: number; hasRejection: boolean }): { canFinalize: boolean; missing: number; note: string } {
  if (inp.hasRejection) return { canFinalize: false, missing: 0, note: '거절 이력 존재 — 재검토 필요' };
  const required = APPROVAL_REQUIRED[inp.policy];
  const missing = Math.max(0, required - inp.distinctApprovers);
  return {
    canFinalize: missing === 0, missing,
    note: missing > 0 ? `${inp.policy} 정책 — 서로 다른 승인자 ${missing}명 추가 필요` : '승인 요건 충족(사람 확인 완료)',
  };
}

/* ── Executive Inbox 우선순위(결정적) ───────────────────────────────────── */
export interface OpsItemLike { id: string; category: string; riskTier: string | null; impact: string | null; status: OpsStatus; createdAt: string }
export function isExecutiveInboxItem(item: OpsItemLike): boolean {
  return item.riskTier === 'high' || item.riskTier === 'critical' || item.impact === 'high' || item.impact === 'critical'
    || item.category === 'recovery' || item.category === 'strategy';
}
export function rankInbox<T extends OpsItemLike>(items: T[]): T[] {
  const riskScore = (r: string | null) => (r === 'critical' ? 3 : r === 'high' ? 2 : r === 'medium' || r === 'moderate' ? 1 : 0);
  return [...items].sort((a, b) =>
    (riskScore(b.riskTier) + riskScore(b.impact)) - (riskScore(a.riskTier) + riskScore(a.impact))
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id));
}

/* ── Feedback → Learning Signal(기록 기반 — 자동 반영 없음) ─────────────── */
export type FeedbackType = 'accurate' | 'inaccurate' | 'needs_modification' | 'insufficient_evidence';
export interface LearningSignal { sourceType: string; feedbackType: FeedbackType; reason: string; signal: 'reinforce' | 'contradict' | 'refine' | 'evidence_gap'; note: string }
export function feedbackToLearningSignal(sourceType: string, feedbackType: FeedbackType, reason: string): LearningSignal {
  const map: Record<FeedbackType, LearningSignal['signal']> = { accurate: 'reinforce', inaccurate: 'contradict', needs_modification: 'refine', insufficient_evidence: 'evidence_gap' };
  return {
    sourceType, feedbackType, reason, signal: map[feedbackType],
    note: '기록 기반 참고 Evidence — Memory Reinforce/Contradict(0498) 흐름으로 사람이 반영(자동 학습 없음)',
  };
}

/* ── Feedback Analytics(실측만 — 표본 부족 시 null) ─────────────────────── */
export interface ReviewLike { action: ReviewAction; feedbackType: FeedbackType | null; createdAt: string }
export interface OpsAnalytics {
  approvalRate: number | null; rejectionRate: number | null; modificationRate: number | null;
  aiAccuracyTrend: 'improving' | 'stable' | 'declining' | 'insufficient_data'; totalDecisions: number;
}
export function computeReviewAnalytics(reviews: ReviewLike[]): OpsAnalytics {
  const decisions = reviews.filter((r) => r.action === 'approve' || r.action === 'reject');
  const total = decisions.length;
  if (total < 2) return { approvalRate: null, rejectionRate: null, modificationRate: null, aiAccuracyTrend: 'insufficient_data', totalDecisions: total };
  const approvals = decisions.filter((r) => r.action === 'approve').length;
  const approvalRate = clampScore((approvals / total) * 100);
  const withFeedback = reviews.filter((r) => r.feedbackType != null);
  const modificationRate = withFeedback.length >= 2 ? clampScore((withFeedback.filter((r) => r.feedbackType === 'needs_modification').length / withFeedback.length) * 100) : null;
  // AI 정확도 추이: 시간순 전/후 절반의 승인율 비교(표본 4건 미만 → insufficient).
  let trend: OpsAnalytics['aiAccuracyTrend'] = 'insufficient_data';
  if (total >= 4) {
    const sorted = [...decisions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const mid = Math.floor(sorted.length / 2);
    const rate = (xs: ReviewLike[]) => xs.filter((r) => r.action === 'approve').length / xs.length;
    const delta = rate(sorted.slice(mid)) - rate(sorted.slice(0, mid));
    trend = delta >= 0.1 ? 'improving' : delta <= -0.1 ? 'declining' : 'stable';
  }
  return { approvalRate, rejectionRate: clampScore(100 - approvalRate), modificationRate, aiAccuracyTrend: trend, totalDecisions: total };
}

export function opsInputHash(parts: Array<string | number | null | undefined>): string {
  const s = parts.map((p) => (p == null ? '' : String(p))).join('|');
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `ops_${(h >>> 0).toString(16)}`;
}

/* ── Support Matrix ─────────────────────────────────────────────────────── */
export type OpsSupportStatus = 'fully_supported' | 'partially_supported' | 'read_only' | 'evidence_only' | 'unsupported' | 'insufficient_data';
export interface OpsSupport { key: string; label: string; status: OpsSupportStatus; note: string }
export const OPS_SUPPORT: OpsSupport[] = [
  { key: 'queue', label: 'Operations Queue', status: 'fully_supported', note: '6종 Source 참조 등록(복제 없음) · 중복 등록 unique 차단' },
  { key: 'review', label: 'Human Review Workflow', status: 'fully_supported', note: '승인/보류/거절/재검토 — reason 필수' },
  { key: 'approval_single', label: 'Single Approval', status: 'fully_supported', note: '1인 승인' },
  { key: 'approval_dual', label: 'Dual Approval', status: 'partially_supported', note: '서로 다른 승인자 2인 서버 게이트 — 현재 admin 계정 1개 환경에서는 충족 불가(정직)' },
  { key: 'approval_executive', label: 'Executive Approval', status: 'partially_supported', note: 'executive 정책 표시 — 별도 executive role 미구현(단일 super_admin)' },
  { key: 'auto_approval', label: 'Automatic Approval', status: 'unsupported', note: '금지 — 모든 승인은 사람' },
  { key: 'feedback_loop', label: 'AI Feedback Loop', status: 'evidence_only', note: '기록 기반 참고 — Memory Reinforce/Contradict 로 사람이 반영(자동 학습 없음)' },
  { key: 'evidence_viewer', label: 'Evidence Viewer', status: 'fully_supported', note: 'Source 스냅샷 읽기 전용(Evidence/Confidence/Risk/Twin/Pattern/Incident refs)' },
  { key: 'timeline', label: 'Audit Timeline', status: 'fully_supported', note: '생성→검토→승인/거절→종료 전 이벤트 기록' },
  { key: 'executive_inbox', label: 'Executive Inbox', status: 'fully_supported', note: 'High Risk/Impact/Recovery/Strategy 결정적 우선순위' },
  { key: 'analytics', label: 'AI Feedback Analytics', status: 'partially_supported', note: '승인율/거절율/수정요청/추이 — 표본 부족 시 insufficient' },
  { key: 'execution_queue', label: 'Execution Queue', status: 'evidence_only', note: '승인 후 실행은 기존 Draft/Promotion/Candidate 흐름 + 사람 수동' },
  { key: 'production_apply', label: 'Production Apply', status: 'unsupported', note: '금지 — Evidence Only' },
];

/* ── 라벨/톤 ────────────────────────────────────────────────────────────── */
export const OPS_STATUS_LABEL: Record<OpsStatus, string> = { new: 'New', reviewing: '검토 중', waiting_evidence: 'Evidence 대기', approved: '승인됨', rejected: '거절됨', archived: '보관' };
export const OPS_STATUS_TONE: Record<OpsStatus, 'info' | 'warning' | 'neutral' | 'success' | 'danger'> = { new: 'info', reviewing: 'warning', waiting_evidence: 'warning', approved: 'success', rejected: 'danger', archived: 'neutral' };
export const ACTION_LABEL: Record<ReviewAction, string> = { approve: '승인', hold: '보류', reject: '거절', request_review: '재검토 요청' };
export const FEEDBACK_LABEL: Record<FeedbackType, string> = { accurate: '정확', inaccurate: '부정확', needs_modification: '수정 필요', insufficient_evidence: 'Evidence 부족' };
