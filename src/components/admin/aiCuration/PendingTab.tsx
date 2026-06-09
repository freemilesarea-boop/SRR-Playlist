import { useCallback, useEffect, useState } from 'react';
import { Play, RefreshCw, FlaskConical } from 'lucide-react';
import {
  listAiCuration,
  markAnalysisFailed,
  type AiCurationRow,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';
import { BATCH, analyzeOne } from './shared';

export default function PendingTab() {
  const [rows, setRows] = useState<AiCurationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await listAiCuration('pending', 200)); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function runBatch(targets: AiCurationRow[], useMock: boolean) {
    setBusy(true);
    let ok = 0, fail = 0;
    try {
      for (let i = 0; i < targets.length; i += BATCH) {
        const slice = targets.slice(i, i + BATCH);
        for (const row of slice) {
          setProgress(`분석 중… ${ok + fail + 1}/${targets.length} — ${row.title ?? ''}`);
          try {
            await analyzeOne(row, useMock);
            ok++;
          } catch (e) {
            fail++;
            await markAnalysisFailed(row.track_id, (e as Error).message).catch(() => {});
          }
        }
      }
      toast.success(`분석 완료 — 성공 ${ok} · 실패 ${fail}`);
      await load();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void runBatch(rows, false)} disabled={busy || rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50">
          <Play size={13} /> 전체 실분석 ({rows.length})
        </button>
        <button onClick={() => void runBatch(rows, true)} disabled={busy || rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">
          <FlaskConical size={13} /> 테스트용 mock 채우기
        </button>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold hover:bg-bg-hover">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
        {progress && <span className="text-xs text-ink-mute">{progress}</span>}
      </div>
      <p className="text-[11px] text-ink-dim">
        실분석은 브라우저 Web Audio 로 곡을 디코드합니다(대용량은 느릴 수 있음). 실패 곡은 status=failed 로 기록되며 재생/발매에는 영향 없습니다.
      </p>
      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">
          {loading ? '불러오는 중…' : '분석 대기 곡이 없어요. (모두 분석 완료)'}
        </p>
      ) : (
        <ul className="divide-y divide-line/10 rounded-xl bg-bg-card">
          {rows.map((r) => (
            <li key={r.track_id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
              <span className="truncate">{r.title ?? '(제목없음)'} · <span className="text-ink-dim">{r.artist ?? ''}</span></span>
              <span className="shrink-0 rounded bg-ink/5 px-1.5 py-0.5 text-[10px] text-ink-dim">{r.feature_status ?? '미분석'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
