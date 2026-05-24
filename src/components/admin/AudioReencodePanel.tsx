import { useCallback, useEffect, useRef, useState } from 'react';
import { Music, RefreshCw, Play, Square, CheckCircle2, AlertTriangle, Smartphone } from 'lucide-react';
import {
  listReencodeCandidates,
  reencodeTrackToMp3,
  markConversionFailed,
  type ReencodeCandidate,
  type ReencodeProgress,
} from '@/lib/audioReencode';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';

type RowStatus =
  | { kind: 'idle' }
  | { kind: 'working'; phase: ReencodeProgress['phase']; ratio?: number }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

/**
 * iOS 호환 오디오 재인코딩 (WAV → MP3).
 * iPhone Safari 는 스트리밍 WAV 디코딩에 실패하므로, 기존 .wav 음원을 표준 MP3 로 변환해
 * audio_url 을 교체한다. 원본 파일은 보존(비파괴), 관리자 브라우저에서 ffmpeg.wasm 으로 처리.
 */
export default function AudioReencodePanel() {
  const [list, setList] = useState<ReencodeCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listReencodeCandidates();
      setList(rows);
    } catch (e) {
      toast.error(`목록 로드 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function setStatus(id: string, s: RowStatus) {
    setStatuses((prev) => ({ ...prev, [id]: s }));
  }

  async function runOne(c: ReencodeCandidate): Promise<boolean> {
    try {
      await reencodeTrackToMp3(c, (p) => setStatus(c.track_id, { kind: 'working', phase: p.phase, ratio: p.ratio }));
      setStatus(c.track_id, { kind: 'done' });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(c.track_id, { kind: 'error', message: msg });
      // 실패 영속화 → 사용자 플레이리스트/추천에서 제외 + 관리자 사유 표시
      await markConversionFailed(c.track_id, msg);
      return false;
    }
  }

  async function runAll() {
    if (running) return;
    setRunning(true);
    stopRef.current = false;
    let ok = 0;
    let fail = 0;
    for (const c of list) {
      if (stopRef.current) break;
      if (statuses[c.track_id]?.kind === 'done') continue;
      const r = await runOne(c);
      r ? ok++ : fail++;
    }
    setRunning(false);
    toast[fail === 0 ? 'success' : 'warning'](`재인코딩 완료 — 성공 ${ok} / 실패 ${fail}`);
    // 완료된 트랙은 목록에서 사라지도록 재조회
    await load();
  }

  const pending = list.filter((c) => statuses[c.track_id]?.kind !== 'done');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
          <Smartphone size={16} className="text-accent" /> 오디오 변환 (iOS 호환 MP3)
        </h2>
        <p className="mt-0.5 text-xs text-ink-mute">
          iPhone Safari 는 WAV 스트리밍 재생에 실패합니다. 기존 <code className="font-mono">.wav</code> 음원을
          표준 MP3 로 변환해 모바일에서 재생되게 합니다. (원본 보존 · 이 브라우저에서 변환)
        </p>
      </div>

      <Alert tone="info">
        <p className="text-xs leading-relaxed">
          변환은 <b>이 관리자 브라우저</b>에서 실행됩니다(ffmpeg.wasm). 곡당 수십 초가 걸릴 수 있으니 탭을 닫지 마세요.
          변환 후 iPhone Safari 에서 재생을 확인하세요. 데스크탑 Chrome 권장.
        </p>
      </Alert>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={runAll}
          disabled={running || pending.length === 0}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-bold text-black hover:bg-accent/90 disabled:opacity-50"
        >
          <Play size={15} /> 전체 재인코딩 시작 ({pending.length})
        </button>
        {running && (
          <button
            onClick={() => { stopRef.current = true; }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-red-500 px-3 py-2 text-sm font-bold text-white hover:bg-red-600"
          >
            <Square size={14} /> 중지
          </button>
        )}
        <button
          onClick={() => void load()}
          disabled={running || loading}
          className="inline-flex items-center gap-1.5 rounded-xl bg-bg-card px-3 py-2 text-xs font-semibold text-ink-mute ring-1 ring-line/15 hover:bg-bg-hover disabled:opacity-50"
        >
          <RefreshCw size={13} /> 새로고침
        </button>
        <span className="text-xs text-ink-mute">변환 대상 {list.length}곡</span>
      </div>

      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        {loading ? (
          <div className="p-8 text-center text-xs text-ink-mute">불러오는 중…</div>
        ) : list.length === 0 ? (
          <div className="p-8 text-center text-xs text-ink-mute">변환할 WAV 음원이 없어요. 모두 MP3 입니다. ✓</div>
        ) : (
          <ul className="divide-y divide-line/10">
            {list.map((c) => {
              // 메모리 상태 우선, 없으면 DB 의 이전 변환 실패 상태를 표시
              const st: RowStatus =
                statuses[c.track_id] ??
                (c.audio_health_status === 'conversion_failed'
                  ? { kind: 'error', message: c.audio_health_error ?? '이전 변환 실패' }
                  : { kind: 'idle' });
              return (
                <li key={c.track_id} className="flex items-center gap-3 p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-bg-hover text-ink-dim">
                    <Music size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{c.title}</p>
                    <p className="truncate text-[11px] text-ink-mute">
                      {c.artist ?? '—'} · {c.release_status} · {c.audio_url.split('/').pop()}
                    </p>
                    {st.kind === 'error' && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] font-semibold text-red-500" title={st.message}>
                        ⚠ {st.message}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-[11px]">
                    {(st.kind === 'idle' || st.kind === 'error') && (
                      <button
                        onClick={() => void runOne(c)}
                        disabled={running}
                        className="rounded-md bg-bg-soft px-2.5 py-1 font-semibold text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover disabled:opacity-50"
                      >
                        {st.kind === 'error' ? '재시도' : '재인코딩'}
                      </button>
                    )}
                    {st.kind === 'working' && (
                      <span className="font-semibold text-accent">
                        {st.phase === 'download' && '다운로드…'}
                        {st.phase === 'transcode' && `변환 ${Math.round((st.ratio ?? 0) * 100)}%`}
                        {st.phase === 'upload' && '업로드…'}
                        {st.phase === 'commit' && '적용…'}
                        {st.phase === 'done' && '완료'}
                      </span>
                    )}
                    {st.kind === 'done' && (
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-500">
                        <CheckCircle2 size={13} /> 완료
                      </span>
                    )}
                    {st.kind === 'error' && (
                      <span className="inline-flex items-center gap-1 font-semibold text-red-500" title={st.message}>
                        <AlertTriangle size={13} /> 실패
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
