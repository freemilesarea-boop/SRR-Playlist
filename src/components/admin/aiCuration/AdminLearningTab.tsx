/**
 * AdminLearningTab — 관리자 결정 학습 시각화 (X6.59 / Tier AI-Learning Phase 2)
 *
 * 백엔드: 0332 migration (decision_pattern_clusters).
 * 표시:
 *   - 통과 vs 탈락 cluster 비교 (feature 평균)
 *   - 사유별 cluster 카드 (sample_count, 평균 feature, variant 변형)
 *   - 트랙 ID 입력 → cluster 유사도 점수 (어느 사유와 가까운가)
 *   - "재학습" 버튼 (refresh_decision_pattern_clusters RPC)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Brain, RefreshCw, Search, CheckCircle2, XCircle, Target } from 'lucide-react';
import {
  adminListDecisionClusters,
  adminScoreTrackClusters,
  refreshDecisionPatternClusters,
  type DecisionClusterRow,
  type ClusterScoreRow,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';

// 표시할 핵심 feature 들 (label 한글)
const FEATURE_DISPLAY: { key: string; label: string; format?: (n: number) => string }[] = [
  { key: 'bpm', label: 'BPM', format: (n) => n.toFixed(0) },
  { key: 'energy', label: 'Energy', format: (n) => n.toFixed(2) },
  { key: 'danceability', label: 'Dance', format: (n) => n.toFixed(2) },
  { key: 'instrumentalness', label: 'Instr', format: (n) => n.toFixed(2) },
  { key: 'acousticness', label: 'Acoust', format: (n) => n.toFixed(2) },
  { key: 'vocal_presence', label: 'Vocal', format: (n) => n.toFixed(2) },
  { key: 'brightness', label: 'Bright', format: (n) => n.toFixed(2) },
  { key: 'valence', label: 'Valence', format: (n) => n.toFixed(2) },
];

function decisionLabel(type: string): { label: string; tone: string } {
  switch (type) {
    case 'approve': return { label: '통과', tone: 'bg-emerald-500/15 text-emerald-600' };
    case 'remove': return { label: '탈락', tone: 'bg-rose-500/15 text-rose-600' };
    case 'exclude_store': return { label: '매장 제외', tone: 'bg-amber-500/15 text-amber-700' };
    case 'rereview': return { label: '재검수', tone: 'bg-sky-500/15 text-sky-600' };
    default: return { label: type, tone: 'bg-ink/5 text-ink-mute' };
  }
}

function fmt(n: number | undefined | null, decimals = 2): string {
  if (n == null || isNaN(Number(n))) return '—';
  const num = Number(n);
  return decimals === 0 ? num.toFixed(0) : num.toFixed(decimals);
}

export default function AdminLearningTab() {
  const [clusters, setClusters] = useState<DecisionClusterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 트랙 점수 조회 widget
  const [trackId, setTrackId] = useState('');
  const [scores, setScores] = useState<ClusterScoreRow[]>([]);
  const [scoring, setScoring] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setClusters(await adminListDecisionClusters(0));
    } catch (e) {
      toast.error(friendlyError(e, 'cluster 조회 실패'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function refresh() {
    setRefreshing(true);
    try {
      const r = await refreshDecisionPatternClusters();
      toast.success(`재학습 완료 — ${r.clusters_built}개 cluster (${r.source_decisions}건 결정 분석)`);
      await load();
    } catch (e) {
      toast.error(friendlyError(e, '재학습 실패'));
    } finally {
      setRefreshing(false);
    }
  }

  async function scoreTrack() {
    if (!trackId.trim()) return;
    setScoring(true);
    setScores([]);
    try {
      setScores(await adminScoreTrackClusters(trackId.trim()));
    } catch (e) {
      toast.error(friendlyError(e, '점수 계산 실패'));
    } finally {
      setScoring(false);
    }
  }

  // 통과 / 탈락 비교용
  const approved = useMemo(() => clusters.find((c) => c.decision_type === 'approve'), [clusters]);
  const removed = useMemo(() => clusters.filter((c) => c.decision_type === 'remove').sort((a, b) => b.sample_count - a.sample_count), [clusters]);

  return (
    <div className="space-y-4">
      {/* Header + refresh */}
      <div className="rounded-xl bg-bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Brain size={18} className="text-accent" />
            <h3 className="text-sm font-bold">관리자 결정 학습</h3>
            <span className="text-[10px] text-ink-dim">
              {clusters.length} cluster · 통과 {approved?.sample_count ?? 0}곡 · 탈락 {removed.reduce((s, r) => s + r.sample_count, 0)}곡 분석
            </span>
          </div>
          <button onClick={() => void refresh()} disabled={refreshing}
            className="inline-flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs font-bold text-black hover:bg-accent/90 disabled:opacity-50">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> 재학습
          </button>
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          매일 관리자의 승인/거절/매장 제외 결정 + audio features (BPM/energy/instrumentalness/...) 를 결합해 사유별 cluster center 를 계산합니다.
          새 트랙이 어떤 cluster 와 가까운지 즉시 평가 가능.
        </p>
      </div>

      {/* 트랙 점수 조회 widget */}
      <div className="rounded-xl bg-bg-card p-3">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold">
          <Target size={14} className="text-accent" /> 트랙 ↔ Cluster 유사도 검사
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          <input type="text" placeholder="track_id (UUID)" value={trackId}
            onChange={(e) => setTrackId(e.target.value)}
            className="w-72 rounded bg-bg-deep px-2 py-1.5 text-xs" />
          <button onClick={() => void scoreTrack()} disabled={scoring || !trackId.trim()}
            className="inline-flex items-center gap-1.5 rounded bg-bg-deep px-3 py-1.5 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">
            <Search size={12} /> 점수 계산
          </button>
          {scoring && <span className="text-xs text-ink-mute">계산 중…</span>}
        </div>
        {scores.length > 0 && (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-[10px] uppercase text-ink-dim">
                <tr className="border-b border-line/10">
                  <th className="py-1 pr-2">유사도</th>
                  <th>사유</th>
                  <th>유형</th>
                  <th>매장</th>
                  <th>샘플</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((s) => {
                  const meta = decisionLabel(s.decision_type);
                  const color = s.similarity_pct >= 70 ? 'text-rose-500' : s.similarity_pct >= 40 ? 'text-amber-500' : 'text-emerald-500';
                  return (
                    <tr key={`${s.reason_key}:${s.decision_type}:${s.store_type ?? ''}`} className="border-b border-line/10">
                      <td className={`py-1 pr-2 font-bold tabular-nums ${color}`}>{fmt(s.similarity_pct, 1)}%</td>
                      <td className="py-1 pr-2 font-semibold">{s.reason_display}</td>
                      <td className="py-1 pr-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${meta.tone}`}>{meta.label}</span></td>
                      <td className="py-1 pr-2 text-ink-mute">{s.store_type ?? '전체'}</td>
                      <td className="py-1 pr-2 tabular-nums text-ink-dim">{s.cluster_sample_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-1 text-[10px] text-ink-dim">
              ≥70% 유사 = 매우 가까움 (해당 cluster 와 동일 패턴) / 40~70% = 가능성 / &lt;40% = 다른 패턴
            </p>
          </div>
        )}
      </div>

      {/* 통과 vs 탈락 핵심 비교 */}
      {approved && removed.length > 0 && (
        <div className="rounded-xl bg-bg-card p-3">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold">
            <CheckCircle2 size={14} className="text-emerald-500" /> 통과 vs 탈락 핵심 차이
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-[10px] uppercase text-ink-dim">
                <tr className="border-b border-line/10">
                  <th className="py-1 pr-2">Feature</th>
                  <th className="py-1 pr-2 text-emerald-500">통과 ({approved.sample_count}곡)</th>
                  {removed.slice(0, 3).map((r) => (
                    <th key={r.reason_key} className="py-1 pr-2 text-rose-500">
                      {r.reason_display} ({r.sample_count}곡)
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FEATURE_DISPLAY.map((feat) => {
                  const aVal = approved.feature_means[feat.key];
                  return (
                    <tr key={feat.key} className="border-b border-line/10">
                      <td className="py-1 pr-2 font-semibold text-ink-mute">{feat.label}</td>
                      <td className="py-1 pr-2 tabular-nums text-emerald-500">{aVal != null ? (feat.format ? feat.format(Number(aVal)) : fmt(aVal)) : '—'}</td>
                      {removed.slice(0, 3).map((r) => {
                        const rVal = r.feature_means[feat.key];
                        const delta = aVal != null && rVal != null ? Number(rVal) - Number(aVal) : null;
                        const arrow = delta == null ? '' : delta > 0 ? ' ↑' : delta < 0 ? ' ↓' : '';
                        const tone = delta == null || Math.abs(delta) < 0.05 ? 'text-ink-mute' : delta > 0 ? 'text-amber-500' : 'text-sky-500';
                        return (
                          <td key={r.reason_key} className={`py-1 pr-2 tabular-nums ${tone}`}>
                            {rVal != null ? (feat.format ? feat.format(Number(rVal)) : fmt(rVal)) : '—'}{arrow}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-ink-dim">
            ↑ = 통과보다 높음, ↓ = 통과보다 낮음. 0.05 미만 차이는 회색. 통과 cluster 와의 거리가 학습된 패턴.
          </p>
        </div>
      )}

      {/* 모든 cluster 목록 */}
      <div className="rounded-xl bg-bg-card p-3">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold">
          <XCircle size={14} className="text-rose-500" /> Cluster 전체 ({clusters.length})
        </h4>
        {loading ? (
          <p className="py-4 text-center text-xs text-ink-dim">불러오는 중…</p>
        ) : clusters.length === 0 ? (
          <p className="py-4 text-center text-xs text-ink-dim">
            cluster 가 없습니다. "재학습" 을 눌러 첫 학습 시작.
          </p>
        ) : (
          <div className="space-y-2">
            {clusters.map((c) => {
              const meta = decisionLabel(c.decision_type);
              const totalDecisions = c.feature_means.total_decisions;
              return (
                <div key={`${c.reason_key}:${c.decision_type}:${c.store_type ?? ''}`}
                  className="rounded-lg bg-bg-soft p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${meta.tone}`}>{meta.label}</span>
                      <h5 className="text-sm font-bold">{c.reason_display}</h5>
                      {c.store_type && <span className="rounded bg-bg-card px-1.5 py-0.5 text-[10px] text-ink-mute">{c.store_type}</span>}
                    </div>
                    <span className="text-[11px] text-ink-dim">
                      features 샘플 {c.sample_count}곡 · 총 결정 {totalDecisions ?? '—'}건
                    </span>
                  </div>

                  {/* feature 평균 */}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                    {FEATURE_DISPLAY.map((feat) => {
                      const val = c.feature_means[feat.key];
                      if (val == null) return null;
                      return (
                        <span key={feat.key} className="text-ink-mute">
                          <span className="text-[10px] uppercase text-ink-dim">{feat.label}</span>{' '}
                          <b className="tabular-nums text-ink">{feat.format ? feat.format(Number(val)) : fmt(val)}</b>
                        </span>
                      );
                    })}
                  </div>

                  {/* 원본 사유 변형 */}
                  {c.reason_variants.length > 1 && (
                    <details className="mt-2 text-[11px]">
                      <summary className="cursor-pointer text-ink-dim">
                        원본 사유 변형 ({c.reason_variants.length}종) — 표준화로 통합됨
                      </summary>
                      <ul className="mt-1 space-y-0.5 pl-3 text-ink-mute">
                        {c.reason_variants.map((v, i) => <li key={i} className="break-all">· {v}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
