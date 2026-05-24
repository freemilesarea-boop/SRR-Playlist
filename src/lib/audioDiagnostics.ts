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
  rangeStatus: number | null; // Range 요청 응답 (206 기대)
  contentType: string | null;
  contentLength: string | null;
  acceptRanges: string | null;
  contentRange: string | null;
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

export async function probeTrackAudio(url: string): Promise<AudioProbe> {
  const guessedMime = guessMimeFromUrl(url);
  const canPlay = guessedMime ? document.createElement('audio').canPlayType(guessedMime) : '';
  const notes: string[] = [];

  const [head, range, meta] = await Promise.all([headProbe(url), rangeProbe(url), metaProbe(url)]);

  const contentType = head.ct ?? range.ct;
  if (contentType === 'application/octet-stream') notes.push('Content-Type 이 application/octet-stream — 모바일 재생 실패 가능');
  if (guessedMime === 'audio/wav') notes.push('WAV — iOS(WebKit)에서 스트리밍 디코딩 실패 흔함 (MP3 권장)');
  if (range.status && range.status !== 206) notes.push(`Range 미지원(status=${range.status}) — iOS 재생 불안정`);
  if (meta.result === 'error') notes.push(`메타데이터 로딩 실패: ${meta.errorCode ? MEDIA_ERR[meta.errorCode] ?? meta.errorCode : 'unknown'}`);
  if (meta.result === 'no-duration') notes.push('duration 0/Infinity — 메타데이터 불완전');
  if (meta.result === 'timeout') notes.push('메타데이터 로딩 타임아웃');

  return {
    url, guessedMime, canPlay,
    headStatus: head.status, rangeStatus: range.status,
    contentType, contentLength: head.cl, acceptRanges: head.ar, contentRange: range.cr,
    metaResult: meta.result, durationSec: meta.durationSec, errorCode: meta.errorCode,
    playable: meta.result === 'ok',
    notes,
  };
}

export function mediaErrName(code: number | null): string {
  return code == null ? '—' : MEDIA_ERR[code] ?? String(code);
}
