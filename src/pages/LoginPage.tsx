import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Mail, Lock, AlertCircle, ArrowLeft } from 'lucide-react';
import Alert from '@/components/Alert';
import { useAuthStore } from '@/store/authStore';
import { isSupabaseConfigured } from '@/lib/supabase';
import SignupTypeSelector, { type AccountType } from '@/components/auth/SignupTypeSelector';
import IndividualSignupForm from '@/components/auth/IndividualSignupForm';
import BusinessSignupForm from '@/components/auth/BusinessSignupForm';
import ArtistSignupForm from '@/components/auth/ArtistSignupForm';
import Logo from '@/components/Logo';

type Mode = 'signin' | 'signup-type' | 'signup-individual' | 'signup-business' | 'signup-artist';

const FIRST_ROUTE_KEY = 'srr-first-route-done';

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

export default function LoginPage() {
  const { session, signInWithPassword, signInWithGoogle, resendSignupEmail } = useAuthStore();
  const profile = useAuthStore((s) => s.profile);
  const isProfileReady = useAuthStore((s) => s.isProfileReady);
  const location = useLocation();
  // 로그인 게이트(SubscriptionGate) 또는 공유 링크에서 넘어온 returnTo URL.
  // 명시적 returnTo 있으면 그곳으로, 없고 첫 로그인이면 account_type 기반 분기.
  const explicitReturn = (location.state as { from?: string } | null)?.from ?? null;
  function computeTarget(): string {
    if (explicitReturn) return explicitReturn;
    let done = false;
    try {
      done = localStorage.getItem(FIRST_ROUTE_KEY) === 'true';
    } catch {
      /* noop */
    }
    if (done) return '/';
    try {
      localStorage.setItem(FIRST_ROUTE_KEY, 'true');
    } catch {
      /* noop */
    }
    return firstRouteFor(profile?.account_type);
  }
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signupDone, setSignupDone] = useState(false);
  const [signupEmail, setSignupEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [googleBusy, setGoogleBusy] = useState(false);

  // 60초 쿨다운 타이머 — Supabase resend rate limit 회피 + 사용자 피드백.
  function startResendCooldown() {
    setResendCooldown(60);
    const id = window.setInterval(() => {
      setResendCooldown((s) => {
        if (s <= 1) {
          window.clearInterval(id);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  async function handleResend(targetEmail: string) {
    if (!targetEmail || resending || resendCooldown > 0) return;
    setResending(true);
    setError(null);
    try {
      await resendSignupEmail(targetEmail);
      // 토스트 + 쿨다운 시작. UI 에 "60초 후 다시" 노출.
      const { toast } = await import('@/store/toastStore');
      toast.success('인증 메일을 다시 보냈어요. 받은편지함과 스팸함을 확인해주세요.');
      startResendCooldown();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '재발송 실패';
      // Supabase rate limit 메시지 자체 노출 (대부분 60초 이내 재요청 시).
      setError(msg);
    } finally {
      setResending(false);
    }
  }

  async function onGoogleSignIn() {
    setError(null);
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
      // redirectTo 로 페이지 이동되므로 도달 시점은 거의 없음
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google 로그인에 실패했어요.');
      setGoogleBusy(false);
    }
  }

  // profile 로드 끝나기 전엔 분기가 부정확 — session 있고 profile ready 일 때만 navigate.
  // (profile 로드 도중엔 기존 LoginPage UI 가 잠깐 보이지만 곧 redirect.)
  if (session && isProfileReady) return <Navigate to={computeTarget()} replace />;

  async function onSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signInWithPassword(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }

  function onTypeSelect(t: AccountType) {
    if (t === 'individual') setMode('signup-individual');
    else if (t === 'business') setMode('signup-business');
    else setMode('signup-artist');
  }

  const showBackButton = mode !== 'signin';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 pt-safe pb-safe">
      <div className="w-full max-w-md space-y-6 animate-fade-in py-10">
        <div className="space-y-2 text-center">
          <Logo size={56} className="mx-auto rounded-2xl" />
          <h1 className="text-2xl font-bold tracking-tight">듣다</h1>
          <p className="text-sm text-ink-mute">상황에 어울리는 음악, 흐르듯 자연스럽게.</p>
        </div>

        {!isSupabaseConfigured && (
          <div className="flex items-start gap-2 rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-200">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <div>
              Supabase 환경 변수가 설정되지 않았어요. <br />
              <code className="font-mono">.env</code>에{' '}
              <code className="font-mono">VITE_SUPABASE_URL</code>,{' '}
              <code className="font-mono">VITE_SUPABASE_ANON_KEY</code>를 추가해주세요.
            </div>
          </div>
        )}

        {showBackButton && (
          <button
            type="button"
            onClick={() => setMode(mode === 'signup-type' ? 'signin' : 'signup-type')}
            className="inline-flex items-center gap-1 text-xs text-ink-mute hover:text-ink"
          >
            <ArrowLeft size={12} /> 뒤로
          </button>
        )}

        {signupDone ? (
          <div className="space-y-3 rounded-2xl bg-bg-card p-5 text-center">
            <p className="text-sm font-semibold">회원가입 신청 완료</p>
            <p className="text-xs text-ink-mute">
              이메일 인증 메일을 확인한 뒤 로그인해주세요.
              {signupEmail && (
                <>
                  <br />
                  <span className="mt-1 inline-block font-mono text-[11px] text-ink">
                    {signupEmail}
                  </span>{' '}
                  로 발송됨
                </>
              )}
            </p>
            {error && <Alert tone="error">{error}</Alert>}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => signupEmail && void handleResend(signupEmail)}
                disabled={!signupEmail || resending || resendCooldown > 0}
                className="btn-ghost w-full py-2.5 text-sm disabled:opacity-50"
              >
                {resending
                  ? '재발송 중…'
                  : resendCooldown > 0
                    ? `재발송 (${resendCooldown}초 후 가능)`
                    : '메일 다시 보내기'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSignupDone(false);
                  setError(null);
                  setMode('signin');
                }}
                className="btn-primary w-full"
              >
                로그인 화면으로
              </button>
            </div>
            <p className="text-[10px] text-ink-dim">
              메일이 안 오면 스팸함을 확인하고, 60초 후 다시 보내기를 눌러주세요.
            </p>
          </div>
        ) : (
          <>
            {mode === 'signin' && (
              <form onSubmit={onSignIn} className="space-y-3">
                <div className="relative">
                  <Mail size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-dim" />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="이메일"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input pl-10"
                  />
                </div>
                <div className="relative">
                  <Lock size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-dim" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="current-password"
                    placeholder="비밀번호 (6자 이상)"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input pl-10"
                  />
                </div>

                {error && <Alert tone="error">{error}</Alert>}

                <button type="submit" disabled={busy} className="btn-primary w-full py-3">
                  {busy ? '잠시만요…' : '로그인'}
                </button>

                {/* 이메일 인증 미수신 도움 — signin 모드에 늘 노출 */}
                <button
                  type="button"
                  onClick={() => {
                    const v = email.trim();
                    if (!v) {
                      setError('재발송할 이메일을 위쪽에 먼저 입력해주세요.');
                      return;
                    }
                    void handleResend(v);
                  }}
                  disabled={resending || resendCooldown > 0}
                  className="block w-full text-center text-[11px] text-ink-mute hover:text-ink disabled:opacity-50"
                >
                  {resending
                    ? '재발송 중…'
                    : resendCooldown > 0
                      ? `재발송 (${resendCooldown}초 후 가능)`
                      : '인증 메일이 안 왔어요 — 재발송'}
                </button>
              </form>
            )}

            {mode === 'signup-type' && (
              <div className="space-y-3">
                <p className="text-center text-sm text-ink-mute">회원 유형을 선택해주세요</p>
                <SignupTypeSelector value={null} onSelect={onTypeSelect} />
              </div>
            )}

            {mode === 'signup-individual' && (
              <IndividualSignupForm
                onDone={(submittedEmail) => {
                  setSignupEmail(submittedEmail);
                  setSignupDone(true);
                }}
              />
            )}

            {mode === 'signup-business' && (
              <BusinessSignupForm
                onDone={(submittedEmail) => {
                  setSignupEmail(submittedEmail);
                  setSignupDone(true);
                }}
              />
            )}

            {mode === 'signup-artist' && (
              <ArtistSignupForm
                onDone={(submittedEmail) => {
                  setSignupEmail(submittedEmail);
                  setSignupDone(true);
                }}
              />
            )}

            {(mode === 'signin' || mode === 'signup-type') && (
              <>
                <div className="relative flex items-center gap-3 text-xs text-ink-dim">
                  <div className="h-px flex-1 bg-ink/10" />
                  <span>또는</span>
                  <div className="h-px flex-1 bg-ink/10" />
                </div>

                <button
                  type="button"
                  onClick={onGoogleSignIn}
                  disabled={googleBusy}
                  className="flex w-full items-center justify-center gap-2.5 rounded-full bg-white px-4 py-3 text-sm font-semibold text-[#1f1f1f] shadow-card ring-1 ring-black/10 transition hover:bg-neutral-100 active:scale-[0.98] disabled:opacity-60 disabled:pointer-events-none"
                >
                  {googleBusy ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#1f1f1f]/30 border-t-[#1f1f1f]" />
                  ) : (
                    <GoogleLogo />
                  )}
                  <span>
                    {googleBusy
                      ? 'Google 처리 중…'
                      : mode === 'signin'
                        ? 'Google로 로그인'
                        : 'Google로 회원가입'}
                  </span>
                </button>

                {mode === 'signin' ? (
                  <button
                    type="button"
                    className="block w-full text-center text-xs text-ink-mute hover:text-ink"
                    onClick={() => {
                      setMode('signup-type');
                      setError(null);
                    }}
                  >
                    처음이신가요? <span className="font-semibold text-accent">회원가입</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="block w-full text-center text-xs text-ink-mute hover:text-ink"
                    onClick={() => {
                      setMode('signin');
                      setError(null);
                    }}
                  >
                    이미 계정이 있으신가요? <span className="font-semibold text-accent">로그인</span>
                  </button>
                )}
              </>
            )}
          </>
        )}

        <p className="text-center text-[10px] text-ink-dim">
          주민등록번호는 저장하지 않습니다. 외부 본인확인기관 결과만 보관합니다.
        </p>
      </div>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
