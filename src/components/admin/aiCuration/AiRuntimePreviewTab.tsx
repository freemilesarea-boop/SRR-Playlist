// AiRuntimePreviewTab — Phase AI-PIPELINE-CONNECTION-1
//
// 관리자 전용 READ-ONLY 프리뷰. 현재 끊겨 있는 파이프라인을 한 칸만 더 이어 "보여주기만" 한다:
//   Store Fit → Candidate Pool → AI Candidate Queue
// 실 재생/큐/스케줄러/로테이션/크로스페이드에는 전혀 손대지 않는다. 아무것도 저장하지 않는다.
//
// 노출은 기본 OFF 인 "AI 런타임 프리뷰" 토글 뒤에서만. (localStorage 플래그)
// RPC 는 admin_ai_store_candidate_pool / admin_ai_build_store_queue (admin-gated, read-only, 0463).
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, FlaskConical, ListOrdered, ShieldAlert } from 'lucide-react';

import { fetchPlaylists } from '@/lib/api';
import { fetchMemberList, type MemberRow } from '@/lib/adminApi';
import type { PlaylistRow } from '@/types/db';
import { toast } from '@/store/toastStore';
import { adminTones } from '@/lib/adminTones';
import {
  adminAiStoreCandidatePool,
  adminAiBuildStoreQueue,
} from '@/lib/api/aiRuntimePreviewApi';
import {
  isAiRuntimePreviewEnabled,
  setAiRuntimePreviewEnabled,
  classificationLabel,
  classificationTone,
  formatFitScore,
  poolEligibleRatio,
  summarizePoolCounts,
  type CandidatePoolResult,
  type StoreQueueResult,
} from '@/lib/aiRuntimePreview';

export default function AiRuntimePreviewTab() {
  const [enabled, setEnabled] = useState<boolean>(() => isAiRuntimePreviewEnabled());

  const [stores, setStores] = useState<MemberRow[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [storeId, setStoreId] = useState<string>('');
  const [pid, setPid] = useState<string>('');

  const [pool, setPool] = useState<CandidatePoolResult | null>(null);
  const [queue, setQueue] = useState<StoreQueueResult | null>(null);
  const [loading, setLoading] = useState(false);

  function toggle(on: boolean) {
    setAiRuntimePreviewEnabled(on);
    setEnabled(on);
    if (!on) { setPool(null); setQueue(null); }
  }

  // 옵션 로드는 기능이 켜져 있을 때만.
  useEffect(() => {
    if (!enabled) return;
    fetchMemberList({ role: undefined, limit: 200 })
      .then((rows) => {
        const biz = rows.filter((r) => r.account_type === 'business' && !r.withdrawn_at);
        setStores(biz);
        if (biz[0]) setStoreId((prev) => prev || biz[0].id);
      })
      .catch((e) => console.warn('[AiRuntimePreviewTab] fetchMemberList failed:', e));
    fetchPlaylists()
      .then((p) => { setPlaylists(p); if (p[0]) setPid((prev) => prev || p[0].id); })
      .catch((e) => console.warn('[AiRuntimePreviewTab] fetchPlaylists failed:', e));
  }, [enabled]);

  const load = useCallback(async () => {
    if (!storeId || !pid) return;
    setLoading(true);
    try {
      const [p, q] = await Promise.all([
        adminAiStoreCandidatePool(storeId, pid),
        adminAiBuildStoreQueue(storeId, pid, 50),
      ]);
      setPool(p);
      setQueue(q);
    } catch (e) {
      toast.error(`프리뷰 계산 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [storeId, pid]);

  if (!enabled) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl bg-bg-card p-4 ring-1 ring-line/10">
          <h4 className="flex items-center gap-2 text-sm font-bold">
            <FlaskConical size={15} className="text-accent" /> AI 런타임 프리뷰 (기본 OFF)
          </h4>
          <p className="mt-2 text-xs leading-relaxed text-ink-mute">
            현재 <span className="font-mono">Store Fit → (DB 저장)</span> 에서 멈춰 있는 파이프라인을
            <span className="font-semibold text-ink"> 관리자에게만, 읽기 전용으로</span> 한 칸 더 이어
            <span className="font-mono"> Candidate Pool → AI Candidate Queue</span> 를 미리 보여줍니다.
            실 재생·큐·스케줄러·로테이션에는 전혀 영향을 주지 않으며 아무것도 저장하지 않습니다.
          </p>
          <button
            onClick={() => toggle(true)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black"
          >
            프리뷰 켜기
          </button>
        </div>
      </div>
    );
  }

  const ratio = pool ? poolEligibleRatio(pool.counts) : 0;

  return (
    <div className="space-y-3">
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
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 프리뷰 계산
        </button>
        <button
          onClick={() => toggle(false)}
          className="ml-auto inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-2 text-xs font-semibold text-ink-mute hover:bg-bg-hover"
        >
          프리뷰 끄기
        </button>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-ink-dim">
        <ShieldAlert size={12} className={`shrink-0 ${adminTones.warning.icon}`} />
        읽기 전용 미리보기입니다. 실 재생/큐/자동배치에는 반영되지 않으며 저장되지 않습니다.
      </p>

      {!pool ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">
          {loading ? '계산 중…' : '매장과 플레이리스트를 고르고 "프리뷰 계산"을 눌러보세요.'}
        </p>
      ) : (
        <div className="space-y-4">
          {/* Candidate Pool */}
          <section className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="flex items-center gap-1.5 text-xs font-bold">
                <FlaskConical size={13} className="text-accent" /> 후보 풀 (Candidate Pool)
              </h4>
              <span className="text-[11px] text-ink-dim">
                {pool.store_type_canonical ?? '매장유형 미상'} · {summarizePoolCounts(pool.counts)}
              </span>
            </div>
            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-ink/10" title="재생 가능 비율">
              <div className="h-full bg-emerald-400" style={{ width: `${Math.round(ratio * 100)}%` }} />
            </div>
            {pool.tracks.length === 0 ? (
              <p className="py-4 text-center text-xs text-ink-dim">플레이리스트에 트랙이 없습니다.</p>
            ) : (
              <ul className="divide-y divide-line/10">
                {pool.tracks.map((t) => (
                  <li key={t.track_id} className="flex items-center gap-2 py-1.5 text-xs">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${classificationTone(t.classification)}`}>
                      {classificationLabel(t.classification)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {t.title ?? '(제목없음)'} · <span className="text-ink-dim">{t.artist ?? ''}</span>
                    </span>
                    {t.guardrail_penalty > 0 && (
                      <span className="shrink-0 font-mono text-[10px] text-amber-300">−{t.guardrail_penalty}</span>
                    )}
                    <span className="w-8 shrink-0 text-right font-bold tabular-nums text-emerald-300">
                      {formatFitScore(t.fit_score)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* AI Candidate Queue */}
          <section className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="flex items-center gap-1.5 text-xs font-bold">
                <ListOrdered size={13} className="text-accent" /> AI 후보 큐 (Queue Preview)
              </h4>
              <span className="text-[11px] text-ink-dim">{queue?.queue_length ?? 0}곡 · 차단 제외 · 적합도순</span>
            </div>
            {!queue || queue.queue.length === 0 ? (
              <p className="py-4 text-center text-xs text-ink-dim">재생 가능한 후보가 없습니다.</p>
            ) : (
              <ol className="divide-y divide-line/10">
                {queue.queue.map((q) => (
                  <li key={q.track_id} className="flex items-center gap-2 py-1.5 text-xs">
                    <span className="w-5 shrink-0 text-right font-mono text-[10px] text-ink-dim">{q.position}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {q.title ?? '(제목없음)'} · <span className="text-ink-dim">{q.artist ?? ''}</span>
                    </span>
                    {q.fit_status === 'review_needed' && (
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${adminTones.warning.badge}`}>검토</span>
                    )}
                    <span className="w-8 shrink-0 text-right font-bold tabular-nums text-emerald-300">
                      {formatFitScore(q.fit_score)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
