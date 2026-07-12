/**
 * AiPilotOperationsDashboard — AI-MUSIC-5 Approval-Gated Pilot Execution & Safe Rollout Orchestration
 * (Preview). Rule 기반(LLM/ML 아님) 수동·운영자 승인 게이트 오케스트레이션. 실행은 하지만 자동은 없다:
 * Pilot 시작 / Store 배정 / Playlist 배포 / 확장 / 중단 / 롤백을 자동 수행하지 않는다. 모든 행위는 명시적
 * 운영자 버튼 + 확인 다이얼로그(이유 필수 + 영향 요약 + "자동 실행 없음")를 거친다. Treatment Override 는
 * preview 전용(어떤 Player/Queue 도 읽지 않음 — Runtime 연결 DEFERRED). 원본 Playlist 를 변경하지 않는다.
 * master flag + 세부 flag 기본 OFF. Guardrail(Streaming/Incident) source 미적용 → NOT_AVAILABLE 로 표시.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Rocket, ClipboardCheck, ListChecks, Play, Activity, Gauge, ShieldAlert, PauseCircle,
  Undo2, CheckCircle2, GitBranch, ScrollText, AlertTriangle,
} from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminEmpty, AdminSkeleton, AdminAlert, type AdminToneName,
} from '@/components/admin/ui';
import {
  getPilotOverview, getPilotRun, getPilotProgress, getPilotObservations, getPilotGuardrails,
  activatePilot, pausePilot, resumePilot, requestPilotStop, stopPilot, requestPilotRollback, rollbackPilot, completePilot,
  computeExpansion,
  type PilotRunSummary, type PilotRunDetail, type PilotProgressBundle, type PilotObservationRow, type PilotGuardrailRow,
} from '@/lib/api/aiPilotApi';
import { getAiPilotConfig } from '@/lib/aiPilot';

type Tab = 'overview' | 'approvals' | 'assignments' | 'activation' | 'active' | 'progress' | 'guardrails' | 'pausestop' | 'rollback' | 'completion' | 'expansion' | 'audit';
const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: 'overview', label: 'Overview', icon: <Rocket size={14} /> },
  { key: 'approvals', label: 'Approvals', icon: <ClipboardCheck size={14} /> },
  { key: 'assignments', label: 'Assignments', icon: <ListChecks size={14} /> },
  { key: 'activation', label: 'Activation', icon: <Play size={14} /> },
  { key: 'active', label: 'Active Pilots', icon: <Activity size={14} /> },
  { key: 'progress', label: 'Progress', icon: <Gauge size={14} /> },
  { key: 'guardrails', label: 'Guardrails', icon: <ShieldAlert size={14} /> },
  { key: 'pausestop', label: 'Pause / Stop', icon: <PauseCircle size={14} /> },
  { key: 'rollback', label: 'Rollback', icon: <Undo2 size={14} /> },
  { key: 'completion', label: 'Completion', icon: <CheckCircle2 size={14} /> },
  { key: 'expansion', label: 'Expansion', icon: <GitBranch size={14} /> },
  { key: 'audit', label: 'Audit', icon: <ScrollText size={14} /> },
];

const ACTIVE_STATES = ['SCHEDULED', 'ACTIVE', 'PAUSED', 'STOP_REQUESTED'];

function tone(s: string): AdminToneName {
  switch (s) {
    case 'ACTIVE': case 'PASS': case 'COMPLETED': case 'READY': return 'success';
    case 'APPROVED': case 'SCHEDULED': case 'PAUSED': case 'WARNING': case 'EXTEND_RECOMMENDED': return 'warning';
    case 'STOP_REQUESTED': case 'STOPPED': case 'ROLLBACK_REQUESTED': case 'ROLLED_BACK': case 'FAILED':
    case 'CANCELLED': case 'EXPIRED': case 'STOP_RECOMMENDED': case 'BLOCKED': case 'CONTAMINATED': return 'danger';
    case 'INSUFFICIENT_DATA': case 'NO_DATA': case 'NOT_AVAILABLE': case 'UNKNOWN': return 'info';
    default: return 'neutral';
  }
}
function n1(n: number | null | undefined): string { return n == null ? '—' : `${n}`; }

// ── Confirmation dialog: reason required + impact summary + explicit "no automatic execution" ──
interface PendingAction { title: string; impact: string; verb: string; run: string; fn: (runId: string, reason: string) => Promise<{ ok: boolean }>; }

function ConfirmDialog({ pending, onClose, onDone }: { pending: PendingAction; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = reason.trim().length >= 3;
  const submit = async () => {
    if (!valid) return;
    setBusy(true); setErr(null);
    try {
      const r = await pending.fn(pending.run, reason.trim());
      if (r.ok) onDone(`${pending.verb} 기록됨 — 운영자 승인 실행. 자동 실행 아님.`);
      else setErr('요청 거부됨(상태 전이 불가/권한).');
    } catch { setErr('요청 실패(권한/마이그레이션 확인).'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary"><AlertTriangle size={16} className="text-amber-300" /> {pending.title}</h3>
        <p className="mt-2 text-xs text-text-secondary">{pending.impact}</p>
        <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/5 p-2 text-[11px] text-amber-200">
          자동 실행 없음 (No Automatic Execution) — 이 작업은 운영자의 명시적 승인이며, 원본 Playlist / Player / Playback 을 변경하지 않습니다.
        </div>
        <label className="mt-3 block text-[11px] font-medium text-text-tertiary">승인 이유 (필수, 3자 이상)</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
          className="mt-1 w-full rounded-lg border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
          placeholder="예: 가드레일 정상 확인 후 파일럿 활성화" />
        {err && <p className="mt-2 text-[11px] text-red-300">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <AdminButton size="sm" variant="ghost" onClick={onClose}>취소</AdminButton>
          <AdminButton size="sm" variant="solid" tone="danger" disabled={!valid || busy} loading={busy} onClick={() => void submit()}>{pending.verb} 확인</AdminButton>
        </div>
      </div>
    </div>
  );
}

export default function AiPilotOperationsDashboard() {
  const cfg = getAiPilotConfig();
  const [tab, setTab] = useState<Tab>('overview');
  const [runs, setRuns] = useState<PilotRunSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PilotRunDetail | null>(null);
  const [progress, setProgress] = useState<PilotProgressBundle | null>(null);
  const [observations, setObservations] = useState<PilotObservationRow[]>([]);
  const [guardrails, setGuardrails] = useState<PilotGuardrailRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const load = useCallback(async () => {
    if (!cfg.masterEnabled || !cfg.orchestrationEnabled) return;
    setLoading(true); setError(null);
    try { setRuns(await getPilotOverview(50)); }
    catch { setError('Pilot 목록 조회 실패(마이그레이션 0468 미적용 시 NO DATA).'); }
    finally { setLoading(false); }
  }, [cfg.masterEnabled, cfg.orchestrationEnabled]);
  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => runs.find((r) => r.id === selectedId) ?? null, [runs, selectedId]);

  const loadDetail = useCallback(async (id: string) => {
    setDetail(null); setProgress(null); setObservations([]); setGuardrails([]);
    try {
      const [d, p, o, g] = await Promise.allSettled([getPilotRun(id), getPilotProgress(id, 30), getPilotObservations(id, 50), getPilotGuardrails(id, 50)]);
      if (d.status === 'fulfilled') setDetail(d.value);
      if (p.status === 'fulfilled') setProgress(p.value);
      if (o.status === 'fulfilled') setObservations(o.value);
      if (g.status === 'fulfilled') setGuardrails(g.value);
    } catch { setNotice('상세 조회 실패.'); }
  }, []);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); }, [selectedId, loadDetail]);

  const afterAction = useCallback((msg: string) => {
    setPending(null); setNotice(msg);
    void load().then(() => { if (selectedId) void loadDetail(selectedId); });
  }, [load, loadDetail, selectedId]);

  const overview = useMemo(() => ({
    total: runs.length,
    approved: runs.filter((r) => r.state === 'APPROVED').length,
    active: runs.filter((r) => r.state === 'ACTIVE').length,
    paused: runs.filter((r) => r.state === 'PAUSED').length,
    terminal: runs.filter((r) => ['COMPLETED', 'ROLLED_BACK', 'CANCELLED', 'FAILED', 'EXPIRED'].includes(r.state)).length,
    activeOverrides: runs.reduce((s, r) => s + (r.activeOverrides ?? 0), 0),
  }), [runs]);

  // State-appropriate gated actions for the selected run.
  const actionsFor = useCallback((run: PilotRunSummary): PendingAction[] => {
    const mk = (title: string, verb: string, impact: string, fn: PendingAction['fn']): PendingAction => ({ title, verb, impact, run: run.id, fn });
    switch (run.state) {
      case 'APPROVED': return [mk('파일럿 수동 활성화', '활성화', `${run.treatmentCount} Treatment Store 에 preview Override 생성(Control ${run.controlCount} 개는 미적용). 원본 Playlist 무변경.`, activatePilot)];
      case 'ACTIVE': return [
        mk('파일럿 일시중지', '일시중지', 'preview Override 를 PAUSED 로 전환. Player 영향 없음.', pausePilot),
        mk('중단 요청', '중단요청', 'STOP_REQUESTED 로 전환(확인 별도). 아직 중단 아님.', requestPilotStop),
        mk('파일럿 완료', '완료', '운영자 완료 처리 — Override 만료, 원본 Playlist 무변경.', completePilot),
      ];
      case 'PAUSED': return [
        mk('파일럿 재개', '재개', 'preview Override 를 ACTIVE 로 복귀.', resumePilot),
        mk('중단 요청', '중단요청', 'STOP_REQUESTED 로 전환(확인 별도).', requestPilotStop),
      ];
      case 'STOP_REQUESTED': return [mk('중단 확인', '중단확인', 'STOPPED 로 전환 — Override 중단, 기존 매장 경로로 Fail-Open(원본 유지).', stopPilot)];
      case 'STOPPED': return [
        mk('롤백 요청', '롤백요청', 'ROLLBACK_REQUESTED 로 전환(확인 별도).', requestPilotRollback),
        mk('파일럿 완료', '완료', '운영자 완료 처리 — Override 만료.', completePilot),
      ];
      case 'ROLLBACK_REQUESTED': return [mk('롤백 확인', '롤백확인', 'ROLLED_BACK 로 전환 — Override 롤백, 매장은 이전/기존 Playlist 로 해결. 원본 UPDATE 아님.', rollbackPilot)];
      default: return [];
    }
  }, []);

  if (!cfg.masterEnabled || !cfg.orchestrationEnabled) {
    return (
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Rocket size={18} /> AI Pilot Operations <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-5 (Preview)</span></h2>
        <AdminAlert tone="info" title="AI Pilot Orchestration 비활성 (기본 OFF · opt-in)">
          Rule 기반 승인 게이트 Pilot 오케스트레이션은 기본 OFF입니다. <code>VITE_AI_MUSIC_ENABLED</code>(마스터) + <code>VITE_AI_PILOT_ORCHESTRATION_ENABLED</code> 를 켜면 (읽기 전용) Pilot 관제가 로드됩니다.
          모든 실행은 운영자 승인 + 확인 다이얼로그를 거치며 자동 시작/배정/배포/확장/중단/롤백은 없습니다. Treatment Override 는 preview 전용이고 원본 Playlist·Player·Playback 을 변경하지 않습니다(Runtime 연결 DEFERRED).
        </AdminAlert>
      </div>
    );
  }

  const RunPicker = (
    <div className="flex flex-wrap gap-1">
      {runs.length === 0 ? <span className="text-xs text-text-tertiary">Pilot 없음</span> :
        runs.map((r) => (
          <button key={r.id} onClick={() => setSelectedId(r.id)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] ${selectedId === r.id ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-secondary hover:bg-bg-hover'}`}>
            {r.name} <AdminBadge tone={tone(r.state)}>{r.state}</AdminBadge>
          </button>
        ))}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Rocket size={18} /> AI Pilot Operations <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-5</span></h2>
          <p className="text-xs text-text-tertiary">Rule 기반 · 승인 게이트 · 자동 시작/배정/배포/확장/중단/롤백 없음 · Override preview 전용 · 원본 Playlist 무변경 · Runtime 연결 DEFERRED</p>
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
            <AdminStatCard label="Total Pilots" value={n1(overview.total)} tone="info" />
            <AdminStatCard label="Approved (미활성)" value={n1(overview.approved)} tone="warning" />
            <AdminStatCard label="Active" value={n1(overview.active)} tone="success" />
            <AdminStatCard label="Paused" value={n1(overview.paused)} tone="warning" />
            <AdminStatCard label="Terminal" value={n1(overview.terminal)} tone="neutral" />
            <AdminStatCard label="Active Overrides (preview)" value={n1(overview.activeOverrides)} tone="info" />
          </div>
          <p className="mt-3 text-[11px] text-text-tertiary">
            Override 는 preview 전용이며 어떤 Player/Queue 도 읽지 않습니다(Runtime 연결 DEFERRED). 승인 저장만으로는 활성화되지 않으며, 활성화·중단·롤백은 각각 별도 확인 버튼을 요구합니다. 전체 자동 롤아웃(Full Rollout) 버튼은 제공하지 않습니다.
          </p>
        </AdminCard>
      )}

      {!loading && tab === 'approvals' && (
        <AdminCard title="Approvals (승인 게이트)">
          <p className="mb-2 text-xs text-text-secondary">승인은 AI-MUSIC-4 의 <code>APPROVED_FOR_MANUAL_SETUP</code> Plan 에서 불변 배정 스냅샷과 함께 기록됩니다(상태 APPROVED). 승인 저장은 <b>활성화가 아닙니다</b> — Activation 탭에서 별도 활성화가 필요합니다.</p>
          {runs.filter((r) => r.state === 'APPROVED').length === 0 ? <AdminEmpty title="승인 대기 Pilot 없음" description="APPROVED 상태의 Pilot 이 없습니다." /> : (
            <div className="space-y-2">
              {runs.filter((r) => r.state === 'APPROVED').map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2">
                  <div className="text-xs text-text-primary">{r.name} · v{n1(r.candidateVersion)} · Treatment {r.treatmentCount} / Control {r.controlCount}</div>
                  <AdminBadge tone={tone(r.state)}>{r.state}</AdminBadge>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      )}

      {!loading && (tab === 'assignments' || tab === 'activation' || tab === 'progress' || tab === 'guardrails' || tab === 'pausestop' || tab === 'rollback' || tab === 'completion' || tab === 'expansion' || tab === 'audit') && (
        <AdminCard title="Pilot 선택">{RunPicker}</AdminCard>
      )}

      {!loading && tab === 'active' && (
        <AdminCard title="Active Pilots">
          {runs.filter((r) => ACTIVE_STATES.includes(r.state)).length === 0 ? <AdminEmpty title="활성 Pilot 없음" /> : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">Pilot</th><th>State</th><th>Treatment</th><th>Control</th><th>Overrides</th><th>Window</th></tr></thead>
                <tbody>
                  {runs.filter((r) => ACTIVE_STATES.includes(r.state)).map((r) => (
                    <tr key={r.id} className="border-t border-border cursor-pointer hover:bg-bg-hover" onClick={() => { setSelectedId(r.id); setTab('progress'); }}>
                      <td className="py-1 text-text-primary">{r.name}</td>
                      <td><AdminBadge tone={tone(r.state)}>{r.state}</AdminBadge></td>
                      <td>{n1(r.treatmentCount)}</td><td>{n1(r.controlCount)}</td><td>{n1(r.activeOverrides)}</td>
                      <td className="text-text-tertiary">{r.scheduledStart?.slice(0, 10) ?? '—'} → {r.scheduledEnd?.slice(0, 10) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {!loading && tab === 'assignments' && selected && (
        <AdminCard title={`Assignments — ${selected.name}`}>
          {!detail || detail.assignments.length === 0 ? <AdminEmpty title="배정 없음" /> : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">Store</th><th>Arm</th><th>Candidate</th><th>Ver</th><th>Prev</th><th>Hash</th></tr></thead>
                <tbody>
                  {detail.assignments.map((a) => (
                    <tr key={a.id} className="border-t border-border">
                      <td className="py-1 text-text-primary">{a.storeId.slice(0, 8)}</td>
                      <td><AdminBadge tone={a.arm === 'control' ? 'neutral' : 'info'}>{a.arm}</AdminBadge></td>
                      <td className="text-text-secondary">{a.candidatePlaylistId ?? <span className="text-text-tertiary">— (control)</span>}</td>
                      <td>{n1(a.candidateVersion)}</td><td className="text-text-tertiary">{a.previousPlaylistId ?? '—'}</td>
                      <td className="font-mono text-[10px] text-text-tertiary">{a.assignmentHash}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-text-tertiary">불변 스냅샷 · Control 은 candidate 없음(Control 보존) · Hash 는 결정적 무결성 검증용.</p>
            </div>
          )}
        </AdminCard>
      )}

      {!loading && (tab === 'activation' || tab === 'pausestop' || tab === 'rollback' || tab === 'completion') && selected && (
        <AdminCard title={`${TABS.find((t) => t.key === tab)?.label} — ${selected.name} (${selected.state})`}>
          <div className="flex flex-wrap gap-2">
            {actionsFor(selected).length === 0
              ? <AdminEmpty title="가능한 작업 없음" description={`현재 상태(${selected.state})에서 승인 가능한 전이가 없습니다.`} />
              : actionsFor(selected).map((a) => (
                <AdminButton key={a.verb} size="sm" variant="solid" tone="danger" onClick={() => setPending(a)}>{a.title}</AdminButton>
              ))}
          </div>
          <p className="mt-3 text-[11px] text-text-tertiary">모든 버튼은 확인 다이얼로그(이유 필수 + 영향 요약 + 자동 실행 없음)를 거칩니다. 전체 자동 롤아웃 버튼은 없습니다.</p>
        </AdminCard>
      )}

      {!loading && tab === 'progress' && selected && (
        <AdminCard title={`Progress — ${selected.name}`}>
          {!progress ? <AdminEmpty title="진행 데이터 없음" description="관측 신호 없음(또는 마이그레이션 미적용)." /> : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <AdminStatCard label="Treatment Sessions" value={n1(progress.arms.treatment.sessions)} tone="info" />
                <AdminStatCard label="Control Sessions" value={n1(progress.arms.control.sessions)} tone="neutral" />
                <AdminStatCard label="Treatment Playbacks" value={n1(progress.arms.treatment.playbacks)} tone="info" />
                <AdminStatCard label="Guardrail" value={progress.guardrail.status} tone={tone(progress.guardrail.status)} />
              </div>
              <p className="text-[11px] text-text-tertiary">{progress.guardrail.recommendation} · Streaming/Incident source 미적용 → NOT_AVAILABLE. Store/Session/Playback 은 구분되어 집계됩니다.</p>
            </div>
          )}
        </AdminCard>
      )}

      {!loading && tab === 'guardrails' && selected && (
        <AdminCard title={`Guardrails — ${selected.name}`}>
          {guardrails.length === 0 ? <AdminEmpty title="가드레일 기록 없음" description="STOP_RECOMMENDED/BLOCKED 는 권고일 뿐 자동 중단하지 않습니다." /> : (
            <div className="space-y-2">
              {guardrails.map((g, i) => (
                <div key={i} className="rounded-lg border border-border p-2">
                  <div className="flex items-center justify-between"><AdminBadge tone={tone(g.status)}>{g.status}</AdminBadge><span className="text-[10px] text-text-tertiary">{g.createdAt?.slice(0, 16)}</span></div>
                  {g.recommendation && <p className="mt-1 text-[11px] text-text-secondary">{g.recommendation}</p>}
                </div>
              ))}
            </div>
          )}
          <AdminAlert tone="warning" title="권고 전용"><span className="text-[11px]">가드레일 실패는 STOP_RECOMMENDED 기록만 생성합니다 — 중단은 운영자가 Pause/Stop 탭에서 승인해야 합니다.</span></AdminAlert>
        </AdminCard>
      )}

      {!loading && tab === 'completion' && selected && (
        <div className="space-y-4">
          <AdminCard title={`Observations — ${selected.name}`}>
            {observations.length === 0 ? <AdminEmpty title="관측 스냅샷 없음" /> : (
              <div className="flex flex-wrap gap-2">
                {observations.map((o, i) => <AdminBadge key={i} tone={tone(o.status)}>{o.window}: {o.status}</AdminBadge>)}
              </div>
            )}
          </AdminCard>
        </div>
      )}

      {!loading && tab === 'expansion' && selected && (
        <AdminCard title={`Expansion — ${selected.name}`}>
          {(() => {
            const completed = selected.state === 'COMPLETED';
            const exp = computeExpansion({ pilotCompleted: completed, outcomePositive: completed, guardrailsClean: true, contamination: 'CLEAN', currentStores: selected.treatmentCount, currentStage: 'NONE', operatorApproved: false });
            return (
              <div className="space-y-2">
                <div className="flex items-center gap-2"><span className="text-xs text-text-secondary">권고 단계:</span><AdminBadge tone={tone(exp.stage === 'NONE' ? 'INSUFFICIENT_DATA' : 'WARNING')}>{exp.stage}</AdminBadge></div>
                <ul className="list-disc pl-4 text-[11px] text-text-tertiary">{exp.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                <AdminAlert tone="info" title="확장은 항상 새 Experiment 버전">
                  <span className="text-[11px]">확장은 in-place 가 아니라 <b>새 Experiment 버전</b>으로만 진행되며(newExperimentVersionRequired), 전체 프로덕션 자동 롤아웃(fullProductionRollout)은 이 단계에서 제공하지 않습니다. 각 단계는 운영자 승인을 요구합니다.</span>
                </AdminAlert>
              </div>
            );
          })()}
        </AdminCard>
      )}

      {!loading && tab === 'audit' && selected && (
        <AdminCard title={`Audit Trail — ${selected.name}`}>
          {!detail || detail.actions.length === 0 ? <AdminEmpty title="감사 기록 없음" /> : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">Action</th><th>From</th><th>To</th><th>Reason</th><th>When</th></tr></thead>
                <tbody>
                  {detail.actions.map((a, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1 text-text-primary">{a.action}</td>
                      <td className="text-text-tertiary">{a.fromState ?? '—'}</td>
                      <td className="text-text-secondary">{a.toState ?? '—'}</td>
                      <td className="text-text-tertiary">{a.reason ?? '—'}</td>
                      <td className="text-[10px] text-text-tertiary">{a.createdAt?.slice(0, 16)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {!loading && ['assignments', 'activation', 'progress', 'guardrails', 'pausestop', 'rollback', 'completion', 'expansion', 'audit'].includes(tab) && !selected && (
        <AdminEmpty title="Pilot 을 선택하세요" description="위에서 Pilot 을 선택하면 상세가 표시됩니다." />
      )}

      {pending && <ConfirmDialog pending={pending} onClose={() => setPending(null)} onDone={afterAction} />}
    </div>
  );
}
