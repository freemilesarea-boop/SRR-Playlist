import { useEffect, useState } from 'react';
import { ArrowLeft, FileText, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {
  fetchMyContract,
  signMyContract,
  rejectMyContract,
  type MyContract,
} from '@/lib/artistContractApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('ko-KR');
}

export default function ArtistContractPage() {
  const navigate = useNavigate();
  const [contract, setContract] = useState<MyContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const c = await fetchMyContract();
      setContract(c);
      // signed 상태면 동의 체크박스 미리 체크 (readonly)
      if (c?.status === 'signed') setAgreed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSign() {
    if (!contract) return;
    if (!agreed) {
      toast.error('계약서 내용에 동의해주세요.');
      return;
    }
    setSigning(true);
    try {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null;
      // IP 는 서버 측에서 채울 수도 있지만, MVP 는 클라이언트가 null 로 두고 향후 EF 로 캡처 가능
      await signMyContract(contract.id, { ip: null, userAgent: ua });
      toast.success('계약이 체결됐어요. 음원 등록 단계로 이동할 수 있어요.');
      await load();
      // 서명 완료 후 dashboard 로 자동 이동
      setTimeout(() => navigate('/artist'), 600);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '서명에 실패했어요');
    } finally {
      setSigning(false);
    }
  }

  async function handleReject(reason: string) {
    if (!contract) return;
    setSigning(true);
    try {
      await rejectMyContract(contract.id, reason);
      toast.info('계약이 거절됐어요.');
      await load();
      setRejectModalOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '거절 처리 실패');
    } finally {
      setSigning(false);
    }
  }

  return (
    <div className="space-y-5 px-4 pb-8 pt-6 sm:px-6">
      <header className="flex items-center gap-3">
        <Link
          to="/artist"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-card"
          aria-label="뒤로"
        >
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">아티스트 계약서</h1>
          <p className="text-xs text-ink-mute">전자 동의로 체결되며, 동의 시점이 시스템에 기록됩니다.</p>
        </div>
      </header>

      {loading ? (
        <p className="py-12 text-center text-sm text-ink-mute">불러오는 중…</p>
      ) : error ? (
        <Alert tone="error" title="계약서 조회 실패">{error}</Alert>
      ) : !contract ? (
        <Alert tone="info" title="아직 계약서가 발행되지 않았어요">
          관리자가 회원님 계약서를 생성하면 이 화면에서 본문을 확인하고 동의할 수 있어요.
          승인 + 결제 완료 후 보통 1영업일 내 발행됩니다.
        </Alert>
      ) : (
        <ContractView
          contract={contract}
          agreed={agreed}
          signing={signing}
          onAgreedChange={setAgreed}
          onSign={handleSign}
          onRejectOpen={() => setRejectModalOpen(true)}
        />
      )}

      {rejectModalOpen && (
        <RejectModal
          busy={signing}
          onCancel={() => setRejectModalOpen(false)}
          onConfirm={handleReject}
        />
      )}
    </div>
  );
}

function ContractView({
  contract,
  agreed,
  signing,
  onAgreedChange,
  onSign,
  onRejectOpen,
}: {
  contract: MyContract;
  agreed: boolean;
  signing: boolean;
  onAgreedChange: (v: boolean) => void;
  onSign: () => void;
  onRejectOpen: () => void;
}) {
  const isReadonly = contract.status !== 'pending_signature';

  return (
    <div className="space-y-4">
      {/* 상태 배너 */}
      <StatusBanner contract={contract} />

      {/* 메타 정보 */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10 sm:grid-cols-4">
        <Meta label="계약 버전" value={contract.contract_version} />
        <Meta label="발행일시" value={fmtDateTime(contract.created_at)} />
        {contract.signed_at && <Meta label="서명일시" value={fmtDateTime(contract.signed_at)} />}
        {contract.expires_at && (
          <Meta label="서명 만료" value={fmtDateTime(contract.expires_at)} />
        )}
      </div>

      {/* 본문 */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <FileText size={14} /> {contract.contract_title}
        </h2>
        <div className="max-h-[60vh] overflow-y-auto rounded-2xl bg-bg-card p-5 ring-1 ring-line/10">
          <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-ink">
            {contract.contract_body}
          </pre>
        </div>
      </section>

      {/* 동의 + 서명 또는 readonly 안내 */}
      {isReadonly ? (
        <Alert tone={contract.status === 'signed' ? 'success' : 'info'}>
          {contract.status === 'signed' && '이미 서명 완료된 계약이에요. 본문은 수정할 수 없어요.'}
          {contract.status === 'rejected' &&
            `이 계약은 거절됐어요. 사유: ${contract.rejected_reason ?? '—'}`}
          {contract.status === 'expired' && '계약 서명 기한이 만료됐어요. 관리자에게 재발급을 요청해주세요.'}
        </Alert>
      ) : (
        <div className="space-y-3 rounded-2xl bg-bg-card p-4 ring-1 ring-accent/30">
          <Alert tone="warning">
            본 계약은 전자문서·전자거래 기본법 및 전자서명법에 따라 서면 계약과 동일한 효력을
            가집니다. 동의 시점의 IP·접속 기기·시각이 시스템에 기록됩니다.
          </Alert>

          <label className="flex cursor-pointer items-start gap-2 rounded-xl bg-bg-soft p-3 ring-1 ring-line/10">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => onAgreedChange(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-sm leading-relaxed">
              위 「{contract.contract_title}」의 모든 조항을 확인했으며, 본인은 그 내용에
              <strong className="text-accent"> 동의합니다.</strong>
            </span>
          </label>

          <div className="flex gap-2">
            <button
              onClick={onRejectOpen}
              disabled={signing}
              className="flex-1 rounded-xl bg-bg-soft py-3 text-sm font-semibold text-ink-mute ring-1 ring-line/10 hover:text-red-400 disabled:opacity-60"
            >
              거절
            </button>
            <button
              onClick={onSign}
              disabled={!agreed || signing}
              className="flex-1 rounded-xl bg-accent py-3 text-sm font-bold text-bg hover:opacity-90 disabled:opacity-50"
            >
              {signing ? '서명 중…' : '동의 후 서명'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBanner({ contract }: { contract: MyContract }) {
  if (contract.status === 'pending_signature') {
    return (
      <Alert tone="warning">
        <Clock size={12} className="mr-1 inline" /> 서명 대기 중. 본문을 확인 후 아래 동의·서명
        진행해주세요.
      </Alert>
    );
  }
  if (contract.status === 'signed') {
    return (
      <Alert tone="success">
        <CheckCircle2 size={12} className="mr-1 inline" /> 서명 완료 ({fmtDateTime(contract.signed_at)})
      </Alert>
    );
  }
  if (contract.status === 'rejected') {
    return (
      <Alert tone="error">
        <XCircle size={12} className="mr-1 inline" /> 거절됨
        {contract.rejected_reason && ` — ${contract.rejected_reason}`}
      </Alert>
    );
  }
  return (
    <Alert tone="error">
      <Clock size={12} className="mr-1 inline" /> 만료됨. 관리자에게 재발급을 요청해주세요.
    </Alert>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-bg-soft px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold">{value}</p>
    </div>
  );
}

function RejectModal({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
      >
        <h3 className="text-base font-bold">계약을 거절할까요?</h3>
        <Alert tone="warning">
          거절 시 음원 등록이 불가능하며, 관리자가 새 계약서를 재발행해야 다시 진행할 수 있어요.
        </Alert>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-ink-mute">거절 사유 (선택)</span>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="input"
            placeholder="조항 중 어떤 부분이 문제인지 알려주세요"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="btn-ghost px-3 py-2 text-xs">
            취소
          </button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={busy}
            className="rounded-lg bg-red-500 px-4 py-2 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-60"
          >
            {busy ? '처리 중…' : '거절'}
          </button>
        </div>
      </div>
    </div>
  );
}
