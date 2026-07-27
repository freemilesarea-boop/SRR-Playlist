// AiLearningDashboardTab — Phase AI-LEARNING-ENGINE-1
//
// 관리자/HQ 전용 학습 현황 대시보드.
//   매장 재생 피드백 → Reaction Score → Adaptive Score(min-sample gated) → Queue Re-rank
// 을 한눈에 보여준다: fit vs adaptive vs 적용값 + 차이 + skip/완곡률 + 표본 + 상태.
//
// 안전:
//   • 조회는 read-only (admin_ai_learning_dashboard, 0465).
//   • "배치 재계산"(admin_ai_recompute_adaptive_scores) 은 명시적 관리자 액션 —
//     cron 없음. track_adaptive_scores 를 materialize → 다음 rotation 부터 반영.
//   • 피드백 수집 토글은 이 기기(localStorage) 한정. 큐/재생에는 영향 없음(learning-only).
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Brain, Sparkles, ShieldAlert, Database } from 'lucide-react';

import { fetchPlaylists } from '@/lib/api';
import { fetchMemberList, type MemberRow } from '@/lib/adminApi';
import type { PlaylistRow } from '@/types/db';
import { toast } from '@/store/toastStore';
import { adminTones } from '@/lib/adminTones';
import {
  adminAiLearningDashboard,
  adminAiRecomputeAdaptiveScores,
} from '@/lib/api/aiLearningApi';
import {
  learningStatusLabel,
  learningStatusTone,
  formatDifference,
  differenceTone,
  formatRate,
  formatSampleProgress,
  MIN_SAMPLE,
  type LearningDashboardResult,
} from '@/lib/aiLearningEngine';
import {
  isFeedbackCollectionEnabled,
  setFeedbackCollectionEnabled,
} from '@/hooks/useStorePlaybackFeedback';

export default function AiLearningDashboardTab() {
  const [stores, setStores] = useState<MemberRow[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [storeId, setStoreId] = useState<string>('');
  const [pid, setPid] = useState<string>('');

  const [data, setData] = useState<LearningDashboardResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [collect, setCollect] = useState<boolean>(() => isFeedbackCollectionEnabled());

  useEffect(() => {
    fetchMemberList({ role: undefined, limit: 200 })
      .then((rows) => {
        const biz = rows.filter((r) => r.account_type === 'business' && !r.withdrawn_at);
        setStores(biz);
        if (biz[0]) setStoreId((prev) => prev || biz[0].id);
      })
      .catch((e) => console.warn('[AiLearningDashboardTab] fetchMemberList failed:', e));
    fetchPlaylists()
      .then((p) => { setPlaylists(p); if (p[0]) setPid((prev) => prev || p[0].id); })
      .catch((e) => console.warn('[AiLearningDashboardTab] fetchPlaylists failed:', e));
  }, []);

  const load = useCallback(async () => {
    if (!storeId || !pid) return;
    setLoading(true);
    try {
      setData(await adminAiLearningDashboard(storeId, pid));
    } catch (e) {
      toast.error(`학습 현황 조회 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [storeId, pid]);

  const recompute = useCallback(async () => {
    if (!storeId || !pid) return;
    setRecomputing(true);
    try {
      const r = await adminAiRecomputeAdaptiveScores(storeId, pid);
      toast.success(`배치 재계산 완료 — ${r.updated}곡 갱신 · ${r.active}곡 학습 적용`);
      await load();
    } catch (e) {
      toast.error(`배치 재계산 실패: ${(e as Error).message}`);
    } finally {
      setRecomputing(false);
    }
  }, [storeId, pid, load]);

  function toggleCollect(on: boolean) {
    setFeedbackCollectionEnabled(on);
    setCollect(on);
  }

  const tracks = data?.tracks ?? [];
  const activeCount = tracks.filter((t) => t.learning_status === 'active').length;

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          title="매장(사업자 계정)"
          className="min-w-[12rem] rounded-lg bg-bg-card px-3 py-2 text-xs ring-1 ring-line/10"
        >
          {stores.length === 0 && <option value="">사업자 계정 없음</option>}
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nickname || s.email || s.id.slice(0, 8)}
            </option>
          ))}
        </select>
        <select
          value={pid}
          onChange={(e) => setPid(e.target.value)}
          title="플레이리스트"
          className="min-w-[12rem] rounded-lg bg-bg-card px-3 py-2 text-xs ring-1 ring-line/10"
        >
          {playlists.length === 0 && <option value="">플레이리스트 없음</option>}
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
        <button
          onClick={() => void load()}
          disabled={loading || !storeId || !pid}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 현황 조회
        </button>
        <button
          onClick={() => void recompute()}
          disabled={recomputing || !storeId || !pid}
          title="매장 반응을 반영해 adaptive score 를 다시 계산합니다 (다음 rotation 부터 적용)."
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          <Database size={12} className={recomputing ? 'animate-pulse' : ''} /> 배치 재계산
        </button>
      </div>

      {/* Collection toggle (device-scoped) */}
      <label className="flex items-center gap-2 rounded-xl bg-bg-card px-3 py-2 text-xs ring-1 ring-line/10">
        <input
          type="checkbox"
          checked={collect}
          onChange={(e) => toggleCollect(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        <span className="font-semibold">이 기기에서 재생 피드백 수집</span>
        <span className="text-ink-dim">
          — 매장 플레이어에서 play/complete/skip 등을 기록합니다. 큐·재생에는 영향 없음(learning-only).
        </span>
      </label>

      <p className="flex items-center gap-1.5 text-[11px] text-ink-dim">
        <ShieldAlert size={12} className={`shrink-0 ${adminTones.warning.icon}`} />
        학습은 표본 {MIN_SAMPLE}회 이상일 때만 적용됩니다(그 전까지 fit_score 유지). 재계산 전까지는 적용값이 갱신되지 않습니다.
      </p>

      {/* Summary */}
      {data && (
        <div className="grid grid-cols-3 gap-2">
          <StatCard icon={<Brain size={13} />} label="트랙" value={String(tracks.length)} />
          <StatCard icon={<Sparkles size={13} />} label="학습 적용" value={String(activeCount)} tone="text-emerald-300" />
          <StatCard icon={<Database size={13} />} label="수집 중" value={String(tracks.length - activeCount)} tone="text-amber-300" />
        </div>
      )}

      {/* Table */}
      {!data ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">
          {loading ? '조회 중…' : '매장과 플레이리스트를 고르고 "현황 조회"를 눌러보세요.'}
        </p>
      ) : tracks.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">
          플레이리스트에 트랙이 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-bg-card ring-1 ring-line/10">
          <table className="w-full min-w-[44rem] text-xs">
            <thead>
              <tr className="border-b border-line/10 text-left text-[11px] text-ink-dim">
                <th className="px-3 py-2 font-semibold">트랙</th>
                <th className="px-2 py-2 text-right font-semibold" title="원래 적합도">Fit</th>
                <th className="px-2 py-2 text-right font-semibold" title="매장 반응 점수 (0~100)">반응</th>
                <th className="px-2 py-2 text-right font-semibold" title="반응 반영 후 (실시간 계산)">Adaptive</th>
                <th className="px-2 py-2 text-right font-semibold" title="Adaptive − Fit">차이</th>
                <th className="px-2 py-2 text-right font-semibold" title="완곡률">완곡</th>
                <th className="px-2 py-2 text-right font-semibold" title="스킵률">스킵</th>
                <th className="px-2 py-2 text-right font-semibold" title="표본 수 (재생 횟수)">표본</th>
                <th className="px-2 py-2 text-center font-semibold">상태</th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((t) => (
                <tr key={t.track_id} className="border-b border-line/5 last:border-0">
                  <td className="px-3 py-2">
                    <div className="min-w-0 max-w-[16rem] truncate font-medium">{t.title ?? '(제목없음)'}</div>
                    <div className="truncate text-[10px] text-ink-dim">{t.artist ?? ''}</div>
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-mute">{Math.round(t.fit_score)}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-mute">{Math.round(t.reaction_score)}</td>
                  <td className="px-2 py-2 text-right font-mono font-bold tabular-nums text-emerald-300">
                    {Math.round(t.adaptive_score_live)}
                    {t.adaptive_score_applied != null &&
                      Math.round(t.adaptive_score_applied) !== Math.round(t.adaptive_score_live) && (
                        <span className="ml-1 text-[10px] font-normal text-ink-dim" title="현재 적용된 값 (재계산 필요)">
                          (적용 {Math.round(t.adaptive_score_applied)})
                        </span>
                      )}
                  </td>
                  <td className={`px-2 py-2 text-right font-mono tabular-nums ${differenceTone(t.difference)}`}>
                    {formatDifference(t.difference)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-mute">{formatRate(t.completion_rate)}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-mute">{formatRate(t.skip_rate)}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-ink-mute">{formatSampleProgress(t.sample_count)}</td>
                  <td className="px-2 py-2 text-center">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${learningStatusTone(t.learning_status)}`}>
                      {learningStatusLabel(t.learning_status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon, label, value, tone = 'text-ink',
}: {
  icon: React.ReactNode; label: string; value: string; tone?: string;
}) {
  return (
    <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
      <div className="flex items-center gap-1.5 text-[11px] text-ink-dim">{icon} {label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}
