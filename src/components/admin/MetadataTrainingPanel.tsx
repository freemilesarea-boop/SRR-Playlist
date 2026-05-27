import { useEffect, useState, useCallback } from 'react';
import { Brain, Loader2, Sliders, Check, X, Eye, Activity, FlaskConical } from 'lucide-react';
import { toast } from '@/store/toastStore';
import {
  fetchMetadataTrainingStats, type MetadataTrainingStats,
  generateWeightSuggestions, listWeightSuggestions, decideWeightSuggestion, type WeightSuggestion,
  fetchWeightSuggestionSamples, type WeightSuggestionSample,
  simulateWeightSuggestion, type WeightSimulation,
  createShadowFromSuggestion, simulateShadowConfig, decideShadowConfig, type ShadowSimResult,
} from '@/lib/metadataTraining';

const SUGGESTION_LABEL: Record<string, string> = {
  store_overpredict: '매장 과예측(가중치↓)',
  store_underpredict: '매장 누락(가중치↑)',
  uploader_trust_down: '업로더 신뢰도↓',
};

const CORRECTION_LABEL: Record<string, string> = {
  ai_correct: 'AI 정답',
  ai_wrong: 'AI 오답(유저 정답)',
  user_wrong: '유저 오답',
  both_wrong: '둘 다 오답',
  admin_override: '관리자 신규분류',
};

export default function MetadataTrainingPanel() {
  const [days, setDays] = useState(90);
  const [stats, setStats] = useState<MetadataTrainingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<WeightSuggestion[]>([]);
  const [sugLoading, setSugLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [samplesFor, setSamplesFor] = useState<WeightSuggestion | null>(null);
  const [samples, setSamples] = useState<WeightSuggestionSample[]>([]);
  const [samplesLoading, setSamplesLoading] = useState(false);

  const [simFor, setSimFor] = useState<WeightSuggestion | null>(null);
  const [sim, setSim] = useState<WeightSimulation | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [shadowFor, setShadowFor] = useState<WeightSuggestion | null>(null);
  const [shadowId, setShadowId] = useState<string | null>(null);
  const [shadowResult, setShadowResult] = useState<ShadowSimResult | null>(null);
  const [shadowLoading, setShadowLoading] = useState(false);

  function openSamples(s: WeightSuggestion) {
    setSamplesFor(s);
    setSamples([]);
    setSamplesLoading(true);
    fetchWeightSuggestionSamples(s.id, 10)
      .then(setSamples)
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => setSamplesLoading(false));
  }
  function openSim(s: WeightSuggestion) {
    setSimFor(s);
    setSim(null);
    setSimLoading(true);
    simulateWeightSuggestion(s.id, 50)
      .then(setSim)
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => setSimLoading(false));
  }
  function openShadow(s: WeightSuggestion) {
    setShadowFor(s);
    setShadowResult(null);
    setShadowId(null);
    setShadowLoading(true);
    createShadowFromSuggestion(s.id)
      .then((id) => { setShadowId(id); return simulateShadowConfig(id, 500); })
      .then(setShadowResult)
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => setShadowLoading(false));
  }
  async function onDecideShadow(decision: 'approved_for_apply' | 'rejected') {
    if (!shadowId) return;
    try {
      await decideShadowConfig(shadowId, decision);
      toast.success(decision === 'approved_for_apply' ? '반영 준비 완료로 표시 (실제 반영은 별도 단계)' : '반려됨');
      setShadowFor(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    fetchMetadataTrainingStats(days)
      .then((s) => { if (alive) setStats(s); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [days]);

  const loadSuggestions = useCallback(() => {
    setSugLoading(true);
    listWeightSuggestions()
      .then(setSuggestions)
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => setSugLoading(false));
  }, []);
  useEffect(() => { loadSuggestions(); }, [loadSuggestions]);

  async function onGenerate() {
    setGenerating(true);
    try {
      const n = await generateWeightSuggestions(days, 5);
      toast.success(`제안 ${n}건 생성/갱신`);
      loadSuggestions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }
  async function onDecide(id: string, decision: 'approved' | 'rejected') {
    try {
      await decideWeightSuggestion(id, decision);
      toast.success(decision === 'approved' ? '승인됨 (반영은 별도 단계)' : '반려됨');
      loadSuggestions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <Brain size={15} className="text-accent" /> 메타데이터 학습 데이터
        </h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="input w-auto text-xs">
          <option value={7}>최근 7일</option>
          <option value={30}>최근 30일</option>
          <option value={90}>최근 90일</option>
          <option value={365}>최근 1년</option>
        </select>
      </header>
      <p className="text-[11px] leading-relaxed text-ink-mute">
        업로더 입력값 · AI 예측값 · 관리자 최종 확정값(정답)을 비교해 누적합니다. 관리자가 메타를 수정/확정할 때 자동 기록되며,
        모델 자동 변경은 하지 않고 향후 가중치 보정(관리자 승인)에 사용합니다.
      </p>

      {loading && <div className="flex items-center gap-2 text-xs text-ink-mute"><Loader2 size={14} className="animate-spin" /> 불러오는 중…</div>}
      {err && <div className="rounded-lg bg-rose-500/10 p-3 text-xs text-rose-600 ring-1 ring-rose-400/20">{err}</div>}

      {stats && !loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="총 학습 예시" value={stats.total_examples} />
            <Stat label="AI 평가 대상" value={stats.ai_evaluated} />
            <Stat label="AI 정답률" value={stats.ai_accuracy != null ? `${stats.ai_accuracy}%` : '—'} accent />
            <Stat label="기간(일)" value={stats.window_days} />
          </div>

          <Section title="유형별 분포">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(stats.by_correction_type ?? {}).map(([k, v]) => (
                <span key={k} className="rounded-full bg-bg-soft px-2.5 py-1 text-[11px] ring-1 ring-line/10">
                  {CORRECTION_LABEL[k] ?? k}: <b>{v}</b>
                </span>
              ))}
              {Object.keys(stats.by_correction_type ?? {}).length === 0 && <Empty />}
            </div>
          </Section>

          <Section title="매장별 AI 오답률 (관리자 최종 기준)">
            <BarList items={(stats.ai_wrong_by_store ?? []).map((s) => ({ label: s.store, sub: `${s.wrong}/${s.total}`, rate: s.wrong_rate ?? 0 }))} />
          </Section>

          <Section title="장르별 AI 오답">
            <BarList items={(stats.ai_wrong_by_genre ?? []).map((g) => ({ label: g.genre, sub: `${g.wrong}/${g.total}`, rate: g.total ? Math.round((100 * g.wrong) / g.total) : 0 }))} />
          </Section>

          <Section title="AI가 자주 틀리는 패턴 (AI 예측 → 관리자 최종)">
            {(stats.frequent_ai_miss ?? []).length === 0 ? <Empty /> : (
              <ul className="space-y-1 text-[11px]">
                {stats.frequent_ai_miss.map((m, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-600">{m.ai || '(없음)'}</span>
                    <span className="text-ink-dim">→</span>
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600">{m.admin || '(없음)'}</span>
                    <span className="ml-auto font-mono text-ink-dim">{m.n}건</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="업로더 과장 태그 빈도 (user_wrong)">
            {(stats.uploader_user_wrong ?? []).length === 0 ? <Empty /> : (
              <ul className="space-y-1 text-[11px]">
                {stats.uploader_user_wrong.map((u) => (
                  <li key={u.owner_user_id} className="flex items-center gap-2">
                    <span className="font-mono text-ink-dim">{u.owner_user_id.slice(0, 8)}…</span>
                    <span className="ml-auto">오답 <b className="text-rose-600">{u.user_wrong}</b> / {u.total}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}

      <section className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink-mute">
            <Sliders size={13} /> 가중치 수정 제안 (승인 필요 · 자동 반영 안 함)
          </h3>
          <button
            type="button"
            onClick={() => void onGenerate()}
            disabled={generating}
            className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2.5 py-1.5 text-[11px] font-semibold text-accent hover:bg-accent/25 disabled:opacity-50"
          >
            {generating ? <Loader2 size={12} className="animate-spin" /> : <Sliders size={12} />} 제안 생성
          </button>
        </div>
        <p className="mb-2 text-[10px] text-ink-dim">
          학습 데이터에서 AI가 자주 틀리는 패턴을 분석해 권고만 만듭니다. 승인해도 실제 가중치는 바뀌지 않으며, 반영은 별도 단계에서 수동 진행합니다.
        </p>
        {sugLoading && <div className="flex items-center gap-2 text-xs text-ink-mute"><Loader2 size={14} className="animate-spin" /> 불러오는 중…</div>}
        {!sugLoading && suggestions.length === 0 && <Empty />}
        <ul className="space-y-1.5">
          {suggestions.map((s) => (
            <li key={s.id} className="rounded-lg bg-bg-soft/50 p-2 ring-1 ring-line/10">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded bg-bg-soft px-1.5 py-0.5 font-semibold">{SUGGESTION_LABEL[s.suggestion_type] ?? s.suggestion_type}</span>
                <span className="font-mono text-ink-dim">{s.target_kind === 'uploader' ? s.target_key.slice(0, 8) + '…' : s.target_key}</span>
                {s.confidence != null && <span className="text-ink-dim">신뢰도 {Math.round(s.confidence * 100)}%</span>}
                <StatusChip status={s.status} />
                <span className="ml-auto flex gap-1">
                  <button type="button" onClick={() => openSamples(s)} className="inline-flex items-center gap-0.5 rounded bg-bg-soft px-2 py-1 text-[10px] font-semibold text-ink-mute ring-1 ring-line/10 hover:text-ink"><Eye size={11} /> 근거 샘플</button>
                  <button type="button" onClick={() => openSim(s)} className="inline-flex items-center gap-0.5 rounded bg-sky-500/15 px-2 py-1 text-[10px] font-semibold text-sky-600 hover:bg-sky-500/25"><Activity size={11} /> 영향도 시뮬레이션</button>
                  <button type="button" onClick={() => openShadow(s)} className="inline-flex items-center gap-0.5 rounded bg-violet-500/15 px-2 py-1 text-[10px] font-semibold text-violet-600 hover:bg-violet-500/25"><FlaskConical size={11} /> Shadow 정밀</button>
                  {s.status === 'pending' && (
                    <>
                      <button type="button" onClick={() => void onDecide(s.id, 'approved')} className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-600 hover:bg-emerald-500/25"><Check size={11} /> 승인</button>
                      <button type="button" onClick={() => void onDecide(s.id, 'rejected')} className="inline-flex items-center gap-0.5 rounded bg-rose-500/15 px-2 py-1 text-[10px] font-semibold text-rose-600 hover:bg-rose-500/25"><X size={11} /> 반려</button>
                    </>
                  )}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink">{s.suggested_action}</p>
              {s.target_config_key && <p className="mt-0.5 font-mono text-[10px] text-ink-dim">knob: {s.target_config_key}</p>}
            </li>
          ))}
        </ul>
      </section>

      {samplesFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setSamplesFor(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-bg-card p-4 ring-1 ring-line/10 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold">근거 샘플 — {SUGGESTION_LABEL[samplesFor.suggestion_type] ?? samplesFor.suggestion_type} · {samplesFor.target_kind === 'uploader' ? samplesFor.target_key.slice(0, 8) + '…' : samplesFor.target_key}</h3>
              <button type="button" onClick={() => setSamplesFor(null)} className="rounded p-1 text-ink-dim hover:bg-bg-soft hover:text-ink"><X size={16} /></button>
            </div>
            {samplesLoading && <div className="flex items-center gap-2 text-xs text-ink-mute"><Loader2 size={14} className="animate-spin" /> 불러오는 중…</div>}
            {!samplesLoading && samples.length === 0 && <Empty />}
            <ul className="space-y-2">
              {samples.map((s, i) => (
                <li key={s.track_id + i} className="rounded-lg bg-bg-soft/50 p-2.5 text-[11px] ring-1 ring-line/10">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{s.track_title || '(제목 없음)'}</span>
                    <span className="text-ink-dim">· {s.artist_email || s.owner_user_id?.slice(0, 8) || '—'}</span>
                    {s.correction_type && <span className="rounded-full bg-bg-soft px-1.5 py-0.5 text-[10px] ring-1 ring-line/10">{s.correction_type}</span>}
                    {s.changed_at && <span className="ml-auto text-[10px] text-ink-dim">{new Date(s.changed_at).toLocaleDateString()}</span>}
                  </div>
                  <div className="mt-1.5 grid grid-cols-1 gap-1 sm:grid-cols-3">
                    <MetaCol label="업로더 입력" tags={s.user_metadata?.store_tags} tone="dim" />
                    <MetaCol label="AI 예측" tags={s.ai_metadata?.store_tags} tone="rose" />
                    <MetaCol label="관리자 최종" tags={s.admin_final_metadata?.store_tags} tone="emerald" />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] text-ink-dim">read-only · 가중치 자동 변경 없음</p>
          </div>
        </div>
      )}

      {simFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setSimFor(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-bg-card p-4 ring-1 ring-line/10 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold">영향도 시뮬레이션 — {SUGGESTION_LABEL[simFor.suggestion_type] ?? simFor.suggestion_type} · {simFor.target_kind === 'uploader' ? simFor.target_key.slice(0, 8) + '…' : simFor.target_key}</h3>
              <button type="button" onClick={() => setSimFor(null)} className="rounded p-1 text-ink-dim hover:bg-bg-soft hover:text-ink"><X size={16} /></button>
            </div>
            {simLoading && <div className="flex items-center gap-2 text-xs text-ink-mute"><Loader2 size={14} className="animate-spin" /> 계산 중…</div>}
            {sim && !simLoading && (
              <div className="space-y-3">
                <div className="rounded-lg bg-sky-500/10 p-2 text-[11px] text-sky-700 ring-1 ring-sky-400/20 dark:text-sky-300">
                  가상 변화량 <b>{sim.proposed_delta > 0 ? '+' : ''}{sim.proposed_delta}p</b> (추천 컷오프 {sim.current_config?.fit_recommend_cutoff}, 제외 {sim.current_config?.store_exclude_threshold}) · <b>실제 적용 아님</b>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Stat label="영향받는 곡" value={sim.affected_tracks_count} />
                  <Stat label="추천→제외 예상" value={sim.would_drop_below_recommend} accent />
                  <Stat label="신규 추천 예상" value={sim.would_enter_recommend} accent />
                  <Stat label="제외기준 이하" value={sim.would_be_excluded} />
                  <Stat label="플레이리스트 영향" value={sim.playlist_impact_count} />
                  <Stat label={`민감매장 위험 ${sim.guardrail_conflict_change_estimate?.direction === 'increase' ? '증가' : '감소'}`} value={sim.guardrail_conflict_change_estimate?.estimate ?? 0} />
                </div>
                <Section title={`샘플 곡 (${sim.sample_tracks?.length ?? 0})`}>
                  {(sim.sample_tracks ?? []).length === 0 ? <Empty /> : (
                    <ul className="space-y-1.5 text-[11px]">
                      {sim.sample_tracks.map((t, i) => (
                        <li key={t.track_id + i} className="rounded-lg bg-bg-soft/50 p-2 ring-1 ring-line/10">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{t.title || '(제목 없음)'}</span>
                            <span className="text-ink-dim">{t.artist_email || '—'}</span>
                            {t.in_playlists && <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600">플리 포함</span>}
                            <span className="ml-auto font-mono">
                              {t.current_score}
                              <span className="text-ink-dim"> → </span>
                              <b className={t.delta < 0 ? 'text-rose-600' : 'text-emerald-600'}>{t.simulated_score}</b>
                              <span className="text-ink-dim"> ({t.delta > 0 ? '+' : ''}{t.delta})</span>
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                            <span className={`rounded px-1.5 py-0.5 ${t.currently_recommended ? 'bg-emerald-500/10 text-emerald-600' : 'bg-bg-soft text-ink-dim'}`}>현재 {t.currently_recommended ? '추천' : '비추천'}</span>
                            <span className="text-ink-dim">→</span>
                            <span className={`rounded px-1.5 py-0.5 ${t.simulated_recommended ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>예상 {t.simulated_recommended ? '추천' : '비추천'}</span>
                            <span className="ml-2 text-ink-dim">상위매장 {(t.current_top_stores ?? []).join(',') || '—'} → {(t.simulated_top_stores ?? []).join(',') || '—'}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
                <p className="text-[10px] text-ink-dim">read-only 추정 · ai_scoring_config/ai_store_profiles/score 변경 없음. 트러스트 제안은 최대 적합도 기준 근사 추정.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {shadowFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setShadowFor(null)}>
          <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-bg-card p-4 ring-1 ring-line/10 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-bold"><FlaskConical size={15} className="text-violet-500" /> Shadow 정밀 시뮬레이션</h3>
              <button type="button" onClick={() => setShadowFor(null)} className="rounded p-1 text-ink-dim hover:bg-bg-soft hover:text-ink"><X size={16} /></button>
            </div>
            <div className="mb-2 rounded-lg bg-violet-500/10 p-2 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-400/20 dark:text-violet-300">
              ⚠ 실제 반영 아님 (shadow). 운영 config·store profile·fit score 미변경. 실제 추천 공식으로 재계산한 예측치입니다.
            </div>
            {shadowLoading && <div className="flex items-center gap-2 text-xs text-ink-mute"><Loader2 size={14} className="animate-spin" /> 정밀 재계산 중…</div>}
            {shadowResult && !shadowLoading && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="영향 곡" value={shadowResult.affected_tracks_count} />
                  <Stat label="추천 변화" value={shadowResult.changed_recommendations_count} accent />
                  <Stat label="추천 탈락" value={shadowResult.dropped_from_recommendation_count} />
                  <Stat label="신규 추천" value={shadowResult.newly_recommended_count} />
                  <Stat label="제외 전환" value={shadowResult.excluded_count} />
                  <Stat label="플리 영향" value={shadowResult.playlist_impact_count} />
                  <Stat label="민감매장 위험Δ" value={shadowResult.guardrail_conflict_change} />
                  <Stat label="위험/안전" value={`${shadowResult.risky_changes?.length ?? 0}/${shadowResult.safe_changes?.length ?? 0}`} />
                </div>
                {(shadowResult.risky_changes?.length ?? 0) > 0 && (
                  <Section title={`위험 변화 (${shadowResult.risky_changes.length})`}>
                    <ShadowList items={shadowResult.risky_changes} />
                  </Section>
                )}
                <Section title={`변경된 곡 (${shadowResult.top_changed_tracks?.length ?? 0})`}>
                  {(shadowResult.top_changed_tracks?.length ?? 0) === 0 ? <Empty /> : <ShadowList items={shadowResult.top_changed_tracks} />}
                </Section>
                <p className="text-[10px] text-ink-dim">{shadowResult.note}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void onDecideShadow('approved_for_apply')} className="flex-1 rounded-lg bg-emerald-500/15 py-2 text-xs font-bold text-emerald-700 ring-1 ring-emerald-400/30 hover:bg-emerald-500/25 dark:text-emerald-300">반영 준비 완료 (실제 반영 X)</button>
                  <button type="button" onClick={() => void onDecideShadow('rejected')} className="flex-1 rounded-lg bg-rose-500/15 py-2 text-xs font-bold text-rose-700 ring-1 ring-rose-400/30 hover:bg-rose-500/25 dark:text-rose-300">반려</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ShadowList({ items }: { items: Array<{ track_id: string; store: string | null; current_score: number | null; shadow_score: number; current_status: string | null; shadow_status: string; in_playlist: boolean; risk_reason: string | null }> }) {
  return (
    <ul className="space-y-1 text-[11px]">
      {items.map((t, i) => (
        <li key={t.track_id + i} className="flex flex-wrap items-center gap-2 rounded bg-bg-soft/50 p-1.5">
          <span className="font-mono text-ink-dim">{t.track_id.slice(0, 8)}</span>
          {t.store && <span className="rounded bg-bg-soft px-1.5 py-0.5 text-[10px]">{t.store}</span>}
          <span className="font-mono">{t.current_score ?? '—'} → <b className={t.shadow_score < (t.current_score ?? 0) ? 'text-rose-600' : 'text-emerald-600'}>{t.shadow_score}</b></span>
          <span className="text-[10px] text-ink-dim">{t.current_status} → {t.shadow_status}</span>
          {t.in_playlist && <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600">플리</span>}
          {t.risk_reason && <span className="ml-auto rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-600">{t.risk_reason}</span>}
        </li>
      ))}
    </ul>
  );
}

function MetaCol({ label, tags, tone }: { label: string; tags: string[] | null | undefined; tone: 'dim' | 'rose' | 'emerald' }) {
  const cls = tone === 'rose' ? 'bg-rose-500/10 text-rose-600' : tone === 'emerald' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-bg-soft text-ink-mute';
  return (
    <div>
      <div className="mb-0.5 text-[9px] uppercase tracking-wide text-ink-dim">{label}</div>
      <div className="flex flex-wrap gap-1">
        {(tags && tags.length > 0) ? tags.map((t, i) => <span key={i} className={`rounded px-1.5 py-0.5 text-[10px] ${cls}`}>{t}</span>) : <span className="text-[10px] text-ink-dim">—</span>}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-amber-500/15 text-amber-600',
    approved: 'bg-emerald-500/15 text-emerald-600',
    rejected: 'bg-rose-500/15 text-rose-600',
  };
  const label: Record<string, string> = { pending: '대기', approved: '승인', rejected: '반려' };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${map[status] ?? 'bg-bg-soft'}`}>{label[status] ?? status}</span>;
}

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-bg-soft/60 p-3 ring-1 ring-line/10">
      <div className="text-[10px] uppercase tracking-wide text-ink-dim">{label}</div>
      <div className={`text-lg font-extrabold ${accent ? 'text-accent' : ''}`}>{value}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
      <h3 className="mb-2 text-xs font-semibold text-ink-mute">{title}</h3>
      {children}
    </section>
  );
}
function BarList({ items }: { items: Array<{ label: string; sub: string; rate: number }> }) {
  if (items.length === 0) return <Empty />;
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-2 text-[11px]">
          <span className="w-28 shrink-0 truncate">{it.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded bg-bg-soft">
            <div className="h-full bg-rose-400/70" style={{ width: `${Math.min(100, it.rate)}%` }} />
          </div>
          <span className="w-16 shrink-0 text-right font-mono text-ink-dim">{it.rate}% ({it.sub})</span>
        </li>
      ))}
    </ul>
  );
}
function Empty() {
  return <p className="text-[11px] text-ink-dim">아직 데이터가 없어요.</p>;
}
