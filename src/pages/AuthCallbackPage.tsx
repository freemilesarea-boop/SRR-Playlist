import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

/**
 * Google OAuth redirect 착륙 페이지.
 *
 * Supabase JS SDK 가 URL 의 `?code=...` (PKCE) / `#access_token=...` (implicit) 를
 * 자동으로 감지해서 session 으로 교환하면 authStore.onAuthStateChange 가 fire.
 * session 이 set 되는 순간 / 로 replace navigate.
 *
 * 별도 라우트로 분리한 이유:
 * - OAuth provider 가 콜백 URL 을 정확히 일치시키도록 (`/auth/callback` 만 화이트리스트)
 * - URL 에 임시로 OAuth code 가 보이는 시간이 짧고 깔끔
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);

  useEffect(() => {
    if (session) {
      // session 적용 즉시 / 로 이동 (history replace — 뒤로가기 시 callback 페이지 안 보임)
      navigate('/', { replace: true });
    }
  }, [session, navigate]);

  // session 적용 전에 너무 오래 머무르면 (취소 / 오류) 로그인 페이지로
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!useAuthStore.getState().session) {
        navigate('/login?error=oauth_callback_failed', { replace: true });
      }
    }, 8000);
    return () => window.clearTimeout(t);
  }, [navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg text-ink">
      <Loader2 size={28} className="animate-spin text-accent" />
      <p className="text-sm text-ink-mute">로그인 처리 중이에요…</p>
    </div>
  );
}
