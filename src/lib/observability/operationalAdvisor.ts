// WEB-OBS-5 — Operational Advisor (pure, unit-tested, rule-based — NO ML).
//
// Turns the analysis (root cause · gate · rollback advisor · blast radius · recovery) into a single
// RECOMMENDED next action for the operator — plus urgency, why, evidence, a verification checklist,
// an escalation target, and an explicit safety contract. **Nothing is executed.** Every action is
// automated=false, requiresApproval=true; only read-only verifications are read_only=true. Below the
// confidence/sample gates the advisor returns OBSERVE with an insufficient-data reason — it never
// recommends a confident destructive-adjacent action on a thin sample.

import type { Confidence } from './release';
import type { RollbackStatus, RootCauseCode } from './rootCause';
import type { GateVerdict } from './releaseQuality';
import type { IncidentType } from './incident';
import type { BlastRadiusLevel } from './blastRadius';
import type { RecoveryStatus } from './recovery';
import { ADVISOR_ESCALATE_AFFECTED_SESSIONS } from './thresholds';

// ── Action categories (recommendation labels — never executed) ──────────────
export type ActionCategory =
  | 'OBSERVE' | 'INVESTIGATE' | 'VERIFY_BROWSER' | 'VERIFY_ROUTE' | 'VERIFY_API'
  | 'PAUSE_RELEASE' | 'HOLD_PROMOTION' | 'PREPARE_ROLLBACK' | 'ROLLBACK_RECOMMENDED'
  | 'CACHE_VERIFICATION' | 'CHUNK_VERIFICATION' | 'HYDRATION_VERIFICATION' | 'NETWORK_VERIFICATION'
  | 'MEMORY_VERIFICATION' | 'BOOT_RECOVERY_VERIFICATION' | 'PLAYER_HEALTH_VERIFICATION'
  | 'DATA_INTEGRITY_VERIFICATION' | 'ESCALATE_ENGINEERING' | 'ESCALATE_OPERATIONS';

export type Urgency = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
export type ActionPriority = 'P0' | 'P1' | 'P2' | 'P3';

export type EscalationTarget =
  | 'NONE' | 'OPERATOR' | 'FRONTEND' | 'BACKEND' | 'INFRA' | 'DATABASE' | 'SECURITY' | 'PRODUCT' | 'EXECUTIVE';

// ── Action safety contract (this phase: nothing auto-executes) ──────────────
export interface ActionSafety {
  readOnly: boolean;
  reversible: boolean;
  destructive: boolean;
  requiresApproval: boolean;  // ALWAYS true this phase
  productionEffect: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  automated: false;           // ALWAYS false this phase
}

/** Fixed safety profile per action category. Read-only verifications are safe; release/rollback
 *  actions carry production effect but STILL never auto-execute (requiresApproval + automated=false). */
export function actionSafety(category: ActionCategory): ActionSafety {
  const readOnlyVerifications: ActionCategory[] = [
    'OBSERVE', 'INVESTIGATE', 'VERIFY_BROWSER', 'VERIFY_ROUTE', 'VERIFY_API', 'CACHE_VERIFICATION',
    'CHUNK_VERIFICATION', 'HYDRATION_VERIFICATION', 'NETWORK_VERIFICATION', 'MEMORY_VERIFICATION',
    'BOOT_RECOVERY_VERIFICATION', 'PLAYER_HEALTH_VERIFICATION', 'DATA_INTEGRITY_VERIFICATION',
  ];
  if (readOnlyVerifications.includes(category)) {
    return { readOnly: true, reversible: true, destructive: false, requiresApproval: true, productionEffect: false, riskLevel: 'none', automated: false };
  }
  if (category === 'ESCALATE_ENGINEERING' || category === 'ESCALATE_OPERATIONS') {
    return { readOnly: true, reversible: true, destructive: false, requiresApproval: true, productionEffect: false, riskLevel: 'low', automated: false };
  }
  // Release/promotion/rollback: production-affecting recommendations (still operator-approved, never auto).
  if (category === 'ROLLBACK_RECOMMENDED') {
    return { readOnly: false, reversible: true, destructive: false, requiresApproval: true, productionEffect: true, riskLevel: 'high', automated: false };
  }
  // PAUSE_RELEASE / HOLD_PROMOTION / PREPARE_ROLLBACK
  return { readOnly: false, reversible: true, destructive: false, requiresApproval: true, productionEffect: true, riskLevel: 'medium', automated: false };
}

// ── Verification checklists (read-only steps per action) ────────────────────
const VERIFICATION_CHECKLISTS: Partial<Record<ActionCategory, string[]>> = {
  PAUSE_RELEASE: [
    '현재 Release Gate가 BLOCK 또는 PASS_WITH_WARNING인지 확인',
    'Pending deployment가 있는지 확인',
    'Production 승격이 아직 수행되지 않았는지 확인',
    'Candidate/Baseline Release 확인',
  ],
  HOLD_PROMOTION: [
    'Release Gate verdict 확인(BLOCK/PASS_WITH_WARNING)',
    '승격 대기 중인 릴리스 확인',
    'Root Cause confidence 확인',
  ],
  PREPARE_ROLLBACK: [
    'Rollback 대상 Release(build id) 확인',
    '이전 안정 Release 확인(timeline)',
    'Migration 의존성 확인(DB rollback 필요 여부)',
    'Rollback 후 검증 Metric(error rate/chunk/vital) 확인',
  ],
  ROLLBACK_RECOMMENDED: [
    'Rollback Advisor 상태(ROLLBACK_RECOMMENDED/BLOCK_RELEASE) 재확인',
    'error/critical/chunk rate baseline 대비 확인',
    'confidence HIGH/MEDIUM 여부 확인',
    'Rollback 후 Recovery 관측 계획 확인',
  ],
  VERIFY_BROWSER: ['affected browser session 수', 'total browser session 수', 'error rate delta', 'sample threshold 충족 여부', '다른 browser와 비교'],
  VERIFY_ROUTE: ['route별 error/slow session', '집중도(%)', 'release 상관', 'browser 편중 여부', 'sample threshold'],
  VERIFY_API: ['normalized endpoint', 'status distribution(가능 시)', 'p75/p95', 'timeout/network error 분리', 'affected route', 'release comparison'],
  CHUNK_VERIFICATION: ['chunk-load 오류 세션 수', 'browser별 분포', 'release(build) 전환 상관', 'boot recovery 신호(가능 시)'],
  CACHE_VERIFICATION: ['최근 캐시/CDN 변경 이력(외부, 변경 금지)', '구버전 자산 서빙 의심 여부', 'release first-seen 타이밍'],
  HYDRATION_VERIFICATION: ['hydration fingerprint 집중', 'route/browser 편중', 'release 상관', 'SSR/CSR 조건부 렌더 후보'],
  MEMORY_VERIFICATION: ['device memory bucket 분포', 'route 집중', '장시간 세션 상관(가능 시)', 'long task 동반'],
  NETWORK_VERIFICATION: ['network type 분포', 'API p95 vs network', 'timeout/network error 분리'],
  BOOT_RECOVERY_VERIFICATION: ['boot 실패/복구 신호(전용 채널 없으면 NO DATA)', 'chunk 동반 여부', 'loop prevented 확인(WEB-OPT-2)'],
  PLAYER_HEALTH_VERIFICATION: ['/player route error/slow 집중', 'API 상관', 'browser 편중', '(Player 코드 변경 금지 — 관측만)'],
  DATA_INTEGRITY_VERIFICATION: ['critical error fingerprint', 'affected route', '(운영 데이터 조회/변경 금지 — 텔레메트리 관측만)'],
  INVESTIGATE: ['Root Cause 상위 원인 확인', 'evidence/correlation 확인', 'blast radius 확인'],
  OBSERVE: ['표본 축적 대기', 'auto refresh로 추세 관찰', '임계 초과 시 재평가'],
};

// ── Advisor ──────────────────────────────────────────────────────────────────
export interface AdvisorInput {
  incidentType: IncidentType | null;
  topCauseCode: RootCauseCode | null;
  topCauseRoute: string | null;
  rollbackStatus: RollbackStatus | null;
  gateVerdict: GateVerdict | null;
  blastLevel: BlastRadiusLevel;
  recoveryStatus: RecoveryStatus | null;
  confidence: Confidence;         // release/analysis-level confidence
  affectedSessions: number;
  criticalRate: number;           // fraction
  chunkRate: number;              // fraction (sessions)
  errorRate: number;              // fraction
  recurring: boolean;
  securityEvidence: boolean;      // only true when a real security signal is present
}

export interface OperationalAdvice {
  recommendedAction: ActionCategory;
  urgency: Urgency;
  actionPriority: ActionPriority;
  reason: string;
  evidence: string[];
  verificationSteps: string[];
  escalationTarget: EscalationTarget;
  confidence: Confidence;
  safety: ActionSafety;
  approvalRequired: boolean;      // always true
  productionEffect: boolean;
  safetyWarning: string;
  insufficientDataReason: string | null;
}

function urgencyToPriority(u: Urgency): ActionPriority {
  return u === 'CRITICAL' ? 'P0' : u === 'HIGH' ? 'P1' : u === 'MEDIUM' ? 'P2' : 'P3';
}

const SAFETY_WARNING = '권고이며 자동 실행되지 않습니다. 실제 Rollback/Deploy 중단/DB 변경/알림 전송은 수행되지 않습니다(운영자 승인 필요).';

export function computeOperationalAdvice(input: AdvisorInput): OperationalAdvice {
  const build = (category: ActionCategory, urgency: Urgency, reason: string, evidence: string[], escalation: EscalationTarget, insufficient: string | null = null): OperationalAdvice => {
    const safety = actionSafety(category);
    return {
      recommendedAction: category, urgency, actionPriority: urgencyToPriority(urgency), reason, evidence,
      verificationSteps: VERIFICATION_CHECKLISTS[category] ?? VERIFICATION_CHECKLISTS.INVESTIGATE ?? [],
      escalationTarget: escalation, confidence: input.confidence, safety,
      approvalRequired: true, productionEffect: safety.productionEffect, safetyWarning: SAFETY_WARNING,
      insufficientDataReason: insufficient,
    };
  };

  // 0) Insufficient data → OBSERVE (never a confident action on a thin sample).
  if (input.confidence === 'INSUFFICIENT') {
    return build('OBSERVE', 'LOW', '표본이 부족하여 확정적 조치를 권고하지 않습니다.', [`confidence INSUFFICIENT · affected ${input.affectedSessions} 세션`], 'NONE', 'confidence INSUFFICIENT — 표본/세션 부족');
  }

  const escalation = computeEscalation(input);

  // 1) Recovery in progress → verification-first (unless a hard block reappears).
  if (input.recoveryStatus === 'RECOVERED' || input.recoveryStatus === 'IMPROVING') {
    if (!input.recurring && input.rollbackStatus !== 'BLOCK_RELEASE') {
      return build('OBSERVE', 'LOW', `복구 관측 중(${input.recoveryStatus}) — 운영자 확인 후 종료 판단.`, [`recovery ${input.recoveryStatus}`, `error rate ${(input.errorRate * 100).toFixed(2)}%`], escalation);
    }
  }

  // 2) Hard block signals → rollback/hold recommendation.
  if (input.rollbackStatus === 'BLOCK_RELEASE') {
    // Already-live severe error → prepare rollback; else hold promotion.
    const cat: ActionCategory = input.gateVerdict === 'BLOCK' ? 'HOLD_PROMOTION' : 'PREPARE_ROLLBACK';
    return build(cat, 'CRITICAL', 'Rollback Advisor BLOCK_RELEASE — 승격 보류/롤백 준비 권고.', [`critical ${(input.criticalRate * 100).toFixed(2)}%`, `chunk ${(input.chunkRate * 100).toFixed(2)}%`, `gate ${input.gateVerdict ?? 'n/a'}`], escalation);
  }
  if (input.rollbackStatus === 'ROLLBACK_RECOMMENDED') {
    return build('ROLLBACK_RECOMMENDED', 'HIGH', 'Rollback Advisor ROLLBACK_RECOMMENDED — 롤백 검토 권고.', [`error rate ${(input.errorRate * 100).toFixed(2)}%`, input.recurring ? '재발 감지' : 'baseline 대비 급증'], escalation);
  }

  // 3) Cause-specific verification.
  const causeMap: Partial<Record<RootCauseCode, ActionCategory>> = {
    CHUNK_DEPLOY: 'CHUNK_VERIFICATION',
    HYDRATION_MISMATCH: 'HYDRATION_VERIFICATION',
    BROWSER_SPECIFIC: 'VERIFY_BROWSER',
    ROUTE_CONCENTRATION: input.topCauseRoute?.includes('player') ? 'PLAYER_HEALTH_VERIFICATION' : 'VERIFY_ROUTE',
    API_LATENCY: 'VERIFY_API',
    MEMORY_PRESSURE: 'MEMORY_VERIFICATION',
    RELEASE_ERROR_SPIKE: 'HOLD_PROMOTION',
  };
  if (input.topCauseCode && causeMap[input.topCauseCode]) {
    const cat = causeMap[input.topCauseCode]!;
    const urgency: Urgency = input.blastLevel === 'CRITICAL' || input.blastLevel === 'WIDESPREAD' ? 'HIGH' : 'MEDIUM';
    return build(cat, urgency, `주요 원인(${input.topCauseCode}) 검증 우선 권고.`, [`blast ${input.blastLevel}`, `affected ${input.affectedSessions} 세션`, input.topCauseRoute ? `route ${input.topCauseRoute}` : ''].filter(Boolean), escalation);
  }

  // 4) Watch / gate-warning → hold or investigate.
  if (input.gateVerdict === 'PASS_WITH_WARNING' || input.rollbackStatus === 'WATCH') {
    return build('HOLD_PROMOTION', 'MEDIUM', '경고 신호(gate/rollback WATCH) — 승격 보류 및 조사 권고.', [`gate ${input.gateVerdict ?? 'n/a'}`, `error rate ${(input.errorRate * 100).toFixed(2)}%`], escalation);
  }

  // 5) Default → investigate or observe.
  if (input.affectedSessions >= 3) {
    return build('INVESTIGATE', 'LOW', '조치가 필요할 만큼의 집중 신호는 없으나 조사를 권고합니다.', [`affected ${input.affectedSessions} 세션`, `blast ${input.blastLevel}`], escalation);
  }
  return build('OBSERVE', 'NONE', '임계 초과 신호 없음 — 관찰 유지.', [`affected ${input.affectedSessions} 세션`], 'NONE');
}

// ── Escalation ────────────────────────────────────────────────────────────────
export interface EscalationResult { target: EscalationTarget; reasons: string[]; }

export function computeEscalationDetail(input: AdvisorInput): EscalationResult {
  const reasons: string[] = [];
  // Sample-gate: no over-escalation on thin data.
  if (input.confidence === 'INSUFFICIENT') return { target: 'NONE', reasons: ['표본 부족 → escalation 보류'] };

  // SECURITY only with real evidence.
  if (input.securityEvidence) { reasons.push('보안 evidence 존재'); return { target: 'SECURITY', reasons }; }

  const widespread = input.blastLevel === 'WIDESPREAD' || input.blastLevel === 'CRITICAL';
  // EXECUTIVE only for widespread + severe (or persistent unrecovered).
  if (widespread && (input.rollbackStatus === 'BLOCK_RELEASE' || input.recoveryStatus === 'REGRESSED')) {
    reasons.push('광범위 blast + 심각/미복구'); return { target: 'EXECUTIVE', reasons };
  }
  // Cause-typed technical escalation.
  if (input.topCauseCode === 'API_LATENCY') { reasons.push('API 지연 원인'); return { target: 'BACKEND', reasons }; }
  if (input.criticalRate >= 0.02 && input.incidentType === 'CRITICAL_ERROR') { reasons.push('critical error data-integrity 위험 후보'); return { target: 'DATABASE', reasons }; }
  if (input.topCauseCode === 'CHUNK_DEPLOY') { reasons.push('배포 자산/캐시(인프라) 후보'); return { target: 'INFRA', reasons }; }
  if (input.rollbackStatus === 'BLOCK_RELEASE' || input.rollbackStatus === 'ROLLBACK_RECOMMENDED' || input.affectedSessions >= ADVISOR_ESCALATE_AFFECTED_SESSIONS) {
    reasons.push('심각 신호 또는 다수 세션 영향'); return { target: 'FRONTEND', reasons };
  }
  if (input.blastLevel === 'MODERATE' || input.affectedSessions >= 15) { reasons.push('중간 규모 영향'); return { target: 'OPERATOR', reasons }; }
  return { target: 'NONE', reasons: ['임계 미만'] };
}

export function computeEscalation(input: AdvisorInput): EscalationTarget {
  return computeEscalationDetail(input).target;
}

// ── Incident Lifecycle (derived/suggested — persistence deferred; never auto-RESOLVED) ──
export type LifecycleStatus = 'DETECTED' | 'TRIAGED' | 'INVESTIGATING' | 'MITIGATING' | 'MONITORING' | 'RESOLVED' | 'FALSE_POSITIVE';

export interface LifecycleResult {
  suggestedStatus: LifecycleStatus;
  operatorControlled: true;   // status is operator-owned; this is a suggestion only
  note: string;
}

/**
 * Suggest a lifecycle status from live signals. NEVER returns RESOLVED automatically (only an operator
 * closes an incident); a clearly-recovered state is surfaced as MONITORING with an operator-close note.
 * Persistence of operator status/notes is DEFERRED (no incident state table this phase).
 */
export function deriveLifecycle(input: AdvisorInput): LifecycleResult {
  if (input.confidence === 'INSUFFICIENT' && input.affectedSessions < 3) {
    return { suggestedStatus: 'FALSE_POSITIVE', operatorControlled: true, note: '표본 부족/집중 없음 — 오탐 가능. 운영자 확인 필요.' };
  }
  if (input.recoveryStatus === 'RECOVERED' && !input.recurring) {
    return { suggestedStatus: 'MONITORING', operatorControlled: true, note: '지표 회복 관측 — 자동 RESOLVED 금지, 운영자가 Incident를 종료해야 합니다.' };
  }
  if (input.recoveryStatus === 'IMPROVING' || input.recoveryStatus === 'STABLE') {
    return { suggestedStatus: 'MONITORING', operatorControlled: true, note: '복구 관측 중.' };
  }
  if (input.rollbackStatus === 'BLOCK_RELEASE' || input.rollbackStatus === 'ROLLBACK_RECOMMENDED') {
    return { suggestedStatus: 'MITIGATING', operatorControlled: true, note: '완화 조치 검토 단계(권고).' };
  }
  if (input.topCauseCode) {
    return { suggestedStatus: 'INVESTIGATING', operatorControlled: true, note: '원인 후보 식별 — 조사 단계.' };
  }
  return { suggestedStatus: 'DETECTED', operatorControlled: true, note: '탐지됨 — triage 필요.' };
}
