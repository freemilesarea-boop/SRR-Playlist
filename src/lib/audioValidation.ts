/**
 * audioValidation.ts
 *
 * 업로드 직전(파일) / 업로드 직후(공개 URL) 양쪽에서
 * 실제 브라우저가 디코딩 가능한지를 검증.
 *
 * HEAD 요청만으로는 "재생 가능" 보장이 안 되므로 (Content-Type 만 봄)
 * 반드시 새 <audio> 엘리먼트로 metadata 로드 smoke test 까지 수행한다.
 */

const MEDIA_ERROR_NAME: Record<number, string> = {
  1: 'ABORTED',
  2: 'NETWORK',
  3: 'DECODE',
  4: 'SRC_NOT_SUPPORTED',
};

export interface ValidationResult {
  ok: boolean;
  duration?: number;
  error?: string;
  /** 검증 후 받은 Content-Type (URL 검증 시) */
  contentType?: string;
  /** HEAD 상태 코드 (URL 검증 시) */
  status?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function namedMediaError(audio: HTMLAudioElement): string {
  const err = audio.error;
  if (!err) return 'UNKNOWN';
  return MEDIA_ERROR_NAME[err.code] ?? `code=${err.code}`;
}

/**
 * File 객체를 새 <audio> 에 임시로 물려 metadata 가 로드되는지 확인.
 * - duration 이 finite 면 ok
 * - error 발생 또는 timeout → fail
 */
export async function validateAudioFile(
  file: File,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ValidationResult> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';

    let settled = false;
    const settle = (r: ValidationResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try { audio.removeAttribute('src'); audio.load(); } catch { /* noop */ }
      URL.revokeObjectURL(url);
      resolve(r);
    };

    const timer = window.setTimeout(() => {
      settle({ ok: false, error: `Metadata load timeout (${timeoutMs}ms)` });
    }, timeoutMs);

    audio.onloadedmetadata = () => {
      const d = audio.duration;
      if (!Number.isFinite(d) || d <= 0) {
        settle({ ok: false, error: 'Invalid duration (non-finite or zero)' });
        return;
      }
      settle({ ok: true, duration: Math.round(d) });
    };

    audio.onerror = () => {
      settle({ ok: false, error: namedMediaError(audio) });
    };

    audio.src = url;
  });
}

/**
 * 업로드된 공개 URL 의 실제 재생 가능 여부 검증:
 *   1) HEAD 200 + Content-Type 캡처
 *   2) <audio> metadata 로드 smoke test (DECODE/SRC_NOT_SUPPORTED 잡힘)
 */
export async function validateAudioUrl(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ValidationResult> {
  // Step 1: HEAD
  let contentType: string | undefined;
  let status: number | undefined;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    status = res.status;
    contentType = res.headers.get('content-type') ?? undefined;
    if (!res.ok) {
      return { ok: false, error: `HEAD ${res.status}`, contentType, status };
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? `HEAD failed: ${e.message}` : 'HEAD failed',
    };
  }

  // Step 2: <audio> metadata smoke test
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';

    let settled = false;
    const settle = (r: ValidationResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try { audio.removeAttribute('src'); audio.load(); } catch { /* noop */ }
      resolve({ ...r, contentType, status });
    };

    const timer = window.setTimeout(() => {
      settle({ ok: false, error: `Metadata load timeout (${timeoutMs}ms)` });
    }, timeoutMs);

    audio.onloadedmetadata = () => {
      const d = audio.duration;
      if (!Number.isFinite(d) || d <= 0) {
        settle({ ok: false, error: 'Invalid duration' });
        return;
      }
      settle({ ok: true, duration: Math.round(d) });
    };

    audio.onerror = () => {
      settle({ ok: false, error: namedMediaError(audio) });
    };

    audio.src = url;
  });
}
