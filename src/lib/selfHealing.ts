/**
 * selfHealing — Self-Healing AI Music OS & Resilience Intelligence 순수 로직 (Phase AI-MUSIC-15).
 *
 * 실측 Telemetry(playback_events_v2)에서 장애를 감지 → 상관 기반 원인 후보(RCA) →
 * 복구 전략 제안 → Digital Twin 검증 게이트 → Risk Assessment → Governance 제출용
 * Recovery Candidate 를 생성한다. **자동 Production 복구/Rollback/실행 없음 — Evidence Only.**
 *
 * 원칙: deterministic · 이전 구간 없으면 감지하지 않음(가짜 장애 생성 금지) ·
 *       RCA 는 후보(상관 기반, 단정 아님) · 없는 성분 null 재정규화 · Twin 미검증 → Governance 금지.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

export { isFiniteNumber, clampScore };

export const SELF_HEALING_SOURCE_VERSION = 'self_healing_v1(0502)';

/* ── Incident 타입(실측 telemetry 기준 지원 여부) ────────────────────────── */
export type IncidentType = 'playback_failure' | 'streaming_degradation' | 'buffer_spike' | 'decoder_failure'
  | 'queue_stall' | 'scheduler_drift' | 'store_offline' | 'api_failure' | 'db_latency' | 'ai_service_failure';
export type IncidentSeverity = 'low' | 'moderate' | 'high' | 'critical';
export const INCIDENT_TYPES: Array<{ type: IncidentType; label: string; support: 'supported' | 'partially_supported' | 'unsupported'; note: string }> = [
  { type: 'playback_failure', label: 'Playback Failure', support: 'supported', note: 'player_error 이벤트 실측' },
  { type: 'streaming_degradation', label: 'Streaming Degradation', support: 'supported', note: 'skip/completion 악화 실측' },
  { type: 'buffer_spike', label: 'Buffer Spike', support: 'unsupported', note: 'buffer telemetry 미수집' },
  { type: 'decoder_failure', label: 'Decoder Failure', support: 'partially_supported', note: 'player_error 에 포함(구분 불가)' },
  { type: 'queue_stall', label: 'Queue Stall', support: 'unsupported', note: 'queue telemetry 미수집' },
  { type: 'scheduler_drift', label: 'Scheduler Drift', support: 'unsupported', note: 'scheduler telemetry 미수집' },
  { type: 'store_offline', label: 'Store Offline', support: 'unsupported', note: 'heartbeat 미수집' },
  { type: 'api_failure', label: 'API Failure', support: 'unsupported', note: 'API telemetry 미수집' },
  { type: 'db_latency', label: 'DB Latency', support: 'unsupported', note: 'DB latency telemetry 미수집' },
  { type: 'ai_service_failure', label: 'AI Service Failure', support: 'unsupported', note: 'AI 서비스 telemetry 미수집' },
];

/* ── Incident Detection(이전/현재 구간 비교 — 이전 없으면 판정 불가) ─────── */
export interface TelemetryWindow {
  prevEvents: number | null; currEvents: number | null;
  prevErrorRate: number | null; currErrorRate: number | null;
  prevSkipRate: number | null; currSkipRate: number | null;
  prevCompletion: number | null; currCompletion: number | null;
}
export interface DetectedIncident {
  incidentType: IncidentType; severity: IncidentSeverity; scope: 'global' | 'industry'; scopeKey: string | null;
  kpi: Record<string, number | null>; baseline: Record<string, number | null>;
  summary: string; evidence: Array<{ label: string; value: string | number | null }>; limitations: string[];
}
export function detectIncidents(w: TelemetryWindow, scope: 'global' | 'industry' = 'global', scopeKey: string | null = null, minEvents = 50): DetectedIncident[] {
  const out: DetectedIncident[] = [];
  // 이전 구간 데이터 부족 → 감지하지 않음(가짜 장애 생성 금지).
  if (!isFiniteNumber(w.prevEvents) || !isFiniteNumber(w.currEvents) || w.prevEvents < minEvents || w.currEvents < minEvents) return out;
  const mk = (incidentType: IncidentType, severity: IncidentSeverity, summary: string, kpiKey: string, curr: number, prev: number): DetectedIncident => ({
    incidentType, severity, scope, scopeKey,
    kpi: { [kpiKey]: curr, events: w.currEvents }, baseline: { [kpiKey]: prev, events: w.prevEvents },
    summary,
    evidence: [
      { label: 'metric', value: kpiKey }, { label: 'current', value: curr }, { label: 'baseline', value: prev },
      { label: 'curr_events', value: w.currEvents }, { label: 'prev_events', value: w.prevEvents },
    ],
    limitations: ['상관 기반 감지 — 원인 단정 아님', '자동 복구 없음(제안만)'],
  });
  // Playback Failure: error rate 2배+ 이상 & 1%p 이상.
  if (isFiniteNumber(w.prevErrorRate) && isFiniteNumber(w.currErrorRate) && w.currErrorRate >= Math.max(1, w.prevErrorRate * 2)) {
    const sev: IncidentSeverity = w.currErrorRate >= 10 ? 'critical' : w.currErrorRate >= 5 ? 'high' : 'moderate';
    out.push(mk('playback_failure', sev, `Player Error ${w.prevErrorRate}% → ${w.currErrorRate}%`, 'error_rate', w.currErrorRate, w.prevErrorRate));
  }
  // Streaming Degradation: skip 1.5배+ 또는 completion -10pp 이상.
  if (isFiniteNumber(w.prevSkipRate) && isFiniteNumber(w.currSkipRate) && w.prevSkipRate > 0 && w.currSkipRate >= w.prevSkipRate * 1.5 && w.currSkipRate - w.prevSkipRate >= 3) {
    out.push(mk('streaming_degradation', w.currSkipRate >= w.prevSkipRate * 2 ? 'high' : 'moderate', `Skip ${w.prevSkipRate}% → ${w.currSkipRate}%`, 'skip_rate', w.currSkipRate, w.prevSkipRate));
  }
  if (isFiniteNumber(w.prevCompletion) && isFiniteNumber(w.currCompletion) && w.prevCompletion - w.currCompletion >= 10) {
    out.push(mk('streaming_degradation', w.prevCompletion - w.currCompletion >= 25 ? 'high' : 'moderate', `Completion ${w.prevCompletion}% → ${w.currCompletion}%`, 'completion_rate', w.currCompletion, w.prevCompletion));
  }
  return out;
}

/* ── Root Cause Analysis(상관 기반 후보 — 단정 아님) ────────────────────── */
export interface RootCauseCandidate { cause: string; confidence: number; chain: string[]; note: string }
export function analyzeRootCause(inc: DetectedIncident): RootCauseCandidate[] {
  const out: RootCauseCandidate[] = [];
  const errUp = inc.incidentType === 'playback_failure';
  const skipUp = inc.kpi.skip_rate != null;
  const compDown = inc.kpi.completion_rate != null;
  if (errUp) {
    out.push({ cause: 'cdn_or_network_degradation', confidence: 55, chain: ['Playback Failure', 'Player Error 증가', 'CDN/네트워크 응답 저하 가능'], note: '상관 기반 — CDN telemetry 미수집으로 확정 불가' });
    out.push({ cause: 'decoder_or_client_issue', confidence: 40, chain: ['Playback Failure', 'player_error', '특정 브라우저/디코더 이슈 가능'], note: 'decoder 구분 telemetry 없음' });
  }
  if (skipUp && !errUp) {
    out.push({ cause: 'content_mismatch', confidence: 50, chain: ['Skip 증가', 'Error 정상', 'Playlist-Context 부적합 가능'], note: '상관 기반' });
    out.push({ cause: 'rotation_fatigue', confidence: 40, chain: ['Skip 증가', '반복 노출 피로 가능'], note: 'rotation 상세 필요' });
  }
  if (compDown) {
    out.push({ cause: 'streaming_quality_degradation', confidence: 45, chain: ['Completion 하락', '재생 품질 저하 가능'], note: 'buffer telemetry 미수집' });
  }
  if (!out.length) out.push({ cause: 'unknown', confidence: 0, chain: ['신호 불충분'], note: 'insufficient_data' });
  return out.sort((a, b) => b.confidence - a.confidence || a.cause.localeCompare(b.cause));
}

/* ── Recovery Strategy Generator(제안만 — 자동 실행 금지) ───────────────── */
export type RecoveryStrategy = 'queue_rebuild' | 'playlist_reload' | 'cache_refresh' | 'retry_policy' | 'alternate_cdn' | 'local_fallback';
export interface RecoveryProposal { strategyType: RecoveryStrategy; description: string; preconditions: string[]; limitations: string[] }
const RECOVERY_CATALOG: Record<string, RecoveryProposal[]> = {
  cdn_or_network_degradation: [
    { strategyType: 'alternate_cdn', description: '대체 CDN 경로 검토', preconditions: ['대체 CDN 구성 존재 확인'], limitations: ['자동 전환 없음 — 운영자 실행'] },
    { strategyType: 'retry_policy', description: '재시도 정책(backoff) 검토', preconditions: ['클라이언트 재시도 설정 확인'], limitations: ['자동 배포 없음'] },
    { strategyType: 'local_fallback', description: 'Local Fallback 재생 검토', preconditions: ['Fallback 캐시 존재'], limitations: ['자동 전환 없음'] },
  ],
  decoder_or_client_issue: [
    { strategyType: 'cache_refresh', description: '클라이언트 캐시 갱신 안내 검토', preconditions: ['영향 브라우저 식별'], limitations: ['자동 배포 없음'] },
    { strategyType: 'retry_policy', description: '디코더 오류 재시도 검토', preconditions: [], limitations: ['자동 실행 없음'] },
  ],
  content_mismatch: [
    { strategyType: 'playlist_reload', description: 'Playlist 재구성 Draft 검토(기존 Generator 흐름)', preconditions: ['Context 분석 완료'], limitations: ['자동 Publish 없음 — Draft/승인 흐름'] },
  ],
  rotation_fatigue: [
    { strategyType: 'queue_rebuild', description: 'Rotation 기반 Queue 재구성 Draft 검토', preconditions: ['Fatigue 지표 확인'], limitations: ['자동 Queue 변경 없음 — Draft 만'] },
  ],
  streaming_quality_degradation: [
    { strategyType: 'cache_refresh', description: 'Cache Refresh 검토', preconditions: [], limitations: ['자동 실행 없음'] },
    { strategyType: 'local_fallback', description: 'Local Fallback 검토', preconditions: ['Fallback 캐시 존재'], limitations: ['자동 전환 없음'] },
  ],
};
export function generateRecoveryStrategies(causes: RootCauseCandidate[]): RecoveryProposal[] {
  const seen = new Set<string>(); const out: RecoveryProposal[] = [];
  for (const c of causes) {
    for (const p of RECOVERY_CATALOG[c.cause] ?? []) {
      if (seen.has(p.strategyType)) continue;
      seen.add(p.strategyType); out.push(p);
    }
  }
  return out;
}

/* ── Twin Validation 게이트(검증 실패 → Governance 제출 금지) ───────────── */
export type ValidationStatus = 'not_validated' | 'twin_validated' | 'twin_failed';
export function canSubmitToGovernance(validation: ValidationStatus): { allowed: boolean; reason: string } {
  if (validation === 'twin_validated') return { allowed: true, reason: 'Twin 검증 통과' };
  if (validation === 'twin_failed') return { allowed: false, reason: 'Twin 검증 실패 — Governance 제출 금지' };
  return { allowed: false, reason: 'Twin 미검증 — Digital Twin 검증 필수' };
}

/* ── Recovery Risk Assessment(없는 성분 null 재정규화) ──────────────────── */
export interface RiskInput {
  knowledgeSuccessRate?: number | null;   // 과거 동일 전략 실제 Outcome 성공률(없으면 null)
  twinConfidence?: number | null;
  blastRadius?: 'single_store' | 'industry' | 'fleet' | 'global' | null;
  recoveryTimeMin?: number | null;
}
export function assessRecoveryRisk(inp: RiskInput): { successProbability: number | null; confidence: number | null; businessImpact: 'low' | 'moderate' | 'high' | 'critical' | null } {
  const radiusPenalty = inp.blastRadius === 'global' ? 30 : inp.blastRadius === 'fleet' ? 20 : inp.blastRadius === 'industry' ? 10 : 0;
  const base = normalizeAvailableComponents([
    { key: 'knowledge_success', value: inp.knowledgeSuccessRate ?? null, weight: 0.6 },
    { key: 'twin_confidence', value: inp.twinConfidence ?? null, weight: 0.4 },
  ]);
  const successProbability = base.score == null ? null : clampScore(base.score - radiusPenalty);
  const confidence = inp.knowledgeSuccessRate != null && inp.twinConfidence != null ? clampScore((base.score ?? 0)) : inp.twinConfidence != null ? clampScore(inp.twinConfidence * 0.7) : null;
  const businessImpact = inp.blastRadius == null ? null : inp.blastRadius === 'global' ? 'critical' : inp.blastRadius === 'fleet' ? 'high' : inp.blastRadius === 'industry' ? 'moderate' : 'low';
  return { successProbability, confidence, businessImpact };
}

/* ── Recovery Knowledge Base 매칭(실제 Outcome 만) ──────────────────────── */
export interface RecoveryHistoryLike { strategyType: string; incidentType: string; outcome: 'pending' | 'succeeded' | 'failed' | 'not_applied' }
export function knowledgeSuccessRate(history: RecoveryHistoryLike[], strategyType: string, incidentType: string): number | null {
  const relevant = history.filter((h) => h.strategyType === strategyType && h.incidentType === incidentType && (h.outcome === 'succeeded' || h.outcome === 'failed'));
  if (relevant.length < 2) return null;   // 실제 Outcome 2건 미만 → 성공률 계산 안 함
  return clampScore((relevant.filter((h) => h.outcome === 'succeeded').length / relevant.length) * 100);
}

/* ── Playbook 파생(참고 문서 — 자동 실행 없음) ──────────────────────────── */
export interface PlaybookDraft { playbookCode: string; incidentType: IncidentType; title: string; steps: Array<{ order: number; action: string; note: string }>; evidence: Array<{ label: string; value: string | number }> }
export function derivePlaybook(incidentType: IncidentType, proposals: RecoveryProposal[], sourceCount: number): PlaybookDraft | null {
  if (!proposals.length || sourceCount < 1) return null;
  return {
    playbookCode: `pb_${incidentType}`,
    incidentType,
    title: `${incidentType} 대응 Playbook (사람 실행용 참고 절차)`,
    steps: [
      { order: 1, action: 'Incident KPI/Baseline 확인', note: '실측 telemetry 근거' },
      { order: 2, action: 'Root Cause 후보 검토', note: '상관 기반 — 단정 금지' },
      ...proposals.map((p, i) => ({ order: i + 3, action: `${p.strategyType}: ${p.description}`, note: p.limitations.join(' · ') })),
      { order: proposals.length + 3, action: 'Digital Twin 검증 → Governance Review', note: 'Twin 검증 실패 시 제출 금지' },
    ],
    evidence: [{ label: 'source_incidents', value: sourceCount }, { label: 'strategies', value: proposals.length }],
  };
}

/* ── Self-Healing Score(실측 성분만 — Outcome 없으면 null) ──────────────── */
export interface SelfHealingScoreInput {
  detectionSpeedScore?: number | null;    // 감지→분석 착수 시간 기반(없으면 null)
  rcaAccuracy?: number | null;            // 확정 원인 대비 후보 적중(Outcome 필요)
  recoveryAccuracy?: number | null;       // 실제 succeeded 비율(Outcome 필요)
  falsePositiveRate?: number | null;      // false_positive / total
  mttrHours?: number | null;
}
export function calculateSelfHealingScore(inp: SelfHealingScoreInput): { score: number | null; grade: 'strong' | 'developing' | 'weak' | 'insufficient_data'; missing: string[] } {
  const fpScore = isFiniteNumber(inp.falsePositiveRate) ? clampScore(100 - inp.falsePositiveRate) : null;
  const mttrScore = isFiniteNumber(inp.mttrHours) ? clampScore(100 - Math.min(100, inp.mttrHours * 4)) : null;
  const r = normalizeAvailableComponents([
    { key: 'detection_speed', value: inp.detectionSpeedScore ?? null, weight: 0.2 },
    { key: 'rca_accuracy', value: inp.rcaAccuracy ?? null, weight: 0.25 },
    { key: 'recovery_accuracy', value: inp.recoveryAccuracy ?? null, weight: 0.25 },
    { key: 'false_positive', value: fpScore, weight: 0.15 },
    { key: 'mttr', value: mttrScore, weight: 0.15 },
  ]);
  if (r.score == null) return { score: null, grade: 'insufficient_data', missing: r.missing };
  return { score: r.score, grade: r.score >= 70 ? 'strong' : r.score >= 45 ? 'developing' : 'weak', missing: r.missing };
}

export function selfHealingInputHash(parts: Array<string | number | null | undefined>): string {
  const s = parts.map((p) => (p == null ? '' : String(p))).join('|');
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `heal_${(h >>> 0).toString(16)}`;
}

/* ── Support Matrix ─────────────────────────────────────────────────────── */
export type HealSupportStatus = 'fully_supported' | 'partially_supported' | 'read_only' | 'evidence_only' | 'unsupported' | 'insufficient_data';
export interface HealSupport { key: string; label: string; status: HealSupportStatus; note: string }
export const HEAL_SUPPORT: HealSupport[] = [
  { key: 'detection_playback', label: 'Incident Detection (Playback/Streaming)', status: 'fully_supported', note: 'player_error/skip/completion 실측' },
  { key: 'detection_infra', label: 'Incident Detection (Queue/Scheduler/Store/API/DB/AI)', status: 'unsupported', note: '해당 telemetry 미수집(가짜 감지 없음)' },
  { key: 'rca', label: 'Root Cause Analysis', status: 'partially_supported', note: '상관 기반 후보만(단정 아님) — CDN/buffer telemetry 없음' },
  { key: 'recovery_gen', label: 'Recovery Strategy Generator', status: 'evidence_only', note: '6종 전략 제안만(자동 실행 금지)' },
  { key: 'twin_validation', label: 'Digital Twin Validation', status: 'fully_supported', note: '0499 Run 참조 — 실패 시 Governance 제출 금지(RPC 게이트)' },
  { key: 'risk', label: 'Recovery Risk Assessment', status: 'partially_supported', note: 'Knowledge 성공률/Twin confidence 재정규화(없으면 null)' },
  { key: 'knowledge_base', label: 'Recovery Knowledge Base', status: 'partially_supported', note: '실제 Outcome 만 축적(2건 미만 → 성공률 미계산)' },
  { key: 'playbook', label: 'Autonomous Playbook', status: 'evidence_only', note: '사람 실행용 참고 절차(자동 실행 필드 없음)' },
  { key: 'timeline', label: 'Incident Timeline', status: 'fully_supported', note: 'Detection→Analysis→Twin→Governance→Resolution 기록' },
  { key: 'score', label: 'Self-Healing Score', status: 'insufficient_data', note: 'Outcome 축적 전 성분 null(재정규화)' },
  { key: 'governance', label: 'Governance Integration', status: 'read_only', note: 'Twin 검증 게이트 후 Review 제출(기존 흐름 무변경)' },
  { key: 'auto_recovery', label: 'Automatic Recovery Execution', status: 'unsupported', note: '금지 — 자동 복구/Rollback/Apply 없음' },
  { key: 'production_apply', label: 'Production Apply', status: 'unsupported', note: '금지 — Evidence Only' },
];

/* ── 라벨/톤 ────────────────────────────────────────────────────────────── */
export const SEVERITY_TONE: Record<IncidentSeverity, 'neutral' | 'info' | 'warning' | 'danger'> = { low: 'neutral', moderate: 'info', high: 'warning', critical: 'danger' };
export const INCIDENT_STATUS_LABEL: Record<string, string> = { detected: '감지됨', analyzing: '분석 중', rca_complete: 'RCA 완료', twin_validated: 'Twin 검증됨', governance_review: 'Governance Review', recovery_candidate: 'Recovery Candidate', resolved: '해결됨', false_positive: 'False Positive', closed: '종료' };
export const INCIDENT_STATUS_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'danger' | 'success'> = { detected: 'warning', analyzing: 'info', rca_complete: 'info', twin_validated: 'success', governance_review: 'warning', recovery_candidate: 'success', resolved: 'success', false_positive: 'neutral', closed: 'neutral' };
export const VALIDATION_LABEL: Record<ValidationStatus, string> = { not_validated: '미검증', twin_validated: 'Twin 통과', twin_failed: 'Twin 실패' };
export const VALIDATION_TONE: Record<ValidationStatus, 'neutral' | 'success' | 'danger'> = { not_validated: 'neutral', twin_validated: 'success', twin_failed: 'danger' };
export const STRATEGY_LABEL: Record<RecoveryStrategy, string> = { queue_rebuild: 'Queue Rebuild(Draft)', playlist_reload: 'Playlist Reload(Draft)', cache_refresh: 'Cache Refresh', retry_policy: 'Retry Policy', alternate_cdn: 'Alternate CDN', local_fallback: 'Local Fallback' };
