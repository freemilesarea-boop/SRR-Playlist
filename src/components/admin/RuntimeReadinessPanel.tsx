// Phase ALGO-8A — 관리자 Runtime Fix Readiness & Safe Apply Plan (Shadow) 패널 — Runtime Readiness Layer.
// Runtime Changes · Dependency Graph · Safe Apply Plan · Rollback Readiness · Success/Failure Criteria · Checklist.
// Shadow Only — 실제 Runtime(Queue/Playback/Scheduler/Streaming/Settlement/...) 수정을 어떤 경우에도 수행하지 않습니다.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Play, Wrench, GitBranch, ListChecks, Undo2, Target, ShieldAlert, ClipboardCheck } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminGenerateRuntimePlan, adminGenerateDependencyGraph, adminGenerateSafeApplyPlan,
  adminGenerateRuntimeChecklist, adminRuntimeReadinessOverview, type RuntimeReadinessOverview,
} from '@/lib/runtimeReadinessApi';

const riskTone = (r: string | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' => {
  switch (r) { case 'high': return 'danger'; case 'medium': return 'warning'; case 'low': return 'success'; default: return 'neutral'; }
};
const impactTone = (l: string | null | undefined): 'danger' | 'warning' | 'neutral' => {
  switch (l) { case 'high': return 'danger'; case 'medium': return 'warning'; default: return 'neutral'; }
};
const gateTone = (g: string | null | undefined): 'success' | 'warning' | 'neutral' => {
  switch (g) { case 'available': return 'success'; case 'blocked': return 'warning'; default: return 'neutral'; }
};
const statusTone = (s: string | null | undefined): 'success' | 'warning' | 'neutral' => {
  switch (s) { case 'ready': return 'success'; case 'pending': return 'warning'; default: return 'neutral'; }
};

export default function RuntimeReadinessPanel() {
  const [ov, setOv] = useState<RuntimeReadinessOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOv(await adminRuntimeReadinessOverview()); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0446 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Runtime Readiness 파이프라인: plan → dependency → apply plan → checklist(report finalize).
  async function runAll() {
    setBusy(true);
    try {
      const p = await adminGenerateRuntimePlan(30);
      await adminGenerateDependencyGraph(p.run_id);
      await adminGenerateSafeApplyPlan(p.run_id);
      const c = await adminGenerateRuntimeChecklist(p.run_id);
      toast.success(`Runtime Readiness 갱신 — ${c.overall_readiness} · checklist ${c.checklist_ready}/${c.checklist_total} (Shadow, 실제 적용 없음)`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const r = ov?.report;
  const changes = ov?.changes ?? [];
  const dependency = ov?.dependency ?? [];
  const applyPlan = ov?.apply_plan ?? [];
  const success = ov?.success ?? [];
  const failure = ov?.failure ?? [];
  const checklist = ov?.checklist ?? [];
  const rollback = ov?.rollback ?? [];

  return (
    <AdminSection
      title="Runtime Fix Readiness & Safe Apply Plan (ALGO-8A)"
      description="AI Music OS 의 Runtime Readiness Layer — ALGO-2E~7D 에서 확인된 Shadow 병목과 Release Governance 결과를 기반으로, 실제 Runtime 변경 전 필요한 Apply Plan·Dependency 분석·성공/실패 기준·Rollback 준비 상태만 수립합니다. 실제 Runtime(Queue/Playback/Scheduler/Streaming/Settlement/Prediction/RL/Decision/Governance) 수정은 절대 수행하지 않습니다."
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<Play size={13} />} disabled={busy} onClick={() => void runAll()}>Readiness 갱신</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="Runtime Readiness — 계획·준비 전용 (Shadow Only)"
        description="변경 후보(verified_seconds back-fill·session identity 정규화·verification timing 등)를 정의하고, 파이프라인 의존성 영향, Stage 0~5 Safe Apply Plan(Stage 2+ 는 후속 Phase 대상·미실행), 성공/실패 기준, Rollback 준비도, Readiness Checklist 를 생성합니다. 어떤 변경도 실제 Runtime 에 적용되지 않으며, human approval·governance·certificate 확보 전까지 not_ready 로 정직하게 표시됩니다." />

      {loading && !ov ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !ov?.has_data ? (
        <AdminEmpty icon={<Wrench size={22} />} title="아직 Runtime Readiness 가 없어요" description="상단 'Readiness 갱신'을 누르세요 (plan → dependency → apply plan → checklist, 전부 Shadow)." />
      ) : (
        <div className="space-y-4">
          {/* Report overview */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <AdminStatCard label="Overall Readiness" value={r?.overall_readiness ?? '—'} tone={r?.overall_readiness === 'ready' ? 'success' : 'warning'} icon={<ClipboardCheck size={13} />} />
            <AdminStatCard label="Score" value={r?.readiness_score != null ? String(r.readiness_score) : '—'} tone={(r?.readiness_score ?? 0) >= 80 ? 'success' : (r?.readiness_score ?? 0) >= 50 ? 'warning' : 'danger'} />
            <AdminStatCard label="Changes" value={String(r?.changes_total ?? 0)} tone="info" icon={<Wrench size={13} />} />
            <AdminStatCard label="Success Met" value={`${r?.success_criteria_met ?? 0}/${r?.success_criteria_total ?? 0}`} tone={(r?.success_criteria_met ?? 0) === (r?.success_criteria_total ?? 0) && (r?.success_criteria_total ?? 0) > 0 ? 'success' : 'warning'} icon={<Target size={13} />} />
            <AdminStatCard label="Checklist" value={`${r?.checklist_ready ?? 0}/${r?.checklist_total ?? 0}`} tone={(r?.checklist_ready ?? 0) === (r?.checklist_total ?? 0) && (r?.checklist_total ?? 0) > 0 ? 'success' : 'warning'} />
            <AdminStatCard label="Blocked Stages" value={String(r?.blocked_count ?? 0)} tone={(r?.blocked_count ?? 0) > 0 ? 'warning' : 'neutral'} />
          </div>
          {r?.recommendation && <p className="text-[11px] text-ink-dim">권고: {r.recommendation}{r.hash ? ` · cert ${r.hash}` : ''}</p>}

          {/* Runtime Changes */}
          <AdminCard title="Runtime Change Planner" subtitle="Shadow 병목 해소 변경 후보 (정의만 — 실제 수정 없음).">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-ink-dim"><tr>
                  <th className="px-2 py-1 text-left">change</th><th className="px-2 py-1 text-left">area</th>
                  <th className="px-2 py-1 text-left">current → target</th><th className="px-2 py-1 text-right">impact</th>
                  <th className="px-2 py-1 text-center">risk</th>
                </tr></thead>
                <tbody>
                  {changes.map((c) => (
                    <tr key={c.key} className="border-t border-line/10">
                      <td className="px-2 py-1 text-ink">{c.title ?? c.key}</td>
                      <td className="px-2 py-1 text-ink-dim">{c.area ?? '—'}</td>
                      <td className="px-2 py-1 text-ink-dim"><span className="text-ink">{c.current}</span> → {c.target}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-ink">{c.impact ?? '—'}</td>
                      <td className="px-2 py-1 text-center"><AdminBadge tone={riskTone(c.risk)}>{c.risk ?? '—'}</AdminBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AdminCard>

          {/* Dependency Graph + Apply Plan */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Runtime Dependency Graph" subtitle="Playback → Streaming → … → Decision 영향 분석.">
              <div className="space-y-1">
                {dependency.map((d) => (
                  <div key={d.order} className="flex items-center gap-2 rounded-lg border border-line/10 px-2.5 py-1 text-[11px]">
                    <GitBranch size={11} className="shrink-0 text-ink-dim" />
                    <span className="text-ink">{d.from} → {d.to}</span>
                    {d.change && <span className="flex-1 truncate text-ink-dim">{d.change}</span>}
                    {!d.change && <span className="flex-1" />}
                    <AdminBadge tone={d.affected ? impactTone(d.impact) : 'neutral'}>{d.affected ? d.impact : 'propagate'}</AdminBadge>
                  </div>
                ))}
              </div>
            </AdminCard>

            <AdminCard title="Safe Apply Plan (Stage 0~5)" subtitle="Stage 2+ 는 후속 Phase 대상 · 전부 미실행.">
              <div className="space-y-1">
                {applyPlan.map((st) => (
                  <div key={st.num} className="flex items-center gap-2 rounded-lg border border-line/10 px-2.5 py-1 text-[11px]">
                    <span className="shrink-0 rounded bg-line/10 px-1.5 py-0.5 text-ink-dim tabular-nums">S{st.num}</span>
                    <span className="flex-1 truncate text-ink">{st.name}</span>
                    <AdminBadge tone={gateTone(st.gate)}>{st.gate ?? '—'}</AdminBadge>
                    <AdminBadge tone={st.executed ? 'danger' : 'neutral'}>{st.executed ? 'executed' : 'no-exec'}</AdminBadge>
                  </div>
                ))}
              </div>
            </AdminCard>
          </div>

          {/* Success + Failure Criteria */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Success Criteria" subtitle="적용 성공 기준 — 현재값은 실 baseline 에서 계산.">
              <div className="space-y-1">
                {success.map((sc, i) => (
                  <div key={sc.criterion + i} className="flex items-center gap-2 rounded-lg border border-line/10 px-2.5 py-1 text-[11px]">
                    <Target size={11} className="shrink-0 text-ink-dim" />
                    <span className="flex-1 truncate text-ink">{sc.criterion}</span>
                    <span className="text-ink-dim tabular-nums">{sc.current ?? '—'} {sc.comparator} {sc.target ?? '—'}</span>
                    <AdminBadge tone={sc.met ? 'success' : 'warning'}>{sc.met ? 'met' : 'unmet'}</AdminBadge>
                  </div>
                ))}
              </div>
            </AdminCard>

            <AdminCard title="Failure Criteria (자동 차단 기준 — 정의만)" subtitle="실제 차단 없음.">
              <div className="space-y-1">
                {failure.map((fc, i) => (
                  <div key={fc.criterion + i} className="flex items-center gap-2 rounded-lg border border-line/10 px-2.5 py-1 text-[11px]">
                    <ShieldAlert size={11} className="shrink-0 text-ink-dim" />
                    <span className="flex-1 truncate text-ink">{fc.criterion}</span>
                    <span className="text-ink-dim">{fc.direction} {fc.threshold != null ? `≥ ${fc.threshold}` : ''}</span>
                    {fc.auto_block && <AdminBadge tone="neutral">auto-block(plan)</AdminBadge>}
                  </div>
                ))}
              </div>
            </AdminCard>
          </div>

          {/* Rollback Readiness + Checklist */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Rollback Readiness (Simulation Only)" subtitle="변경별 rollback 준비 상태 · owner · 소요시간.">
              {rollback.length > 0 ? (
                <div className="space-y-1.5">
                  {rollback.map((rb) => (
                    <div key={rb.change} className="rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-ink"><Undo2 size={11} className="text-ink-dim" />{rb.change}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-ink-dim">{rb.owner} · {rb.duration}</span>
                          <AdminBadge tone={rb.ready ? 'success' : 'warning'}>{rb.ready ? 'ready' : 'pending'}</AdminBadge>
                        </span>
                      </div>
                      <p className="mt-0.5 text-ink-dim">{rb.verification}</p>
                    </div>
                  ))}
                </div>
              ) : <AdminEmpty title="rollback readiness 없음" description="갱신을 실행하세요." />}
            </AdminCard>

            <AdminCard title="Readiness Checklist" subtitle="운영 적용 전 필수 항목.">
              <div className="space-y-1">
                {checklist.map((k, i) => (
                  <div key={k.item + i} className="flex items-center gap-2 rounded-lg border border-line/10 px-2.5 py-1 text-[11px]">
                    <ListChecks size={11} className="shrink-0 text-ink-dim" />
                    <span className="flex-1 truncate text-ink">{k.item}</span>
                    {k.required && <AdminBadge tone="neutral">required</AdminBadge>}
                    <AdminBadge tone={statusTone(k.status)}>{k.status}</AdminBadge>
                  </div>
                ))}
              </div>
            </AdminCard>
          </div>
        </div>
      )}
    </AdminSection>
  );
}
