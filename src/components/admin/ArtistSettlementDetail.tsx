import { useEffect, useRef, useState } from 'react';
import { X, Check, Pause, AlertTriangle, FileText, ArrowRightCircle } from 'lucide-react';
import { useModalA11y } from '@/hooks/useModalA11y';
import {
  adminSettlementDetail,
  adminFinalizeSettlement,
  adminMarkSettlementPaid,
  adminMarkSettlementHeld,
  type SettlementItem,
  type SettlementStatus,
  type SettlementPayoutAccountSummary,
  type SettlementAuditLog,
} from '@/lib/artistSettlementApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import { friendlyError } from '@/lib/errorMessages';
import RevealAccountButton from './RevealAccountButton';
import RevealPiiButton from './RevealPiiButton';
import CarryoverModal from './CarryoverModal';

const TAX_LABEL: Record<string, string> = {
  business_income_3_3: '사업소득 3.3%',
  other_income_8_8: '기타소득 8.8%',
  none: '원천징수 없음',
};

function fmtKrw(n: number | null | undefined): string {
  return `₩${(n ?? 0).toLocaleString()}`;
}

interface DetailData {
  settlement: {
    id: string;
    artist_user_id: string;
    settlement_month: string;
    status: SettlementStatus;
    payout_account_id: string | null;
    gross_settlement_amount: number;
    company_fee_amount: number;
    sales_agent_fee_amount: number;
    sales_agent_commission_rate: number | null;
    artist_net_settlement: number;
    previous_carried_amount: number;
    total_settlement_amount: number;
    meets_min_payout: boolean;
    withholding_tax_amount: number;
    final_payout_amount: number;
    carried_over_amount: number;
    payout_bank_name: string | null;
    payout_account_holder: string | null;
    masked_account_number: string | null;
    finalized_at: string | null;
    paid_at: string | null;
    payout_memo: string | null;
    held_reason: string | null;
    // X6.25 carryover 메타데이터
    is_manual_carryover: boolean;
    carryover_applied: boolean;
    carried_over_to_month: string | null;
    carryover_reason: string | null;
    carried_over_at: string | null;
    // X6.28 auto-merge 추적
    merged_into_settlement_id: string | null;
  };
  artist: { nickname: string | null; email: string | null; artist_name: string | null };
  policy: {
    pool_revenue_ratio: number;
    company_fee_ratio: number;
    withholding_tax_ratio: number;
    min_payout_amount: number;
    min_payout_basis: string;
  };
  payout_account: SettlementPayoutAccountSummary | null;
  items: SettlementItem[];
  audit_logs: SettlementAuditLog[];
}

export default function ArtistSettlementDetail({
  settlementId,
  onClose,
  onChanged,
}: {
  settlementId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [holdModalOpen, setHoldModalOpen] = useState(false);
  const [carryoverModalOpen, setCarryoverModalOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = (await adminSettlementDetail(settlementId)) as unknown as DetailData;
      setData(d);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [settlementId]);

  async function handleFinalize() {
    setBusy(true);
    try {
      const newStatus = await adminFinalizeSettlement(settlementId);
      toast.success(`Finalized → ${newStatus}`);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(friendlyError(e, 'Finalize 실패'));
    } finally {
      setBusy(false);
    }
  }

  async function handlePay(memo: string, forcePii: boolean = false) {
    setBusy(true);
    try {
      const r = await adminMarkSettlementPaid(settlementId, memo, forcePii);
      if (r.already_paid) {
        toast.info('이미 지급완료 처리된 정산입니다.');
      } else {
        toast.success(`지급 완료 처리됨 — ${r.before_status} → paid (이후 immutable, 다음 달 이월 제외)`);
      }
      setPayModalOpen(false);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(friendlyError(e, '지급 처리 실패'));
    } finally {
      setBusy(false);
    }
  }

  async function handleHold(reason: string) {
    setBusy(true);
    try {
      await adminMarkSettlementHeld(settlementId, reason);
      toast.success('보류 처리됨');
      setHoldModalOpen(false);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(friendlyError(e, '보류 처리 실패'));
    } finally {
      setBusy(false);
    }
  }

  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(dialogRef, { onClose });

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
      >
        <div className="sticky top-0 z-10 -mx-5 -mt-5 mb-3 flex items-center justify-between border-b border-line/10 bg-bg-soft/95 px-5 py-3 backdrop-blur">
          <h3 className="flex items-center gap-2 text-base font-bold">
            <FileText size={16} /> 정산 상세
          </h3>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-ink/5">
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <p className="py-12 text-center text-sm text-ink-mute">불러오는 중…</p>
        ) : error || !data ? (
          <Alert tone="error" title="조회 실패">{error ?? '데이터가 없어요'}</Alert>
        ) : (
          <div className="space-y-4">
            <header>
              <p className="text-xs text-ink-mute">{data.settlement.settlement_month.slice(0, 7)} 정산</p>
              <h4 className="text-lg font-bold">
                {data.artist.artist_name || data.artist.nickname || '—'}
              </h4>
              <p className="text-xs text-ink-mute">{data.artist.email}</p>
              <p className="mt-1 inline-block rounded-full bg-bg-card px-2 py-0.5 text-[10px] font-bold uppercase text-ink-mute">
                {data.settlement.status}
              </p>
            </header>

            <section>
              <h5 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-mute">산정 내역</h5>
              <div className="space-y-1 rounded-xl bg-bg-card p-3 text-sm ring-1 ring-line/10">
                <Row label="① Gross (트랙별 합산)" value={fmtKrw(data.settlement.gross_settlement_amount)} />
                <Row
                  label={`② 회사 수수료 (${Math.round(data.policy.company_fee_ratio * 100)}%)`}
                  value={`−${fmtKrw(data.settlement.company_fee_amount)}`}
                  muted
                />
                <Row
                  label={`③ 영업인 수수료${data.settlement.sales_agent_commission_rate ? ` (${data.settlement.sales_agent_commission_rate}%)` : ''}`}
                  value={`−${fmtKrw(data.settlement.sales_agent_fee_amount)}`}
                  muted
                />
                <Row
                  label="= 아티스트 net (이번 달)"
                  value={fmtKrw(data.settlement.artist_net_settlement)}
                />
                <Row
                  label="④ 직전월 이월금"
                  value={data.settlement.previous_carried_amount > 0 ? `+${fmtKrw(data.settlement.previous_carried_amount)}` : '0'}
                />
                <hr className="my-1 border-line/20" />
                <Row
                  label="총 정산액 (이월 포함)"
                  value={fmtKrw(data.settlement.total_settlement_amount)}
                  bold
                />
                {data.settlement.meets_min_payout ? (
                  <>
                    <Row
                      label={`⑤ 원천징수 (${(data.policy.withholding_tax_ratio * 100).toFixed(1)}%)`}
                      value={`−${fmtKrw(data.settlement.withholding_tax_amount)}`}
                      muted
                    />
                    <Row
                      label="⑥ 최종 지급액"
                      value={fmtKrw(data.settlement.final_payout_amount)}
                      bold
                      accent
                    />
                  </>
                ) : (
                  <Alert tone="warning">
                    총 정산액이 {fmtKrw(data.policy.min_payout_amount)} 미만 →
                    <strong> {fmtKrw(data.settlement.carried_over_amount)}</strong> 다음 달로 이월
                  </Alert>
                )}
              </div>
            </section>

            <section>
              <h5 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-mute">정산 정보 (PII)</h5>
              <div className="space-y-2 rounded-xl bg-bg-card px-3 py-2.5 text-xs ring-1 ring-line/10">
                {data.payout_account ? (
                  <>
                    <PiiRow label="실명">
                      <span className="font-medium">{data.payout_account.legal_name ?? '—'}</span>
                    </PiiRow>
                    <PiiRow label="주민등록번호">
                      {data.payout_account.has_rrn && data.payout_account.id ? (
                        <RevealPiiButton
                          accountId={data.payout_account.id}
                          piiType="resident_number"
                          maskedValue={data.payout_account.rrn_masked}
                          settlementId={data.settlement.id}
                        />
                      ) : (
                        <span className="text-ink-dim">미입력</span>
                      )}
                    </PiiRow>
                    <PiiRow label="은행 / 예금주">
                      <span>
                        {data.payout_account.bank_name ?? '—'} · {data.payout_account.account_holder ?? '—'}
                      </span>
                    </PiiRow>
                    <PiiRow label="계좌번호">
                      {data.payout_account.has_account_number && data.payout_account.id ? (
                        <RevealPiiButton
                          accountId={data.payout_account.id}
                          piiType="account_number"
                          maskedValue={data.payout_account.masked_account_number}
                          settlementId={data.settlement.id}
                        />
                      ) : data.settlement.payout_account_id ? (
                        <RevealAccountButton
                          accountId={data.settlement.payout_account_id}
                          maskedValue={data.settlement.masked_account_number}
                          settlementId={data.settlement.id}
                        />
                      ) : (
                        <span className="font-mono text-ink-dim">{data.settlement.masked_account_number ?? '—'}</span>
                      )}
                    </PiiRow>
                    <PiiRow label="원천징수 유형">
                      <span>
                        {data.payout_account.tax_withholding_type
                          ? (TAX_LABEL[data.payout_account.tax_withholding_type] ?? data.payout_account.tax_withholding_type)
                          : '—'}
                      </span>
                    </PiiRow>
                    <PiiRow label="정산 정보 상태">
                      <PayoutStatusBadge status={data.payout_account.status} />
                    </PiiRow>
                  </>
                ) : data.settlement.payout_bank_name ? (
                  <>
                    <p>{data.settlement.payout_bank_name} · {data.settlement.payout_account_holder}</p>
                    {data.settlement.payout_account_id && (
                      <RevealAccountButton
                        accountId={data.settlement.payout_account_id}
                        maskedValue={data.settlement.masked_account_number}
                        settlementId={data.settlement.id}
                      />
                    )}
                    <p className="text-ink-dim text-[10px]">※ PII 등록 전 snapshot 만 노출 — 본인 인증 필요</p>
                  </>
                ) : (
                  <p className="text-ink-dim">계좌 정보 없음</p>
                )}
              </div>
            </section>

            {data.settlement.is_manual_carryover && (
              <section>
                <h5 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-mute">수동 이월 정보</h5>
                <div className="space-y-1 rounded-xl bg-amber-500/5 px-3 py-2.5 text-xs ring-1 ring-amber-500/30">
                  <Row
                    label="이월 금액"
                    value={fmtKrw(data.settlement.carried_over_amount)}
                    bold accent
                  />
                  <Row
                    label="다음 정산월"
                    value={data.settlement.carried_over_to_month?.slice(0, 7) ?? '—'}
                  />
                  <Row
                    label="이월 처리 시점"
                    value={data.settlement.carried_over_at
                      ? new Date(data.settlement.carried_over_at).toLocaleString('ko-KR')
                      : '—'}
                  />
                  <Row
                    label="이월 반영 여부"
                    value={data.settlement.carryover_applied ? '다음 달에 반영됨' : '대기 중'}
                  />
                  {data.settlement.carryover_reason && (
                    <Alert tone="info" title="이월 사유">
                      {data.settlement.carryover_reason}
                    </Alert>
                  )}
                </div>
              </section>
            )}

            <section>
              <h5 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-mute">
                트랙별 상세 ({data.items.length}) — eligible 만 정산 반영
              </h5>
              <div className="overflow-hidden rounded-xl bg-bg-card ring-1 ring-line/10">
                <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-xs">
                  <thead className="border-b border-line/10 text-[10px] uppercase text-ink-dim">
                    <tr>
                      <th className="px-3 py-2 text-left">track_code</th>
                      <th className="px-3 py-2 text-left">제목</th>
                      <th className="px-3 py-2 text-right" title="전체 milestone_30s">raw</th>
                      <th className="px-3 py-2 text-right" title="제외 (admin/artist 미리듣기, 셀프재생 등)">제외</th>
                      <th className="px-3 py-2 text-right" title="정산 대상 = stream_count">eligible</th>
                      <th className="px-3 py-2 text-right">배분액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((it, i) => {
                      const raw = it.raw_milestone_stream_count ?? it.stream_count;
                      const excluded = it.excluded_stream_count ?? 0;
                      const eligible = it.eligible_stream_count ?? it.stream_count;
                      return (
                      <tr key={i} className="border-b border-line/10 last:border-b-0">
                        <td className="px-3 py-2 font-mono text-[10px]">{it.track_code}</td>
                        <td className="px-3 py-2">{it.track_title}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-mute">{raw.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-red-700 dark:text-red-300">
                          {excluded > 0 ? `-${excluded.toLocaleString()}` : '0'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{eligible.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtKrw(it.pool_revenue_share)}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            </section>

            {data.settlement.held_reason && (
              <Alert tone="warning" title="보류 사유">{data.settlement.held_reason}</Alert>
            )}
            {data.settlement.payout_memo && (
              <Alert tone="info" title="지급 메모">{data.settlement.payout_memo}</Alert>
            )}

            {data.audit_logs && data.audit_logs.length > 0 && (
              <section>
                <h5 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-mute">
                  관리자 액션 기록 ({data.audit_logs.length})
                </h5>
                <ul className="space-y-1 rounded-xl bg-bg-card px-3 py-2 text-xs ring-1 ring-line/10">
                  {data.audit_logs.map((log) => (
                    <li key={log.id} className="border-b border-line/10 py-1 last:border-b-0">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase text-ink-dim">{log.action}</span>
                        <span className="text-[10px] text-ink-dim">
                          {new Date(log.created_at).toLocaleString('ko-KR')}
                        </span>
                      </div>
                      {log.amount != null && (
                        <p className="text-ink-mute">
                          금액 {fmtKrw(log.amount)}
                          {log.from_month && log.to_month
                            ? ` · ${log.from_month.slice(0, 7)} → ${log.to_month.slice(0, 7)}`
                            : ''}
                        </p>
                      )}
                      {log.reason && <p className="text-ink">사유: {log.reason}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="flex flex-wrap justify-end gap-2 border-t border-line/10 pt-3">
              {data.settlement.status === 'pending' && (
                <button
                  onClick={handleFinalize}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg bg-sky-500 px-4 py-2 text-xs font-bold text-white hover:bg-sky-600 disabled:opacity-50"
                >
                  <Check size={12} /> Finalize
                </button>
              )}
              {/* X6.27 + X6.29: held 도 수동 이월 허용. paid / merged_into 는 차단 */}
              {(data.settlement.status === 'pending'
                || data.settlement.status === 'payable'
                || data.settlement.status === 'held')
                && data.settlement.merged_into_settlement_id == null && (
                <button
                  onClick={() => setCarryoverModalOpen(true)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg bg-amber-500/90 px-4 py-2 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-50"
                  title="다음 달 정산으로 이월"
                >
                  <ArrowRightCircle size={12} /> 이월 신청
                </button>
              )}
              {/* X6.29: 지급완료 처리 — pending/payable/held 모두 허용 (안전장치는 RPC 가 검증) */}
              {(data.settlement.status === 'pending'
                || data.settlement.status === 'payable'
                || data.settlement.status === 'held')
                && data.settlement.merged_into_settlement_id == null && (
                <button
                  onClick={() => setPayModalOpen(true)}
                  disabled={busy || (data.settlement.final_payout_amount ?? 0) <= 0}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-50"
                  title={(data.settlement.final_payout_amount ?? 0) <= 0
                    ? '최종 지급액이 0원 — 지급완료 처리 불가 (이월 또는 finalize 필요)'
                    : '실제 송금 완료 후 클릭'}
                >
                  <Check size={12} /> 지급완료 처리
                </button>
              )}
              {data.settlement.status === 'payable' && (
                <button
                  onClick={() => setHoldModalOpen(true)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  <Pause size={12} /> 보류
                </button>
              )}
              {data.settlement.status === 'paid' && (
                <Alert tone="success">
                  지급 완료 — 이후 모든 수정 차단 (immutable). 다음 달 이월에서도 제외됩니다.
                  {data.settlement.paid_at != null && (
                    <span className="ml-2 font-mono text-xs">
                      지급일: {new Date(data.settlement.paid_at as string).toLocaleString('ko-KR')}
                    </span>
                  )}
                </Alert>
              )}
              {data.settlement.status === 'carried_over' && data.settlement.is_manual_carryover && (
                <Alert tone="info">
                  수동 이월 처리됨 — 다음 달 ({data.settlement.carried_over_to_month?.slice(0, 7)}) 정산 생성 시 합산됩니다.
                </Alert>
              )}
            </section>
          </div>
        )}

        {payModalOpen && data && (
          <ConfirmModal
            title="지급완료 처리"
            tone="success"
            warning="이 정산을 지급완료 처리하면 이후 월 정산에 이월되지 않습니다. 계속하시겠습니까? 처리 후 모든 컬럼이 영구 immutable 됩니다."
            placeholder="지급 메모 (선택) — 송금 참조번호 등"
            busy={busy}
            onCancel={() => setPayModalOpen(false)}
            onConfirm={(text, forcePii) => handlePay(text, forcePii ?? false)}
            showForcePiiToggle={
              data.settlement.status === 'held'
              && (data.settlement.held_reason === 'pii_incomplete')
            }
          />
        )}
        {holdModalOpen && (
          <ConfirmModal
            title="보류 처리"
            tone="warning"
            warning="payable → held 로 전이. 보류 사유는 필수입니다."
            placeholder="보류 사유 (필수)"
            required
            busy={busy}
            onCancel={() => setHoldModalOpen(false)}
            onConfirm={handleHold}
          />
        )}
        {carryoverModalOpen && data && (
          <CarryoverModal
            row={{
              id: data.settlement.id,
              artist_user_id: data.settlement.artist_user_id,
              artist_nickname: data.artist.nickname ?? '',
              artist_email: data.artist.email ?? '',
              settlement_month: data.settlement.settlement_month,
              status: data.settlement.status,
              final_payout_amount: data.settlement.final_payout_amount,
              total_settlement_amount: data.settlement.total_settlement_amount,
              // X6.27: held 케이스 안내 메시지 + 기존 보류 사유 노출
              held_reason: data.settlement.held_reason ?? null,
            } as Parameters<typeof CarryoverModal>[0]['row']}
            onClose={() => setCarryoverModalOpen(false)}
            onApplied={() => {
              setCarryoverModalOpen(false);
              void load();
              onChanged?.();
            }}
          />
        )}
      </div>
    </div>
  );
}

function PiiRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-line/10 py-1 last:border-b-0">
      <span className="shrink-0 text-ink-mute">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function PayoutStatusBadge({
  status,
}: {
  status: 'ready' | 'verified_partial' | 'pending';
}) {
  const meta: Record<typeof status, { tone: string; label: string }> = {
    ready: {
      tone: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
      label: '정산 가능 (PII 완료)',
    },
    verified_partial: {
      tone: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
      label: 'PII 미완료',
    },
    pending: {
      tone: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-500/15 dark:text-yellow-200',
      label: '심사 대기',
    },
  };
  const m = meta[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${m.tone}`}>
      {m.label}
    </span>
  );
}

function Row({
  label,
  value,
  muted,
  bold,
  accent,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
  accent?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${bold ? 'font-bold' : ''}`}>
      <span className={muted ? 'text-ink-mute' : ''}>{label}</span>
      <span className={`tabular-nums ${accent ? 'text-accent' : ''}`}>{value}</span>
    </div>
  );
}

function ConfirmModal({
  title,
  tone,
  warning,
  placeholder,
  required,
  busy,
  onCancel,
  onConfirm,
  showForcePiiToggle,
}: {
  title: string;
  tone: 'success' | 'warning';
  warning: string;
  placeholder: string;
  required?: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (text: string, forcePii?: boolean) => void;
  // X6.29: 지급완료 처리 시 held + pii_incomplete 케이스에서 강제 override 토글 노출
  showForcePiiToggle?: boolean;
}) {
  const [text, setText] = useState('');
  const [forcePii, setForcePii] = useState(false);
  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-3 sm:items-center"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-2xl bg-bg-soft p-5 ring-1 ring-line/15"
      >
        <h4 className="flex items-center gap-2 text-sm font-bold">
          <AlertTriangle size={14} className={tone === 'success' ? 'text-emerald-500' : 'text-amber-500'} />
          {title}
        </h4>
        <Alert tone={tone}>{warning}</Alert>
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="input"
          placeholder={placeholder}
        />
        {showForcePiiToggle && (
          <label className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-xs ring-1 ring-red-500/30">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={forcePii}
              onChange={(e) => setForcePii(e.target.checked)}
            />
            <span className="text-ink">
              <strong className="text-red-700 dark:text-red-300">PII 미완료 override</strong> — 본인 인증 / 정산 계좌 정보가
              완료되지 않은 정산을 강제로 지급완료 처리합니다. (audit 기록됨)
            </span>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="btn-ghost px-3 py-2 text-xs">취소</button>
          <button
            onClick={() => onConfirm(text, forcePii)}
            disabled={busy || (required && !text.trim())}
            className={`rounded-lg px-4 py-2 text-xs font-bold text-white disabled:opacity-50 ${
              tone === 'success' ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-amber-500 hover:bg-amber-600'
            }`}
          >
            {busy ? '처리 중…' : '확정'}
          </button>
        </div>
      </div>
    </div>
  );
}
