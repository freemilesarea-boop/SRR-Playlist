import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  businessSkipSummary,
  listBusinessExclusions,
  restoreBusinessExclusion,
  ignoreBusinessExclusion,
  reactivateBusinessExclusion,
  excludeTrackGroup,
  applyAiMetadataAndRecompute,
  type BusinessSkipSummary,
  type BusinessExclusionRow,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';
import MetaApproveModal from '@/components/admin/MetaApproveModal';
import { PStat } from './shared';

export default function BusinessReactionTab() {
  const [summary, setSummary] = useState<BusinessSkipSummary | null>(null);
  const [rows, setRows] = useState<BusinessExclusionRow[]>([]);
  const [store, setStore] = useState('all');
  const [days, setDays] = useState(0);
  const [status, setStatus] = useState('active');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [metaModal, setMetaModal] = useState<{ track_id: string; title: string | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const [s, r] = await Promise.all([businessSkipSummary(), listBusinessExclusions(store, days, status)]); setSummary(s); setRows(r); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [store, days, status]);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, fn: () => Promise<void>, msg: string) {
    setBusyId(id);
    try { await fn(); toast.success(msg); await load(); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  }

  const STORES: [string, string][] = [['all', '전체'], ['cafe_independent', '카페'], ['gym', '헬스장'], ['hospital', '병원'], ['cafe', '카페그룹']];
  const STATUSES: [string, string][] = [['active', '제외중'], ['restored', '복구됨'], ['ignored', '무시'], ['all', '전체']];
  const DAYS: [number, string][] = [[0, '전체기간'], [7, '최근 7일'], [30, '최근 30일']];
  const stColor = (s: string) => s === 'active' ? 'text-rose-300' : s === 'restored' ? 'text-emerald-300' : 'text-ink-mute';

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-ink-dim">사업자(매장) 회원이 <b>30초 이내</b> 다음곡으로 넘긴 곡을 집계합니다. 같은 store_key 에서 <b>3회 이상 + 서로 다른 사업자 2명 이상</b>이면 자동 제외됩니다. 사업자 화면엔 경고가 노출되지 않으며, 관리자가 언제든 복구할 수 있습니다. (정산/차트 무관)</p>

      {summary && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          <PStat label="제외중" v={summary.active} />
          <PStat label="복구됨" v={summary.restored} />
          <PStat label="무시" v={summary.ignored} />
          <PStat label="스킵 7일" v={summary.skip_events_7d} />
          <PStat label="스킵 30일" v={summary.skip_events_30d} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {STORES.map(([k, l]) => <button key={k} onClick={() => setStore(k)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${store === k ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>{l}</button>)}
        <span className="mx-1 h-3 w-px bg-line" />
        {STATUSES.map(([k, l]) => <button key={k} onClick={() => setStatus(k)} className={`rounded-full px-2.5 py-1.5 text-[11px] font-semibold ${status === k ? 'bg-ink/80 text-bg' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>{l}</button>)}
        <span className="mx-1 h-3 w-px bg-line" />
        {DAYS.map(([k, l]) => <button key={k} onClick={() => setDays(k)} className={`rounded-full px-2.5 py-1.5 text-[11px] font-semibold ${days === k ? 'bg-ink/80 text-bg' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>{l}</button>)}
        <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">{loading ? '불러오는 중…' : '해당 조건의 제외 곡이 없어요.'}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg bg-bg-card p-3 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate"><b>{r.title ?? '(제목없음)'}</b> <span className="text-ink-dim">{r.artist ?? ''}</span></span>
                <span className="rounded bg-bg-soft px-1.5 py-0.5 text-[10px]">{r.store_group_key ? `${r.store_label}(그룹)` : r.store_label}</span>
                <span className={`text-[10px] font-bold ${stColor(r.status)}`}>{r.status}</span>
              </div>
              <p className="mt-1 text-[10px] text-ink-dim">
                스킵 {r.skip_count}회 · 고유 사업자 {r.unique_business_skip_count}명 · 최근 {r.last_detected_at ? new Date(r.last_detected_at).toLocaleDateString() : '-'} · {r.reason ?? ''}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
                {r.status === 'active' ? (
                  <>
                    <button disabled={busyId === r.id} onClick={() => void act(r.id, () => restoreBusinessExclusion(r.id), '복구됨')} className="rounded bg-emerald-500/25 px-2 py-1 font-semibold text-emerald-300 disabled:opacity-40">복구</button>
                    <button disabled={busyId === r.id} onClick={() => void act(r.id, () => ignoreBusinessExclusion(r.id), '무시 처리')} className="rounded bg-ink/5 px-2 py-1 font-semibold text-ink-mute disabled:opacity-40">무시</button>
                    <button disabled={busyId === r.id} onClick={() => void act(r.id, async () => { await applyAiMetadataAndRecompute(r.track_id, { autoResolve: false }); }, 'AI 메타 재적용 완료')} className="rounded bg-accent/15 px-2 py-1 font-semibold text-accent disabled:opacity-40">AI 메타 재적용</button>
                    <button disabled={busyId === r.id} onClick={() => setMetaModal({ track_id: r.track_id, title: r.title })} className="rounded bg-indigo-500/25 px-2 py-1 font-semibold text-indigo-600 disabled:opacity-40">메타 수정</button>
                    {!r.store_group_key && r.playlist_store_key.startsWith('cafe') && (
                      <button disabled={busyId === r.id} onClick={() => void act(r.id, () => excludeTrackGroup(r.track_id, 'cafe'), '카페 그룹 전체 제외')} className="rounded bg-amber-500/25 px-2 py-1 font-semibold text-amber-300 disabled:opacity-40">카페그룹 전체 제외</button>
                    )}
                  </>
                ) : (
                  <button disabled={busyId === r.id} onClick={() => void act(r.id, () => reactivateBusinessExclusion(r.id), '제외 유지')} className="rounded bg-rose-500/25 px-2 py-1 font-semibold text-rose-300 disabled:opacity-40">제외 유지</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {metaModal && (
        <MetaApproveModal trackId={metaModal.track_id} title={metaModal.title} canApprove={false}
          onClose={() => setMetaModal(null)} onDone={() => { setMetaModal(null); void load(); }} />
      )}
    </div>
  );
}
