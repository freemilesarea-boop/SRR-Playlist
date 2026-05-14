import { useState } from 'react';
import { Mic2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { toast } from '@/store/toastStore';

interface Props {
  onDone: () => void;
}

/**
 * 아티스트 회원가입 폼.
 * - auth.users 생성 후 public.users.account_type='artist' 로 설정
 * - artist_profiles (approval_status='pending') INSERT
 * - 관리자 승인 전까지 음원 업로드/노출 불가
 */
export default function ArtistSignupForm({ onDone }: Props) {
  const { signUpWithPassword } = useAuthStore();
  const [realName, setRealName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [artistName, setArtistName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!realName.trim()) return '이름을 입력해주세요';
    if (!birthDate) return '생년월일을 입력해주세요';
    if (!artistName.trim()) return '아티스트명을 입력해주세요';
    if (phone.replace(/\D/g, '').length < 9) return '전화번호 형식이 올바르지 않아요';
    if (!address.trim()) return '주소를 입력해주세요';
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
      await signUpWithPassword(email.trim(), password, artistName.trim());

      const pendingProfile = {
        account_type: 'artist' as const,
        full_name: realName.trim(),
        birth_date: birthDate,
        phone: phone.trim(),
        address: address.trim(),
        signup_completed: true,
        artist_approval_status: 'pending' as const,
      };
      const pendingArtist = {
        real_name: realName.trim(),
        birth_date: birthDate,
        artist_name: artistName.trim(),
        phone: phone.trim(),
        address: address.trim(),
        email: email.trim(),
        approval_status: 'pending' as const,
      };
      try {
        localStorage.setItem(
          'srr-pending-artist-signup',
          JSON.stringify({ profile: pendingProfile, artist: pendingArtist }),
        );
      } catch {
        /* noop */
      }

      const { data: sess } = await supabase.auth.getSession();
      if (sess.session?.user?.id) {
        const uid = sess.session.user.id;
        await supabase.from('users').update(pendingProfile).eq('id', uid);
        await supabase
          .from('artist_profiles')
          .upsert({ user_id: uid, ...pendingArtist }, { onConflict: 'user_id' });
      }

      toast.success('아티스트 회원가입 신청이 완료됐어요. 관리자 승인 후 음원 등록이 가능합니다.');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : '가입에 실패했어요');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-center gap-2 rounded-2xl bg-accent/5 p-3 ring-1 ring-accent/20">
        <Mic2 size={16} className="text-accent" />
        <p className="text-xs leading-relaxed text-ink-mute">
          아티스트 회원가입 후 <strong className="text-accent">관리자 승인</strong>을 받아야 음원
          등록이 가능합니다.
        </p>
      </div>

      <Field label="이름 *">
        <input type="text" required value={realName} onChange={(e) => setRealName(e.target.value)} autoComplete="name" className="input" />
      </Field>
      <Field label="생년월일 *">
        <input type="date" required value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className="input" />
      </Field>
      <Field label="아티스트명 *" hint="공개되는 활동명">
        <input type="text" required value={artistName} onChange={(e) => setArtistName(e.target.value)} className="input" />
      </Field>
      <Field label="전화번호 *">
        <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="010-0000-0000" className="input" />
      </Field>
      <Field label="주소 *">
        <input type="text" required value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" className="input" />
      </Field>

      <hr className="border-line/10" />

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
        {busy ? '가입 중…' : '아티스트 회원가입 신청'}
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
