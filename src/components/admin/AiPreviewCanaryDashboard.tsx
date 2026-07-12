/**
 * AiPreviewCanaryDashboard — AI-MUSIC-7 Preview Runtime Canary & Internal Test Store Certification (Preview).
 * Rule 기반(LLM/ML 아님). Shadow 결과를 *Preview 환경의 명시적으로 허용된 내부 테스트 Store* 에만 제한적으로
 * 연결하여 실제 Runtime 경로를 검증한다. Production Pilot 이 아니다 — 일반/프랜차이즈 Store, Production Player
 * 에는 절대 적용하지 않는다. 실제 Candidate Queue 적용(setQueue)은 DEFERRED. 모든 행위는 확인 다이얼로그
 * (이유 + Preview 환경 + Deployment ID + 대상 Store + Candidate Version + Existing Playlist + Expiry +
 * "Production 에 적용되지 않음")를 거친다. 실제 Production Canary/Full Rollout 버튼 없음. master + 세부 flag 기본
 * OFF, Kill Switch 기본 ON.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Rocket, ShieldCheck, ListChecks, ClipboardCheck, Activity, Layers, Gauge, ShieldAlert,
  Undo2, Award, ScrollText, GitBranch, AlertTriangle, Plus, Trash2,
} from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminEmpty, AdminSkeleton, AdminAlert, type AdminToneName,
} from '@/components/admin/ui';
import {
  currentEnvGate, getCanaryOverview, getCanaryRun, getCanaryAllowlist, addAllowlistStore, setAllowlistEnabled,
  armCanary, activateCanary, pauseCanary, requestCanaryStop, stopCanary, requestCanaryRollback, rollbackCanary, completeCanary,
  type CanaryOverview, type CanaryRunSummary, type CanaryRunDetail, type CanaryAllowlistRow,
} from '@/lib/api/aiPreviewCanaryApi';
import { getAiPreviewCanaryConfig } from '@/lib/aiPreviewCanary';

type Tab = 'overview' | 'environment' | 'allowlist' | 'approvals' | 'runs' | 'sessions' | 'queue' | 'evidence' | 'guardrails' | 'rollback' | 'certification' | 'audit' | 'readiness';
const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: 'overview', label: 'Overview', icon: <Rocket size={14} /> },
  { key: 'environment', label: 'Environment', icon: <ShieldCheck size={14} /> },
  { key: 'allowlist', label: 'Allowlist', icon: <ListChecks size={14} /> },
  { key: 'approvals', label: 'Approvals', icon: <ClipboardCheck size={14} /> },
  { key: 'runs', label: 'Canary Runs', icon: <Activity size={14} /> },
  { key: 'sessions', label: 'Sessions', icon: <Layers size={14} /> },
  { key: 'queue', label: 'Queue Validation', icon: <ListChecks size={14} /> },
  { key: 'evidence', label: 'Runtime Evidence', icon: <Gauge size={14} /> },
  { key: 'guardrails', label: 'Playback Guardrails', icon: <ShieldAlert size={14} /> },
  { key: 'rollback', label: 'Disable / Rollback', icon: <Undo2 size={14} /> },
  { key: 'certification', label: 'Certification', icon: <Award size={14} /> },
  { key: 'audit', label: 'Audit', icon: <ScrollText size={14} /> },
  { key: 'readiness', label: 'Readiness', icon: <GitBranch size={14} /> },
];

function tone(s: string): AdminToneName {
  switch (s) {
    case 'ACTIVE': case 'ENFORCED': case 'COMPLETED': case 'PASS': case 'CERTIFIED_FOR_INTERNAL_PREVIEW': case 'USE_EXISTING': case 'CONTROL_PRESERVED': return 'success';
    case 'APPROVED': case 'ARMED': case 'PAUSED': case 'PARTIAL': case 'WARNING': case 'READY_WITH_WARNINGS': case 'READY_FOR_PRODUCTION_CANARY_CHANGE_REQUEST': return 'warning';
    case 'STOP_REQUESTED': case 'STOPPED': case 'ROLLBACK_REQUESTED': case 'ROLLED_BACK': case 'FAILED': case 'CANCELLED': case 'EXPIRED': case 'UNSAFE': case 'BLOCKED': case 'STOP_RECOMMENDED': case 'ENVIRONMENT_BLOCKED': return 'danger';
    case 'NOT_AVAILABLE': case 'NO_DATA': case 'INSUFFICIENT_DATA': case 'NOT_RUN': case 'NOT_READY': return 'info';
    default: return 'neutral';
  }
}
function n1(n: number | null | undefined): string { return n == null ? '—' : `${n}`; }

interface PendingAction { title: string; verb: string; run: CanaryRunSummary; fn: (runId: string, reason: string) => Promise<{ ok: boolean }>; }

function ConfirmDialog({ pending, deploymentId, onClose, onDone }: { pending: PendingAction; deploymentId: string | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = reason.trim().length >= 3;
  const submit = async () => {
    if (!valid) return; setBusy(true); setErr(null);
    try {
      const r = await pending.fn(pending.run.id, reason.trim());
      if (r.ok) onDone(`${pending.verb} 기록됨 — Preview 운영자 승인. Production 미적용.`);
      else setErr('요청 거부됨(환경/상태/권한).');
    } catch { setErr('요청 실패(권한/마이그레이션/환경 확인).'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><AlertTriangle size={16} className="text-amber-300" /> {pending.title}</h3>
        <dl className="mt-3 grid grid-cols-2 gap-1 text-[11px] text-text-secondary">
          <dt className="text-text-tertiary">Environment</dt><dd>preview</dd>
          <dt className="text-text-tertiary">Deployment ID</dt><dd className="truncate">{deploymentId ?? '—'}</dd>
          <dt className="text-text-tertiary">Target Store</dt><dd className="truncate">{pending.run.storeUid.slice(0, 8)}</dd>
          <dt className="text-text-tertiary">Candidate Version</dt><dd>{n1(pending.run.candidateVersion)}</dd>
          <dt className="text-text-tertiary">Run State</dt><dd>{pending.run.state}</dd>
        </dl>
        <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/5 p-2 text-[11px] text-amber-200">
          이 작업은 Production 에 적용되지 않습니다 (Preview 내부 테스트 Store 전용). 현재 재생 중인 Track 을 강제 중단하지 않으며, 실제 Candidate Queue 적용(setQueue)은 DEFERRED 입니다.
        </div>
        <label className="mt-3 block text-[11px] font-medium text-text-tertiary">승인 이유 (필수, 3자 이상)</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
          className="mt-1 w-full rounded-lg border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none" placeholder="예: 내부 테스트 Store Canary 활성화" />
        {err && <p className="mt-2 text-[11px] text-red-300">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <AdminButton size="sm" variant="ghost" onClick={onClose}>취소</AdminButton>
          <AdminButton size="sm" variant="solid" tone="danger" disabled={!valid || busy} loading={busy} onClick={() => void submit()}>{pending.verb} 확인</AdminButton>
        </div>
      </div>
    </div>
  );
}

export default function AiPreviewCanaryDashboard() {
  const cfg = getAiPreviewCanaryConfig();
  const envGate = useMemo(() => currentEnvGate(), []);
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<CanaryOverview | null>(null);
  const [allowlist, setAllowlist] = useState<CanaryAllowlistRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CanaryRunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  // Add-store form
  const [newStore, setNewStore] = useState('');
  const [newExpiry, setNewExpiry] = useState('');

  const load = useCallback(async () => {
    if (!cfg.masterEnabled || !cfg.dashboardEnabled) return;
    setLoading(true); setError(null);
    try {
      const [o, a] = await Promise.allSettled([getCanaryOverview(50), getCanaryAllowlist(100)]);
      if (o.status === 'fulfilled') setOverview(o.value); else setError('Canary 집계 조회 실패(마이그레이션 0470 미적용 시 NO DATA).');
      if (a.status === 'fulfilled') setAllowlist(a.value);
    } catch { setError('Canary 데이터 조회 실패.'); }
    finally { setLoading(false); }
  }, [cfg.masterEnabled, cfg.dashboardEnabled]);
  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => overview?.runs.find((r) => r.id === selectedId) ?? null, [overview, selectedId]);
  useEffect(() => { if (selectedId) void getCanaryRun(selectedId).then(setDetail).catch(() => setDetail(null)); }, [selectedId]);

  const afterAction = useCallback((msg: string) => { setPending(null); setNotice(msg); void load().then(() => { if (selectedId) void getCanaryRun(selectedId).then(setDetail); }); }, [load, selectedId]);

  const addStore = useCallback(async () => {
    if (!newStore.trim() || !newExpiry) { setNotice('Store ID 와 만료일이 필요합니다.'); return; }
    try {
      const r = await addAllowlistStore({ storeId: newStore.trim(), purpose: 'internal preview test', expiresAt: new Date(newExpiry).toISOString(), maxSessions: 1, candidatePlaylistId: null, candidateVersion: null, notes: '' });
      setNotice(r.ok ? '내부 테스트 Store 추가됨 (preview, 만료 필수).' : '추가 실패.');
      setNewStore(''); setNewExpiry(''); void getCanaryAllowlist(100).then(setAllowlist);
    } catch { setNotice('추가 실패(환경/권한/마이그레이션 확인).'); }
  }, [newStore, newExpiry]);

  const removeStore = useCallback(async (storeUid: string) => {
    try { await setAllowlistEnabled(storeUid, false, 'operator remove'); setNotice('내부 테스트 Store 비활성화됨.'); void getCanaryAllowlist(100).then(setAllowlist); }
    catch { setNotice('제거 실패.'); }
  }, []);

  const actionsFor = useCallback((run: CanaryRunSummary): PendingAction[] => {
    const mk = (title: string, verb: string, fn: PendingAction['fn']): PendingAction => ({ title, verb, run, fn });
    switch (run.state) {
      case 'APPROVED': return [mk('Arm (활성화 준비)', 'Arm', armCanary)];
      case 'ARMED': return [mk('Activate (내부 테스트 활성화)', 'Activate', activateCanary)];
      case 'ACTIVE': return [mk('Pause', 'Pause', pauseCanary), mk('Request Stop', 'Request Stop', requestCanaryStop), mk('Complete', 'Complete', completeCanary)];
      case 'PAUSED': return [mk('Resume (Activate)', 'Activate', activateCanary), mk('Request Stop', 'Request Stop', requestCanaryStop)];
      case 'STOP_REQUESTED': return [mk('Confirm Stop', 'Confirm Stop', stopCanary)];
      case 'STOPPED': return [mk('Request Rollback', 'Request Rollback', requestCanaryRollback), mk('Complete', 'Complete', completeCanary)];
      case 'ROLLBACK_REQUESTED': return [mk('Confirm Rollback', 'Confirm Rollback', rollbackCanary)];
      default: return [];
    }
  }, []);

  if (!cfg.masterEnabled || !cfg.dashboardEnabled) {
    return (
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Rocket size={18} /> AI Preview Canary <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-7 (Preview)</span></h2>
        <AdminAlert tone="info" title="Preview Runtime Canary 비활성 (기본 OFF · Kill Switch ON)">
          Rule 기반 Preview Runtime Canary 는 기본 OFF이며 Kill Switch 가 기본 ON입니다. <code>VITE_AI_MUSIC_ENABLED</code>(마스터) + <code>VITE_AI_PREVIEW_CANARY_DASHBOARD_ENABLED</code> 로 대시보드가 로드됩니다.
          실행은 Preview 환경 + Allowed Deployment ID 일치 + 명시적 Store Allowlist 세 조건이 모두 있을 때만 가능하며, 일반/프랜차이즈 Store·Production Player 에는 절대 적용되지 않습니다. 실제 Candidate 적용은 DEFERRED 입니다.
        </AdminAlert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Rocket size={18} /> AI Preview Canary <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-7</span></h2>
          <p className="text-xs text-text-tertiary">Preview 전용 · 내부 테스트 Store Allowlist · 승인/Arm/Activate 분리 · Control 불변 · 현재 Track 미중단 · 실제 Queue 적용 DEFERRED · Production 미적용</p>
        </div>
        <AdminButton size="sm" variant="outline" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
      </div>
      {error && <AdminAlert tone="warning" title="데이터 로드 경고">{error}</AdminAlert>}
      {notice && <AdminAlert tone="info" title="기록">{notice}</AdminAlert>}

      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${tab === t.key ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover'}`}>{t.icon}{t.label}</button>)}
      </div>

      {loading && <AdminSkeleton className="h-40" />}

      {!loading && tab === 'overview' && (
        <AdminCard title="Overview">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <AdminStatCard label="Environment" value={envGate.status} tone={tone(envGate.status)} />
            <AdminStatCard label="Allowed Deployment" value={cfg.allowedDeploymentId ? '설정됨' : '미설정'} tone={cfg.allowedDeploymentId ? 'success' : 'info'} />
            <AdminStatCard label="Allowlisted Stores" value={n1(overview?.allowlistedStores)} tone="info" />
            <AdminStatCard label="Runs" value={n1(overview?.runs.length)} tone="info" />
            <AdminStatCard label="Armed" value={n1(overview?.runs.filter((r) => r.state === 'ARMED').length)} tone="warning" />
            <AdminStatCard label="Active Sessions" value={n1(overview?.runs.reduce((s, r) => s + (r.activeSessions ?? 0), 0))} tone="success" />
            <AdminStatCard label="Kill Switch" value={cfg.killSwitch ? 'ON (기본)' : 'OFF'} tone={cfg.killSwitch ? 'success' : 'warning'} />
          </div>
          <p className="mt-3 text-[11px] text-text-tertiary">
            실행 3-조건: Preview 환경 + Allowed Deployment ID 일치 + 명시적 Store Allowlist. 실제 Production Canary/Full Rollout 버튼은 제공하지 않습니다. Candidate Queue 적용(setQueue)은 DEFERRED 이며 현재 Track 을 강제 중단하지 않습니다.
          </p>
        </AdminCard>
      )}

      {!loading && tab === 'environment' && (
        <AdminCard title="Preview Environment Enforcement">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <AdminStatCard label="Status" value={envGate.status} tone={tone(envGate.status)} />
            <AdminStatCard label="Is Preview" value={envGate.isPreview ? 'YES' : 'NO'} tone={envGate.isPreview ? 'success' : 'danger'} />
            <AdminStatCard label="Deployment Match" value={envGate.deploymentMatches ? 'YES' : 'NO'} tone={envGate.deploymentMatches ? 'success' : 'danger'} />
            <AdminStatCard label="Kill Switch" value={cfg.killSwitch ? 'ON' : 'OFF'} tone={cfg.killSwitch ? 'success' : 'warning'} />
          </div>
          {envGate.reasons.length > 0 && <ul className="mt-2 list-disc pl-4 text-[11px] text-text-tertiary">{envGate.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
          <AdminAlert tone="info" title="Client + Server 이중 강제"><span className="text-[11px]">Client Flag 만으로 보호하지 않습니다. Server RPC 는 environment='preview' 가 아니면 거부하고, Production DB 에는 이 migration 이 적용되지 않아 Canary RPC 자체가 존재하지 않습니다.</span></AdminAlert>
        </AdminCard>
      )}

      {!loading && tab === 'allowlist' && (
        <AdminCard title="Internal Test Store Allowlist">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div><label className="block text-[11px] text-text-tertiary">Store UID</label><input value={newStore} onChange={(e) => setNewStore(e.target.value)} placeholder="uuid" className="mt-1 rounded-lg border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none" /></div>
            <div><label className="block text-[11px] text-text-tertiary">Expiry</label><input type="date" value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)} className="mt-1 rounded-lg border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none" /></div>
            <AdminButton size="sm" variant="solid" leftIcon={<Plus size={14} />} onClick={() => void addStore()}>Add Internal Test Store</AdminButton>
          </div>
          {allowlist.length === 0 ? <AdminEmpty title="Allowlist 비어있음" description="내부 테스트 Store 없음 (Wildcard/자동추가 금지)." /> : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">Store</th><th>Env</th><th>Enabled</th><th>Expiry</th><th>Max Sessions</th><th>Candidate</th><th></th></tr></thead>
                <tbody>
                  {allowlist.map((a) => (
                    <tr key={a.storeUid} className="border-t border-border">
                      <td className="py-1 font-mono text-[10px] text-text-primary">{a.storeUid.slice(0, 8)}</td>
                      <td><AdminBadge tone="success">{a.environment}</AdminBadge></td>
                      <td>{a.enabled ? <AdminBadge tone="success">enabled</AdminBadge> : <AdminBadge tone="neutral">disabled</AdminBadge>}</td>
                      <td className="text-text-tertiary">{a.expiresAt?.slice(0, 10)}</td>
                      <td>{n1(a.maxSessions)}</td>
                      <td className="text-text-tertiary">{a.allowedCandidatePlaylistId ? `${a.allowedCandidatePlaylistId.slice(0, 8)} v${n1(a.allowedCandidateVersion)}` : '—'}</td>
                      <td>{a.enabled && <AdminButton size="sm" variant="ghost" tone="danger" leftIcon={<Trash2 size={12} />} onClick={() => void removeStore(a.storeUid)}>Remove</AdminButton>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {!loading && (tab === 'approvals' || tab === 'runs' || tab === 'sessions' || tab === 'queue' || tab === 'evidence' || tab === 'guardrails' || tab === 'rollback' || tab === 'certification' || tab === 'audit' || tab === 'readiness') && (
        <AdminCard title="Canary Run 선택">
          {!overview || overview.runs.length === 0 ? <AdminEmpty title="Canary Run 없음" /> : (
            <div className="flex flex-wrap gap-1">
              {overview.runs.map((r) => (
                <button key={r.id} onClick={() => setSelectedId(r.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] ${selectedId === r.id ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-secondary hover:bg-bg-hover'}`}>
                  {r.storeUid.slice(0, 8)} <AdminBadge tone={tone(r.state)}>{r.state}</AdminBadge>
                </button>
              ))}
            </div>
          )}
        </AdminCard>
      )}

      {!loading && (tab === 'approvals' || tab === 'runs' || tab === 'rollback') && selected && (
        <AdminCard title={`${selected.storeUid.slice(0, 8)} — ${selected.state} (Actions)`}>
          <div className="flex flex-wrap gap-2">
            {actionsFor(selected).length === 0
              ? <AdminEmpty title="가능한 작업 없음" description={`현재 상태(${selected.state})에서 승인 가능한 전이가 없습니다.`} />
              : actionsFor(selected).map((a) => <AdminButton key={a.verb} size="sm" variant="solid" tone="danger" onClick={() => setPending(a)}>{a.title}</AdminButton>)}
          </div>
          <p className="mt-3 text-[11px] text-text-tertiary">모든 버튼은 확인 다이얼로그(이유 + Preview 환경 + Deployment + Store + Candidate Version + Production 미적용)를 거칩니다. Production Canary/Full Rollout 버튼은 없습니다.</p>
        </AdminCard>
      )}

      {!loading && tab === 'sessions' && selected && (
        <AdminCard title={`Sessions — ${selected.storeUid.slice(0, 8)}`}>
          {!detail || (detail.sessions as unknown[]).length === 0 ? <AdminEmpty title="세션 없음" /> : (
            <div className="flex flex-wrap gap-2">{(detail.sessions as Array<{ sessionHash: string; state: string }>).map((s, i) => <AdminBadge key={i} tone={tone(s.state)}>{s.sessionHash}: {s.state}</AdminBadge>)}</div>
          )}
        </AdminCard>
      )}

      {!loading && tab === 'queue' && selected && (
        <AdminCard title={`Queue Validation Snapshots — ${selected.storeUid.slice(0, 8)}`}>
          {!detail || (detail.snapshots as unknown[]).length === 0 ? <AdminEmpty title="스냅샷 없음" description="Candidate/Existing Queue 스냅샷은 hash/count 전용입니다." /> : (
            <div className="flex flex-wrap gap-2">{(detail.snapshots as Array<{ kind: string; snapshotHash: string }>).map((s, i) => <AdminBadge key={i} tone="info">{s.kind}: {s.snapshotHash}</AdminBadge>)}</div>
          )}
        </AdminCard>
      )}

      {!loading && tab === 'evidence' && selected && (
        <AdminCard title={`Runtime Evidence — ${selected.storeUid.slice(0, 8)}`}>
          {!detail || (detail.events as unknown[]).length === 0 ? <AdminEmpty title="Evidence 없음" description="저빈도 Canary Event (hash 전용). 실제 재생 미사용." /> : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">Event</th><th>Outcome</th><th>Boundary</th><th>When</th></tr></thead>
                <tbody>{(detail.events as Array<{ eventName: string; outcome: string | null; boundaryType: string | null; evaluatedAt: string }>).map((e, i) => (
                  <tr key={i} className="border-t border-border"><td className="py-1 text-text-primary">{e.eventName}</td><td>{e.outcome ? <AdminBadge tone={tone(e.outcome)}>{e.outcome}</AdminBadge> : '—'}</td><td className="text-text-tertiary">{e.boundaryType ?? '—'}</td><td className="text-[10px] text-text-tertiary">{e.evaluatedAt?.slice(0, 16)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {!loading && tab === 'guardrails' && (
        <AdminCard title="Playback Guardrails">
          <AdminAlert tone="warning" title="권고 전용"><span className="text-[11px]">재생 가드레일(Current Track 보존/Player State/Double Playback/Reload/Pause/Queue Empty → BLOCKED, TTFA/Transition Gap/Recovery → STOP_RECOMMENDED)은 권고만 생성합니다. 자동 Stop 없음 — 운영자가 Disable/Rollback 탭에서 승인해야 합니다. Runtime Evidence 미실행 시 NOT_RUN.</span></AdminAlert>
        </AdminCard>
      )}

      {!loading && tab === 'certification' && selected && (
        <AdminCard title={`Certification — ${selected.storeUid.slice(0, 8)}`}>
          {!detail || (detail.certifications as unknown[]).length === 0 ? <AdminEmpty title="인증 기록 없음" description="Preview Runtime 미실행 시 NOT_RUN." /> : (
            <div className="flex flex-wrap gap-2">{(detail.certifications as Array<{ score: number | null; certStatus: string; productionReadiness: string }>).map((c, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]"><AdminBadge tone={tone(c.certStatus)}>{c.certStatus}</AdminBadge> · score {n1(c.score)} · <AdminBadge tone={tone(c.productionReadiness)}>{c.productionReadiness}</AdminBadge></div>
            ))}</div>
          )}
          <AdminAlert tone="info" title="내부 Preview 전용"><span className="text-[11px]">"Production Ready" 라는 표현을 사용하지 않습니다. Production Readiness 는 최대 READY_FOR_PRODUCTION_CANARY_CHANGE_REQUEST 까지만이며, 실제 Production Canary/Full Rollout 은 수행하지 않습니다.</span></AdminAlert>
        </AdminCard>
      )}

      {!loading && tab === 'audit' && selected && (
        <AdminCard title={`Audit Trail — ${selected.storeUid.slice(0, 8)}`}>
          {!detail || (detail.actions as unknown[]).length === 0 ? <AdminEmpty title="감사 기록 없음" /> : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">Action</th><th>From</th><th>To</th><th>Reason</th><th>When</th></tr></thead>
                <tbody>{(detail.actions as Array<{ action: string; fromState: string | null; toState: string | null; reason: string | null; createdAt: string }>).map((a, i) => (
                  <tr key={i} className="border-t border-border"><td className="py-1 text-text-primary">{a.action}</td><td className="text-text-tertiary">{a.fromState ?? '—'}</td><td className="text-text-secondary">{a.toState ?? '—'}</td><td className="text-text-tertiary">{a.reason ?? '—'}</td><td className="text-[10px] text-text-tertiary">{a.createdAt?.slice(0, 16)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {!loading && tab === 'readiness' && (
        <AdminCard title="Production Readiness">
          <AdminAlert tone="warning" title="이 Phase 범위">
            <span className="text-[11px]">이 Phase 는 최대 <b>READY_FOR_PRODUCTION_CANARY_CHANGE_REQUEST</b> 까지만 권고합니다. 실제 Production Canary 를 실행하지 않으며(버튼 없음), 실제 고객/일반/프랜차이즈 Store 에 적용하지 않습니다. Production 적용은 별도 Change Request 로만 진행됩니다.</span>
          </AdminAlert>
        </AdminCard>
      )}

      {!loading && ['approvals', 'runs', 'sessions', 'queue', 'evidence', 'certification', 'audit', 'rollback'].includes(tab) && !selected && (
        <AdminEmpty title="Canary Run 을 선택하세요" description="위에서 Run 을 선택하면 상세가 표시됩니다." />
      )}

      {pending && <ConfirmDialog pending={pending} deploymentId={cfg.allowedDeploymentId} onClose={() => setPending(null)} onDone={afterAction} />}
    </div>
  );
}
