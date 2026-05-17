import { useState } from 'react';
import { Mic2, CheckCircle2, UserCheck, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/lib/supabase';
import { verifySalesAgentCode, type VerifiedSalesAgent } from '@/lib/salesAgentApi';
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
    // 추천인 코드 입력 시 검증 필수 (미입력은 허용)
    if (salesAgentCode.trim() && !salesAgent) {
      return '유효하지 않은 추천인 코드입니다.';
    }
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

      // 즉시 로그인된 환경(이메일 인증 OFF)이면 명시적 RPC 로 즉시 적용.
      // 0024 의 submit_artist_signup_profile RPC 는 트리거 동작 여부와 무관하게 본인이
      // 자신의 artist_profiles 를 생성/보정 가능. 멱등.
      const { data: sess } = await supabase.auth.getSession();
      let hasSession = false;
      if (sess.session?.user?.id) {
        hasSession = true;
        const uid = sess.session.user.id;
        const { data: rpcRes, error: rpcErr } = await supabase.rpc(
          'submit_artist_signup_profile',
          {
            p_real_name: realName.trim(),
            p_birth_date: birthDate,
            p_artist_name: artistName.trim(),
            p_phone: phone.trim(),
            p_address: address.trim(),
            p_email: email.trim(),
          },
        );
        // 추천인 연결 — RPC 시그니처 미수정. 별도 users.update 로 sales_agent 컬럼만 set
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
        // eslint-disable-next-line no-console
        console.log('[artist-signup] submit RPC:', { rpcRes, rpcErr });
        if (rpcErr) {
          // RPC 가 0024 미적용 등으로 없을 수도 있음 — fallback 으로 직접 upsert
          // eslint-disable-next-line no-console
          console.warn('[artist-signup] RPC 실패, 직접 upsert fallback:', rpcErr.message);
          const { error: uErr } = await supabase
            .from('users')
            .update({
              account_type: 'artist',
              full_name: realName.trim(),
              birth_date: birthDate,
              phone: phone.trim(),
              address: address.trim(),
              signup_completed: true,
              artist_approval_status: 'pending',
            })
            .eq('id', uid);
          if (uErr) console.error('[artist-signup] users.update fallback failed:', uErr);
          const { error: aErr } = await supabase.from('artist_profiles').upsert(
            {
              user_id: uid,
              real_name: realName.trim(),
              birth_date: birthDate,
              artist_name: artistName.trim(),
              phone: phone.trim(),
              address: address.trim(),
              email: email.trim(),
              approval_status: 'pending',
            },
            { onConflict: 'user_id' },
          );
          if (aErr) console.error('[artist-signup] artist_profiles.upsert fallback failed:', aErr);
          // 둘 다 실패한 경우엔 사용자에게 인지시키기 (localStorage 캐시가 다음 로그인 시 재적용)
          if (uErr && aErr) {
            toast.error(
              '가입은 완료됐지만 아티스트 프로필 저장이 지연됐어요. ' +
                '다시 로그인하면 자동 적용됩니다.',
            );
          }
        }
      } else {
        // eslint-disable-next-line no-console
        console.log('[artist-signup] no session after signup — 이메일 인증 후 첫 로그인 시 자동 적용');
      }

      // 세션 유무에 따라 메시지 차별화
      if (hasSession) {
        toast.success('아티스트 가입 신청이 접수됐어요. 관리자 승인 후 음원 업로드가 가능합니다.');
      } else {
        toast.info(
          '아티스트 가입 신청이 접수됐어요. 이메일 인증 후 로그인하시면 등록이 완료됩니다.',
        );
      }
      onDone();
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
        <input type="text" required value={artistName} onChange={(e) => setArtistName(e.target.value)} className="input" />
      </Field>
      <Field label="전화번호 *">
        <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="010-0000-0000" className="input" />
      </Field>
      <Field label="주소 *">
        <input type="text" required value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" className="input" />
      </Field>

      {/* 추천인 코드 (선택, 미입력 시 승인 거절 가능 안내) */}
      <hr className="border-line/10" />
      <p className="text-[11px] font-bold uppercase tracking-wider text-accent">추천인 코드</p>
      <Field label="추천인 코드">
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
        {salesAgentError && <p className="mt-1 text-[11px] text-red-300">{salesAgentError}</p>}
        {salesAgent && (
          <p className="mt-1 text-[11px] text-emerald-300">
            담당 추천인: {salesAgent.name} ({salesAgent.code})
          </p>
        )}
      </Field>
      <div className="flex items-start gap-2 rounded-xl bg-yellow-500/10 px-3 py-2 ring-1 ring-yellow-500/30">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-yellow-300" />
        <p className="text-xs leading-relaxed text-yellow-200/90">
          추천인 코드 미입력 시 아티스트 승인이 거절될 수 있습니다.
        </p>
      </div>

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
