import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Mail, Lock, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { isSupabaseConfigured } from '@/lib/supabase';

type Mode = 'signin' | 'signup';

export default function LoginPage() {
  const { session, signInWithPassword, signUpWithPassword, signInWithGoogle } = useAuthStore();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signInWithPassword(email, password);
      } else {
        await signUpWithPassword(email, password, nickname);
        setError('가입 메일을 확인해주세요. 메일 인증 후 로그인할 수 있어요.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 pt-safe pb-safe">
      <div className="w-full max-w-sm space-y-8 animate-fade-in">
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

        <form onSubmit={onSubmit} className="space-y-3">
          {mode === 'signup' && (
            <input
              type="text"
              placeholder="닉네임"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="input"
            />
          )}
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
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              placeholder="비밀번호 (6자 이상)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input pl-10"
            />
          </div>

          {error && <div className="text-xs text-red-300">{error}</div>}

          <button type="submit" disabled={busy} className="btn-primary w-full py-3">
            {busy ? '잠시만요…' : mode === 'signin' ? '로그인' : '회원가입'}
          </button>
        </form>

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
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
          }}
        >
          {mode === 'signin'
            ? '계정이 없으신가요? 회원가입'
            : '이미 계정이 있으신가요? 로그인'}
        </button>
      </div>
    </div>
  );
}
