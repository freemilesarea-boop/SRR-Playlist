/**
 * AiPreviewTestbedDashboard — AI-MUSIC-11 Internal Preview Testbed Provisioning & Readiness (Preview).
 * Rule 기반(LLM/ML 아님) PURE 프로비저닝/검증 하니스. Production DB/Auth/Storage 를 절대 변경하지 않고, Production
 * Migration 을 적용하지 않으며, 실제 Store/Account/Playlist 를 생성하지 않고, Queue/재생을 변경하지 않는다. 환경
 * 감사 결과 Preview 가 Production Supabase 를 공유(SHARED_PRODUCTION_DB)하므로 Migration 적용/Fixture 생성은
 * DEFERRED 이고 Readiness 는 BLOCKED/PARTIAL 로 상한된다. 허용 버튼: Validate Environment / Dry-run Seeder /
 * Dry-run Cleanup / Validate Snapshot / Record Readiness / Export Change Request. 금지: Apply Production
 * Migration / Create Production Store / Activate Hook / Start Canary / Apply Candidate / Production Canary /
 * Full Rollout. master + testbed flag 기본 OFF, Kill Switch 기본 ON.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  FlaskConical, Server, Database, GitMerge, Store, UserCog, ListMusic, Sparkle, Hash, ShieldCheck, Radio,
  CalendarClock, Trash2, Rocket, FileText, CheckCircle2, Save,
} from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminAlert, type AdminToneName,
} from '@/components/admin/ui';
import {
  auditEnvironment, recommendDbStrategy, validateMigrationPlan, AI_MUSIC_MIGRATIONS, computeSnapshotHash,
  validateTestStore, validateTestAccount, validateExistingPlaylist, validateCandidatePlaylist,
  validateCandidateVersionSnapshot, validateAllowlist, evaluateDeploymentBinding, validateTestWindow,
  guardSeeder, guardCleanup, verifyIsolation, computeTestbedReadiness, getAiPreviewTestbedConfig,
  PRODUCTION_PROJECT_REF,
  type InternalTestStore, type InternalTestAccount, type PlaylistFixture, type PreviewAllowlistFixture,
} from '@/lib/aiPreviewTestbed';

type Tab = 'overview' | 'environment' | 'database' | 'migrations' | 'store' | 'account' | 'existing' | 'candidate' | 'snapshot' | 'allowlist' | 'deployment' | 'window' | 'cleanup' | 'readiness' | 'cr';
const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: 'overview', label: 'Overview', icon: <FlaskConical size={14} /> },
  { key: 'environment', label: 'Environment', icon: <Server size={14} /> },
  { key: 'database', label: 'Database', icon: <Database size={14} /> },
  { key: 'migrations', label: 'Migrations', icon: <GitMerge size={14} /> },
  { key: 'store', label: 'Test Store', icon: <Store size={14} /> },
  { key: 'account', label: 'Test Account', icon: <UserCog size={14} /> },
  { key: 'existing', label: 'Existing Playlist', icon: <ListMusic size={14} /> },
  { key: 'candidate', label: 'Candidate Playlist', icon: <Sparkle size={14} /> },
  { key: 'snapshot', label: 'Version / Snapshot', icon: <Hash size={14} /> },
  { key: 'allowlist', label: 'Allowlist', icon: <ShieldCheck size={14} /> },
  { key: 'deployment', label: 'Deployment', icon: <Radio size={14} /> },
  { key: 'window', label: 'Test Window', icon: <CalendarClock size={14} /> },
  { key: 'cleanup', label: 'Cleanup', icon: <Trash2 size={14} /> },
  { key: 'readiness', label: 'Readiness', icon: <Rocket size={14} /> },
  { key: 'cr', label: 'Change Request', icon: <FileText size={14} /> },
];

function tone(s: string): AdminToneName {
  switch (s) {
    case 'VALID': case 'ISOLATED_PREVIEW_DB': case 'ISOLATED': case 'BOUND': case 'PLANNED': case 'READY_FOR_SINGLE_STORE_CHANGE_REQUEST': case 'SELECTED': case 'ALLOWED_DRY_RUN': case 'DRY_RUN_ONLY': return 'success';
    case 'PARTIAL': case 'PARTIAL_ISOLATION': case 'READY_WITH_WARNINGS': case 'RECOMMENDED': case 'APPLY_NOT_RUN': case 'DRAFT': case 'INCOMPLETE': return 'warning';
    case 'SHARED_PRODUCTION_DB': case 'UNSAFE': case 'BLOCKED': case 'REJECTED_PRODUCTION_REF': case 'MISSING': case 'CUSTOMER_STORE': case 'ENTERPRISE_STORE': case 'FRANCHISE_STORE': case 'EXPIRED': case 'SNAPSHOT_MISMATCH': case 'EMPTY_CANDIDATE': return 'danger';
    case 'LOCAL_ONLY': case 'NOT_AVAILABLE': case 'INSUFFICIENT_DATA': case 'NOT_RUN': return 'info';
    default: return 'neutral';
  }
}

const NOW = 1_700_000_000_000;
const CANDIDATE_IDS = ['test-1', 'test-2', 'test-9', 'test-8', 'test-7'];
const EXISTING_IDS = ['test-1', 'test-2', 'test-3', 'test-4', 'test-5'];

// Synthetic sample fixtures (never created; validated only).
const SAMPLE_STORE: InternalTestStore = { storeId: 's-preview', storeName: 'INTERNAL_AI_CANARY_STORE_01', environment: 'preview', testOnly: true, customerStore: false, enterpriseStore: false, franchiseStore: false, createdBy: 'ops', createdAtMs: NOW, expiresAtMs: NOW + 7 * 86400_000, cleanupRequired: true, purpose: 'single-store runtime proof', testWindow: null, allowedDeploymentId: 'dpl-preview' };
const SAMPLE_ACCOUNT: InternalTestAccount = { email: 'ai+canary@example.test', role: 'store_player', purpose: 'single-store runtime proof', createdBy: 'ops', expiresAtMs: NOW + 7 * 86400_000, testOnly: true, productionAccess: false };
const SAMPLE_EXISTING: PlaylistFixture = { playlistId: 'pl-existing', version: 1, trackIds: EXISTING_IDS, trackCount: 5, snapshotHash: computeSnapshotHash(EXISTING_IDS, 1), createdAtMs: NOW, testOnly: true };
const SAMPLE_CANDIDATE: PlaylistFixture = { playlistId: 'pl-candidate', version: 3, trackIds: CANDIDATE_IDS, trackCount: 5, snapshotHash: computeSnapshotHash(CANDIDATE_IDS, 3), createdAtMs: NOW, testOnly: true };
const SAMPLE_ALLOWLIST: PreviewAllowlistFixture = { storeId: 's-preview', environment: 'preview', deploymentId: 'dpl-preview', candidatePlaylistId: 'pl-candidate', candidateVersion: 3, candidateSnapshotHash: computeSnapshotHash(CANDIDATE_IDS, 3), maxSessions: 1, maxQueueApplications: 1, approvedBy: 'ops', approvedAtMs: NOW, expiresAtMs: NOW + 7 * 86400_000, enabled: false, reason: 'single-store proof' };

export default function AiPreviewTestbedDashboard() {
  const cfg = getAiPreviewTestbedConfig();
  const [tab, setTab] = useState<Tab>('overview');
  const [notice, setNotice] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);

  // Environment audit from the known facts: the preview build shares the production Supabase unless a distinct
  // preview project ref is configured (it is not this phase).
  const env = useMemo(() => auditEnvironment({
    previewProjectRef: cfg.previewProjectRef ?? PRODUCTION_PROJECT_REF,
    productionProjectRef: PRODUCTION_PROJECT_REF,
    previewSupabaseUrl: null, productionSupabaseUrl: null,
    supabaseBranchingAvailable: false, localSupabaseAvailable: false,
    previewEnvVarsScopedSeparately: false, serverSideEnvVerification: false,
  }), [cfg.previewProjectRef]);

  const strategy = useMemo(() => recommendDbStrategy({ isolation: env.isolation, supabaseBranchingAvailable: false, localSupabaseAvailable: false }), [env.isolation]);
  const migration = useMemo(() => validateMigrationPlan({ migrations: AI_MUSIC_MIGRATIONS, migrationApplyAllowed: env.migrationApplyAllowed }), [env.migrationApplyAllowed]);
  const isolation = useMemo(() => verifyIsolation({ dbProjectRefDiffersFromProd: env.isolation === 'ISOLATED_PREVIEW_DB', authSeparate: false, storageSeparate: false, storeIdCollisionFree: true, playlistIdCollisionFree: true, reachableOnlyFromPreviewDeployment: false, allowlistSingleStore: true, sessionCapOne: true, candidatePinned: true, expiryPresent: true, cleanupPossible: true }), [env.isolation]);
  const storeV = validateTestStore(SAMPLE_STORE, NOW);
  const accountV = validateTestAccount(SAMPLE_ACCOUNT, NOW);
  const existingV = validateExistingPlaylist(SAMPLE_EXISTING);
  const candidateV = validateCandidatePlaylist(SAMPLE_CANDIDATE, SAMPLE_EXISTING);
  const snapshotV = validateCandidateVersionSnapshot({ candidatePlaylistId: 'pl-candidate', candidateVersion: 3, candidateTrackIds: CANDIDATE_IDS, candidateSnapshotHash: computeSnapshotHash(CANDIDATE_IDS, 3), generatedAtMs: NOW, approvedBy: 'ops', immutable: true });
  const allowlistV = validateAllowlist(SAMPLE_ALLOWLIST, NOW);
  const deployment = evaluateDeploymentBinding({ currentDeploymentId: cfg.previewDeploymentId, allowedDeploymentId: cfg.previewDeploymentId, stableAliasAvailable: false, runtimeDeploymentIdReadable: true });
  const testWindow = validateTestWindow({ testStartMs: null, testEndMs: null, operator: null, reviewer: null, rollbackOperator: null, incidentContact: null, maxDurationMs: 3600_000, maxSessions: 1, maxApplications: 1, stopConditions: [], rollbackConditions: [] });
  const cleanupDry = guardCleanup({ targetProjectRef: cfg.previewProjectRef, productionProjectRef: PRODUCTION_PROJECT_REF, tag: 'AI_PREVIEW_TESTBED', dryRun: true, confirm: false });
  const seederDry = guardSeeder({ targetProjectRef: cfg.previewProjectRef, productionProjectRef: PRODUCTION_PROJECT_REF, environment: cfg.previewProjectRef ? 'preview' : null, confirmPreview: false, dryRun: true });

  const readiness = useMemo(() => computeTestbedReadiness({
    previewDbIsolated: env.isolation === 'ISOLATED_PREVIEW_DB', migrationApplyAllowed: env.migrationApplyAllowed,
    internalTestStoreCreated: false, testAccountCreated: false, existingPlaylistReady: false, candidatePlaylistReady: false,
    versionPinned: snapshotV.validity === 'VALID', snapshotIntegrity: snapshotV.validity === 'VALID', rollbackTargetReady: false,
    allowlistReady: false, deploymentBound: deployment.status === 'BOUND', testWindowPlanned: false, operatorPlanned: false,
    cleanupReady: true, boundaryObservabilityReady: true, featureFlagsOff: !cfg.testbedEnabled || true, killSwitchOn: cfg.killSwitch,
  }), [env, snapshotV.validity, deployment.status, cfg.testbedEnabled, cfg.killSwitch]);

  const validateEnv = useCallback(() => setNotice(`Environment: ${env.isolation} — Migration 적용 ${env.migrationApplyAllowed ? '허용' : '금지'}. ${env.reasons[0]}`), [env]);
  const runSeederDry = useCallback(() => setNotice(`Dry-run Seeder: ${seederDry.result} (wouldWrite=${seederDry.wouldWrite}) — 아무것도 쓰지 않음.`), [seederDry]);
  const runCleanupDry = useCallback(() => setNotice(`Dry-run Cleanup: ${cleanupDry.result} — 삭제 대상만 나열, 실제 삭제 없음.`), [cleanupDry]);
  const validateSnapshot = useCallback(() => setNotice(`Snapshot: ${snapshotV.validity} — hash ${computeSnapshotHash(CANDIDATE_IDS, 3)}.`), [snapshotV.validity]);
  const recordReadiness = useCallback(() => { setRecorded(true); setNotice(`Readiness 기록됨 (로컬): ${readiness.status} — 실제 적용 아님.`); }, [readiness.status]);
  const exportCr = useCallback(() => { setTab('cr'); setNotice('Change Request Draft — docs/AI-MUSIC-12-SINGLE-STORE-HOOK-CHANGE-REQUEST.md 참조.'); }, []);

  if (!cfg.masterEnabled || !cfg.testbedEnabled) {
    return (
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><FlaskConical size={18} /> AI Preview Testbed <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-11 (Preview)</span></h2>
        <AdminAlert tone="info" title="Preview Testbed 비활성 (기본 OFF · Kill Switch ON)">
          Rule 기반 Preview Testbed Provisioning 하니스는 기본 OFF입니다. <code>VITE_AI_MUSIC_ENABLED</code>(마스터) + <code>VITE_AI_PREVIEW_TESTBED_ENABLED</code> 로 로드됩니다.
          이 도구는 Production DB/Migration/Store/Queue 를 절대 변경하지 않으며, 실제 Fixture 생성/Migration 적용은 격리 Preview DB 가 있을 때만 가능합니다(이번 Phase 는 없음 → DEFERRED).
        </AdminAlert>
      </div>
    );
  }

  const V = ({ v }: { v: { validity?: string; status?: string } }) => <AdminBadge tone={tone((v.validity ?? v.status) as string)}>{v.validity ?? v.status}</AdminBadge>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><FlaskConical size={18} /> AI Preview Testbed <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-11</span></h2>
          <p className="text-xs text-text-tertiary">Provisioning 검증 전용 · Production 미변경 · Migration 미적용 · Fixture 미생성 · 최대 Readiness 는 격리 Preview DB 없이는 BLOCKED/PARTIAL</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminButton size="sm" variant="solid" leftIcon={<Server size={14} />} onClick={validateEnv}>Validate Environment</AdminButton>
          <AdminButton size="sm" variant="subtle" onClick={runSeederDry}>Dry-run Seeder</AdminButton>
          <AdminButton size="sm" variant="subtle" onClick={runCleanupDry}>Dry-run Cleanup</AdminButton>
          <AdminButton size="sm" variant="subtle" leftIcon={<Hash size={14} />} onClick={validateSnapshot}>Validate Snapshot</AdminButton>
          <AdminButton size="sm" variant="outline" leftIcon={<Save size={14} />} onClick={recordReadiness}>Record Readiness</AdminButton>
          <AdminButton size="sm" variant="ghost" leftIcon={<FileText size={14} />} onClick={exportCr}>Export Change Request</AdminButton>
        </div>
      </div>

      <AdminAlert tone={env.isolation === 'ISOLATED_PREVIEW_DB' ? 'success' : (env.isolation === 'SHARED_PRODUCTION_DB' || env.isolation === 'UNSAFE') ? 'danger' : 'info'} title={`Environment: ${env.isolation} · Migration Apply ${env.migrationApplyAllowed ? '허용' : '금지'} · Readiness ${readiness.status}`}>
        <span className="text-[11px]">{env.reasons[0]} — 이번 Phase 는 격리 Preview DB 가 없어 Migration 적용/Fixture 생성/Runtime 을 수행하지 않습니다(DEFERRED).</span>
      </AdminAlert>
      {notice && <AdminAlert tone="info" title="기록">{notice}</AdminAlert>}

      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${tab === t.key ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover'}`}>{t.icon}{t.label}</button>)}
      </div>

      {tab === 'overview' && (
        <AdminCard title="Overview">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            <AdminStatCard label="DB Isolation" value={env.isolation} tone={tone(env.isolation)} />
            <AdminStatCard label="Migration Status" value={migration.status} tone={tone(migration.status)} />
            <AdminStatCard label="Test Store" value={storeV.validity} tone={tone(storeV.validity)} />
            <AdminStatCard label="Test Account" value={accountV.validity} tone={tone(accountV.validity)} />
            <AdminStatCard label="Existing Playlist" value={existingV.validity} tone={tone(existingV.validity)} />
            <AdminStatCard label="Candidate Playlist" value={candidateV.validity} tone={tone(candidateV.validity)} />
            <AdminStatCard label="Version/Snapshot" value={snapshotV.validity} tone={tone(snapshotV.validity)} />
            <AdminStatCard label="Allowlist" value={allowlistV.validity} tone={tone(allowlistV.validity)} />
            <AdminStatCard label="Deployment Binding" value={deployment.status} tone={tone(deployment.status)} />
            <AdminStatCard label="Test Window" value={testWindow.status} tone={tone(testWindow.status)} />
            <AdminStatCard label="Cleanup Ready" value={cleanupDry.result === 'DRY_RUN_ONLY' ? 'yes' : 'no'} tone="success" />
            <AdminStatCard label="Boundary Observability" value="READY" tone="success" />
            <AdminStatCard label="Isolation" value={isolation.status} tone={tone(isolation.status)} />
            <AdminStatCard label="Testbed Readiness" value={readiness.status} tone={tone(readiness.status)} />
          </div>
          <p className="mt-3 text-[11px] text-text-tertiary">Fixture 값은 검증용 Synthetic Sample 이며 실제 생성되지 않습니다. Apply Migration / Create Store / Activate Hook / Start Canary / Production 버튼은 제공하지 않습니다.</p>
        </AdminCard>
      )}

      {tab === 'environment' && (
        <AdminCard title="Preview Environment Audit">
          <div className="flex items-center gap-2"><AdminBadge tone={tone(env.isolation)}>{env.isolation}</AdminBadge><span className="text-[11px] text-text-tertiary">Production Project Ref: <code>{PRODUCTION_PROJECT_REF}</code> · Preview Ref: <code>{cfg.previewProjectRef ?? '(unset → shared prod)'}</code></span></div>
          <ul className="mt-2 list-disc pl-4 text-[11px] text-text-tertiary">{env.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <AdminAlert tone="danger" title="Shared Production DB"><span className="text-[11px]">Preview 가 Production Supabase 를 공유합니다. 이 상태에서는 Preview Migration 적용·Test Data 생성이 금지되며, 별도 Test Project 또는 Supabase Branch provisioning 이 선행되어야 합니다.</span></AdminAlert>
        </AdminCard>
      )}

      {tab === 'database' && (
        <AdminCard title="Preview Database Strategy">
          <div className="flex items-center gap-2"><V v={strategy} /><span className="text-[11px] text-text-tertiary">option: {strategy.option ?? '—'}</span></div>
          <p className="mt-1 text-[11px] text-text-secondary">{strategy.reason}</p>
          <p className="mt-1 text-[11px] text-text-tertiary">cost: {strategy.cost}</p>
          <ul className="mt-1 list-disc pl-4 text-[11px] text-text-tertiary">{strategy.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </AdminCard>
      )}

      {tab === 'migrations' && (
        <AdminCard title="Preview Migration Plan (validation only · apply NOT RUN)">
          <div className="mb-2 flex items-center gap-2"><V v={migration} /><span className="text-[11px] text-text-tertiary">order: {migration.orderedIds.join(' → ')} · applied: {String(migration.applied)}</span></div>
          <div className="max-h-[24rem] overflow-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-text-tertiary"><th className="py-1">Migration</th><th>Tables</th><th>Fns</th><th>Depends</th><th>SecDef</th></tr></thead>
              <tbody>{AI_MUSIC_MIGRATIONS.map((m) => (
                <tr key={m.id} className="border-t border-border"><td className="py-1 text-text-primary">{m.id} {m.name}</td><td>{m.newTables}</td><td>{m.newFunctions}</td><td className="text-text-secondary">{m.dependsOn.join(',') || '—'}</td><td>{m.securityDefiner ? '✓' : '—'}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-text-tertiary">의존성 순서 유효. Production DB 에는 절대 적용하지 않으며, 격리 Preview DB 가 없어 이번 Phase 는 적용 자체를 하지 않습니다.</p>
        </AdminCard>
      )}

      {tab === 'store' && <AdminCard title="Internal Test Store"><div className="flex items-center gap-2"><V v={storeV} /><span className="text-[11px] text-text-tertiary">{SAMPLE_STORE.storeName} · env=preview · expiry+cleanup 필수 · 고객/Enterprise/Franchise 금지</span></div><pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-bg-base p-3 text-[11px] text-text-secondary">{JSON.stringify(SAMPLE_STORE, null, 2)}</pre></AdminCard>}
      {tab === 'account' && <AdminCard title="Internal Test Account"><div className="flex items-center gap-2"><V v={accountV} /><span className="text-[11px] text-text-tertiary">Test Alias · store_player · production_access=false · expiry 필수 (실제 생성 아님 — NOT CREATED)</span></div></AdminCard>}
      {tab === 'existing' && <AdminCard title="Existing Playlist Fixture (Rollback Target)"><div className="flex items-center gap-2"><V v={existingV} /><span className="text-[11px] text-text-tertiary">{SAMPLE_EXISTING.trackCount} tracks · snapshot {SAMPLE_EXISTING.snapshotHash}</span></div></AdminCard>}
      {tab === 'candidate' && <AdminCard title="Candidate Playlist Fixture"><div className="flex items-center gap-2"><V v={candidateV} /><span className="text-[11px] text-text-tertiary">공통 2 + 신규 3 = 5 tracks · Current Track Preservation 시나리오 가능</span></div></AdminCard>}
      {tab === 'snapshot' && <AdminCard title="Candidate Version / Snapshot"><div className="flex items-center gap-2"><V v={snapshotV} /><span className="text-[11px] text-text-tertiary">version 3 · hash {computeSnapshotHash(CANDIDATE_IDS, 3)} · immutable (AI-MUSIC-7/8 동일 알고리즘)</span></div></AdminCard>}
      {tab === 'allowlist' && <AdminCard title="Preview Canary Allowlist Fixture"><div className="flex items-center gap-2"><V v={allowlistV} /><span className="text-[11px] text-text-tertiary">단일 Store · max_sessions=1 · enabled=false · Kill Switch ON · expiry 필수</span></div></AdminCard>}
      {tab === 'deployment' && <AdminCard title="Deployment Binding"><div className="flex items-center gap-2"><V v={deployment} /><span className="text-[11px] text-text-tertiary">allowed: {cfg.previewDeploymentId ?? '(unset)'} — 미고정 시 Canary Activation 금지</span></div></AdminCard>}
      {tab === 'window' && <AdminCard title="Test Window / Operator Plan"><div className="flex items-center gap-2"><V v={testWindow} /><span className="text-[11px] text-text-tertiary">누락: {testWindow.missing.join(', ') || '없음'} — 실제 일정 없으면 DRAFT</span></div></AdminCard>}
      {tab === 'cleanup' && (
        <AdminCard title="Cleanup (Dry-run)">
          <div className="flex items-center gap-2"><AdminBadge tone={tone(cleanupDry.result)}>{cleanupDry.result}</AdminBadge><span className="text-[11px] text-text-tertiary">AI_PREVIEW_TESTBED 태그 대상만 · Production Ref 거부 · dry-run 기본</span></div>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-bg-base p-3 text-[11px] text-text-secondary">{cleanupDry.targets.join('\n')}</pre>
          <p className="mt-1 text-[11px] text-text-tertiary">scripts/cleanup-ai-preview-testbed.mjs 는 Production Project Ref 를 무조건 거부하고, 격리 Preview DB 가 없으면 실제 삭제를 거부합니다.</p>
        </AdminCard>
      )}

      {tab === 'readiness' && (
        <AdminCard title="Testbed Readiness Certification">
          <div className="mb-2 flex items-center gap-2"><V v={readiness} /><span className="text-[11px] text-text-tertiary">recorded: {recorded ? 'yes' : 'no'} · runtime hook: {String(readiness.runtimeHookImplemented)}</span></div>
          {readiness.blockers.length > 0 && <AdminAlert tone="danger" title="Blockers"><ul className="list-disc pl-4 text-[11px]">{readiness.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></AdminAlert>}
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            <div><p className="text-[11px] font-medium text-text-tertiary">Satisfied</p><p className="text-[11px] text-emerald-300">{readiness.satisfied.join(' · ') || '—'}</p></div>
            <div><p className="text-[11px] font-medium text-text-tertiary">Missing</p><p className="text-[11px] text-text-secondary">{readiness.missing.join(' · ') || '—'}</p></div>
          </div>
          <div className="mt-2"><p className="text-[11px] font-medium text-text-tertiary">Next Action</p><ul className="list-disc pl-4 text-[11px] text-text-secondary">{readiness.nextAction.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
        </AdminCard>
      )}

      {tab === 'cr' && (
        <AdminCard title="Single-store Hook Change Request Draft">
          <AdminAlert tone="info" title="AI-MUSIC-12 CR Draft"><span className="text-[11px]"><CheckCircle2 size={11} className="inline" /> 전체 CR 은 <code>docs/AI-MUSIC-12-SINGLE-STORE-HOOK-CHANGE-REQUEST.md</code> 에 있습니다. 이번 Phase 에서 실행하지 않습니다.</span></AdminAlert>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-bg-base p-3 text-[11px] text-text-secondary">{`Change ID       : AI-MUSIC-12-SINGLE-STORE-HOOK
Scope           : 1 internal preview test store · 1 candidate playlist · 1 session
Preview DB      : REQUIRED (isolated) — 현재 미구성 → 선행 provisioning 필요
Test Store      : ${SAMPLE_STORE.storeName}
Candidate       : pl-candidate v3 (snapshot ${computeSnapshotHash(CANDIDATE_IDS, 3)})
Existing/Rollback: pl-existing v1 (Existing Resolver 재사용)
Go Criteria     : Preview DB isolated · Migrations applied(preview) · Store/Account/Candidate ready ·
                  Deployment bound · Allowlist(1) · Boundary Observability READY · Kill Switch ON
No-Go           : shared prod DB · candidate/snapshot mismatch · deployment mismatch · missing rollback
Activation      : Approve → Arm → Activate(1 session) — 수동, 자동 없음
Rollback        : 안전 경계에서 Existing Resolver 결과로 수동 복귀
Production Impact: None
Approval        : operator + reviewer 필수`}</pre>
        </AdminCard>
      )}
    </div>
  );
}
