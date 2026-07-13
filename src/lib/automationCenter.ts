/**
 * automationCenter — Operations Automation Center 순수 로직 (Phase ADMIN-AUTOMATION-1).
 *
 * 운영 자동화의 규칙 모델·조건 평가·실행 모드 게이팅·Kill Switch·Cooldown/Rate Limit·
 * 시뮬레이션·템플릿을 담는 순수 로직이다(단위 테스트 대상). **실행 로직은 없다** —
 * 실제 실행은 기존 Action Center Command 모델(0479)과 기존 admin RPC 를 재사용한다.
 *
 * 이 모듈의 게이팅(decideExecution)은 서버 admin_automation_evaluate(0480)의 판정과
 * 동일 규칙을 따른다(defense-in-depth · UI 프리뷰용). 안전 기본값:
 *   - is_enabled=false / dry_run=true / execution_mode='suggest' / approval_required=true
 *   - Auto 는 risk='low' + Kill Switch(global+domain) ON + 실행 RPC 존재일 때만 허용.
 */
import { getAction, isSupported, roleRank, type Role } from './actionCenter';

/* ── Rule 모델 ────────────────────────────────────────────────────── */
export type AutomationDomain = 'store' | 'player' | 'qc' | 'settlement' | 'user' | 'policy' | 'system';
export type TriggerType = 'schedule' | 'metric_threshold' | 'incident' | 'alert' | 'stale_state' | 'count_threshold' | 'manual_test';
export type Operator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists' | 'not_exists';
export type ExecutionMode = 'suggest' | 'approval' | 'auto';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export const DOMAINS: AutomationDomain[] = ['store', 'player', 'qc', 'settlement', 'user', 'policy', 'system'];
export const TRIGGER_TYPES: TriggerType[] = ['schedule', 'metric_threshold', 'incident', 'alert', 'stale_state', 'count_threshold', 'manual_test'];
export const OPERATORS: Operator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'exists', 'not_exists'];
export const EXECUTION_MODES: ExecutionMode[] = ['suggest', 'approval', 'auto'];
export const RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

export interface AutomationRule {
  id: string;
  name: string;
  description?: string | null;
  domain: AutomationDomain;
  trigger_type: TriggerType;
  metric?: string | null;
  operator?: Operator | null;
  threshold?: number | null;
  duration_seconds?: number | null;
  scope?: string | null;
  action_type: string;
  action_config?: Record<string, unknown>;
  execution_mode: ExecutionMode;
  risk_level: RiskLevel;
  approval_required: boolean;
  cooldown_seconds: number;
  max_runs_per_day: number;
  max_targets_per_run: number;
  is_enabled: boolean;
  dry_run: boolean;
  last_evaluated_at?: string | null;
  last_triggered_at?: string | null;
  last_executed_at?: string | null;
  disabled_reason?: string | null;
  created_at?: string;
  updated_at?: string;
}

/* ── 지원 지표(기존 KPI 재사용; 없는 Telemetry 는 생성 금지) ───────────── */
export interface MetricDef { key: string; label: string; domain: AutomationDomain; source: string }
export const METRIC_CATALOG: MetricDef[] = [
  { key: 'offline_stores',    label: '오프라인 매장 수',   domain: 'store',      source: 'admin_noc_kpi.offline_stores' },
  { key: 'offline_players',   label: '오프라인 Player 수', domain: 'player',     source: 'admin_streaming_summary.offline_players' },
  { key: 'today_incidents',   label: '오늘 Incident 수',   domain: 'system',     source: 'admin_noc_kpi.today_incidents' },
  { key: 'qc_pending',        label: 'QC 대기 수',         domain: 'qc',         source: 'admin_artist_breakdown.qc.pending' },
  { key: 'settlement_pending',label: '정산 예정 수',       domain: 'settlement', source: 'admin_artist_breakdown.settlement.pending' },
  { key: 'payment_failures',  label: '결제 실패 수',       domain: 'settlement', source: 'admin_revenue_breakdown.churn.failed_payments' },
];
export function getMetric(key?: string | null): MetricDef | undefined {
  return key ? METRIC_CATALOG.find((m) => m.key === key) : undefined;
}

/** History(지속시간) telemetry 부재 → duration 조건 미지원. UI/보고에서 명시. */
export const DURATION_SUPPORTED = false;

/* ── 실행 RPC 지원 여부(Action Center 카탈로그 재사용) ────────────────── */
export function isActionSupported(actionType: string): boolean {
  const a = getAction(actionType);
  return a ? isSupported(a) : false;
}

/* ── 조건 평가(서버 _automation_condition_met 와 동일 규칙) ──────────── */
export function conditionMet(operator: Operator | null | undefined, actual: number | null | undefined, threshold: number | null | undefined): boolean {
  const a = actual == null || !Number.isFinite(actual) ? null : actual;
  if (operator === 'exists') return (a ?? 0) > 0;
  if (operator === 'not_exists') return (a ?? 0) === 0;
  if (a == null || threshold == null || !Number.isFinite(threshold)) return false;
  switch (operator) {
    case 'eq': return a === threshold;
    case 'neq': return a !== threshold;
    case 'gt': return a > threshold;
    case 'gte': return a >= threshold;
    case 'lt': return a < threshold;
    case 'lte': return a <= threshold;
    default: return false;
  }
}

/* ── 실행 모드 게이팅(핵심; 서버 admin_automation_evaluate 와 동일 판정) ── */
export type Decision = 'not_met' | 'suggested' | 'command_created' | 'auto_executed' | 'blocked';

export interface KillSwitchState { global: boolean; domains: Record<string, boolean> }

export interface EvalContext {
  actual: number | null | undefined;
  supported: boolean;                       // 실행 RPC 존재
  killSwitch: KillSwitchState;
  runsToday?: number;                        // 오늘 생성/실행된 Command 수
  cooldownRemainingSeconds?: number;         // 남은 cooldown(>0 이면 차단)
  forceDryRun?: boolean;                      // 평가 호출 자체의 dry_run
}

export interface DecisionResult { decision: Decision; blockReason: string | null; effectiveDryRun: boolean; conditionMet: boolean }

export function decideExecution(rule: AutomationRule, ctx: EvalContext): DecisionResult {
  const effectiveDryRun = Boolean(ctx.forceDryRun) || rule.dry_run;
  const met = conditionMet(rule.operator, ctx.actual, rule.threshold);
  if (!met) return { decision: 'not_met', blockReason: null, effectiveDryRun, conditionMet: false };
  if (!rule.is_enabled) return { decision: 'blocked', blockReason: '규칙 비활성(is_enabled=false)', effectiveDryRun, conditionMet: true };
  if (effectiveDryRun) return { decision: 'suggested', blockReason: 'dry_run(시뮬레이션) — 실행 안 함', effectiveDryRun, conditionMet: true };
  if (rule.execution_mode === 'suggest') return { decision: 'suggested', blockReason: null, effectiveDryRun, conditionMet: true };

  const cooldownOk = (ctx.cooldownRemainingSeconds ?? 0) <= 0;
  if (!cooldownOk) return { decision: 'blocked', blockReason: 'cooldown 미경과', effectiveDryRun, conditionMet: true };
  if ((ctx.runsToday ?? 0) >= rule.max_runs_per_day) return { decision: 'blocked', blockReason: `일일 최대 실행(${rule.max_runs_per_day}) 초과`, effectiveDryRun, conditionMet: true };
  if (!ctx.supported) return { decision: 'blocked', blockReason: '실행 RPC 없음(미지원 Action) — 실행 불가', effectiveDryRun, conditionMet: true };

  if (rule.execution_mode === 'auto') {
    const globalOn = ctx.killSwitch.global;
    const domainOn = Boolean(ctx.killSwitch.domains[rule.domain]);
    if (rule.risk_level !== 'low' || !globalOn || !domainOn) {
      const blockReason = rule.risk_level !== 'low'
        ? 'Auto 불가(위험도 low 아님) → 승인 대기'
        : !globalOn ? 'Auto 불가(Global Kill Switch OFF) → 승인 대기'
          : 'Auto 불가(Domain Kill Switch OFF) → 승인 대기';
      return { decision: 'command_created', blockReason, effectiveDryRun, conditionMet: true };
    }
    return { decision: 'auto_executed', blockReason: null, effectiveDryRun, conditionMet: true };
  }
  return { decision: 'command_created', blockReason: null, effectiveDryRun, conditionMet: true }; // approval
}

/* ── Simulation(Dry Run) — 실행/데이터 변경 없이 결과만 계산 ───────────── */
export interface SimulationResult {
  conditionMet: boolean;
  actual: number | null;
  threshold: number | null;
  operator: Operator | null;
  metricLabel: string;
  expectedTargets: number;
  wouldCreateCommand: boolean;
  willExecute: boolean;
  actionType: string;
  supported: boolean;
  reuseRpc: string | null;
  approvalNeeded: boolean;
  riskLevel: RiskLevel;
  cooldownRemainingSeconds: number;
  decision: Decision;
  blockReason: string | null;
  effectiveDryRun: boolean;
}

export function simulate(rule: AutomationRule, ctx: EvalContext, expectedTargets = 0): SimulationResult {
  const res = decideExecution(rule, ctx);
  const action = getAction(rule.action_type);
  const supported = ctx.supported;
  const targets = Math.max(0, Math.min(Number.isFinite(expectedTargets) ? expectedTargets : 0, rule.max_targets_per_run));
  return {
    conditionMet: res.conditionMet,
    actual: ctx.actual == null || !Number.isFinite(ctx.actual) ? null : ctx.actual,
    threshold: rule.threshold ?? null,
    operator: rule.operator ?? null,
    metricLabel: getMetric(rule.metric)?.label ?? rule.metric ?? '—',
    expectedTargets: targets,
    wouldCreateCommand: res.decision === 'command_created' || res.decision === 'auto_executed',
    willExecute: res.decision === 'auto_executed',
    actionType: rule.action_type,
    supported,
    reuseRpc: action && action.reuse.kind === 'rpc' ? action.reuse.ref : null,
    approvalNeeded: rule.approval_required || rule.risk_level !== 'low' || res.decision === 'command_created',
    riskLevel: rule.risk_level,
    cooldownRemainingSeconds: Math.max(0, ctx.cooldownRemainingSeconds ?? 0),
    decision: res.decision,
    blockReason: res.blockReason,
    effectiveDryRun: res.effectiveDryRun,
  };
}

/** last_triggered_at + cooldown 으로 남은 cooldown(초) 계산. now 는 ms epoch. */
export function cooldownRemaining(lastTriggeredAtIso: string | null | undefined, cooldownSeconds: number, nowMs: number): number {
  if (!lastTriggeredAtIso || cooldownSeconds <= 0) return 0;
  const last = Date.parse(lastTriggeredAtIso);
  if (!Number.isFinite(last)) return 0;
  const elapsed = (nowMs - last) / 1000;
  return Math.max(0, Math.ceil(cooldownSeconds - elapsed));
}

/* ── 권한(Action Center Role 매트릭스 재사용) ─────────────────────────── */
/** Rule 생성/수정 = Manager 이상. */
export function canEditRule(role: Role): boolean { return roleRank(role) >= roleRank('manager'); }
/** 위험도별 승인 권한: low/medium=Manager+, high=Admin+, critical=Super Admin. */
export function canApprove(role: Role, risk: RiskLevel): boolean {
  const need: Role = risk === 'critical' ? 'super_admin' : risk === 'high' ? 'admin' : 'manager';
  return roleRank(role) >= roleRank(need);
}
/** Domain Kill Switch = Admin 이상. */
export function canSetDomainKill(role: Role): boolean { return roleRank(role) >= roleRank('admin'); }
/** Global Kill Switch = Super Admin. */
export function canSetGlobalKill(role: Role): boolean { return roleRank(role) >= roleRank('super_admin'); }
/** Auto 최종 활성화(dry_run 해제 + auto 모드) = Super Admin. */
export function canEnableAuto(role: Role): boolean { return roleRank(role) >= roleRank('super_admin'); }

/* ── 초기 Rule 템플릿(지원 가능 + 안전 기본값; Seed 는 항상 비활성·dry_run) ── */
export interface RuleTemplate {
  key: string;
  name: string;
  description: string;
  domain: AutomationDomain;
  trigger_type: TriggerType;
  metric: string;
  operator: Operator;
  threshold: number;
  action_type: string;
  execution_mode: ExecutionMode;
  risk_level: RiskLevel;
}

export const RULE_TEMPLATES: RuleTemplate[] = [
  { key: 'store_offline_suggestion', name: '매장 오프라인 감지 → 재동기화 추천', description: '오프라인 매장 발생 시 매장 재동기화(force_store_resync)를 추천합니다.', domain: 'store', trigger_type: 'count_threshold', metric: 'offline_stores', operator: 'gte', threshold: 1, action_type: 'store_resync', execution_mode: 'suggest', risk_level: 'low' },
  { key: 'fleet_offline_bulk', name: '플릿 대량 오프라인 → 일괄 재동기화 승인', description: '오프라인 매장 3개 이상이면 일괄 재동기화를 승인 대기로 생성합니다(실행은 매장 관리 패널 재사용).', domain: 'store', trigger_type: 'count_threshold', metric: 'offline_stores', operator: 'gte', threshold: 3, action_type: 'store_resync', execution_mode: 'approval', risk_level: 'medium' },
  { key: 'qc_pending_retry', name: 'QC 대기 누적 → 재처리 승인', description: 'QC 대기 50건 이상이면 대기 재처리(retry_pending_qc)를 승인 대기로 생성합니다.', domain: 'qc', trigger_type: 'count_threshold', metric: 'qc_pending', operator: 'gte', threshold: 50, action_type: 'qc_retry', execution_mode: 'approval', risk_level: 'medium' },
  { key: 'qc_backlog_alert', name: 'QC 백로그 경보(추천만)', description: 'QC 대기 100건 이상이면 백로그 경보로 추천만 표시합니다(실행 없음).', domain: 'qc', trigger_type: 'count_threshold', metric: 'qc_pending', operator: 'gte', threshold: 100, action_type: 'qc_retry', execution_mode: 'suggest', risk_level: 'low' },
  { key: 'incident_escalation', name: 'Incident 발생 → 조치 추천', description: '오늘 Incident 발생 시 조치를 추천합니다.', domain: 'system', trigger_type: 'incident', metric: 'today_incidents', operator: 'gte', threshold: 1, action_type: 'store_resync', execution_mode: 'suggest', risk_level: 'low' },
  { key: 'payment_failure_alert', name: '결제 실패 급증 경보(링크만)', description: '결제 실패 5건 이상이면 Revenue Dashboard 확인을 추천합니다(실행 RPC 없음 = 링크/추천만).', domain: 'settlement', trigger_type: 'count_threshold', metric: 'payment_failures', operator: 'gte', threshold: 5, action_type: 'payment_review', execution_mode: 'suggest', risk_level: 'low' },
];

export function templateSupported(t: RuleTemplate): boolean { return isActionSupported(t.action_type); }

/** 템플릿 → 새 Rule payload(항상 비활성·dry_run·approval_required 안전 기본값). */
export function templateToPayload(t: RuleTemplate): Record<string, unknown> {
  return {
    name: t.name, description: t.description, domain: t.domain, trigger_type: t.trigger_type,
    metric: t.metric, operator: t.operator, threshold: t.threshold,
    action_type: t.action_type, execution_mode: t.execution_mode, risk_level: t.risk_level,
    approval_required: t.risk_level !== 'low' ? true : t.execution_mode !== 'suggest',
    cooldown_seconds: t.domain === 'qc' ? 3600 : 1800,
    max_runs_per_day: 24, max_targets_per_run: 50,
  };
}

/* ── 표시 헬퍼(라벨/톤) ──────────────────────────────────────────────── */
export const DECISION_LABEL: Record<Decision, string> = {
  not_met: '조건 미충족', suggested: '추천', command_created: '승인 대기 생성', auto_executed: '자동 실행', blocked: '차단',
};
export const DECISION_TONE: Record<Decision, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  not_met: 'neutral', suggested: 'info', command_created: 'warning', auto_executed: 'success', blocked: 'danger',
};
export const MODE_LABEL: Record<ExecutionMode, string> = { suggest: 'Suggest', approval: 'Approval', auto: 'Auto' };
export const RISK_LABEL: Record<RiskLevel, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
export const RISK_TONE: Record<RiskLevel, 'success' | 'warning' | 'danger' | 'neutral'> = {
  low: 'success', medium: 'warning', high: 'danger', critical: 'danger',
};
export const OPERATOR_LABEL: Record<Operator, string> = {
  eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', exists: '존재', not_exists: '없음',
};
export const TRIGGER_LABEL: Record<TriggerType, string> = {
  schedule: '스케줄', metric_threshold: '지표 임계', incident: 'Incident', alert: 'Alert',
  stale_state: '정체 상태', count_threshold: '카운트 임계', manual_test: '수동 테스트',
};
export const DOMAIN_LABEL: Record<AutomationDomain, string> = {
  store: '매장', player: 'Player', qc: 'QC', settlement: '정산', user: '사용자', policy: '정책', system: '시스템',
};
