// Phase ALGO-6B — 관리자 AI Decision Feedback & Drift Monitor (Shadow Observability) 패널.
// Decision Accuracy · Drift Status · Stability Window · Promotion Readiness · Shadow Alerts 관측.
// 운영 미반영 — 운영 전환 가능성 판단 근거만 만들며 자동 승인/자동 Canary 가 없습니다.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Activity, TrendingDown, Gauge, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminRunDecisionFeedback, adminRunDecisionDriftMonitor, adminCalculateDecisionStability,
  adminGeneratePromotionReadiness, adminAiDecisionFeedbackOverview, type FeedbackOverview,
} from '@/lib/decisionFeedbackApi';

const numf = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(3));

const driftTone = (s: string | null | undefined): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  switch (s) {
    case 'stable': return 'success';
    case 'warning': return 'warning';
    case 'drifting': return 'warning';
    case 'critical': return 'danger';
    case 'insufficient_data': return 'neutral';
    default: return 'neutral';
  }
};
const readinessTone = (s: string | null | undefined): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  switch (s) {
    case 'ready_for_limited_canary': return 'success';
    case 'ready_for_review': return 'info';
    case 'stable_shadow': return 'info';
    case 'needs_more_data': return 'warning';
    case 'not_ready': return 'danger';
    default: return 'neutral';
  }
};
const sevTone = (s: string): 'warning' | 'danger' | 'neutral' => (s === 'critical' ? 'danger' : s === 'warning' ? 'warning' : 'neutral');

export default function AiDecisionFeedbackPanel() {
  const [overview, setOverview] = useState<FeedbackOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOverview(await adminAiDecisionFeedbackOverview()); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0437 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 전체 파이프라인: Feedback → Drift → Stability → Promotion Readiness.
  async function runPipeline() {
    setBusy(true);
    try {
      const f = await adminRunDecisionFeedback(null, 120);
      const d = await adminRunDecisionDriftMonitor(null);
      await adminCalculateDecisionStability(90);
      const r = await adminGeneratePromotionReadiness(30);
      toast.success(`Feedback 파이프라인 완료 — accuracy ${numf(f.avg_accuracy)} · drift ${d.drift_status} · readiness ${r.readiness_state}`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const fb = overview?.feedback;
  const drift = overview?.drift;
  const stability = overview?.stability ?? [];
  const readiness = overview?.readiness;
  const alerts = overview?.alerts ?? [];

  return (
    <AdminSection
      title="AI Decision Feedback (Drift Monitor, Shadow)"
      description="ALGO-6A Unified Decision 이 실제 이후 성과와 얼마나 일치하는지 Shadow 로 검증합니다. Decision Accuracy · Drift · Stability · Promotion Readiness · Shadow Alerts 를 산출하며, 실제 Queue/Playback/Scheduler/Exposure/Prediction/RL/Settlement/Streaming 에 반영하거나 자동 승인/자동 Canary 를 수행하지 않습니다. (ALGO-6B)"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<Activity size={13} />} disabled={busy} onClick={() => void runPipeline()}>Feedback 파이프라인 실행</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="Shadow Observability — 운영 전환 근거만"
        description="예상(decision basis, 이전 구간) 대비 실제(actual, 이후 구간) 성과를 비교해 Decision Accuracy·오차·drift 를 측정합니다. Promotion Readiness 는 상태 판정만 하며(not_ready/needs_more_data/stable_shadow/ready_for_review/ready_for_limited_canary), 자동 승인·자동 Canary 는 없습니다. Shadow Alert 도 경고 생성만 하고 실제 차단/변경은 하지 않습니다." />

      {loading && !overview ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !overview?.has_data ? (
        <AdminEmpty icon={<Activity size={22} />} title="아직 Feedback 데이터가 없어요" description="상단 'Feedback 파이프라인 실행'을 누르세요 (Feedback → Drift → Stability → Readiness, 전부 Shadow)." />
      ) : (
        <div className="space-y-4">
          {/* Feedback accuracy + drift + readiness */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <AdminStatCard label="Decision Accuracy" value={numf(fb?.avg_accuracy)} tone={((fb?.avg_accuracy ?? 0) >= 0.75) ? 'success' : 'warning'} />
            <AdminStatCard label="Drift Status" value={drift?.status ?? '—'} tone={driftTone(drift?.status)} />
            <AdminStatCard label="Promotion Readiness" value={readiness?.readiness_state ?? '—'} tone={readinessTone(readiness?.readiness_state)} />
            <AdminStatCard label="Shadow Alerts" value={String(alerts.length)} tone={alerts.length > 0 ? 'warning' : 'success'} />
          </div>

          {/* Error breakdown */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <AdminStatCard label="Score Error" value={numf(fb?.avg_score_error)} tone={((fb?.avg_score_error ?? 1) <= 0.15) ? 'success' : 'warning'} />
            <AdminStatCard label="Confidence Error" value={numf(fb?.avg_confidence_error)} tone={((fb?.avg_confidence_error ?? 1) <= 0.2) ? 'success' : 'warning'} />
            <AdminStatCard label="Risk Error" value={numf(fb?.avg_risk_error)} tone={((fb?.avg_risk_error ?? 1) <= 0.2) ? 'success' : 'warning'} />
            <AdminStatCard label="Avg Drift" value={numf(drift?.avg_drift)} tone={((drift?.avg_drift ?? 1) <= 0.1) ? 'success' : 'warning'} />
          </div>

          {/* Promotion Readiness reasons */}
          {readiness && (
            <AdminCard title="Promotion Readiness (상태만)" subtitle="운영 전환 가능성 판정 — 자동 승인/자동 Canary 없음.">
              <div className="mb-2 flex items-center gap-2">
                <AdminBadge tone={readinessTone(readiness.readiness_state)} icon={readiness.readiness_state?.startsWith('ready') ? <CheckCircle2 size={10} /> : <Gauge size={10} />}>{readiness.readiness_state}</AdminBadge>
                <span className="text-[11px] text-ink-dim">accuracy {numf(readiness.decision_accuracy)} · risk {numf(readiness.avg_risk)} · sample {readiness.sample_size ?? 0} · consec {readiness.consecutive_stable_windows ?? 0}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {([
                  ['accuracy≥0.75', readiness.reasons?.['accuracy_ge_0.75']],
                  ['risk≤0.20', readiness.reasons?.['risk_le_0.20']],
                  ['drift ok', readiness.reasons?.['drift_ok']],
                  ['sample≥min', readiness.reasons?.['sample_ge_min']],
                  ['consec≥3', readiness.reasons?.['consecutive_stable_ge_3']],
                ] as Array<[string, unknown]>).map(([label, ok]) => (
                  <AdminBadge key={label} tone={ok ? 'success' : 'neutral'}>{ok ? '✓' : '✗'} {label}</AdminBadge>
                ))}
              </div>
            </AdminCard>
          )}

          {/* Stability windows */}
          <AdminCard title="Stability Windows" subtitle="7/14/30/60/90d 일자별 안정성. consecutive stable windows.">
            {stability.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">window</th><th className="px-2 py-1 text-left">status</th>
                    <th className="px-2 py-1 text-right">stable</th><th className="px-2 py-1 text-right">warning</th>
                    <th className="px-2 py-1 text-right">critical</th><th className="px-2 py-1 text-right">readiness score</th>
                  </tr></thead>
                  <tbody>
                    {stability.map((w) => (
                      <tr key={w.window} className="border-t border-line/10">
                        <td className="px-2 py-1 font-mono text-ink">{w.window}</td>
                        <td className="px-2 py-1"><AdminBadge tone={driftTone(w.status)}>{w.status}</AdminBadge></td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{w.stable_days}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{w.warning_days}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{w.critical_days}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-ink">{numf(w.score)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <AdminEmpty title="stability 없음" description="파이프라인을 실행하세요." />}
          </AdminCard>

          {/* Shadow alerts + worst drift + low confidence */}
          <div className="grid gap-3 lg:grid-cols-3">
            <AdminCard title="Shadow Alerts" subtitle="경고 생성만 — 실제 차단/변경 없음.">
              {alerts.length > 0 ? (
                <div className="space-y-1.5">
                  {alerts.map((a, i) => (
                    <div key={a.type + i} className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <span className="flex items-center gap-1.5 text-ink"><AlertTriangle size={11} className="text-ink-dim" />{a.type}</span>
                      <AdminBadge tone={sevTone(a.severity)}>{numf(a.value)}</AdminBadge>
                    </div>
                  ))}
                </div>
              ) : <div className="flex items-center gap-1.5 text-[11px] text-ink-dim"><CheckCircle2 size={12} /> 경고 없음</div>}
            </AdminCard>

            <AdminCard title="Worst Drift Items" subtitle="drift_magnitude 상위.">
              {drift?.worst_items && drift.worst_items.length > 0 ? (
                <div className="space-y-1">
                  {drift.worst_items.map((w, i) => (
                    <div key={(w.track_id ?? '') + i} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono text-ink-dim">{(w.track_id ?? '—').slice(0, 8)}…</span>
                      <span className="flex items-center gap-1.5">
                        <span className="tabular-nums text-ink">{numf(w.magnitude)}</span>
                        <AdminBadge tone={driftTone(w.status)}>{w.status}</AdminBadge>
                      </span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-[11px] text-ink-dim">drift item 없음.</p>}
            </AdminCard>

            <AdminCard title="Low Confidence Items" subtitle="confidence_error 상위 — 재검토 대상.">
              {fb?.low_confidence_items && fb.low_confidence_items.length > 0 ? (
                <div className="space-y-1">
                  {fb.low_confidence_items.map((l, i) => (
                    <div key={(l.track_id ?? '') + i} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono text-ink-dim">{(l.track_id ?? '—').slice(0, 8)}…</span>
                      <span className="flex items-center gap-1.5">
                        <TrendingDown size={10} className="text-ink-dim" />
                        <span className="tabular-nums text-ink-dim">err {numf(l.conf_err)}</span>
                        <span className="tabular-nums text-ink">acc {numf(l.accuracy)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-[11px] text-ink-dim">항목 없음.</p>}
            </AdminCard>
          </div>
        </div>
      )}
    </AdminSection>
  );
}
