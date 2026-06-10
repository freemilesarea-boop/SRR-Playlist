import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Ban, Calculator, Trash2, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useModalA11y } from '@/hooks/useModalA11y';
import {
  adminBulkApplyAiMetadata,
  adminBulkAddTrackExclusions,
  adminBulkRecomputeFitScores,
  adminBulkPreviewPlacementChanges,
  adminBulkRemoveMisplacedPlaylistTracks,
  adminListBulkAudit,
  listTaxonomyStoreTypes,
  type BulkAiApplyResult,
  type BulkExclusionResult,
  type BulkPreviewPlacement,
  type BulkAuditEntry,
  type StoreTypeOption,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';

type Tab = 'ai' | 'exclude' | 'recompute' | 'placement' | 'audit';

export default function BulkActionsModal({
  trackIds,
  onClose,
  onCompleted,
}: {
  trackIds: string[];
  onClose: () => void;
  onCompleted?: () => void;
}) {
  const [tab, setTab] = useState<Tab>('ai');
  const [busy, setBusy] = useState(false);
  const completed = () => onCompleted?.();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(dialogRef, { onClose });

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 md:p-4">
      <div className="flex h-[92vh] w-full max-w-4xl flex-col rounded-2xl bg-bg-deep shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-line/10 px-4 py-3">
          <div>
            <h2 className="text-base font-bold">Bulk Actions ({trackIds.length} 트랙)</h2>
            <p className="text-xs text-ink-dim">선택된 트랙에 일괄 작업. 모든 작업은 Preview → Confirm 구조.</p>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-bg-card"><X size={18} /></button>
        </div>
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line/10 px-3 py-2">
          {([
            ['ai', 'AI 메타 적용'],
            ['exclude', '금지 장소'],
            ['recompute', 'fit 재계산'],
            ['placement', '재배치 Preview/Apply'],
            ['audit', '이력'],
          ] as [Tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${tab === k ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'ai' && <BulkAiTab trackIds={trackIds} busy={busy} setBusy={setBusy} onDone={completed} />}
          {tab === 'exclude' && <BulkExcludeTab trackIds={trackIds} busy={busy} setBusy={setBusy} onDone={completed} />}
          {tab === 'recompute' && <BulkRecomputeTab trackIds={trackIds} busy={busy} setBusy={setBusy} onDone={completed} />}
          {tab === 'placement' && <BulkPlacementTab trackIds={trackIds} busy={busy} setBusy={setBusy} onDone={completed} />}
          {tab === 'audit' && <BulkAuditTab />}
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-line/10 px-4 py-2 text-xs text-ink-dim">
          <span>정책: 자동 승인/삭제/반영 금지. Preview → Confirm 필수.</span>
          <span>{trackIds.length} 트랙 선택</span>
        </div>
      </div>
    </div>
  );
}

// ===== Tab AI =====
function BulkAiTab({ trackIds, busy, setBusy, onDone }: { trackIds: string[]; busy: boolean; setBusy: (b: boolean) => void; onDone: () => void }) {
  const [scope, setScope] = useState({ genre: true, mood: false, store: false });
  const [minConf, setMinConf] = useState(0.9);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<BulkAiApplyResult | null>(null);

  const runPreview = async () => {
    if (!scope.genre && !scope.mood && !scope.store) { toast.error('적용할 항목 선택'); return; }
    setBusy(true);
    try {
      const r = await adminBulkApplyAiMetadata(trackIds, scope, minConf, false, reason);
      setPreview(r);
      toast.success(`Preview: ${r.applied} 통과 / ${r.skipped_low_conf} 신뢰도 부족 / ${r.skipped_no_pred} 예측 없음`);
    } catch (e) { toast.error(`preview 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    if (!preview) { toast.error('먼저 Preview 실행'); return; }
    if (!confirm(`${preview.applied} 트랙에 AI 메타를 적용하시겠어요? (audit 기록 남음)`)) return;
    setBusy(true);
    try {
      const r = await adminBulkApplyAiMetadata(trackIds, scope, minConf, true, reason);
      toast.success(`적용: ${r.applied} 성공 / ${r.failed} 실패`);
      setPreview(null);
      onDone();
    } catch (e) { toast.error(`적용 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <h3 className="mb-2 text-sm font-bold">적용 범위</h3>
        <div className="flex flex-wrap gap-3 text-xs">
          {(['genre', 'mood', 'store'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="checkbox" checked={scope[k]} onChange={(e) => setScope({ ...scope, [k]: e.target.checked })} />
              <span>{k}</span>
            </label>
          ))}
        </div>
        <div className="mt-3">
          <label className="block text-xs">
            <span className="font-semibold text-ink-mute">신뢰도 임계점</span>
            <div className="mt-1 flex gap-2">
              {[0.95, 0.9, 0.85, 0.8].map((v) => (
                <button key={v} onClick={() => setMinConf(v)}
                  className={`rounded px-2 py-1 text-xs ${minConf === v ? 'bg-accent text-black font-bold' : 'bg-bg-deep hover:bg-bg-hover'}`}>
                  ≥{(v * 100).toFixed(0)}%
                </button>
              ))}
              <input type="number" step="0.05" min="0" max="1" value={minConf}
                onChange={(e) => setMinConf(parseFloat(e.target.value) || 0)}
                className="w-20 rounded bg-bg-deep px-2 py-1 text-xs" />
            </div>
          </label>
        </div>
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="적용 사유 (audit)" className="mt-3 w-full rounded bg-bg-deep px-2 py-1.5 text-xs" />
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => void runPreview()} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-bg-card px-3 py-1.5 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Preview
        </button>
        <button onClick={() => void apply()} disabled={busy || !preview}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50">
          <CheckCircle2 size={13} /> Confirm Apply
        </button>
      </div>

      {preview && (
        <div className="rounded-xl bg-bg-card p-3">
          <h4 className="mb-2 text-xs font-bold">Preview 결과</h4>
          <div className="grid grid-cols-4 gap-2 text-xs">
            <Stat label="총 후보" v={preview.total} />
            <Stat label="통과" v={preview.applied} color="emerald" />
            <Stat label="신뢰도 부족" v={preview.skipped_low_conf} color="amber" />
            <Stat label="예측 없음" v={preview.skipped_no_pred} color="gray" />
          </div>
          {preview.breakdown && preview.breakdown.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-ink-mute">통과 트랙 {preview.breakdown.length}건</summary>
              <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-[11px]">
                {preview.breakdown.slice(0, 50).map((b) => (
                  <li key={b.track_id} className="flex items-center justify-between gap-2 rounded bg-bg-deep px-2 py-1">
                    <span className="truncate">{b.title ?? '(제목없음)'}</span>
                    <span className="shrink-0 text-ink-dim">{(b.min_confidence * 100).toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ===== Tab Exclude =====
function BulkExcludeTab({ trackIds, busy, setBusy, onDone }: { trackIds: string[]; busy: boolean; setBusy: (b: boolean) => void; onDone: () => void }) {
  const [storeTypes, setStoreTypes] = useState<StoreTypeOption[]>([]);
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<BulkExclusionResult | null>(null);

  useEffect(() => {
    listTaxonomyStoreTypes().then(setStoreTypes).catch((e) => toast.error(`store 로딩 실패: ${e.message}`));
  }, []);

  const toggleSlug = (slug: string) => {
    const next = new Set(selectedSlugs);
    if (next.has(slug)) next.delete(slug); else next.add(slug);
    setSelectedSlugs(next);
  };

  const runPreview = async () => {
    if (selectedSlugs.size === 0) { toast.error('금지 장소 1개 이상 선택'); return; }
    setBusy(true);
    try {
      const r = await adminBulkAddTrackExclusions(trackIds, Array.from(selectedSlugs), false, reason);
      setPreview(r);
      toast.success(`Preview: 신규 ${r.inserted} / 기존 ${r.already_active} (총 ${r.combos_total} 조합)`);
    } catch (e) { toast.error(`preview 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    if (!preview) { toast.error('먼저 Preview 실행'); return; }
    if (!confirm(`${trackIds.length} 트랙 × ${selectedSlugs.size} 장소 = ${preview.combos_total} 조합 (신규 ${preview.inserted})\n적용하시겠어요?`)) return;
    setBusy(true);
    try {
      const r = await adminBulkAddTrackExclusions(trackIds, Array.from(selectedSlugs), true, reason);
      toast.success(`적용: 신규 ${r.inserted} / 이미 활성 ${r.already_active}`);
      setPreview(null);
      onDone();
    } catch (e) { toast.error(`적용 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-bg-card p-3">
        <h3 className="mb-2 text-sm font-bold">금지 장소 다중 선택</h3>
        <div className="grid grid-cols-3 gap-1.5 md:grid-cols-4">
          {storeTypes.map((s) => (
            <label key={s.slug} className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${selectedSlugs.has(s.slug) ? 'bg-rose-500/15 text-rose-500' : 'bg-bg-deep hover:bg-bg-hover'}`}>
              <input type="checkbox" checked={selectedSlugs.has(s.slug)} onChange={() => toggleSlug(s.slug)} />
              <span>{s.name_ko}</span>
              <span className="text-[10px] text-ink-dim">({s.slug})</span>
            </label>
          ))}
        </div>
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="금지 사유 (audit)" className="mt-3 w-full rounded bg-bg-deep px-2 py-1.5 text-xs" />
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => void runPreview()} disabled={busy || selectedSlugs.size === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-bg-card px-3 py-1.5 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">
          <RefreshCw size={13} /> Preview
        </button>
        <button onClick={() => void apply()} disabled={busy || !preview}
          className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/15 px-3 py-1.5 text-xs font-bold text-rose-500 disabled:opacity-50">
          <Ban size={13} /> Confirm Add
        </button>
      </div>

      {preview && (
        <div className="rounded-xl bg-bg-card p-3">
          <div className="grid grid-cols-4 gap-2 text-xs">
            <Stat label="조합 총합" v={preview.combos_total} />
            <Stat label="트랙" v={preview.track_count} />
            <Stat label="신규" v={preview.inserted} color="rose" />
            <Stat label="이미 활성" v={preview.already_active} color="gray" />
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Tab Recompute =====
function BulkRecomputeTab({ trackIds, busy, setBusy, onDone }: { trackIds: string[]; busy: boolean; setBusy: (b: boolean) => void; onDone: () => void }) {
  const [result, setResult] = useState<{ track_count: number; total_recomputed: number; elapsed_ms?: number } | null>(null);

  const run = async () => {
    if (!confirm(`${trackIds.length} 트랙의 fit_score 를 재계산하시겠어요? (수십초~수분 소요 가능)`)) return;
    setBusy(true);
    setResult(null);
    const t0 = performance.now();
    try {
      const r = await adminBulkRecomputeFitScores(trackIds);
      const elapsed_ms = Math.round(performance.now() - t0);
      setResult({ ...r, elapsed_ms });
      toast.success(`재계산 완료: ${r.total_recomputed}건 (${(elapsed_ms / 1000).toFixed(1)}s)`);
      onDone();
    } catch (e) { toast.error(`재계산 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-dim">
        선택된 {trackIds.length} 트랙의 모든 fit_score 행을 _ai_compute_fit 으로 재계산합니다.
        exclusion 매칭 시 자동으로 fit=0, status='excluded' 로 설정됩니다.
      </p>
      <button onClick={() => void run()} disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50">
        <Calculator size={13} /> Recompute {trackIds.length} 트랙
      </button>
      {busy && <p className="text-xs text-ink-dim">진행 중… (트랙당 ~10ms × playlists)</p>}
      {result && (
        <div className="rounded-xl bg-bg-card p-3 text-xs">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="트랙 수" v={result.track_count} />
            <Stat label="재계산 행" v={result.total_recomputed} color="emerald" />
            <Stat label="소요 (ms)" v={result.elapsed_ms ?? 0} />
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Tab Placement Preview/Apply =====
function BulkPlacementTab({ trackIds, busy, setBusy, onDone }: { trackIds: string[]; busy: boolean; setBusy: (b: boolean) => void; onDone: () => void }) {
  const [preview, setPreview] = useState<BulkPreviewPlacement | null>(null);
  const [reason, setReason] = useState('');

  const runPreview = async () => {
    setBusy(true);
    try {
      const r = await adminBulkPreviewPlacementChanges(trackIds);
      setPreview(r);
      toast.success(`Preview: 제거 ${r.total_remove} / 유지 ${r.total_keep}`);
    } catch (e) { toast.error(`preview 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    if (!preview || preview.total_remove === 0) { toast.error('제거할 항목이 없습니다.'); return; }
    if (!confirm(`${preview.total_remove}건 부적합 playlist_tracks 를 제거하시겠어요? (되돌릴 수 없음)`)) return;
    setBusy(true);
    try {
      const r = await adminBulkRemoveMisplacedPlaylistTracks(trackIds, true, reason);
      toast.success(`제거 완료: ${r.total_removed}건`);
      setPreview(null);
      onDone();
    } catch (e) { toast.error(`제거 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-dim">
        선택된 트랙들의 현재 playlist_tracks 와 active exclusions 를 비교하여 제거/유지 카운트를 집계합니다.
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void runPreview()} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-bg-card px-3 py-1.5 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">
          <RefreshCw size={13} /> Preview
        </button>
      </div>

      {preview && (
        <>
          <div className="rounded-xl bg-bg-card p-3">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Stat label="트랙 수" v={preview.track_count} />
              <Stat label="제거 대상" v={preview.total_remove} color="rose" />
              <Stat label="유지" v={preview.total_keep} color="emerald" />
            </div>
            {preview.per_track.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] text-ink-mute">트랙별 breakdown ({preview.per_track.length}건)</summary>
                <ul className="mt-1 max-h-60 space-y-1 overflow-y-auto text-[11px]">
                  {preview.per_track.slice(0, 100).map((t) => (
                    <li key={t.track_id} className="flex items-center justify-between gap-2 rounded bg-bg-deep px-2 py-1">
                      <span className="truncate">{t.title ?? '(제목없음)'}</span>
                      <span className="shrink-0 text-ink-dim">제거 <b className="text-rose-500">{t.remove_count}</b> · 유지 <b className="text-emerald-500">{t.keep_count}</b></span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="제거 사유 (audit)" className="w-full rounded bg-bg-card px-2 py-1.5 text-xs" />
          <button onClick={() => void apply()} disabled={busy || preview.total_remove === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/15 px-3 py-1.5 text-xs font-bold text-rose-500 disabled:opacity-50">
            <Trash2 size={13} /> Confirm Remove ({preview.total_remove})
          </button>
        </>
      )}
    </div>
  );
}

// ===== Tab Audit =====
function BulkAuditTab() {
  const [entries, setEntries] = useState<BulkAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setEntries(await adminListBulkAudit(50)); }
    catch (e) { toast.error(`이력 조회 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-2">
      <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded bg-bg-card px-2 py-1 text-xs hover:bg-bg-hover">
        <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
      </button>
      {entries.length === 0 ? (
        <p className="text-xs text-ink-dim">{loading ? '로딩 중…' : '이력이 없습니다.'}</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((a) => (
            <li key={a.id} className="rounded bg-bg-card p-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className={`rounded px-1.5 py-0.5 font-bold ${a.status === 'preview' ? 'bg-amber-500/15 text-amber-500' : a.status === 'completed' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500'}`}>
                  {a.operation_type}
                </span>
                <span className="text-[10px] text-ink-dim">{new Date(a.created_at).toLocaleString()} · {a.admin_name ?? 'unknown'} · {a.track_count} 트랙</span>
              </div>
              <details className="mt-1">
                <summary className="cursor-pointer text-[11px] text-ink-mute">params/result</summary>
                <div className="mt-1 grid grid-cols-2 gap-2 text-[10px]">
                  <pre className="rounded bg-bg-deep p-2 text-ink-mute">{JSON.stringify(a.params_json, null, 2)}</pre>
                  <pre className="rounded bg-bg-deep p-2 text-emerald-400">{JSON.stringify(a.after_json, null, 2)}</pre>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, v, color = 'blue' }: { label: string; v: number; color?: string }) {
  const colorMap: Record<string, string> = {
    blue: 'text-blue-500', emerald: 'text-emerald-500',
    amber: 'text-amber-500', rose: 'text-rose-500', gray: 'text-gray-500',
  };
  return (
    <div className="rounded bg-bg-deep p-2">
      <div className="text-[10px] text-ink-dim">{label}</div>
      <div className={`text-xl font-bold ${colorMap[color] ?? colorMap.blue}`}>{v}</div>
    </div>
  );
}
