import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { captureError } from '@/lib/sentry';
import { consumeKakaoChatPending, openKakaoChannelChat } from '@/lib/kakao';
import { logSupportContactEvent } from '@/lib/supportContactApi';

const FIRST_ROUTE_KEY = 'srr-first-route-done';

/** account_type 기반 첫 도착 페이지 — 가입 직후 1회만 적용. */
function firstRouteFor(accountType: string | undefined | null): string {
  switch (accountType) {
    case 'business':
      return '/business';
    case 'artist':
      return '/artist';
    default:
      return '/';
  }
}

/**
 * Google OAuth + 이메일 인증 redirect 착륙 페이지.
 *
 * Supabase JS SDK 가 URL 의 `?code=...` (PKCE) / `#access_token=...` (implicit) 를
 * 자동으로 감지해서 session 으로 교환하면 authStore.onAuthStateChange 가 fire.
 * session + profile 모두 set 되는 순간 account_type 기반 첫 화면으로 replace navigate.
 *
 * 별도 라우트로 분리한 이유:
 * - OAuth provider 가 콜백 URL 을 정확히 일치시키도록 (`/auth/callback` 만 화이트리스트)
 * - URL 에 임시로 OAuth code 가 보이는 시간이 짧고 깔끔
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const isProfileReady = useAuthStore((s) => s.isProfileReady);

  useEffect(() => {
    if (!session) return;
    // profile 까지 ready 가 되어야 account_type 분기 가능. 아직 안 되어 있으면 대기.
    if (!isProfileReady) return;

    // 첫 로그인이면 account_type 기반 분기, 이후는 / 로.
    let firstRouteDone = false;
    try {
      firstRouteDone = localStorage.getItem(FIRST_ROUTE_KEY) === 'true';
    } catch {
      /* localStorage 막힌 환경은 매번 분기 동작 — 마찰 < 누락 */
    }

    const target = firstRouteDone ? '/' : firstRouteFor(profile?.account_type);
    if (!firstRouteDone) {
      try {
        localStorage.setItem(FIRST_ROUTE_KEY, 'true');
      } catch {
        /* noop */
      }
    }

    // X6.2.12 — 사용자가 "카톡으로 문의" 누른 후 카카오 로그인했다면 채팅창 자동 오픈
    if (consumeKakaoChatPending()) {
      void logSupportContactEvent({
        channel: 'kakao',
        action: 'open_chat',
        context: { after_kakao_login: true },
      });
      openKakaoChannelChat();
    }

    navigate(target, { replace: true });
  }, [session, isProfileReady, profile?.account_type, navigate]);

  // session 적용 전에 너무 오래 머무르면 (취소 / 오류) 로그인 페이지로.
  useEffect(() => {
    // 1) provider 가 명시적 에러(error=access_denied 등)를 돌려준 경우 즉시 처리.
    const qs = `${window.location.search}${window.location.hash}`;
    if (/[?#&]error(_description)?=/.test(qs)) {
      void captureError(new Error('oauth_provider_error'), {
        scope: 'auth_callback.provider_error',
        qs: qs.slice(0, 200), // 민감 토큰 보호 위해 200자 컷
      });
      navigate('/login?error=oauth_callback_failed', { replace: true });
      return;
    }
    // 2) 정상 흐름이면 느린 네트워크에서 PKCE 코드 교환이 끝날 시간을 충분히 준다.
    //    (이전 8초는 fetch 타임아웃 예산 25초보다 짧아, 성공 직전 로그인을 실패로 오판했음)
    const t = window.setTimeout(() => {
      if (!useAuthStore.getState().session) {
        void captureError(new Error('oauth_callback_timeout'), {
          scope: 'auth_callback.timeout',
          timeoutMs: 20000,
        });
        navigate('/login?error=oauth_callback_failed', { replace: true });
      }
    }, 20000);
    return () => window.clearTimeout(t);
  }, [navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg text-ink">
      <Loader2 size={28} className="animate-spin text-accent" />
      <p className="text-sm text-ink-mute">로그인 처리 중이에요…</p>
    </div>
  );
}
