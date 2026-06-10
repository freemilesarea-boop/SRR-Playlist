import { useCallback, useEffect, useState } from 'react';
import { Stethoscope, RefreshCw, Play, CheckCircle2, XCircle, Smartphone, Activity } from 'lucide-react';
import { fetchTracks } from '@/lib/api';
import { probeTrackAudio, capturePlaybackTimeline, mediaErrName, type AudioProbe, type PlaybackEvent } from '@/lib/audioDiagnostics';
import { getSwDiagnostics, resetServiceWorkerAndCaches, type SwDiagnostics } from '@/lib/swCache';
import type { TrackRow } from '@/types/db';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import { friendlyError } from '@/lib/errorMessages';

interface Row { id: string; title: string; artist: string | null; audio_url: string; release_status?: string | null; }

/**
 * 오디오 URL 진단 — 이 기기(아이폰 포함)에서 각 트랙의 실제 재생 가능성을 검사한다.
 * HEAD/Range 헤더 + canPlayType + 실제 <audio> 메타데이터 로딩까지 수행해
 * "왜 모바일에서 안 되는지"를 트랙별로 보여준다. 관리자가 iPhone Safari/Chrome 으로 이 페이지를
 * 열어 직접 검사하면 그 기기의 실제 결과가 나온다.
 */
export default function AudioDiagnosticPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [probes, setProbes] = useState<Record<string, AudioProbe | 'running'>>({});
  const [timelines, setTimelines] = useState<Record<string, { timeline: PlaybackEvent[]; outcome: string; errorCode: number | null } | 'running'>>({});
  const [running, setRunning] = useState(false);
  const [sw, setSw] = useState<SwDiagnostics | null>(null);

  useEffect(() => { void getSwDiagnostics().then(setSw); }, []);

  async function runTimeline(r: Row) {
    setTimelines((p) => ({ ...p, [r.id]: 'running' }));
    const res = await capturePlaybackTimeline(r.audio_url);
    setTimelines((p) => ({ ...p, [r.id]: res }));
     
    console.info(`[audio-diag:timeline] "${r.title}"`, { ...res, userAgent: navigator.userAgent, url: r.audio_url });
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await fetchTracks();
      const list = (all as Array<TrackRow & { release_status?: string | null; removed_at?: string | null }>)
        .filter((t) => t.audio_url && t.audio_url.trim() !== '' && !t.removed_at)
        .map((t) => ({ id: t.id, title: t.title, artist: t.artist, audio_url: t.audio_url, release_status: (t as { release_status?: string | null }).release_status }));
      setRows(list);
    } catch (e) {
      toast.error(`목록 로드 실패: ${friendlyError(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function probeOne(r: Row) {
    setProbes((p) => ({ ...p, [r.id]: 'running' }));
    try {
      const res = await probeTrackAudio(r.audio_url);
      setProbes((p) => ({ ...p, [r.id]: res }));
       
      console.info(`[audio-diag] "${r.title}"`, { ...res, userAgent: navigator.userAgent });
      return res.playable;
    } catch (e) {
       
      console.warn(`[audio-diag] "${r.title}" probe threw`, e);
      return false;
    }
  }

  async function probeAll() {
    if (running) return;
    setRunning(true);
    let ok = 0;
    for (const r of rows) {
      // 순차 — 모바일 메모리/네트워크 보호
       
      if (await probeOne(r)) ok++;
    }
    setRunning(false);
    toast.info(`진단 완료 — 재생 가능 ${ok} / ${rows.length} (이 기기 기준)`);
  }

  const tested = rows.filter((r) => probes[r.id] && probes[r.id] !== 'running').length;
  const playableCount = rows.filter((r) => { const p = probes[r.id]; return p && p !== 'running' && p.playable; }).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
          <Stethoscope size={16} className="text-accent" /> 오디오 URL 진단
        </h2>
        <p className="mt-0.5 text-xs text-ink-mute">
          이 <b>기기</b>에서 각 트랙의 실제 재생 가능성을 검사합니다. <b>iPhone Safari/Chrome 으로 이 페이지를 열고
          실행</b>하면 모바일 실제 결과(헤더·MIME·Range·duration·디코딩)가 나옵니다.
        </p>
      </div>

      <Alert tone="info">
        <p className="text-xs leading-relaxed">
          canPlayType + HEAD/Range 헤더 + 실제 <code className="font-mono">&lt;audio&gt;</code> 메타데이터 로딩까지 수행합니다.
          duration 이 0:00 이거나 디코딩 실패면 그 기기에서 재생 불가입니다. (헤더는 CORS 노출 범위 내에서만 표시)
        </p>
      </Alert>

      {/* Service Worker 상태 + 초기화 (오디오 가로채기/잘못된 캐시 점검) */}
      <div className="space-y-2 rounded-xl bg-bg-soft/50 p-3 text-[11px] ring-1 ring-line/10">
        <p className="font-bold text-ink">Service Worker / 캐시 상태</p>
        {sw ? (
          <div className="space-y-0.5 font-mono text-ink-mute">
            <p>controller(제어중): <b className={sw.controlled ? 'text-amber-500' : 'text-emerald-500'}>{String(sw.controlled)}</b> · 등록 {sw.registrations}개</p>
            <p className="break-all">activeSW: {sw.controllerScriptURL ?? '(없음)'}</p>
            <p className="break-all">cacheKeys: {sw.cacheKeys.length ? sw.cacheKeys.join(', ') : '(없음)'}</p>
            {sw.hasAudioCache && <p className="font-bold text-red-500">⚠ 오디오 관련 캐시 존재 — 초기화 권장(오디오 Range 가로채기 원인)</p>}
          </div>
        ) : <p className="text-ink-mute">확인 중…</p>}
        <button
          onClick={() => { void resetServiceWorkerAndCaches(); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-600"
        >
          캐시/SW 초기화 후 새로고침
        </button>
        <p className="text-ink-dim">기존 SW 등록 해제 + 모든 캐시 삭제 후 새로고침합니다. 모바일에서 재생이 안 되면 이 버튼을 누른 뒤 다시 시도하세요.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={probeAll} disabled={running || rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-bold text-black hover:bg-accent/90 disabled:opacity-50">
          <Play size={15} /> 전체 진단 ({rows.length})
        </button>
        <button onClick={() => void load()} disabled={running || loading}
          className="inline-flex items-center gap-1.5 rounded-xl bg-bg-card px-3 py-2 text-xs font-semibold text-ink-mute ring-1 ring-line/15 hover:bg-bg-hover disabled:opacity-50">
          <RefreshCw size={13} /> 새로고침
        </button>
        <span className="inline-flex items-center gap-1 text-xs text-ink-mute">
          <Smartphone size={12} /> 검사 {tested}/{rows.length} · 재생가능 {playableCount}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        {loading ? (
          <div className="p-8 text-center text-xs text-ink-mute">불러오는 중…</div>
        ) : (
          <ul className="divide-y divide-line/10">
            {rows.map((r) => {
              const p = probes[r.id];
              return (
                <li key={r.id} className="space-y-1 p-3">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{r.title}</p>
                      <p className="truncate text-[11px] text-ink-mute">{r.artist ?? '—'} · {r.audio_url.split('/').pop()}</p>
                    </div>
                    <div className="shrink-0 text-right text-[11px]">
                      {!p && (
                        <button onClick={() => void probeOne(r)} disabled={running}
                          className="rounded-md bg-bg-soft px-2.5 py-1 font-semibold text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover disabled:opacity-50">검사</button>
                      )}
                      {p === 'running' && <span className="font-semibold text-accent">검사 중…</span>}
                      {p && p !== 'running' && (
                        <span className={`inline-flex items-center gap-1 font-bold ${p.playable ? 'text-emerald-500' : 'text-red-500'}`}>
                          {p.playable ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                          {p.playable ? '재생 가능' : '재생 불가'}
                        </span>
                      )}
                    </div>
                  </div>
                  {p && p !== 'running' && (
                    <div className="rounded-lg bg-bg-soft/50 p-2 text-[11px] text-ink-mute ring-1 ring-line/10">
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono sm:grid-cols-3">
                        <span>canPlayType: <b className={p.canPlay === '' ? 'text-red-500' : 'text-ink'}>{p.canPlay || '(빈값)'}</b></span>
                        <span>duration: <b className={p.durationSec ? 'text-ink' : 'text-red-500'}>{p.durationSec ? `${p.durationSec.toFixed(1)}s` : (p.metaResult)}</b></span>
                        <span>err: {mediaErrName(p.errorCode)}</span>
                        <span>HEAD: {p.headStatus ?? 'N/A'}</span>
                        <span>GET: {p.getStatus ?? 'N/A'}</span>
                        <span>Range: <b className={p.rangeStatus === 206 ? 'text-emerald-500' : 'text-red-500'}>{p.rangeStatus ?? 'N/A'}</b></span>
                        <span>type: {p.contentType ?? 'N/A'}</span>
                        <span>len: {p.contentLength ?? 'N/A'}</span>
                        <span>accept-ranges: {p.acceptRanges ?? 'N/A'}</span>
                        <span>content-range: {p.contentRange ?? 'N/A'}</span>
                        <span>resp.type: {p.responseType ?? 'N/A'}</span>
                        <span>redirected: {p.redirected == null ? 'N/A' : String(p.redirected)}</span>
                      </div>
                      {p.fetchError && <p className="mt-1 text-[11px] font-semibold text-red-500">fetch 오류: {p.fetchError}</p>}
                      {p.notes.length > 0 && (
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-amber-600 dark:text-amber-400">
                          {p.notes.map((n, i) => <li key={i}>{n}</li>)}
                        </ul>
                      )}
                      {/* 재생 타임라인 — "0:02 에서 NETWORK" 같은 스트리밍 실패 시점 캡처 */}
                      <div className="mt-1.5">
                        <button
                          onClick={() => void runTimeline(r)}
                          disabled={timelines[r.id] === 'running'}
                          className="inline-flex items-center gap-1 rounded-md bg-bg-card px-2 py-1 text-[11px] font-semibold text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover disabled:opacity-50"
                        >
                          <Activity size={11} /> {timelines[r.id] === 'running' ? '재생 테스트 중…' : '재생 테스트(타임라인)'}
                        </button>
                        {timelines[r.id] && timelines[r.id] !== 'running' && (() => {
                          const tl = timelines[r.id] as { timeline: PlaybackEvent[]; outcome: string; errorCode: number | null };
                          return (
                            <div className="mt-1 rounded bg-bg-deep/40 p-1.5 font-mono text-[10px] leading-relaxed">
                              <p className="font-bold text-ink">
                                결과: <span className={tl.outcome === 'still-playing' || tl.outcome === 'ended' ? 'text-emerald-500' : 'text-red-500'}>{tl.outcome}</span>
                                {tl.errorCode != null && ` · err=${mediaErrName(tl.errorCode)}`}
                              </p>
                              <div className="mt-0.5 max-h-32 overflow-y-auto">
                                {tl.timeline.map((e, i) => (
                                  <div key={i} className={e.event === 'error' ? 'text-red-500' : e.event.startsWith('play-rejected') ? 'text-amber-500' : 'text-ink-mute'}>
                                    {e.t}ms · {e.event} · cur={e.currentTime}s · rs={e.readyState} · ns={e.networkState}{e.errorCode != null ? ` · errc=${e.errorCode}` : ''}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
