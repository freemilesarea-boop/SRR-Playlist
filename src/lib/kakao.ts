/**
 * kakao.ts — Phase X6.2
 *
 * Kakao JavaScript SDK 통합 헬퍼.
 * - SDK 동적 로드 + 1회 init (idempotent)
 * - 카카오 로그인: Supabase Auth OAuth (provider='kakao') 사용 → SDK 직접 호출 X
 * - 카카오톡 공유: Kakao.Share.sendDefault() / sendCustom()
 * - 알림톡 / 친구톡 자동 발송 기능 없음 (별도 비즈메시지 솔루션 필요)
 *
 * 사용:
 *   import { ensureKakaoReady, shareTrackToKakao } from '@/lib/kakao';
 *   await ensureKakaoReady();
 *   if (isKakaoReady()) shareTrackToKakao({ ... });
 */

declare global {
  interface Window {
    Kakao?: {
      init: (key: string) => void;
      isInitialized: () => boolean;
      cleanup: () => void;
      Share?: {
        sendDefault: (settings: KakaoShareDefaultSettings) => void;
        sendCustom: (settings: KakaoShareCustomSettings) => void;
      };
      Channel?: {
        addChannel: (settings: { channelPublicId: string }) => void;
        chat: (settings: { channelPublicId: string }) => void;
      };
    };
  }
}

interface KakaoShareDefaultSettings {
  objectType: 'feed' | 'list' | 'location' | 'commerce' | 'text';
  content: {
    title: string;
    description?: string;
    imageUrl: string;
    link: {
      mobileWebUrl?: string;
      webUrl?: string;
    };
  };
  buttons?: Array<{
    title: string;
    link: { mobileWebUrl?: string; webUrl?: string };
  }>;
}

interface KakaoShareCustomSettings {
  templateId: number;
  templateArgs?: Record<string, string>;
}

const SDK_URL = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js';

let loadPromise: Promise<void> | null = null;

function getJsKey(): string {
  return (import.meta.env.VITE_KAKAO_JS_KEY as string | undefined) ?? '';
}

/** 카카오톡 채널 공개 ID (예: "_xgHxbGX"). pf.kakao.com URL 에서 추출. */
export function getKakaoChannelPublicId(): string {
  return (import.meta.env.VITE_KAKAO_CHANNEL_PUBLIC_ID as string | undefined) ?? '';
}

export function isKakaoConfigured(): boolean {
  return getJsKey().length > 0;
}

export function isKakaoChannelConfigured(): boolean {
  return getKakaoChannelPublicId().length > 0;
}

/** 채널 공개 URL (홈) */
export function kakaoChannelHomeUrl(): string {
  const id = getKakaoChannelPublicId();
  return id ? `https://pf.kakao.com/${id}` : '';
}

/** 채널 1:1 채팅 URL */
export function kakaoChannelChatUrl(): string {
  const id = getKakaoChannelPublicId();
  return id ? `https://pf.kakao.com/${id}/chat` : '';
}

/** 채널 친구 추가 URL */
export function kakaoChannelFriendUrl(): string {
  const id = getKakaoChannelPublicId();
  return id ? `https://pf.kakao.com/${id}/friend` : '';
}

export function isKakaoReady(): boolean {
  return typeof window !== 'undefined' && !!window.Kakao && window.Kakao.isInitialized();
}

/** SDK 동적 로드 + init. 멱등 — 여러 번 호출해도 1회만 실행. */
export async function ensureKakaoReady(): Promise<boolean> {
  const key = getJsKey();
  if (!key) return false;
  if (typeof window === 'undefined') return false;
  if (isKakaoReady()) return true;

  if (!loadPromise) {
    loadPromise = new Promise<void>((resolve, reject) => {
      // 이미 다른 곳에서 script 추가했으면 재사용
      const existing = document.querySelector<HTMLScriptElement>(`script[data-kakao-sdk="1"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Kakao SDK script load failed')), { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = SDK_URL;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.dataset.kakaoSdk = '1';
      s.addEventListener('load', () => resolve(), { once: true });
      s.addEventListener('error', () => {
        loadPromise = null;
        reject(new Error('Kakao SDK script load failed'));
      }, { once: true });
      document.head.appendChild(s);
    });
  }

  try {
    await loadPromise;
    if (window.Kakao && !window.Kakao.isInitialized()) {
      window.Kakao.init(key);
    }
    return isKakaoReady();
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[kakao] init failed', e);
    return false;
  }
}

/** 트랙 공유. 실패 시 false 반환 — 호출 측에서 다른 fallback (Web Share / copy) 시도. */
export async function shareTrackToKakao(params: {
  trackId: string;
  title: string;
  artist?: string | null;
  coverUrl?: string | null;
  shareUrl: string;
}): Promise<boolean> {
  const ok = await ensureKakaoReady();
  if (!ok || !window.Kakao?.Share) return false;
  try {
    window.Kakao.Share.sendDefault({
      objectType: 'feed',
      content: {
        title: params.title,
        description: params.artist ?? undefined,
        imageUrl: params.coverUrl ?? 'https://nsoesrvwkxqifjcxzvol.supabase.co/storage/v1/object/public/brand-assets/og-default.png',
        link: { mobileWebUrl: params.shareUrl, webUrl: params.shareUrl },
      },
      buttons: [
        { title: '듣다에서 듣기', link: { mobileWebUrl: params.shareUrl, webUrl: params.shareUrl } },
      ],
    });
    return true;
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[kakao] shareTrack failed', e);
    return false;
  }
}

/**
 * 카카오톡 채널 친구 추가 — SDK 우선, 미가능 시 URL fallback.
 * 호출자는 보통 button onClick 에서 사용.
 */
export async function addKakaoChannel(): Promise<boolean> {
  const id = getKakaoChannelPublicId();
  if (!id) return false;
  const ok = await ensureKakaoReady();
  if (ok && window.Kakao?.Channel) {
    try {
      window.Kakao.Channel.addChannel({ channelPublicId: id });
      return true;
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[kakao] addChannel SDK 실패, URL fallback', e);
    }
  }
  // fallback: 새 창으로 친구추가 페이지 오픈
  if (typeof window !== 'undefined') {
    window.open(`https://pf.kakao.com/${id}/friend`, '_blank', 'noopener,noreferrer');
    return true;
  }
  return false;
}

/**
 * 카카오톡 채널 1:1 채팅 시작 — SDK 우선, URL fallback.
 */
export async function openKakaoChannelChat(): Promise<boolean> {
  const id = getKakaoChannelPublicId();
  if (!id) return false;
  const ok = await ensureKakaoReady();
  if (ok && window.Kakao?.Channel) {
    try {
      window.Kakao.Channel.chat({ channelPublicId: id });
      return true;
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[kakao] chat SDK 실패, URL fallback', e);
    }
  }
  if (typeof window !== 'undefined') {
    window.open(`https://pf.kakao.com/${id}/chat`, '_blank', 'noopener,noreferrer');
    return true;
  }
  return false;
}

/** 플레이리스트 공유 */
export async function sharePlaylistToKakao(params: {
  playlistId: string;
  title: string;
  description?: string | null;
  coverUrl?: string | null;
  shareUrl: string;
}): Promise<boolean> {
  const ok = await ensureKakaoReady();
  if (!ok || !window.Kakao?.Share) return false;
  try {
    window.Kakao.Share.sendDefault({
      objectType: 'feed',
      content: {
        title: params.title,
        description: params.description ?? undefined,
        imageUrl: params.coverUrl ?? 'https://nsoesrvwkxqifjcxzvol.supabase.co/storage/v1/object/public/brand-assets/og-default.png',
        link: { mobileWebUrl: params.shareUrl, webUrl: params.shareUrl },
      },
      buttons: [
        { title: '듣다에서 보기', link: { mobileWebUrl: params.shareUrl, webUrl: params.shareUrl } },
      ],
    });
    return true;
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[kakao] sharePlaylist failed', e);
    return false;
  }
}
