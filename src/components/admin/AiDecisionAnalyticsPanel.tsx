// Phase ALGO-6C — 관리자 AI Decision Analytics (Feedback History & Longitudinal Trend) 패널.
// Accuracy/Risk/Confidence/Drift/Promotion Timeline · Model Evolution · Forecast · Regression Detection 관측.
// 운영 미반영 — 장기 성능 관측(Longitudinal Observability)이며 어떤 운영 반영/자동 승인도 없습니다.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, LineChart, TrendingUp, TrendingDown, Minus, GitCommitHorizontal, AlertTriangle } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminGenerateFeedbackHistory, adminGenerateLongitudinalTrend, adminGenerateWindowStatistics,
  adminGenerateModelEvolution, adminGenerateDecisionForecast, adminAiFeedbackHistoryOverview,
  type FeedbackHistoryOverview, type TimelinePoint,
} from '@/lib/feedbackHistoryApi';

const numf = (n: number | null | undefined) => (n == null ? '—' : Number(n).toFixed(3));
const dirIcon = (d: string) => (d === 'improving' ? <TrendingUp size={11} /> : d === 'degrading' ? <TrendingDown size={11} /> : <Minus size={11} />);
const dirTone = (d: string): 'success' | 'danger' | 'neutral' => (d === 'improving' ? 'success' : d === 'degrading' ? 'danger' : 'neutral');
const statusTone = (s: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  switch (s) {
    case 'stable': return 'success';
    case 'warning': return 'warning';
    case 'critical': return 'danger';
    case 'insufficient_data': return 'neutral';
    default: return 'neutral';
  }
};

// 간단한 인라인 스파크라인(막대) — 값은 0..1 로 정규화되어 있음.
function Spark({ points, tone = 'accent' }: { points: Array<number | null>; tone?: string }) {
  const bar = tone === 'muted' ? 'bg-ink/40' : 'bg-accent/70';
  return (
    <div className="flex h-8 items-end gap-0.5">
      {points.map((p, i) => (
        <div key={i} className="flex-1 rounded-sm bg-line/10" style={{ minWidth: 3 }}>
          <div className={`w-full rounded-sm ${bar}`} style={{ height: `${Math.max(2, Math.min(100, (p ?? 0) * 100))}%` }} />
        </div>
      ))}
    </div>
  );
}

export default function AiDecisionAnalyticsPanel() {
  const [overview, setOverview] = useState<FeedbackHistoryOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setOverview(await adminAiFeedbackHistoryOverview()); }
    catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0438 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 전체 파이프라인: History → Trend → Window Stats → Evolution → Forecast.
  async function runPipeline() {
    setBusy(true);
    try {
      const h = await adminGenerateFeedbackHistory(10, 3, 21, 5);
      const t = await adminGenerateLongitudinalTrend(null);
      await adminGenerateWindowStatistics(null);
      await adminGenerateModelEvolution(null);
      await adminGenerateDecisionForecast(null);
      toast.success(`Analytics 파이프라인 완료 — ${h.snapshots} 스냅샷 · 7 trends · regressions ${t.regressions}`);
      await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const timeline: TimelinePoint[] = overview?.timeline ?? [];
  const trends = overview?.trends ?? [];
  const evolution = overview?.model_evolution ?? [];
  const forecasts = overview?.forecasts ?? [];
  const regressions = overview?.regressions ?? [];

  const accSeries = timeline.map((t) => t.accuracy);
  const riskSeries = timeline.map((t) => t.risk);
  const confSeries = timeline.map((t) => t.confidence);
  const promoSeries = timeline.map((t) => t.promotion);

  return (
    <AdminSection
      title="AI Decision Analytics (Longitudinal, Shadow)"
      description="ALGO-6B Decision Feedback 를 장기 시계열로 누적하여 Accuracy/Risk/Confidence/Drift/Promotion 변화를 추적하는 Longitudinal Observability 레이어입니다. Model Evolution · Forecast · Regression Detection 을 산출하며, 실제 운영 시스템에 어떠한 영향도 주지 않습니다. (ALGO-6C)"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<LineChart size={13} />} disabled={busy} onClick={() => void runPipeline()}>Analytics 파이프라인 실행</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="Longitudinal Observability — 관측·분석 목적만"
        description="playback_events_v2 의 as-of 시점을 슬라이딩하여 예상 vs 실제 스냅샷 시계열을 생성합니다. Trend/Forecast/Regression 은 전부 Shadow 계산이며, Regression 감지도 기록만 하고 실제 차단은 없습니다. 장기 안정성이 충분히 입증될 때까지 모든 결과는 관측·분석 목적으로만 사용됩니다." />

      {loading && !overview ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !overview?.has_data ? (
        <AdminEmpty icon={<LineChart size={22} />} title="아직 Analytics 데이터가 없어요" description="상단 'Analytics 파이프라인 실행'을 누르세요 (History → Trend → Window Stats → Evolution → Forecast, 전부 Shadow)." />
      ) : (
        <div className="space-y-4">
          {/* Timelines */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <AdminCard title="Accuracy Timeline" subtitle={`${timeline.length} 스냅샷`}>
              <Spark points={accSeries} tone="accent" />
              <p className="mt-1 text-[11px] text-ink-dim">최신 {numf(accSeries.at(-1))}</p>
            </AdminCard>
            <AdminCard title="Risk Timeline" subtitle="낮을수록 좋음">
              <Spark points={riskSeries} tone="muted" />
              <p className="mt-1 text-[11px] text-ink-dim">최신 {numf(riskSeries.at(-1))}</p>
            </AdminCard>
            <AdminCard title="Confidence Timeline" subtitle="예측 신뢰도">
              <Spark points={confSeries} tone="accent" />
              <p className="mt-1 text-[11px] text-ink-dim">최신 {numf(confSeries.at(-1))}</p>
            </AdminCard>
            <AdminCard title="Promotion Timeline" subtitle="전환 준비 점수">
              <Spark points={promoSeries} tone="accent" />
              <p className="mt-1 text-[11px] text-ink-dim">최신 {numf(promoSeries.at(-1))}</p>
            </AdminCard>
          </div>

          {/* Longitudinal trends */}
          <AdminCard title="Longitudinal Trends" subtitle="장기 slope 기반 방향 (improving/degrading/stable).">
            <div className="flex flex-wrap gap-1.5">
              {trends.map((t) => (
                <AdminBadge key={t.trend} tone={dirTone(t.direction)} icon={dirIcon(t.direction)}>
                  {t.trend} {t.delta != null ? (t.delta >= 0 ? '+' : '') + t.delta.toFixed(3) : ''}
                </AdminBadge>
              ))}
            </div>
          </AdminCard>

          {/* Model evolution + Forecast */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Model Evolution" subtitle="버전별 accuracy/risk/reward/confidence.">
              {evolution.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead className="text-ink-dim"><tr>
                      <th className="px-2 py-1 text-left">version</th><th className="px-2 py-1 text-right">accuracy</th>
                      <th className="px-2 py-1 text-right">Δacc</th><th className="px-2 py-1 text-right">risk</th>
                      <th className="px-2 py-1 text-right">reward</th><th className="px-2 py-1 text-right">conf</th>
                    </tr></thead>
                    <tbody>
                      {evolution.map((e) => (
                        <tr key={e.version} className="border-t border-line/10">
                          <td className="px-2 py-1 font-mono text-ink flex items-center gap-1.5"><GitCommitHorizontal size={11} className="text-ink-dim" />{e.version}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-ink">{numf(e.accuracy)}</td>
                          <td className="px-2 py-1 text-right">{e.accuracy_delta == null ? <span className="text-ink-dim">—</span> : <AdminBadge tone={e.accuracy_delta >= 0 ? 'success' : 'danger'}>{(e.accuracy_delta >= 0 ? '+' : '') + e.accuracy_delta.toFixed(3)}</AdminBadge>}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(e.risk)}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(e.reward)}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(e.confidence)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <AdminEmpty title="evolution 없음" description="파이프라인을 실행하세요." />}
            </AdminCard>

            <AdminCard title="Forecast (7/30/90d)" subtitle="선형 예측 — 관측용, 운영 미반영.">
              {forecasts.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead className="text-ink-dim"><tr>
                      <th className="px-2 py-1 text-left">metric</th><th className="px-2 py-1 text-right">now</th>
                      <th className="px-2 py-1 text-right">+7d</th><th className="px-2 py-1 text-right">+30d</th><th className="px-2 py-1 text-right">+90d</th>
                    </tr></thead>
                    <tbody>
                      {['accuracy', 'risk', 'promotion', 'confidence'].map((metric) => {
                        const rows = forecasts.filter((f) => f.metric === metric);
                        const now = rows[0]?.last;
                        const get = (h: number) => rows.find((r) => r.horizon === h)?.forecast;
                        return (
                          <tr key={metric} className="border-t border-line/10">
                            <td className="px-2 py-1 font-mono text-ink">{metric}</td>
                            <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(now)}</td>
                            <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(get(7))}</td>
                            <td className="px-2 py-1 text-right tabular-nums text-ink-dim">{numf(get(30))}</td>
                            <td className="px-2 py-1 text-right tabular-nums text-ink">{numf(get(90))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <AdminEmpty title="forecast 없음" description="파이프라인을 실행하세요." />}
            </AdminCard>
          </div>

          {/* Stability timeline + Regression detection */}
          <div className="grid gap-3 lg:grid-cols-2">
            <AdminCard title="Stability Timeline" subtitle="스냅샷별 상태 + 전이(improving/degrading/recovery).">
              {overview?.stability_timeline && overview.stability_timeline.length > 0 ? (
                <div className="max-h-56 space-y-1 overflow-y-auto">
                  {overview.stability_timeline.map((s, i) => (
                    <div key={s.at + i} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-ink-dim">{new Date(s.at).toLocaleDateString('ko-KR')}</span>
                      <span className="flex items-center gap-1.5">
                        <span className="tabular-nums text-ink">acc {numf(s.accuracy)}</span>
                        <AdminBadge tone={statusTone(s.status)}>{s.status}</AdminBadge>
                        <AdminBadge tone="neutral">{s.transition}</AdminBadge>
                      </span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-[11px] text-ink-dim">timeline 없음.</p>}
            </AdminCard>

            <AdminCard title="Regression Detection" subtitle="악화 감지 — 기록만, 실제 차단 없음.">
              {regressions.length > 0 ? (
                <div className="space-y-1.5">
                  {regressions.map((r, i) => (
                    <div key={r.metric + i} className="flex items-center justify-between gap-2 rounded-lg border border-line/15 px-2.5 py-1.5 text-[11px]">
                      <span className="flex items-center gap-1.5 text-ink"><AlertTriangle size={11} className="text-ink-dim" />{r.type}</span>
                      <span className="flex items-center gap-1.5">
                        <span className="tabular-nums text-ink-dim">{numf(r.from)} → {numf(r.to)}</span>
                        <AdminBadge tone={r.severity === 'critical' ? 'danger' : 'warning'}>{numf(r.delta)}</AdminBadge>
                      </span>
                    </div>
                  ))}
                </div>
              ) : <div className="flex items-center gap-1.5 text-[11px] text-ink-dim"><Minus size={12} /> regression 없음</div>}
            </AdminCard>
          </div>
        </div>
      )}
    </AdminSection>
  );
}
