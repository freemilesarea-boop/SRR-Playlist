/**
 * WeightTuningTab — X6.68 / Phase 4 (fit_score 가중치 자동 조정 첫 단계).
 *
 * 기능:
 *   1) 현재 ai_scoring_config 가중치 (audio/meta/behavior/penalty) 표시
 *   2) 진단 RPC 결과 표시:
 *      - sample_size + confidence (low/medium/high)
 *      - mismatches (fit≥70 인데 skip 많은 곡, fit<40 인데 completion 높은 곡)
 *      - correlations (각 sub-score vs completion_rate)
 *   3) 알고리즘 제안 가중치 (상관계수 기반 reweight) — 1-click 적용
 *   4) 수동 조정 (슬라이더) — 즉시 적용
 *   5) 변경 history (최근 20건, audit trail)
 *
 * 정책: 완전 자동 적용 없음. admin 이 항상 최종 결정.
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Sparkles, History, AlertTriangle, TrendingUp, TrendingDown, FlaskConical, Check, X as XIcon } from 'lucide-react';
import {
  getAiScoringConfig,
  updateAiScoringConfig,
  adminWeightDiagnostics,
  adminSuggestWeightAdjustment,
  adminListWeightHistory,
  adminComputeRegressionWeights,
  adminListWeightRegressions,
  adminDecideWeightRegression,
  type AiScoringConfig,
  type WeightDiagnostics,
  type WeightSuggestion,
  type WeightHistoryRow,
  type WeightRegressionRow,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';

const WEIGHT_KEYS = ['fit_audio_w', 'fit_meta_w', 'fit_behavior_w', 'fit_penalty_w'] as const;
const WEIGHT_LABEL: Record<typeof WEIGHT_KEYS[number], string> = {
  fit_audio_w: '오디오 (audio)',
  fit_meta_w: '메타데이터 (meta)',
  fit_behavior_w: '재생 행동 (behavior)',
  fit_penalty_w: '페널티 (penalty)',
};

export default function WeightTuningTab() {
  const [config, setConfig] = useState<AiScoringConfig | null>(null);
  const [diag, setDiag] = useState<WeightDiagnostics | null>(null);
  const [suggest, setSuggest] = useState<WeightSuggestion | null>(null);
  const [history, setHistory] = useState<WeightHistoryRow[]>([]);
  const [pendingRegressions, setPendingRegressions] = useState<WeightRegressionRow[]>([]);
  const [recentRegressions, setRecentRegressions] = useState<WeightRegressionRow[]>([]);
  const [draft, setDraft] = useState<Partial<AiScoringConfig>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [regressing, setRegressing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, d, s, h, pending, recent] = await Promise.all([
        getAiScoringConfig(),
        adminWeightDiagnostics(30),
        adminSuggestWeightAdjustment(30),
        adminListWeightHistory(20),
        adminListWeightRegressions('pending', 5),
        adminListWeightRegressions('all', 10),
      ]);
      setConfig(c); setDiag(d); setSuggest(s); setHistory(h);
      setPendingRegressions(pending);
      setRecentRegressions(recent);
      setDraft({});
    } catch (e) {
      toast.error(`불러오기 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function runRegression() {
    setRegressing(true);
    try {
      const res = await adminComputeRegressionWeights(30);
      if (res.queued) {
        toast.success(`회귀 큐 적재됨 (sample N=${res.sample_size})`);
      } else {
        toast.info(`큐 안됨: ${res.reason ?? '미상'} (sample=${res.sample_size ?? 0})`);
      }
      await load();
    } catch (e) {
      toast.error(`회귀 실행 실패: ${(e as Error).message}`);
    } finally {
      setRegressing(false);
    }
  }

  async function decideRegression(id: string, approve: boolean) {
    const note = approve ? null : prompt('거부 사유 (선택)') ?? null;
    if (approve && !confirm('이 회귀 제안을 승인하고 가중치를 즉시 적용할까요?')) return;
    setBusy(true);
    try {
      await adminDecideWeightRegression(id, approve, note ?? undefined);
      toast.success(approve ? '승인 + 가중치 적용됨' : '거부됨');
      await load();
    } catch (e) {
      toast.error(`처리 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function applyDraft() {
    if (Object.keys(draft).length === 0) return;
    setBusy(true);
    try {
      const updated = await updateAiScoringConfig(draft);
      setConfig(updated);
      setDraft({});
      toast.success('가중치 적용됨 — fit_score 재계산이 필요합니다 (적합도 탭에서 recompute).');
      await load();
    } catch (e) {
      toast.error(`적용 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function applySuggestion() {
    if (!suggest?.suggestion) return;
    if (!confirm(
      `알고리즘 제안 가중치를 적용할까요?\n\n` +
      WEIGHT_KEYS.map((k) => {
        const cur = config?.[k] ?? 0;
        const next = suggest.suggestion![k];
        const diff = next - cur;
        return `${WEIGHT_LABEL[k]}: ${cur.toFixed(2)} → ${next.toFixed(2)} (${diff >= 0 ? '+' : ''}${diff.toFixed(2)})`;
      }).join('\n') +
      '\n\nfit_score 재계산은 별도 진행 필요.',
    )) return;
    setBusy(true);
    try {
      const updated = await updateAiScoringConfig(suggest.suggestion);
      setConfig(updated);
      toast.success('제안 가중치 적용됨 — fit_score 재계산 권장 (적합도 탭).');
      await load();
    } catch (e) {
      toast.error(`적용 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!config) {
    return <div className="text-sm text-ink-mute">{loading ? '불러오는 중…' : '설정을 불러올 수 없어요.'}</div>;
  }

  const draftSum = WEIGHT_KEYS.reduce((s, k) => s + (draft[k] ?? config[k]), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold">가중치 튜닝 (Phase 4)</h3>
          <p className="text-xs text-ink-mute">
            fit_score = audio×W₁ + meta×W₂ + behavior×W₃ − penalty×W₄ + ai_boost. 현재 가중치를 실제 사용자 행동 데이터로 진단합니다.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading || busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-bg-card px-3 py-1.5 text-xs font-semibold ring-1 ring-line/10 hover:bg-bg-hover disabled:opacity-40"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      {/* 1. 진단 카드 */}
      <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <header className="mb-2 flex items-center gap-2">
          <Sparkles size={14} className="text-accent" />
          <h4 className="text-sm font-bold">진단 (지난 {diag?.window_days ?? 30}일)</h4>
          {diag && (
            <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${
              diag.confidence === 'high' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : diag.confidence === 'medium' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
              : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
            }`}>
              신뢰도 {diag.confidence === 'high' ? '높음' : diag.confidence === 'medium' ? '중간' : '낮음'}
              {' '}(샘플 {diag.sample_size})
            </span>
          )}
        </header>
        {diag && (
          <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
            <div className="rounded-xl bg-bg-soft p-3 ring-1 ring-line/10">
              <p className="font-semibold text-ink">불일치 신호</p>
              <ul className="mt-1 space-y-1 text-ink-mute">
                <li>
                  <span className="text-rose-600 dark:text-rose-300">fit≥70 인데 skip 40%+</span>:{' '}
                  <b>{diag.mismatches.high_fit_high_skip}곡</b> ({diag.mismatches.high_fit_high_skip_pct ?? 0}%)
                  <span className="ml-1 text-[10px]">— audio 가중치 과다신뢰 의심</span>
                </li>
                <li>
                  <span className="text-emerald-700 dark:text-emerald-300">fit&lt;40 인데 completion 60%+</span>:{' '}
                  <b>{diag.mismatches.low_fit_high_completion}곡</b> ({diag.mismatches.low_fit_high_completion_pct ?? 0}%)
                  <span className="ml-1 text-[10px]">— behavior 가중치 과소신뢰 의심</span>
                </li>
              </ul>
            </div>
            <div className="rounded-xl bg-bg-soft p-3 ring-1 ring-line/10">
              <p className="font-semibold text-ink">상관계수 (vs 완청률)</p>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-ink-mute">
                <li>audio: {fmtCorr(diag.correlations.audio_vs_completion)}</li>
                <li>meta: {fmtCorr(diag.correlations.meta_vs_completion)}</li>
                <li>behavior: {fmtCorr(diag.correlations.behavior_vs_completion)}</li>
                <li>penalty: {fmtCorr(diag.correlations.penalty_vs_completion)}</li>
              </ul>
              <p className="mt-1 text-[10px] text-ink-dim">|상관|이 큰 feature 의 가중치를 높이는 것이 정렬도 향상에 유리.</p>
            </div>
          </div>
        )}
        {diag && diag.sample_size < 50 && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-500/10 p-2 text-[11px] text-amber-800 ring-1 ring-amber-400/30 dark:text-amber-200">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>샘플이 50곡 미만이라 통계 신뢰도가 낮아요. 가중치 변경을 권장하지 않습니다. (track_behavior_scores window_days=30, play_count≥5 조건)</span>
          </div>
        )}
      </section>

      {/* 2. 알고리즘 제안 */}
      {suggest?.suggestion && (
        <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
          <header className="mb-2 flex items-center gap-2">
            <Sparkles size={14} className="text-accent" />
            <h4 className="text-sm font-bold">알고리즘 제안 가중치</h4>
            {suggest.high_drift && (
              <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                변동 큼 (max drift {suggest.max_drift?.toFixed(2)})
              </span>
            )}
          </header>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-mute">
                <th className="pb-1">가중치</th>
                <th className="pb-1 text-right">현재</th>
                <th className="pb-1 text-right">제안</th>
                <th className="pb-1 text-right">변화</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {WEIGHT_KEYS.map((k) => {
                const cur = config[k];
                const next = suggest.suggestion![k];
                const diff = next - cur;
                return (
                  <tr key={k} className="border-t border-line/10">
                    <td className="py-1 font-sans text-ink">{WEIGHT_LABEL[k]}</td>
                    <td className="py-1 text-right text-ink-mute">{cur.toFixed(2)}</td>
                    <td className="py-1 text-right font-bold text-ink">{next.toFixed(2)}</td>
                    <td className={`py-1 text-right ${diff > 0.01 ? 'text-emerald-700 dark:text-emerald-300' : diff < -0.01 ? 'text-rose-700 dark:text-rose-300' : 'text-ink-dim'}`}>
                      {diff > 0 && <TrendingUp size={10} className="inline" />}
                      {diff < 0 && <TrendingDown size={10} className="inline" />}
                      {diff >= 0 ? '+' : ''}{diff.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button
            onClick={() => void applySuggestion()}
            disabled={busy}
            className="mt-3 w-full rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black hover:opacity-90 disabled:opacity-40"
          >
            {busy ? '적용 중…' : '제안 가중치 적용 (1-click)'}
          </button>
          <p className="mt-2 text-[10px] text-ink-dim">{suggest.note ?? ''}</p>
        </section>
      )}
      {suggest && !suggest.suggestion && (
        <section className="rounded-2xl bg-bg-card p-4 text-xs text-ink-mute ring-1 ring-line/10">
          알고리즘 제안: <b>{suggest.reason === 'insufficient_sample'
            ? `샘플 부족 (${suggest.sample_size}/${suggest.min_required ?? 50})`
            : suggest.reason === 'no_signal_correlation'
              ? '상관 신호 없음 — 현재 가중치 유지'
              : suggest.reason ?? '미제공'}</b>
        </section>
      )}

      {/* 2b. 회귀 가중치 + 승인 큐 (Phase 4b) */}
      <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <header className="mb-3 flex items-center gap-2">
          <FlaskConical size={14} className="text-accent" />
          <h4 className="text-sm font-bold">회귀 가중치 최적화 (Phase 4b)</h4>
          <button
            onClick={() => void runRegression()}
            disabled={regressing || busy}
            className="ml-auto rounded-md bg-accent px-3 py-1 text-[11px] font-bold text-black hover:opacity-90 disabled:opacity-40"
          >
            {regressing ? '실행 중…' : '회귀 실행 + 큐 적재'}
          </button>
        </header>
        <p className="mb-3 text-[11px] text-ink-mute">
          PostgreSQL 내장 회귀 (regr_slope, regr_r2) 로 sub-score 별 R² 정규화 → 큐에 pending 으로 적재.
          관리자 승인 시 자동 적용 + history 자동 audit. 표본 50 미만 또는 R² 합 0.05 미만이면 큐 안됨.
        </p>

        {pendingRegressions.length === 0 && (
          <p className="text-[11px] text-ink-dim">대기 중인 제안 없음</p>
        )}

        {pendingRegressions.map((r) => (
          <div key={r.id} className="mb-2 rounded-xl bg-amber-500/5 p-3 ring-1 ring-amber-400/20">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs font-bold text-ink">대기 (sample N={r.sample_size})</span>
              <span className="text-[10px] text-ink-dim">
                {new Date(r.computed_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
              </span>
            </div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-ink-mute">
                  <th className="pb-0.5">가중치</th>
                  <th className="pb-0.5 text-right">현재</th>
                  <th className="pb-0.5 text-right">제안</th>
                  <th className="pb-0.5 text-right">R²</th>
                  <th className="pb-0.5 text-right">slope</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {WEIGHT_KEYS.map((k) => {
                  const cur = config[k];
                  const next = r.suggestion[k];
                  const diff = next - cur;
                  const featKey = k === 'fit_audio_w' ? 'audio'
                    : k === 'fit_meta_w' ? 'meta'
                      : k === 'fit_behavior_w' ? 'behavior' : 'penalty';
                  const reg = r.regression[featKey];
                  return (
                    <tr key={k} className="border-t border-line/5">
                      <td className="py-0.5 font-sans text-ink">{WEIGHT_LABEL[k]}</td>
                      <td className="py-0.5 text-right text-ink-mute">{cur.toFixed(2)}</td>
                      <td className={`py-0.5 text-right font-bold ${diff > 0.01 ? 'text-emerald-700 dark:text-emerald-300' : diff < -0.01 ? 'text-rose-700 dark:text-rose-300' : 'text-ink'}`}>
                        {next.toFixed(2)}
                      </td>
                      <td className="py-0.5 text-right text-ink-mute">{reg.r2.toFixed(3)}</td>
                      <td className="py-0.5 text-right text-ink-dim">{reg.slope.toFixed(4)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-2 flex gap-1.5">
              <button
                onClick={() => void decideRegression(r.id, true)}
                disabled={busy}
                className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-40"
              >
                <Check size={12} /> 승인 + 적용
              </button>
              <button
                onClick={() => void decideRegression(r.id, false)}
                disabled={busy}
                className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-bg-soft px-3 py-1.5 text-xs font-semibold text-ink-mute ring-1 ring-line/10 hover:text-ink disabled:opacity-40"
              >
                <XIcon size={12} /> 거부
              </button>
            </div>
          </div>
        ))}

        {/* 최근 결정된 회귀 (간단 목록) */}
        {recentRegressions.filter((r) => r.status !== 'pending').length > 0 && (
          <details className="mt-3 text-[11px]">
            <summary className="cursor-pointer text-ink-mute">최근 회귀 ({recentRegressions.length}건)</summary>
            <ul className="mt-1 space-y-0.5">
              {recentRegressions.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between rounded bg-bg-soft px-2 py-0.5">
                  <span>
                    <span className={`mr-1 inline-block rounded px-1 text-[9px] font-bold ${
                      r.status === 'approved' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : r.status === 'rejected' ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                      : 'bg-ink/10 text-ink-dim'
                    }`}>{r.status}</span>
                    N={r.sample_size}
                    {' · '}
                    {WEIGHT_KEYS.map((k) => r.suggestion[k].toFixed(2)).join('/')}
                  </span>
                  <span className="text-ink-dim">{new Date(r.computed_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short' })}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* 3. 수동 편집 */}
      <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <h4 className="mb-2 text-sm font-bold">수동 조정</h4>
        <div className="space-y-2">
          {WEIGHT_KEYS.map((k) => {
            const val = draft[k] ?? config[k];
            return (
              <label key={k} className="block">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ink">{WEIGHT_LABEL[k]}</span>
                  <span className="font-mono text-ink-mute">{val.toFixed(2)}</span>
                </div>
                <input
                  type="range" min={0} max={1} step={0.05} value={val}
                  onChange={(e) => setDraft((d) => ({ ...d, [k]: Number(e.target.value) }))}
                  className="w-full"
                  disabled={busy}
                />
              </label>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-ink-mute">합계: <b className={draftSum < 0.9 || draftSum > 1.1 ? 'text-amber-700 dark:text-amber-300' : ''}>{draftSum.toFixed(2)}</b>
            <span className="ml-1 text-[10px] text-ink-dim">(권장 1.00 — 너무 벗어나면 fit_score 스케일 변형)</span>
          </span>
          <div className="flex gap-1.5">
            <button
              onClick={() => setDraft({})}
              disabled={busy || Object.keys(draft).length === 0}
              className="rounded-md bg-bg-soft px-3 py-1.5 text-xs font-semibold text-ink-mute ring-1 ring-line/10 hover:text-ink disabled:opacity-40"
            >
              취소
            </button>
            <button
              onClick={() => void applyDraft()}
              disabled={busy || Object.keys(draft).length === 0}
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-40"
            >
              적용
            </button>
          </div>
        </div>
      </section>

      {/* 4. History */}
      <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <header className="mb-2 flex items-center gap-2">
          <History size={14} className="text-ink-mute" />
          <h4 className="text-sm font-bold">변경 이력 ({history.length}건)</h4>
        </header>
        {history.length === 0 && <p className="text-xs text-ink-dim">기록 없음</p>}
        {history.length > 0 && (
          <ul className="space-y-1.5 text-[11px]">
            {history.map((h, i) => (
              <li key={i} className="rounded-lg bg-bg-soft p-2 ring-1 ring-line/5">
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold text-ink">{h.changed_by_name ?? '(unknown)'}</span>
                  <span className="text-ink-dim">
                    {new Date(h.changed_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                  </span>
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-ink-mute">
                  {WEIGHT_KEYS.map((k) => {
                    const o = Number(h.old_config[k] ?? 0);
                    const n = Number(h.new_config[k] ?? 0);
                    if (Math.abs(o - n) < 0.005) return null;
                    return `${k.replace('fit_', '').replace('_w', '')}: ${o.toFixed(2)}→${n.toFixed(2)}`;
                  }).filter(Boolean).join(' · ') || '(no weight diff)'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function fmtCorr(v: number): string {
  if (Math.abs(v) >= 0.5) return `${v >= 0 ? '+' : ''}${v.toFixed(3)} (강함)`;
  if (Math.abs(v) >= 0.3) return `${v >= 0 ? '+' : ''}${v.toFixed(3)} (중간)`;
  return `${v >= 0 ? '+' : ''}${v.toFixed(3)} (약함)`;
}
