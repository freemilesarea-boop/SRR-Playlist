import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  generateAllReorders,
  listReorderProposals,
  getReorderProposal,
  applyPlaylistReorder,
  rejectPlaylistReorder,
  type ReorderProposalRow,
  type ReorderDetail,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';
import { flowColor } from './shared';

export default function ReorderTab() {
  const [proposals, setProposals] = useState<ReorderProposalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReorderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setProposals(await listReorderProposals()); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function genAll() {
    setRunning(true);
    try { const r = await generateAllReorders(); toast.success(`제안 생성 — ${r.proposals}개 (개선 ${r.with_improvement})`); await load(); }
    catch (e) { toast.error(`생성 실패: ${(e as Error).message}`); }
    finally { setRunning(false); }
  }
  async function openDetail(pid: string) {
    if (expanded === pid) { setExpanded(null); setDetail(null); return; }
    setExpanded(pid); setDetail(null); setDetailLoading(true);
    try { setDetail(await getReorderProposal(pid)); }
    catch (e) { toast.error(`상세 실패: ${(e as Error).message}`); }
    finally { setDetailLoading(false); }
  }
  async function approve(proposalId: string, title: string | null) {
    if (!window.confirm(`"${title ?? ''}" 곡 순서를 제안안대로 변경합니다. (곡 추가/삭제 없음, 순서만) 적용할까요?`)) return;
    setBusyId(proposalId);
    try { const r = await applyPlaylistReorder(proposalId); toast.success(`적용됨 — ${r.reordered}곡 재정렬`); setExpanded(null); setDetail(null); await load(); }
    catch (e) { toast.error(`적용 실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  }
  async function reject(proposalId: string) {
    setBusyId(proposalId);
    try { await rejectPlaylistReorder(proposalId); toast.success('거절됨'); setExpanded(null); setDetail(null); await load(); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  }

  const mDelta = (b?: number, a?: number) => (b == null || a == null) ? '' : `${b}→${a}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void genAll()} disabled={running}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50">{running ? '생성 중…' : '전체 제안 생성'}</button>
        <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-2 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
      </div>
      <p className="text-[11px] text-ink-dim">Flow Score 기준으로 BPM/에너지 곡선·보컬 충돌·단조로움·전환 피로를 최소화하는 <b>추천 순서안</b>을 생성합니다. <b className="text-rose-600">자동 적용 없음</b> — 관리자가 "승인 적용"을 눌러야 순서가 반영됩니다 (곡 추가/삭제 없음).</p>

      {proposals.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">{loading ? '불러오는 중…' : '대기 중인 제안이 없어요. "전체 제안 생성"을 실행하세요.'}</p>
      ) : (
        <ul className="space-y-2">
          {proposals.map((p) => (
            <li key={p.id} className="rounded-xl bg-bg-card p-3">
              <div className="flex items-center gap-3">
                <div className="flex shrink-0 items-center gap-1 text-center">
                  <span className={`text-lg font-bold ${flowColor(p.current_score)}`}>{p.current_score ?? '—'}</span>
                  <span className="text-ink-dim">→</span>
                  <span className={`text-xl font-extrabold ${flowColor(p.proposed_score)}`}>{p.proposed_score ?? '—'}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold">{p.title ?? '(제목없음)'} <span className="ml-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">+{p.improvement ?? 0}</span></p>
                  <p className="mt-0.5 text-[10px] text-ink-dim">
                    {p.n_tracks}곡 · 거친전환 {mDelta(p.metrics_before?.rough_transitions, p.metrics_after?.rough_transitions)} · 단조 {mDelta(p.metrics_before?.repetitive_count, p.metrics_after?.repetitive_count)} · 감정연속성 {mDelta(p.metrics_before?.emotional_continuity, p.metrics_after?.emotional_continuity)}
                  </p>
                </div>
                <span className="flex shrink-0 flex-col gap-1">
                  <button onClick={() => void openDetail(p.playlist_id)} className="rounded bg-bg-soft px-2 py-1 text-[10px] font-semibold text-ink-mute hover:bg-bg-hover">{expanded === p.playlist_id ? '접기' : '순서 비교'}</button>
                  <button disabled={busyId === p.id} onClick={() => void approve(p.id, p.title)} className="rounded bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-600 disabled:opacity-40">승인 적용</button>
                  <button disabled={busyId === p.id} onClick={() => void reject(p.id)} className="rounded bg-ink/5 px-2 py-1 text-[10px] font-semibold text-ink-mute disabled:opacity-40">거절</button>
                </span>
              </div>

              {expanded === p.playlist_id && (
                <div className="mt-3 rounded-lg bg-bg-soft p-2 text-[10px]">
                  {detailLoading || !detail || !detail.ok ? <p className="text-ink-dim">{detailLoading ? '불러오는 중…' : (detail?.note ?? '')}</p> : (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="mb-1 font-bold text-ink-mute">현재 순서</p>
                        <ol className="space-y-0.5">
                          {(detail.current_list ?? []).map((t) => <li key={t.position} className="truncate"><span className="text-ink-dim">{t.position}.</span> {t.title ?? '(제목없음)'}</li>)}
                        </ol>
                      </div>
                      <div>
                        <p className="mb-1 font-bold text-accent">제안 순서</p>
                        <ol className="space-y-0.5">
                          {(detail.proposed_list ?? []).map((t) => <li key={t.position} className={`truncate ${t.moved ? 'font-semibold text-accent' : ''}`}><span className="text-ink-dim">{t.position}.</span> {t.title ?? '(제목없음)'}{t.moved ? ' ↻' : ''}</li>)}
                        </ol>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
