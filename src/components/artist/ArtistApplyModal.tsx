import { useState } from 'react';
import { Mic2, X } from 'lucide-react';
import { submitArtistSignupProfile } from '@/lib/artistApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';

/**
 * 로그인한 일반 회원이 아티스트로 지원(전환)하는 모달.
 * 신규 auth 가입 없이 submit_artist_signup_profile RPC 로 본인 계정에
 * artist_profiles(pending) 생성 + account_type='artist' 설정. 관리자 승인 대기.
 */
export default function ArtistApplyModal({
  defaultEmail,
  onClose,
  onDone,
}: {
  defaultEmail: string;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [realName, setRealName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [artistName, setArtistName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState(defaultEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!realName.trim()) return '이름을 입력해주세요';
    if (!birthDate) return '생년월일을 입력해주세요';
    if (!artistName.trim()) return '아티스트명을 입력해주세요';
    if (phone.replace(/\D/g, '').length < 9) return '전화번호 형식이 올바르지 않아요';
    if (!address.trim()) return '주소를 입력해주세요';
    if (!email.trim()) return '이메일을 입력해주세요';
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await submitArtistSignupProfile({
        realName: realName.trim(),
        birthDate,
        artistName: artistName.trim(),
        phone: phone.trim(),
        address: address.trim(),
        email: email.trim(),
      });
      toast.success('아티스트 지원이 접수됐어요. 관리자 승인 후 음원 업로드가 가능해요.');
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : '지원 처리에 실패했어요. 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent">
              <Mic2 size={18} />
            </span>
            <div>
              <h3 className="text-base font-bold">아티스트로 지원하기</h3>
              <p className="text-[11px] text-ink-mute">승인 후 음원 업로드·정산이 가능해요.</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="닫기" className="rounded-full p-1 text-ink-mute hover:bg-ink/5 hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-2.5">
          <Field label="이름 (실명) *">
            <input className="input" value={realName} onChange={(e) => setRealName(e.target.value)} disabled={busy} />
          </Field>
          <Field label="생년월일 *">
            <input type="date" className="input" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} disabled={busy} />
          </Field>
          <Field label="아티스트명 *">
            <input className="input" value={artistName} onChange={(e) => setArtistName(e.target.value)} disabled={busy} />
          </Field>
          <Field label="전화번호 *">
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" disabled={busy} />
          </Field>
          <Field label="주소 *">
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} disabled={busy} />
          </Field>
          <Field label="정산용 이메일 *">
            <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
          </Field>

          {error && <Alert tone="error">{error}</Alert>}

          <button type="submit" disabled={busy} className="btn-primary w-full py-3 text-sm font-bold">
            {busy ? '지원 접수 중…' : '아티스트 지원 제출'}
          </button>
          <p className="text-center text-[10px] text-ink-dim">
            제출 후 관리자 승인 → 계약서 서명 → 정산 계좌 등록 순으로 진행돼요.
          </p>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-dim">{label}</span>
      {children}
    </label>
  );
}
