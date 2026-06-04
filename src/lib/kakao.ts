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

// ===== 카카오 로그인 → 자동 채팅창 열기 (X6.2.12) =====
// 사용자가 카카오로 로그인 안 된 상태에서 카톡 채팅 시도 시,
// sessionStorage 에 flag 설정 → 카카오 OAuth → AuthCallback 에서 감지 → 채팅창 자동 오픈.

const KAKAO_AFTER_LOGIN_KEY = 'srr-kakao-after-login';

/** 카카오 OAuth 후 채팅창 자동 열기 예약 */
export function setKakaoChatPending(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(KAKAO_AFTER_LOGIN_KEY, 'open_chat');
    }
  } catch { /* noop */ }
}

/** 예약된 채팅창 자동 오픈 flag 를 소비 (한 번 읽고 삭제) */
export function consumeKakaoChatPending(): boolean {
  try {
    if (typeof sessionStorage === 'undefined') return false;
    const v = sessionStorage.getItem(KAKAO_AFTER_LOGIN_KEY);
    sessionStorage.removeItem(KAKAO_AFTER_LOGIN_KEY);
    return v === 'open_chat';
  } catch { return false; }
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
 * 카카오톡 채널 친구 추가 — 단순 window.open (안정성 우선).
 * SDK 의 addChannel 은 일부 브라우저에서 silent fail 가능 → URL 방식으로 통일.
 */
export function addKakaoChannel(): boolean {
  const url = kakaoChannelFriendUrl();
  if (!url) {
    if (import.meta.env.DEV) console.warn('[kakao] channel public id 미설정');
    return false;
  }
  if (typeof window === 'undefined') return false;
  if (import.meta.env.DEV) console.log('[kakao] addChannel → open', url);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  return win != null;
}

/**
 * 카카오톡 채널 1:1 채팅 열기.
 *
 * 동작:
 *   - PC: 새 탭에서 `https://pf.kakao.com/{id}/chat` 열림 → 웹 카톡 채팅 진입
 *   - 모바일 (카톡 앱): universal link 로 카톡 앱 채팅방 자동 열림
 *   - 모바일 (앱 없음): 브라우저에서 웹 카톡 채팅 진입
 *
 * SDK 의 Kakao.Channel.chat() 은 일부 환경에서 silent fail → window.open 직접 사용.
 *
 * @returns 새 창 열기 성공 여부 (popup blocker 차단 시 false)
 */
export function openKakaoChannelChat(): boolean {
  const url = kakaoChannelChatUrl();
  if (!url) {
    if (import.meta.env.DEV) console.warn('[kakao] channel public id 미설정');
    return false;
  }
  if (typeof window === 'undefined') return false;
  if (import.meta.env.DEV) console.log('[kakao] openChat → open', url);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) {
    // popup blocker 차단 → 같은 탭으로 fallback
    if (import.meta.env.DEV) console.warn('[kakao] window.open 차단, 같은 탭 이동');
    window.location.href = url;
  }
  return true;
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
