import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  exportEmbeddingPending,
  importTrackEmbeddings,
  embeddingStatus,
  buildStoreArchetypes,
  type EmbeddingStatus,
  type EmbeddingPendingRow,
  type EmbeddingImportResult,
} from '@/lib/aiCuration';
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

  const loadPending = useCallback(async () => {
    setLoading(true);
    try {
      const [p, st] = await Promise.all([
        exportEmbeddingPending('laion-clap-music-v1', 500),
        embeddingStatus('laion-clap-music-v1').catch((e) => {
          console.warn('[EmbeddingTab] embeddingStatus failed:', e);
          return null;
        }),
      ]);
      setPending(p); setStatus(st);
    }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadPending(); }, [loadPending]);

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
      <p className="text-[11px] text-ink-mute">
        Mac mini 없이 Colab/로컬에서 OpenL3 임베딩을 생성하는 수동 파이프라인입니다.
        ① pending CSV 내보내기 → ② Colab 에서 임베딩 생성(generated_embeddings.json) → ③ 여기서 dry-run 검증 후 임포트.
        자동 추천에는 반영되지 않습니다(관리자 검증용).
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
            <p className={result.skipped > 0 ? 'text-amber-600' : 'text-emerald-600'}>
              {result.dry_run ? '검증' : '임포트'}: 성공 <b>{result.imported}</b> · 건너뜀 <b>{result.skipped}</b>
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-[10px] text-rose-600">
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
        {status && status.track_embeddings === 0 && <p className="mt-1 text-[10px] text-amber-600">곡 임베딩이 아직 0건입니다 — 먼저 ②③ 임포트를 완료하세요.</p>}
      </div>
    </div>
  );
}
