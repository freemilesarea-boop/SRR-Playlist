import { useState } from 'react';
import { Mic2, CheckCircle2, UserCheck } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { verifySalesAgentCode, type VerifiedSalesAgent } from '@/lib/salesAgentApi';
import { toast } from '@/store/toastStore';
import Alert, { inlineToneClass } from '@/components/Alert';

interface Props {
  onDone: (email: string) => void;
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
  // 추천인(영업인) 코드 — 선택. 입력 시 verify_sales_agent_code 로 검증
  const [salesAgentCode, setSalesAgentCode] = useState('');
  const [salesAgent, setSalesAgent] = useState<VerifiedSalesAgent | null>(null);
  const [salesAgentError, setSalesAgentError] = useState<string | null>(null);
  const [salesAgentChecking, setSalesAgentChecking] = useState(false);

  function validate(): string | null {
    if (!realName.trim()) return '이름을 입력해주세요';
    if (!birthDate) return '생년월일을 입력해주세요';
    if (!artistName.trim()) return '아티스트명을 입력해주세요';
    if (phone.replace(/\D/g, '').length < 9) return '전화번호 형식이 올바르지 않아요';
    if (!address.trim()) return '주소를 입력해주세요';
    // 아티스트 가입은 유효한 영업코드 필수
    if (!salesAgentCode.trim()) return '영업코드를 입력해주세요 (아티스트 가입 필수)';
    if (!salesAgent) return '영업코드 확인을 완료해주세요';
    if (!email.trim()) return '이메일을 입력해주세요';
    if (password.length < 6) return '비밀번호는 6자 이상이어야 해요';
    if (password !== passwordConfirm) return '비밀번호가 일치하지 않아요';
    return null;
  }

  async function handleSalesAgentVerify() {
    setSalesAgentError(null);
    setSalesAgent(null);
    const trimmed = salesAgentCode.trim();
    if (!trimmed) return;
    setSalesAgentChecking(true);
    try {
      const r = await verifySalesAgentCode(trimmed);
      if (!r) {
        setSalesAgentError('유효하지 않은 추천인 코드입니다.');
        return;
      }
      setSalesAgent(r);
    } catch (e) {
      setSalesAgentError(
        e instanceof Error ? `코드 확인에 실패했어요: ${e.message}` : '코드 확인에 실패했어요',
      );
    } finally {
      setSalesAgentChecking(false);
    }
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
      // 가입 직전 추천인 코드 재검증 — 검증 클릭 후 비활성화된 경우까지 차단.
      let verifiedAgent = salesAgent;
      const codeTrim = salesAgentCode.trim();
      if (codeTrim) {
        const r = await verifySalesAgentCode(codeTrim);
        if (!r) {
          setSalesAgent(null);
          setSalesAgentError('유효하지 않은 추천인 코드입니다.');
          setError('유효하지 않은 추천인 코드입니다.');
          setBusy(false);
          return;
        }
        verifiedAgent = r;
        setSalesAgent(r);
      } else {
        verifiedAgent = null;
      }

      // 0021 트리거가 user_metadata 를 읽어 public.users + artist_profiles 자동 생성.
      // 이메일 인증 ON / OFF 무관하게 atomic 처리됨.
      await signUpWithPassword(email.trim(), password, artistName.trim(), {
        account_type: 'artist',
        full_name: realName.trim(),
        birth_date: birthDate,
        phone: phone.trim(),
        address: address.trim(),
        artist_name: artistName.trim(),
        // 서버(handle_new_user)가 이 영업코드를 검증한 경우에만 artist 로 생성됨.
        sales_agent_code: salesAgentCode.trim(),
      });

      // localStorage 백업 — 트리거 미적용 환경 또는 첫 로그인 시 재적용용.
      // 추천인 코드는 profile.sales_agent_id/code 로 저장 → applyPendingSignupOnLogin
      // 의 users.update 가 자동 동기화.
      try {
        localStorage.setItem(
          'srr-pending-signup',
          JSON.stringify({
            type: 'artist',
            email: email.trim(),
            profile: {
              account_type: 'artist',
              full_name: realName.trim(),
              birth_date: birthDate,
              phone: phone.trim(),
              address: address.trim(),
              signup_completed: true,
              artist_approval_status: 'pending',
              ...(verifiedAgent
                ? {
                    sales_agent_id: verifiedAgent.id,
                    sales_agent_code: verifiedAgent.code,
                  }
                : {}),
            },
            artist: {
              real_name: realName.trim(),
              birth_date: birthDate,
              artist_name: artistName.trim(),
              phone: phone.trim(),
              address: address.trim(),
              email: email.trim(),
              approval_status: 'pending',
            },
          }),
        );
      } catch {
        /* noop */
      }

      // 아티스트 생성/승격은 서버(handle_new_user)가 메타데이터의 초대코드를 검증·소비한
      // 경우에만 수행한다. 클라이언트는 artist_profiles/account_type 을 직접 쓰지 않는다
      // (코드 가드 트리거로 차단됨). 여기서는 추천인(sales_agent) 연결만 보강.
      const { data: sess } = await supabase.auth.getSession();
      let hasSession = false;
      if (sess.session?.user?.id) {
        hasSession = true;
        const uid = sess.session.user.id;
        if (verifiedAgent) {
          const { error: agErr } = await supabase
            .from('users')
            .update({
              sales_agent_id: verifiedAgent.id,
              sales_agent_code: verifiedAgent.code,
            })
            .eq('id', uid);
          if (agErr && import.meta.env.DEV) {
            console.warn('[artist-signup] sales_agent update failed:', agErr);
          }
        }
      } else {
        if (import.meta.env.DEV) {
          console.log('[artist-signup] no session after signup — 이메일 인증 후 첫 로그인 시 자동 적용');
        }
      }

      // 세션 유무에 따라 메시지 차별화
      if (hasSession) {
        toast.success('아티스트 가입 신청이 접수됐어요. 관리자 승인 후 음원 업로드가 가능합니다.');
      } else {
        toast.info(
          '아티스트 가입 신청이 접수됐어요. 이메일 인증 후 로그인하시면 등록이 완료됩니다.',
        );
      }
      onDone(email.trim());
    } catch (err) {
      if (import.meta.env.DEV) console.error('[artist-signup] failed:', err);
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
        <input type="text" required value={artistName} onChange={(e) => setArtistName(e.target.value)} autoComplete="nickname" maxLength={50} className="input" />
      </Field>
      <Field label="전화번호 *">
        <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="010-0000-0000" className="input" />
      </Field>
      <Field label="주소 *">
        <input type="text" required value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" className="input" />
      </Field>

      {/* 영업코드 (아티스트 가입 필수) */}
      <hr className="border-line/10" />
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">영업코드 *</p>
      <Field label="영업코드 (아티스트 가입 필수)">
        <div className="flex gap-2">
          <input
            type="text"
            value={salesAgentCode}
            onChange={(e) => {
              setSalesAgentCode(e.target.value);
              setSalesAgent(null);
              setSalesAgentError(null);
            }}
            placeholder="추천인 코드를 입력해주세요"
            className="input flex-1"
            autoCapitalize="characters"
          />
          <button
            type="button"
            onClick={handleSalesAgentVerify}
            disabled={salesAgentChecking || !salesAgentCode.trim() || !!salesAgent}
            className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 text-xs font-semibold transition ${
              salesAgent
                ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30'
                : 'bg-accent/15 text-accent ring-1 ring-accent/30 hover:bg-accent/20'
            }`}
          >
            {salesAgent ? <CheckCircle2 size={14} /> : <UserCheck size={14} />}
            {salesAgent ? '확인됨' : salesAgentChecking ? '확인 중…' : '코드 확인'}
          </button>
        </div>
        {salesAgentError && (
          <p className={`mt-1 text-[11px] ${inlineToneClass.error}`}>{salesAgentError}</p>
        )}
        {salesAgent && (
          <p className={`mt-1 text-[11px] ${inlineToneClass.success}`}>
            담당 추천인: {salesAgent.name} ({salesAgent.code})
          </p>
        )}
      </Field>
      <Alert tone="warning">
        아티스트 가입은 <strong>유효한 영업코드</strong>가 있어야 가능합니다. 코드는 담당 영업인/관리자에게 발급받으세요.
      </Alert>

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

      {error && <Alert tone="error">{error}</Alert>}

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
