/**
 * AiPreviewBackendDashboard — AI-MUSIC-12 Isolated Preview Backend Provisioning & Vercel Rebinding (Preview).
 * Rule 기반(LLM/ML 아님) PURE audit/planning 하니스. Supabase Project/Branch 를 생성하지 않고, Vercel 환경변수를
 * 변경하지 않으며, Production Migration 을 적용하지 않고, Queue/재생을 변경하지 않는다. 감사 결과: org=pro (Branch
 * 비용 발생), SRR 전용 Test Project 없음 → 결정 MANUAL_PROVISIONING_REQUIRED (비용 발생 리소스 자동 생성 금지).
 * 허용 버튼: Re-run Audit / Validate Isolation / Generate Provisioning Plan / Dry-run Migration / Validate
 * Environment Scope / Generate Rollback Plan / Record Readiness. 금지: Modify Production Environment / Apply
 * Production Migration / Copy Production Data / Create Customer Store / Activate Hook / Start Canary / Full
 * Rollout. master + backend dashboard flag 기본 OFF, Kill Switch 기본 ON.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Server, Boxes, GitBranch, ShieldCheck, Database, GitMerge, TerminalSquare, Cloud, Link2, Lock, KeyRound,
  HardDrive, Undo2, Rocket, Save,
} from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminAlert, type AdminToneName,
} from '@/components/admin/ui';
import {
  auditInfrastructure, selectBackendStrategy, validateBackendIsolation, decideSchemaBaseline,
  AI_MUSIC_MIGRATION_GRAPH, validateMigrationGraph, guardMigrationRunner, planEnvRebinding, buildRollbackPlan,
  computeProvisioningReadiness, getAiPreviewBackendConfig, PRODUCTION_PROJECT_REF, ORG_ID,
} from '@/lib/aiPreviewBackend';

type Tab = 'infra' | 'projects' | 'strategy' | 'isolation' | 'schema' | 'migrations' | 'runner' | 'vercel' | 'rebinding' | 'connection' | 'invariance' | 'auth' | 'storage' | 'rollback' | 'readiness';
const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: 'infra', label: 'Infrastructure', icon: <Server size={14} /> },
  { key: 'projects', label: 'Supabase Projects', icon: <Boxes size={14} /> },
  { key: 'strategy', label: 'Backend Strategy', icon: <GitBranch size={14} /> },
  { key: 'isolation', label: 'Isolation', icon: <ShieldCheck size={14} /> },
  { key: 'schema', label: 'Schema Baseline', icon: <Database size={14} /> },
  { key: 'migrations', label: 'Migration Graph', icon: <GitMerge size={14} /> },
  { key: 'runner', label: 'Migration Runner', icon: <TerminalSquare size={14} /> },
  { key: 'vercel', label: 'Vercel Environment', icon: <Cloud size={14} /> },
  { key: 'rebinding', label: 'Rebinding', icon: <Link2 size={14} /> },
  { key: 'connection', label: 'Connection', icon: <Link2 size={14} /> },
  { key: 'invariance', label: 'Production Invariance', icon: <Lock size={14} /> },
  { key: 'auth', label: 'Auth', icon: <KeyRound size={14} /> },
  { key: 'storage', label: 'Storage', icon: <HardDrive size={14} /> },
  { key: 'rollback', label: 'Rollback', icon: <Undo2 size={14} /> },
  { key: 'readiness', label: 'Readiness', icon: <Rocket size={14} /> },
];

function tone(s: string): AdminToneName {
  switch (s) {
    case 'ISOLATED': case 'VALID': case 'PLAN_READY': case 'EXISTING_PROJECT_SELECTED': case 'ISOLATED_BACKEND_READY': case 'READY_TO_PROVISION': case 'CONNECTED_ISOLATED': case 'INVARIANT': return 'success';
    case 'PARTIAL': case 'MANUAL_PROVISIONING_REQUIRED': case 'MANUAL_ACTION_REQUIRED': case 'LOCAL_ONLY_SELECTED': case 'DRY_RUN': case 'READY_TO_BIND': case 'READY_TO_APPLY_PREVIEW_SCHEMA': case 'ROLLBACK_PLAN_READY': return 'warning';
    case 'SHARED_PROJECT': case 'SHARED_DB': case 'SHARED_AUTH': case 'SHARED_STORAGE': case 'PRODUCTION_SCOPE': case 'UNSAFE': case 'BLOCKED': case 'BLOCKED_NOT_ISOLATED': case 'BLOCKED_PRODUCTION_SCOPE': case 'REJECTED_PRODUCTION_REF': case 'PRODUCTION_BOUND': case 'CHANGED': case 'DEPENDENCY_MISSING': return 'danger';
    default: return 'info';
  }
}

const PROJECTS = [
  { ref: PRODUCTION_PROJECT_REF, name: 'SRR Playlist', region: 'ap-southeast-1', organizationId: ORG_ID },
  { ref: 'wxdlcjgvclyygjvimhgn', name: 'STUDIOBODA', region: 'ap-northeast-1', organizationId: ORG_ID },
  { ref: 'tyrhbiwvwmdybwaydvto', name: "freemilesarea-boop's Project", region: 'ap-northeast-1', organizationId: ORG_ID },
];

export default function AiPreviewBackendDashboard() {
  const cfg = getAiPreviewBackendConfig();
  const [tab, setTab] = useState<Tab>('infra');
  const [notice, setNotice] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);

  const infra = useMemo(() => auditInfrastructure({ productionRef: PRODUCTION_PROJECT_REF, projects: PROJECTS, orgPlan: 'pro', branchingAvailable: true, branchCostBearing: true, projectCreatePermission: true }), []);
  const strategy = useMemo(() => selectBackendStrategy({ srrTestProjectExists: infra.srrTestProjectExists, branchingAvailable: true, branchCostBearing: true, projectCreatePermission: true, costApproved: cfg.costApproved, localSupabaseAvailable: false }), [infra.srrTestProjectExists, cfg.costApproved]);
  const isolation = useMemo(() => validateBackendIsolation({ productionProjectRef: PRODUCTION_PROJECT_REF, previewProjectRef: cfg.previewProjectRef, productionDbHostHash: 'prod', previewDbHostHash: cfg.previewProjectRef ? 'preview' : null, productionAuthTenantHash: 'prod', previewAuthTenantHash: cfg.previewProjectRef ? 'preview' : null, productionStorageNamespaceHash: 'prod', previewStorageNamespaceHash: cfg.previewProjectRef ? 'preview' : null, environmentScope: 'preview', killSwitch: cfg.killSwitch, testbedEnabled: false }), [cfg.previewProjectRef, cfg.killSwitch]);
  const schema = useMemo(() => decideSchemaBaseline({ aiMusicRequiresBaseSchema: true, minimalSubsetProven: false }), []);
  const graph = useMemo(() => validateMigrationGraph({ nodes: AI_MUSIC_MIGRATION_GRAPH }), []);
  const runner = useMemo(() => guardMigrationRunner({ targetProjectRef: cfg.previewProjectRef, productionProjectRef: PRODUCTION_PROJECT_REF, isolationStatus: isolation.status, confirmPreview: false, dryRun: true }), [cfg.previewProjectRef, isolation.status]);
  const envPlan = useMemo(() => planEnvRebinding({ previewProjectRef: cfg.previewProjectRef, productionProjectRef: PRODUCTION_PROJECT_REF, previewSupabaseUrlPresent: false, previewServiceRoleScoped: false, isolationStatus: isolation.status }), [cfg.previewProjectRef, isolation.status]);
  const rollback = useMemo(() => buildRollbackPlan({ previewEnvSnapshotPresent: true, touchesProductionScope: false, executed: false }), []);
  const readiness = useMemo(() => computeProvisioningReadiness({
    backendTypeSelected: true, costPlanKnown: true, backendCreated: false, dbIsolated: false, authIsolated: false,
    storageIsolated: false, schemaStrategyReady: true, migrationGraphValid: graph.status === 'VALID',
    migrationRunnerReady: true, envPlanReady: false, productionInvariant: true, connectionVerified: false,
    rollbackReady: true, cleanupReady: true, securityReady: true,
  }), [graph.status]);

  const B = ({ s }: { s: string }) => <AdminBadge tone={tone(s)}>{s}</AdminBadge>;
  const act = (msg: string) => () => setNotice(msg);
  const recordReadiness = useCallback(() => { setRecorded(true); setNotice(`Readiness 기록됨 (로컬): ${readiness.status} — 실제 적용 아님.`); }, [readiness.status]);

  if (!cfg.masterEnabled || !cfg.backendDashboardEnabled) {
    return (
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Server size={18} /> AI Preview Backend <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-12 (Preview)</span></h2>
        <AdminAlert tone="info" title="Preview Backend Provisioning 비활성 (기본 OFF · Kill Switch ON)">
          Rule 기반 Preview Backend Provisioning 하니스는 기본 OFF입니다. <code>VITE_AI_MUSIC_ENABLED</code>(마스터) + <code>VITE_AI_PREVIEW_BACKEND_DASHBOARD_ENABLED</code> 로 로드됩니다.
          이 도구는 Supabase Project/Branch 를 생성하지 않고 Vercel 환경변수를 변경하지 않으며, 실제 Backend 생성/연결은 비용/승인 확인 후 수동 절차입니다(MANUAL_PROVISIONING_REQUIRED).
        </AdminAlert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Server size={18} /> AI Preview Backend <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-12</span></h2>
          <p className="text-xs text-text-tertiary">Audit/Plan 전용 · Supabase 리소스 미생성 · Vercel Env 미변경 · Production 불변 · 결정: {strategy.result}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminButton size="sm" variant="solid" onClick={act(`Audit: ${infra.classifications.length} projects · SRR Test Project ${infra.srrTestProjectExists ? '있음' : '없음'}`)}>Re-run Audit</AdminButton>
          <AdminButton size="sm" variant="subtle" onClick={act(`Isolation: ${isolation.status}`)}>Validate Isolation</AdminButton>
          <AdminButton size="sm" variant="subtle" onClick={act(`Provisioning Plan: ${strategy.result} (${strategy.recommendedName ?? '—'})`)}>Generate Provisioning Plan</AdminButton>
          <AdminButton size="sm" variant="subtle" onClick={act(`Dry-run Migration: ${runner.result} (wouldApply=${runner.wouldApply})`)}>Dry-run Migration</AdminButton>
          <AdminButton size="sm" variant="subtle" onClick={act(`Env Scope: ${envPlan.status} · production untouched=${envPlan.productionScopeUntouched}`)}>Validate Environment Scope</AdminButton>
          <AdminButton size="sm" variant="ghost" onClick={act(`Rollback: ${rollback.result}`)}>Generate Rollback Plan</AdminButton>
          <AdminButton size="sm" variant="outline" leftIcon={<Save size={14} />} onClick={recordReadiness}>Record Readiness</AdminButton>
        </div>
      </div>

      <AdminAlert tone={strategy.result === 'BLOCKED' || strategy.result === 'NOT_AVAILABLE' ? 'danger' : strategy.result === 'EXISTING_PROJECT_SELECTED' || strategy.result === 'BRANCH_CREATED' || strategy.result === 'TEST_PROJECT_CREATED' ? 'success' : 'warning'} title={`Strategy: ${strategy.result} · Isolation: ${isolation.status} · Readiness: ${readiness.status}`}>
        <span className="text-[11px]">{strategy.reasons[0]} — org=pro(Branch 비용 발생), SRR 전용 Test Project 없음. 비용/승인 확인 후 수동 provisioning 필요. Supabase 리소스·Vercel Env 이번 Phase 미변경.</span>
      </AdminAlert>
      {notice && <AdminAlert tone="info" title="기록">{notice}</AdminAlert>}

      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${tab === t.key ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover'}`}>{t.icon}{t.label}</button>)}
      </div>

      {tab === 'infra' && (
        <AdminCard title="Infrastructure Overview">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            <AdminStatCard label="Strategy" value={strategy.result} tone={tone(strategy.result)} />
            <AdminStatCard label="Preview Project" value={cfg.previewProjectRef ?? '(unset)'} tone="info" />
            <AdminStatCard label="Isolation" value={isolation.status} tone={tone(isolation.status)} />
            <AdminStatCard label="Schema" value={schema.strategy} tone="info" />
            <AdminStatCard label="Migration Graph" value={graph.status} tone={tone(graph.status)} />
            <AdminStatCard label="Migration Runner" value={runner.result} tone={tone(runner.result)} />
            <AdminStatCard label="Env Binding" value={envPlan.status} tone={tone(envPlan.status)} />
            <AdminStatCard label="Redeploy" value={envPlan.redeployRequired ? 'required' : '—'} tone="info" />
            <AdminStatCard label="Connection" value="NOT_DEPLOYED" tone="info" />
            <AdminStatCard label="Production Invariance" value="INVARIANT" tone="success" />
            <AdminStatCard label="Kill Switch" value={cfg.killSwitch ? 'ON' : 'OFF'} tone={cfg.killSwitch ? 'success' : 'danger'} />
            <AdminStatCard label="Provisioning Readiness" value={readiness.status} tone={tone(readiness.status)} />
          </div>
          <p className="mt-3 text-[11px] text-text-tertiary">Modify Production Environment / Apply Production Migration / Copy Production Data / Create Store / Activate Hook / Start Canary / Full Rollout 버튼은 제공하지 않습니다.</p>
        </AdminCard>
      )}

      {tab === 'projects' && (
        <AdminCard title="Supabase Projects (classification)">
          <div className="max-h-[24rem] overflow-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-text-tertiary"><th className="py-1">Name</th><th>Region</th><th>Relation</th><th>Reusable</th></tr></thead>
              <tbody>{infra.classifications.map((c) => (
                <tr key={c.ref} className="border-t border-border"><td className="py-1 text-text-primary">{c.name}</td><td className="text-text-secondary">{PROJECTS.find((p) => p.ref === c.ref)?.region}</td><td><B s={c.relation} /></td><td>{c.reusable ? 'yes' : 'no'}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-text-tertiary">이름이 아니라 실제 App 연결 관계로 분류합니다. 관련 없는 Project(STUDIOBODA 등) 재사용 금지.</p>
        </AdminCard>
      )}

      {tab === 'strategy' && (
        <AdminCard title="Backend Strategy Decision">
          <div className="flex items-center gap-2"><B s={strategy.result} /><span className="text-[11px] text-text-tertiary">option: {strategy.option ?? '—'} · name: {strategy.recommendedName ?? '—'} · cost: {strategy.estimatedCost}</span></div>
          <ul className="mt-2 list-disc pl-4 text-[11px] text-text-secondary">{strategy.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          {strategy.manualSteps.length > 0 && <div className="mt-2"><p className="text-[11px] font-medium text-text-tertiary">Manual Steps (수동 · 이번 Phase 미실행)</p><ol className="list-decimal pl-4 text-[11px] text-text-secondary">{strategy.manualSteps.map((s, i) => <li key={i}>{s}</li>)}</ol></div>}
        </AdminCard>
      )}

      {tab === 'isolation' && (
        <AdminCard title="Backend Isolation">
          <div className="flex items-center gap-2"><B s={isolation.status} /><span className="text-[11px] text-text-tertiary">Project/DB/Auth/Storage 모두 Production 과 달라야 ISOLATED</span></div>
          {isolation.blockers.length > 0 && <ul className="mt-2 list-disc pl-4 text-[11px] text-red-300">{isolation.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>}
        </AdminCard>
      )}

      {tab === 'schema' && <AdminCard title="Schema Baseline"><div className="flex items-center gap-2"><B s={schema.strategy} /></div><ul className="mt-2 list-disc pl-4 text-[11px] text-text-tertiary">{schema.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></AdminCard>}

      {tab === 'migrations' && (
        <AdminCard title="Migration Dependency Graph">
          <div className="mb-2 flex items-center gap-2"><B s={graph.status} /><span className="text-[11px] text-text-tertiary">{graph.orderedIds.join(' → ')}</span></div>
          <div className="max-h-[22rem] overflow-auto"><table className="w-full text-xs"><thead><tr className="text-left text-text-tertiary"><th className="py-1">Node</th><th>Requires</th><th>Tables</th><th>Fns</th><th>Risk</th></tr></thead><tbody>{AI_MUSIC_MIGRATION_GRAPH.map((n) => (<tr key={n.id} className="border-t border-border"><td className="py-1 text-text-primary">{n.id}</td><td className="text-text-secondary">{n.requiredPredecessors.join(',') || '—'}</td><td>{n.createdTables}</td><td>{n.createdFunctions}</td><td>{n.risk}</td></tr>))}</tbody></table></div>
        </AdminCard>
      )}

      {tab === 'runner' && (
        <AdminCard title="Preview Migration Runner (dry-run)">
          <div className="flex items-center gap-2"><B s={runner.result} /><span className="text-[11px] text-text-tertiary">wouldApply: {String(runner.wouldApply)}</span></div>
          <ul className="mt-2 list-disc pl-4 text-[11px] text-text-tertiary">{runner.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <p className="mt-1 text-[11px] text-text-tertiary">scripts/apply-ai-preview-migrations.mjs 는 Production Ref 를 무조건 거부하고, 격리 Preview DB 가 없으면 적용을 거부합니다.</p>
        </AdminCard>
      )}

      {(tab === 'vercel' || tab === 'rebinding') && (
        <AdminCard title="Vercel Preview Environment Rebinding (plan only)">
          <div className="flex items-center gap-2"><B s={envPlan.status} /><span className="text-[11px] text-text-tertiary">production scope untouched: {String(envPlan.productionScopeUntouched)} · redeploy: {String(envPlan.redeployRequired)}</span></div>
          {envPlan.previewScopeChanges.length > 0 && <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-bg-base p-3 text-[11px] text-text-secondary">{envPlan.previewScopeChanges.join('\n')}</pre>}
          <ul className="mt-1 list-disc pl-4 text-[11px] text-text-tertiary">{envPlan.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </AdminCard>
      )}

      {tab === 'connection' && <AdminCard title="Preview Connection Verification"><AdminAlert tone="info" title="NOT_DEPLOYED"><span className="text-[11px]">격리 Preview Backend 가 없어 새 Preview Deployment 연결 검증은 이번 Phase 에서 수행하지 않습니다. scripts/verify-ai-preview-schema.mjs 로 향후 검증(Project Ref ≠ Production, Base Schema, Flags OFF, Kill Switch ON).</span></AdminAlert></AdminCard>}
      {tab === 'invariance' && <AdminCard title="Production Invariance"><div className="flex items-center gap-2"><B s="INVARIANT" /><span className="text-[11px] text-text-tertiary">Production Project Ref / Supabase URL / Anon·Service Key presence / Migration head(0453) / Deployment SHA — 모두 불변 (이번 Phase 변경 없음)</span></div></AdminCard>}
      {tab === 'auth' && <AdminCard title="Preview Auth Isolation (plan)"><p className="text-[11px] text-text-tertiary">Preview Auth Tenant 분리 · Test User 는 Production Auth 에 없음 · Test Alias 이메일 · Redirect/Site URL 은 Preview 도메인 · OAuth Preview-safe · Test User expiry · Cleanup 가능. 실제 Test Account 생성은 Backend ISOLATED + Schema 준비 후 다음 Phase.</p></AdminCard>}
      {tab === 'storage' && <AdminCard title="Preview Storage Isolation (plan)"><p className="text-[11px] text-text-tertiary">Preview 전용 Bucket · Production Bucket 미접근 · Synthetic 또는 권리 보유 Test Audio 만 · Production Audio 복사 금지 · Signed URL Scope 제한 · RLS/Storage Policy · Cleanup/Expiry. Test Audio 미준비 시 Playlist Fixture 는 다음 Phase DEFERRED.</p></AdminCard>}

      {tab === 'rollback' && (
        <AdminCard title="Rollback Plan">
          <div className="flex items-center gap-2"><B s={rollback.result} /><span className="text-[11px] text-text-tertiary">production untouched: {String(rollback.productionUntouched)}</span></div>
          <ol className="mt-2 list-decimal pl-4 text-[11px] text-text-secondary">{rollback.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <p className="mt-1 text-[11px] text-text-tertiary">Production 으로 Failover 하지 않습니다. Preview 연결 실패 시 Preview Testbed 를 BLOCKED 처리합니다.</p>
        </AdminCard>
      )}

      {tab === 'readiness' && (
        <AdminCard title="Provisioning Readiness Certification">
          <div className="mb-2 flex items-center gap-2"><B s={readiness.status} /><span className="text-[11px] text-text-tertiary">recorded: {recorded ? 'yes' : 'no'} · runtime hook: {String(readiness.runtimeHookImplemented)}</span></div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div><p className="text-[11px] font-medium text-text-tertiary">Satisfied</p><p className="text-[11px] text-emerald-300">{readiness.satisfied.join(' · ') || '—'}</p></div>
            <div><p className="text-[11px] font-medium text-text-tertiary">Missing</p><p className="text-[11px] text-text-secondary">{readiness.missing.join(' · ') || '—'}</p></div>
          </div>
          <div className="mt-2"><p className="text-[11px] font-medium text-text-tertiary">Manual Actions (수동 · 승인 필요)</p><ol className="list-decimal pl-4 text-[11px] text-text-secondary">{readiness.manualActions.map((r, i) => <li key={i}>{r}</li>)}</ol></div>
          <p className="mt-1 text-[11px] text-text-tertiary">다음 Phase: {readiness.nextPhase}. 실제 Backend 가 생성·검증되지 않았으므로 ISOLATED_BACKEND_READY 로 보고하지 않습니다.</p>
        </AdminCard>
      )}
    </div>
  );
}
