// Phase ALGO-4C — 관리자 Prediction Calibration & Adaptive Learning (Shadow) 패널.
// Prediction Gap 학습 · Adaptive Weight · Exposure Simulation · Queue Calibration ·
// Counterfactual Simulation 관측. prediction/exposure/queue 실반영 없음.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Brain, Play, GitCompare, Scale } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminRunPredictionCalibration, adminGenerateAdaptiveWeights, adminSimulateAdaptiveExposure,
  adminValidateQueueCalibration, adminGenerateCounterfactualSimulations, adminPredictionCalibrationOverview,
  type CalibrationOverview,
} from '@/lib/calibrationApi';

const scoref = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(3));
const statusTone = (s: string | null | undefined): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  switch (s) {
    case 'stable': return 'success';
    case 'overestimated': case 'unstable': return 'warning';
    case 'underestimated': return 'info';
    case 'cold_start': return 'neutral';
    default: return 'neutral';
  }
};

export default function PredictionCalibrationPanel() {
  const [overview, setOverview] = useState<CalibrationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [storeId, setStoreId] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOverview(await adminPredictionCalibrationOverview(null)); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0433 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function runFullCalibration() {
    setBusy(true);
    try {
      const c = await adminRunPredictionCalibration(null);
      await adminGenerateAdaptiveWeights(null);
      await adminSimulateAdaptiveExposure(null);
      await adminGenerateCounterfactualSimulations(null, 20);
      toast.success(`Calibration 완료 — ${c.item_count ?? 0}곡 · ${c.overall_status ?? '—'}`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  async function runQueueCalibration() {
    if (!storeId.trim()) { toast.error('store_id 를 입력하세요'); return; }
    setBusy(true);
    try {
      const q = await adminValidateQueueCalibration(storeId.trim());
      toast.success(`Queue Calibration — overlap ${q.overlap_count}/${q.twin_size} · NDCG ${scoref(q.ndcg)}`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const run = overview?.run;
  const w = overview?.adaptive_weights;
  const sb = overview?.status_breakdown;

  return (
    <AdminSection
      title="Prediction Calibration (Shadow)"
      description="AI 가 Prediction 오차를 학습하여 Adaptive Weight/Exposure 를 자동 보정하는 Calibration Layer 입니다. 실제 Queue/Playback/Scheduler/Exposure/Prediction/Settlement 에 반영하지 않습니다. (ALGO-4C)"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<Brain size={13} />} disabled={busy} onClick={() => void runFullCalibration()}>Calibration 실행</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="Shadow Calibration — 실반영 없음"
        description="Calibration Score = 1 − |absolute_error|. Adaptive Weight 는 오차 큰 요소의 신뢰도를 낮춰 재정규화합니다(계산만). Self-Calibration: Stable / Overestimated / Underestimated / Needs More Samples / Cold Start. 실제 Prediction/Exposure/Queue 는 그대로입니다." />

      {loading && !overview ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !overview?.has_data ? (
        <AdminEmpty icon={<Brain size={22} />} title="아직 Calibration 이 없어요" description="상단 'Calibration 실행'을 누르세요 (shadow 학습). 먼저 AI Prediction 탭에서 Prediction 을 생성하세요." />
      ) : (
        <div className="space-y-4">
          {/* Accuracy overview */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <AdminStatCard label="Calibration Score" value={scoref(run?.avg_calibration_score)} tone={((run?.avg_calibration_score ?? 0) >= 0.8) ? 'success' : 'warning'} />
            <AdminStatCard label="Avg |Error|" value={scoref(run?.avg_absolute_error)} tone={((run?.avg_absolute_error ?? 0) <= 0.1) ? 'success' : 'warning'} />
            <AdminStatCard label="Bias" value={scoref(run?.avg_bias_score)} tone={Math.abs(run?.avg_bias_score ?? 0) < 0.05 ? 'neutral' : 'warning'} />
            <AdminStatCard label="Overall" value={run?.overall_status ?? '—'} tone={statusTone(run?.overall_status)} />
          </div>

          {/* Self-calibration status breakdown */}
          {sb && (
            <AdminCard title="Self-Calibration Status" subtitle="AI 자동 판단: 안정 / 과대·과소평가 / 표본부족 / Cold Start.">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <AdminStatCard label="Stable" value={String(sb.stable)} tone="success" />
                <AdminStatCard label="Overestimated" value={String(sb.overestimated)} tone="warning" />
                <AdminStatCard label="Underestimated" value={String(sb.underestimated)} tone="info" />
                <AdminStatCard label="Needs Samples" value={String(sb.needs_more_samples)} tone="neutral" />
                <AdminStatCard label="Cold Start" value={String(sb.cold_start)} tone="neutral" />
              </div>
            </AdminCard>
          )}

          {/* Adaptive weights */}
          {w && (
            <AdminCard title="Adaptive Prediction Weights" subtitle="오차 기반 재가중(정규화). 계산만 — 실제 Prediction Score 미반영.">
              <div className="space-y-1.5">
                {([
                  ['completion', w.adaptive_completion_weight, w.err_completion],
                  ['skip', w.adaptive_skip_weight, w.err_skip],
                  ['learning(eligible)', w.adaptive_learning_weight, w.err_eligible],
                  ['revenue', w.adaptive_revenue_weight, w.err_revenue],
                  ['confidence', w.adaptive_confidence_weight, null],
                ] as Array<[string, number, number | null]>).map(([label, weight, e]) => (
                  <div key={label} className="flex items-center gap-2 text-[11px]">
                    <span className="w-32 shrink-0 text-ink-dim">{label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-line/15">
                      <div className="h-full rounded-full bg-accent/70" style={{ width: `${Math.min(weight * 100, 100)}%` }} />
                    </div>
                    <span className="w-14 shrink-0 text-right tabular-nums text-ink">{scoref(weight)}</span>
                    <span className="w-20 shrink-0 text-right text-ink-dim">{e == null ? '' : `err ${scoref(e)}`}</span>
                  </div>
                ))}
              </div>
            </AdminCard>
          )}

          {/* Exposure simulation + Queue calibration */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Adaptive Exposure Simulation" subtitle="current vs adaptive exposure. shadow 계산.">
              {overview.exposure_sim && overview.exposure_sim.count > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  <AdminStatCard label="Simulated" value={String(overview.exposure_sim.count)} />
                  <AdminStatCard label="Improved" value={String(overview.exposure_sim.improved)} tone="success" />
                  <AdminStatCard label="Avg Δ" value={scoref(overview.exposure_sim.avg_delta)} tone={overview.exposure_sim.avg_delta >= 0 ? 'success' : 'warning'} />
                </div>
              ) : <AdminEmpty title="시뮬레이션 데이터 없음" description="exposure_score 와 겹치는 트랙 필요." />}
            </AdminCard>

            <AdminCard title="Queue Calibration" subtitle="Digital Twin vs Shadow Queue 랭킹 지표.">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <input className="rounded-lg border border-line/25 bg-bg px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent/50" style={{ width: 220 }} value={storeId} onChange={(e) => setStoreId(e.target.value)} placeholder="store_id (uuid)" />
                <AdminButton size="sm" tone="primary" variant="subtle" leftIcon={<Play size={12} />} disabled={busy} onClick={() => void runQueueCalibration()}>Queue Calibrate</AdminButton>
              </div>
              {overview.queue_calibration && overview.queue_calibration.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead className="text-ink-dim"><tr>
                      <th className="px-2 py-1 text-left">store</th><th className="px-2 py-1 text-right">overlap</th>
                      <th className="px-2 py-1 text-right">spearman</th><th className="px-2 py-1 text-right">MRR</th>
                      <th className="px-2 py-1 text-right">NDCG</th><th className="px-2 py-1 text-right">posΔ</th>
                    </tr></thead>
                    <tbody>
                      {overview.queue_calibration.map((q) => (
                        <tr key={q.id} className="border-t border-line/10">
                          <td className="px-2 py-1 font-mono text-ink-dim">{(q.store_id ?? '—').slice(0, 8)}…</td>
                          <td className="px-2 py-1 text-right">{q.overlap_count}/{q.twin_size}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{q.spearman_rank == null ? '—' : scoref(q.spearman_rank)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{scoref(q.mrr)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{scoref(q.ndcg)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{scoref(q.position_error)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-[11px] text-ink-dim">아직 queue calibration 이 없습니다. store_id 로 실행하세요.</p>}
            </AdminCard>
          </div>

          {/* Worst items */}
          {overview.worst_items && overview.worst_items.length > 0 && (
            <AdminCard title="가장 오차 큰 트랙" subtitle="absolute_error 상위 — 재학습 우선 대상.">
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">track</th><th className="px-2 py-1 text-right">abs err</th>
                    <th className="px-2 py-1 text-right">bias</th><th className="px-2 py-1 text-right">calibration</th>
                    <th className="px-2 py-1 text-left">status</th>
                  </tr></thead>
                  <tbody>
                    {overview.worst_items.map((it, i) => (
                      <tr key={(it.track_id ?? '') + i} className="border-t border-line/10">
                        <td className="px-2 py-1 font-mono text-ink-dim">{(it.track_id ?? '—').slice(0, 8)}…</td>
                        <td className="px-2 py-1 text-right tabular-nums">{scoref(it.abs_error)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{scoref(it.bias)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{scoref(it.calibration)}</td>
                        <td className="px-2 py-1"><AdminBadge tone={statusTone(it.status)}>{it.status}</AdminBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AdminCard>
          )}

          {/* Counterfactual simulations */}
          {overview.counterfactuals && overview.counterfactuals.length > 0 && (
            <AdminCard title="Counterfactual Simulation (What-if)" subtitle="완성도/스킵/신뢰도/매출 변화 시 Prediction Score 델타. shadow only.">
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">track</th><th className="px-2 py-1 text-left">scenario</th>
                    <th className="px-2 py-1 text-right">base</th><th className="px-2 py-1 text-right">sim</th><th className="px-2 py-1 text-right">Δ</th>
                  </tr></thead>
                  <tbody>
                    {overview.counterfactuals.map((c, i) => (
                      <tr key={(c.track_id ?? '') + c.scenario + i} className="border-t border-line/10">
                        <td className="px-2 py-1 font-mono text-ink-dim">{(c.track_id ?? '—').slice(0, 8)}…</td>
                        <td className="px-2 py-1"><span className="inline-flex items-center gap-1"><GitCompare size={10} className="text-ink-dim" />{c.scenario}</span></td>
                        <td className="px-2 py-1 text-right tabular-nums">{scoref(c.base)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink">{scoref(c.sim)}</td>
                        <td className="px-2 py-1 text-right"><AdminBadge tone={c.delta > 0 ? 'success' : c.delta < 0 ? 'warning' : 'neutral'}>{c.delta > 0 ? '+' : ''}{scoref(c.delta)}</AdminBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 flex items-center gap-1 text-[10px] text-ink-dim"><Scale size={11} /> 실제 Prediction/Exposure 에는 반영되지 않는 가정 시뮬레이션입니다.</p>
            </AdminCard>
          )}
        </div>
      )}
    </AdminSection>
  );
}
