/**
 * audioDiagnostics.ts — 트랙 audio URL 진단 (관리자/개발자 페이지에서 사용).
 * 핵심: 같은 기기(아이폰 포함)에서 실제 <audio> 메타데이터 로딩까지 시도해
 * "이 기기에서 재생 가능한지"를 판정한다. HEAD/Range 헤더는 CORS 노출 범위 내에서 수집.
 */

export interface AudioProbe {
  url: string;
  guessedMime: string;
  /** HTMLMediaElement.canPlayType 결과: '', 'maybe', 'probably' */
  canPlay: string;
  headStatus: number | null;
  getStatus: number | null; // 일반 GET
  rangeStatus: number | null; // Range 요청 응답 (206 기대)
  contentType: string | null;
  contentLength: string | null;
  acceptRanges: string | null;
  contentRange: string | null;
  redirected: boolean | null; // GET 시 redirect 발생 여부
  finalUrl: string | null; // redirect 후 최종 URL
  responseType: string | null; // basic/cors/opaque...
  fetchError: string | null;
  /** 실제 <audio> 메타데이터 로딩 결과 */
  metaResult: 'ok' | 'error' | 'timeout' | 'no-duration';
  durationSec: number | null;
  errorCode: number | null; // MediaError.code (1~4)
  playable: boolean;
  notes: string[];
}

export function guessMimeFromUrl(url: string): string {
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.mp3')) return 'audio/mpeg';
  if (u.endsWith('.m4a')) return 'audio/mp4';
  if (u.endsWith('.aac')) return 'audio/aac';
  if (u.endsWith('.wav')) return 'audio/wav';
  if (u.endsWith('.ogg')) return 'audio/ogg';
  if (u.endsWith('.flac')) return 'audio/flac';
  return '';
}

const MEDIA_ERR: Record<number, string> = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED' };

/** HEAD 요청 — CORS 로 막히면 null. */
async function headProbe(url: string): Promise<{ status: number | null; ct: string | null; cl: string | null; ar: string | null }> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return {
      status: res.status,
      ct: res.headers.get('content-type'),
      cl: res.headers.get('content-length'),
      ar: res.headers.get('accept-ranges'),
    };
  } catch {
    return { status: null, ct: null, cl: null, ar: null };
  }
}

/** Range GET (bytes=0-1) — 206 + Content-Range 기대. */
async function rangeProbe(url: string): Promise<{ status: number | null; cr: string | null; ct: string | null }> {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-1' } });
    return { status: res.status, cr: res.headers.get('content-range'), ct: res.headers.get('content-type') };
  } catch {
    return { status: null, cr: null, ct: null };
  }
}

/** 실제 <audio> 로 metadata 로딩 시도 — 이 기기에서의 재생 가능성 판정 (핵심). */
function metaProbe(url: string, timeoutMs = 12000): Promise<{ result: AudioProbe['metaResult']; durationSec: number | null; errorCode: number | null }> {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    a.preload = 'metadata';
    a.muted = true;
    let done = false;
    const cleanup = () => {
      a.onloadedmetadata = null; a.onerror = null;
      try { a.removeAttribute('src'); a.load(); } catch { /* noop */ }
    };
    const finish = (r: { result: AudioProbe['metaResult']; durationSec: number | null; errorCode: number | null }) => {
      if (done) return; done = true; window.clearTimeout(t); cleanup(); resolve(r);
    };
    const t = window.setTimeout(() => finish({ result: 'timeout', durationSec: null, errorCode: null }), timeoutMs);
    a.onloadedmetadata = () => {
      const d = a.duration;
      if (Number.isFinite(d) && d > 0) finish({ result: 'ok', durationSec: d, errorCode: null });
      else finish({ result: 'no-duration', durationSec: Number.isFinite(d) ? d : null, errorCode: null });
    };
    a.onerror = () => finish({ result: 'error', durationSec: null, errorCode: a.error?.code ?? null });
    try { a.src = url; a.load(); } catch { finish({ result: 'error', durationSec: null, errorCode: null }); }
  });
}

/** 일반 GET — redirect/최종URL/response.type 캡처 (no-store, 본문은 안 읽음). */
async function getProbe(url: string): Promise<{ status: number | null; redirected: boolean | null; finalUrl: string | null; type: string | null; ct: string | null; err: string | null }> {
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    // 본문 다운로드 방지: reader 즉시 취소
    try { await res.body?.cancel(); } catch { /* noop */ }
    return { status: res.status, redirected: res.redirected, finalUrl: res.url, type: res.type, ct: res.headers.get('content-type'), err: null };
  } catch (e) {
    return { status: null, redirected: null, finalUrl: null, type: null, ct: null, err: e instanceof Error ? e.message : String(e) };
  }
}

export async function probeTrackAudio(url: string): Promise<AudioProbe> {
  const guessedMime = guessMimeFromUrl(url);
  const canPlay = guessedMime ? document.createElement('audio').canPlayType(guessedMime) : '';
  const notes: string[] = [];

  const [head, get, range, meta] = await Promise.all([headProbe(url), getProbe(url), rangeProbe(url), metaProbe(url)]);

  const contentType = head.ct ?? get.ct ?? range.ct;
  if (contentType === 'application/octet-stream') notes.push('Content-Type 이 application/octet-stream — 모바일 재생 실패 가능');
  if (guessedMime === 'audio/wav') notes.push('WAV — iOS(WebKit)에서 스트리밍 디코딩 실패 흔함 (MP3 권장)');
  if (range.status && range.status !== 206) notes.push(`Range 미지원(status=${range.status}) — 모바일 스트리밍 불안정(206 필요)`);
  if (range.status == null && get.err) notes.push(`Range fetch 실패: ${get.err}`);
  if (get.redirected) notes.push(`GET redirect 발생 → ${get.finalUrl}`);
  if (get.type === 'opaque') notes.push('response.type=opaque — CORS 제한(헤더 읽기 불가)');
  if (get.err) notes.push(`GET fetch 실패(CORS/네트워크): ${get.err}`);
  if (meta.result === 'error') notes.push(`메타데이터 로딩 실패: ${meta.errorCode ? MEDIA_ERR[meta.errorCode] ?? meta.errorCode : 'unknown'}`);
  if (meta.result === 'no-duration') notes.push('duration 0/Infinity — 메타데이터 불완전');
  if (meta.result === 'timeout') notes.push('메타데이터 로딩 타임아웃');

  return {
    url, guessedMime, canPlay,
    headStatus: head.status, getStatus: get.status, rangeStatus: range.status,
    contentType, contentLength: head.cl, acceptRanges: head.ar, contentRange: range.cr,
    redirected: get.redirected, finalUrl: get.finalUrl, responseType: get.type, fetchError: get.err,
    metaResult: meta.result, durationSec: meta.durationSec, errorCode: meta.errorCode,
    playable: meta.result === 'ok',
    notes,
  };
}

export interface PlaybackEvent { t: number; event: string; currentTime: number; readyState: number; networkState: number; errorCode: number | null; }

/**
 * 실제 muted 재생을 수 초간 시도하며 모든 미디어 이벤트를 기록.
 * "duration 은 나오는데 0:02 에서 NETWORK" 같은 스트리밍 실패의 정확한 시점/이벤트를 캡처.
 * 이 기기(갤럭시/아이폰)에서 직접 실행하면 실제 실패 타임라인이 나온다.
 */
export function capturePlaybackTimeline(url: string, runMs = 8000): Promise<{ timeline: PlaybackEvent[]; outcome: string; errorCode: number | null }> {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    a.preload = 'auto';
    a.muted = true;
    (a as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
    const t0 = performance.now();
    const timeline: PlaybackEvent[] = [];
    let done = false;
    const rec = (event: string) => {
      timeline.push({
        t: Math.round(performance.now() - t0),
        event,
        currentTime: Number(a.currentTime.toFixed(2)),
        readyState: a.readyState,
        networkState: a.networkState,
        errorCode: a.error?.code ?? null,
      });
    };
    const events = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing', 'waiting', 'stalled', 'suspend', 'abort', 'error', 'ended', 'progress'];
    const handlers: Record<string, () => void> = {};
    for (const ev of events) { handlers[ev] = () => rec(ev); a.addEventListener(ev, handlers[ev]); }

    const cleanup = () => {
      for (const ev of events) a.removeEventListener(ev, handlers[ev]);
      try { a.pause(); a.removeAttribute('src'); a.load(); } catch { /* noop */ }
    };
    const finish = (outcome: string) => {
      if (done) return; done = true; window.clearTimeout(timer); const code = a.error?.code ?? null; cleanup(); resolve({ timeline, outcome, errorCode: code });
    };
    a.addEventListener('error', () => finish('error'));
    a.addEventListener('ended', () => finish('ended'));
    const timer = window.setTimeout(() => finish(a.currentTime > 0 ? 'still-playing' : 'no-progress'), runMs);

    try {
      a.src = url;
      a.load();
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch((e: DOMException) => rec(`play-rejected:${e?.name}`));
    } catch (e) {
      rec(`exception:${e instanceof Error ? e.message : String(e)}`);
      finish('exception');
    }
  });
}

export function mediaErrName(code: number | null): string {
  return code == null ? '—' : MEDIA_ERR[code] ?? String(code);
}
