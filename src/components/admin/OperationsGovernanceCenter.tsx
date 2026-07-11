/**
 * OperationsGovernanceCenter — WEB-OBS-9 운영 거버넌스 & 의사결정 지원 (Decision Support 전용).
 *
 * 릴리스 준비도/권고/Playbook/승인 큐/거버넌스/이력을 한 화면에서 제공한다. 규칙 기반(ML/LLM 아님).
 * 어떤 버튼도 릴리스를 Merge/Deploy/Rollback 하거나 Release 를 차단하거나 Player 를 제어하지 않는다.
 * 승인/반려/조사필요는 운영자의 선택을 "기록(감사 로그)"만 하며, 그로 인해 자동 실행되는 것은 없다.
 * 실제 Signal이 없으면 NO_DATA / NOT_AVAILABLE / INSUFFICIENT_DATA 로 표시한다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ClipboardList, GitPullRequest, CheckCircle2, Lightbulb, BookOpen, FileText, History, ShieldCheck, Download } from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminEmpty, AdminSkeleton, AdminAlert, AdminSearch, type AdminToneName,
} from '@/components/admin/ui';
import {
  getReleaseReadiness, getGovernanceState, getPlaybooks, getExecutiveReport, getEvidencePackage,
  recordDecision, recordApproval, upsertRule,
  type SqWindow, type ReleaseReadinessBundle, type GovernanceState,
} from '@/lib/api/opsGovernanceApi';
import { getOpsGovernanceConfig, type Playbook, type ExecutiveReport, type ApprovalChoice, type OperationsRule } from '@/lib/opsGovernance';

const WINDOWS: SqWindow[] = ['24h', '7d', '30d'];
type SubTab = 'overview' | 'readiness' | 'approvals' | 'recommendations' | 'playbooks' | 'evidence' | 'history' | 'governance';
const SUBTABS: Array<{ key: SubTab; label: string; icon: React.ReactNode }> = [
  { key: 'overview', label: 'Overview', icon: <ClipboardList size={14} /> },
  { key: 'readiness', label: 'Release Readiness', icon: <GitPullRequest size={14} /> },
  { key: 'approvals', label: 'Approvals', icon: <CheckCircle2 size={14} /> },
  { key: 'recommendations', label: 'Recommendations', icon: <Lightbulb size={14} /> },
  { key: 'playbooks', label: 'Playbooks', icon: <BookOpen size={14} /> },
  { key: 'evidence', label: 'Evidence', icon: <FileText size={14} /> },
  { key: 'history', label: 'History', icon: <History size={14} /> },
  { key: 'governance', label: 'Governance', icon: <ShieldCheck size={14} /> },
];

function tone(s: string): AdminToneName {
  switch (s) {
    case 'READY': case 'PROMOTE_OK': case 'HIGH': case 'APPROVED': case 'LOW': case 'NONE': return 'success';
    case 'REVIEW_REQUIRED': case 'MONITOR': case 'MEDIUM': case 'NEEDS_INVESTIGATION': case 'OBSERVE': case 'MODERATE': return 'warning';
    case 'HIGH_RISK': case 'BLOCK_RECOMMENDED': case 'BLOCK_RELEASE_RECOMMENDED': case 'DELAY_RELEASE': case 'CRITICAL': case 'ESCALATE': case 'REJECTED': return 'danger';
    case 'INSUFFICIENT_DATA': case 'INSUFFICIENT': case 'OPEN': case 'OBSERVED': return 'info';
    default: return 'neutral';
  }
}
function num(n: number | null | undefined): string { return n == null ? '—' : `${n}`; }

export default function OperationsGovernanceCenter() {
  const cfg = getOpsGovernanceConfig();
  const [sub, setSub] = useState<SubTab>('overview');
  const [win, setWin] = useState<SqWindow>('7d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ReleaseReadinessBundle | null>(null);
  const [gov, setGov] = useState<GovernanceState | null>(null);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [exec, setExec] = useState<ExecutiveReport | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [storeId, setStoreId] = useState('');
  const [evidenceMd, setEvidenceMd] = useState<string | null>(null);
  const [evidenceErr, setEvidenceErr] = useState<string | null>(null);
  const reqSeq = useRef(0);

  const load = useCallback(async () => {
    const myReq = ++reqSeq.current;
    setLoading(true); setError(null);
    try {
      const [r, g, p, e] = await Promise.allSettled([getReleaseReadiness(win), getGovernanceState(), getPlaybooks(), getExecutiveReport(win)]);
      if (myReq !== reqSeq.current) return;
      setReadiness(r.status === 'fulfilled' ? r.value : null);
      setGov(g.status === 'fulfilled' ? g.value : null);
      setPlaybooks(p.status === 'fulfilled' ? p.value : []);
      setExec(e.status === 'fulfilled' ? e.value : null);
      if ([r, g, p, e].every((x) => x.status === 'rejected')) { setError('거버넌스 데이터를 불러오지 못했습니다(마이그레이션 0460~0462 미적용 시 NO DATA).'); }
      setFetchedAt(new Date());
    } catch { if (myReq === reqSeq.current) setError('거버넌스 데이터를 불러오지 못했습니다.'); }
    finally { if (myReq === reqSeq.current) setLoading(false); }
  }, [win]);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key); setNotice(null);
    try { await fn(); setNotice(ok); await load(); }
    catch { setNotice('작업 실패(권한/마이그레이션 확인).'); }
    finally { setBusy(null); }
  }, [load]);

  const logDecision = (release: string, action: string, confidence: number | null, payload: unknown) =>
    act(`log:${release}`, () => recordDecision({ scope: release, kind: 'RELEASE', title: `Release ${release} readiness`, recommendation: action, confidence, payload }), '의사결정 스냅샷 기록됨(실행 아님).');
  const approve = (id: string, choice: ApprovalChoice) =>
    act(`appr:${id}:${choice}`, () => recordApproval(id, choice, null), `기록됨: ${choice} (감사 로그, 실행 아님).`);
  const toggleRule = (r: OperationsRule) =>
    act(`rule:${r.key}`, () => upsertRule({ key: r.key, label: r.label, threshold: r.threshold, weight: r.weight, enabled: !r.enabled }), `Rule ${r.key} ${r.enabled ? '비활성' : '활성'} (v↑).`);

  const runEvidence = useCallback(async () => {
    const id = storeId.trim(); setEvidenceMd(null); setEvidenceErr(null);
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) { setEvidenceErr('store UUID 형식이 아닙니다.'); return; }
    try { const r = await getEvidencePackage(id, '24h'); if (!r) { setEvidenceErr('데이터 없음.'); return; } setEvidenceMd(r.markdown); }
    catch { setEvidenceErr('Evidence 조회 실패.'); }
  }, [storeId]);

  const downloadEvidence = useCallback(() => {
    if (!evidenceMd) return;
    try {
      const blob = new Blob([evidenceMd], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `evidence-${storeId.slice(0, 8)}.md`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* noop */ }
  }, [evidenceMd, storeId]);

  if (loading && !readiness && !gov) {
    return <div className="space-y-3"><AdminSkeleton className="h-8 w-64" /><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 6 }).map((_, i) => <AdminSkeleton key={i} className="h-24" />)}</div></div>;
  }

  const ov = gov?.overview;
  const recs = readiness?.recommendations ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><ShieldCheck size={18} /> 운영 거버넌스 & 의사결정 지원</h2>
          <p className="text-xs text-text-tertiary">Decision Support 전용 · 규칙 기반 · 자동 실행/Rollback/Release 차단/Player 제어 없음 · 운영자 승인 필수</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border">
            {WINDOWS.map((w) => <button key={w} onClick={() => setWin(w)} className={`px-3 py-1.5 text-xs font-medium ${win === w ? 'bg-accent text-white' : 'bg-bg-card text-text-secondary hover:bg-bg-hover'}`}>{w}</button>)}
          </div>
          <AdminButton size="sm" variant="outline" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
        </div>
      </div>
      {fetchedAt && <p className="text-[11px] text-text-tertiary">조회: {fetchedAt.toLocaleTimeString()} · window {win}</p>}
      {error && <AdminAlert tone="warning" title="데이터 로드 경고">{error}</AdminAlert>}
      {notice && <AdminAlert tone="info" title="기록">{notice}</AdminAlert>}

      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {SUBTABS.map((t) => (
          <button key={t.key} onClick={() => setSub(t.key)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${sub === t.key ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover'}`}>{t.icon}{t.label}</button>
        ))}
      </div>

      {/* Overview */}
      {sub === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <AdminStatCard label="Open Decisions" value={num(ov?.openDecisions)} tone={ov && ov.openDecisions > 0 ? 'warning' : 'neutral'} />
            <AdminStatCard label="Approvals (7d)" value={num(ov?.approvals7d)} tone="success" />
            <AdminStatCard label="Rejected (7d)" value={num(ov?.rejected7d)} tone={ov && ov.rejected7d > 0 ? 'danger' : 'neutral'} />
            <AdminStatCard label="Releases Reviewed" value={num(readiness?.readiness.length)} tone="info" />
          </div>
          <AdminCard title="상위 권고 (advisory only)">
            {recs.length === 0 ? <AdminEmpty title="권고 없음" description="관찰 유지" /> : (
              <ul className="space-y-1.5">
                {recs.slice(0, 8).map((r) => (
                  <li key={r.id} className="flex items-center gap-2 text-xs">
                    <AdminBadge tone={tone(r.urgency)}>{r.urgency}</AdminBadge>
                    <span className="font-medium text-text-primary">{r.scope}</span>
                    <AdminBadge tone={tone(r.action)}>{r.action}</AdminBadge>
                    <span className="text-text-secondary">{r.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </div>
      )}

      {/* Release Readiness */}
      {sub === 'readiness' && (
        <AdminCard title="Release Readiness Score">
          {!readiness || readiness.readiness.length === 0 ? <AdminEmpty title="NO DATA" description="release 관측 없음" /> : (
            <div className="overflow-x-auto">
              <p className="mb-2 text-[11px] text-text-tertiary">baseline: {readiness.baseline ?? '—'} · 자동 merge 아님 — 기록은 운영자 클릭.</p>
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">Release</th><th>Status</th><th>Score</th><th>Sess</th><th>Stores</th><th>Crit</th><th>Regr</th><th>Conf</th><th></th></tr></thead>
                <tbody>
                  {readiness.readiness.map((r) => (
                    <tr key={r.release} className="border-t border-border">
                      <td className="py-1 text-text-primary">{r.release}{r.release === readiness.baseline && <AdminBadge tone="info">base</AdminBadge>}</td>
                      <td><AdminBadge tone={tone(r.status)}>{r.status}</AdminBadge></td>
                      <td>{num(r.score)}</td><td>{r.sessions}</td><td>{r.stores}</td>
                      <td>{r.criticalIncidents > 0 ? <AdminBadge tone="danger">{r.criticalIncidents}</AdminBadge> : '0'}</td>
                      <td>{r.regressedMetrics}</td><td>{r.confidence == null ? 'INSUF' : `${r.confidence}%`}</td>
                      <td>{cfg.recordEnabled && r.status !== 'INSUFFICIENT_DATA' && (
                        <AdminButton size="sm" variant="outline" disabled={busy === `log:${r.release}`}
                          onClick={() => void logDecision(r.release, r.status === 'READY' ? 'PROMOTE_OK' : r.status === 'BLOCK_RECOMMENDED' ? 'BLOCK_RELEASE_RECOMMENDED' : 'DELAY_RELEASE', r.confidence, { score: r.score, status: r.status })}>기록</AdminButton>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {/* Approvals */}
      {sub === 'approvals' && (
        <AdminCard title="Approval Queue (기록 전용 — 실행 없음)">
          {!gov || gov.queue.length === 0 ? <AdminEmpty title="대기 없음" description="OPEN 의사결정이 없습니다" /> : (
            <div className="space-y-2">
              {gov.queue.map((d) => (
                <div key={d.id} className="rounded-lg border border-border bg-bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminBadge tone="info">{d.kind}</AdminBadge>
                    <span className="text-sm font-medium text-text-primary">{d.title}</span>
                    <AdminBadge tone={tone(d.recommendation)}>{d.recommendation}</AdminBadge>
                    {d.confidence != null && <span className="text-[11px] text-text-tertiary">conf {d.confidence}%</span>}
                  </div>
                  {cfg.approvalsEnabled && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <AdminButton size="sm" tone="success" variant="subtle" disabled={!!busy} onClick={() => void approve(d.id, 'APPROVE')}>Approve</AdminButton>
                      <AdminButton size="sm" tone="danger" variant="subtle" disabled={!!busy} onClick={() => void approve(d.id, 'REJECT')}>Reject</AdminButton>
                      <AdminButton size="sm" tone="warning" variant="subtle" disabled={!!busy} onClick={() => void approve(d.id, 'NEED_INVESTIGATION')}>Need Investigation</AdminButton>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      )}

      {/* Recommendations */}
      {sub === 'recommendations' && (
        <AdminCard title="Decision Recommendations (advisory only)">
          {recs.length === 0 ? <AdminEmpty title="권고 없음" /> : (
            <div className="space-y-2">
              {recs.map((r) => (
                <div key={r.id} className="rounded-lg border border-border bg-bg-card p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminBadge tone={tone(r.urgency)}>{r.urgency}</AdminBadge>
                    <AdminBadge tone={tone(r.action)}>{r.action}</AdminBadge>
                    <span className="font-medium text-text-primary">{r.scope}</span>
                    {r.confidence != null && <span className="text-text-tertiary">conf {r.confidence}%</span>}
                  </div>
                  <p className="mt-1 text-text-secondary">{r.reason}</p>
                  {r.evidence.length > 0 && <p className="mt-1 text-[11px] text-text-tertiary">근거: {r.evidence.join(' · ')}</p>}
                  <p className="mt-1 text-[10px] text-text-tertiary">자동 실행 없음 · 운영자 승인 필요</p>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      )}

      {/* Playbooks */}
      {sub === 'playbooks' && (
        <div className="grid gap-3 md:grid-cols-2">
          {playbooks.length === 0 ? <AdminEmpty title="NO DATA" description="playbook 없음(0462 미적용)" /> : playbooks.map((p) => (
            <AdminCard key={p.incidentType} title={p.title}>
              <div className="space-y-1.5 text-xs">
                <div><span className="text-text-tertiary">Possible Causes: </span><span className="text-text-secondary">{p.possibleCauses.join(', ')}</span></div>
                <div><span className="text-text-tertiary">Evidence: </span><span className="text-text-secondary">{p.evidenceToCollect.join(', ')}</span></div>
                <div><span className="text-text-tertiary">Checks: </span><span className="text-text-secondary">{p.recommendedChecks.join(', ')}</span></div>
                <div className="flex flex-wrap items-center gap-1"><span className="text-text-tertiary">Escalation: </span>{p.escalationPath.map((e, i) => <AdminBadge key={i} tone="neutral">{e}</AdminBadge>)}</div>
              </div>
            </AdminCard>
          ))}
        </div>
      )}

      {/* Evidence */}
      {sub === 'evidence' && (
        <AdminCard title="Operational Evidence Package (store UUID · PDF/print export)">
          <div className="flex flex-wrap items-center gap-2">
            <AdminSearch value={storeId} onChange={setStoreId} placeholder="store UUID (auth.uid())" />
            <AdminButton size="sm" variant="outline" onClick={() => void runEvidence()}>생성</AdminButton>
            {evidenceMd && <AdminButton size="sm" variant="outline" leftIcon={<Download size={14} />} onClick={downloadEvidence}>Markdown 내보내기(인쇄→PDF)</AdminButton>}
          </div>
          {evidenceErr && <AdminAlert tone="warning" title="조회">{evidenceErr}</AdminAlert>}
          {evidenceMd && <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-bg-card p-3 text-[11px] text-text-secondary">{evidenceMd}</pre>}
        </AdminCard>
      )}

      {/* History */}
      {sub === 'history' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <AdminCard title="Historical Decisions">
            {!gov || gov.history.decisions.length === 0 ? <AdminEmpty title="이력 없음" /> : (
              <div className="max-h-96 space-y-1 overflow-y-auto text-xs">
                {gov.history.decisions.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 border-b border-border py-1">
                    <span className="w-40 shrink-0 text-text-tertiary">{d.createdAt}</span>
                    <AdminBadge tone={tone(d.status)}>{d.status}</AdminBadge>
                    <span className="text-text-secondary">{d.title}</span>
                  </div>
                ))}
              </div>
            )}
          </AdminCard>
          <AdminCard title="Governance Timeline (audit)">
            {!gov || gov.timeline.length === 0 ? <AdminEmpty title="이벤트 없음" /> : (
              <div className="max-h-96 space-y-1 overflow-y-auto text-xs">
                {gov.timeline.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 border-b border-border py-1">
                    <span className="w-40 shrink-0 text-text-tertiary">{t.at}</span>
                    <AdminBadge tone="neutral">{t.stage}</AdminBadge>
                    <span className="text-text-secondary">{t.label}{t.actor ? ` · ${t.actor.slice(0, 8)}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </AdminCard>
        </div>
      )}

      {/* Governance (executive + rules) */}
      {sub === 'governance' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <AdminStatCard label="Availability(avg)" value={exec?.availability == null ? 'INSUF' : `${exec.availability}`} tone="info" />
            <AdminStatCard label="Reliability(avg)" value={exec?.reliability == null ? 'INSUF' : `${exec.reliability}`} tone="info" />
            <AdminStatCard label="Major Incidents" value={num(exec?.majorIncidents)} tone={exec && exec.majorIncidents > 0 ? 'danger' : 'success'} />
            <AdminStatCard label="Open Decisions" value={num(ov?.openDecisions)} tone={ov && ov.openDecisions > 0 ? 'warning' : 'neutral'} />
          </div>
          {exec && (
            <AdminCard title={`Executive Weekly Report (${exec.window})`}>
              {!exec.dataSufficient && <AdminAlert tone="info" title="INSUFFICIENT_DATA">표본 부족 — 일부 지표 보류</AdminAlert>}
              <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-text-secondary">
                <li>Releases Reviewed: {exec.releasesReviewed} · Approvals: {exec.approvals} · Rejected: {exec.rejectedReleases}</li>
                {exec.recommendations.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </AdminCard>
          )}
          {cfg.rulesEnabled && (
            <AdminCard title="Rule Management (threshold / weight / enable · 버전)">
              {!gov || gov.rules.length === 0 ? <AdminEmpty title="NO DATA" description="rule 없음(0462 미적용)" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-text-tertiary"><th className="py-1">Rule</th><th>Threshold</th><th>Weight</th><th>Enabled</th><th>v</th><th></th></tr></thead>
                    <tbody>
                      {gov.rules.map((r) => (
                        <tr key={r.key} className="border-t border-border">
                          <td className="py-1 text-text-primary">{r.label}<span className="text-text-tertiary"> ({r.key})</span></td>
                          <td>{num(r.threshold)}</td><td>{num(r.weight)}</td>
                          <td><AdminBadge tone={r.enabled ? 'success' : 'neutral'}>{r.enabled ? 'ON' : 'OFF'}</AdminBadge></td>
                          <td>{r.version}</td>
                          <td><AdminButton size="sm" variant="outline" disabled={!!busy} onClick={() => void toggleRule(r)}>{r.enabled ? '비활성화' : '활성화'}</AdminButton></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </AdminCard>
          )}
        </div>
      )}

      <p className="text-[11px] text-text-tertiary">
        모든 권고/준비도는 규칙 기반 추정으로 운영자 확인이 필요합니다. 승인/반려/기록은 감사 로그이며 어떤 릴리스/롤백/Player 동작도 자동 실행하지 않습니다.
        신호가 없으면 NO_DATA/NOT_AVAILABLE/INSUFFICIENT_DATA로 표기합니다.
      </p>
    </div>
  );
}
