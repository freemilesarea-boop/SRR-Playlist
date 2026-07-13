// Phase ADMIN-AUTOMATION-1 — Operations Automation Center 순수 로직 단위 테스트.
// 안전 게이팅(비활성/dry_run/Kill Switch/cooldown/daily limit/미지원/risk) 전수 검증.
import { describe, it, expect } from 'vitest';
import {
  conditionMet, decideExecution, simulate, cooldownRemaining,
  canEditRule, canApprove, canSetDomainKill, canSetGlobalKill, canEnableAuto,
  isActionSupported, templateSupported, templateToPayload, getMetric,
  RULE_TEMPLATES, METRIC_CATALOG, DURATION_SUPPORTED,
  DECISION_LABEL, DECISION_TONE, RISK_TONE, OPERATORS,
  type AutomationRule, type KillSwitchState, type EvalContext,
} from './automationCenter';

const KS_ON: KillSwitchState = { global: true, domains: { store: true, qc: true } };

/** 테스트용 기본 Rule(안전 기본값). override 로 필드 교체. */
function rule(over: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'r1', name: 'test', domain: 'store', trigger_type: 'count_threshold',
    metric: 'offline_stores', operator: 'gte', threshold: 1,
    action_type: 'store_resync', execution_mode: 'suggest', risk_level: 'low',
    approval_required: true, cooldown_seconds: 1800, max_runs_per_day: 24, max_targets_per_run: 50,
    is_enabled: false, dry_run: true, ...over,
  };
}
function ctx(over: Partial<EvalContext> = {}): EvalContext {
  return { actual: 5, supported: true, killSwitch: KS_ON, runsToday: 0, cooldownRemainingSeconds: 0, forceDryRun: false, ...over };
}

describe('conditionMet — operator 별 평가', () => {
  it('숫자 비교', () => {
    expect(conditionMet('gte', 5, 1)).toBe(true);
    expect(conditionMet('gt', 1, 1)).toBe(false);
    expect(conditionMet('lte', 1, 5)).toBe(true);
    expect(conditionMet('eq', 3, 3)).toBe(true);
    expect(conditionMet('neq', 3, 4)).toBe(true);
  });
  it('exists / not_exists', () => {
    expect(conditionMet('exists', 2, null)).toBe(true);
    expect(conditionMet('exists', 0, null)).toBe(false);
    expect(conditionMet('not_exists', 0, null)).toBe(true);
  });
  it('null / NaN / Infinity 는 미충족(추정 금지)', () => {
    expect(conditionMet('gte', null, 1)).toBe(false);
    expect(conditionMet('gte', NaN, 1)).toBe(false);
    expect(conditionMet('gte', Infinity, 1)).toBe(false);
    expect(conditionMet('gte', 5, null)).toBe(false);
  });
});

describe('decideExecution — 안전 게이팅', () => {
  it('조건 미충족 → not_met', () => {
    expect(decideExecution(rule({ is_enabled: true, dry_run: false }), ctx({ actual: 0 })).decision).toBe('not_met');
  });
  it('비활성 Rule → blocked (조건 충족해도)', () => {
    const r = decideExecution(rule({ is_enabled: false, dry_run: false, execution_mode: 'auto' }), ctx());
    expect(r.decision).toBe('blocked');
    expect(r.blockReason).toContain('비활성');
  });
  it('dry_run → suggested (실행 안 함)', () => {
    const r = decideExecution(rule({ is_enabled: true, dry_run: true, execution_mode: 'auto' }), ctx());
    expect(r.decision).toBe('suggested');
    expect(r.effectiveDryRun).toBe(true);
  });
  it('forceDryRun(평가 호출 dry) → suggested', () => {
    const r = decideExecution(rule({ is_enabled: true, dry_run: false, execution_mode: 'auto', risk_level: 'low' }), ctx({ forceDryRun: true }));
    expect(r.decision).toBe('suggested');
  });
  it('suggest 모드 → suggested', () => {
    expect(decideExecution(rule({ is_enabled: true, dry_run: false, execution_mode: 'suggest' }), ctx()).decision).toBe('suggested');
  });
  it('approval 모드 → command_created', () => {
    expect(decideExecution(rule({ is_enabled: true, dry_run: false, execution_mode: 'approval', risk_level: 'medium' }), ctx()).decision).toBe('command_created');
  });
  it('auto + low + Kill Switch ON + 지원 → auto_executed', () => {
    const r = decideExecution(rule({ is_enabled: true, dry_run: false, execution_mode: 'auto', risk_level: 'low' }), ctx({ killSwitch: KS_ON }));
    expect(r.decision).toBe('auto_executed');
  });
});

describe('decideExecution — Kill Switch / risk 로 Auto 격하', () => {
  const autoRule = rule({ is_enabled: true, dry_run: false, execution_mode: 'auto', risk_level: 'low' });
  it('Global Kill Switch OFF → 승인 대기로 격하', () => {
    const r = decideExecution(autoRule, ctx({ killSwitch: { global: false, domains: { store: true } } }));
    expect(r.decision).toBe('command_created');
    expect(r.blockReason).toContain('Global');
  });
  it('Domain Kill Switch OFF → 승인 대기로 격하', () => {
    const r = decideExecution(autoRule, ctx({ killSwitch: { global: true, domains: { store: false } } }));
    expect(r.decision).toBe('command_created');
    expect(r.blockReason).toContain('Domain');
  });
  it('risk 가 low 아니면 Auto 금지 → 승인 대기', () => {
    const r = decideExecution(rule({ is_enabled: true, dry_run: false, execution_mode: 'auto', risk_level: 'high' }), ctx({ killSwitch: KS_ON }));
    expect(r.decision).toBe('command_created');
    expect(r.blockReason).toContain('위험도');
  });
});

describe('decideExecution — Cooldown / Rate Limit / 미지원', () => {
  const base = rule({ is_enabled: true, dry_run: false, execution_mode: 'approval', risk_level: 'medium' });
  it('cooldown 미경과 → blocked', () => {
    const r = decideExecution(base, ctx({ cooldownRemainingSeconds: 600 }));
    expect(r.decision).toBe('blocked');
    expect(r.blockReason).toContain('cooldown');
  });
  it('일일 최대 실행 초과 → blocked', () => {
    const r = decideExecution(base, ctx({ runsToday: 24 }));
    expect(r.decision).toBe('blocked');
    expect(r.blockReason).toContain('일일');
  });
  it('실행 RPC 미지원 → blocked', () => {
    const r = decideExecution(base, ctx({ supported: false }));
    expect(r.decision).toBe('blocked');
    expect(r.blockReason).toContain('미지원');
  });
});

describe('simulate — 실행/데이터 변경 없이 결과만', () => {
  it('충족 + approval → 승인 대기 예상, willExecute=false', () => {
    const s = simulate(rule({ is_enabled: true, dry_run: false, execution_mode: 'approval', risk_level: 'medium' }), ctx(), 120);
    expect(s.conditionMet).toBe(true);
    expect(s.wouldCreateCommand).toBe(true);
    expect(s.willExecute).toBe(false);
    expect(s.expectedTargets).toBe(50); // max_targets_per_run 로 clamp
    expect(s.reuseRpc).toBe('admin_force_store_resync');
  });
  it('dry_run 규칙 → suggested, willExecute=false', () => {
    const s = simulate(rule({ is_enabled: true, dry_run: true, execution_mode: 'auto' }), ctx());
    expect(s.decision).toBe('suggested');
    expect(s.willExecute).toBe(false);
  });
  it('actual NaN → actual null (추정 금지)', () => {
    const s = simulate(rule({ is_enabled: true }), ctx({ actual: NaN }));
    expect(s.actual).toBeNull();
    expect(s.conditionMet).toBe(false);
  });
});

describe('cooldownRemaining', () => {
  it('경과 전 남은 초 계산', () => {
    const now = 1_000_000_000_000;
    const last = new Date(now - 600_000).toISOString(); // 600s 전
    expect(cooldownRemaining(last, 1800, now)).toBe(1200);
  });
  it('경과 후 0', () => {
    const now = 1_000_000_000_000;
    const last = new Date(now - 3600_000).toISOString();
    expect(cooldownRemaining(last, 1800, now)).toBe(0);
  });
  it('트리거 이력 없거나 cooldown 0 → 0', () => {
    expect(cooldownRemaining(null, 1800, 1_000_000_000_000)).toBe(0);
    expect(cooldownRemaining(new Date().toISOString(), 0, 1_000_000_000_000)).toBe(0);
  });
});

describe('권한(Role 매트릭스 재사용)', () => {
  it('Rule 편집 = Manager 이상', () => {
    expect(canEditRule('operator')).toBe(false);
    expect(canEditRule('manager')).toBe(true);
  });
  it('승인 권한 위험도별', () => {
    expect(canApprove('manager', 'medium')).toBe(true);
    expect(canApprove('manager', 'high')).toBe(false);
    expect(canApprove('admin', 'high')).toBe(true);
    expect(canApprove('admin', 'critical')).toBe(false);
    expect(canApprove('super_admin', 'critical')).toBe(true);
  });
  it('Kill Switch / Auto 활성화 권한', () => {
    expect(canSetDomainKill('manager')).toBe(false);
    expect(canSetDomainKill('admin')).toBe(true);
    expect(canSetGlobalKill('admin')).toBe(false);
    expect(canSetGlobalKill('super_admin')).toBe(true);
    expect(canEnableAuto('admin')).toBe(false);
    expect(canEnableAuto('super_admin')).toBe(true);
  });
});

describe('지표/템플릿 — 실제 데이터·지원 여부만', () => {
  it('METRIC_CATALOG 는 기존 KPI source 매핑', () => {
    expect(getMetric('offline_stores')?.source).toContain('admin_noc_kpi');
    expect(METRIC_CATALOG.every((m) => m.source.includes('.'))).toBe(true);
  });
  it('duration 조건 미지원(History 부재)', () => {
    expect(DURATION_SUPPORTED).toBe(false);
  });
  it('실행 RPC 지원 판정(Action Center 카탈로그 재사용)', () => {
    expect(isActionSupported('store_resync')).toBe(true);
    expect(isActionSupported('qc_retry')).toBe(true);
    expect(isActionSupported('payment_review')).toBe(false); // 카탈로그 없음 = 미지원
    expect(isActionSupported('settlement_generate')).toBe(false); // link = 미지원
  });
  it('템플릿: 지원 가능만 실행, 미지원은 suggest', () => {
    const pay = RULE_TEMPLATES.find((t) => t.key === 'payment_failure_alert')!;
    expect(templateSupported(pay)).toBe(false);
    expect(pay.execution_mode).toBe('suggest'); // 미지원은 실행 아님
    const store = RULE_TEMPLATES.find((t) => t.key === 'store_offline_suggestion')!;
    expect(templateSupported(store)).toBe(true);
  });
  it('templateToPayload 는 안전 기본값 유지', () => {
    const p = templateToPayload(RULE_TEMPLATES.find((t) => t.key === 'fleet_offline_bulk')!);
    expect(p.approval_required).toBe(true); // medium → 승인 필수
    expect(p.execution_mode).toBe('approval');
    expect(p.max_targets_per_run).toBe(50);
  });
});

describe('표시 헬퍼', () => {
  it('decision 라벨/톤', () => {
    expect(DECISION_LABEL.auto_executed).toBe('자동 실행');
    expect(DECISION_TONE.blocked).toBe('danger');
    expect(DECISION_TONE.suggested).toBe('info');
  });
  it('risk 톤', () => {
    expect(RISK_TONE.low).toBe('success');
    expect(RISK_TONE.critical).toBe('danger');
  });
  it('operator 목록 8종', () => { expect(OPERATORS.length).toBe(8); });
});
