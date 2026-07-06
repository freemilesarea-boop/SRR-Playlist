import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  recomputeGuardrailFlags,
  guardrailDashboard,
  listGuardrailViolationTracks,
  recomputeMetadataTrust,
  bulkGuardrailOverride,
  bulkGuardrailClear,
  bulkApplyAiMetadata,
  type GuardrailDashboard,
  type GuardrailViolationTrack,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';
import MetaApproveModal from '@/components/admin/MetaApproveModal';
import { PStat, STORE_LABELS } from './shared';

export default function GuardrailDashboardTab() {
  const [dash, setDash] = useState<GuardrailDashboard | null>(null);
  const [tracks, setTracks] = useState<GuardrailViolationTrack[]>([]);
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [metaModal, setMetaModal] = useState<{ track_id: string; title: string | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, t] = await Promise.all([guardrailDashboard(), listGuardrailViolationTracks('hard_block', storeFilter, 200)]);
      setDash(d); setTracks(t); setSel({});
    } catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [storeFilter]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try { await fn(); toast.success(msg); await load(); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  const selIds = Object.keys(sel).filter((k) => sel[k]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void run(() => recomputeGuardrailFlags(), '위반 스냅샷 재계산 완료')} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50">위반 재계산</button>
        <button onClick={() => void run(() => recomputeMetadataTrust(), 'metadata trust 재계산 완료')} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">trust 재계산</button>
        <button onClick={() => void load()} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-2 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
      </div>
      <p className="text-[11px] text-ink-dim">먼저 "위반 재계산"으로 스냅샷을 생성하세요. (추천/정산 미반영 — 운영 점검용)</p>

      {dash && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <PStat label="위반(전체)" v={dash.total_violating_tracks} />
            <PStat label="hard_block 곡" v={dash.hard_block_tracks} />
            <PStat label="soft_block" v={dash.by_severity?.soft_block ?? 0} />
            <PStat label="warning" v={dash.by_severity?.warning ?? 0} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-bg-card p-3">
              <h3 className="mb-2 text-xs font-bold">매장별 차단(hard)</h3>
              <ul className="space-y-1 text-[11px]">
                {dash.by_store.slice(0, 12).map((s) => (
                  <li key={s.store_key} className="flex items-center justify-between gap-2">
                    <button onClick={() => setStoreFilter(storeFilter === s.store_key ? null : s.store_key)} className={`truncate text-left ${storeFilter === s.store_key ? 'font-bold text-accent' : 'text-ink-mute'}`}>{STORE_LABELS[s.store_key] ?? s.store_key}</button>
                    <span className="shrink-0 tabular-nums text-rose-300">{s.hard_count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl bg-bg-card p-3">
              <h3 className="mb-2 text-xs font-bold">위반 규칙 TOP10</h3>
              <ul className="space-y-1 text-[11px]">
                {dash.top_rules.map((r) => <li key={r.rule_key} className="flex justify-between gap-2"><span className="truncate text-ink-mute">{r.rule_key}</span><span className="shrink-0 tabular-nums">{r.cnt}</span></li>)}
              </ul>
            </div>
            <div className="rounded-xl bg-bg-card p-3">
              <h3 className="mb-2 text-xs font-bold">문제 업로더 (trust)</h3>
              <ul className="space-y-1 text-[11px]">
                {dash.uploaders.slice(0, 12).map((u) => (
                  <li key={u.user_id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-ink-mute">{u.artist_name ?? u.user_id.slice(0, 8)}</span>
                    <span className="shrink-0 tabular-nums">위반 {u.hard_tracks}/{u.total_tracks} · trust <b className={`${(u.metadata_trust_score ?? 100) < 60 ? 'text-rose-300' : (u.metadata_trust_score ?? 100) < 85 ? 'text-amber-300' : 'text-emerald-300'}`}>{u.metadata_trust_score ?? '-'}</b></span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}

      <div className="rounded-xl bg-bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-bold">위반 곡 {storeFilter ? `· ${STORE_LABELS[storeFilter] ?? storeFilter}` : '(hard_block 전체)'} ({tracks.length})</h3>
          {storeFilter && <button onClick={() => setStoreFilter(null)} className="rounded bg-ink/5 px-2 py-0.5 text-[10px]">필터 해제</button>}
          <div className="ml-auto flex gap-1.5">
            {storeFilter && <button onClick={() => void run(() => bulkGuardrailOverride(selIds, storeFilter, '대시보드 일괄 override'), `${selIds.length}곡 ${storeFilter} override`)} disabled={busy || selIds.length === 0} className="rounded-lg bg-rose-500/25 px-2.5 py-1.5 text-xs font-semibold text-rose-300 disabled:opacity-50">선택 매장 override</button>}
            <button onClick={() => void run(() => bulkGuardrailClear(selIds, '문제 없음 일괄'), `${selIds.length}곡 문제 없음`)} disabled={busy || selIds.length === 0} className="rounded-lg bg-emerald-500/25 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 disabled:opacity-50">문제 없음(전체 override)</button>
            <button onClick={() => void run(() => bulkApplyAiMetadata(selIds), `${selIds.length}곡 메타 재설정`)} disabled={busy || selIds.length === 0} className="rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent disabled:opacity-50">메타 재설정</button>
          </div>
        </div>
        {tracks.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-dim">{loading ? '불러오는 중…' : '위반 곡이 없어요. (재계산 필요)'}</p>
        ) : (
          <ul className="max-h-[28rem] space-y-1 overflow-y-auto">
            {tracks.map((t) => (
              <li key={t.track_id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] hover:bg-ink/5">
                <input type="checkbox" checked={!!sel[t.track_id]} onChange={() => setSel((s) => ({ ...s, [t.track_id]: !s[t.track_id] }))} />
                <span className="min-w-0 flex-1 truncate"><b>{t.title ?? '(제목없음)'}</b> · <span className="text-ink-dim">{t.artist ?? ''}</span> · {t.main_genre ?? '-'}</span>
                <span className="shrink-0 text-rose-300">차단 {t.hard_stores}</span>
                <span className="hidden shrink-0 truncate text-[10px] text-ink-dim sm:block" title={(t.blocked_stores ?? []).join(', ')}>{(t.blocked_stores ?? []).slice(0, 4).map((s) => STORE_LABELS[s] ?? s).join(',')}</span>
                <button onClick={() => setMetaModal({ track_id: t.track_id, title: t.title })} className="shrink-0 rounded bg-indigo-500/25 px-2 py-0.5 text-[10px] font-semibold text-indigo-600">메타 수정</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {metaModal && (
        <MetaApproveModal trackId={metaModal.track_id} title={metaModal.title} canApprove={false}
          onClose={() => setMetaModal(null)} onDone={() => { setMetaModal(null); void load(); }} />
      )}
    </div>
  );
}
