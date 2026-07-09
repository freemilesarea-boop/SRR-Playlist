// Phase ALGO-7B — 관리자 AI Operations Center (Shadow) 패널.
// Release Manager · Rollback Center(sim) · Policy Manager · Approval Queue · Maintenance · Incident · Operation Timeline.
// Shadow Only — 실제 Release/Rollback/Policy Apply/Approval/운영 변경을 어떤 경우에도 수행하지 않습니다.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Play, Rocket, Undo2, ShieldCheck, CheckSquare, Wrench, AlertTriangle, Clock } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminGenerateReleaseCandidates, adminGenerateRollbackPlan, adminGeneratePolicySnapshot,
  adminGenerateIncidentSummary, adminGenerateOperationTimeline, adminAiOperationsOverview,
  type AiOperationsOverview,
} from '@/lib/aiOperationsApi';

const stageTone = (s: string | null | undefined): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  switch (s) {
    case 'Ready for Canary': return 'success';
    case 'Ready for Review': case 'Release Candidate': return 'warning';
    case 'Shadow Candidate': return 'info';
    case 'Blocked': case 'Rejected': return 'danger';
    default: return 'neutral';
  }
};
const riskTone = (r: string | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' => {
  switch (r) { case 'high': return 'danger'; case 'medium': return 'warning'; case 'low': return 'success'; default: return 'neutral'; }
};
const prioTone = (p: string): 'danger' | 'warning' | 'info' | 'neutral' => {
  switch (p) { case 'Critical': return 'danger'; case 'High': return 'warning'; case 'Medium': return 'info'; default: return 'neutral'; }
};
const stateTone = (s: string): 'success' | 'warning' | 'info' | 'neutral' => {
  switch (s) { case 'Approved': case 'Resolved': return 'success'; case 'Rejected': case 'Expired': return 'neutral'; case 'Investigating': case 'Assigned': return 'warning'; default: return 'info'; }
};

export default function AiOperationsCenterPanel() {
  const [overview, setOverview] = useState<AiOperationsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOverview(await adminAiOperationsOverview()); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0443 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 통합 운영 스냅샷: release → rollback(sim) → policy → incident/maintenance → timeline.
  async function runAll() {
    setBusy(true);
    try {
      const r = await adminGenerateReleaseCandidates(30);
      await adminGenerateRollbackPlan(r.run_id);
      await adminGeneratePolicySnapshot(r.run_id);
      await adminGenerateIncidentSummary(r.run_id);
      await adminGenerateOperationTimeline(r.run_id);
      toast.success(`Operations 스냅샷 갱신 — candidates ${r.candidates} / ready ${r.ready} / pending ${r.approvals_pending} (Shadow)`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const s = overview?.summary;
  const releases = overview?.releases ?? [];
  const rollbacks = overview?.rollbacks ?? [];
  const policies = overview?.policies ?? [];
  const approvals = overview?.approvals ?? [];
  const maintenance = overview?.maintenance ?? [];
  const incidents = overview?.incidents ?? [];
  const timeline = overview?.timeline ?? [];

  return (
    <AdminSection
      title="AI Operations Center (ALGO-7B)"
      description="AI Music OS 의 운영 관제센터 — Release·Rollback·Policy·Approval·Maintenance·Incident 를 Shadow 상태로만 관리합니다. 모든 Release/Rollback 은 시뮬레이션이며, 실제 Queue/Playback/Streaming/Settlement/Prediction/RL/Decision/Governance Runtime 에는 어떠한 변경도 수행하지 않습니다."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<Play size={13} />} disabled={busy} onClick={() => void runAll()}>Operations 스냅샷 갱신</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="운영 관제센터 — 관찰·준비 전용 (Shadow Only)"
        description="component 별 release 후보 stage(Ready for Canary/Review·Shadow·Rejected)와 rollback 계획(Simulation Only), policy 스냅샷/버전/diff, 승인 대기열, 유지보수 창(전부 미실행), 인시던트, append-only 운영 타임라인을 관리합니다. 실제 Release/Rollback/Policy 적용/승인은 수행하지 않으며, 후속 Phase 에서 사용할 운영 절차만 준비합니다." />

      {loading && !overview ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !overview?.has_data ? (
        <AdminEmpty icon={<Rocket size={22} />} title="아직 Operations 스냅샷이 없어요" description="상단 'Operations 스냅샷 갱신'을 누르세요 (release → rollback → policy → incident → timeline, 전부 Shadow)." />
      ) : (
        <div className="space-y-4">
          {/* Overview */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <AdminStatCard label="Release Ready" value={String(s?.release_ready ?? 0)} tone={(s?.release_ready ?? 0) > 0 ? 'success' : 'neutral'} icon={<Rocket size={13} />} />
            <AdminStatCard label="Blocked/Rejected" value={String(s?.release_blocked ?? 0)} tone={(s?.release_blocked ?? 0) > 0 ? 'warning' : 'neutral'} />
            <AdminStatCard label="Rollback Plans" value={String(s?.rollback_plans ?? 0)} tone="info" icon={<Undo2 size={13} />} />
            <AdminStatCard label="Policies" value={String(s?.policies_total ?? 0)} tone="info" icon={<ShieldCheck size={13} />} />
            <AdminStatCard label="Approvals Pending" value={String(s?.approvals_pending ?? 0)} tone={(s?.approvals_pending ?? 0) > 0 ? 'warning' : 'neutral'} icon={<CheckSquare size={13} />} />
            <AdminStatCard label="Incidents" value={String(s?.incidents_total ?? 0)} tone={(s?.incidents_critical ?? 0) > 0 ? 'danger' : (s?.incidents_total ?? 0) > 0 ? 'warning' : 'neutral'} icon={<AlertTriangle size={13} />} />
          </div>
          {s?.headline && <p className="text-[11px] text-ink-dim">{s.headline}</p>}

          {/* Release Manager */}
          <AdminCard title="Release Manager (Shadow)" subtitle="component 별 release 후보 stage · readiness. 실제 release 없음.">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-ink-dim"><tr>
                  <th className="px-2 py-1 text-left">component</th><th className="px-2 py-1 text-left">status</th>
                  <th className="px-2 py-1 text-left">stage</th><th className="px-2 py-1 text-right">readiness</th>
                </tr></thead>
                <tbody>
                  {releases.map((r) => (
                    <tr key={r.component} className="border-t border-line/10">
                      <td className="px-2 py-1 text-ink">{r.component}</td>
                      <td className="px-2 py-1 text-ink-dim">{r.status ?? '—'}</td>
                      <td className="px-2 py-1"><AdminBadge tone={stageTone(r.stage)}>{r.stage ?? '—'}</AdminBadge></td>
                      <td className="px-2 py-1 text-right tabular-nums text-ink">{r.readiness ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AdminCard>

          {/* Rollback + Policy */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Rollback Center (Simulation Only)" subtitle="component 별 rollback 계획 · risk · dependency. 실제 rollback 없음.">
              {rollbacks.length > 0 ? (
                <div className="space-y-1.5">
                  {rollbacks.map((rb) => (
                    <div key={rb.component} className="rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-ink">{rb.component}</span>
                        <AdminBadge tone={riskTone(rb.risk)}>risk {rb.risk ?? '—'}</AdminBadge>
                      </div>
                      <p className="mt-0.5 text-ink-dim">deps: {(rb.dependencies ?? []).join(', ') || 'none'} · steps {Array.isArray(rb.steps) ? rb.steps.length : 0}</p>
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="rollback plan 없음" description="갱신을 실행하세요." />}
            </AdminCard>

            <AdminCard title="Policy Manager (Shadow)" subtitle="도메인별 policy version · checksum. 실제 적용 없음.">
              {policies.length > 0 ? (
                <div className="space-y-1.5">
                  {policies.map((p) => (
                    <div key={p.key} className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <span className="text-ink">{p.key}</span>
                      <span className="flex items-center gap-1.5 text-ink-dim">
                        <AdminBadge tone="info">v{p.version ?? 0}</AdminBadge>
                        <span className="font-mono">{p.checksum ?? '—'}</span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="policy 없음" description="갱신을 실행하세요." />}
            </AdminCard>
          </div>

          {/* Approval + Maintenance */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Approval Queue (Shadow)" subtitle="Pending/Approved/Rejected/Expired. 실제 승인 없음.">
              {approvals.length > 0 ? (
                <div className="space-y-1.5">
                  {approvals.map((a, i) => (
                    <div key={a.subject + i} className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <span className="flex-1 truncate text-ink">{a.subject}</span>
                      <span className="flex items-center gap-1.5">
                        {a.priority && <AdminBadge tone={prioTone(a.priority)}>{a.priority}</AdminBadge>}
                        <AdminBadge tone={stateTone(a.state)}>{a.state}</AdminBadge>
                      </span>
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="승인 대기 없음" description="release ready 후보가 없습니다." />}
            </AdminCard>

            <AdminCard title="Maintenance Center" subtitle="Observation · Freeze · Shadow Maintenance · Emergency Stop — 전부 미실행.">
              {maintenance.length > 0 ? (
                <div className="space-y-1.5">
                  {maintenance.map((m) => (
                    <div key={m.type} className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <span className="flex items-center gap-1.5 text-ink"><Wrench size={11} className="text-ink-dim" />{m.type}</span>
                      <span className="flex items-center gap-1.5">
                        <AdminBadge tone={m.status === 'active' ? 'info' : 'neutral'}>{m.status}</AdminBadge>
                        <AdminBadge tone={m.executed ? 'danger' : 'success'}>{m.executed ? 'executed' : 'no-exec'}</AdminBadge>
                      </span>
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="maintenance 없음" description="갱신을 실행하세요." />}
            </AdminCard>
          </div>

          {/* Incidents */}
          <AdminCard title="Incident Manager (Shadow)" subtitle="Critical/High/Medium/Low · Open/Assigned/Investigating/Resolved.">
            {incidents.length > 0 ? (
              <div className="space-y-1.5">
                {incidents.map((inc, i) => (
                  <div key={inc.type + i} className="rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-ink"><AlertTriangle size={11} className="text-ink-dim" />{inc.component ?? inc.type}</span>
                      <span className="flex items-center gap-1.5">
                        <AdminBadge tone={prioTone(inc.priority)}>{inc.priority}</AdminBadge>
                        <AdminBadge tone={stateTone(inc.state)}>{inc.state}</AdminBadge>
                      </span>
                    </div>
                    {inc.summary && <p className="mt-0.5 text-ink-dim">{inc.summary}</p>}
                  </div>
                ))}
              </div>
            ) : <AdminEmpty title="incident 없음" description="모든 component 정상 관측." />}
          </AdminCard>

          {/* Operation Timeline */}
          <AdminCard title="Operation Timeline (Append Only)" subtitle="Release·Rollback·Policy·Approval·Incident·Maintenance 기록 — 수정/삭제 불가.">
            {timeline.length > 0 ? (
              <div className="space-y-1">
                {timeline.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-line/10 px-2.5 py-1 text-[11px]">
                    <Clock size={10} className="shrink-0 text-ink-dim" />
                    <AdminBadge tone="neutral">{t.category ?? '—'}</AdminBadge>
                    <span className="flex-1 truncate text-ink">{t.event}</span>
                    {t.detail && <span className="shrink-0 truncate text-ink-dim">{t.detail}</span>}
                  </div>
                ))}
              </div>
            ) : <AdminEmpty title="timeline 없음" description="갱신을 실행하세요." />}
          </AdminCard>
        </div>
      )}
    </AdminSection>
  );
}
