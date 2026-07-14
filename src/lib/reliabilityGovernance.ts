/**
 * reliabilityGovernance — Service Reliability Objectives, Error Budget Governance &
 * Release Risk Control 순수 로직 (Phase AI-OPS-4).
 *
 * 개별 Change 의 성공·실패(AI-OPS-3)를 넘어 SLI → SLO → Error Budget → Burn Rate →
 * Change/Incident Correlation → Release Risk → Freeze **권고** → 사람 결정 → Evidence 만.
 *
 * 원칙: 실제 Telemetry 없는 SLI 없음 · total=0/allowed=0 나눗셈 금지(null 유지) ·
 *       데이터 공백을 정상 시간으로 계산 금지 · 관측 불가 시간 Availability 100% 금지 ·
 *       Error Budget ≠ 실행 권한 · 자동 Freeze/Release 차단/Rollback/Certification 없음 ·
 *       과거 기간에 현재 Policy 소급 적용 금지 · deterministic · Date 주입.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

export { isFiniteNumber, clampScore, normalizeAvailableComponents };

export const RELIABILITY_SOURCE_VERSION = 'reliability_v1(0507)';

/* ── Reliability Domain(실제 Telemetry 로 확정) ─────────────────────────── */
export type ReliabilityDomain = 'playback' | 'streaming_quality' | 'availability' | 'queue' | 'scheduler' | 'store_player' | 'api' | 'database' | 'ai_decision' | 'governance' | 'fleet';
export type SupportStatus = 'fully_supported' | 'partially_supported' | 'observation_only' | 'evidence_only' | 'provisional' | 'unsupported' | 'insufficient_data';
export const RELIABILITY_DOMAINS: Array<{ domain: ReliabilityDomain; label: string; status: SupportStatus; note: string }> = [
  { domain: 'playback', label: 'Playback', status: 'partially_supported', note: 'playback_events_v2 실측 — error-free/completion/start-success(proxy)' },
  { domain: 'governance', label: 'Governance', status: 'partially_supported', note: 'ai_governance_events 실측 — compliance/audit completeness(기록된 활동 한정)' },
  { domain: 'availability', label: 'Availability', status: 'provisional', note: 'store_monitoring_status 현재 시점 스냅샷만 — heartbeat 히스토리 없어 기간형 uptime 미지원' },
  { domain: 'fleet', label: 'Fleet', status: 'partially_supported', note: 'store/franchise scope 로 playback SLI 분할 가능(전용 telemetry 없음)' },
  { domain: 'ai_decision', label: 'AI Decision', status: 'evidence_only', note: 'Operations/Observation 기록 기반 evidence — 비율형 SLI 아님' },
  { domain: 'store_player', label: 'Store Player', status: 'insufficient_data', note: 'playback_error 필드는 현재 상태만 — 이벤트 히스토리 없음' },
  { domain: 'streaming_quality', label: 'Streaming Quality', status: 'unsupported', note: 'stream_quality 전부 null(0477 분석) — buffer/stall/TTFA/decoder 미수집' },
  { domain: 'queue', label: 'Queue', status: 'unsupported', note: 'queue depth/stall telemetry 미수집' },
  { domain: 'scheduler', label: 'Scheduler', status: 'unsupported', note: 'scheduler drift/miss telemetry 미수집' },
  { domain: 'api', label: 'API', status: 'unsupported', note: 'API latency telemetry 미수집' },
  { domain: 'database', label: 'Database', status: 'unsupported', note: 'DB latency telemetry 미수집' },
];

/* ── SLI Metric whitelist(실측 6종) ─────────────────────────────────────── */
export type SliMetricCode = 'player_error_free_ratio' | 'completion_ratio' | 'playback_start_success_ratio' | 'constitution_compliance_ratio' | 'audit_completeness_ratio' | 'store_online_ratio_point_in_time';
export const SLI_METRICS: SliMetricCode[] = ['player_error_free_ratio', 'completion_ratio', 'playback_start_success_ratio', 'constitution_compliance_ratio', 'audit_completeness_ratio', 'store_online_ratio_point_in_time'];
export const COMPLIANCE_WINDOWS = ['rolling_1h', 'rolling_6h', 'rolling_24h', 'rolling_7d', 'rolling_28d'] as const;
export type ComplianceWindow = (typeof COMPLIANCE_WINDOWS)[number];
export const UNSUPPORTED_WINDOWS = ['calendar_day', 'calendar_week', 'calendar_month']; // 미구현 — 지원 주장 안 함

export interface SliDefinitionLike { indicator_code?: unknown; domain?: unknown; metric_code?: unknown; good_event_definition?: unknown; total_event_definition?: unknown; source_type?: unknown }
export function validateSliDefinition(d: SliDefinitionLike | null): string[] {
  if (!d) return ['SLI 정의 없음'];
  const errors: string[] = [];
  if (!d.indicator_code) errors.push('indicator_code 필수');
  if (!RELIABILITY_DOMAINS.some((x) => x.domain === d.domain)) errors.push('domain whitelist 위반');
  if (!SLI_METRICS.includes(d.metric_code as SliMetricCode)) errors.push(`metric ${String(d.metric_code)} — 실제 Telemetry 없는 SLI 생성 금지`);
  if (!d.good_event_definition || !d.total_event_definition) errors.push('good/total event 정의 필수');
  if (!d.source_type) errors.push('source 필수');
  return errors;
}

/* ── SLI 계산(0 나눗셈 방어 · null→0 금지) ──────────────────────────────── */
export function calculateSli(goodEvents: number | null, totalEvents: number | null): number | null {
  if (!isFiniteNumber(goodEvents) || !isFiniteNumber(totalEvents)) return null;
  if (totalEvents <= 0) return null; // total 0 → 나눗셈하지 않음
  const v = (goodEvents / totalEvents) * 100;
  if (!isFiniteNumber(v)) return null;
  return Math.min(100, Math.max(0, Math.round(v * 1000) / 1000));
}

/* ── Data Coverage(공백을 정상 시간으로 계산 안 함) ─────────────────────── */
export type CoverageResult = 'complete' | 'sufficient' | 'partial' | 'data_gap' | 'insufficient_data';
export function calculateDataCoverage(inp: { expectedIntervals: number; observedIntervals: number | null; telemetryDelayed?: boolean }): { coveragePct: number | null; result: CoverageResult } {
  if (!isFiniteNumber(inp.observedIntervals) || !isFiniteNumber(inp.expectedIntervals) || inp.expectedIntervals <= 0) return { coveragePct: null, result: 'insufficient_data' };
  const pct = Math.min(100, Math.round((inp.observedIntervals / inp.expectedIntervals) * 1000) / 10);
  if (inp.telemetryDelayed) return { coveragePct: pct, result: pct < 50 ? 'data_gap' : 'partial' };
  const result: CoverageResult = pct >= 99 ? 'complete' : pct >= 80 ? 'sufficient' : pct >= 50 ? 'partial' : 'data_gap';
  return { coveragePct: pct, result };
}

/* ── SLO Compliance ─────────────────────────────────────────────────────── */
export type SloCompliance = 'meeting' | 'at_risk' | 'breached' | 'data_gap' | 'insufficient_data' | 'unsupported' | 'invalid';
export interface SloComplianceInput {
  targetPct: number; actualSliPct: number | null; sampleSize: number | null; minSample: number;
  coveragePct: number | null; minCoveragePct: number; window: string; windowDataAvailable: boolean;
}
export function evaluateSloCompliance(inp: SloComplianceInput): { compliance: SloCompliance; reasons: string[] } {
  if (!COMPLIANCE_WINDOWS.includes(inp.window as ComplianceWindow)) return { compliance: 'unsupported', reasons: [`window ${inp.window} 미지원`] };
  if (!isFiniteNumber(inp.targetPct) || inp.targetPct < 0 || inp.targetPct > 100) return { compliance: 'invalid', reasons: ['target 0~100 위반'] };
  if (!inp.windowDataAvailable) return { compliance: 'insufficient_data', reasons: ['장기 데이터 없음 — 단기 정상을 장기 달성으로 해석하지 않음'] };
  if (inp.actualSliPct === null) return { compliance: 'insufficient_data', reasons: ['실측 SLI 없음(total 0)'] };
  if (!isFiniteNumber(inp.actualSliPct)) return { compliance: 'invalid', reasons: ['SLI NaN/Infinity'] };
  if (!isFiniteNumber(inp.sampleSize) || inp.sampleSize < inp.minSample) return { compliance: 'insufficient_data', reasons: [`sample ${inp.sampleSize ?? 'null'} < 최소 ${inp.minSample} — Event 수만으로 신뢰도를 올리지 않음`] };
  if (!isFiniteNumber(inp.coveragePct) || inp.coveragePct < inp.minCoveragePct) return { compliance: 'data_gap', reasons: ['coverage 미달 — Pass/Fail 판정하지 않음'] };
  if (inp.actualSliPct < inp.targetPct) return { compliance: 'breached', reasons: [`actual ${inp.actualSliPct} < target ${inp.targetPct}`] };
  // meeting 이지만 budget 소진이 크면 at_risk
  const budget = calculateErrorBudget({ targetPct: inp.targetPct, actualSliPct: inp.actualSliPct });
  if (budget.consumptionPct !== null && budget.consumptionPct >= 75) return { compliance: 'at_risk', reasons: [`error budget ${budget.consumptionPct}% 소진`] };
  return { compliance: 'meeting', reasons: [] };
}

/* ── Error Budget(비율형 SLI 전용 · 실행 권한 아님) ─────────────────────── */
export type BudgetStatus = 'healthy' | 'caution' | 'low' | 'exhausted' | 'data_gap' | 'insufficient_data';
export function calculateErrorBudget(inp: { targetPct: number; actualSliPct: number | null; coverageOk?: boolean }): {
  budgetTotalPct: number | null; consumedPct: number | null; remainingPct: number | null; consumptionPct: number | null; status: BudgetStatus; notExecutionAuthority: true;
} {
  const none = (status: BudgetStatus) => ({ budgetTotalPct: null, consumedPct: null, remainingPct: null, consumptionPct: null, status, notExecutionAuthority: true as const });
  if (!isFiniteNumber(inp.targetPct) || inp.targetPct < 0 || inp.targetPct > 100) return none('insufficient_data');
  if (inp.coverageOk === false) return none('data_gap');
  if (!isFiniteNumber(inp.actualSliPct)) return none('insufficient_data');
  const budgetTotal = Math.round((100 - inp.targetPct) * 1000) / 1000;
  const consumed = Math.round((100 - inp.actualSliPct) * 1000) / 1000;      // 관측된 bad event 비율
  const remaining = Math.round((budgetTotal - consumed) * 1000) / 1000;
  const consumptionPct = budgetTotal > 0 ? Math.round((consumed / budgetTotal) * 1000) / 10 : null; // 허용 오류 0 → 나눗셈하지 않음
  let status: BudgetStatus;
  if (consumptionPct === null) status = consumed > 0 ? 'exhausted' : 'healthy'; // target 100% — 오류 1건도 소진
  else if (consumptionPct >= 100) status = 'exhausted';
  else if (consumptionPct >= 75) status = 'low';
  else if (consumptionPct >= 50) status = 'caution';
  else status = 'healthy';
  return { budgetTotalPct: budgetTotal, consumedPct: consumed, remainingPct: remaining, consumptionPct, status, notExecutionAuthority: true };
}

/* ── Burn Rate(허용 오류 0 → null) ──────────────────────────────────────── */
export function calculateBurnRate(observedErrorRatePct: number | null, allowedErrorRatePct: number | null): number | null {
  if (!isFiniteNumber(observedErrorRatePct) || !isFiniteNumber(allowedErrorRatePct)) return null;
  if (allowedErrorRatePct <= 0) return null; // 나눗셈하지 않음
  const r = observedErrorRatePct / allowedErrorRatePct;
  return isFiniteNumber(r) ? Math.round(r * 100) / 100 : null;
}
export type BurnRateClass = 'normal' | 'elevated' | 'fast_burn' | 'severe_burn' | 'exhausted' | 'insufficient_data' | 'invalid';
/** 고정 임계치(1/2/10) 사용 — 실데이터 분포 기반 조정 가능하도록 threshold 주입 지원. 근거/제한 명시. */
export function classifyBurnRate(rate: number | null, opts: { budgetExhausted?: boolean; elevatedAt?: number; fastAt?: number; severeAt?: number } = {}): BurnRateClass {
  if (opts.budgetExhausted) return 'exhausted';
  if (rate === null) return 'insufficient_data';
  if (!isFiniteNumber(rate) || rate < 0) return 'invalid';
  const { elevatedAt = 1, fastAt = 2, severeAt = 10 } = opts;
  if (rate >= severeAt) return 'severe_burn';
  if (rate >= fastAt) return 'fast_burn';
  if (rate >= elevatedAt) return 'elevated';
  return 'normal';
}

/* ── Multi-Window Burn(단기 Spike 만으로 Freeze 권고 안 함) ─────────────── */
export type MultiWindowBurn = 'transient_spike' | 'sustained_burn' | 'critical_burn' | 'stable' | 'insufficient_data';
export function evaluateMultiWindowBurn(inp: { shortBurn: BurnRateClass; longBurn: BurnRateClass; dataDelayed?: boolean }): { result: MultiWindowBurn; reasons: string[] } {
  const high = (c: BurnRateClass) => c === 'fast_burn' || c === 'severe_burn' || c === 'exhausted';
  const elevated = (c: BurnRateClass) => c === 'elevated' || high(c);
  if (inp.shortBurn === 'insufficient_data' || inp.longBurn === 'insufficient_data' || inp.dataDelayed) return { result: 'insufficient_data', reasons: ['burn window 데이터 부족/지연'] };
  if (inp.shortBurn === 'invalid' || inp.longBurn === 'invalid') return { result: 'insufficient_data', reasons: ['invalid burn 입력'] };
  if (high(inp.shortBurn) && high(inp.longBurn)) return { result: 'critical_burn', reasons: ['단기+장기 동시 고소진'] };
  if (elevated(inp.shortBurn) && elevated(inp.longBurn)) return { result: 'sustained_burn', reasons: ['단기+장기 지속 소진'] };
  if (high(inp.shortBurn) && !elevated(inp.longBurn)) return { result: 'transient_spike', reasons: ['단기 spike — 장기 정상(단독으로 Freeze 권고 아님)'] };
  return { result: 'stable', reasons: [] };
}

/* ── Change ↔ Reliability Correlation(인과 단정 없음) ───────────────────── */
export type ChangeCorrelation = 'temporally_correlated' | 'scope_correlated' | 'release_correlated' | 'possibly_related' | 'unrelated' | 'insufficient_data';
export interface ChangeLike { executedAt: string | null; scopeKeys: string[]; version: string | null }
export interface DegradationLike { startedAt: string | null; scopeKeys: string[]; version: string | null; windowHours?: number }
export function correlateChangeWithReliability(change: ChangeLike, deg: DegradationLike): { correlation: ChangeCorrelation; timeMatch: boolean; scopeMatch: boolean; releaseMatch: boolean } {
  const none = { timeMatch: false, scopeMatch: false, releaseMatch: false };
  if (!change.executedAt || !deg.startedAt) return { correlation: 'insufficient_data', ...none };
  const c = Date.parse(change.executedAt); const d = Date.parse(deg.startedAt);
  if (!Number.isFinite(c) || !Number.isFinite(d)) return { correlation: 'insufficient_data', ...none };
  const win = (deg.windowHours ?? 24) * 3600_000;
  const timeMatch = d >= c && d - c <= win;                       // 변경 직후 악화
  const scopeMatch = change.scopeKeys.some((k) => deg.scopeKeys.includes(k));
  const releaseMatch = !!change.version && !!deg.version && change.version === deg.version;
  const matches = [timeMatch, scopeMatch, releaseMatch].filter(Boolean).length;
  const correlation: ChangeCorrelation =
    matches >= 2 ? 'possibly_related'
    : releaseMatch ? 'release_correlated'
    : timeMatch ? 'temporally_correlated'
    : scopeMatch ? 'scope_correlated'
    : 'unrelated';
  return { correlation, timeMatch, scopeMatch, releaseMatch }; // 상관 표기 — 인과관계 단정 아님
}

/* ── Release Risk(0~100 · 없는 성분 재정규화) ───────────────────────────── */
export interface ReleaseRiskComponents {
  sloComplianceRisk: number | null; errorBudgetRisk: number | null; shortBurnRisk: number | null; longBurnRisk: number | null;
  incidentRisk: number | null; regressionRisk: number | null; certificationRisk: number | null; changeFrequencyRisk: number | null;
  uncertifiedChangeRisk: number | null; monitoringCoverageRisk: number | null; rollbackReadinessRisk: number | null; governanceRisk: number | null;
}
const RISK_WEIGHTS: Record<keyof ReleaseRiskComponents, number> = {
  sloComplianceRisk: 16, errorBudgetRisk: 14, shortBurnRisk: 8, longBurnRisk: 10, incidentRisk: 12, regressionRisk: 10,
  certificationRisk: 8, changeFrequencyRisk: 4, uncertifiedChangeRisk: 6, monitoringCoverageRisk: 5, rollbackReadinessRisk: 4, governanceRisk: 3,
};
export function calculateReleaseRisk(c: ReleaseRiskComponents): { score: number | null; availableComponents: number; missing: string[] } {
  const components = (Object.keys(RISK_WEIGHTS) as Array<keyof ReleaseRiskComponents>).map((k) => ({ key: k as string, value: c[k], weight: RISK_WEIGHTS[k] }));
  const base = normalizeAvailableComponents(components); // 없는 성분 제외 후 재정규화(aiMemory 재사용)
  return { score: base.score, availableComponents: base.used.length, missing: base.missing };
}
export type ReleaseRiskStatus = 'low' | 'moderate' | 'high' | 'critical' | 'insufficient_data';
export interface ReleaseRiskContext { criticalSloBreached: boolean; budgetExhausted: boolean; sustainedSevereBurn: boolean; activeCriticalIncident: boolean; recentNotCertified: boolean; monitoringGapWithHighRiskChange: boolean }
export function classifyReleaseRisk(score: number | null, ctx: ReleaseRiskContext): { status: ReleaseRiskStatus; reasons: string[]; noAutoBlock: true } {
  const criticals: string[] = [];
  if (ctx.criticalSloBreached) criticals.push('critical SLO breach');
  if (ctx.budgetExhausted) criticals.push('error budget exhausted');
  if (ctx.sustainedSevereBurn) criticals.push('sustained severe burn');
  if (ctx.activeCriticalIncident) criticals.push('active critical incident');
  if (ctx.recentNotCertified) criticals.push('최근 change not_certified');
  if (ctx.monitoringGapWithHighRiskChange) criticals.push('monitoring gap + high risk change');
  if (criticals.length > 0) return { status: 'critical', reasons: [...criticals, 'critical 이어도 자동 배포 차단 없음'], noAutoBlock: true };
  if (score === null) return { status: 'insufficient_data', reasons: ['risk 성분 없음'], noAutoBlock: true };
  const status: ReleaseRiskStatus = score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'moderate' : 'low';
  return { status, reasons: [], noAutoBlock: true };
}

/* ── Freeze Recommendation(권고 전용 — 자동 Freeze 없음) ────────────────── */
export type FreezeRecommendation = 'no_freeze_needed' | 'monitor_before_change' | 'freeze_recommended' | 'critical_freeze_recommended' | 'manual_review_required' | 'insufficient_data';
export interface FreezeInput {
  dataSufficient: boolean; sloBreached: boolean; criticalSloBreached: boolean; budgetExhausted: boolean; budgetLow: boolean;
  multiWindowBurn: MultiWindowBurn; activeCriticalIncident: boolean; recentCertificationFailed: boolean; monitoringGap: boolean; rollbackIncomplete: boolean; governanceWarning: boolean;
}
export function assessFreezeRecommendation(inp: FreezeInput): { recommendation: FreezeRecommendation; reasons: string[]; executionBlocked: true } {
  const done = (recommendation: FreezeRecommendation, reasons: string[]) => {
    reasons.push('본 결과는 권고이며 시스템이 Freeze/배포 차단을 실행하지 않는다(사람 결정 필요)');
    return { recommendation, reasons, executionBlocked: true as const };
  };
  if (!inp.dataSufficient) return done('insufficient_data', ['관측 데이터 부족']);
  if (inp.monitoringGap || inp.rollbackIncomplete) return done('manual_review_required', [inp.monitoringGap ? 'monitoring gap' : 'rollback 준비 불완전']);
  if (inp.criticalSloBreached || inp.budgetExhausted || inp.multiWindowBurn === 'critical_burn' || inp.activeCriticalIncident) {
    return done('critical_freeze_recommended', ['critical SLO/budget exhausted/critical burn/critical incident']);
  }
  if (inp.sloBreached || inp.multiWindowBurn === 'sustained_burn' || inp.recentCertificationFailed) {
    return done('freeze_recommended', ['SLO breach/지속 burn/최근 인증 실패']);
  }
  if (inp.budgetLow || inp.multiWindowBurn === 'transient_spike' || inp.governanceWarning) {
    return done('monitor_before_change', ['budget low/일시 spike/governance warning — 변경 전 관측 권장']);
  }
  return done('no_freeze_needed', []);
}

/* ── Human Freeze Decision / Freeze Reference ───────────────────────────── */
export const FREEZE_DECISIONS = ['continue_changes', 'restrict_high_risk_changes', 'temporary_freeze_requested', 'freeze_accepted_reference', 'freeze_rejected', 'emergency_exception_requested', 'invalidated'] as const;
export type FreezeDecision = (typeof FREEZE_DECISIONS)[number];
export interface FreezeReferenceLike { external_freeze_id?: unknown; freeze_scope?: unknown; freeze_started_at?: unknown; freeze_expires_at?: unknown; applied_by?: unknown; external_system?: unknown }
/** 외부 수동 Freeze 의 참고 기록 검증 — 실제 Freeze 동작 여부를 자동으로 단정하지 않음. */
export function validateFreezeReference(ref: FreezeReferenceLike | null): { errors: string[]; appliedNotVerified: true } {
  const errors: string[] = [];
  if (!ref) errors.push('freeze reference 없음');
  else for (const k of ['external_freeze_id', 'freeze_scope', 'freeze_started_at', 'applied_by', 'external_system'] as const) {
    if (!ref[k]) errors.push(`${k} 필수`);
  }
  return { errors, appliedNotVerified: true };
}
export function isFreezeReferenceExpired(ref: { freeze_expires_at?: string | null }, now: Date): boolean | null {
  if (!ref.freeze_expires_at) return null; // 만료 정보 없음 — 임의 판정 안 함
  const t = Date.parse(ref.freeze_expires_at);
  if (!Number.isFinite(t)) return null;
  return now.getTime() > t;
}

/* ── Change Velocity(DORA 임의 주장 없음) ───────────────────────────────── */
export interface VelocityInput { totalChanges: number; highRiskChanges: number; certified: number; failed: number; rollbackRequested: number; observationHours: number[]; certificationHours: number[] }
export function calculateChangeVelocity(inp: VelocityInput): {
  changeCount: number; highRiskCount: number; certifiedRatioPct: number | null; failedRatioPct: number | null; rollbackRatioPct: number | null;
  meanObservationHours: number | null; meanCertificationHours: number | null; status: 'available' | 'insufficient_data'; doraClaim: false;
} {
  const ratio = (n: number) => (inp.totalChanges > 0 ? Math.round((n / inp.totalChanges) * 1000) / 10 : null);
  const mean = (xs: number[]) => {
    const v = xs.filter((x) => isFiniteNumber(x));
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  };
  return {
    changeCount: inp.totalChanges, highRiskCount: inp.highRiskChanges,
    certifiedRatioPct: ratio(inp.certified), failedRatioPct: ratio(inp.failed), rollbackRatioPct: ratio(inp.rollbackRequested),
    meanObservationHours: mean(inp.observationHours), meanCertificationHours: mean(inp.certificationHours),
    status: inp.totalChanges >= 5 ? 'available' : 'insufficient_data', // 표본 부족 정직 표기
    doraClaim: false, // 업계 표준 DORA 지표 지원을 임의 주장하지 않음
  };
}

/* ── Reliability Certification(자동 인증 없음) ──────────────────────────── */
export type ReliabilityCertification = 'reliability_certified' | 'reliability_certified_with_conditions' | 'reliability_at_risk' | 'reliability_not_certified' | 'insufficient_data' | 'invalidated';
export interface ReliabilityCertInput {
  dataSufficient: boolean; requiredSlosMeeting: boolean; criticalSloBreached: boolean; budgetExhausted: boolean;
  sustainedCriticalBurn: boolean; activeCriticalIncident: boolean; uncertifiedHighRiskChanges: number;
  coverageSufficient: boolean; humanReviewed: boolean; evidenceComplete: boolean; warningSignals: number; invalidated?: boolean;
}
export function evaluateReliabilityCertification(inp: ReliabilityCertInput): { result: ReliabilityCertification; reasons: string[]; requiresHumanApproval: true } {
  const done = (result: ReliabilityCertification, reasons: string[]) => {
    reasons.push('최종 Reliability Certification 은 사람이 사유와 함께 확정한다(자동 인증 없음)');
    return { result, reasons, requiresHumanApproval: true as const };
  };
  if (inp.invalidated) return done('invalidated', ['무효화']);
  if (!inp.dataSufficient) return done('insufficient_data', ['관측 데이터 부족']);
  const blockers: string[] = [];
  if (inp.criticalSloBreached) blockers.push('critical SLO breach');
  if (inp.budgetExhausted) blockers.push('error budget exhausted');
  if (inp.sustainedCriticalBurn) blockers.push('sustained critical burn');
  if (inp.activeCriticalIncident) blockers.push('active critical incident');
  if (inp.uncertifiedHighRiskChanges > 0) blockers.push(`미인증 high risk change ${inp.uncertifiedHighRiskChanges}건`);
  if (blockers.length > 0) return done('reliability_not_certified', blockers);
  if (!inp.coverageSufficient) return done('insufficient_data', ['monitoring coverage 부족 — 인증 판정하지 않음']);
  if (!inp.humanReviewed) return done('reliability_not_certified', ['사람 review 미완료']);
  if (!inp.evidenceComplete) return done('reliability_not_certified', ['evidence 불완전']);
  if (!inp.requiredSlosMeeting) return done('reliability_at_risk', ['필수 SLO 미달']);
  if (inp.warningSignals > 0) return done('reliability_certified_with_conditions', [`warning 신호 ${inp.warningSignals}건 — 조건부`]);
  return done('reliability_certified', []);
}

/* ── Policy Versioning(과거 소급 적용 금지) ─────────────────────────────── */
export interface PolicyVersionLike { version?: unknown; effective_from?: unknown; effective_to?: unknown; change_reason?: unknown; approved_by?: unknown; checksum?: unknown }
export function validatePolicyVersion(p: PolicyVersionLike | null, evaluationPeriod?: { start: string; end: string }): string[] {
  if (!p) return ['policy 없음'];
  const errors: string[] = [];
  if (!isFiniteNumber(p.version) || (p.version as number) < 1) errors.push('version 필수(>=1)');
  if (!p.effective_from) errors.push('effective_from 필수');
  if (!p.change_reason) errors.push('change_reason 필수(사람 승인 없는 Policy 변경 금지)');
  if (!p.checksum) errors.push('checksum 필수');
  if (evaluationPeriod && p.effective_from) {
    const from = Date.parse(String(p.effective_from));
    const to = p.effective_to ? Date.parse(String(p.effective_to)) : Infinity;
    const evalStart = Date.parse(evaluationPeriod.start); const evalEnd = Date.parse(evaluationPeriod.end);
    if (Number.isFinite(from) && Number.isFinite(evalStart) && (evalStart < from || evalEnd > to)) {
      errors.push('평가 기간이 Policy 유효 기간 밖 — 현재 목표값을 과거 기간에 소급 적용 금지');
    }
  }
  return errors;
}

/* ── Reliability Package(사람 확인용 Evidence) ──────────────────────────── */
export function buildReliabilityPackage(inp: {
  domain: string; indicator: string; window: string; target: number | null; actual: number | null;
  budget: ReturnType<typeof calculateErrorBudget> | null; burn: { short: BurnRateClass; long: BurnRateClass } | null;
  risk: { score: number | null; status: ReleaseRiskStatus } | null; freeze: FreezeRecommendation | null;
  certification: ReliabilityCertification | null; limitations: string[];
}): Array<{ section: string; content: unknown }> {
  return [
    { section: 'Domain / Indicator', content: `${inp.domain} / ${inp.indicator}` },
    { section: 'Window', content: inp.window },
    { section: 'SLO Target', content: inp.target ?? 'insufficient_data' },
    { section: 'Actual SLI (실측)', content: inp.actual ?? 'insufficient_data' },
    { section: 'Error Budget', content: inp.budget ?? 'insufficient_data' },
    { section: 'Burn Rate', content: inp.burn ?? 'insufficient_data' },
    { section: 'Release Risk', content: inp.risk ?? 'insufficient_data' },
    { section: 'Freeze Recommendation', content: inp.freeze ? `${inp.freeze} (권고 — 실행 아님)` : 'insufficient_data' },
    { section: 'Certification', content: inp.certification ?? 'pending(사람 판정 대기)' },
    { section: 'Limitations', content: inp.limitations },
  ];
}

/* ── UI 라벨/톤 ─────────────────────────────────────────────────────────── */
export const SLO_TONE: Record<SloCompliance, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  meeting: 'success', at_risk: 'warning', breached: 'danger', data_gap: 'warning', insufficient_data: 'neutral', unsupported: 'neutral', invalid: 'danger',
};
export const BUDGET_TONE: Record<BudgetStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  healthy: 'success', caution: 'info', low: 'warning', exhausted: 'danger', data_gap: 'warning', insufficient_data: 'neutral',
};
export const BURN_TONE: Record<BurnRateClass, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  normal: 'success', elevated: 'info', fast_burn: 'warning', severe_burn: 'danger', exhausted: 'danger', insufficient_data: 'neutral', invalid: 'danger',
};
export const FREEZE_TONE: Record<FreezeRecommendation, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  no_freeze_needed: 'success', monitor_before_change: 'info', freeze_recommended: 'warning', critical_freeze_recommended: 'danger', manual_review_required: 'warning', insufficient_data: 'neutral',
};
export const RELCERT_TONE: Record<ReliabilityCertification, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  reliability_certified: 'success', reliability_certified_with_conditions: 'warning', reliability_at_risk: 'warning', reliability_not_certified: 'danger', insufficient_data: 'neutral', invalidated: 'neutral',
};
export const RISK_TONE: Record<ReleaseRiskStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  low: 'success', moderate: 'info', high: 'warning', critical: 'danger', insufficient_data: 'neutral',
};

/* ── Support Matrix ─────────────────────────────────────────────────────── */
export const REL_SUPPORT: Array<{ key: string; label: string; status: SupportStatus; note: string }> = [
  { key: 'playback_sli', label: 'Playback SLI', status: 'partially_supported', note: 'error-free/completion/start-success(proxy) 실측' },
  { key: 'streaming_quality_sli', label: 'Streaming Quality SLI', status: 'unsupported', note: 'stream_quality 전부 null — telemetry 미수집' },
  { key: 'availability_sli', label: 'Availability SLI', status: 'provisional', note: 'point-in-time online ratio 만 — 기간형 uptime 미지원' },
  { key: 'queue_sli', label: 'Queue SLI', status: 'unsupported', note: 'telemetry 미수집' },
  { key: 'scheduler_sli', label: 'Scheduler SLI', status: 'unsupported', note: 'telemetry 미수집' },
  { key: 'api_sli', label: 'API SLI', status: 'unsupported', note: 'latency telemetry 미수집' },
  { key: 'database_sli', label: 'Database SLI', status: 'unsupported', note: 'latency telemetry 미수집' },
  { key: 'governance_sli', label: 'Governance SLI', status: 'partially_supported', note: 'compliance/audit completeness — 기록된 활동 한정' },
  { key: 'fleet_sli', label: 'Fleet SLI', status: 'partially_supported', note: 'store scope 분할 가능(전용 telemetry 없음)' },
  { key: 'slo', label: 'SLO', status: 'fully_supported', note: '버전 관리 + 사람 승인 + 소급 금지' },
  { key: 'data_coverage', label: 'Data Coverage', status: 'partially_supported', note: '시간 bucket 기반 proxy — 이벤트 없는 시간을 정상으로 계산 안 함' },
  { key: 'error_budget', label: 'Error Budget', status: 'fully_supported', note: '비율형 SLI 전용 · 실행 권한 아님' },
  { key: 'burn_rate', label: 'Burn Rate', status: 'partially_supported', note: '고정 임계치(1/2/10) — 분포 기반 조정 가능 구조' },
  { key: 'multi_window_burn', label: 'Multi-Window Burn', status: 'fully_supported', note: '단기 spike 단독으로 Freeze 권고 안 함' },
  { key: 'change_correlation', label: 'Change Correlation', status: 'partially_supported', note: '시간/scope/release 상관 — 인과 단정 없음' },
  { key: 'release_risk', label: 'Release Risk', status: 'partially_supported', note: '12성분 재정규화 · 자동 차단 없음' },
  { key: 'freeze_recommendation', label: 'Change Freeze Recommendation', status: 'fully_supported', note: '권고 전용 — 실행 경로 없음' },
  { key: 'human_freeze_decision', label: 'Human Freeze Decision', status: 'fully_supported', note: '7 결정 whitelist + 사유/Evidence 필수' },
  { key: 'freeze_reference', label: 'Freeze Reference', status: 'evidence_only', note: '외부 수동 Freeze 참고 기록 — 동작 자동 단정 없음' },
  { key: 'release_portfolio', label: 'Release Portfolio', status: 'partially_supported', note: 'Release 단위 metadata 없음 — Change(Plan/Observation) 기반만' },
  { key: 'change_velocity', label: 'Change Velocity', status: 'partially_supported', note: '표본 부족 시 insufficient_data · DORA 지표 주장 없음' },
  { key: 'reliability_certification', label: 'Reliability Certification', status: 'fully_supported', note: '서버 게이트 + 사람 확정' },
  { key: 'policy_versioning', label: 'Policy Versioning', status: 'fully_supported', note: '새 버전=새 행 · checksum · 소급 금지' },
  { key: 'automatic_freeze', label: 'Automatic Freeze', status: 'unsupported', note: '금지 — 권고/기록만' },
  { key: 'automatic_rollback', label: 'Automatic Rollback', status: 'unsupported', note: '금지' },
  { key: 'production_apply', label: 'Production Apply', status: 'unsupported', note: '금지' },
];
