import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Play, Check, X, Sparkles, ExternalLink, AlertTriangle, Settings, Save } from 'lucide-react';
import {
  adminGenerateQcQueueCandidates,
  adminGenerateFingerprintQcCandidates,
  adminListQcQueue,
  adminQcQueueSummary,
  adminAssignQcQueue,
  adminResolveQcQueue,
  adminDismissQcQueue,
  adminBulkResolveQcQueue,
  adminListQcRules,
  adminUpdateQcRule,
  adminListQcRuleAudit,
  type QcQueueRowFull,
  type QcQueueSummary,
  type QcSeverity,
  type QcStatus,
  type QcSource,
  type QcRule,
  type QcRuleAuditEntry,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';
import TrackPlacementEditor from '@/components/admin/TrackPlacementEditor';
import BulkActionsModal from '@/components/admin/BulkActionsModal';

const SEVERITY_LABEL: Record<QcSeverity, string> = {
  CRITICAL: '심각',
  HIGH: '높음',
  MEDIUM: '보통',
  LOW: '낮음',
};
const SEVERITY_COLOR: Record<QcSeverity, string> = {
  CRITICAL: 'bg-rose-600 text-white',
  HIGH: 'bg-rose-500/20 text-rose-500',
  MEDIUM: 'bg-amber-500/20 text-amber-500',
  LOW: 'bg-gray-500/20 text-gray-400',
};
const ISSUE_LABEL: Record<string, string> = {
  placement_rock_in_lounge: 'Rock 부적합 배치',
  placement_energetic_in_hospital: 'Energetic 병원 배치',
  placement_fitness_in_relaxed: '헬스 부적합 배치',
  placement_predicted_mismatch: 'AI 매장 불일치',
  fingerprint_failed: '지문 실패',
  fingerprint_duplicate: '중복 음원',
  confidence_low_genre: '장르 신뢰도 낮음',
  confidence_low_mood: '무드 신뢰도 낮음',
  confidence_low_store: '매장 신뢰도 낮음',
  meta_conflict_genre: '메타 불일치 (장르)',
  exclusion_conflict: '금지장소 배치 잔존',
};

// ===== Wrapper with sub-tabs: 큐 vs 룰 관리 (Phase X3.4) =====
export default function QcQueueTab() {
  const [sub, setSub] = useState<'queue' | 'rules'>('queue');
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <button onClick={() => setSub('queue')}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${sub === 'queue' ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>
          큐
        </button>
        <button onClick={() => setSub('rules')}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${sub === 'rules' ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>
          룰 관리
        </button>
      </div>
      {sub === 'queue' ? <QcQueueInner /> : <QcRulesInner />}
    </div>
  );
}

function QcQueueInner() {
  const [rows, setRows] = useState<QcQueueRowFull[]>([]);
  const [summary, setSummary] = useState<QcQueueSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<QcStatus>('open');
  const [severityFilter, setSeverityFilter] = useState<QcSeverity | ''>('');
  const [issueFilter, setIssueFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState<QcSource | ''>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editorTrackId, setEditorTrackId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        adminListQcQueue(statusFilter, severityFilter || undefined,
          issueFilter || undefined, sourceFilter || undefined, 500),
        adminQcQueueSummary(),
      ]);
      setRows(list);
      setSummary(sum);
    } catch (e) {
      toast.error(`로딩 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, severityFilter, issueFilter, sourceFilter]);

  useEffect(() => { void load(); }, [load]);

  const regenerate = async (limit = 100) => {
    if (!confirm(`QC 큐 룰을 batch ${limit}건 실행하시겠어요? (중복은 자동 제외)`)) return;
    setBusy(true);
    try {
      const r = await adminGenerateQcQueueCandidates(limit, null, false);
      toast.success(`${r.generated_total} 건 후보 생성 (limit=${r.limit ?? limit})`);
      await load();
    } catch (e) {
      toast.error(`생성 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const regenerateFingerprint = async () => {
    if (!confirm('Fingerprint 후보 (failed + duplicate) 만 별도 생성하시겠어요?')) return;
    setBusy(true);
    try {
      const r = await adminGenerateFingerprintQcCandidates(100);
      toast.success(`Fingerprint 후보 ${r.generated_total} 건 생성`);
      await load();
    } catch (e) {
      toast.error(`생성 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const bulkResolve = async (status: 'resolved' | 'dismissed') => {
    if (selected.size === 0) { toast.error('항목 선택'); return; }
    const reason = prompt(`${status === 'resolved' ? '해결' : '무시'} 사유 (선택):`) ?? '';
    if (reason === null) return;
    setBusy(true);
    try {
      const cnt = await adminBulkResolveQcQueue(Array.from(selected), status, reason || undefined);
      toast.success(`${cnt}건 ${status} 처리`);
      setSelected(new Set());
      await load();
    } catch (e) {
      toast.error(`실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const assign = async (id: string) => {
    setBusy(true);
    try {
      await adminAssignQcQueue(id);
      toast.success('나에게 할당');
      await load();
    } catch (e) {
      toast.error(`할당 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const resolve = async (id: string) => {
    const reason = prompt('해결 사유 (선택):') ?? '';
    if (reason === null) return;
    setBusy(true);
    try {
      await adminResolveQcQueue(id, reason || undefined);
      toast.success('해결 처리');
      await load();
    } catch (e) {
      toast.error(`실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const dismiss = async (id: string) => {
    const reason = prompt('무시 사유 (선택):') ?? '';
    if (reason === null) return;
    setBusy(true);
    try {
      await adminDismissQcQueue(id, reason || undefined);
      toast.success('무시 처리');
      await load();
    } catch (e) {
      toast.error(`실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };

  // Bulk Actions 연동: 선택된 큐 항목의 track_ids 추출
  const selectedTrackIds = useMemo(() => {
    const set = new Set<string>();
    rows.filter((r) => selected.has(r.id)).forEach((r) => set.add(r.track_id));
    return Array.from(set);
  }, [rows, selected]);

  const issueTypeOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.issue_type));
    return Array.from(set).sort();
  }, [rows]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold">AI 검수 큐</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => void regenerate(100)} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50"
              title="룰별 최대 100건씩 batch 생성 (fingerprint 제외)">
              <Sparkles size={13} /> 룰 실행 (100)
            </button>
            <button onClick={() => void regenerate(20)} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-bg-deep px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50"
              title="가벼운 batch (20건)">
              룰 실행 (20)
            </button>
            <button onClick={() => void regenerateFingerprint()} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500/15 px-2.5 py-1.5 text-xs font-semibold text-indigo-500 disabled:opacity-50"
              title="Fingerprint failed + duplicate (분리 RPC, heavy)">
              Fingerprint 후보
            </button>
          </div>
        </div>
        {summary && (
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
            <Stat label="Open" v={summary.total_open} color="rose" />
            <Stat label="Reviewing" v={summary.total_reviewing} color="amber" />
            <Stat label="Resolved" v={summary.total_resolved} color="emerald" />
            <Stat label="Dismissed" v={summary.total_dismissed} color="gray" />
          </div>
        )}
        {summary?.by_severity && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as QcSeverity[]).map((s) => (
              summary.by_severity?.[s] != null && (
                <span key={s} className={`rounded px-1.5 py-0.5 font-bold ${SEVERITY_COLOR[s]}`}>
                  {SEVERITY_LABEL[s]} {summary.by_severity[s]}
                </span>
              )
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-card p-3 text-xs">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as QcStatus)}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="open">open</option>
          <option value="reviewing">reviewing</option>
          <option value="resolved">resolved</option>
          <option value="dismissed">dismissed</option>
          <option value="all">all</option>
        </select>
        <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as QcSeverity | '')}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">모든 severity</option>
          <option>CRITICAL</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option>
        </select>
        <select value={issueFilter} onChange={(e) => setIssueFilter(e.target.value)}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">모든 issue</option>
          {Object.entries(ISSUE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          {issueTypeOptions.filter((t) => !(t in ISSUE_LABEL)).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as QcSource | '')}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">모든 source</option>
          <option>rule</option><option>ai</option><option>chromaprint</option>
          <option>fingerprint</option><option>placement</option><option>manual</option>
        </select>
        <button onClick={() => void load()} disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-indigo-500/10 px-3 py-2 text-xs">
          <span className="font-bold text-indigo-500">Selected: {selected.size} ({selectedTrackIds.length} 트랙)</span>
          <button onClick={() => setSelected(new Set())} className="text-ink-dim hover:underline">해제</button>
          <button onClick={() => setBulkOpen(true)} disabled={selectedTrackIds.length === 0}
            className="inline-flex items-center gap-1 rounded bg-indigo-500 px-2 py-1 font-bold text-white">
            <Sparkles size={11} /> Bulk Actions
          </button>
          <button onClick={() => void bulkResolve('resolved')} disabled={busy}
            className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-1 font-bold text-emerald-500 disabled:opacity-50">
            <Check size={11} /> 해결 ({selected.size})
          </button>
          <button onClick={() => void bulkResolve('dismissed')} disabled={busy}
            className="inline-flex items-center gap-1 rounded bg-gray-500/15 px-2 py-1 font-bold text-gray-400 disabled:opacity-50">
            <X size={11} /> 무시 ({selected.size})
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">
          {loading ? '로딩 중…' : '큐가 비어 있어요. "룰 실행" 으로 후보를 생성하세요.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-bg-card">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim">
                <th className="px-2 py-2 w-8">
                  <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length}
                    ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < rows.length; }}
                    onChange={toggleAll} />
                </th>
                <th className="px-2 py-2">곡</th>
                <th className="px-2 py-2">이슈</th>
                <th className="px-2 py-2">severity</th>
                <th className="px-2 py-2">근거</th>
                <th className="px-2 py-2">상태</th>
                <th className="px-2 py-2">조치</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/10">
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="font-semibold">{r.title ?? '(제목없음)'}</div>
                    <div className="text-ink-dim">{r.artist ?? ''}</div>
                    <div className="text-[10px] text-ink-dim/70">{r.main_genre ?? '—'} · {r.track_id.slice(0, 8)}…</div>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="rounded bg-bg-deep px-1.5 py-0.5 text-[10px] font-bold">
                      {ISSUE_LABEL[r.issue_type] ?? r.issue_type}
                    </span>
                    <div className="text-[10px] text-ink-dim">{r.source}</div>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${SEVERITY_COLOR[r.severity]}`}>
                      {SEVERITY_LABEL[r.severity]}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <details>
                      <summary className="cursor-pointer text-[11px] text-ink-mute">{r.reason.slice(0, 60)}{r.reason.length > 60 ? '…' : ''}</summary>
                      <pre className="mt-1 max-w-md whitespace-pre-wrap break-all text-[10px] text-ink-dim">
                        {JSON.stringify(r.evidence_json, null, 2)}
                      </pre>
                    </details>
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      r.status === 'open' ? 'bg-rose-500/20 text-rose-500' :
                      r.status === 'reviewing' ? 'bg-amber-500/20 text-amber-500' :
                      r.status === 'resolved' ? 'bg-emerald-500/20 text-emerald-500' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>{r.status}</span>
                    {r.assigned_to_name && (
                      <div className="text-[10px] text-ink-dim/80">{r.assigned_to_name}</div>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-col gap-1">
                      <button onClick={() => setEditorTrackId(r.track_id)}
                        className="inline-flex items-center gap-1 rounded bg-indigo-500/15 px-2 py-0.5 font-semibold text-indigo-500">
                        <ExternalLink size={10} /> 편집기
                      </button>
                      {r.status === 'open' && (
                        <button onClick={() => void assign(r.id)} disabled={busy}
                          className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-500 disabled:opacity-50">
                          <Play size={10} /> 검토 시작
                        </button>
                      )}
                      {(r.status === 'open' || r.status === 'reviewing') && (
                        <>
                          <button onClick={() => void resolve(r.id)} disabled={busy}
                            className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-500 disabled:opacity-50">
                            <Check size={10} /> 해결
                          </button>
                          <button onClick={() => void dismiss(r.id)} disabled={busy}
                            className="inline-flex items-center gap-1 rounded bg-gray-500/15 px-2 py-0.5 font-semibold text-gray-400 disabled:opacity-50">
                            <X size={10} /> 무시
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editorTrackId && (
        <TrackPlacementEditor
          trackId={editorTrackId}
          onClose={() => setEditorTrackId(null)}
          onMutated={() => { void load(); }}
        />
      )}
      {bulkOpen && selectedTrackIds.length > 0 && (
        <BulkActionsModal
          trackIds={selectedTrackIds}
          onClose={() => setBulkOpen(false)}
          onCompleted={() => { void load(); }}
        />
      )}
    </div>
  );
}

function Stat({ label, v, color }: { label: string; v: number; color: string }) {
  const colorMap: Record<string, string> = {
    rose: 'text-rose-500', amber: 'text-amber-500',
    emerald: 'text-emerald-500', gray: 'text-gray-400',
  };
  return (
    <div className="rounded bg-bg-deep p-2">
      <div className="text-[10px] text-ink-dim">{label}</div>
      <div className={`text-xl font-bold ${colorMap[color] ?? 'text-blue-500'}`}>{v}</div>
    </div>
  );
}

// ===== Rules management (X3.4) =====
function QcRulesInner() {
  const [rules, setRules] = useState<QcRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState<QcRuleAuditEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRules(await adminListQcRules());
    } catch (e) {
      toast.error(`룰 로딩 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    try {
      setAudit(await adminListQcRuleAudit(undefined, 50));
    } catch (e) {
      toast.error(`이력 로딩 실패: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleActive = async (rule: QcRule) => {
    if (!confirm(`"${rule.name}" 룰을 ${rule.is_active ? '비활성화' : '활성화'}하시겠어요?\n(다음 generate 부터 적용)`)) return;
    setBusy(true);
    try {
      await adminUpdateQcRule(rule.id, { is_active: !rule.is_active },
        `toggle to ${!rule.is_active ? 'active' : 'inactive'}`);
      toast.success(`${rule.name} ${!rule.is_active ? '활성화' : '비활성화'}`);
      await load();
    } catch (e) {
      toast.error(`토글 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const changeSeverity = async (rule: QcRule, sev: QcSeverity) => {
    if (sev === rule.severity) return;
    setBusy(true);
    try {
      await adminUpdateQcRule(rule.id, { severity: sev }, `severity ${rule.severity}→${sev}`);
      toast.success(`${rule.rule_key}: ${rule.severity}→${sev}`);
      await load();
    } catch (e) {
      toast.error(`severity 변경 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const editDescription = async (rule: QcRule) => {
    const next = prompt('설명 수정:', rule.description ?? '');
    if (next == null || next === rule.description) return;
    setBusy(true);
    try {
      await adminUpdateQcRule(rule.id, { description: next }, 'edit description');
      toast.success('설명 저장');
      await load();
    } catch (e) {
      toast.error(`수정 실패: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const totalActive = rules.filter((r) => r.is_active).length;
  const totalOpenAll = rules.reduce((sum, r) => sum + r.open_count, 0);

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold">QC 룰 관리 ({rules.length})</h3>
          <div className="flex gap-2 text-xs">
            <span className="rounded bg-emerald-500/10 px-2 py-1 text-emerald-500">활성 {totalActive}</span>
            <span className="rounded bg-gray-500/10 px-2 py-1 text-gray-400">비활성 {rules.length - totalActive}</span>
            <span className="rounded bg-rose-500/10 px-2 py-1 text-rose-500">현재 open {totalOpenAll}</span>
            <button onClick={() => { setShowAudit((v) => !v); if (!showAudit) void loadAudit(); }}
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover">
              {showAudit ? '이력 숨김' : '변경 이력'}
            </button>
            <button onClick={() => void load()} disabled={loading}
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          룰의 활성/비활성, severity, 설명을 관리합니다. 비활성 룰은 admin_generate_qc_queue_candidates 호출 시 SKIP 됩니다.
          기존 open 큐는 자동 처리되지 않으니 별도로 resolve/dismiss 필요합니다.
        </p>
      </div>

      {showAudit && audit.length > 0 && (
        <div className="rounded-xl bg-bg-card p-3">
          <h4 className="mb-2 text-xs font-bold">변경 이력 ({audit.length})</h4>
          <ul className="space-y-1.5 text-[11px]">
            {audit.slice(0, 20).map((a) => (
              <li key={a.id} className="rounded bg-bg-deep px-2 py-1.5">
                <div className="flex items-center justify-between">
                  <span><b>{a.rule_key}</b> · {a.action_type}</span>
                  <span className="text-[10px] text-ink-dim">{new Date(a.created_at).toLocaleString()} · {a.admin_name ?? 'unknown'}</span>
                </div>
                {a.reason && <p className="text-ink-mute">사유: {a.reason}</p>}
                <details>
                  <summary className="cursor-pointer text-[10px] text-ink-dim">before/after</summary>
                  <div className="mt-1 grid grid-cols-2 gap-1 text-[10px]">
                    <pre className="rounded bg-bg-soft/40 p-1 text-rose-400">{JSON.stringify(a.before_json, null, 2)}</pre>
                    <pre className="rounded bg-bg-soft/40 p-1 text-emerald-400">{JSON.stringify(a.after_json, null, 2)}</pre>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <p className="text-center text-sm text-ink-dim">로딩 중…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-bg-card">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim">
                <th className="px-2 py-2">활성</th>
                <th className="px-2 py-2">룰</th>
                <th className="px-2 py-2">severity</th>
                <th className="px-2 py-2">source</th>
                <th className="px-2 py-2">설명 / 조건</th>
                <th className="px-2 py-2 text-right">open</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b border-line/10">
                  <td className="px-2 py-2 w-12">
                    <button onClick={() => void toggleActive(rule)} disabled={busy}
                      className={`rounded px-2 py-1 text-[10px] font-bold ${rule.is_active ? 'bg-emerald-500/20 text-emerald-500' : 'bg-gray-500/20 text-gray-400'} disabled:opacity-50`}>
                      {rule.is_active ? 'ON' : 'OFF'}
                    </button>
                  </td>
                  <td className="px-2 py-2">
                    <div className="font-semibold">{rule.name}</div>
                    <code className="text-[10px] text-ink-dim">{rule.rule_key}</code>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as QcSeverity[]).map((s) => (
                        <button key={s} onClick={() => void changeSeverity(rule, s)}
                          disabled={busy || rule.severity === s}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${rule.severity === s ? SEVERITY_COLOR[s] : 'bg-bg-deep text-ink-dim hover:bg-bg-hover'} disabled:opacity-100`}>
                          {SEVERITY_LABEL[s]}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <span className="rounded bg-bg-deep px-1.5 py-0.5 text-[10px]">{rule.source}</span>
                  </td>
                  <td className="px-2 py-2">
                    <button onClick={() => void editDescription(rule)} disabled={busy}
                      className="text-left text-ink-mute hover:text-ink disabled:opacity-50">
                      {rule.description ?? '(설명 없음)'}
                    </button>
                    {rule.condition_json && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[10px] text-ink-dim">condition_json</summary>
                        <pre className="mt-1 max-w-md whitespace-pre-wrap break-all text-[10px] text-ink-dim/80">
                          {JSON.stringify(rule.condition_json, null, 2)}
                        </pre>
                      </details>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <span className={`font-bold ${rule.open_count > 0 ? 'text-rose-500' : 'text-ink-dim'}`}>
                      {rule.open_count}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-ink-dim">
        ⚠️ 룰은 큐 생성 여부만 제어합니다. 자동 삭제/차단/반려 없음. 기존 open 큐 정리는 별도 작업.
      </p>
    </div>
  );
}
