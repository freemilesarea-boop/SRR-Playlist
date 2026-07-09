// Phase ALGO-4B — 관리자 Prediction Engine & Digital Twin Queue (Shadow) 패널.
// 재생 전 성과 예측 + Digital Twin Queue vs baseline 비교 + Counterfactual 관측.
// 실제 Queue/Playback/Scheduler/Exposure Score 무변경. Shadow/Digital Twin 전용.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Sparkles, Play, GitCompare } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminGenerateTrackPredictions, adminPredictionOverview, adminGenerateDigitalTwinQueue,
  adminValidateShadowQueue, adminGetCounterfactual,
  type PredictionOverview, type Counterfactual,
} from '@/lib/predictionApi';

const pctf = (n: number | null | undefined) => (n == null ? '—' : `${(n * 100).toFixed(0)}%`);
const scoref = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(3));

export default function PredictionPanel() {
  const [overview, setOverview] = useState<PredictionOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [storeId, setStoreId] = useState('');
  const [cf, setCf] = useState<Counterfactual | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOverview(await adminPredictionOverview(null)); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0432 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function generate() {
    setBusy(true);
    try {
      const r = await adminGenerateTrackPredictions(null, 100);
      toast.success(`Prediction 생성 — ${r.track_count}곡 (learning ${r.learning_run_id ? 'O' : 'X'})`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  async function twinAndValidate() {
    if (!storeId.trim()) { toast.error('store_id 를 입력하세요'); return; }
    setBusy(true);
    try {
      const t = await adminGenerateDigitalTwinQueue(storeId.trim(), 20);
      const v = await adminValidateShadowQueue(storeId.trim());
      toast.success(`Twin ${t.queue_size}곡 · overlap ${(v.overlap_rate * 100).toFixed(0)}% (baseline ${v.baseline_size})`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  async function explainTopVsBottom() {
    const top = overview?.top;
    if (!top || top.length < 2) { toast.error('예측 후보가 부족합니다'); return; }
    setBusy(true);
    try { setCf(await adminGetCounterfactual(top[0].track_id, top[top.length - 1].track_id)); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const run = overview?.run;

  return (
    <AdminSection
      title="AI Prediction & Digital Twin (Shadow)"
      description="재생 전에 곡 성과를 예측하고 Digital Twin Queue 를 기존 Shadow Queue 와 비교 검증합니다. 실제 Queue/Playback/Scheduler/Exposure Score 는 변경되지 않습니다. (ALGO-4B)"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<Sparkles size={13} />} disabled={busy} onClick={() => void generate()}>Prediction 생성</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="Shadow / Digital Twin — 실제 Queue 미반영"
        description="Prediction Score = completion*0.35 + (1-skip)*0.25 + eligible*0.20 + revenue_weight*0.10 + confidence*0.10. Digital Twin Queue 는 예측 기반 shadow 이며 실제 재생 순서·Scheduler·Playback·Settlement·Streaming 은 그대로입니다." />

      {loading && !overview ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !overview?.has_data ? (
        <AdminEmpty icon={<Sparkles size={22} />} title="아직 Prediction 이 없어요" description="상단 'Prediction 생성'을 실행하세요 (shadow 예측)." />
      ) : (
        <div className="space-y-4">
          {/* Run overview */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <AdminStatCard label="Predictions" value={String(run?.track_count ?? 0)} tone="info" />
            <AdminStatCard label="Learning linked" value={run?.learning_run_id ? 'O' : 'X'} tone={run?.learning_run_id ? 'success' : 'neutral'} />
            <AdminStatCard label="Learning src" value={String(overview.source_breakdown?.learning ?? 0)} />
            <AdminStatCard label="Fallback src" value={String(overview.source_breakdown?.historical_fallback ?? 0)} />
          </div>

          {/* Digital Twin + validation controls */}
          <AdminCard title="Digital Twin Queue & Validation" subtitle="store_id 입력 후 Twin Queue 생성 + 기존 exposure_shadow_queue 와 비교.">
            <div className="flex flex-wrap items-center gap-2">
              <input className="rounded-lg border border-line/25 bg-bg px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent/50" style={{ width: 260 }} value={storeId} onChange={(e) => setStoreId(e.target.value)} placeholder="store_id (uuid)" />
              <AdminButton size="sm" tone="primary" variant="subtle" leftIcon={<Play size={12} />} disabled={busy} onClick={() => void twinAndValidate()}>Twin + Validate</AdminButton>
              <AdminButton size="sm" tone="neutral" variant="subtle" leftIcon={<GitCompare size={12} />} disabled={busy} onClick={() => void explainTopVsBottom()}>Counterfactual (top↔bottom)</AdminButton>
            </div>
            {overview.validations && overview.validations.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">store</th>
                    <th className="px-2 py-1 text-right">twin</th><th className="px-2 py-1 text-right">base</th>
                    <th className="px-2 py-1 text-right">overlap</th><th className="px-2 py-1 text-right">Δcompl</th>
                    <th className="px-2 py-1 text-right">Δskip</th><th className="px-2 py-1 text-right">Δdiversity</th><th className="px-2 py-1 text-right">Δfresh</th>
                  </tr></thead>
                  <tbody>
                    {overview.validations.map((v) => (
                      <tr key={v.validation_run_id} className="border-t border-line/10">
                        <td className="px-2 py-1 font-mono text-ink-dim">{(v.store_id ?? '—').slice(0, 8)}…</td>
                        <td className="px-2 py-1 text-right">{v.twin_size}</td>
                        <td className="px-2 py-1 text-right">{v.baseline_size}</td>
                        <td className="px-2 py-1 text-right"><AdminBadge tone={v.overlap_rate >= 0.5 ? 'success' : v.overlap_rate > 0 ? 'info' : 'warning'}>{pctf(v.overlap_rate)}</AdminBadge></td>
                        <td className="px-2 py-1 text-right tabular-nums">{scoref(v.expected_completion_delta)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{scoref(v.expected_skip_delta)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{v.diversity_delta > 0 ? '+' : ''}{v.diversity_delta}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{scoref(v.freshness_delta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-[10px] text-ink-dim">overlap = Twin(예측순) ∩ baseline(exposure_shadow_queue) / twin. 낮을수록 예측/노출 정렬이 상이(캘리브레이션 신호).</p>
              </div>
            )}
            {cf && (
              <div className="mt-3 rounded-lg border border-line/15 bg-bg px-3 py-2 text-[11px]">
                <p className="mb-1 flex items-center gap-1 text-ink"><Sparkles size={12} className="text-accent" /> {cf.reason_summary}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
                  <span className="text-ink-dim">A pred <b className="text-ink">{scoref(cf.a_prediction)}</b></span>
                  <span className="text-ink-dim">B pred <b className="text-ink">{scoref(cf.b_prediction)}</b></span>
                  <span className="text-ink-dim">final Δ <b className="text-ink">{scoref(cf.final_score_diff)}</b></span>
                  <span className="text-ink-dim">completion Δ {scoref(cf.completion_diff)}</span>
                  <span className="text-ink-dim">skip Δ {scoref(cf.skip_diff)}</span>
                  <span className="text-ink-dim">eligible Δ {scoref(cf.eligible_diff)}</span>
                </div>
              </div>
            )}
          </AdminCard>

          {/* Prediction Score Top */}
          {overview.top && overview.top.length > 0 && (
            <AdminCard title="Prediction Score — Top Candidates" subtitle="expected completion·skip·eligible·revenue·confidence 가중 예측.">
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">#</th><th className="px-2 py-1 text-left">track</th>
                    <th className="px-2 py-1 text-left">genre</th><th className="px-2 py-1 text-right">exp compl</th>
                    <th className="px-2 py-1 text-right">exp skip</th><th className="px-2 py-1 text-right">exp elig</th>
                    <th className="px-2 py-1 text-right">conf</th><th className="px-2 py-1 text-left">src</th>
                    <th className="px-2 py-1 text-right">prediction</th>
                  </tr></thead>
                  <tbody>
                    {overview.top.map((c) => (
                      <tr key={c.track_id} className="border-t border-line/10">
                        <td className="px-2 py-1 text-ink-dim">{c.rank}</td>
                        <td className="px-2 py-1 max-w-[150px] truncate text-ink-mute" title={c.track_title ?? ''}>{c.track_title ?? '—'}</td>
                        <td className="px-2 py-1 text-ink-dim">{c.main_genre ?? '—'}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{pctf(c.expected_completion_rate)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{pctf(c.expected_skip_rate)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{pctf(c.expected_eligible_rate)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{pctf(c.prediction_confidence)}</td>
                        <td className="px-2 py-1"><AdminBadge tone={c.data_source === 'learning' ? 'success' : 'neutral'}>{c.data_source === 'learning' ? 'learn' : 'hist'}</AdminBadge></td>
                        <td className="px-2 py-1 text-right font-semibold tabular-nums text-ink">{scoref(c.prediction_score)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AdminCard>
          )}

          {/* Prediction Gap */}
          {overview.gap && overview.gap.count > 0 && (
            <AdminCard title="Prediction Gap (exposure_learning_memory)" subtitle="예측 exposure vs 실제 completion 정확도.">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <AdminStatCard label="Compared" value={String(overview.gap.count)} />
                <AdminStatCard label="Overestimated" value={String(overview.gap.over)} tone="warning" />
                <AdminStatCard label="Underestimated" value={String(overview.gap.under)} tone="info" />
                <AdminStatCard label="Accurate" value={String(overview.gap.accurate)} tone="success" />
              </div>
            </AdminCard>
          )}
        </div>
      )}
    </AdminSection>
  );
}
