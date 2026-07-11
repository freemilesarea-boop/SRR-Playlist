// WEB-OBS-9 — Operations Governance shared types. Decision SUPPORT only — every recommendation/readiness
// output is advisory (requiresApproval:true, automated:false, remoteControl:false). The approval records
// are an AUDIT trail; recording an approval never executes a release/rollback/Player action.

import type { Confidence } from '../observability/release';

// ── Release Readiness ─────────────────────────────────────────────────────────
export type ReadinessStatus = 'READY' | 'REVIEW_REQUIRED' | 'HIGH_RISK' | 'BLOCK_RECOMMENDED' | 'INSUFFICIENT_DATA';
export interface ReadinessComponent { key: string; label: string; score: number | null; weight: number; detail: string; }
export interface ReleaseReadiness {
  release: string;
  score: number | null;              // 0..100, null → INSUFFICIENT_DATA
  status: ReadinessStatus;
  components: ReadinessComponent[];
  sessions: number;
  stores: number;
  criticalIncidents: number;
  regressedMetrics: number;
  coverage: number | null;
  confidence: number | null;         // from the Confidence Engine
  reasons: string[];
  requiresApproval: true;
  automated: false;
  remoteControl: false;
}

// ── Confidence Engine ─────────────────────────────────────────────────────────
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
export interface ConfidenceInput { coverage: number | null; sessions: number; stores: number; browsers: number; }
export interface ConfidenceResult {
  value: number | null;              // 0..CONFIDENCE_MAX, null → INSUFFICIENT
  level: ConfidenceLevel;
  parts: Array<{ key: string; label: string; score: number; weight: number }>;
}

// ── Decision Recommendation (advisory only) ──────────────────────────────────
export type RecommendationAction =
  | 'PROMOTE_OK' | 'MONITOR' | 'DELAY_RELEASE' | 'BLOCK_RELEASE_RECOMMENDED'
  | 'INVESTIGATE_INCIDENT' | 'ESCALATE' | 'PREPARE_ROLLBACK_PLAN' | 'OBSERVE';
export type RecommendationUrgency = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
export interface DecisionRecommendation {
  id: string;                        // stable client key (scope+action)
  scope: string;                     // release id / incident key / 'FLEET'
  action: RecommendationAction;
  urgency: RecommendationUrgency;
  reason: string;
  evidence: string[];                // e.g. "TTFA p75 regression", "3 Browser", "142 Stores"
  confidence: number | null;
  requiresApproval: true;
  automated: false;
  remoteControl: false;
}

// ── Operations Playbook (static, rule-based) ─────────────────────────────────
export interface Playbook {
  incidentType: string;
  title: string;
  possibleCauses: string[];
  evidenceToCollect: string[];
  recommendedChecks: string[];
  escalationPath: string[];          // Store → Brand → Enterprise → Platform ladder text
}

// ── Incident Escalation Matrix ───────────────────────────────────────────────
export type EscalationLevel = 'STORE' | 'BRAND' | 'ENTERPRISE' | 'PLATFORM';
export interface EscalationInput { severity: string; affectedStores: number; affectedBrands: number; }
export interface Escalation {
  severity: string;
  level: EscalationLevel;
  rationale: string;
  contactLadder: string[];
}

// ── Change Impact Analyzer ────────────────────────────────────────────────────
export type ImpactRisk = 'LOW' | 'MODERATE' | 'HIGH' | 'INSUFFICIENT_DATA';
export interface ChangeImpact {
  previous: string;
  current: string;
  scoreDelta: number | null;
  regressedMetrics: number;
  improvedMetrics: number;
  risk: ImpactRisk;
  recommendation: RecommendationAction;
  significant: boolean;
  notes: string[];
}

// ── Operational Evidence Package (for PDF/print export) ──────────────────────
export interface EvidencePackage {
  incidentKey: string;
  generatedFor: string;              // scope label
  title: string;
  timeline: Array<{ at: string; label: string; detail: string }>;
  metrics: Array<{ label: string; value: string }>;
  affectedStores: number | null;
  affectedSessions: number | null;
  regression: string;
  relatedRelease: string | null;
  rootCauseChain: string[];
  caveat: string;
}

// ── Executive Weekly Report ──────────────────────────────────────────────────
export interface ExecutiveReport {
  window: string;
  availability: number | null;
  reliability: number | null;
  releasesReviewed: number;
  approvals: number;
  rejectedReleases: number;
  majorIncidents: number;
  recommendations: string[];
  dataSufficient: boolean;
}

// ── Governance Timeline ───────────────────────────────────────────────────────
export type GovStage = 'INCIDENT' | 'RECOMMENDATION' | 'APPROVAL' | 'RELEASE' | 'OBSERVATION' | 'CLOSED';
export interface GovTimelineEntry { at: string; stage: GovStage; label: string; actor: string | null; detail: string; }

// ── Persisted governance records (from 0462 RPCs) ────────────────────────────
export type ApprovalChoice = 'APPROVE' | 'REJECT' | 'NEED_INVESTIGATION';
export interface OperationsDecision {
  id: string; scope: string; kind: string; title: string; recommendation: string;
  status: string; confidence: number | null; createdBy: string | null; createdAt: string; payload?: unknown;
}
export interface OperationsApproval {
  id: string; decisionId: string; choice: ApprovalChoice; reason: string | null; actor: string | null; createdAt: string;
}
export interface OperationsRule {
  key: string; label: string; threshold: number | null; weight: number | null; enabled: boolean; version: number; updatedBy: string | null; updatedAt: string;
}

// ── Overview (governance state counts) ────────────────────────────────────────
export interface GovernanceOverview {
  openDecisions: number;
  pendingApprovals: number;
  approvals7d: number;
  rejected7d: number;
  needInvestigation7d: number;
  majorIncidents: number;
}

export type { Confidence };
