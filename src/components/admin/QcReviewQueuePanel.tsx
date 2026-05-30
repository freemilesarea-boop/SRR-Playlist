/**
 * QcReviewQueuePanel — AI QC 결과 기반 검수 우선순위 큐 (admin).
 *  - 정렬: 위험도(CRITICAL > HIGH > MEDIUM > LOW) → qc_score 낮은 순 → 최신 업로드
 *  - 각 행 클릭 → 상세 QC 리포트 카드 펼침
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Sparkles, AlertTriangle } from 'lucide-react';
import {
  listQcReviewQueue, GRADE_TONE, RISK_TONE,
  type QcReviewQueueRow,
} from '@/lib/qcApi';
import QcReportCard from '@/components/admin/QcReportCard';
import { toast } from '@/store/toastStore';

export default function QcReviewQueuePanel() {
  const [rows, setRows] = useState<QcReviewQueueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listQcReviewQueue(100);
      setRows(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'QC 큐 불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const totalsByRisk = rows.reduce((acc, r) => {
    const k = r.risk_level ?? 'UNREVIEWED';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <section className="space-y-3">
      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles size={14} className="text-accent" />
          <h3 className="text-sm font-bold tracking-tight">AI QC 검수 큐</h3>
          <span className="ml-2 text-[10px] text-ink-dim">
            DSP-급 음원 검수 — 라우드니스/클리핑/노이즈/다이내믹 자동 분석. 위험도 높은 순.
          </span>
          <button onClick={reload} disabled={loading} className="btn-ghost ml-auto h-8 text-[11px]">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
          </button>
        </div>

        {/* 위험도 분포 */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Pill tone="critical" label="CRITICAL" count={totalsByRisk.CRITICAL ?? 0} />
          <Pill tone="high" label="HIGH" count={totalsByRisk.HIGH ?? 0} />
          <Pill tone="medium" label="MEDIUM" count={totalsByRisk.MEDIUM ?? 0} />
          <Pill tone="low" label="LOW" count={totalsByRisk.LOW ?? 0} />
          <Pill tone="muted" label="미분석" count={totalsByRisk.UNREVIEWED ?? 0} />
        </div>
      </div>

      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        {loading && rows.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-mute">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-dim">
            검수 대기 중인 트랙이 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-line/10">
            {rows.map((r) => {
              const expanded = expandedId === r.track_id;
              return (
                <li key={r.track_id}>
                  <button
                    onClick={() => setExpandedId(expanded ? null : r.track_id)}
                    className="flex w-full items-center gap-3 px-2 py-3 text-left hover:bg-bg-hover"
                  >
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-bg-soft">
                      {r.cover_url && (
                        <img src={r.cover_url} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {r.title}
                        <span className="ml-2 text-[10px] text-ink-dim">{r.artist ?? '—'}</span>
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-ink-mute">
                        <span className="rounded bg-bg-soft px-1.5 py-0.5">{r.release_status ?? '—'}</span>
                        {r.integrated_lufs != null && (
                          <span className="rounded bg-bg-soft px-1.5 py-0.5">{r.integrated_lufs.toFixed(1)} LUFS</span>
                        )}
                        {r.true_peak_db != null && (
                          <span className="rounded bg-bg-soft px-1.5 py-0.5">{r.true_peak_db.toFixed(1)} dBTP</span>
                        )}
                        {r.clipping_count != null && r.clipping_count > 0 && (
                          <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-300">
                            <AlertTriangle size={9} className="inline" /> 클리핑 {r.clipping_count}
                          </span>
                        )}
                        {r.issues_count > 0 && (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">
                            문제 {r.issues_count}
                          </span>
                        )}
                      </p>
                    </div>
                    {r.qc_score != null && (
                      <div className="shrink-0 text-right">
                        <div className="text-xs font-bold">{r.qc_score.toFixed(0)}<span className="text-[9px] text-ink-dim">/100</span></div>
                      </div>
                    )}
                    {r.qc_grade && (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${GRADE_TONE[r.qc_grade]}`}>
                        {r.qc_grade}
                      </span>
                    )}
                    {r.risk_level && (
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${RISK_TONE[r.risk_level]}`}>
                        {r.risk_level}
                      </span>
                    )}
                  </button>
                  {expanded && (
                    <div className="px-2 pb-4">
                      <QcReportCard trackId={r.track_id} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function Pill({ tone, label, count }: {
  tone: 'critical' | 'high' | 'medium' | 'low' | 'muted';
  label: string;
  count: number;
}) {
  const cls = tone === 'critical' ? 'bg-rose-500/15 text-rose-300 ring-rose-500/30' :
              tone === 'high' ? 'bg-amber-500/15 text-amber-300 ring-amber-500/30' :
              tone === 'medium' ? 'bg-sky-500/15 text-sky-300 ring-sky-500/30' :
              tone === 'low' ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' :
              'bg-bg-soft text-ink-mute ring-line/10';
  return (
    <div className={`rounded-lg px-3 py-2 ring-1 ${cls}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</div>
      <div className="mt-0.5 text-xl font-extrabold tracking-tight">{count}</div>
    </div>
  );
}
