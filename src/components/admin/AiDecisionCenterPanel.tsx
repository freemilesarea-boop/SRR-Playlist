// Phase ALGO-6A — 관리자 AI Decision Center (Unified Decision Layer, Shadow) 패널.
// 6 sub-score 통합 Unified Decision Score · Explain · Risk · Candidate · Canary · Human Approval 관측.
// 운영 미반영 — Canary/Approval 은 계획·요청만이며 자동 적용/트래픽 분배가 없습니다(applied=false).
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Cpu, GitBranch, ShieldCheck, Rocket, Info } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminGenerateUnifiedDecision, adminGenerateDecisionCandidates, adminGenerateCanaryPlan,
  adminAiDecisionOverview, type DecisionOverview,
} from '@/lib/decisionApi';

const numf = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(3));

const stateTone = (s: string | null): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  switch (s) {
    case 'strong': return 'success';
    case 'moderate': return 'info';
    case 'weak': return 'warning';
    case 'poor': return 'neutral';
    default: return 'neutral';
  }
};
export default function AiDecisionCenterPanel() {
  const [overview, setOverview] = useState<DecisionOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOverview(await adminAiDecisionOverview()); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0436 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 통합 파이프라인: Unified Decision → Candidates → Canary Plan + Approval 요청.
  async function runPipeline() {
    setBusy(true);
    try {
      const d = await adminGenerateUnifiedDecision(120, 200);
      const c = await adminGenerateDecisionCandidates(null);
      const k = await adminGenerateCanaryPlan(null, 20);
      toast.success(`Decision 파이프라인 완료 — ${d.tracks}곡 · 승인후보 ${c.breakdown?.approved ?? 0} · canary ${k.canary_plans} · 승인요청 ${k.approval_requests}`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const s = overview?.summary;
  const cand = overview?.candidates ?? {};
  const risk = overview?.risk_levels ?? {};
  const top = overview?.top ?? [];

  return (
    <AdminSection
      title="AI Decision Center (Unified, Shadow)"
      description="ALGO-4~5B 의 모든 AI 결과(Prediction/Exposure/Reward/Bandit/Calibration/Ensemble)를 하나의 Unified Decision Score 로 통합하고 Explain·Risk·Candidate·Canary·Human Approval 까지 산출합니다. 실제 Queue/Playback/Scheduler/Exposure/Prediction/RL/Settlement/Streaming 에 반영하지 않습니다. (ALGO-6A)"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<Cpu size={13} />} disabled={busy} onClick={() => void runPipeline()}>Decision 파이프라인 실행</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="Unified Decision — Shadow only, 자동 적용 없음"
        description="Unified Score = Σ(weight × 6 sub-score) × confidence-gate × (1 − risk-penalty). Candidate 는 approved/shadow/blocked/needs_review 상태 분류만 하고, Canary(10/25/50/100%)와 Human Approval 은 계획·요청만 생성합니다(applied=false, auto_apply=false). 실제 트래픽 분배·운영 반영은 없습니다." />

      {loading && !overview ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !overview?.has_data ? (
        <AdminEmpty icon={<Cpu size={22} />} title="아직 Decision 데이터가 없어요" description="상단 'Decision 파이프라인 실행'을 누르세요 (Unified Decision → Candidate → Canary, 전부 Shadow)." />
      ) : (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <AdminStatCard label="Avg Decision Score" value={numf(s?.avg_score)} tone={((s?.avg_score ?? 0) >= 0.4) ? 'success' : 'warning'} />
            <AdminStatCard label="Avg Confidence" value={numf(s?.avg_confidence)} tone="info" />
            <AdminStatCard label="Avg Risk" value={numf(s?.avg_risk)} tone={((s?.avg_risk ?? 1) <= 0.25) ? 'success' : 'warning'} />
            <AdminStatCard label="Scored Tracks" value={String(s?.tracks ?? 0)} tone="neutral" />
          </div>

          {/* Candidate + Risk breakdown + Canary/Approval */}
          <div className="grid gap-3 lg:grid-cols-3">
            <AdminCard title="Decision Candidates" subtitle="상태 분류만 — 자동 적용 없음.">
              <div className="grid grid-cols-2 gap-2">
                <AdminStatCard label="Approved" value={String(cand.approved ?? 0)} tone="success" />
                <AdminStatCard label="Shadow" value={String(cand.shadow ?? 0)} tone="info" />
                <AdminStatCard label="Needs Review" value={String(cand.needs_review ?? 0)} tone="warning" />
                <AdminStatCard label="Blocked" value={String(cand.blocked ?? 0)} tone="danger" />
              </div>
            </AdminCard>

            <AdminCard title="Risk Levels" subtitle="cold_start / uncertainty / drift 기반.">
              <div className="grid grid-cols-3 gap-2">
                <AdminStatCard label="Low" value={String(risk.low ?? 0)} tone="success" />
                <AdminStatCard label="Medium" value={String(risk.medium ?? 0)} tone="warning" />
                <AdminStatCard label="High" value={String(risk.high ?? 0)} tone="danger" />
              </div>
            </AdminCard>

            <AdminCard title="Canary & Approval" subtitle="계획·요청만 — applied/auto_apply=0.">
              <div className="grid grid-cols-2 gap-2">
                <AdminStatCard label="Canary Plans" value={String(overview?.canary?.plans ?? 0)} icon={<Rocket size={13} />} tone="info" />
                <AdminStatCard label="Stages" value={String(overview?.canary?.stages ?? 0)} tone="neutral" />
                <AdminStatCard label="Approval Reqs" value={String(overview?.approvals?.requested ?? 0)} icon={<ShieldCheck size={13} />} tone="warning" />
                <AdminStatCard label="Applied" value={String(overview?.canary?.applied ?? 0)} tone={(overview?.canary?.applied ?? 0) === 0 ? 'success' : 'danger'} />
              </div>
            </AdminCard>
          </div>

          {/* Top unified decisions + explain */}
          <AdminCard title="Top Unified Decisions + Explanation" subtitle="Unified Score 상위 곡의 6 sub-score 기여 + top factor. 계산만.">
            {top.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">#</th><th className="px-2 py-1 text-left">track</th>
                    <th className="px-2 py-1 text-right">score</th><th className="px-2 py-1 text-left">state</th>
                    <th className="px-2 py-1 text-right">pred</th><th className="px-2 py-1 text-right">reward</th>
                    <th className="px-2 py-1 text-right">expo</th><th className="px-2 py-1 text-right">bandit</th>
                    <th className="px-2 py-1 text-right">ens</th><th className="px-2 py-1 text-right">calib</th>
                    <th className="px-2 py-1 text-right">conf</th><th className="px-2 py-1 text-right">risk</th>
                    <th className="px-2 py-1 text-left">top factor</th>
                  </tr></thead>
                  <tbody>
                    {top.map((t, i) => (
                      <tr key={t.track_id} className="border-t border-line/10">
                        <td className="px-2 py-1 text-ink-dim">{i + 1}</td>
                        <td className="px-2 py-1 font-mono text-ink-dim">{t.track_id.slice(0, 8)}…</td>
                        <td className="px-2 py-1 text-right tabular-nums font-medium text-ink">{numf(t.score)}</td>
                        <td className="px-2 py-1"><AdminBadge tone={stateTone(t.state)}>{t.state ?? '—'}</AdminBadge></td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(t.prediction)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(t.reward)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(t.exposure)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(t.bandit)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(t.ensemble)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(t.calibration)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(t.confidence)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(t.risk)}</td>
                        <td className="px-2 py-1"><AdminBadge tone="neutral" icon={<Info size={9} />}>{t.top_factor ?? '—'}</AdminBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <AdminEmpty icon={<GitBranch size={20} />} title="decision 없음" description="파이프라인을 실행하세요." />}
          </AdminCard>
        </div>
      )}
    </AdminSection>
  );
}
