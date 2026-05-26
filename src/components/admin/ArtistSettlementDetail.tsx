import { useEffect, useState } from 'react';
import { X, Check, Pause, AlertTriangle, FileText } from 'lucide-react';
import {
  adminSettlementDetail,
  adminFinalizeSettlement,
  adminMarkSettlementPaid,
  adminMarkSettlementHeld,
  type SettlementItem,
  type SettlementStatus,
} from '@/lib/artistSettlementApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import RevealAccountButton from './RevealAccountButton';

function fmtKrw(n: number | null | undefined): string {
  return `₩${(n ?? 0).toLocaleString()}`;
}

interface DetailData {
  settlement: {
    id: string;
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
  };
  artist: { nickname: string | null; email: string | null; artist_name: string | null };
  policy: {
    pool_revenue_ratio: number;
    company_fee_ratio: number;
    withholding_tax_ratio: number;
    min_payout_amount: number;
    min_payout_basis: string;
  };
  items: SettlementItem[];
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

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = (await adminSettlementDetail(settlementId)) as unknown as DetailData;
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      toast.error(e instanceof Error ? e.message : 'Finalize 실패');
    } finally {
      setBusy(false);
    }
  }

  async function handlePay(memo: string) {
    if (!window.confirm('정산을 지급 완료로 처리합니다.\n처리 후에는 되돌릴 수 없습니다(immutable). 계속할까요?')) return;
    setBusy(true);
    try {
      await adminMarkSettlementPaid(settlementId, memo);
      toast.success('지급 완료 처리됨 — 이후 immutable');
      setPayModalOpen(false);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '지급 처리 실패');
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
      toast.error(e instanceof Error ? e.message : '보류 처리 실패');
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
              <h5 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-mute">지급 계좌 (snapshot)</h5>
              <div className="space-y-1.5 rounded-xl bg-bg-card px-3 py-2 text-xs ring-1 ring-line/10">
                {data.settlement.payout_bank_name ? (
                  <>
                    <p>
                      {data.settlement.payout_bank_name} · {data.settlement.payout_account_holder}
                    </p>
                    {data.settlement.payout_account_id ? (
                      <RevealAccountButton
                        accountId={data.settlement.payout_account_id}
                        maskedValue={data.settlement.masked_account_number}
                        settlementId={data.settlement.id}
                      />
                    ) : (
                      <p className="font-mono text-ink-mute">{data.settlement.masked_account_number}</p>
                    )}
                  </>
                ) : (
                  <p className="text-ink-dim">계좌 정보 없음</p>
                )}
              </div>
            </section>

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
              {data.settlement.status === 'payable' && (
                <>
                  <button
                    onClick={() => setPayModalOpen(true)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    <Check size={12} /> 지급 완료 처리
                  </button>
                  <button
                    onClick={() => setHoldModalOpen(true)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-50"
                  >
                    <Pause size={12} /> 보류
                  </button>
                </>
              )}
              {data.settlement.status === 'paid' && (
                <Alert tone="success">
                  지급 완료 — 이후 모든 수정 차단 (immutable). 오류 발견 시 별도 adjustment row 생성.
                </Alert>
              )}
            </section>
          </div>
        )}

        {payModalOpen && (
          <ConfirmModal
            title="지급 완료 처리"
            tone="success"
            warning="이후 모든 컬럼이 영구 immutable 됩니다. 실제 송금 완료 후에만 클릭하세요."
            placeholder="지급 메모 (선택) — 송금 참조번호 등"
            busy={busy}
            onCancel={() => setPayModalOpen(false)}
            onConfirm={handlePay}
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
      </div>
    </div>
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
}: {
  title: string;
  tone: 'success' | 'warning';
  warning: string;
  placeholder: string;
  required?: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (text: string) => void;
}) {
  const [text, setText] = useState('');
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
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="btn-ghost px-3 py-2 text-xs">취소</button>
          <button
            onClick={() => onConfirm(text)}
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
