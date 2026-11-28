import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errorMessages';
import { toast } from '@/store/toastStore';

interface Props {
  onDone: (email: string) => void;
}

export default function IndividualSignupForm({ onDone }: Props) {
  const { signUpWithPassword } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!fullName.trim()) return '이름을 입력해주세요';
    if (!email.trim()) return '이메일을 입력해주세요';
    if (password.length < 6) return '비밀번호는 6자 이상이어야 해요';
    if (password !== passwordConfirm) return '비밀번호가 일치하지 않아요';
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    try {
      // 1) Supabase Auth 가입 (이메일/비밀번호)
      // user_metadata 를 함께 보내 0021 트리거가 public.users 자동 채움
      await signUpWithPassword(email.trim(), password, fullName.trim(), {
        account_type: 'individual',
        full_name: fullName.trim(),
      });
      // 2) auth.users 가 생성된 후, public.users 가 trigger 로 자동 생성되거나
      //    이메일 인증 메일 발송. 이메일 인증 후 로그인 시점에 본인 정보 업데이트.
      //    여기선 일단 localStorage 에 입력값 저장 → 이메일 인증 후 자동 적용 가능하도록.
      const pendingProfile = {
        account_type: 'individual' as const,
        full_name: fullName.trim(),
        signup_completed: true,
      };
      try {
        // PendingSignup 판별 유니온 형태로 저장 — readPendingSignup() 가 type/email/profile 을 기대.
        localStorage.setItem(
          'srr-pending-signup',
          JSON.stringify({ type: 'individual', email: email.trim(), profile: pendingProfile }),
        );
      } catch (storageErr) {
        // localStorage 실패 시 DB 직접 update 로 복구되므로 차단은 안 함. 진단 로깅만.
        console.warn('[individual-signup] pending-signup cache write failed:', storageErr);
      }

      // 3) 즉시 로그인된 세션이 있으면 (이메일 컨펌 OFF 환경) 바로 users 업데이트 시도
      const { data: sess } = await supabase.auth.getSession();
      if (sess.session?.user?.id) {
        const { error: uErr } = await supabase
          .from('users')
          .update(pendingProfile)
          .eq('id', sess.session.user.id);
        if (uErr) {
          // 가입 자체는 성공(auth.users 생성됨) — DB 업데이트만 실패. localStorage 캐시가
          // 다음 로그인 시 재시도하므로 사용자에겐 안내만 하고 onDone 호출.
          console.error('[individual-signup] users.update failed:', uErr);
          toast.info('회원가입은 완료됐지만 추가 정보 저장이 지연됐어요. 다시 로그인하면 자동 적용됩니다.');
          onDone(email.trim());
          return;
        }
      }

      toast.success('회원가입이 완료됐어요. 이메일 인증 메일을 확인해주세요.');
      onDone(email.trim());
    } catch (err) {
      setError(friendlyError(err, '가입에 실패했어요'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Field label="이름 *">
        <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" className="input" />
      </Field>
      <Field label="이메일 *">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="input" />
      </Field>
      <Field label="비밀번호 *" hint="6자 이상">
        <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className="input" />
      </Field>
      <Field label="비밀번호 확인 *">
        <input type="password" required minLength={6} value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} autoComplete="new-password" className="input" />
      </Field>

      {error && <p className="text-xs text-red-300">{error}</p>}

      <button type="submit" disabled={busy} className="btn-primary w-full py-3">
        {busy ? '가입 중…' : '회원가입'}
      </button>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-mute">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-ink-dim">{hint}</span>}
    </label>
  );
}
