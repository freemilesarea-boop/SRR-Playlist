import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

/**
 * 비밀번호 재설정 페이지.
 *
 * 사용자가 admin 이 발송한 magic link (또는 본인 자가 발송 메일) 의
 * "비밀번호 재설정" 링크를 클릭하면 이 페이지로 이동.
 *
 * Supabase JS SDK 가 URL hash 의 access_token 을 자동으로 감지해서
 * 일시 세션을 설정 → updateUser({password}) 호출 가능.
 *
 * 새 비밀번호 입력 후:
 *  - 6자 이상 + 두 번 입력 일치 검증
 *  - supabase.auth.updateUser({password})
 *  - 성공 시 / 로 이동 (로그인된 상태)
 */
export default function AuthResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // SDK 가 URL 의 token 을 처리할 시간을 잠시 줌
  useEffect(() => {
    const t = window.setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setReady(true);
      } else {
        setError('재설정 링크가 만료되었거나 유효하지 않아요. 메일에서 다시 클릭해주세요.');
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (pw1.length < 6) {
      setError('비밀번호는 6자 이상이어야 해요.');
      return;
    }
    if (pw1 !== pw2) {
      setError('두 비밀번호가 일치하지 않아요.');
      return;
    }

    setBusy(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password: pw1 });
      if (updErr) throw updErr;
      setDone(true);
      // 2초 후 홈으로 (이미 로그인된 상태)
      window.setTimeout(() => navigate('/', { replace: true }), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : '비밀번호 변경 실패');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 pt-safe pb-safe">
      <div className="w-full max-w-md space-y-6 animate-fade-in py-10">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-soft text-2xl">
            🔐
          </div>
          <h1 className="text-2xl font-bold tracking-tight">비밀번호 재설정</h1>
          <p className="text-sm text-ink-mute">새 비밀번호를 입력해주세요.</p>
        </div>

        {done ? (
          <div className="flex items-start gap-2 rounded-xl border border-green-500/40 bg-green-500/10 p-4 text-sm text-green-200">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            <div>
              비밀번호가 변경됐어요.<br />
              잠시 후 홈으로 이동해요.
            </div>
          </div>
        ) : !ready && !error ? (
          <div className="text-center text-sm text-ink-mute">링크 확인 중이에요…</div>
        ) : error && !ready ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <div>{error}</div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="relative">
              <Lock size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-dim" />
              <input
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                placeholder="새 비밀번호 (6자 이상)"
                value={pw1}
                onChange={(e) => setPw1(e.target.value)}
                className="input pl-10"
              />
            </div>
            <div className="relative">
              <Lock size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-dim" />
              <input
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                placeholder="비밀번호 확인"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                className="input pl-10"
              />
            </div>
            {error && <div className="text-xs text-red-300">{error}</div>}
            <button type="submit" disabled={busy} className="btn-primary w-full py-3">
              {busy ? '변경 중…' : '비밀번호 변경'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
