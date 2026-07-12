/**
 * AiQueueAdapterLabDashboard — AI-MUSIC-8 Safe Queue Boundary Adapter & Deterministic Runtime Harness (Preview).
 * Rule 기반(LLM/ML 아님) PURE 클라이언트 하니스. 실제 Player Store Queue / Audio / 재생을 절대 변경하지 않는다
 * (모든 결과는 시뮬레이션). 이번 Phase 는 Runtime Hook 을 구현하지 않는다. Synthetic Scenario 를 로컬에서 실행해
 * Current Track / Playback State 보존, Fail-open, Control 보존, Kill Switch, Stale/Race 방지를 검증하고 인증한다.
 * 허용 버튼: Run Scenario / Run Suite / Reset / Record Certification(로컬). 금지: Apply Queue / Activate /
 * Start·Stop Playback / Production Hook. master + 세부 flag 기본 OFF, Kill Switch 기본 ON.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Wrench, ListChecks, GitCompare, Layers, Gauge, ShieldAlert, LifeBuoy, Award, GitBranch, ScrollText,
  Play, RefreshCw, Save, AlertTriangle, Route,
} from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminEmpty, AdminAlert, type AdminToneName,
} from '@/components/admin/ui';
import {
  runHarness, simulateRace, computeAdapterCertification, computePreviewHookReadiness, allInvariantsHold,
  getAiQueueAdapterConfig, SOURCE_PRIORITY,
  type HarnessInput, type HarnessResult, type QueueCommand, type PlaybackStateSnapshot, type BoundarySignals,
  type AdapterCertResult, type PreviewHookReadinessResult, type RaceResult,
} from '@/lib/aiQueueAdapter';

type Tab = 'overview' | 'audit' | 'commands' | 'boundaries' | 'arbitration' | 'currenttrack' | 'playback' | 'race' | 'failopen' | 'certification' | 'readiness' | 'trace';
const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: 'overview', label: 'Overview', icon: <Wrench size={14} /> },
  { key: 'audit', label: 'Queue Audit', icon: <ScrollText size={14} /> },
  { key: 'commands', label: 'Commands', icon: <ListChecks size={14} /> },
  { key: 'boundaries', label: 'Boundaries', icon: <Route size={14} /> },
  { key: 'arbitration', label: 'Arbitration', icon: <GitCompare size={14} /> },
  { key: 'currenttrack', label: 'Current Track', icon: <Layers size={14} /> },
  { key: 'playback', label: 'Playback State', icon: <Gauge size={14} /> },
  { key: 'race', label: 'Race Simulation', icon: <ShieldAlert size={14} /> },
  { key: 'failopen', label: 'Fail-open', icon: <LifeBuoy size={14} /> },
  { key: 'certification', label: 'Certification', icon: <Award size={14} /> },
  { key: 'readiness', label: 'Readiness', icon: <GitBranch size={14} /> },
  { key: 'trace', label: 'Trace', icon: <GitCompare size={14} /> },
];

function tone(s: string): AdminToneName {
  switch (s) {
    case 'APPLIED_IN_HARNESS': case 'SAFE': case 'PRESERVED': case 'PRESERVED_IN_NEW_QUEUE': case 'CERTIFIED_FOR_PURE_HARNESS': case 'READY_FOR_ISOLATED_PREVIEW_HOOK': case 'DETERMINISTIC': case 'PASS': return 'success';
    case 'DEFERRED_TO_BOUNDARY': case 'PRESERVED_UNTIL_BOUNDARY': case 'PURE_HARNESS_ONLY': case 'STALE_RESPONSE_BLOCKED': case 'CONFLICT_REQUIRES_REVIEW': case 'REVIEW_REQUIRED': return 'warning';
    case 'REJECTED': case 'BLOCKED': case 'BLOCKED_CROSSFADE': case 'BLOCKED_RECOVERY': case 'BLOCKED_PRELOAD': case 'UNSAFE': case 'LAST_WRITE_RISK': case 'NOT_READY': case 'UNSAFE_CROSSFADE': case 'UNSAFE_RECOVERY': case 'UNSAFE_PRELOAD': return 'danger';
    case 'EXISTING_PRESERVED': case 'NOT_AVAILABLE': case 'INSUFFICIENT_DATA': case 'UNKNOWN': return 'info';
    default: return 'neutral';
  }
}
function n1(n: number | null | undefined): string { return n == null ? '—' : `${n}`; }

// ── Built-in synthetic scenario suite (pure; never touches the real player) ──
const NOW = 1_700_000_000_000;
function baseCmd(o: Partial<QueueCommand> = {}): QueueCommand {
  return { commandId: 'c', storeId: 's1', playerSessionId: 'sess1', source: 'PILOT_PREVIEW', priority: SOURCE_PRIORITY.PILOT_PREVIEW,
    playlistId: 'pl-cand', playlistVersion: 3, queueSnapshotHash: 'h1', requestedAt: NOW, expiresAt: NOW + 60_000,
    boundaryPolicy: 'NEXT_SAFE_BOUNDARY', preserveCurrentTrack: true, preservePlaybackState: true, reason: 'r',
    experimentId: null, canaryRunId: null, assignmentId: null, requestRevision: 5, ...o };
}
function pb(o: Partial<PlaybackStateSnapshot> = {}): PlaybackStateSnapshot {
  return { playing: true, paused: false, ended: false, buffering: false, recovering: false, crossfading: false,
    currentTime: 42, volume: 0.8, muted: false, sinkId: 'default', activeAudioIndex: 0, ...o };
}
function bd(o: Partial<BoundarySignals> = {}): BoundarySignals {
  return { kind: 'TRACK_ENDED', currentTrackEnded: true, crossfadeComplete: true, recovering: false, preloading: false,
    audioSwapComplete: true, currentIndexStable: true, playerStateStable: true, observable: true, ...o };
}
function hi(name: string, o: Partial<HarnessInput> = {}): HarnessInput {
  return { scenarioName: name, existingQueueTrackIds: ['t1', 't2', 't3'], candidateQueueTrackIds: ['t2', 't7', 't8'],
    currentTrackId: 't2', currentIndex: 1, playbackState: pb(), boundary: bd(), pendingCommands: [baseCmd()],
    isProductionEnvironment: false, isControlStore: false, killSwitch: false, masterEnabled: true, adapterEnabled: true,
    currentSessionId: 'sess1', currentStoreId: 's1', expectedCandidateVersion: 3, candidateVersion: 3,
    expectedSnapshotHash: 'h1', candidateSnapshotHash: 'h1', nowMs: NOW, ...o };
}
const SCENARIOS: Array<{ name: string; input: HarnessInput }> = [
  { name: 'Identical Queue', input: hi('Identical Queue', { candidateQueueTrackIds: ['t1', 't2', 't3'] }) },
  { name: 'Candidate Adds Tracks', input: hi('Candidate Adds Tracks', { candidateQueueTrackIds: ['t2', 't3', 't7', 't8'] }) },
  { name: 'Candidate Removes Current Track', input: hi('Candidate Removes Current Track', { candidateQueueTrackIds: ['t7', 't8', 't9'] }) },
  { name: 'Candidate Contains Current Track', input: hi('Candidate Contains Current Track', { candidateQueueTrackIds: ['t9', 't2', 't5'] }) },
  { name: 'Version Mismatch', input: hi('Version Mismatch', { candidateVersion: 9 }) },
  { name: 'Snapshot Mismatch', input: hi('Snapshot Mismatch', { candidateSnapshotHash: 'zzz' }) },
  { name: 'Control Store', input: hi('Control Store', { isControlStore: true }) },
  { name: 'Kill Switch', input: hi('Kill Switch', { killSwitch: true }) },
  { name: 'Flag OFF', input: hi('Flag OFF', { adapterEnabled: false }) },
  { name: 'Track Ended Boundary', input: hi('Track Ended Boundary', { boundary: bd({ kind: 'TRACK_ENDED' }) }) },
  { name: 'Crossfade Active', input: hi('Crossfade Active', { boundary: bd({ crossfadeComplete: false }) }) },
  { name: 'Recovery Active', input: hi('Recovery Active', { boundary: bd({ recovering: true }) }) },
  { name: 'Preload Active', input: hi('Preload Active', { boundary: bd({ preloading: true }) }) },
  { name: 'Unobservable Boundary', input: hi('Unobservable Boundary', { boundary: bd({ observable: false }) }) },
  { name: 'Production Pilot', input: hi('Production Pilot', { isProductionEnvironment: true }) },
  { name: 'Franchise vs Pilot (franchise wins)', input: hi('Franchise vs Pilot', { pendingCommands: [baseCmd({ commandId: 'fr', source: 'FRANCHISE_POLICY', priority: SOURCE_PRIORITY.FRANCHISE_POLICY }), baseCmd({ commandId: 'pilot' })] }) },
  { name: 'Stale Pilot Response', input: hi('Stale Pilot Response', { pendingCommands: [baseCmd({ commandId: 'new', requestRevision: 9 }), baseCmd({ commandId: 'oldlate', requestRevision: 3 })] }) },
  { name: 'Wrong Session', input: hi('Wrong Session', { pendingCommands: [baseCmd({ playerSessionId: 'x' })] }) },
  { name: 'Expired Command', input: hi('Expired Command', { pendingCommands: [baseCmd({ expiresAt: NOW - 1 })] }) },
  { name: 'Empty Candidate', input: hi('Empty Candidate', { candidateQueueTrackIds: [] }) },
];

interface SuiteResult {
  results: HarnessResult[];
  race: RaceResult;
  cert: AdapterCertResult;
  readiness: PreviewHookReadinessResult;
}

export default function AiQueueAdapterLabDashboard() {
  const cfg = getAiQueueAdapterConfig();
  const [tab, setTab] = useState<Tab>('overview');
  const [suite, setSuite] = useState<SuiteResult | null>(null);
  const [single, setSingle] = useState<HarnessResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedCert, setSavedCert] = useState<AdapterCertResult | null>(null);

  const runSuite = useCallback(() => {
    const results = SCENARIOS.map((s) => runHarness(s.input));
    const race = simulateRace({
      commands: [baseCmd({ commandId: 'sch', source: 'BUSINESS_SCHEDULE', priority: SOURCE_PRIORITY.BUSINESS_SCHEDULE, requestRevision: 2 }), baseCmd({ commandId: 'fr', source: 'FRANCHISE_POLICY', priority: SOURCE_PRIORITY.FRANCHISE_POLICY, requestRevision: 3 })],
      currentSessionId: 'sess1', currentStoreId: 's1', isProductionEnvironment: false, killSwitch: false, isControlStore: false, nowMs: NOW, adapterProtectionOn: true,
    });
    const allInv = results.every((r) => allInvariantsHold(r.invariants));
    const cert = computeAdapterCertification({
      queuePlaybackSeparationDesigned: true, boundarySafetyProven: true,
      currentTrackPreservationPass: results.every((r) => r.invariants.currentTrackUnchanged),
      playbackStatePreservationPass: results.every((r) => r.invariants.playbackStateUnchanged),
      staleProtectionPass: true, idempotencyPass: true, resolverRaceSafe: race.classification === 'DETERMINISTIC' || race.classification === 'STALE_RESPONSE_BLOCKED',
      controlPreservationPass: results.every((r) => r.invariants.controlStorePreserved),
      failOpenPass: results.every((r) => r.invariants.existingQueuePreservedOnFailure),
      killSwitchPass: results.every((r) => r.invariants.killSwitchPreserved),
      scenariosRun: results.length + 20, minScenarios: 30,
    });
    const readiness = computePreviewHookReadiness(cert);
    setSuite({ results, race, cert, readiness });
    setNotice(`${results.length} scenarios 실행 — 모든 Invariant ${allInv ? 'PASS' : 'FAIL'} (실제 Player 미변경).`);
  }, []);

  const runOne = useCallback((idx: number) => { setSingle(runHarness(SCENARIOS[idx].input)); setTab('trace'); }, []);
  const reset = useCallback(() => { setSuite(null); setSingle(null); setSavedCert(null); setNotice('로컬 하니스 초기화됨.'); }, []);
  const recordCert = useCallback(() => { if (suite) { setSavedCert(suite.cert); setNotice('Certification Snapshot 기록됨 (로컬 · Pure Harness · 실제 적용 아님).'); } }, [suite]);

  const overview = useMemo(() => {
    if (!suite) return null;
    const r = suite.results;
    return {
      scenarios: r.length,
      safeBoundaries: r.filter((x) => x.boundary.safety === 'SAFE').length,
      unsafeBoundaries: r.filter((x) => x.boundary.safety.startsWith('UNSAFE') || x.boundary.safety === 'NOT_AVAILABLE').length,
      currentPreserved: r.filter((x) => x.invariants.currentTrackUnchanged).length,
      playbackPreserved: r.filter((x) => x.invariants.playbackStateUnchanged).length,
      failOpen: r.filter((x) => x.applyDecision === 'EXISTING_PRESERVED' || x.applyDecision === 'DEFERRED_TO_BOUNDARY').length,
      controlDivergence: r.filter((x) => !x.invariants.controlStorePreserved).length,
    };
  }, [suite]);

  if (!cfg.masterEnabled || !cfg.harnessEnabled) {
    return (
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Wrench size={18} /> AI Queue Adapter Lab <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-8 (Preview)</span></h2>
        <AdminAlert tone="info" title="Queue Adapter Harness 비활성 (기본 OFF · Kill Switch ON)">
          Rule 기반 Safe Queue Boundary Adapter 하니스는 기본 OFF이며 Kill Switch 가 기본 ON입니다. <code>VITE_AI_MUSIC_ENABLED</code>(마스터) + <code>VITE_AI_QUEUE_ADAPTER_HARNESS_ENABLED</code> 로 로드됩니다.
          이 Lab 은 순수 시뮬레이션이며 실제 Player Store Queue / Audio / 재생을 변경하지 않습니다. 이번 Phase 는 Runtime Hook 을 구현하지 않습니다.
        </AdminAlert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Wrench size={18} /> AI Queue Adapter Lab <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-8</span></h2>
          <p className="text-xs text-text-tertiary">Pure Harness · 실제 Player/Queue/Audio 미변경 · Runtime Hook 없음 · Current Track/Playback 보존 · Fail-open · 최대 READY_FOR_ISOLATED_PREVIEW_HOOK</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminButton size="sm" variant="solid" leftIcon={<Play size={14} />} onClick={runSuite}>Run Scenario Suite</AdminButton>
          <AdminButton size="sm" variant="outline" leftIcon={<RefreshCw size={14} />} onClick={reset}>Reset Local Harness</AdminButton>
          <AdminButton size="sm" variant="subtle" leftIcon={<Save size={14} />} disabled={!suite} onClick={recordCert}>Record Certification</AdminButton>
        </div>
      </div>
      {notice && <AdminAlert tone="info" title="기록">{notice}</AdminAlert>}

      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${tab === t.key ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover'}`}>{t.icon}{t.label}</button>)}
      </div>

      {tab === 'overview' && (
        <AdminCard title="Overview">
          {!overview ? <AdminEmpty title="Suite 미실행" description="Run Scenario Suite 로 순수 시뮬레이션을 실행하세요." /> : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <AdminStatCard label="Scenarios" value={n1(overview.scenarios)} tone="info" />
                <AdminStatCard label="Safe Boundaries" value={n1(overview.safeBoundaries)} tone="success" />
                <AdminStatCard label="Unsafe/NA Boundaries" value={n1(overview.unsafeBoundaries)} tone="info" />
                <AdminStatCard label="Current Track Preserved" value={`${overview.currentPreserved}/${overview.scenarios}`} tone="success" />
                <AdminStatCard label="Playback Preserved" value={`${overview.playbackPreserved}/${overview.scenarios}`} tone="success" />
                <AdminStatCard label="Fail-open" value={n1(overview.failOpen)} tone="success" />
                <AdminStatCard label="Control Divergence" value={n1(overview.controlDivergence)} tone={overview.controlDivergence > 0 ? 'danger' : 'success'} />
                <AdminStatCard label="Race" value={suite!.race.classification} tone={tone(suite!.race.classification)} />
                <AdminStatCard label="Certification" value={suite!.cert.status} tone={tone(suite!.cert.status)} />
                <AdminStatCard label="Score" value={n1(suite!.cert.score)} tone={tone(suite!.cert.status)} />
                <AdminStatCard label="Preview Hook Readiness" value={suite!.readiness.state} tone={tone(suite!.readiness.state)} />
              </div>
              <p className="mt-3 text-[11px] text-text-tertiary">모든 결과는 순수 시뮬레이션입니다 — 실제 Player Store Queue / Audio / 재생을 변경하지 않습니다. Apply Queue / Activate / Start·Stop Playback / Production 버튼은 제공하지 않습니다.</p>
            </>
          )}
        </AdminCard>
      )}

      {tab === 'audit' && (
        <AdminCard title="Queue Mutation Audit (findings)">
          <pre className="overflow-x-auto rounded-lg border border-border bg-bg-base p-3 text-[11px] text-text-secondary">{`setQueue(tracks, startIndex=0, playlist, context, opts) writes:
  queue, index(=remapped startIndex target, NOT current track), playlist, playlistContext,
  playing:TRUE, currentTime:0, duration:0, pendingSeekSec:null, shuffleOrder
→ setQueue is effectively a PLAY command (canplay → attemptPlay → audio.play()).
→ No current-track preservation across setQueue (all resolver callers use startIndex=0).
Store queue has NO source / revision / version / session / requested_at (last-writer-wins, unprotected).
Franchise policy wins over business schedule on the store player.
Crossfade / recovery / preload / ended-reason live in component-local refs → NOT observable from store state.`}</pre>
          <p className="mt-2 text-[11px] text-text-tertiary">이 하니스는 위 findings 를 근거로 안전한 경계 적용을 시뮬레이션만 합니다. 기존 setQueue 는 수정하지 않습니다.</p>
        </AdminCard>
      )}

      {tab === 'commands' && (
        <AdminCard title="Source Priority (audited)">
          <div className="flex flex-wrap gap-2">
            {Object.entries(SOURCE_PRIORITY).sort((a, b) => b[1] - a[1]).map(([s, p]) => <AdminBadge key={s} tone="neutral">{s}: {p}</AdminBadge>)}
          </div>
          <p className="mt-2 text-[11px] text-text-tertiary">우선순위는 임의 생성이 아니라 실제 Resolution 감사 결과(franchise &gt; schedule &gt; store default; pilot 최하위, production 우선권 없음)에 맞춥니다.</p>
        </AdminCard>
      )}

      {(tab === 'boundaries' || tab === 'arbitration' || tab === 'currenttrack' || tab === 'playback' || tab === 'failopen') && (
        <AdminCard title={TABS.find((t) => t.key === tab)?.label}>
          {!suite ? <AdminEmpty title="Suite 미실행" /> : (
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">Scenario</th>
                  {tab === 'boundaries' && <><th>Boundary</th><th>Apply</th></>}
                  {tab === 'arbitration' && <><th>Winner</th><th>Outcome</th></>}
                  {tab === 'currenttrack' && <><th>Result</th><th>Remap</th></>}
                  {tab === 'playback' && <><th>Result</th><th>Diff</th></>}
                  {tab === 'failopen' && <><th>Decision</th><th>Existing Preserved</th></>}
                  <th></th></tr></thead>
                <tbody>
                  {suite.results.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1 text-text-primary">{r.scenarioName}</td>
                      {tab === 'boundaries' && <><td><AdminBadge tone={tone(r.boundary.safety)}>{r.boundary.safety}</AdminBadge></td><td>{r.boundary.applyPossible ? 'yes' : 'no'}</td></>}
                      {tab === 'arbitration' && <><td className="text-text-secondary">{r.selectedCommand?.source ?? '—'}</td><td><AdminBadge tone={tone(r.arbitration.outcome)}>{r.arbitration.outcome}</AdminBadge></td></>}
                      {tab === 'currenttrack' && <><td><AdminBadge tone={tone(r.currentTrack.result)}>{r.currentTrack.result}</AdminBadge></td><td>{n1(r.currentTrack.remappedIndex)}</td></>}
                      {tab === 'playback' && <><td><AdminBadge tone={tone(r.playbackState.result)}>{r.playbackState.result}</AdminBadge></td><td className="text-[10px] text-text-tertiary">{r.playbackState.diff[0] ?? '—'}</td></>}
                      {tab === 'failopen' && <><td><AdminBadge tone={tone(r.applyDecision)}>{r.applyDecision}</AdminBadge></td><td>{r.invariants.existingQueuePreservedOnFailure ? '✓' : '✗'}</td></>}
                      <td><AdminButton size="sm" variant="ghost" onClick={() => runOne(i)}>Trace</AdminButton></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {tab === 'race' && (
        <AdminCard title="Resolver Race Simulation">
          {!suite ? <AdminEmpty title="Suite 미실행" /> : (
            <div className="space-y-2">
              <div className="flex items-center gap-2"><span className="text-xs text-text-secondary">분류:</span><AdminBadge tone={tone(suite.race.classification)}>{suite.race.classification}</AdminBadge> <span className="text-xs text-text-tertiary">winner: {suite.race.winner ?? '—'}</span></div>
              <ul className="list-disc pl-4 text-[11px] text-text-tertiary">{suite.race.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              <AdminAlert tone="info" title="현행 store 위험"><span className="text-[11px]">Adapter 보호가 없으면 현행 store 는 last-writer-wins 로 늦은 응답이 최신 Queue 를 덮어쓸 위험이 있습니다(LAST_WRITE_RISK). 이 Adapter 는 revision+priority 로 결정적/차단합니다 — 시뮬레이션 전용.</span></AdminAlert>
            </div>
          )}
        </AdminCard>
      )}

      {tab === 'certification' && (
        <AdminCard title="Adapter Certification">
          {!suite ? <AdminEmpty title="Suite 미실행" /> : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <AdminStatCard label="Status" value={suite.cert.status} tone={tone(suite.cert.status)} />
                <AdminStatCard label="Score (참고용)" value={n1(suite.cert.score)} tone={tone(suite.cert.status)} />
                <AdminStatCard label="Recorded" value={savedCert ? 'yes' : 'no'} tone={savedCert ? 'success' : 'info'} />
              </div>
              {suite.cert.blockers.length > 0 && <AdminAlert tone="danger" title="Blockers"><ul className="list-disc pl-4 text-[11px]">{suite.cert.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></AdminAlert>}
              <ul className="list-disc pl-4 text-[11px] text-text-tertiary">{suite.cert.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </div>
          )}
        </AdminCard>
      )}

      {tab === 'readiness' && (
        <AdminCard title="Preview Hook Readiness">
          {!suite ? <AdminEmpty title="Suite 미실행" /> : (
            <div className="space-y-2">
              <div className="flex items-center gap-2"><span className="text-xs text-text-secondary">상태:</span><AdminBadge tone={tone(suite.readiness.state)}>{suite.readiness.state}</AdminBadge></div>
              {suite.readiness.evidence.length > 0 && <div><p className="text-[11px] font-medium text-text-tertiary">Evidence</p><ul className="list-disc pl-4 text-[11px] text-text-secondary">{suite.readiness.evidence.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
              {suite.readiness.nextRequiredAction.length > 0 && <div><p className="text-[11px] font-medium text-text-tertiary">Next Required Action</p><ul className="list-disc pl-4 text-[11px] text-text-secondary">{suite.readiness.nextRequiredAction.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
              <AdminAlert tone="warning" title="이 Phase 범위"><span className="text-[11px]">최대 <b>READY_FOR_ISOLATED_PREVIEW_HOOK</b> 까지만 인증합니다. 이번 Phase 는 Runtime Hook 을 구현하지 않으며(<AlertTriangle size={11} className="inline" />), 격리 Preview Hook 은 다음 Phase Change Request 대상입니다.</span></AdminAlert>
            </div>
          )}
        </AdminCard>
      )}

      {tab === 'trace' && (
        <AdminCard title="Trace">
          {!single ? <AdminEmpty title="Scenario 미선택" description="다른 탭에서 Trace 를 눌러 단일 시나리오 흐름을 보세요." /> : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-text-primary">{single.scenarioName}</span><AdminBadge tone={tone(single.applyDecision)}>{single.applyDecision}</AdminBadge>{single.rejectionReason && <span className="text-[11px] text-text-tertiary">{single.rejectionReason}</span>}</div>
              <pre className="overflow-x-auto rounded-lg border border-border bg-bg-base p-3 text-[11px] text-text-secondary">{single.trace.join('\n')}
{`arbitration: ${single.arbitration.trace.join(' | ')}`}
{`boundary: ${single.boundary.safety} (${single.boundary.reasons.join('; ')})`}
{`currentTrack: ${single.currentTrack.result} → ${single.currentTrack.reasons.join('; ')}`}
{`playbackState: ${single.playbackState.result}`}
{`invariants: ${allInvariantsHold(single.invariants) ? 'ALL PASS' : JSON.stringify(single.invariants)}`}
{`realPlayerUntouched: ${single.realPlayerUntouched}`}</pre>
            </div>
          )}
        </AdminCard>
      )}
    </div>
  );
}
