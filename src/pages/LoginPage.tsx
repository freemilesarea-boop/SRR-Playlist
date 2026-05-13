import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Mail, Lock, AlertCircle, ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { isSupabaseConfigured } from '@/lib/supabase';
import SignupTypeSelector, { type AccountType } from '@/components/auth/SignupTypeSelector';
import IndividualSignupForm from '@/components/auth/IndividualSignupForm';
import BusinessSignupForm from '@/components/auth/BusinessSignupForm';

type Mode = 'signin' | 'signup-type' | 'signup-individual' | 'signup-business';

export default function LoginPage() {
  const { session, signInWithPassword, signInWithGoogle } = useAuthStore();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signupDone, setSignupDone] = useState(false);

  if (session) return <Navigate to="/" replace />;

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
    setMode(t === 'individual' ? 'signup-individual' : 'signup-business');
  }

  const showBackButton = mode !== 'signin';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 pt-safe pb-safe">
      <div className="w-full max-w-md space-y-6 animate-fade-in py-10">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-soft text-2xl">
            🎵
          </div>
          <h1 className="text-2xl font-bold tracking-tight">스르륵 플리</h1>
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
          <div className="space-y-4 rounded-2xl bg-bg-card p-5 text-center">
            <p className="text-sm font-semibold">회원가입 신청 완료</p>
            <p className="text-xs text-ink-mute">
              이메일 인증 메일을 확인한 뒤 로그인해주세요.
            </p>
            <button
              type="button"
              onClick={() => {
                setSignupDone(false);
                setMode('signin');
              }}
              className="btn-primary w-full"
            >
              로그인 화면으로
            </button>
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

                {error && <div className="text-xs text-red-300">{error}</div>}

                <button type="submit" disabled={busy} className="btn-primary w-full py-3">
                  {busy ? '잠시만요…' : '로그인'}
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
              <IndividualSignupForm onDone={() => setSignupDone(true)} />
            )}

            {mode === 'signup-business' && (
              <BusinessSignupForm onDone={() => setSignupDone(true)} />
            )}

            {mode === 'signin' && (
              <>
                <div className="relative flex items-center gap-3 text-xs text-ink-dim">
                  <div className="h-px flex-1 bg-ink/10" />
                  <span>또는</span>
                  <div className="h-px flex-1 bg-ink/10" />
                </div>

                <button
                  type="button"
                  onClick={() => signInWithGoogle().catch((e) => setError(String(e)))}
                  className="btn-ghost w-full py-3"
                >
                  <span className="text-base">G</span> Google로 계속하기
                </button>

                <button
                  type="button"
                  className="block w-full text-center text-xs text-ink-mute hover:text-ink"
                  onClick={() => {
                    setMode('signup-type');
                    setError(null);
                  }}
                >
                  계정이 없으신가요? 회원가입
                </button>
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
