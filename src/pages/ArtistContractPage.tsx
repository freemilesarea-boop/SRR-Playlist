import { useEffect, useState } from 'react';
import { ArrowLeft, FileText, CheckCircle2, XCircle, Clock, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {
  fetchMyContract,
  signMyContract,
  rejectMyContract,
  ensureMyContract,
  dispatchContractEmails,
  type MyContract,
} from '@/lib/artistContractApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import ContractMarkdown, { splitSummary } from '@/components/contract/ContractMarkdown';

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
      let c = await fetchMyContract();
      // 0068 — 본인 계약이 없으면 (승인+결제 완료 아티스트는) 자동 발행 시도
      if (!c) {
        try {
          // 항상 출력 (production 운영 진단). 실패 사유를 사용자에게도 노출.
          // eslint-disable-next-line no-console
          console.log('[contract] no row found — calling ensure_artist_contract_for_user');
          const id = await ensureMyContract();
          // eslint-disable-next-line no-console
          console.log('[contract] ensure returned contract_id:', id);
          c = await fetchMyContract();
          if (!c) {
            // ensure 가 id 를 반환했는데 fetchMyContract 가 빈 결과면 RLS / RPC 캐시 등 환경 문제
            // eslint-disable-next-line no-console
            console.warn('[contract] ensure ok but fetchMyContract still null. id=', id);
          }
        } catch (ensureErr) {
          const err = ensureErr as { code?: string; message?: string; details?: string; hint?: string };
          // eslint-disable-next-line no-console
          console.error('[contract] ensure_artist_contract_for_user failed:', {
            code: err.code, message: err.message, details: err.details, hint: err.hint,
          });
          // 게이트 미통과 사유를 사용자에게 명확히 안내
          const msg = err.message ?? String(ensureErr);
          if (/approval_sync_broken/i.test(msg)) {
            setError(
              '계정 상태 동기화 오류 — artist_profiles 와 users 의 승인 상태가 일치하지 않아요. 관리자에게 문의해주세요 (approval_sync_broken).',
            );
          } else if (/not approved/i.test(msg)) {
            setError('아티스트 승인이 완료된 후 계약서를 발행할 수 있어요. (관리자 승인 대기)');
          } else if (/not paid/i.test(msg) || /tier=/i.test(msg)) {
            setError('월 4,900원 정기이용권(individual) 결제 완료 후 계약서를 발행할 수 있어요.');
          } else if (/not artist/i.test(msg)) {
            setError('아티스트 계정이 아니에요.');
          } else if (/no active contract template/i.test(msg)) {
            setError('서버에 활성 계약서 템플릿이 없습니다. 관리자에게 문의해주세요.');
          } else {
            setError(`계약서 자동 발행 실패 — ${msg}`);
          }
        }
      }
      setContract(c);
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
      await signMyContract(contract.id, { ip: null, userAgent: ua });
      toast.success('계약이 체결됐어요. 계약서 사본 메일을 발송 중입니다.');

      // 0068 — Edge Function 호출하여 메일 발송 (실패해도 계약 signed 는 유지)
      void (async () => {
        const r = await dispatchContractEmails(contract.id);
        if (r.ok) {
          if (r.sent && r.sent > 0) {
            toast.success(`계약서 사본 ${r.sent}건 발송 완료${r.failed ? ` · 실패 ${r.failed}건` : ''}`);
          }
        } else {
          toast.warning(
            '메일 발송이 일부 실패했어요. 관리자가 자동 재시도하거나, 마이페이지에서 상태를 확인할 수 있어요.',
          );
        }
      })();

      await load();
      setTimeout(() => navigate('/artist'), 800);
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
    <div className="space-y-5 px-4 pb-32 pt-6 sm:px-6 sm:pb-40">
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
        <div className="space-y-2">
          <Alert tone="error" title="계약서 자동 발행 실패">{error}</Alert>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg bg-bg-card px-3 py-1.5 text-xs font-semibold ring-1 ring-line/10 hover:bg-bg-hover"
          >
            다시 시도
          </button>
        </div>
      ) : !contract ? (
        <div className="space-y-2">
          <Alert tone="info" title="계약서 발행 대기">
            계약서가 자동 발행되지 않았어요. 아래 버튼을 눌러 재시도해주세요. (승인+결제 완료 후 가능)
          </Alert>
          <button
            type="button"
            onClick={() => void load()}
            className="btn-primary inline-flex px-4 py-2 text-sm"
          >
            계약서 자동 발행 재시도
          </button>
        </div>
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
  const { summary, main } = splitSummary(contract.contract_body);

  return (
    <div className="space-y-5">
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

      {/* 핵심 요약 카드 (본문에서 추출) */}
      {summary && <ContractSummaryCard markdown={summary} />}

      {/* 본문 (동의란 placeholder 섹션 제외) */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
          <FileText size={14} className="text-accent" />
          {contract.contract_title}
        </h2>
        <article
          className="rounded-2xl bg-bg-card px-5 py-4 ring-1 ring-line/10 sm:px-7 sm:py-6"
        >
          <ContractMarkdown
            body={main}
            skipFromHeading="동의"
            className="contract-body mx-auto max-w-prose"
          />
        </article>
      </section>

      {/* 동의/서명 또는 readonly 안내 */}
      {isReadonly ? (
        <div className="space-y-3">
          <Alert tone={contract.status === 'signed' ? 'success' : 'info'}>
            {contract.status === 'signed' && '이미 서명 완료된 계약이에요. 본문은 수정할 수 없어요.'}
            {contract.status === 'rejected' &&
              `이 계약은 거절됐어요. 사유: ${contract.rejected_reason ?? '—'}`}
            {contract.status === 'expired' && '계약 서명 기한이 만료됐어요. 관리자에게 재발급을 요청해주세요.'}
          </Alert>
          {(contract.status === 'rejected' || contract.status === 'expired') && (
            <ContractReissueCTA status={contract.status} contractId={contract.id} />
          )}
        </div>
      ) : (
        <ContractSignCard
          title={contract.contract_title}
          agreed={agreed}
          signing={signing}
          onAgreedChange={onAgreedChange}
          onSign={onSign}
          onRejectOpen={onRejectOpen}
        />
      )}
    </div>
  );
}

function ContractSummaryCard({ markdown }: { markdown: string }) {
  return (
    <section className="rounded-2xl bg-sky-100 px-4 py-3 ring-1 ring-sky-400/30 dark:bg-sky-500/10 dark:ring-sky-400/25">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-200 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200">
          <ShieldCheck size={14} />
        </span>
        <h3 className="text-sm font-extrabold text-sky-900 dark:text-sky-100">
          계약 핵심 요약
        </h3>
      </div>
      <div className="mt-2 text-[13px] text-sky-900 dark:text-sky-100">
        <ContractMarkdown body={markdown} />
      </div>
    </section>
  );
}

function ContractSignCard({
  title,
  agreed,
  signing,
  onAgreedChange,
  onSign,
  onRejectOpen,
}: {
  title: string;
  agreed: boolean;
  signing: boolean;
  onAgreedChange: (v: boolean) => void;
  onSign: () => void;
  onRejectOpen: () => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl bg-bg-card p-4 ring-1 ring-accent/40 sm:p-5">
      <Alert tone="warning">
        본 계약은 전자문서·전자거래 기본법 및 전자서명법에 따라 서면 계약과 동일한 효력을
        가집니다. 동의 시점의 IP·접속 기기·시각이 시스템에 기록됩니다.
      </Alert>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-bg-soft p-3.5 ring-1 ring-line/10 hover:ring-accent/30">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => onAgreedChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-current text-accent"
        />
        <span className="text-[13.5px] leading-relaxed text-ink">
          위 「{title}」의 모든 조항을 확인했으며, 본인은 그 내용에
          <strong className="text-accent"> 동의합니다.</strong>
        </span>
      </label>

      <div className="flex gap-2 pt-1">
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
          className="flex-[2] rounded-xl bg-accent py-3 text-sm font-extrabold text-bg shadow-sm hover:opacity-90 disabled:opacity-50"
        >
          {signing ? '서명 중…' : '동의 후 서명'}
        </button>
      </div>
      <p className="text-center text-[11px] text-ink-dim">
        체크박스를 선택해야 "동의 후 서명" 버튼이 활성화됩니다.
      </p>
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

function ContractReissueCTA({
  status,
  contractId,
}: {
  status: 'rejected' | 'expired';
  contractId: string;
}) {
  const reason = status === 'rejected' ? '거절' : '만료';
  const subject = encodeURIComponent(`[SRR Playlist] 아티스트 계약서 재발행 요청 (${reason})`);
  const body = encodeURIComponent(
    [
      '안녕하세요, 아티스트 계약서 재발행을 요청드립니다.',
      '',
      `계약 ID: ${contractId}`,
      `현재 상태: ${status === 'rejected' ? '거절됨 (rejected)' : '만료됨 (expired)'}`,
      '',
      '재발행 사유 / 요청사항:',
      '(자유 기재)',
      '',
      '— 가입 이메일과 동일한 주소로 보내주시면 빠른 확인이 가능합니다.',
    ].join('\n'),
  );
  const href = `mailto:freemilesarea@gmail.com?subject=${subject}&body=${body}`;

  return (
    <div className="space-y-2 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <h3 className="text-sm font-bold">계약서 재발행 요청</h3>
      <p className="text-xs leading-relaxed text-ink-mute">
        계약이 {reason}된 상태에서는 음원 등록·정산이 진행되지 않아요. 아래 버튼으로 관리자에게
        재발행을 요청해주세요. 평균 1영업일 내 새 계약서가 발행됩니다.
      </p>
      <a
        href={href}
        className="inline-flex w-full items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-bg hover:opacity-90"
      >
        관리자에게 재발행 요청 메일 보내기
      </a>
    </div>
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
