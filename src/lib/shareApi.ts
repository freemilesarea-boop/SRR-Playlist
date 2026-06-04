import { supabase } from './supabase';
import { getSessionId } from './analytics';

export type ShareTargetType = 'playlist' | 'track' | 'business_qr';
export type ShareMethod = 'web_share' | 'clipboard' | 'qr_download' | 'qr_view' | 'kakao_share';

/** 절대 URL 보장 */
export function absoluteUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${window.location.origin}${path.startsWith('/') ? '' : '/'}${path}`;
}

export function playlistShareUrl(id: string): string {
  return absoluteUrl(`/playlist/${id}`);
}

export function trackShareUrl(id: string): string {
  return absoluteUrl(`/track/${id}`);
}

export function isWebShareSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

interface SharePayload {
  title: string;
  text?: string;
  url: string;
  targetType: ShareTargetType;
  targetId?: string | null;
  userId?: string | null;
}

/** Web Share + clipboard fallback. 호출자가 success/fail 처리 */
export async function performShare(payload: SharePayload): Promise<{
  ok: boolean;
  method: ShareMethod;
  error?: unknown;
}> {
  // 1) Web Share API
  if (isWebShareSupported()) {
    try {
      await navigator.share({
        title: payload.title,
        text: payload.text,
        url: payload.url,
      });
      void logShareEvent(payload.targetType, payload.targetId ?? null, 'web_share', payload.userId ?? null);
      return { ok: true, method: 'web_share' };
    } catch (e) {
      // 사용자가 취소한 경우 (AbortError) — 에러로 처리하지 않고 그냥 종료
      if ((e as DOMException)?.name === 'AbortError') {
        return { ok: false, method: 'web_share', error: 'aborted' };
      }
      // 그 외 — clipboard 폴백
    }
  }

  // 2) clipboard fallback
  try {
    await navigator.clipboard.writeText(payload.url);
    void logShareEvent(payload.targetType, payload.targetId ?? null, 'clipboard', payload.userId ?? null);
    return { ok: true, method: 'clipboard' };
  } catch (e) {
    return { ok: false, method: 'clipboard', error: e };
  }
}

/** 공유 이벤트 기록 (실패 무시) */
export async function logShareEvent(
  targetType: ShareTargetType,
  targetId: string | null,
  method: ShareMethod,
  userId: string | null,
): Promise<void> {
  try {
    await supabase.from('share_events').insert({
      user_id: userId,
      session_id: getSessionId(),
      target_type: targetType,
      target_id: targetId,
      method,
    });
  } catch {
    /* noop */
  }
}

/** QR 다운로드용 SVG → PNG */
export function svgElementToPng(svg: SVGSVGElement, size = 1024): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const xml = new XMLSerializer().serializeToString(svg);
      const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve(null);
          return;
        }
        // 흰 배경
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => resolve(blob), 'image/png');
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
