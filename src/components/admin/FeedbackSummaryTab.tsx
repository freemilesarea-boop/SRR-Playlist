import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, BarChart3, Brain, Ban, Trash2, AlertTriangle, CheckCircle2, FileEdit } from 'lucide-react';
import {
  adminFeedbackSummary,
  type FeedbackSummary,
  type FeedbackAction,
  type FeedbackRecentLog,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';

const ACTION_LABEL: Record<FeedbackAction, string> = {
  admin_removed: '제거',
  admin_excluded: '제외',
  admin_review_needed: '검토필요',
  admin_approved: '승인',
  metadata_corrected: '메타수정',
};

const ACTION_TONE: Record<FeedbackAction, string> = {
  admin_removed:       'bg-rose-500/15 text-rose-500',
  admin_excluded:      'bg-rose-500/20 text-rose-500',
  admin_review_needed: 'bg-amber-500/15 text-amber-500',
  admin_approved:      'bg-emerald-500/15 text-emerald-500',
  metadata_corrected:  'bg-indigo-500/15 text-indigo-400',
};

const ACTION_ICON: Record<FeedbackAction, typeof Ban> = {
  admin_removed: Trash2,
  admin_excluded: Ban,
  admin_review_needed: AlertTriangle,
  admin_approved: CheckCircle2,
  metadata_corrected: FileEdit,
};

const ACTION_ORDER: FeedbackAction[] = [
  'admin_removed', 'admin_excluded', 'admin_review_needed',
  'admin_approved', 'metadata_corrected',
];

export default function FeedbackSummaryTab() {
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<FeedbackAction | ''>('');
  const [storeFilter, setStoreFilter] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await adminFeedbackSummary();
      setSummary(r);
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error(`feedback 로딩 실패: ${msg}`);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredLogs = useMemo(() => {
    if (!summary?.recent_logs) return [];
    return summary.recent_logs.filter((l) =>
      (!actionFilter || l.action === actionFilter) &&
      (!storeFilter || (l.store_type ?? 'GLOBAL') === storeFilter)
    );
  }, [summary, actionFilter, storeFilter]);

  if (error && !summary) {
    return (
      <div className="rounded-xl bg-rose-500/10 p-4 text-sm text-rose-500">
        로딩 실패: {error}
        <button onClick={() => void load()} className="ml-2 underline">재시도</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1 text-sm font-bold">
            <Brain size={14} /> 운영자 학습 피드백
          </h3>
          <button onClick={() => void load()} disabled={loading}
            className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 text-xs hover:bg-bg-hover disabled:opacity-50">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
          </button>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          관리자 조치 → track_store_feedback 누적. auto_place_track 이 자동으로 반영
          (admin_removed/excluded 는 hard skip, admin_approved 는 +15, admin_review_needed 는 -10).
        </p>
      </div>

      {/* === Totals === */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <SummaryCard label="전체" v={summary?.total ?? 0} icon={BarChart3} tone="bg-bg-card" big />
        {ACTION_ORDER.map((a) => {
          const Icon = ACTION_ICON[a];
          return (
            <SummaryCard key={a}
              label={ACTION_LABEL[a]}
              v={summary?.by_action?.[a] ?? 0}
              icon={Icon}
              tone={ACTION_TONE[a]}
            />
          );
        })}
      </div>

      {/* === Empty state === */}
      {summary && summary.total === 0 && (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">
          {loading ? '로딩 중…' : '아직 누적된 운영자 피드백이 없어요. AI 검수 큐에서 조치하면 자동으로 쌓입니다.'}
        </p>
      )}

      {summary && summary.total > 0 && (
        <>
          {/* === Store × Action 행렬 === */}
          {summary.by_store_action && (
            <div className="rounded-xl bg-bg-card p-3">
              <h4 className="mb-2 text-xs font-bold">매장(Store)별 · 조치별 집계</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
                      <th className="px-2 py-1.5">store_type</th>
                      {ACTION_ORDER.map((a) => (
                        <th key={a} className="px-2 py-1.5 text-right">{ACTION_LABEL[a]}</th>
                      ))}
                      <th className="px-2 py-1.5 text-right">합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(summary.by_store_action).map(([store, perAction]) => {
                      const total = Object.values(perAction).reduce<number>((s, n) => s + (n ?? 0), 0);
                      return (
                        <tr key={store} className="border-b border-line/10">
                          <td className="px-2 py-1.5">
                            <button onClick={() => setStoreFilter(storeFilter === store ? '' : store)}
                              className={`font-semibold ${storeFilter === store ? 'text-accent' : ''}`}>
                              {store}
                            </button>
                          </td>
                          {ACTION_ORDER.map((a) => (
                            <td key={a} className="px-2 py-1.5 text-right tabular-nums">
                              <span className={(perAction[a] ?? 0) > 0 ? ACTION_TONE[a].split(' ')[1] : 'text-ink-dim'}>
                                {perAction[a] ?? 0}
                              </span>
                            </td>
                          ))}
                          <td className="px-2 py-1.5 text-right font-bold tabular-nums">{total}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* === 장르별 집계 === */}
          {summary.by_genre.length > 0 && (
            <div className="rounded-xl bg-bg-card p-3">
              <h4 className="mb-2 text-xs font-bold">장르(main_genre)별 제거/제외 집계 (Top 30)</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
                      <th className="px-2 py-1.5">장르</th>
                      <th className="px-2 py-1.5 text-right">제거</th>
                      <th className="px-2 py-1.5 text-right">제외</th>
                      <th className="px-2 py-1.5 text-right">검토</th>
                      <th className="px-2 py-1.5 text-right">승인</th>
                      <th className="px-2 py-1.5 text-right">합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.by_genre.map((g) => (
                      <tr key={g.main_genre} className="border-b border-line/10">
                        <td className="px-2 py-1.5 font-semibold">{g.main_genre}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          <span className={g.removed > 0 ? 'text-rose-500' : 'text-ink-dim'}>{g.removed}</span>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          <span className={g.excluded > 0 ? 'text-rose-500' : 'text-ink-dim'}>{g.excluded}</span>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          <span className={g.review_needed > 0 ? 'text-amber-500' : 'text-ink-dim'}>{g.review_needed}</span>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          <span className={g.approved > 0 ? 'text-emerald-500' : 'text-ink-dim'}>{g.approved}</span>
                        </td>
                        <td className="px-2 py-1.5 text-right font-bold tabular-nums">{g.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* === 최근 로그 === */}
          <div className="rounded-xl bg-bg-card p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-bold">최근 Feedback 로그 (최대 50건)</h4>
              <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value as FeedbackAction | '')}
                className="rounded bg-bg-deep px-2 py-1 text-xs">
                <option value="">모든 action</option>
                {ACTION_ORDER.map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
              </select>
              {summary.by_store && (
                <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}
                  className="rounded bg-bg-deep px-2 py-1 text-xs">
                  <option value="">모든 store</option>
                  {Object.keys(summary.by_store).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
              <span className="text-[10px] text-ink-dim">{filteredLogs.length} 행</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
                    <th className="px-2 py-1.5">시각</th>
                    <th className="px-2 py-1.5">곡 / 아티스트</th>
                    <th className="px-2 py-1.5">store / action</th>
                    <th className="px-2 py-1.5">playlist</th>
                    <th className="px-2 py-1.5">관리자</th>
                    <th className="px-2 py-1.5">메모</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.length === 0 ? (
                    <tr><td colSpan={6} className="px-2 py-6 text-center text-ink-dim">
                      필터 결과 없음
                    </td></tr>
                  ) : filteredLogs.map((l) => <LogRow key={l.id} log={l} />)}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function LogRow({ log }: { log: FeedbackRecentLog }) {
  const Icon = ACTION_ICON[log.action];
  return (
    <tr className="border-b border-line/10">
      <td className="px-2 py-1.5 text-[10px] text-ink-dim whitespace-nowrap">
        {new Date(log.created_at).toLocaleString()}
      </td>
      <td className="px-2 py-1.5">
        <div className="font-semibold truncate max-w-[180px]">{log.track_title ?? '—'}</div>
        <div className="text-[10px] text-ink-dim truncate">
          {log.artist_name ?? '—'}{log.main_genre ? ` · ${log.main_genre}` : ''}
        </div>
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1">
          <span className="font-semibold">{log.store_type ?? 'GLOBAL'}</span>
          <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${ACTION_TONE[log.action]}`}>
            <Icon size={9} /> {ACTION_LABEL[log.action]}
          </span>
        </div>
        {(log.before_fit_score != null || log.after_fit_score != null) && (
          <div className="text-[10px] text-ink-dim tabular-nums">
            fit {log.before_fit_score ?? '—'} → {log.after_fit_score ?? '—'}
          </div>
        )}
      </td>
      <td className="px-2 py-1.5 text-[11px]">
        <div className="truncate max-w-[150px]">{log.playlist_name ?? '—'}</div>
      </td>
      <td className="px-2 py-1.5 text-[10px] text-ink-dim">
        {log.created_by_name ?? log.created_by?.slice(0, 8) ?? 'system'}
      </td>
      <td className="px-2 py-1.5 text-[10px] text-ink-mute">
        <span className="block truncate max-w-[200px]" title={log.admin_note ?? ''}>
          {log.admin_note ?? '—'}
        </span>
      </td>
    </tr>
  );
}

function SummaryCard({
  label, v, icon: Icon, tone, big,
}: {
  label: string; v: number; icon: typeof BarChart3; tone: string; big?: boolean;
}) {
  return (
    <div className={`rounded-xl ${tone} p-3`}>
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold opacity-80">{label}</div>
        <Icon size={12} className="opacity-60" />
      </div>
      <div className={`mt-1 font-bold tabular-nums ${big ? 'text-2xl' : 'text-xl'}`}>{v}</div>
    </div>
  );
}
