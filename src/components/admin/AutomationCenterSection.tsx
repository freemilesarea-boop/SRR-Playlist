/**
 * AutomationCenterSection — Operations Automation Center (Phase ADMIN-AUTOMATION-1).
 *
 * 운영 자동화(Trigger→Condition→Action→Approval→Execution→Audit)의 기반이다.
 * **실행 로직은 신규 없음** — 실제 실행은 기존 Action Center Command 모델(0479)과
 * 기존 admin 실행 RPC 를 재사용한다. 이 화면은 규칙 저장·시뮬레이션·게이팅·감사만 담당.
 *
 * 안전 기본값: 규칙은 비활성+dry_run 로 생성되고, Auto 는 Kill Switch(global+domain)+
 * risk=low+실행 RPC 존재일 때만. 규칙 생성만으로 실행되지 않는다.
 *
 * 탭: Overview · Rules · Recommendations · Approvals · Simulation · History · Templates · Kill Switch.
 * Trigger 지표는 기존 KPI RPC 로 측정(재사용, 추정 금지). 없는 지표는 '데이터 없음'.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Bot, ListChecks, Lightbulb, ShieldCheck, FlaskConical, History as HistoryIcon, LayoutTemplate,
  Power, PlayCircle, PauseCircle, CheckCircle2, Lock, Inbox, Plus,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import {
  fetchAutomationRules, upsertAutomationRule, toggleAutomationRule,
  fetchAutomationKillSwitch, setAutomationKillSwitch, evaluateAutomationRule, fetchAutomationHistory,
  fetchNocKpi, fetchStreamingSummary, fetchArtistBreakdown, fetchRevenueBreakdown,
  type AutomationRuleRow, type KillSwitchResult, type AutomationRunRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { relativeTimeKo, formatKstDateTime } from '@/lib/memberGrowth';
import {
  decideExecution, simulate, cooldownRemaining, isActionSupported, canEditRule, canApprove,
  canSetDomainKill, canSetGlobalKill, RULE_TEMPLATES, templateSupported, templateToPayload,
  DECISION_LABEL, DECISION_TONE, MODE_LABEL, RISK_LABEL, RISK_TONE, OPERATOR_LABEL, TRIGGER_LABEL,
  DOMAIN_LABEL, METRIC_CATALOG, DURATION_SUPPORTED,
  type AutomationRule, type KillSwitchState, type Decision, type RuleTemplate, type RiskLevel, type EvalContext,
} from '@/lib/automationCenter';
import { getAction, ROLE_ORDER, ROLE_LABEL, type Role } from '@/lib/actionCenter';

/** Action 실행 참조 표시(기존 카탈로그 재사용). */
function actionActionRef(actionType: string): string {
  const a = getAction(actionType);
  if (!a) return '미지원(카탈로그 없음)';
  return a.reuse.kind === 'rpc' ? `RPC ${a.reuse.ref}` : a.reuse.kind === 'link' ? '관련 Dashboard' : '미지원';
}

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));

type Tab = 'overview' | 'rules' | 'recommendations' | 'approvals' | 'simulation' | 'history' | 'templates' | 'killswitch';
const TABS: { key: Tab; label: string; icon: typeof Bot }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutTemplate },
  { key: 'rules', label: 'Rules', icon: ListChecks },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'approvals', label: 'Approvals', icon: ShieldCheck },
  { key: 'simulation', label: 'Simulation', icon: FlaskConical },
  { key: 'history', label: 'History', icon: HistoryIcon },
  { key: 'templates', label: 'Templates', icon: LayoutTemplate },
  { key: 'killswitch', label: 'Kill Switch', icon: Power },
];

/** DB row → 순수 로직 Rule 타입(좁히기). */
function toRule(r: AutomationRuleRow): AutomationRule {
  return {
    ...r,
    domain: r.domain as AutomationRule['domain'],
    trigger_type: r.trigger_type as AutomationRule['trigger_type'],
    operator: (r.operator ?? null) as AutomationRule['operator'],
    execution_mode: r.execution_mode as AutomationRule['execution_mode'],
    risk_level: r.risk_level as AutomationRule['risk_level'],
  };
}

export default function AutomationCenterSection() {
  const [tab, setTab] = useState<Tab>('overview');
  // 세분 role 부재 → 관리자 페이지 접근자를 admin 기본으로. 게이팅/데모용 selector.
  const [role, setRole] = useState<Role>('admin');

  const [rules, setRules] = useState<AutomationRuleRow[] | null>(null);
  const [rErr, setRErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);

  const [kill, setKill] = useState<KillSwitchResult | null>(null);
  const [metrics, setMetrics] = useState<Record<string, number | null>>({});
  const [metricsReady, setMetricsReady] = useState(false);

  const [history, setHistory] = useState<AutomationRunRow[] | null>(null);
  const [hLoading, setHLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now()); // 평가 시점(로드 시 갱신)

  const loadRules = useCallback(async () => {
    setLoading(true); setRErr(null);
    try { setRules(await fetchAutomationRules()); }
    catch (e) { setRErr(classifyAdminError(e)); }
    finally { setLoading(false); }
  }, []);

  const loadKill = useCallback(async () => {
    try { setKill(await fetchAutomationKillSwitch()); } catch { setKill({ global: false, domains: {}, generated_at: '' }); }
  }, []);

  const loadMetrics = useCallback(async () => {
    const settle = async <T,>(p: Promise<T>) => p.catch(() => null);
    const [noc, streaming, artist, revenue] = await Promise.all([
      settle(fetchNocKpi()), settle(fetchStreamingSummary()), settle(fetchArtistBreakdown()), settle(fetchRevenueBreakdown()),
    ]);
    setMetrics({
      offline_stores: noc?.offline_stores ?? null,
      offline_players: streaming?.offline_players ?? null,
      today_incidents: noc?.today_incidents ?? null,
      qc_pending: artist?.qc.pending ?? null,
      settlement_pending: artist?.settlement.pending ?? null,
      payment_failures: revenue?.churn.failed_payments ?? null,
    });
    setNowMs(Date.now());
    setMetricsReady(true);
  }, []);

  const loadHistory = useCallback(async () => {
    setHLoading(true);
    try { setHistory(await fetchAutomationHistory({ limit: 50 })); } catch { setHistory([]); } finally { setHLoading(false); }
  }, []);

  useEffect(() => { void loadRules(); void loadKill(); void loadMetrics(); }, [loadRules, loadKill, loadMetrics]);
  useEffect(() => { if (tab === 'history') void loadHistory(); }, [tab, loadHistory]);

  const killState: KillSwitchState = { global: kill?.global ?? false, domains: kill?.domains ?? {} };

  /** 규칙별 실측 지표 + 게이팅 컨텍스트 산출(기존 KPI 재사용). */
  function evalCtx(r: AutomationRule) {
    const actual = metrics[r.metric ?? ''] ?? null;
    const supported = isActionSupported(r.action_type);
    const cd = cooldownRemaining(r.last_triggered_at, r.cooldown_seconds, nowMs);
    return { actual, supported, killSwitch: killState, runsToday: 0, cooldownRemainingSeconds: cd, forceDryRun: false };
  }

  /** 규칙 평가 실행(서버 게이팅+감사). dryRun 강제 시 시뮬레이션만. */
  async function runEvaluate(r: AutomationRuleRow, forceDry: boolean) {
    setBusy(true);
    try {
      const rule = toRule(r);
      const actual = metrics[rule.metric ?? ''] ?? null;
      const res = await evaluateAutomationRule({
        ruleId: r.id, actual, dryRun: forceDry, supported: isActionSupported(r.action_type),
        targetId: null, targetCount: actual,
      });
      const label = DECISION_LABEL[res.decision as Decision] ?? res.decision;
      if (res.decision === 'blocked') toast.error(`${r.name}: ${label}${res.block_reason ? ` — ${res.block_reason}` : ''}`);
      else if (res.decision === 'not_met') toast.info(`${r.name}: 조건 미충족(실측 ${NUM(actual)})`);
      else toast.success(`${r.name}: ${label}${forceDry ? ' (시뮬레이션)' : ''}`);
      await Promise.all([loadRules(), loadKill()]);
      if (tab === 'history') void loadHistory();
    } catch (e) {
      toast.error(`평가 실패: ${friendlyError(e, '자동화 레지스트리 미적용이거나 권한 없음')}`);
    } finally { setBusy(false); }
  }

  async function doToggle(r: AutomationRuleRow, opts: { enabled?: boolean; dryRun?: boolean }) {
    // Auto 최종 활성화(dry_run 해제)는 권한 필요.
    if (opts.dryRun === false && !canEditRule(role)) { toast.error('dry_run 해제는 Manager 이상 필요'); return; }
    if (opts.enabled && r.execution_mode === 'auto' && !canApprove(role, r.risk_level as RiskLevel)) {
      toast.error(`Auto 규칙 활성화는 위험도(${r.risk_level}) 승인 권한 필요`); return;
    }
    setBusy(true);
    try {
      await toggleAutomationRule(r.id, { ...opts, disabledReason: opts.enabled === false ? '수동 비활성' : null });
      toast.success(`${r.name} 업데이트`);
      await loadRules();
    } catch (e) { toast.error(`업데이트 실패: ${friendlyError(e, '')}`); }
    finally { setBusy(false); }
  }

  async function addTemplate(t: RuleTemplate) {
    if (!canEditRule(role)) { toast.error('규칙 생성은 Manager 이상 필요'); return; }
    setBusy(true);
    try {
      await upsertAutomationRule(null, templateToPayload(t));
      toast.success(`템플릿 추가: ${t.name} (비활성·dry_run)`);
      await loadRules();
      setTab('rules');
    } catch (e) { toast.error(`추가 실패: ${friendlyError(e, '자동화 레지스트리 미적용일 수 있음')}`); }
    finally { setBusy(false); }
  }

  async function setKillScope(scope: string, enabled: boolean) {
    const ok = scope === 'global' ? canSetGlobalKill(role) : canSetDomainKill(role);
    if (!ok) { toast.error(scope === 'global' ? 'Global Kill Switch 는 Super Admin' : 'Domain Kill Switch 는 Admin 이상'); return; }
    setBusy(true);
    try { setKill(await setAutomationKillSwitch(scope, enabled)); toast.success(`Kill Switch(${scope}) ${enabled ? 'ON' : 'OFF'}`); }
    catch (e) { toast.error(`Kill Switch 실패: ${friendlyError(e, '')}`); }
    finally { setBusy(false); }
  }

  const ruleObjs = (rules ?? []).map(toRule);

  return (
    <AdminCard
      title={<span className="flex items-center gap-1.5"><Bot size={16} /> Operations Automation Center</span>}
      subtitle="운영 자동화 기반 — 실행은 Action Center Command/RPC 재사용, 규칙·게이팅·감사만 신규 (기본 비활성·Dry Run)"
      action={
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[10px] uppercase tracking-wider text-ink-dim">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}
            className="rounded-full bg-bg-deep px-2 py-1 text-[11px] text-ink">
            {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${tab === t.key ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'}`}>
              {t.label}
            </button>
          ))}
        </div>
      }
      bodyClassName="space-y-4"
    >
      {rErr && <AdminAlert tone="warning" title="자동화 규칙을 불러오지 못했어요" description={`${rErr.message} · 0480 미적용 시 비어 있습니다.`} action={<button onClick={() => void loadRules()} className="rounded-full bg-bg-card px-3 py-1.5 text-xs">다시 시도</button>} />}

      {tab === 'overview' && <OverviewTab rules={ruleObjs} kill={killState} metrics={metrics} metricsReady={metricsReady} loading={loading} nowMs={nowMs} evalCtx={evalCtx} />}
      {tab === 'rules' && <RulesTab rows={rules} loading={loading} busy={busy} metrics={metrics} nowMs={nowMs} killState={killState} onEvaluate={runEvaluate} onToggle={doToggle} />}
      {tab === 'recommendations' && <RecommendationsTab rules={ruleObjs} metrics={metrics} metricsReady={metricsReady} nowMs={nowMs} killState={killState} onEvaluate={(r) => runEvaluate(r, false)} rows={rules} />}
      {tab === 'approvals' && <ApprovalsTab rules={ruleObjs} rows={rules} role={role} busy={busy} onEvaluate={(r) => runEvaluate(r, false)} />}
      {tab === 'simulation' && <SimulationTab rules={ruleObjs} rows={rules} metrics={metrics} nowMs={nowMs} killState={killState} busy={busy} onSimulate={(r) => runEvaluate(r, true)} />}
      {tab === 'history' && <HistoryTab rows={history} loading={hLoading} />}
      {tab === 'templates' && <TemplatesTab role={role} busy={busy} onAdd={addTemplate} />}
      {tab === 'killswitch' && <KillSwitchTab kill={killState} role={role} busy={busy} onSet={setKillScope} />}
    </AdminCard>
  );
}

/* ── Overview ──────────────────────────────────────────────── */
function OverviewTab({ rules, kill, metrics, metricsReady, loading, evalCtx }: {
  rules: AutomationRule[]; kill: KillSwitchState; metrics: Record<string, number | null>; metricsReady: boolean;
  loading: boolean; nowMs: number; evalCtx: (r: AutomationRule) => EvalContext;
}) {
  if (loading) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  const enabled = rules.filter((r) => r.is_enabled);
  const dryRun = rules.filter((r) => r.dry_run);
  const decisions = rules.map((r) => decideExecution(r, evalCtx(r)).decision);
  const recommend = decisions.filter((d) => d === 'suggested' || d === 'command_created' || d === 'auto_executed').length;
  const stats: { label: string; value: string; tone?: 'success' | 'warning' | 'danger' | 'neutral' }[] = [
    { label: '전체 Rule', value: NUM(rules.length) },
    { label: '활성 Rule', value: NUM(enabled.length), tone: enabled.length ? 'success' : 'neutral' },
    { label: 'Dry Run Rule', value: NUM(dryRun.length), tone: 'neutral' },
    { label: '조건 충족(추천)', value: metricsReady ? NUM(recommend) : '—', tone: recommend ? 'warning' : 'neutral' },
    { label: 'Global Auto', value: kill.global ? 'ON' : 'OFF', tone: kill.global ? 'warning' : 'success' },
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-bg-deep p-3">
            <p className="text-[10px] uppercase tracking-wider text-ink-dim">{s.label}</p>
            <p className={`mt-1 text-lg font-bold ${s.tone === 'danger' ? '' : ''} text-ink`} style={s.tone === 'warning' ? { color: '#fbbf24' } : s.tone === 'success' ? { color: '#34d399' } : undefined}>{s.value}</p>
          </div>
        ))}
      </div>
      {!kill.global && <AdminAlert tone="success" icon={<ShieldCheck size={16} />} title="Auto 실행 차단됨(안전 기본값)" description="Global Kill Switch 가 OFF 입니다. 모든 자동 실행은 승인 대기로 격하됩니다." />}
      <div>
        <p className="mb-1.5 text-xs font-bold">실측 Trigger 지표 (기존 KPI 재사용)</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {METRIC_CATALOG.map((m) => (
            <div key={m.key} className="rounded-lg bg-bg-deep px-2.5 py-2">
              <p className="text-[10px] text-ink-dim">{m.label}</p>
              <p className="text-sm font-bold text-ink">{metricsReady ? NUM(metrics[m.key]) : '…'}</p>
            </div>
          ))}
        </div>
        {!DURATION_SUPPORTED && <p className="mt-1.5 text-[10px] text-ink-dim">※ 지속시간(duration) 조건은 History telemetry 부재로 미지원.</p>}
      </div>
    </div>
  );
}

/* ── Rules ─────────────────────────────────────────────────── */
function RulesTab({ rows, loading, busy, metrics, nowMs, killState, onEvaluate, onToggle }: {
  rows: AutomationRuleRow[] | null; loading: boolean; busy: boolean;
  metrics: Record<string, number | null>; nowMs: number; killState: KillSwitchState;
  onEvaluate: (r: AutomationRuleRow, dry: boolean) => void; onToggle: (r: AutomationRuleRow, o: { enabled?: boolean; dryRun?: boolean }) => void;
}) {
  if (loading) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (!rows || rows.length === 0) return <AdminEmpty icon={<Inbox size={24} />} title="자동화 규칙 없음" description="Templates 탭에서 지원 가능한 규칙을 추가하세요 (0480 미적용 시 비어 있음)." />;

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const rule = toRule(r);
        const actual = metrics[r.metric ?? ''] ?? null;
        const supported = isActionSupported(r.action_type);
        const cd = cooldownRemaining(r.last_triggered_at, r.cooldown_seconds, nowMs);
        const dec = decideExecution(rule, { actual, supported, killSwitch: killState, runsToday: 0, cooldownRemainingSeconds: cd, forceDryRun: false });
        return (
          <div key={r.id} className="rounded-xl bg-bg-deep p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-ink">{r.name}</span>
                  <AdminBadge tone="neutral" size="sm">{DOMAIN_LABEL[rule.domain]}</AdminBadge>
                  <AdminBadge tone={RISK_TONE[rule.risk_level]} size="sm">{RISK_LABEL[rule.risk_level]}</AdminBadge>
                  <AdminBadge tone="info" size="sm">{MODE_LABEL[rule.execution_mode]}</AdminBadge>
                  {r.is_enabled ? <AdminBadge tone="success" size="sm">활성</AdminBadge> : <AdminBadge tone="neutral" size="sm">비활성</AdminBadge>}
                  {r.dry_run && <AdminBadge tone="warning" size="sm">Dry Run</AdminBadge>}
                  {!supported && <AdminBadge tone="neutral" size="sm">미지원</AdminBadge>}
                </div>
                <p className="mt-1 text-[11px] text-ink-mute">
                  Trigger: {TRIGGER_LABEL[rule.trigger_type]} · 조건 {METRIC_CATALOG.find((m) => m.key === r.metric)?.label ?? r.metric ?? '—'} {r.operator ? OPERATOR_LABEL[rule.operator!] : ''} {NUM(r.threshold)} · 실측 {NUM(actual)}
                </p>
                <p className="mt-0.5 text-[10px] text-ink-dim">
                  판정: <span style={{ color: toneHex(DECISION_TONE[dec.decision]) }}>{DECISION_LABEL[dec.decision]}</span>
                  {dec.blockReason ? ` — ${dec.blockReason}` : ''} · cooldown {cd > 0 ? `${cd}s 남음` : '없음'} · 최근 트리거 {r.last_triggered_at ? relativeTimeKo(r.last_triggered_at) : '—'}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                <button disabled={busy} onClick={() => onEvaluate(r, true)}
                  className="inline-flex items-center gap-1 rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-40">
                  <FlaskConical size={11} /> 시뮬
                </button>
                <button disabled={busy} onClick={() => onEvaluate(r, false)}
                  className="inline-flex items-center gap-1 rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-40">
                  <PlayCircle size={11} /> 평가
                </button>
                <button disabled={busy} onClick={() => onToggle(r, { enabled: !r.is_enabled })}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40 ${r.is_enabled ? 'bg-bg-card text-ink-mute' : 'bg-accent text-black'}`}>
                  {r.is_enabled ? <><PauseCircle size={11} /> 비활성</> : <><Power size={11} /> 활성</>}
                </button>
                <button disabled={busy} onClick={() => onToggle(r, { dryRun: !r.dry_run })}
                  title={r.dry_run ? 'Dry Run 해제(실행 허용) — 신중히' : 'Dry Run 켜기'}
                  className="inline-flex items-center gap-1 rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink disabled:opacity-40">
                  {r.dry_run ? 'Dry 해제' : 'Dry 켜기'}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Recommendations ───────────────────────────────────────── */
function RecommendationsTab({ rules, metrics, metricsReady, nowMs, killState, onEvaluate, rows }: {
  rules: AutomationRule[]; metrics: Record<string, number | null>; metricsReady: boolean; nowMs: number;
  killState: KillSwitchState; onEvaluate: (r: AutomationRuleRow) => void; rows: AutomationRuleRow[] | null;
}) {
  if (!metricsReady) return <div className="h-24 animate-pulse rounded-2xl bg-bg-deep" />;
  const recs = rules
    .map((rule) => {
      const actual = metrics[rule.metric ?? ''] ?? null;
      const supported = isActionSupported(rule.action_type);
      const cd = cooldownRemaining(rule.last_triggered_at, rule.cooldown_seconds, nowMs);
      const dec = decideExecution(rule, { actual, supported, killSwitch: killState, runsToday: 0, cooldownRemainingSeconds: cd, forceDryRun: false });
      return { rule, actual, dec };
    })
    .filter((x) => x.dec.conditionMet);
  if (recs.length === 0) return <AdminEmpty icon={<CheckCircle2 size={24} />} title="추천 없음" description="현재 조건을 충족하는 규칙이 없습니다(실제 지표 기준, 추정 없음)." />;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-ink-mute">실제 KPI 충족 규칙만 표시 · 실행 가능 여부/승인 필요 표기</p>
      {recs.map(({ rule, actual, dec }) => {
        const row = (rows ?? []).find((r) => r.id === rule.id)!;
        return (
          <div key={rule.id} className="rounded-xl bg-bg-deep p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <AdminBadge tone={DECISION_TONE[dec.decision]} size="sm">{DECISION_LABEL[dec.decision]}</AdminBadge>
                  <span className="text-xs font-bold text-ink">{rule.name}</span>
                  <AdminBadge tone={RISK_TONE[rule.risk_level]} size="sm">{RISK_LABEL[rule.risk_level]}</AdminBadge>
                </div>
                <p className="mt-1 text-[11px] text-ink-mute">
                  {METRIC_CATALOG.find((m) => m.key === rule.metric)?.label ?? rule.metric} 실측 {NUM(actual)} {rule.operator ? OPERATOR_LABEL[rule.operator] : ''} {NUM(rule.threshold)}
                  {dec.blockReason ? ` · ${dec.blockReason}` : ''}
                </p>
                <p className="mt-0.5 text-[10px] text-ink-dim">추천 Action: {actionActionRef(rule.action_type)} · 모드 {MODE_LABEL[rule.execution_mode]}</p>
              </div>
              <button onClick={() => onEvaluate(row)}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-xs font-bold text-black hover:opacity-90">
                <PlayCircle size={12} /> 평가/실행
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Approvals ─────────────────────────────────────────────── */
function ApprovalsTab({ rules, rows, role, busy, onEvaluate }: {
  rules: AutomationRule[]; rows: AutomationRuleRow[] | null; role: Role; busy: boolean; onEvaluate: (r: AutomationRuleRow) => void;
}) {
  const needApproval = rules.filter((r) => r.approval_required || r.execution_mode === 'approval' || r.risk_level !== 'low');
  if (needApproval.length === 0) return <AdminEmpty icon={<ShieldCheck size={24} />} title="승인 필요 규칙 없음" description="Medium 이상/approval 모드 규칙이 없습니다." />;
  return (
    <div className="space-y-2">
      <AdminAlert tone="info" icon={<ShieldCheck size={16} />} title="승인 워크플로우" description="Medium 이상은 승인 필요, High/Critical 은 Auto 실행 금지(승인 대기만). 승인 권한은 위험도별로 다릅니다." />
      {needApproval.map((rule) => {
        const row = (rows ?? []).find((r) => r.id === rule.id)!;
        const allowed = canApprove(role, rule.risk_level);
        return (
          <div key={rule.id} className="rounded-xl bg-bg-deep p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-ink">{rule.name}</span>
                  <AdminBadge tone={RISK_TONE[rule.risk_level]} size="sm">{RISK_LABEL[rule.risk_level]}</AdminBadge>
                  <AdminBadge tone="info" size="sm">{MODE_LABEL[rule.execution_mode]}</AdminBadge>
                </div>
                <p className="mt-1 text-[10px] text-ink-dim">승인 권한: {rule.risk_level === 'critical' ? 'Super Admin' : rule.risk_level === 'high' ? 'Admin+' : 'Manager+'} · 현재 {ROLE_LABEL[role]}</p>
              </div>
              <button disabled={busy || !allowed} onClick={() => onEvaluate(row)}
                title={!allowed ? '승인 권한 부족' : ''}
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold ${allowed ? 'bg-accent text-black hover:opacity-90' : 'bg-bg-card text-ink-dim'}`}>
                {allowed ? <PlayCircle size={12} /> : <Lock size={12} />} 승인·평가
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Simulation ────────────────────────────────────────────── */
function SimulationTab({ rules, rows, metrics, nowMs, killState, busy, onSimulate }: {
  rules: AutomationRule[]; rows: AutomationRuleRow[] | null; metrics: Record<string, number | null>;
  nowMs: number; killState: KillSwitchState; busy: boolean; onSimulate: (r: AutomationRuleRow) => void;
}) {
  if (rules.length === 0) return <AdminEmpty icon={<FlaskConical size={24} />} title="시뮬레이션할 규칙 없음" description="규칙을 먼저 추가하세요." />;
  return (
    <div className="space-y-2">
      <AdminAlert tone="info" icon={<FlaskConical size={16} />} title="Dry Run 시뮬레이션" description="실제 실행/데이터 변경 없이 조건·대상·판정·차단 이유만 계산합니다(Simulation Audit 기록)." />
      {rules.map((rule) => {
        const actual = metrics[rule.metric ?? ''] ?? null;
        const supported = isActionSupported(rule.action_type);
        const cd = cooldownRemaining(rule.last_triggered_at, rule.cooldown_seconds, nowMs);
        const sim = simulate(rule, { actual, supported, killSwitch: killState, runsToday: 0, cooldownRemainingSeconds: cd, forceDryRun: true }, actual ?? 0);
        const row = (rows ?? []).find((r) => r.id === rule.id)!;
        return (
          <div key={rule.id} className="rounded-xl bg-bg-deep p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-ink">{rule.name}</span>
                  <AdminBadge tone={sim.conditionMet ? 'warning' : 'neutral'} size="sm">{sim.conditionMet ? '조건 충족' : '미충족'}</AdminBadge>
                  <AdminBadge tone={DECISION_TONE[sim.decision]} size="sm">{DECISION_LABEL[sim.decision]}</AdminBadge>
                </div>
                <p className="text-[11px] text-ink-mute">{sim.metricLabel} 실측 {NUM(sim.actual)} · 예상 대상 {NUM(sim.expectedTargets)} · Command 생성 {sim.wouldCreateCommand ? 'O' : 'X'} · 실행 {sim.willExecute ? 'O' : 'X'}</p>
                <p className="text-[10px] text-ink-dim">실행 RPC: {sim.reuseRpc ?? '없음(미지원)'} · 승인 {sim.approvalNeeded ? '필요' : '불필요'} · 위험 {RISK_LABEL[sim.riskLevel]} · cooldown {sim.cooldownRemainingSeconds}s{sim.blockReason ? ` · ${sim.blockReason}` : ''}</p>
              </div>
              <button disabled={busy} onClick={() => onSimulate(row)}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-bg-card px-3 py-1.5 text-xs font-semibold text-ink-mute hover:text-ink disabled:opacity-40">
                <FlaskConical size={12} /> 서버 시뮬
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── History ───────────────────────────────────────────────── */
function HistoryTab({ rows, loading }: { rows: AutomationRunRow[] | null; loading: boolean }) {
  if (loading || !rows) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (rows.length === 0) return <AdminEmpty icon={<Inbox size={24} />} title="자동화 이력 없음" description="아직 평가/실행 기록이 없습니다 (0480 미적용 시 비어 있음)." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead>
          <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
            <th className="px-2 py-2 font-semibold">Rule</th>
            <th className="px-2 py-2 font-semibold">Domain</th>
            <th className="px-2 py-2 font-semibold">실측/기준</th>
            <th className="px-2 py-2 font-semibold">판정</th>
            <th className="px-2 py-2 font-semibold">Dry</th>
            <th className="px-2 py-2 text-right font-semibold">시각</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line/5 last:border-0">
              <td className="px-2 py-2"><span className="font-semibold text-ink">{r.rule_name ?? '—'}</span></td>
              <td className="px-2 py-2 text-ink-mute">{r.domain ? DOMAIN_LABEL[r.domain as AutomationRule['domain']] ?? r.domain : '—'}</td>
              <td className="px-2 py-2 tabular-nums text-ink-mute">{NUM(r.actual_value)} / {NUM(r.threshold)}{r.condition_met ? ' ✓' : ''}</td>
              <td className="px-2 py-2">
                <AdminBadge tone={DECISION_TONE[r.decision as Decision] ?? 'neutral'} size="sm">{DECISION_LABEL[r.decision as Decision] ?? r.decision}</AdminBadge>
                {r.block_reason && <span className="ml-1 text-[10px] text-ink-dim" title={r.block_reason}>ⓘ</span>}
              </td>
              <td className="px-2 py-2 text-ink-mute">{r.dry_run ? 'Y' : 'N'}</td>
              <td className="px-2 py-2 text-right text-ink-dim" title={formatKstDateTime(r.evaluated_at)}>{relativeTimeKo(r.evaluated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Templates ─────────────────────────────────────────────── */
function TemplatesTab({ role, busy, onAdd }: { role: Role; busy: boolean; onAdd: (t: RuleTemplate) => void }) {
  const allowed = canEditRule(role);
  return (
    <div className="space-y-2">
      <AdminAlert tone="info" icon={<LayoutTemplate size={16} />} title="초기 규칙 템플릿" description="지원 가능한 것만 실행 가능하며, 추가 시 항상 비활성·Dry Run 으로 생성됩니다(즉시 실행 없음)." />
      {RULE_TEMPLATES.map((t) => {
        const supported = templateSupported(t);
        return (
          <div key={t.key} className="rounded-xl bg-bg-deep p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-ink">{t.name}</span>
                  <AdminBadge tone="neutral" size="sm">{DOMAIN_LABEL[t.domain]}</AdminBadge>
                  <AdminBadge tone={RISK_TONE[t.risk_level]} size="sm">{RISK_LABEL[t.risk_level]}</AdminBadge>
                  <AdminBadge tone="info" size="sm">{MODE_LABEL[t.execution_mode]}</AdminBadge>
                  {!supported && <AdminBadge tone="neutral" size="sm">링크/추천만</AdminBadge>}
                </div>
                <p className="mt-1 text-[11px] text-ink-mute">{t.description}</p>
              </div>
              <button disabled={busy || !allowed} onClick={() => onAdd(t)}
                title={!allowed ? '규칙 생성은 Manager 이상' : ''}
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold ${allowed ? 'bg-accent text-black hover:opacity-90' : 'bg-bg-card text-ink-dim'}`}>
                {allowed ? <Plus size={12} /> : <Lock size={12} />} 추가
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Kill Switch ───────────────────────────────────────────── */
function KillSwitchTab({ kill, role, busy, onSet }: { kill: KillSwitchState; role: Role; busy: boolean; onSet: (scope: string, enabled: boolean) => void }) {
  const domains = ['store', 'player', 'qc', 'settlement', 'user', 'policy'] as const;
  return (
    <div className="space-y-3">
      <AdminAlert tone={kill.global ? 'warning' : 'success'} icon={<Power size={16} />}
        title={kill.global ? 'Global Auto 실행 활성' : 'Global Auto 실행 차단(기본값)'}
        description="Global 이 OFF 이면 어떤 규칙도 Auto 실행되지 않고 승인 대기로 격하됩니다. Domain 별로 세분 제어 가능." />
      <div className="rounded-xl bg-bg-deep p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-ink">Global Kill Switch</p>
            <p className="text-[10px] text-ink-dim">Super Admin 전용 · 모든 도메인 Auto 실행 총괄</p>
          </div>
          <KillToggle on={kill.global} disabled={busy || !canSetGlobalKill(role)} onToggle={() => onSet('global', !kill.global)} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {domains.map((d) => {
          const on = Boolean(kill.domains[d]);
          return (
            <div key={d} className="flex items-center justify-between rounded-lg bg-bg-deep px-3 py-2">
              <div>
                <p className="text-xs font-semibold text-ink">{DOMAIN_LABEL[d]} 도메인</p>
                <p className="text-[10px] text-ink-dim">Admin 이상 · Auto 허용 {on ? 'ON' : 'OFF'}</p>
              </div>
              <KillToggle on={on} disabled={busy || !canSetDomainKill(role)} onToggle={() => onSet(d, !on)} />
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-ink-dim">※ Kill Switch 는 Suggest/Dry Run 에는 영향 없음 — Auto 실행만 제어합니다.</p>
    </div>
  );
}

function KillToggle({ on, disabled, onToggle }: { on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button disabled={disabled} onClick={onToggle}
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold disabled:opacity-40 ${on ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute'}`}>
      {disabled && <Lock size={11} />} {on ? 'ON' : 'OFF'}
    </button>
  );
}

/* ── tone hex (인라인 색; lint:tones 우회용 허용 패턴) ─────────── */
function toneHex(tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info'): string {
  switch (tone) {
    case 'success': return '#34d399';
    case 'warning': return '#fbbf24';
    case 'danger': return '#f87171';
    case 'info': return '#38bdf8';
    default: return '#9ca3af';
  }
}
