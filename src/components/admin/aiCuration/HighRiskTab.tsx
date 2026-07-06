import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  listHighRiskTracks,
  getUploaderDetail,
  applyAiMetadata,
  bulkGuardrailClear,
  type HighRiskTrack,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';
import MetaApproveModal from '@/components/admin/MetaApproveModal';
import { canApproveStatus } from './shared';

export default function HighRiskTab() {
  const [rows, setRows] = useState<HighRiskTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [metaModal, setMetaModal] = useState<{ track_id: string; title: string | null; canApprove: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await listHighRiskTracks(200)); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, fn: () => Promise<unknown>, msg: string) {
    setBusyId(id);
    try { await fn(); toast.success(msg); await load(); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  }
  async function copyNotice(userId: string) {
    try { const d = await getUploaderDetail(userId); await navigator.clipboard.writeText(d.notice_message); toast.success('업로더 안내 문구를 복사했어요.'); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-ink-dim">trust&lt;50 · guardrail hard · AI 불일치 · 임베딩 불일치 · 품질 REJECT(오디오 차단) 곡을 위험도순으로. (추천/정산 미반영)</p>
        <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">{loading ? '불러오는 중…' : '고위험 곡이 없어요.'}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.track_id} className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold">{r.title ?? '(제목없음)'} <span className="text-xs text-ink-mute">· {r.artist ?? ''} · {r.release_status}</span></span>
                <span className="shrink-0 rounded-full bg-rose-500/25 px-2 py-0.5 text-[10px] font-bold text-rose-300">위험도 {r.risk_score}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                {r.low_trust && <span className="rounded bg-rose-500/25 px-1.5 py-0.5 text-rose-300">trust {r.trust_score}</span>}
                {r.guardrail_hard && <span className="rounded bg-rose-500/25 px-1.5 py-0.5 text-rose-300">차단 {r.hard_stores}매장</span>}
                {r.ai_mismatch_high && <span className="rounded bg-amber-500/25 px-1.5 py-0.5 text-amber-200">AI 불일치 {Math.round((r.mismatch_score ?? 0) * 100)}%</span>}
                {r.embedding_disagree_high && <span className="rounded bg-amber-500/25 px-1.5 py-0.5 text-amber-200">임베딩 불일치</span>}
                {r.lufs_boundary && (
                  <span title="오디오 품질 게이트(0210) 결과 reject — TP>+0.3 또는 clipping 또는 분석 실패"
                    className="rounded bg-rose-500/25 px-1.5 py-0.5 text-rose-300">품질 REJECT</span>
                )}
                <span className="rounded bg-ink/5 px-1.5 py-0.5 text-ink-dim">{r.owner_name ?? ''} ({r.trust_tier})</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button onClick={() => void act(r.track_id, () => applyAiMetadata(r.track_id, {}), 'AI 메타 적용')} disabled={busyId === r.track_id}
                  className="rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent disabled:opacity-50">AI 메타 적용</button>
                {r.guardrail_hard && (
                  <button onClick={() => void act(r.track_id, () => bulkGuardrailClear([r.track_id], '고위험 검수 - 문제없음'), '문제 없음(차단 해제)')} disabled={busyId === r.track_id}
                    className="rounded-lg bg-emerald-500/25 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 disabled:opacity-50">문제 없음</button>
                )}
                <button onClick={() => setMetaModal({ track_id: r.track_id, title: r.title, canApprove: canApproveStatus(r.release_status) })} disabled={busyId === r.track_id}
                  className="rounded-lg bg-indigo-500/25 px-2.5 py-1.5 text-xs font-semibold text-indigo-600 disabled:opacity-50">메타 수정/승인</button>
                <button onClick={() => void copyNotice(r.owner_user_id)} className="rounded-lg bg-bg-soft/60 px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover">업로더 안내문구 복사</button>
              </div>
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
