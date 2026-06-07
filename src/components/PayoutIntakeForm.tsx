/**
 * PayoutIntakeForm — X6.20
 *
 * 정산 정보 등록 전용 폼. 일반 SupportInquiryForm 과 분리.
 * 필수: 실명 / 주민번호 / 휴대폰 / 주소 / 은행 / 계좌 / 예금주 / 신분증.
 *
 * 보안:
 *   - RRN/계좌는 type=password / autoComplete=off / submit 후 state 즉시 폐기
 *   - 신분증은 private bucket 업로드, 본인 폴더 강제
 *   - 평문 PII 가 서버 외부로 빠지지 않음 (RPC 안에서 즉시 암호화)
 */
import { useState } from 'react';
import { Lock, Upload, X, ShieldCheck } from 'lucide-react';
import { submitPayoutIntake } from '@/lib/payoutIntakeApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}

const PII_NOTICE =
  '입력하신 주민등록번호 / 계좌번호는 즉시 암호화되어 저장되며, ' +
  '원본은 관리자 화면의 reveal 버튼(사유 입력 + audit log)을 통해서만 확인됩니다. ' +
  '이메일/알림 본문에는 마스킹된 값만 전송됩니다.';

function formatRrn(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 13);
  return d.length > 6 ? `${d.slice(0, 6)}-${d.slice(6)}` : d;
}

export default function PayoutIntakeForm({ open, onClose, onSubmitted }: Props) {
  const [legalName, setLegalName] = useState('');
  const [rrn, setRrn] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  const [idDoc, setIdDoc] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function resetSensitive() {
    setRrn('');
    setAccountNumber('');
    setIdDoc(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!legalName.trim()) return setError('실명을 입력해주세요');
    const rrnDigits = rrn.replace(/\D/g, '');
    if (rrnDigits.length !== 13) return setError('주민등록번호 13자리를 정확히 입력해주세요');
    if (phone.replace(/\D/g, '').length < 9) return setError('휴대폰번호 형식이 올바르지 않아요');
    if (!address.trim()) return setError('주소를 입력해주세요');
    if (!bankName.trim()) return setError('은행명을 입력해주세요');
    if (accountNumber.replace(/\D/g, '').length < 6) return setError('계좌번호를 정확히 입력해주세요');
    if (!accountHolder.trim()) return setError('예금주를 입력해주세요');
    if (!idDoc) return setError('신분증을 첨부해주세요');
    if (idDoc.size > 10 * 1024 * 1024) return setError('신분증 파일은 10MB 이하만 가능합니다');
    if (!consent) return setError('수집·이용 동의가 필요합니다');

    setBusy(true);
    try {
      await submitPayoutIntake({
        legal_name: legalName,
        resident_registration_number: rrnDigits,
        phone, address,
        bank_name: bankName,
        account_number: accountNumber,
        account_holder: accountHolder,
        id_document: idDoc,
      });
      toast.success('정산 정보 등록 신청이 접수됐어요. 관리자 검토 후 알림드릴게요.');
      resetSensitive();
      setLegalName('');
      setPhone('');
      setAddress('');
      setBankName('');
      setAccountHolder('');
      setConsent(false);
      onSubmitted?.();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '제출 실패';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center" onClick={() => !busy && onClose()}>
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-amber-400" />
            <div>
              <h2 className="text-base font-extrabold">정산 정보 등록</h2>
              <p className="mt-0.5 text-[11px] text-ink-mute">
                관리자 검토 후 정산 지급 권한이 활성화됩니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full p-1.5 hover:bg-ink/5"
          >
            <X size={16} />
          </button>
        </div>

        <Alert tone="warning">
          <p className="text-[11px] leading-relaxed">{PII_NOTICE}</p>
        </Alert>

        <Field label="실명 *">
          <input
            type="text"
            required
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            placeholder="주민등록상 이름"
            className="input"
            autoComplete="name"
          />
        </Field>

        <Field label="주민등록번호 * (13자리)" hint="암호화 저장. 본인/관리자 reveal 만 가능.">
          <input
            type="password"
            required
            value={rrn}
            onChange={(e) => setRrn(formatRrn(e.target.value))}
            placeholder="000000-0000000"
            className="input font-mono"
            inputMode="numeric"
            autoComplete="off"
            maxLength={14}
          />
        </Field>

        <Field label="휴대폰번호 *">
          <input
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="010-0000-0000"
            className="input"
            autoComplete="tel"
          />
        </Field>

        <Field label="주소 *">
          <input
            type="text"
            required
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="시/도 군/구 상세주소"
            className="input"
            autoComplete="street-address"
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="은행명 *">
            <input
              type="text"
              required
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="예: 신한은행"
              className="input"
            />
          </Field>
          <Field label="예금주 *">
            <input
              type="text"
              required
              value={accountHolder}
              onChange={(e) => setAccountHolder(e.target.value)}
              placeholder="예금주명 (본인 명의)"
              className="input"
            />
          </Field>
        </div>

        <Field label="계좌번호 *" hint="암호화 저장.">
          <input
            type="password"
            required
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="숫자만 또는 하이픈 포함"
            className="input font-mono"
            inputMode="numeric"
            autoComplete="off"
          />
        </Field>

        <Field label="신분증 첨부 *" hint="JPG/PNG/PDF · 최대 10MB · 본인만 접근 가능한 private 저장소">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-bg-card px-3 py-3 ring-1 ring-line/10 hover:bg-bg-hover">
            <Upload size={14} />
            <span className="flex-1 truncate text-xs">
              {idDoc ? idDoc.name : '파일 선택…'}
            </span>
            {idDoc && (
              <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                {(idDoc.size / 1024 / 1024).toFixed(1)}MB
              </span>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              className="hidden"
              onChange={(e) => setIdDoc(e.target.files?.[0] ?? null)}
            />
          </label>
        </Field>

        <label className="flex items-start gap-2 rounded-lg bg-bg-deep/40 p-3 text-[11px]">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <strong>수집·이용 동의 (필수)</strong>
            <br />
            <span className="text-ink-mute">
              정산 및 원천징수 신고를 위해 주민등록번호·계좌번호·신분증을 수집·이용합니다.
              수집된 정보는 세법상 신고 및 지급명세서 제출 목적으로만 사용됩니다.
            </span>
          </span>
        </label>

        {error && <Alert tone="error">{error}</Alert>}

        <div className="flex items-center gap-2">
          <Lock size={11} className="text-ink-dim" />
          <span className="text-[10px] text-ink-dim">
            제출 후 화면에 입력한 주민번호·계좌번호는 즉시 폐기됩니다.
          </span>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="btn-ghost px-3 py-2 text-xs"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={busy || !consent}
            className="btn-primary px-4 py-2 text-xs"
          >
            {busy ? '제출 중…' : '정산 정보 제출'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-mute">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[10px] text-ink-dim">{hint}</span>}
    </label>
  );
}
