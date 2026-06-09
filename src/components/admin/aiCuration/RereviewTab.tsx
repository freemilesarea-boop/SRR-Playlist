import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  rereviewBatch,
  finalizeRereview,
  rereviewSummary,
  rereviewQueue,
  rereviewTrackDetail,
  rereviewAction,
  applyAiMetadataAndRecompute,
  type RereviewSummary,
  type RereviewQueueRow,
  type RereviewDetail,
  type RereviewActionType,
  type RecomputeResult,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';
import MetaApproveModal from '@/components/admin/MetaApproveModal';
import { PStat, canApproveStatus, storeLabel } from './shared';

export default function RereviewTab() {
  const [summary, setSummary] = useState<RereviewSummary | null>(null);
  const [rows, setRows] = useState<RereviewQueueRow[]>([]);
  const [filter, setFilter] = useState('needs_re_review');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<RereviewDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [autoResolve, setAutoResolve] = useState(true);
  const [results, setResults] = useState<Record<string, RecomputeResult>>({});
  const [metaModal, setMetaModal] = useState<{ track_id: string; title: string | null; canApprove: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, q] = await Promise.all([rereviewSummary(), rereviewQueue(filter, 300)]);
      setSummary(s); setRows(q); setSelected(new Set());
    } catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { void load(); }, [load]);

  async function runFull() {
    if (!window.confirm('전체 재검수를 실행할까요? (진단/플래그만 — 자동 삭제·비공개 없음)')) return;
    setRunning(true);
    try {
      let offset = 0; let total = 0; let processed = 0;
      for (;;) {
        const r = await rereviewBatch(offset, 20);
        total = r.total; processed += r.processed;
        setProgress(`AI 메타 재계산… ${Math.min(offset + 20, total)}/${total}`);
        if (!r.has_more) break;
        offset = r.next_offset;
      }
      setProgress('guardrail/trust/플래그 생성 중…');
      const fin = await finalizeRereview();
      toast.success(`재검수 완료 — ${processed}곡 처리, 플래그 ${fin.flags_upserted}건`);
      await load();
    } catch (e) { toast.error(`재검수 실패: ${(e as Error).message}`); }
    finally { setRunning(false); setProgress(null); }
  }

  async function act(trackIds: string[], action: RereviewActionType, storeKey?: string, note?: string) {
    if (trackIds.length === 0) { toast.error('선택된 곡이 없어요.'); return; }
    setBusy(true);
    try { const r = await rereviewAction(trackIds, action, storeKey, note); toast.success(`처리됨 (${r.affected}곡)`); await load(); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  async function applyMetaOne(trackId: string) {
    setBusy(true);
    try {
      const res = await applyAiMetadataAndRecompute(trackId, { autoResolve });
      setResults((p) => ({ ...p, [trackId]: res }));
      toast.success(res.warning ? `적용됨 — 경고 있음` : `적용 + 재평가 완료`);
      const [s, q] = await Promise.all([rereviewSummary(), rereviewQueue(filter, 300)]);
      setSummary(s); setRows(q);
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  async function bulkApplyMeta() {
    const ids = [...selected];
    if (ids.length === 0) { toast.error('선택된 곡이 없어요.'); return; }
    setBusy(true);
    let ok = 0; let fail = 0; const acc: Record<string, RecomputeResult> = {};
    for (let i = 0; i < ids.length; i++) {
      setProgress(`AI 메타 적용 + 재평가… ${i + 1}/${ids.length} (성공 ${ok} · 실패 ${fail})`);
      try { acc[ids[i]] = await applyAiMetadataAndRecompute(ids[i], { autoResolve }); ok += 1; }
      catch { fail += 1; }
    }
    setResults((p) => ({ ...p, ...acc }));
    toast[fail ? 'error' : 'success'](`일괄 적용 완료 — 성공 ${ok} · 실패 ${fail}`);
    setProgress(null);
    try { const [s, q] = await Promise.all([rereviewSummary(), rereviewQueue(filter, 300)]); setSummary(s); setRows(q); }
    catch { /* noop */ }
    setBusy(false);
  }
  async function bulkRemoveConflicts() {
    const targets = rows.filter((r) => selected.has(r.track_id) && (r.blocked_declared_stores?.length ?? 0) > 0);
    if (targets.length === 0) { toast.error('충돌 매장이 있는 선택 곡이 없어요.'); return; }
    setBusy(true);
    try {
      let n = 0;
      for (const r of targets) {
        for (const sk of r.blocked_declared_stores ?? []) { await rereviewAction([r.track_id], 'remove_declared_store', sk); }
        n += 1;
      }
      toast.success(`충돌 태그 제거 완료 (${n}곡)`); await load();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  async function toggleExpand(id: string) {
    if (expanded === id) { setExpanded(null); setDetail(null); return; }
    setExpanded(id); setDetail(null); setDetailLoading(true);
    try { setDetail(await rereviewTrackDetail(id)); }
    catch (e) { toast.error(`상세 실패: ${(e as Error).message}`); }
    finally { setDetailLoading(false); }
  }

  function toggleSel(id: string) { setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function selAll() { setSelected((p) => p.size === rows.length ? new Set() : new Set(rows.map((r) => r.track_id))); }
  const selIds = [...selected];

  const FILTERS: [string, string][] = [
    ['needs_re_review', '재검수 필요'], ['high_risk', '고위험'], ['quality_review_required', '품질 재검수'],
    ['guardrail_hard', '매장 차단'], ['mismatch_high', '불일치 high'], ['low_trust', '저신뢰'],
    ['metadata_cleanup_required', '메타 정리/재분류'],
    ['store:hospital', '병원 충돌'], ['store:gym', '헬스장 충돌'], ['store:yoga', '요가 충돌'], ['store:kids_cafe', '키즈카페 충돌'],
    ['all', '전체'],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void runFull()} disabled={running}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50">{running ? '실행 중…' : '전체 재검수 실행'}</button>
        <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-2 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
        {progress && <span className="text-xs text-ink-mute">{progress}</span>}
      </div>
      <p className="text-[11px] text-ink-dim">재검수 대상 곡을 듣고 등록 메타 vs AI 추천을 비교해 개별/일괄 처리합니다. 자동 삭제·비공개 없음 — 메타/태그/플래그만 변경. 오디오 품질/DSP 분석은 "분석 대기" 탭에서 실행.</p>

      {summary && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <PStat label="대상 곡" v={summary.total_target} />
          <PStat label="재검수 필요" v={summary.needs_re_review} />
          <PStat label="고위험" v={summary.high_risk_flags} />
          <PStat label="불일치 high" v={summary.mismatch_high} />
          <PStat label="품질 재검수" v={summary.quality_review_required} />
          <PStat label="저신뢰 업로더" v={summary.low_trust_uploaders} />
          <PStat label="수정요청 대기" v={summary.fix_requested} />
          <PStat label="처리완료" v={summary.resolved_total} />
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(([f, l]) => <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${filter === f ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>{l}</button>)}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-bg-soft px-3 py-2 text-[11px]">
        <button onClick={selAll} className="rounded bg-bg-card px-2 py-1 font-semibold hover:bg-bg-hover">{selected.size === rows.length && rows.length > 0 ? '전체 해제' : '전체 선택'}</button>
        <span className="text-ink-dim">{selected.size}곡 선택</span>
        <label className="flex items-center gap-1 text-ink-mute"><input type="checkbox" checked={autoResolve} onChange={(e) => setAutoResolve(e.target.checked)} className="h-3 w-3 accent-accent" /> 충돌 해소 시 자동 resolve</label>
        <span className="mx-1 h-3 w-px bg-line" />
        <button disabled={busy || selected.size === 0} onClick={() => void bulkApplyMeta()} className="rounded bg-accent/15 px-2 py-1 font-semibold text-accent disabled:opacity-40">AI 메타 적용 + 재평가</button>
        <button disabled={busy || selected.size === 0} onClick={() => void bulkRemoveConflicts()} className="rounded bg-amber-500/15 px-2 py-1 font-semibold text-amber-600 disabled:opacity-40">충돌 매장 태그 제거</button>
        <button disabled={busy || selected.size === 0} onClick={() => void act(selIds, 'request_fix')} className="rounded bg-orange-500/15 px-2 py-1 font-semibold text-orange-600 disabled:opacity-40">수정 요청</button>
        <button disabled={busy || selected.size === 0} onClick={() => void act(selIds, 'no_problem')} className="rounded bg-emerald-500/15 px-2 py-1 font-semibold text-emerald-600 disabled:opacity-40">문제 없음</button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">{loading ? '불러오는 중…' : '해당 조건의 곡이 없어요.'}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.track_id} className="rounded-xl bg-bg-card p-3">
              <div className="flex items-start gap-2">
                <input type="checkbox" checked={selected.has(r.track_id)} onChange={() => toggleSel(r.track_id)} className="mt-1 h-4 w-4 accent-accent" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <b className="truncate">{r.title ?? '(제목없음)'}</b>
                    <span className="text-ink-dim">{r.artist ?? ''} · {r.release_status}</span>
                    {r.trust_score < 50 && <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">trust {r.trust_score}</span>}
                    {r.needs_fix && <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-orange-600">수정요청</span>}
                    {r.disposition && <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] text-ink-mute">{r.disposition}</span>}
                  </div>
                  <p className="mt-1 text-[11px] font-medium text-amber-600">{r.problem_summary}</p>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                    {(r.open_flags ?? []).map((f) => <span key={f} className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-600">{f}</span>)}
                  </div>
                  {r.audio_url && <audio src={r.audio_url} controls preload="none" className="mt-2 h-8 w-full" />}
                </div>
                <button onClick={() => void toggleExpand(r.track_id)} className="shrink-0 rounded bg-bg-soft px-2 py-1 text-[10px] font-semibold text-ink-mute hover:bg-bg-hover">{expanded === r.track_id ? '접기' : '비교/상세'}</button>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-1.5 text-[10px] sm:grid-cols-2">
                <div><span className="text-ink-dim">등록 매장: </span>{(r.declared_stores ?? []).length ? (r.declared_stores ?? []).map((s) => <span key={s} className="mr-1 rounded bg-bg-soft px-1.5 py-0.5">{storeLabel(s)}</span>) : <span className="text-ink-dim">없음</span>}</div>
                <div><span className="text-ink-dim">차단 매장: </span>{(r.blocked_stores ?? []).length ? (r.blocked_stores ?? []).map((s) => <span key={s} className={`mr-1 rounded px-1.5 py-0.5 ${(r.blocked_declared_stores ?? []).includes(s) ? 'bg-rose-500/15 font-semibold text-rose-600' : 'bg-bg-soft text-ink-mute'}`}>{storeLabel(s)}</span>) : <span className="text-ink-dim">없음</span>}</div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px]">
                <button disabled={busy} onClick={() => void applyMetaOne(r.track_id)} className="rounded bg-accent/15 px-2 py-1 font-semibold text-accent disabled:opacity-40">AI 메타 적용 + 재평가</button>
                <button disabled={busy} onClick={() => setMetaModal({ track_id: r.track_id, title: r.title, canApprove: canApproveStatus(r.release_status) })} className="rounded bg-indigo-500/15 px-2 py-1 font-semibold text-indigo-600 disabled:opacity-40">메타 수정/승인</button>
                {(r.blocked_declared_stores ?? []).map((sk) => (
                  <span key={sk} className="inline-flex items-center gap-0.5">
                    <button disabled={busy} onClick={() => void act([r.track_id], 'remove_declared_store', sk)} className="rounded bg-amber-500/15 px-2 py-1 font-semibold text-amber-600 disabled:opacity-40">{storeLabel(sk)} 태그 제거</button>
                    <button disabled={busy} onClick={() => void act([r.track_id], 'exclude_store', sk)} className="rounded bg-rose-500/15 px-2 py-1 font-semibold text-rose-600 disabled:opacity-40">{storeLabel(sk)} 제외</button>
                  </span>
                ))}
                <button disabled={busy} onClick={() => void act([r.track_id], 'request_fix')} className="rounded bg-orange-500/15 px-2 py-1 font-semibold text-orange-600 disabled:opacity-40">수정 요청</button>
                <button disabled={busy} onClick={() => void act([r.track_id], 'no_problem')} className="rounded bg-emerald-500/15 px-2 py-1 font-semibold text-emerald-600 disabled:opacity-40">문제 없음</button>
              </div>

              {results[r.track_id] && <RecomputeDiffPanel res={results[r.track_id]} onClose={() => setResults((p) => { const n = { ...p }; delete n[r.track_id]; return n; })} />}

              {expanded === r.track_id && (
                <div className="mt-3 rounded-lg bg-bg-soft p-3 text-[10px]">
                  {detailLoading || !detail ? <p className="text-ink-dim">{detailLoading ? '불러오는 중…' : ''}</p> : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="mb-1 font-bold text-ink-mute">등록자 입력</p>
                          <p>장르: {(detail.declared_genres ?? []).join(', ') || '—'}</p>
                          <p>무드: {(detail.declared_moods ?? []).join(', ') || '—'}</p>
                          <p>상황: {(detail.declared_situations ?? []).join(', ') || '—'}</p>
                          <p>매장 태그: {(detail.declared_store_tags ?? []).join(', ') || '—'}</p>
                        </div>
                        <div>
                          <p className="mb-1 font-bold text-accent">AI 추천</p>
                          <p>장르: {(detail.ai_genres ?? []).join(', ') || '—'}</p>
                          <p>무드: {(detail.ai_moods ?? []).join(', ') || '—'}</p>
                          <p>상황: {(detail.ai_situations ?? []).join(', ') || '—'}</p>
                          <p>에너지: {detail.ai_energy_level ?? '—'} · 보컬: {detail.ai_vocal_type ?? '—'}</p>
                          <p>불일치: {detail.mismatch_score != null ? detail.mismatch_score.toFixed(2) : '—'}</p>
                        </div>
                      </div>
                      {detail.ai_explanation && <p className="rounded bg-bg-card px-2 py-1 text-ink-mute">{detail.ai_explanation}</p>}
                      {(detail.mismatch_reasons ?? []).length > 0 && (
                        <ul className="list-disc space-y-0.5 pl-4 text-ink-dim">{(detail.mismatch_reasons ?? []).map((m, i) => <li key={i}>{m}</li>)}</ul>
                      )}
                      {detail.guardrails.length > 0 && (
                        <div>
                          <p className="mb-1 font-bold text-ink-mute">매장별 금지규칙</p>
                          <div className="flex flex-wrap gap-1">
                            {detail.guardrails.map((g) => (
                              <span key={g.store_key} className={`rounded px-1.5 py-0.5 ${g.is_declared && g.severity === 'hard_block' ? 'bg-rose-500/15 font-semibold text-rose-600' : g.severity === 'hard_block' ? 'bg-amber-500/10 text-amber-600' : 'bg-bg-card text-ink-mute'}`} title={(g.rules ?? []).join(', ')}>{g.store_label}{g.is_declared ? '✓' : ''} · {g.severity}</span>
                            ))}
                          </div>
                          <p className="mt-1 text-ink-dim">✓ = 등록자가 선언한 매장 · 빨강 = 선언 매장에서 hard_block(검수 필요)</p>
                        </div>
                      )}
                      {(detail.ai_exclusions ?? []).length > 0 && <p className="text-ink-dim">제외 매장: {(detail.ai_exclusions ?? []).map(storeLabel).join(', ')}</p>}
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {metaModal && (
        <MetaApproveModal trackId={metaModal.track_id} title={metaModal.title} canApprove={metaModal.canApprove}
          onClose={() => setMetaModal(null)} onDone={() => { setMetaModal(null); void load(); }} />
      )}
    </div>
  );
}

function RecomputeDiffPanel({ res, onClose }: { res: RecomputeResult; onClose: () => void }) {
  const arrow = (d: number) => d > 0 ? <span className="text-emerald-600">▲ +{d}</span> : d < 0 ? <span className="text-rose-600">▼ {d}</span> : <span className="text-ink-dim">―</span>;
  const changed = res.fit_diff.filter((d) => d.delta !== 0);
  return (
    <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 p-3 text-[10px]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold text-accent">AI 메타 적용 후 재평가 결과</span>
        <button onClick={onClose} className="rounded bg-bg-card px-2 py-0.5 text-[10px] text-ink-mute hover:bg-bg-hover">닫기</button>
      </div>
      {res.warning && <p className="mb-2 rounded bg-rose-500/10 px-2 py-1 font-semibold text-rose-600">⚠ {res.warning}</p>}
      <div className="mb-2 flex flex-wrap gap-3">
        <span>위험도: <b>{res.risk_before}</b> → <b className={res.risk_reduced ? 'text-emerald-600' : ''}>{res.risk_after}</b>{res.risk_reduced && ' ✓감소'}</span>
        <span>불일치: <b>{res.mismatch_before}</b> → <b className={res.mismatch_reduced ? 'text-emerald-600' : ''}>{res.mismatch_after}</b>{res.mismatch_reduced && ' ✓감소'}</span>
      </div>
      {res.top_gains.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 font-bold text-ink-mute">추천 상승 매장 TOP5</p>
          <div className="flex flex-wrap gap-1">
            {res.top_gains.map((g) => <span key={g.store_key} className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600">{g.store_label} {g.before ?? 0}→{g.after ?? 0} (+{g.delta})</span>)}
          </div>
        </div>
      )}
      {res.unblocked_stores.length > 0 && <p className="mb-1">차단 해제: {res.unblocked_stores.map(storeLabel).join(', ')}</p>}
      {res.newly_blocked_stores.length > 0 && <p className="mb-1 text-rose-600">신규 차단: {res.newly_blocked_stores.map(storeLabel).join(', ')}</p>}
      {res.removed_conflicts.length > 0 && <p className="mb-1 text-emerald-600">충돌 해소: {res.removed_conflicts.map(storeLabel).join(', ')}</p>}
      {changed.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-ink-dim">매장별 fit 변화 ({changed.length})</summary>
          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
            {changed.map((d) => <span key={d.store_key}>{d.store_label}: {d.before ?? 0}→{d.after ?? 0} {arrow(d.delta)}</span>)}
          </div>
        </details>
      )}
      {changed.length === 0 && res.top_gains.length === 0 && <p className="text-ink-dim">fit 변화 없음 (메타가 이미 일치) — 상태 동기화만 수행됨.</p>}
    </div>
  );
}
