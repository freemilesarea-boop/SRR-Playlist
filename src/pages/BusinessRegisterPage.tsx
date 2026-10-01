import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BadgeCheck, Loader2, ShieldCheck, Clock } from 'lucide-react';
import { verifyBusinessNumberServerSide } from '@/lib/api/pricingApi';
import { isBusinessNumberChecksumValid } from '@/lib/pricingPlans';
import { formatBusinessNumber } from '@/lib/businessVerification';
import {
  getBusinessTrialGate, startVerifiedBusinessTrial,
  type BusinessTrialGate,
} from '@/lib/trialApi';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';

/**
 * 0530 — 사업자등록 페이지.
 *
 * 기존에는 사업자등록번호를 등록할 수 있는 화면이 (1) 사업자 회원가입 폼과
 * (2) 엔터프라이즈 본사 신청(요금제 화면)뿐이었다. 가입을 개인으로 했다가
 * 사업자로 전환한 회원은 등록할 곳이 없어서, 재생 게이트가 "사업자등록 후
 * 무료체험 가능" 을 안내해도 막다른 길이었다. 그 입구를 만든다.
 *
 * 기록은 verify-business-number 엣지함수가 유일하게 한다(service_role).
 * 체험 개방도 서버 RPC 가 판정한다 — 이 화면은 호출만 한다.
 */
export default function BusinessRegisterPage() {
  const navigate = useNavigate();
  const profile = useAuthStore((s) => s.profile);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);

  const [gate, setGate] = useState<BusinessTrialGate | null>(null);
  const [businessNumber, setBusinessNumber] = useState('');
  const [representativeName, setRepresentativeName] = useState('');
  const [businessOpenDate, setBusinessOpenDate] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadGate = useCallback(async () => {
    setGate(await getBusinessTrialGate());
  }, []);
  useEffect(() => { void loadGate(); }, [loadGate]);

  const isBusiness = profile?.account_type === 'business';
  const trialDone = !!gate && (gate.trial_active || gate.trial_used || gate.paid);

  async function submit() {
    if (!isBusinessNumberChecksumValid(businessNumber)) {
      setMsg('사업자등록번호를 정확히 입력해주세요.'); return;
    }
    if (!representativeName.trim() || !businessOpenDate) {
      setMsg('대표자명과 개업일자를 입력해주세요.'); return;
    }
    setBusy(true); setMsg(null);
    try {
      const r = await verifyBusinessNumberServerSide({
        businessNumber,
        representativeName,
        businessOpenDate,
        businessName,
        businessAddress,
      });
      setMsg(r.message);
      // 'rejected' 면 등록이 기록되지 않는다 — 체험도 열리지 않는다.
      if (r.verification_status !== 'verified' && r.verification_status !== 'manual_review') return;

      // 엣지함수가 이미 열었을 수 있다(배포 버전에 따라 다름).
      // 서버가 1회만 허용하므로 중복 호출은 안전하다.
      let opened = r.trial_started === true;
      if (!opened) {
        const t = await startVerifiedBusinessTrial();
        opened = t.ok;
      }
      await refreshProfile();
      await loadGate();
      if (opened) toast.success('사업자등록 확인 — 3일 무료체험이 시작되었습니다.');
      else toast.info('사업자등록이 접수됐어요.');
    } catch (e) {
      setMsg(friendlyError(e, '사업자등록에 실패했어요'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-6">
      <div className="flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/15 text-accent">
          <ShieldCheck size={20} />
        </span>
        <div>
          <h1 className="text-lg font-extrabold tracking-tight">사업자등록</h1>
          <p className="text-xs text-ink-mute">등록을 마치면 3일 무료체험이 바로 열립니다.</p>
        </div>
      </div>

      {!isBusiness && (
        <div className="rounded-2xl bg-bg-card p-4 text-sm ring-1 ring-line/10">
          <p className="font-semibold">사업자 회원만 이용할 수 있어요.</p>
          <p className="mt-1 text-ink-mute">
            매장에서 음악을 사용하시려면 사업자 회원으로 전환이 필요합니다. 고객센터로 문의해주세요.
          </p>
        </div>
      )}

      {isBusiness && gate?.registered && (
        <div className="rounded-2xl bg-bg-card p-4 text-sm ring-1 ring-line/10">
          <p className="flex items-center gap-1.5 font-semibold text-accent">
            <BadgeCheck size={16} /> 사업자등록이 접수되어 있어요.
          </p>
          {gate.registration_status === 'manual_review' && (
            <p className="mt-1 flex items-center gap-1.5 text-ink-mute">
              <Clock size={14} /> 담당자 확인이 진행 중입니다. 이용에는 지장이 없어요.
            </p>
          )}
          {gate.trial_active && gate.free_trial_ends_at && (
            <p className="mt-1 text-ink-mute">
              무료체험 종료: {new Date(gate.free_trial_ends_at).toLocaleString('ko-KR')}
            </p>
          )}
          <button onClick={() => navigate('/pricing')} className="btn-primary mt-3 w-full py-2.5 text-sm">
            요금제 보기
          </button>
        </div>
      )}

      {isBusiness && !gate?.registered && (
        <div className="space-y-3 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
          <Field label="사업자등록번호 *" hint="숫자 10자리">
            <input
              type="text" inputMode="numeric" value={businessNumber}
              onChange={(e) => setBusinessNumber(e.target.value)}
              onBlur={() => setBusinessNumber((v) => formatBusinessNumber(v))}
              placeholder="000-00-00000" className="input"
            />
          </Field>
          <Field label="대표자명 *">
            <input
              type="text" value={representativeName}
              onChange={(e) => setRepresentativeName(e.target.value)}
              autoComplete="name" className="input"
            />
          </Field>
          <Field label="개업일자 *">
            <input
              type="date" value={businessOpenDate}
              onChange={(e) => setBusinessOpenDate(e.target.value)} className="input"
            />
          </Field>
          <Field label="상호">
            <input
              type="text" value={businessName}
              onChange={(e) => setBusinessName(e.target.value)} className="input"
            />
          </Field>
          <Field label="사업장 주소">
            <input
              type="text" value={businessAddress}
              onChange={(e) => setBusinessAddress(e.target.value)}
              autoComplete="street-address" className="input"
            />
          </Field>

          {msg && <p className="text-xs text-ink-mute">{msg}</p>}

          <button onClick={() => void submit()} disabled={busy} className="btn-primary w-full py-3">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
            {busy ? '확인 중…' : trialDone ? '사업자등록하기' : '등록하고 3일 무료체험 시작'}
          </button>
          <p className="text-[11px] leading-relaxed text-ink-mute">
            국세청 사업자등록정보로 대표자명·개업일자를 대조합니다. 실시간 조회가 어려운 경우
            담당자 확인 후 승인되며, 그동안에도 체험은 이용할 수 있어요.
          </p>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-ink-mute">
        {label}{hint && <span className="ml-1 font-normal opacity-70">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}
