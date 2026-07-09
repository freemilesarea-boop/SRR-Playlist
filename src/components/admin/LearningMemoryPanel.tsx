// Phase ALGO-4A.5 — 관리자 Learning Memory (Shadow) 패널.
// Track/Store/Context/Industry 성과 기억 + Exposure Prediction Gap 관측 전용.
// Exposure Score 미반영. 실제 Queue/Playback/Settlement/Streaming 무변경.
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Brain, Sparkles } from 'lucide-react';
import { AdminSection, AdminCard, AdminButton, AdminBadge, AdminAlert, AdminEmpty, AdminSkeleton, AdminStatCard } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  adminGenerateLearningMemory, adminLearningMemoryOverview, adminCompareExposurePrediction,
  type LearningOverview, type PredictionCompare,
} from '@/lib/learningApi';

const pctf = (n: number | null | undefined) => (n == null ? '—' : `${(n * 100).toFixed(0)}%`);
const lsf = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(3));
const gapTone = (g: number): 'success' | 'warning' | 'danger' => (Math.abs(g) < 0.1 ? 'success' : Math.abs(g) < 0.3 ? 'warning' : 'danger');

export default function LearningMemoryPanel() {
  const [overview, setOverview] = useState<LearningOverview | null>(null);
  const [pred, setPred] = useState<PredictionCompare | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [ov, pc] = await Promise.all([
        adminLearningMemoryOverview(null),
        adminCompareExposurePrediction(null, 30).catch(() => null),
      ]);
      setOverview(ov); setPred(pc);
    } catch (e) { setErr(e instanceof Error ? e.message : '조회 실패 (0431 미적용 시 정상 — apply 후 표시)'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function generate() {
    setBusy(true);
    try {
      const r = await adminGenerateLearningMemory(90, 200);
      toast.success(`Learning Memory 생성 — track ${r.track_count} · industry ${r.industry_count} · context ${r.context_count}`);
      await load();
    } catch (e) { toast.error(`생성 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const run = overview?.run;

  return (
    <AdminSection
      title="Learning Memory (Shadow)"
      description="매장·곡·상황별 성과를 기억하여 다음 Exposure Score 에 반영할 기반입니다. 이번 단계에서는 계산·기억만 하며 Exposure Score 에 실반영하지 않습니다. (ALGO-4A.5)"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton size="sm" variant="subtle" tone="neutral" leftIcon={<RefreshCw size={14} />} onClick={() => void load()}>새로고침</AdminButton>
          <AdminButton size="sm" tone="primary" leftIcon={<Brain size={13} />} disabled={busy} onClick={() => void generate()}>Memory 생성</AdminButton>
        </div>
      }
    >
      <AdminAlert tone="info" className="mb-3" title="Shadow Memory — Exposure 미반영"
        description="Learning Score 는 completion·skip·eligible·reaction·confidence 로 계산되며, 별도 v2_learning_score_candidates view 로만 노출됩니다. 실제 Exposure Score / Queue / Playback / Settlement / Streaming 은 그대로입니다. ALGO-4B/4C에서 연결을 검토합니다." />

      {loading && !overview ? (
        <AdminSkeleton variant="card" />
      ) : err ? (
        <AdminAlert tone="info" title="데이터 없음 / 미적용" description={err} action={<AdminButton size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      ) : !overview?.has_data ? (
        <AdminEmpty icon={<Brain size={22} />} title="아직 Learning Memory 가 없어요" description="상단 'Memory 생성'을 실행하세요 (shadow 계산)." />
      ) : (
        <div className="space-y-4">
          {/* Run overview */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <AdminStatCard label="Tracks" value={String(run?.track_count ?? 0)} />
            <AdminStatCard label="Industries" value={String(run?.industry_count ?? 0)} tone="info" />
            <AdminStatCard label="Contexts" value={String(run?.context_count ?? 0)} tone="info" />
            <AdminStatCard label="Stores" value={String(run?.store_count ?? 0)} />
            <AdminStatCard label="Window" value={`${run?.window_days ?? 90}d`} />
          </div>

          {/* Track Memory Top */}
          {overview.track_top && overview.track_top.length > 0 && (
            <AdminCard title="Track Memory — Top by Learning Score" subtitle="completion·(1-skip)·eligible·reaction·confidence 가중 학습 점수.">
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">track</th>
                    <th className="px-2 py-1 text-right">plays</th><th className="px-2 py-1 text-right">compl</th>
                    <th className="px-2 py-1 text-right">skip</th><th className="px-2 py-1 text-left">best store</th>
                    <th className="px-2 py-1 text-left">best slot</th><th className="px-2 py-1 text-right">learning</th>
                  </tr></thead>
                  <tbody>
                    {overview.track_top.map((t) => (
                      <tr key={t.track_id} className="border-t border-line/10">
                        <td className="px-2 py-1 font-mono text-ink-dim">{t.track_id.slice(0, 8)}…</td>
                        <td className="px-2 py-1 text-right tabular-nums">{t.plays}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{pctf(t.completion)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{pctf(t.skip)}</td>
                        <td className="px-2 py-1">{t.best_store ?? '—'}</td>
                        <td className="px-2 py-1 text-ink-dim">{t.best_slot ?? '—'}</td>
                        <td className="px-2 py-1 text-right font-semibold tabular-nums text-ink">{lsf(t.learning_score)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AdminCard>
          )}

          {/* Industry Memory */}
          {overview.industries && overview.industries.length > 0 && (
            <AdminCard title="Industry Memory (매장 유형)" subtitle="store_type_slug 별 성과 · Best Genre / Best Slot.">
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">industry</th>
                    <th className="px-2 py-1 text-right">plays</th><th className="px-2 py-1 text-right">compl</th>
                    <th className="px-2 py-1 text-right">skip</th><th className="px-2 py-1 text-left">best slot</th>
                    <th className="px-2 py-1 text-left">top genres</th><th className="px-2 py-1 text-right">learning</th>
                  </tr></thead>
                  <tbody>
                    {overview.industries.map((ind) => (
                      <tr key={ind.industry} className="border-t border-line/10">
                        <td className="px-2 py-1 text-ink">{ind.industry}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{ind.plays}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{pctf(ind.completion)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{pctf(ind.skip)}</td>
                        <td className="px-2 py-1 text-ink-dim">{ind.best_slot ?? '—'}</td>
                        <td className="px-2 py-1 max-w-[160px] truncate text-ink-mute">{Array.isArray(ind.top_genres) ? ind.top_genres.slice(0, 3).join(', ') : '—'}</td>
                        <td className="px-2 py-1 text-right font-semibold tabular-nums text-ink">{lsf(ind.learning_score)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AdminCard>
          )}

          {/* Context Memory */}
          {overview.contexts && overview.contexts.length > 0 && (
            <AdminCard title="Context Performance (Time Slot × Industry)" subtitle="상황별 completion · sample. Best Mood/Genre by Time 관측.">
              <div className="grid gap-1.5 sm:grid-cols-2">
                {overview.contexts.slice(0, 12).map((c) => (
                  <div key={c.context} className="flex items-center justify-between rounded-lg border border-line/15 bg-bg px-3 py-1.5 text-[11px]">
                    <span className="flex items-center gap-2">
                      <Sparkles size={11} className="text-ink-dim" />
                      <span className="text-ink">{c.context}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-ink-dim">n={c.sample}</span>
                      <span className="text-ink">compl {pctf(c.completion)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </AdminCard>
          )}

          {/* Prediction Gap */}
          {pred && pred.summary.count > 0 && (
            <AdminCard title="Exposure Prediction Gap" subtitle="예측 Exposure Score vs 실제 completion 차이. ALGO-4B/4C 캘리브레이션 근거.">
              <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <AdminStatCard label="Compared" value={String(pred.summary.count)} />
                <AdminStatCard label="Avg |Gap|" value={lsf(pred.summary.avg_abs_gap)} tone={gapTone(pred.summary.avg_abs_gap)} />
                <AdminStatCard label="High/Mid/Low" value={`${pred.summary.high}/${pred.summary.mid}/${pred.summary.low}`} />
                <AdminStatCard label="Avg Gap" value={lsf(pred.summary.avg_gap)} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-ink-dim"><tr>
                    <th className="px-2 py-1 text-left">track</th>
                    <th className="px-2 py-1 text-right">predicted</th><th className="px-2 py-1 text-right">actual compl</th>
                    <th className="px-2 py-1 text-right">gap</th><th className="px-2 py-1 text-left">quality</th>
                  </tr></thead>
                  <tbody>
                    {pred.rows.slice(0, 30).map((r, i) => (
                      <tr key={(r.track_id ?? '') + i} className="border-t border-line/10">
                        <td className="px-2 py-1 font-mono text-ink-dim">{(r.track_id ?? '—').slice(0, 8)}…</td>
                        <td className="px-2 py-1 text-right tabular-nums">{lsf(r.exposure_score)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{pctf(r.actual_completion)}</td>
                        <td className="px-2 py-1 text-right"><AdminBadge tone={r.gap == null ? 'neutral' : gapTone(r.gap)}>{r.gap == null ? '—' : (r.gap > 0 ? '+' : '') + r.gap.toFixed(3)}</AdminBadge></td>
                        <td className="px-2 py-1"><AdminBadge tone={r.quality === 'high' ? 'success' : r.quality === 'mid' ? 'info' : 'warning'}>{r.quality ?? '—'}</AdminBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AdminCard>
          )}
        </div>
      )}
    </AdminSection>
  );
}
