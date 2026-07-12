/**
 * AiRuntimeProofDashboard — AI-MUSIC-9 Isolated Preview Queue Hook & Single-Store Runtime Proof (Preview).
 * Rule 기반(LLM/ML 아님) PURE 클라이언트 하니스. 실제 Player Store Queue / Audio / 재생을 절대 변경하지 않는다
 * (모든 결과는 시뮬레이션). 이번 Phase 는 Go/No-Go = NO-GO 로 Runtime Hook 을 구현하지 않는다(DEFERRED):
 * Internal Test Store 미구성, Preview Migration 미적용(Resolver 호출 불가), Crossfade/Recovery/Preload 상태가
 * Player.tsx component-local 이라 Runtime 관측 불가(Player.tsx 변경 금지). Synthetic Scenario 를 로컬에서 실행해
 * Gate/Boundary/Queue-only/Preservation/Fail-open/Guardrail/Kill Switch/Rollback/Certification 을 검증한다.
 * 허용 버튼: Approve Hook / Arm Single Store / Activate Session / Pause / Request·Confirm Stop /
 * Request·Confirm Rollback / Enable Kill Switch / Record Certification (모두 로컬 시뮬레이션).
 * 금지: Add Multiple Stores / Production Canary / Full Rollout / Automatic Expand / Customer Store Apply.
 * master + 세부 flag 기본 OFF, Kill Switch 기본 ON.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Radar, Store, CalendarClock, Route, ScrollText, Layers, Gauge, ShieldAlert, Power, Undo2, Award, GitBranch,
  Play, Save, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminEmpty, AdminAlert, type AdminToneName,
} from '@/components/admin/ui';
import {
  evaluateRuntimeHook, evaluateGoNoGo, computeSingleStoreCertification, computeProductionCrReadiness,
  evaluateGuardrails, evaluateRollback, getAiRuntimeHookConfig,
  type RuntimeHookInput, type RuntimeHookResult, type IsolatedTestStore, type RuntimePlaybackSnapshot,
  type RuntimeHookFlags, type SingleStoreCertResult, type ProductionCrReadinessResult, type GoNoGoResult,
} from '@/lib/aiRuntimeHook';

type Tab =
  | 'readiness' | 'single-store' | 'reservations' | 'boundaries' | 'evidence' | 'currenttrack'
  | 'playback' | 'guardrails' | 'killswitch' | 'rollback' | 'certification' | 'cr-readiness';
const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: 'readiness', label: 'Hook Readiness', icon: <GitBranch size={14} /> },
  { key: 'single-store', label: 'Single Store', icon: <Store size={14} /> },
  { key: 'reservations', label: 'Reservations', icon: <CalendarClock size={14} /> },
  { key: 'boundaries', label: 'Boundaries', icon: <Route size={14} /> },
  { key: 'evidence', label: 'Runtime Evidence', icon: <ScrollText size={14} /> },
  { key: 'currenttrack', label: 'Current Track', icon: <Layers size={14} /> },
  { key: 'playback', label: 'Playback State', icon: <Gauge size={14} /> },
  { key: 'guardrails', label: 'Guardrails', icon: <ShieldAlert size={14} /> },
  { key: 'killswitch', label: 'Kill Switch', icon: <Power size={14} /> },
  { key: 'rollback', label: 'Rollback', icon: <Undo2 size={14} /> },
  { key: 'certification', label: 'Certification', icon: <Award size={14} /> },
  { key: 'cr-readiness', label: 'CR Readiness', icon: <Radar size={14} /> },
];

function tone(s: string): AdminToneName {
  switch (s) {
    case 'APPLIED_AT_BOUNDARY': case 'PRESERVED': case 'CERTIFIED_FOR_SINGLE_INTERNAL_STORE': case 'CANDIDATE_MAY_APPLY': case 'ROLLED_BACK_AT_BOUNDARY': case 'CLEAR': case 'PASSED': case 'GO': case 'VALID': return 'success';
    case 'WAITING_BOUNDARY': case 'CANDIDATE_DEFERRED': case 'CANDIDATE_STALE': case 'READY_WITH_WARNINGS': case 'MORE_SINGLE_STORE_EVIDENCE_REQUIRED': case 'STOP_RECOMMENDED': case 'ROLLBACK_RESERVED': case 'REVIEW_REQUIRED': return 'warning';
    case 'KILL_SWITCHED': case 'UNSAFE_BOUNDARY': case 'VERSION_MISMATCH': case 'SNAPSHOT_MISMATCH': case 'SESSION_LIMIT': case 'DEPLOYMENT_MISMATCH': case 'STORE_NOT_ALLOWED': case 'BLOCKED': case 'CANDIDATE_CANCELLED': case 'FORBIDDEN_CHANGE': case 'NO_GO': return 'danger';
    case 'CONTROL_PRESERVED': case 'FLAG_DISABLED': case 'NO_ACTION': case 'FAIL_OPEN': case 'NOT_RUN': case 'NOT_OBSERVABLE': case 'INSUFFICIENT_DATA': case 'SAFE_ADAPTER_ONLY': case 'DEFERRED': return 'info';
    default: return 'neutral';
  }
}

// ── Built-in synthetic scenarios (pure; never touches the real player) ──
const NOW = 1_700_000_000_000;
function store(o: Partial<IsolatedTestStore> = {}): IsolatedTestStore {
  return { storeId: 's-internal', storeNameHash: 'h', purpose: 'runtime-proof', previewDeploymentId: 'dpl-preview',
    approvedCandidatePlaylistId: 'pl-cand', approvedCandidateVersion: 3, approvedSnapshotHash: 'snap1',
    approvedExistingPlaylistId: 'pl-exist', approvedBy: 'op1', approvedAtMs: NOW - 1000, expiresAtMs: NOW + 60_000,
    maxSessions: 1, maxQueueApplications: 1, enabled: true, killSwitchRequired: true, ...o };
}
function pb(o: Partial<RuntimePlaybackSnapshot> = {}): RuntimePlaybackSnapshot {
  return { playing: true, paused: false, ended: false, buffering: false, recovering: false, crossfading: false,
    currentTime: 42, volume: 0.8, muted: false, sinkId: 'default', activeAudioIndex: 0, queueLength: 3,
    currentTrackId: 't2', observable: true, ...o };
}
function fl(o: Partial<RuntimeHookFlags> = {}): RuntimeHookFlags {
  return { masterEnabled: true, hookEnabled: true, queueOnlyAdapterEnabled: true, boundaryReservationEnabled: true,
    runtimeEvidenceEnabled: true, runtimeGuardrailEnabled: true, runtimeRollbackEnabled: true, ...o };
}
function hi(name: string, o: Partial<RuntimeHookInput> = {}): RuntimeHookInput {
  return { scenarioName: name, storeId: 's-internal', playerSessionId: 'sess1', resolvedPlaylistId: 'pl-cand',
    queueRevision: 5, resolverSource: 'PILOT_PREVIEW', currentTrackId: 't2', currentIndex: 1, playbackState: pb(),
    boundaryState: 'TRACK_ENDED', crossfadeState: false, recoveryState: false, preloadState: false,
    previewDeploymentId: 'dpl-preview', currentDeploymentId: 'dpl-preview', isPreviewEnvironment: true,
    isControlStore: false, candidatePlaylistId: 'pl-cand', candidateVersion: 3, candidateSnapshotHash: 'snap1',
    existingQueueTrackIds: ['t1', 't2', 't3'], candidateQueueTrackIds: ['t2', 't7', 't8'], sessionCount: 1,
    appliedCount: 0, store: store(), featureFlags: fl(), killSwitch: false, nowMs: NOW, ...o };
}
const SCENARIOS: Array<{ name: string; input: RuntimeHookInput }> = [
  { name: 'Store Not Configured', input: hi('Store Not Configured', { store: null }) },
  { name: 'Wrong Store', input: hi('Wrong Store', { storeId: 'other', store: store({ storeId: 'other-x' }) }) },
  { name: 'Wrong Deployment', input: hi('Wrong Deployment', { currentDeploymentId: 'dpl-prod' }) },
  { name: 'Feature Flag OFF', input: hi('Feature Flag OFF', { featureFlags: fl({ hookEnabled: false }) }) },
  { name: 'Kill Switch ON', input: hi('Kill Switch ON', { killSwitch: true }) },
  { name: 'Control Store', input: hi('Control Store', { isControlStore: true }) },
  { name: 'Second Session Rejected', input: hi('Second Session Rejected', { sessionCount: 2 }) },
  { name: 'Application Cap Reached', input: hi('Application Cap Reached', { appliedCount: 1 }) },
  { name: 'Candidate Version Mismatch', input: hi('Candidate Version Mismatch', { candidateVersion: 9 }) },
  { name: 'Snapshot Mismatch', input: hi('Snapshot Mismatch', { candidateSnapshotHash: 'zzz' }) },
  { name: 'Not Preview Environment', input: hi('Not Preview Environment', { isPreviewEnvironment: false }) },
  { name: 'Track Ended Boundary', input: hi('Track Ended Boundary', { boundaryState: 'TRACK_ENDED' }) },
  { name: 'Crossfade Active', input: hi('Crossfade Active', { crossfadeState: true }) },
  { name: 'Recovery Active', input: hi('Recovery Active', { recoveryState: true }) },
  { name: 'Preload Active', input: hi('Preload Active', { preloadState: true }) },
  { name: 'Playing Mid Track', input: hi('Playing Mid Track', { boundaryState: 'PLAYING_MID_TRACK' }) },
  { name: 'Not Observable', input: hi('Not Observable', { boundaryState: 'UNKNOWN_NOT_OBSERVABLE', playbackState: pb({ observable: false }) }) },
  { name: 'Current Track In Candidate', input: hi('Current Track In Candidate', { candidateQueueTrackIds: ['t9', 't2', 't5'] }) },
  { name: 'Current Track Missing', input: hi('Current Track Missing', { candidateQueueTrackIds: ['t7', 't8', 't9'] }) },
  { name: 'Empty Candidate', input: hi('Empty Candidate', { candidateQueueTrackIds: [] }) },
  { name: 'Identical Queue', input: hi('Identical Queue', { candidateQueueTrackIds: ['t1', 't2', 't3'] }) },
  { name: 'Idle Session Start', input: hi('Idle Session Start', { boundaryState: 'SESSION_START_NOT_PLAYING', currentTrackId: null, playbackState: pb({ playing: false, currentTrackId: null }) }) },
];

interface SuiteResult {
  results: RuntimeHookResult[];
  goNoGo: GoNoGoResult;
  cert: SingleStoreCertResult;
  crReadiness: ProductionCrReadinessResult;
}
type OpState = 'IDLE' | 'APPROVED' | 'ARMED' | 'ACTIVE' | 'PAUSED' | 'STOP_REQUESTED' | 'STOPPED' | 'ROLLBACK_REQUESTED' | 'ROLLED_BACK' | 'KILL_SWITCHED';

export default function AiRuntimeProofDashboard() {
  const cfg = getAiRuntimeHookConfig();
  const [tab, setTab] = useState<Tab>('readiness');
  const [suite, setSuite] = useState<SuiteResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedCert, setSavedCert] = useState<SingleStoreCertResult | null>(null);
  const [opState, setOpState] = useState<OpState>('IDLE');

  // This phase is NO-GO — the Go/No-Go is fixed by the re-audited facts, not by UI.
  const goNoGo = useMemo(() => evaluateGoNoGo({
    ci357Success: true, preview357Ready: true, certificationReadyForHook: true,
    internalTestStoreConfigured: cfg.isolatedStoreId != null, candidatePlaylistConfigured: false,
    previewMigrationApplied: false, boundaryStateObservableAtRuntime: false,
    currentTrackPreservationProvable: false, playbackStatePreservationProvable: false,
    controlStoreSeparable: true, previewVsProductionDistinguishable: true, rollbackTargetPresent: false,
  }), [cfg.isolatedStoreId]);

  const runSuite = useCallback(() => {
    const results = SCENARIOS.map((s) => evaluateRuntimeHook(s.input));
    // Certification: no real runtime evidence exists this phase → NOT_RUN (honest).
    const cert = computeSingleStoreCertification({
      runtimeEvidencePresent: false, previewEnvironmentConfirmed: true, deploymentMatch: true, storeAllowlistMatch: false,
      singleSession: true, candidateVersionMatch: true, snapshotHashMatch: true, safeBoundaryConfirmed: true,
      currentTrackPreserved: true, playbackStatePreserved: true, existingQueueFailOpen: true, killSwitchProven: true,
      manualRollbackProven: true, controlStoreUnchanged: true, noDoublePlayback: true, noUnexpectedPause: true,
      noQueueEmpty: true, noRuntimeError: true,
    });
    const crReadiness = computeProductionCrReadiness(cert);
    setSuite({ results, goNoGo, cert, crReadiness });
    setNotice(`${results.length} scenarios 실행 (순수 시뮬레이션 · 실제 Player 미변경). Runtime Hook 은 DEFERRED — Certification NOT_RUN.`);
  }, [goNoGo]);

  const reset = useCallback(() => { setSuite(null); setSavedCert(null); setOpState('IDLE'); setNotice('로컬 하니스 초기화됨.'); }, []);
  const recordCert = useCallback(() => { if (suite) { setSavedCert(suite.cert); setNotice(`Certification Snapshot 기록됨 (로컬 · ${suite.cert.status} · 실제 적용 아님).`); } }, [suite]);
  const op = useCallback((next: OpState, msg: string) => { setOpState(next); setNotice(`${msg} (로컬 시뮬레이션 · Runtime Hook DEFERRED · 실제 Store/Player 미변경)`); }, []);

  const overview = useMemo(() => {
    if (!suite) return null;
    const r = suite.results;
    return {
      scenarios: r.length,
      applied: r.filter((x) => x.decision === 'APPLIED_AT_BOUNDARY').length,
      waiting: r.filter((x) => x.decision === 'WAITING_BOUNDARY').length,
      unsafe: r.filter((x) => x.decision === 'UNSAFE_BOUNDARY').length,
      blockedGate: r.filter((x) => ['STORE_NOT_ALLOWED', 'DEPLOYMENT_MISMATCH', 'FLAG_DISABLED', 'KILL_SWITCHED', 'SESSION_LIMIT', 'VERSION_MISMATCH', 'SNAPSHOT_MISMATCH'].includes(x.decision)).length,
      failOpen: r.filter((x) => x.decision === 'FAIL_OPEN' || x.decision === 'NO_ACTION' || x.decision === 'CONTROL_PRESERVED').length,
      realPlayerUntouched: r.every((x) => x.realPlayerUntouched),
    };
  }, [suite]);

  if (!cfg.masterEnabled || !cfg.hookEnabled) {
    return (
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Radar size={18} /> AI Runtime Proof <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-9 (Preview)</span></h2>
        <AdminAlert tone="info" title="Isolated Preview Hook 비활성 (기본 OFF · Kill Switch ON · Runtime Hook DEFERRED)">
          Rule 기반 Isolated Preview Queue Hook 하니스는 기본 OFF이며 Kill Switch 가 기본 ON입니다. <code>VITE_AI_MUSIC_ENABLED</code>(마스터) + <code>VITE_AI_ISOLATED_PREVIEW_HOOK_ENABLED</code> 로 로드됩니다.
          이번 Phase 는 Go/No-Go = NO-GO 로 Runtime Hook 을 구현하지 않습니다(DEFERRED). 이 Lab 은 순수 시뮬레이션이며 실제 Player Store Queue / Audio / 재생을 변경하지 않습니다.
        </AdminAlert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Radar size={18} /> AI Runtime Proof <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-9</span></h2>
          <p className="text-xs text-text-tertiary">Pure Harness · 실제 Player/Queue/Audio 미변경 · Runtime Hook DEFERRED · Current Track/Playback 보존 · Fail-open · 최대 NOT_RUN(증거 없음)</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminButton size="sm" variant="solid" leftIcon={<Play size={14} />} onClick={runSuite}>Run Scenario Suite</AdminButton>
          <AdminButton size="sm" variant="outline" onClick={reset}>Reset Local Harness</AdminButton>
          <AdminButton size="sm" variant="subtle" leftIcon={<Save size={14} />} disabled={!suite} onClick={recordCert}>Record Certification</AdminButton>
        </div>
      </div>

      <AdminAlert tone={goNoGo.decision === 'GO' ? 'success' : 'warning'} title={`Go / No-Go: ${goNoGo.decision} · Feasibility: ${goNoGo.feasibility} · Runtime Hook ${goNoGo.runtimeHookImplemented ? '구현' : '미구현(DEFERRED)'}`}>
        <span className="text-[11px]">{goNoGo.deferredReason ?? '모든 Go 조건 충족'} — 미충족: {goNoGo.failed.join(', ') || '없음'}</span>
      </AdminAlert>
      {notice && <AdminAlert tone="info" title="기록">{notice}</AdminAlert>}

      {/* Operator controls — LOCAL simulation only (no real store/player). Forbidden actions are absent. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        <span className="text-[11px] text-text-tertiary">Operator (로컬 · state: <b>{opState}</b>):</span>
        <AdminButton size="sm" variant="subtle" disabled={opState !== 'IDLE'} onClick={() => op('APPROVED', 'Approve Hook')}>Approve Hook</AdminButton>
        <AdminButton size="sm" variant="subtle" disabled={opState !== 'APPROVED'} onClick={() => op('ARMED', 'Arm Single Store')}>Arm Single Store</AdminButton>
        <AdminButton size="sm" variant="subtle" disabled={opState !== 'ARMED'} onClick={() => op('ACTIVE', 'Activate Session')}>Activate Session</AdminButton>
        <AdminButton size="sm" variant="ghost" disabled={opState !== 'ACTIVE'} onClick={() => op('PAUSED', 'Pause')}>Pause</AdminButton>
        <AdminButton size="sm" variant="ghost" disabled={opState !== 'ACTIVE' && opState !== 'PAUSED'} onClick={() => op('STOP_REQUESTED', 'Request Stop')}>Request Stop</AdminButton>
        <AdminButton size="sm" variant="ghost" disabled={opState !== 'STOP_REQUESTED'} onClick={() => op('STOPPED', 'Confirm Stop')}>Confirm Stop</AdminButton>
        <AdminButton size="sm" variant="ghost" disabled={opState !== 'ACTIVE' && opState !== 'PAUSED'} onClick={() => op('ROLLBACK_REQUESTED', 'Request Rollback')}>Request Rollback</AdminButton>
        <AdminButton size="sm" variant="ghost" disabled={opState !== 'ROLLBACK_REQUESTED'} onClick={() => op('ROLLED_BACK', 'Confirm Rollback')}>Confirm Rollback</AdminButton>
        <AdminButton size="sm" variant="outline" onClick={() => op('KILL_SWITCHED', 'Enable Kill Switch')}>Enable Kill Switch</AdminButton>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${tab === t.key ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover'}`}>{t.icon}{t.label}</button>)}
      </div>

      {tab === 'readiness' && (
        <AdminCard title="Hook Readiness / Overview">
          {!overview ? <AdminEmpty title="Suite 미실행" description="Run Scenario Suite 로 순수 시뮬레이션을 실행하세요." /> : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                <AdminStatCard label="Scenarios" value={`${overview.scenarios}`} tone="info" />
                <AdminStatCard label="Applied@Boundary (모델)" value={`${overview.applied}`} tone="success" />
                <AdminStatCard label="Waiting Boundary" value={`${overview.waiting}`} tone="warning" />
                <AdminStatCard label="Unsafe Boundary" value={`${overview.unsafe}`} tone="danger" />
                <AdminStatCard label="Gate Blocked" value={`${overview.blockedGate}`} tone="info" />
                <AdminStatCard label="Fail-open/Control" value={`${overview.failOpen}`} tone="info" />
                <AdminStatCard label="Real Player Untouched" value={overview.realPlayerUntouched ? 'yes' : 'no'} tone={overview.realPlayerUntouched ? 'success' : 'danger'} />
                <AdminStatCard label="Certification" value={suite!.cert.status} tone={tone(suite!.cert.status)} />
                <AdminStatCard label="CR Readiness" value={suite!.crReadiness.status} tone={tone(suite!.crReadiness.status)} />
              </div>
              <p className="mt-3 text-[11px] text-text-tertiary">모든 결과는 순수 시뮬레이션입니다 — 실제 Player Store Queue / Audio / 재생을 변경하지 않습니다. Apply Queue / Production Canary / Full Rollout / Customer Store Apply 버튼은 제공하지 않습니다.</p>
            </>
          )}
        </AdminCard>
      )}

      {tab === 'single-store' && (
        <AdminCard title="Single Internal Test Store (허용 범위)">
          <pre className="overflow-x-auto rounded-lg border border-border bg-bg-base p-3 text-[11px] text-text-secondary">{`허용: 정확히 1개의 내부 Test Store (Wildcard/복수/자동추가/고객/Enterprise/Franchise/Production 금지)
필수: preview_deployment_id 고정 · approved candidate playlist/version/snapshot 고정 · expires_at 필수
       max_sessions=1 · max_queue_applications 최소 · kill_switch_required=true · approved_by/at 필수
현재 config: isolatedStoreId=${cfg.isolatedStoreId ?? '(미설정)'} · isolatedDeploymentId=${cfg.isolatedDeploymentId ?? '(미설정)'} · maxSessions=${cfg.maxSessions} · maxQueueApplications=${cfg.maxQueueApplications}`}</pre>
          <p className="mt-2 text-[11px] text-text-tertiary">이번 Phase 는 Store 미구성(No-Go). 실제 Runtime Hook 은 다음 Phase Change Request 대상입니다.</p>
        </AdminCard>
      )}

      {(tab === 'boundaries' || tab === 'currenttrack' || tab === 'playback' || tab === 'guardrails') && (
        <AdminCard title={TABS.find((t) => t.key === tab)?.label}>
          {!suite ? <AdminEmpty title="Suite 미실행" /> : (
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">Scenario</th><th>Decision</th><th>Boundary</th><th>Result Queue</th></tr></thead>
                <tbody>
                  {suite.results.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1 text-text-primary">{r.scenarioName}</td>
                      <td><AdminBadge tone={tone(r.decision)}>{r.decision}</AdminBadge></td>
                      <td className="text-text-secondary">{r.boundaryUsed ?? '—'}</td>
                      <td className="text-[10px] text-text-tertiary">{r.decision === 'APPLIED_AT_BOUNDARY' ? r.resultQueueTrackIds.join(',') : '기존 유지'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {tab === 'reservations' && (
        <AdminCard title="Boundary Reservation (Preview 세션 메모리 전용)">
          <p className="text-[11px] text-text-tertiary">RESERVED → VALIDATED → WAITING_BOUNDARY → APPLYING → APPLIED (또는 SUPERSEDED/EXPIRED/REJECTED/CANCELLED). Production DB 저장 없음(persistedToProductionDb=false). 즉시 적용 없이 안전 경계까지 예약만 합니다.</p>
          <AdminAlert tone="info" title="상태"><span className="text-[11px]">현재 Operator state: <b>{opState}</b> — 로컬 시뮬레이션. 실제 예약/적용은 Runtime Hook(DEFERRED)이 없으므로 발생하지 않습니다.</span></AdminAlert>
        </AdminCard>
      )}

      {tab === 'evidence' && (
        <AdminCard title="Runtime Evidence (hash-only · redacted)">
          <p className="text-[11px] text-text-tertiary">저빈도 · store/session/deployment/playlist/queue/current-track HASH + boundary + result + reason + duration bucket 만 기록. Audio URL / 제목 / Artist / Raw Queue / Raw Error / Token / 개인정보 절대 저장 안 함.</p>
          <AdminAlert tone="info" title="이번 Phase"><span className="text-[11px]">Runtime Hook DEFERRED — 실제 Runtime Evidence 없음(NOT_RUN). Evidence Redaction 계약만 모델링/검증했습니다.</span></AdminAlert>
        </AdminCard>
      )}

      {tab === 'killswitch' && (
        <AdminCard title="Immediate Kill Switch">
          <p className="text-[11px] text-text-tertiary">Kill Switch ON: 신규 Reservation 금지 · Waiting Reservation 취소 · 적용 전 Candidate 취소 · 적용된 Candidate 는 다음 안전 경계에서 Existing Resolver 결과로 복귀 예약. 현재 Track 강제 중단 없음 · Audio API 호출 없음 · 재실행은 새 Approval 필요.</p>
          <div className="mt-2 flex items-center gap-2"><span className="text-xs text-text-secondary">Config Kill Switch:</span><AdminBadge tone={cfg.killSwitch ? 'success' : 'danger'}>{cfg.killSwitch ? 'ON (기본)' : 'OFF'}</AdminBadge>{opState === 'KILL_SWITCHED' && <AdminBadge tone="danger">Operator KILL_SWITCHED (로컬)</AdminBadge>}</div>
        </AdminCard>
      )}

      {tab === 'rollback' && (
        <AdminCard title="Manual Rollback at Boundary">
          {(() => { const r = evaluateRollback({ existingPlaylistId: 'pl-exist', canRebuildExistingQueue: true, sameSession: true, sameDeployment: true, currentTrackSnapshotPresent: true, currentTrackPreservable: true, safeBoundary: opState === 'ACTIVE' || opState === 'PAUSED' || opState === 'ROLLBACK_REQUESTED', killSwitch: false, reason: 'operator' }); return (
            <div className="space-y-2">
              <div className="flex items-center gap-2"><span className="text-xs text-text-secondary">모델 결과:</span><AdminBadge tone={tone(r.result)}>{r.result}</AdminBadge><span className="text-[11px] text-text-tertiary">automatic: {String(r.automatic)}</span></div>
              <ul className="list-disc pl-4 text-[11px] text-text-tertiary">{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
              <AdminAlert tone="warning" title="원칙"><span className="text-[11px]">자동 Rollback 금지 — 운영자 요청 → 검증 → 안전 경계에서만 수동 복귀. 현재 Track 강제 중단 없음.</span></AdminAlert>
            </div>
          ); })()}
        </AdminCard>
      )}

      {tab === 'guardrails' && suite && (
        <AdminCard title="Runtime Guardrails (STOP_RECOMMENDED only)">
          {(() => { const g = evaluateGuardrails({ signals: [] }); return (
            <div className="flex items-center gap-2"><AdminBadge tone={tone(g.verdict)}>{g.verdict}</AdminBadge><span className="text-[11px] text-text-tertiary">automaticStop: {String(g.automaticStop)} — 위험 신호(현재 Track 변경/시간 리셋/Double Playback/Queue Empty/Crossfade·Recovery·Preload 변경 등) 발생 시 자동 중단 없이 STOP_RECOMMENDED 만 생성</span></div>
          ); })()}
        </AdminCard>
      )}

      {tab === 'certification' && (
        <AdminCard title="Single-store Runtime Certification">
          {!suite ? <AdminEmpty title="Suite 미실행" /> : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <AdminStatCard label="Status" value={suite.cert.status} tone={tone(suite.cert.status)} />
                <AdminStatCard label="Recorded" value={savedCert ? 'yes' : 'no'} tone={savedCert ? 'success' : 'info'} />
                <AdminStatCard label="Runtime Evidence" value="none (DEFERRED)" tone="info" />
              </div>
              {suite.cert.blockers.length > 0 && <AdminAlert tone="danger" title="Blockers"><ul className="list-disc pl-4 text-[11px]">{suite.cert.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></AdminAlert>}
              <ul className="list-disc pl-4 text-[11px] text-text-tertiary">{suite.cert.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
              <p className="text-[11px] text-text-tertiary"><AlertTriangle size={11} className="inline" /> 실제 단일 Store Runtime 증거가 없으므로 Certification 은 NOT_RUN 입니다. "Production Ready" 표현은 사용하지 않습니다.</p>
            </div>
          )}
        </AdminCard>
      )}

      {tab === 'cr-readiness' && (
        <AdminCard title="Production Canary Change-Request Readiness">
          {!suite ? <AdminEmpty title="Suite 미실행" /> : (
            <div className="space-y-2">
              <div className="flex items-center gap-2"><span className="text-xs text-text-secondary">상태:</span><AdminBadge tone={tone(suite.crReadiness.status)}>{suite.crReadiness.status}</AdminBadge><span className="text-[11px] text-text-tertiary">actualProductionCanaryRun: {String(suite.crReadiness.actualProductionCanaryRun)}</span></div>
              {suite.crReadiness.evidenceRequired.length > 0 && <div><p className="text-[11px] font-medium text-text-tertiary">Evidence Required</p><ul className="list-disc pl-4 text-[11px] text-text-secondary">{suite.crReadiness.evidenceRequired.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
              <AdminAlert tone="info" title="이 Phase 범위"><span className="text-[11px]"><CheckCircle2 size={11} className="inline" /> 이번 Phase 에서 Production Canary 는 실행하지 않습니다. 격리 Preview Hook + 단일 Store Runtime 증거는 다음 Phase Change Request 대상입니다.</span></AdminAlert>
            </div>
          )}
        </AdminCard>
      )}
    </div>
  );
}
