import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Calculator, Sparkles, ExternalLink, Store,
  ThumbsUp, ThumbsDown, BarChart3, TrendingUp, Award, AlertCircle,
} from 'lucide-react';
import {
  adminRecomputeTrackStoreBehaviorScores,
  adminListTrackStoreScores,
  adminStoreLearningSummary,
  listTaxonomyStoreTypes,
  type TrackStoreScoreRow,
  type StoreLearningSummary,
  type StoreTypeOption,
} from '@/lib/aiCuration';
import {
  adminStoreLearningDashboard,
  type StoreLearningDashboard,
} from '@/lib/api/storeTrackReactionsApi';
import { toast } from '@/store/toastStore';
import TrackPlacementEditor from '@/components/admin/TrackPlacementEditor';
import BulkActionsModal from '@/components/admin/BulkActionsModal';

export default function StoreLearningTab() {
  const [storeFilter, setStoreFilter] = useState<string>('');
  const [storeTypes, setStoreTypes] = useState<StoreTypeOption[]>([]);
  const [summary, setSummary] = useState<StoreLearningSummary | null>(null);
  const [rows, setRows] = useState<TrackStoreScoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [editorTrackId, setEditorTrackId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [lastResult, setLastResult] = useState<{ rows: number; ms: number } | null>(null);

  // X6.85 — Reaction dashboard (single RPC, 7 sections)
  const [dashWindow, setDashWindow] = useState<number>(30);
  const [dashboard, setDashboard] = useState<StoreLearningDashboard | null>(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [dashError, setDashError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setDashLoading(true);
    setDashError(null);
    try {
      const d = await adminStoreLearningDashboard(dashWindow);
      setDashboard(d);
    } catch (e) {
      setDashError((e as Error).message);
    } finally {
      setDashLoading(false);
    }
  }, [dashWindow]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sum, list] = await Promise.all([
        adminStoreLearningSummary(30),
        adminListTrackStoreScores(storeFilter || undefined, 30, 200),
      ]);
      setSummary(sum);
      setRows(list);
    } catch (e) {
      toast.error(`로딩 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [storeFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    listTaxonomyStoreTypes().then(setStoreTypes).catch((e) => toast.error(`store 로딩 실패: ${e.message}`));
  }, []);

  const recompute = async () => {
    if (!confirm('최근 30일 데이터로 모든 (트랙 × 매장) 행을 재계산하시겠어요?')) return;
    setRecomputing(true);
    try {
      const r = await adminRecomputeTrackStoreBehaviorScores(30);
      setLastResult({ rows: r.rows_upserted, ms: r.elapsed_ms });
      toast.success(`${r.rows_upserted} 행 재계산 (${(r.elapsed_ms / 1000).toFixed(1)}s)`);
      await load();
    } catch (e) {
      toast.error(`재계산 실패: ${(e as Error).message}`);
    } finally { setRecomputing(false); }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.track_id)));
  };

  const selectedTrackIds = useMemo(() => Array.from(selected), [selected]);

  return (
    <div className="space-y-3">
      {/* X6.85 — Store Reaction Dashboard (👍/👎 분석) */}
      <ReactionDashboardPanel
        dashboard={dashboard}
        loading={dashLoading}
        error={dashError}
        windowDays={dashWindow}
        onChangeWindow={setDashWindow}
        onReload={() => void loadDashboard()}
      />

      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold flex items-center gap-1"><Store size={14} /> 매장 학습 (Store Learning)</h3>
          <div className="flex items-center gap-2 text-xs">
            <button onClick={() => void load()} disabled={loading}
              className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
            </button>
            <button onClick={() => void recompute()} disabled={recomputing}
              className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 font-bold text-black disabled:opacity-50">
              <Calculator size={11} className={recomputing ? 'animate-spin' : ''} /> 전체 재계산
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          score = completion×40 + replay×20 + like×20 − skip×30 + min(plays/10, 10) · confidence = min(plays/50, 1.0).
          playlist.business_category 는 normalize_store_label() 로 taxonomy slug 변환. <b>fit_score 미반영 — 인사이트만 제공</b>.
        </p>
        {lastResult && (
          <p className="mt-1 text-[11px] text-emerald-300">
            마지막 재계산: {lastResult.rows} 행 · {(lastResult.ms / 1000).toFixed(1)}s
          </p>
        )}
      </div>

      {summary && (
        <div className="rounded-xl bg-bg-card p-3">
          <h4 className="mb-2 text-xs font-bold">매장별 분포</h4>
          <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-3 lg:grid-cols-4">
            <div className="rounded bg-bg-deep p-2 col-span-2 md:col-span-3 lg:col-span-4 md:flex md:items-center md:gap-3">
              <span className="font-bold">총 {summary.total_rows} 행</span>
              <span className="text-ink-mute">· {summary.distinct_tracks} 트랙</span>
              <span className="text-ink-mute">· {Object.keys(summary.by_store ?? {}).length} 매장</span>
            </div>
            {summary.by_store && Object.entries(summary.by_store)
              .sort((a, b) => b[1].rows - a[1].rows)
              .map(([slug, info]) => (
                <button key={slug} onClick={() => setStoreFilter(storeFilter === slug ? '' : slug)}
                  className={`rounded p-2 text-left transition ${storeFilter === slug ? 'bg-accent/15 ring-1 ring-accent' : 'bg-bg-deep hover:bg-bg-hover'}`}>
                  <div className="font-bold text-[11px]">{slug}</div>
                  <div className="text-[10px] text-ink-dim">{info.rows} rows · {info.distinct_tracks} tracks</div>
                  <div className="text-[10px]">avg score <b>{info.avg_score}</b></div>
                  {(info.promotion_candidates > 0 || info.demotion_candidates > 0) && (
                    <div className="mt-1 flex gap-1 text-[10px]">
                      {info.promotion_candidates > 0 && <span className="rounded bg-emerald-500/20 px-1 text-emerald-300">↑{info.promotion_candidates}</span>}
                      {info.demotion_candidates > 0 && <span className="rounded bg-rose-500/20 px-1 text-rose-300">↓{info.demotion_candidates}</span>}
                    </div>
                  )}
                </button>
              ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-card p-3 text-xs">
        <span className="font-bold">필터:</span>
        <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}
          className="rounded bg-bg-deep px-2 py-1">
          <option value="">모든 매장</option>
          {storeTypes.map((s) => <option key={s.slug} value={s.slug}>{s.name_ko} ({s.slug})</option>)}
        </select>
        <span className="text-ink-dim">{rows.length} 행</span>
        {selected.size > 0 && (
          <>
            <span className="ml-auto rounded bg-accent/15 px-2 py-0.5 font-bold text-accent">Selected: {selected.size}</span>
            <button onClick={() => setSelected(new Set())} className="text-ink-dim hover:underline">해제</button>
            <button onClick={() => setBulkOpen(true)}
              className="inline-flex items-center gap-1 rounded bg-indigo-500 px-2 py-1 font-bold text-white">
              <Sparkles size={11} /> Bulk Actions
            </button>
          </>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">
          {loading ? '로딩 중…' : '데이터 없음. "전체 재계산" 을 실행하세요.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-bg-card">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim">
                <th className="px-2 py-2 w-8">
                  <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length}
                    ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < rows.length; }}
                    onChange={toggleAll} />
                </th>
                <th className="px-2 py-2">곡</th>
                <th className="px-2 py-2">매장</th>
                <th className="px-2 py-2 text-right">plays</th>
                <th className="px-2 py-2 text-right">conf</th>
                <th className="px-2 py-2 text-right">완료%</th>
                <th className="px-2 py-2 text-right">skip%</th>
                <th className="px-2 py-2 text-right">replay%</th>
                <th className="px-2 py-2 text-right">like%</th>
                <th className="px-2 py-2 text-right">score</th>
                <th className="px-2 py-2">신호</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={`${r.track_id}-${r.store_type_slug}-${idx}`} className="border-b border-line/10">
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={selected.has(r.track_id)} onChange={() => toggleOne(r.track_id)} />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="font-semibold">{r.title ?? '(제목없음)'}</div>
                    <div className="text-ink-dim">{r.artist ?? ''} · {r.main_genre ?? '—'}</div>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="font-semibold">{r.store_name_ko ?? r.store_type_slug}</div>
                    <div className="text-[10px] text-ink-dim">{r.store_type_slug}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.play_count}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-mute">{(r.confidence * 100).toFixed(0)}%</td>
                  <td className="px-2 py-1.5 text-right">
                    <span className={r.completion_rate < 0.3 && r.play_count >= 5 ? 'text-rose-300 font-bold' : ''}>
                      {(r.completion_rate * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <span className={r.skip_rate >= 0.6 && r.play_count >= 5 ? 'text-rose-300 font-bold' : ''}>
                      {(r.skip_rate * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right text-ink-mute">{(r.replay_rate * 100).toFixed(0)}%</td>
                  <td className="px-2 py-1.5 text-right">
                    <span className={r.like_rate > 0 ? 'text-emerald-300' : 'text-ink-mute'}>
                      {(r.like_rate * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <span className={`font-bold ${r.store_behavior_score >= 70 ? 'text-emerald-300' : r.store_behavior_score <= 30 ? 'text-rose-300' : ''}`}>
                      {r.store_behavior_score.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {r.is_promotion_candidate && <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">승격</span>}
                      {r.is_demotion_candidate && <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">강등</span>}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <button onClick={() => setEditorTrackId(r.track_id)}
                      className="inline-flex items-center gap-1 rounded bg-indigo-500/25 px-2 py-0.5 font-semibold text-indigo-500">
                      <ExternalLink size={10} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="rounded bg-bg-card px-3 py-2 text-[11px] text-ink-dim">
        ⚠️ 자동 삭제/차단/반려/승격/강등 금지. fit_score 절대 변경 안 됨. 추천/인사이트/QC 큐만 생성.
        QC 큐의 store_behavior_high_skip / store_behavior_low_completion / store_behavior_mismatch 룰과 연동.
      </p>

      {editorTrackId && (
        <TrackPlacementEditor trackId={editorTrackId} onClose={() => setEditorTrackId(null)} onMutated={() => { void load(); }} />
      )}
      {bulkOpen && selectedTrackIds.length > 0 && (
        <BulkActionsModal trackIds={selectedTrackIds} onClose={() => setBulkOpen(false)} onCompleted={() => { void load(); }} />
      )}
    </div>
  );
}

// =============================================================================
// X6.85 — Reaction Dashboard Panel (7 sections: A~G)
// =============================================================================

interface ReactionDashProps {
  dashboard: StoreLearningDashboard | null;
  loading: boolean;
  error: string | null;
  windowDays: number;
  onChangeWindow: (n: number) => void;
  onReload: () => void;
}

function ReactionDashboardPanel({
  dashboard, loading, error, windowDays, onChangeWindow, onReload,
}: ReactionDashProps) {
  return (
    <div className="rounded-xl bg-bg-card p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold flex items-center gap-1">
          <BarChart3 size={14} /> 매장 반응 대시보드 <span className="text-[10px] font-normal text-ink-dim">(X6.85)</span>
        </h3>
        <div className="flex items-center gap-2 text-xs">
          <select
            value={windowDays}
            onChange={(e) => onChangeWindow(Number(e.target.value))}
            disabled={loading}
            className="rounded bg-bg-deep px-2 py-1"
            aria-label="기간 선택"
          >
            <option value={7}>최근 7일</option>
            <option value={30}>최근 30일</option>
            <option value={90}>최근 90일</option>
          </select>
          <button
            onClick={onReload}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 hover:bg-bg-hover disabled:opacity-50"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded bg-rose-500/25 px-3 py-2 text-xs text-rose-300">
          <AlertCircle size={12} /> 로딩 실패: {error}
        </div>
      )}

      {loading && !dashboard && <DashboardSkeleton />}

      {!loading && !error && dashboard && dashboard.overview.total_reactions === 0 && (
        <p className="rounded bg-bg-deep px-3 py-6 text-center text-xs text-ink-dim">
          아직 수집된 매장 반응이 없습니다. 매장주가 👍/👎 버튼을 누르면 여기에 표시돼요.
        </p>
      )}

      {dashboard && dashboard.overview.total_reactions > 0 && (
        <>
          {/* A. KPI Overview */}
          <OverviewKpis d={dashboard} />

          {/* G. Readiness Score (KPI 옆에 작게) */}
          <ReadinessPanel d={dashboard} />

          {/* B. Top Liked */}
          <TopTracksTable
            title="좋아요 TOP 20"
            icon={<ThumbsUp size={12} className="text-emerald-300" />}
            rows={dashboard.topLiked}
            mode="like"
          />

          {/* C. Top Disliked */}
          <TopTracksTable
            title="별로 TOP 20"
            icon={<ThumbsDown size={12} className="text-amber-300" />}
            rows={dashboard.topDisliked}
            mode="dislike"
          />

          {/* D. Daily Trend */}
          <DailyTrendChart points={dashboard.dailyTrend} />

          {/* E + F. Store Types + Genres (옆에 배치) */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <StoreTypeTable rows={dashboard.storeTypes} />
            <GenreTable rows={dashboard.genres} />
          </div>

          <p className="text-[10px] text-ink-dim text-right">
            업데이트: {new Date(dashboard.computed_at).toLocaleString('ko-KR')} · 기간 {dashboard.window_days}일
          </p>
        </>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded bg-bg-deep" />
        ))}
      </div>
      <div className="h-24 animate-pulse rounded bg-bg-deep" />
      <div className="h-40 animate-pulse rounded bg-bg-deep" />
    </div>
  );
}

function OverviewKpis({ d }: { d: StoreLearningDashboard }) {
  const ov = d.overview;
  const cards: { label: string; value: string; tone?: string; icon?: React.ReactNode }[] = [
    { label: '총 좋아요', value: String(ov.total_likes ?? 0), tone: 'text-emerald-300', icon: <ThumbsUp size={11} /> },
    { label: '총 별로', value: String(ov.total_dislikes ?? 0), tone: 'text-amber-300', icon: <ThumbsDown size={11} /> },
    { label: `최근 ${d.window_days}일 반응`, value: `${(ov.recent_likes ?? 0) + (ov.recent_dislikes ?? 0)}`, icon: <TrendingUp size={11} /> },
    { label: '참여 매장 수', value: String(ov.unique_stores ?? 0), icon: <Store size={11} /> },
    { label: '좋아요 비율', value: ov.like_ratio != null ? `${ov.like_ratio}%` : '—', tone: 'text-accent' },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg bg-bg-deep p-2.5 ring-1 ring-line/10">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-dim">
            {c.icon}{c.label}
          </div>
          <div className={`mt-1 text-lg font-extrabold tabular-nums ${c.tone ?? 'text-ink'}`}>
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReadinessPanel({ d }: { d: StoreLearningDashboard }) {
  const r = d.readiness;
  const tone =
    r.status === 'READY' ? 'bg-emerald-500/25 text-emerald-300 ring-emerald-500/40' :
    r.status === 'MEDIUM' ? 'bg-amber-500/25 text-amber-300 ring-amber-500/40' :
    'bg-rose-500/25 text-rose-300 ring-rose-500/40';
  const labelKo =
    r.status === 'READY' ? '알고리즘 연동 준비 완료' :
    r.status === 'MEDIUM' ? '데이터 수집 중 (중간 단계)' :
    '데이터 부족 (수집 초기)';
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg p-3 ring-1 ${tone}`}>
      <div className="flex items-center gap-2">
        <Award size={16} />
        <div>
          <div className="text-xs font-bold">Learning Readiness · <span className="tabular-nums">{r.score}/100</span> · {r.status}</div>
          <div className="text-[11px] opacity-80">{labelKo}</div>
        </div>
      </div>
      <div className="text-[11px] opacity-80 tabular-nums">
        반응 {r.breakdown.reaction_score}/40 · 매장 {r.breakdown.store_score}/30 · 트랙 {r.breakdown.track_score}/30
      </div>
    </div>
  );
}

function TopTracksTable({
  title, icon, rows, mode,
}: {
  title: string;
  icon: React.ReactNode;
  rows: StoreLearningDashboard['topLiked'];
  mode: 'like' | 'dislike';
}) {
  if (!rows || rows.length === 0) {
    return (
      <div className="rounded-lg bg-bg-deep p-3">
        <h4 className="mb-2 text-xs font-bold flex items-center gap-1">{icon} {title}</h4>
        <p className="text-xs text-ink-dim">데이터 없음</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-bg-deep overflow-hidden">
      <h4 className="px-3 py-2 text-xs font-bold flex items-center gap-1 border-b border-line/10">
        {icon} {title}
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[10px] uppercase text-ink-dim">
              <th className="px-2 py-1.5">곡</th>
              <th className="px-2 py-1.5">아티스트</th>
              <th className="px-2 py-1.5">장르</th>
              <th className="px-2 py-1.5 text-right">👍</th>
              <th className="px-2 py-1.5 text-right">👎</th>
              <th className="px-2 py-1.5 text-right">{mode === 'like' ? '좋아요%' : '별로%'}</th>
              <th className="px-2 py-1.5 text-right">fit_score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.track_id} className="border-t border-line/5">
                <td className="px-2 py-1.5 font-semibold">{r.title ?? '(제목없음)'}</td>
                <td className="px-2 py-1.5 text-ink-mute">{r.artist ?? '—'}</td>
                <td className="px-2 py-1.5 text-ink-mute">{r.genre ?? '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-emerald-300">{r.like_count}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-amber-300">{r.dislike_count}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {mode === 'like'
                    ? (r.like_ratio != null ? `${r.like_ratio}%` : '—')
                    : (r.dislike_ratio != null ? `${r.dislike_ratio}%` : '—')}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-ink-mute">
                  {r.fit_score != null ? Number(r.fit_score).toFixed(1) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DailyTrendChart({ points }: { points: StoreLearningDashboard['dailyTrend'] }) {
  if (!points || points.length === 0) {
    return (
      <div className="rounded-lg bg-bg-deep p-3">
        <h4 className="mb-2 text-xs font-bold flex items-center gap-1"><TrendingUp size={12} /> 일자별 반응 추이</h4>
        <p className="text-xs text-ink-dim">데이터 없음</p>
      </div>
    );
  }
  const max = Math.max(1, ...points.map((p) => Math.max(p.likes, p.dislikes)));
  const W = 600;
  const H = 100;
  const stepX = points.length > 1 ? W / (points.length - 1) : 0;
  const path = (key: 'likes' | 'dislikes') =>
    points.map((p, i) => {
      const x = i * stepX;
      const y = H - (p[key] / max) * H;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');

  return (
    <div className="rounded-lg bg-bg-deep p-3">
      <h4 className="mb-2 text-xs font-bold flex items-center gap-1">
        <TrendingUp size={12} /> 일자별 반응 추이 ({points.length}일)
      </h4>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full" style={{ minWidth: 400 }}>
          {[0.25, 0.5, 0.75].map((g) => (
            <line key={g} x1={0} y1={H * g} x2={W} y2={H * g}
              stroke="currentColor" className="text-ink-dim opacity-10" />
          ))}
          <path d={path('likes')} fill="none" stroke="#34d399" strokeWidth={2} />
          <path d={path('dislikes')} fill="none" stroke="#fbbf24" strokeWidth={2} />
          {points.map((p, i) => {
            const x = i * stepX;
            const yL = H - (p.likes / max) * H;
            const yD = H - (p.dislikes / max) * H;
            return (
              <g key={p.date}>
                <circle cx={x} cy={yL} r={2} fill="#34d399" />
                <circle cx={x} cy={yD} r={2} fill="#fbbf24" />
                {i % Math.max(1, Math.floor(points.length / 7)) === 0 && (
                  <text x={x} y={H + 14} textAnchor="middle" fontSize={9}
                    fill="currentColor" className="text-ink-dim">
                    {p.date.slice(5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex items-center gap-3 mt-1 text-[10px] text-ink-dim">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-1.5 w-3 bg-emerald-400" /> 좋아요</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-1.5 w-3 bg-amber-400" /> 별로</span>
        <span className="ml-auto">최댓값 {max}</span>
      </div>
    </div>
  );
}

function StoreTypeTable({ rows }: { rows: StoreLearningDashboard['storeTypes'] }) {
  return (
    <div className="rounded-lg bg-bg-deep overflow-hidden">
      <h4 className="px-3 py-2 text-xs font-bold flex items-center gap-1 border-b border-line/10">
        <Store size={12} /> 매장 유형별 분석
      </h4>
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-xs text-ink-dim">데이터 없음</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[10px] uppercase text-ink-dim">
              <th className="px-2 py-1.5">유형</th>
              <th className="px-2 py-1.5 text-right">👍</th>
              <th className="px-2 py-1.5 text-right">👎</th>
              <th className="px-2 py-1.5 text-right">좋아요%</th>
              <th className="px-2 py-1.5 text-right">반응</th>
              <th className="px-2 py-1.5 text-right">매장</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.store_type} className="border-t border-line/5">
                <td className="px-2 py-1.5 font-semibold">{r.store_type}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-emerald-300">{r.likes}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-amber-300">{r.dislikes}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {r.like_ratio != null ? `${r.like_ratio}%` : '—'}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-ink-mute">{r.reactions}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-ink-mute">{r.stores}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function GenreTable({ rows }: { rows: StoreLearningDashboard['genres'] }) {
  return (
    <div className="rounded-lg bg-bg-deep overflow-hidden">
      <h4 className="px-3 py-2 text-xs font-bold flex items-center gap-1 border-b border-line/10">
        <Sparkles size={12} /> 장르별 분석
      </h4>
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-xs text-ink-dim">데이터 없음</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[10px] uppercase text-ink-dim">
              <th className="px-2 py-1.5">장르</th>
              <th className="px-2 py-1.5 text-right">👍</th>
              <th className="px-2 py-1.5 text-right">👎</th>
              <th className="px-2 py-1.5 text-right">좋아요%</th>
              <th className="px-2 py-1.5 text-right">반응</th>
              <th className="px-2 py-1.5 text-right">트랙</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.genre} className="border-t border-line/5">
                <td className="px-2 py-1.5 font-semibold">{r.genre}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-emerald-300">{r.likes}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-amber-300">{r.dislikes}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {r.like_ratio != null ? `${r.like_ratio}%` : '—'}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-ink-mute">{r.reactions}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-ink-mute">{r.tracks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
