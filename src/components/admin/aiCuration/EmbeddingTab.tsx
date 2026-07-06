import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Settings, Play, RotateCw } from 'lucide-react';
import {
  exportEmbeddingPending,
  importTrackEmbeddings,
  embeddingStatus,
  buildStoreArchetypes,
  type EmbeddingStatus,
  type EmbeddingPendingRow,
  type EmbeddingImportResult,
} from '@/lib/aiCuration';
import {
  getEmbeddingPipelineStatus,
  listEmbeddingJobs,
  backfillEnqueue,
  retryEmbeddingJob,
  setEmbedBackendUrl,
  manualDispatch,
  type EmbeddingPipelineStatus,
  type EmbeddingJobRow,
} from '@/lib/embeddingPipeline';
import { toast } from '@/store/toastStore';
import { PStat } from './shared';

export default function EmbeddingTab() {
  const [pending, setPending] = useState<EmbeddingPendingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [parsed, setParsed] = useState<unknown[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<EmbeddingImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  // X6.73 — auto pipeline (Phase 6)
  const [pipeline, setPipeline] = useState<EmbeddingPipelineStatus | null>(null);
  const [jobs, setJobs] = useState<EmbeddingJobRow[]>([]);
  const [backendDraft, setBackendDraft] = useState<string>('');
  const [pipelineBusy, setPipelineBusy] = useState(false);

  const loadPending = useCallback(async () => {
    setLoading(true);
    try {
      const [p, st, pl, js] = await Promise.all([
        exportEmbeddingPending('laion-clap-music-v1', 500),
        embeddingStatus('laion-clap-music-v1').catch((e) => {
          console.warn('[EmbeddingTab] embeddingStatus failed:', e);
          return null;
        }),
        getEmbeddingPipelineStatus().catch((e) => {
          console.warn('[EmbeddingTab] pipelineStatus failed:', e);
          return null;
        }),
        listEmbeddingJobs('all', 30).catch(() => []),
      ]);
      setPending(p); setStatus(st); setPipeline(pl); setJobs(js);
      if (pl?.backend_url) {
        // jsonb 직렬화 따옴표 제거
        setBackendDraft(pl.backend_url.replace(/^"|"$/g, ''));
      }
    }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadPending(); }, [loadPending]);

  async function saveBackendUrl() {
    const url = backendDraft.trim();
    if (url && !url.startsWith('http')) {
      toast.error('http(s):// 로 시작해야 합니다.');
      return;
    }
    setPipelineBusy(true);
    try {
      await setEmbedBackendUrl(url);
      toast.success(url ? 'backend URL 저장됨' : 'backend URL 비움 (dispatcher 정지)');
      await loadPending();
    } catch (e) {
      toast.error(`저장 실패: ${(e as Error).message}`);
    } finally {
      setPipelineBusy(false);
    }
  }
  async function runBackfillEnqueue() {
    if (!confirm('미임베딩 트랙을 큐에 일괄 적재할까요? (최대 1000건, 5분마다 backend 로 dispatch)')) return;
    setPipelineBusy(true);
    try {
      const r = await backfillEnqueue(1000);
      toast.success(`큐 적재 ${r.enqueued}건 (스킵 ${r.skipped})`);
      await loadPending();
    } catch (e) {
      toast.error(`적재 실패: ${(e as Error).message}`);
    } finally {
      setPipelineBusy(false);
    }
  }
  async function runManualDispatch() {
    setPipelineBusy(true);
    try {
      const r = await manualDispatch();
      if (r.reason) toast.info(`dispatch skip: ${r.reason}`);
      else toast.success(`수동 dispatch: ${r.dispatched}건`);
      await loadPending();
    } catch (e) {
      toast.error(`dispatch 실패: ${(e as Error).message}`);
    } finally {
      setPipelineBusy(false);
    }
  }
  async function retryJob(jobId: string) {
    setPipelineBusy(true);
    try {
      await retryEmbeddingJob(jobId);
      toast.success('재시도 큐 복귀');
      await loadPending();
    } catch (e) {
      toast.error(`재시도 실패: ${(e as Error).message}`);
    } finally {
      setPipelineBusy(false);
    }
  }

  async function buildArchetypes() {
    setBusy(true);
    try { const r = await buildStoreArchetypes('laion-clap-music-v1', 8); toast.success(`매장 아키타입 생성 — ${r.built}개 매장`); await loadPending(); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  function downloadCsv() {
    const header = 'track_id,audio_url,title,artist,duration';
    const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const body = pending.map((r) => [r.track_id, r.audio_url, r.title, r.artist, r.duration].map(esc).join(',')).join('\n');
    const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'embedding_pending.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setResult(null);
    if (!f) return;
    setFileName(f.name);
    try {
      const json = JSON.parse(await f.text());
      const arr = Array.isArray(json) ? json : Array.isArray((json as { embeddings?: unknown[] }).embeddings) ? (json as { embeddings: unknown[] }).embeddings : null;
      if (!arr) throw new Error('JSON 은 배열 또는 {embeddings:[...]} 형식이어야 합니다.');
      setParsed(arr);
      toast.info(`${arr.length}개 row 파싱됨. dry-run 으로 검증하세요.`);
    } catch (err) {
      setParsed(null);
      toast.error(`JSON 파싱 실패: ${(err as Error).message}`);
    }
  }

  async function runImport(dryRun: boolean) {
    if (!parsed) { toast.info('먼저 generated_embeddings.json 을 선택하세요.'); return; }
    setBusy(true);
    try {
      const res = await importTrackEmbeddings(parsed, dryRun);
      setResult(res);
      toast.success(`${dryRun ? '검증(dry-run)' : '임포트'} 완료 — 성공 ${res.imported} / 건너뜀 ${res.skipped}`);
      if (!dryRun) await loadPending();
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      {/* X6.73 — Phase 6 자동 파이프라인 (신규 트랙 자동 + 백필 1-click) */}
      <section className="rounded-2xl bg-gradient-to-br from-accent/10 to-bg-card p-4 ring-1 ring-accent/30">
        <header className="mb-3 flex items-center gap-2">
          <Settings size={14} className="text-accent" />
          <h3 className="text-sm font-bold">자동 파이프라인 (Phase 6 / X6.73)</h3>
          <span className="ml-auto rounded-full bg-ink/10 px-2 py-0.5 text-[10px] text-ink-dim">
            cron 5분 간격 dispatch
          </span>
        </header>
        {pipeline && (
          <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
            <PStat label="임베딩 완료" v={pipeline.embedded} />
            <PStat label="발매곡 총합" v={pipeline.released_total} />
            <PStat label="큐 대기" v={pipeline.queue_pending} />
            <PStat label="큐 처리중" v={pipeline.queue_dispatched} />
            <PStat label="미적재 대기" v={pipeline.pending_no_job} />
            <PStat label="24h 완료" v={pipeline.queue_done_24h} />
            <PStat label="24h 실패" v={pipeline.queue_error_24h} />
            <PStat label="진행률"
              v={pipeline.released_total > 0
                ? `${Math.round(pipeline.embedded * 100 / pipeline.released_total)}%`
                : '-'} />
          </div>
        )}
        <div className="mb-2 space-y-1.5">
          <label className="block text-[11px]">
            <span className="text-ink-mute">Embed backend URL (Modal/Edge Function)</span>
            <div className="mt-0.5 flex gap-1.5">
              <input
                type="url"
                value={backendDraft}
                onChange={(e) => setBackendDraft(e.target.value)}
                placeholder="https://....modal.run/embed-single"
                className="input flex-1 text-xs"
                disabled={pipelineBusy}
              />
              <button
                onClick={() => void saveBackendUrl()}
                disabled={pipelineBusy}
                className="rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-black hover:opacity-90 disabled:opacity-40"
              >
                저장
              </button>
            </div>
            <span className="block text-[10px] text-ink-dim">
              비워두면 dispatcher 정지. 설정 안내: <code>docs/CLAP_EMBEDDING_PIPELINE.md</code>
              <br />
              <b>🟢 가장 빠른 백필 (Modal 불필요)</b>: 노트북에서 <code>cd scripts/clap_embedder &amp;&amp; pip install -r requirements.txt &amp;&amp; python local_worker.py --backfill-all --loop</code>
            </span>
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => void runBackfillEnqueue()}
            disabled={pipelineBusy || (pipeline?.pending_no_job ?? 0) === 0}
            className="inline-flex items-center gap-1 rounded-md bg-bg-card px-3 py-1.5 text-xs font-semibold ring-1 ring-line/10 hover:bg-bg-hover disabled:opacity-40"
          >
            <Play size={11} /> 미임베딩 일괄 큐 적재 ({pipeline?.pending_no_job ?? 0})
          </button>
          <button
            onClick={() => void runManualDispatch()}
            disabled={pipelineBusy || (pipeline?.queue_pending ?? 0) === 0}
            className="inline-flex items-center gap-1 rounded-md bg-bg-card px-3 py-1.5 text-xs font-semibold ring-1 ring-line/10 hover:bg-bg-hover disabled:opacity-40"
          >
            <RotateCw size={11} /> 수동 dispatch (1배치)
          </button>
          <button
            onClick={() => void loadPending()}
            disabled={pipelineBusy}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-bg-card px-2 py-1.5 text-xs font-semibold ring-1 ring-line/10 hover:bg-bg-hover"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
          </button>
        </div>

        {jobs.length > 0 && (
          <details className="mt-3 text-[11px]">
            <summary className="cursor-pointer text-ink-mute">최근 작업 ({jobs.length}건)</summary>
            <ul className="mt-1 max-h-60 space-y-0.5 overflow-y-auto">
              {jobs.map((j) => (
                <li key={j.id} className="flex items-baseline justify-between gap-2 rounded bg-bg-soft px-2 py-0.5">
                  <span className="truncate">
                    <span className={`mr-1 inline-block rounded px-1 text-[9px] font-bold ${
                      j.status === 'done' ? 'bg-emerald-500/25 text-emerald-700 dark:text-emerald-300'
                      : j.status === 'error' ? 'bg-rose-500/25 text-rose-700 dark:text-rose-300'
                      : j.status === 'dispatched' ? 'bg-sky-500/25 text-sky-700 dark:text-sky-300'
                      : 'bg-amber-500/25 text-amber-700 dark:text-amber-300'
                    }`}>{j.status}</span>
                    <span className="text-ink-mute">[{j.source}]</span>{' '}
                    <span className="text-ink">{j.track_title ?? j.track_id.slice(0, 8)}</span>
                    {j.attempts > 1 && <span className="ml-1 text-[10px] text-ink-dim">(try {j.attempts}/{j.max_attempts})</span>}
                    {j.error && <span className="ml-1 text-rose-700 dark:text-rose-300">— {j.error.slice(0, 60)}</span>}
                  </span>
                  <span className="flex items-center gap-1 text-ink-dim">
                    {j.status === 'error' && (
                      <button
                        onClick={() => void retryJob(j.id)}
                        disabled={pipelineBusy}
                        title="재시도"
                        className="text-accent hover:underline"
                      >재시도</button>
                    )}
                    <span>{new Date(j.enqueued_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' })}</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <p className="text-[11px] text-ink-mute">
        ↓ 아래 수동 워크플로우는 자동 파이프라인이 작동하지 않거나 백필 검증용 fallback.
        Colab/로컬에서 임베딩 생성 → ② generated_embeddings.json → ③ dry-run 검증 후 임포트.
      </p>

      <div className="rounded-xl bg-bg-card p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold">① 분석 대기 ({pending.length})</h3>
          <div className="flex gap-1.5">
            <button onClick={() => void loadPending()} className="inline-flex items-center gap-1 rounded-lg bg-bg-soft/60 px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
            </button>
            <button onClick={downloadCsv} disabled={pending.length === 0} className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-bold text-black disabled:opacity-50">
              embedding_pending.csv 다운로드
            </button>
          </div>
        </div>
        <p className="text-[10px] text-ink-dim">CSV 컬럼: track_id, audio_url, title, artist, duration</p>
      </div>

      <div className="rounded-xl bg-bg-card p-3">
        <h3 className="mb-2 text-xs font-bold">② → ③ generated_embeddings.json 임포트</h3>
        <input type="file" accept="application/json,.json" onChange={onFile} className="block w-full text-xs text-ink-mute file:mr-2 file:rounded file:border-0 file:bg-bg-soft file:px-2 file:py-1 file:text-xs" />
        {fileName && <p className="mt-1 text-[10px] text-ink-dim">{fileName}{parsed ? ` · ${parsed.length} rows` : ''}</p>}
        <div className="mt-2 flex gap-1.5">
          <button onClick={() => void runImport(true)} disabled={busy || !parsed} className="inline-flex items-center gap-1 rounded-lg bg-bg-soft/60 px-3 py-1.5 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">
            dry-run 검증
          </button>
          <button onClick={() => void runImport(false)} disabled={busy || !parsed} className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50">
            임포트 실행
          </button>
        </div>
        {result && (
          <div className="mt-2 rounded-lg bg-bg-soft/40 p-2 text-[11px]">
            <p className={result.skipped > 0 ? 'text-amber-300' : 'text-emerald-300'}>
              {result.dry_run ? '검증' : '임포트'}: 성공 <b>{result.imported}</b> · 건너뜀 <b>{result.skipped}</b>
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-[10px] text-rose-300">
                {result.errors.slice(0, 50).map((er, i) => <li key={i}>· {er.track_id}: {er.reason}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl bg-bg-card p-3">
        <h3 className="mb-2 text-xs font-bold">④ 매장 아키타입 생성 (추천 작동에 필수)</h3>
        <p className="mb-2 text-[10px] text-ink-dim">
          곡 임베딩 적재 후 실행하세요. 각 매장의 대표 벡터를 (승인된 seed 곡 또는 ai_store_fit 상위 곡의 임베딩 평균으로) 생성합니다.
          이게 있어야 "임베딩 검증" 탭의 TOP5 매장 추천(recommend_stores_for_track)이 작동합니다.
        </p>
        {status && (
          <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <PStat label="곡 임베딩" v={status.track_embeddings} />
            <PStat label="매장 아키타입" v={status.store_archetypes} />
            <PStat label="미적재(대기)" v={status.pending} />
            <PStat label="차원" v={status.embedding_dim ?? '-'} />
          </div>
        )}
        <button onClick={() => void buildArchetypes()} disabled={busy || (status?.track_embeddings ?? 0) === 0}
          className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50">
          매장 아키타입 생성/갱신
        </button>
        {status && status.track_embeddings === 0 && <p className="mt-1 text-[10px] text-amber-300">곡 임베딩이 아직 0건입니다 — 먼저 ②③ 임포트를 완료하세요.</p>}
      </div>
    </div>
  );
}
