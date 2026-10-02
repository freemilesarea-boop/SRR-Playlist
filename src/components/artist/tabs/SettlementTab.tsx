/**
 * 정산 탭 — 돈이 가장 먼저 읽히게.
 *
 * 맨 위에 '최근 확정 정산액' 을 큰 숫자로 둔다. 문의가 "정산 금액을 어디서 보냐" 였고,
 * 들어와서도 월별 카드만 쭉 있으면 여전히 눈이 헤맨다.
 *
 * 월별 내역은 /artist/settlements 와 같은 SettlementContent 를 쓴다(중복 구현 없음).
 * 정산 계좌 입력은 이 탭으로 옮겼다 — 개요에서 250줄짜리 폼이 자리를 차지하던 것을
 * 없애는 게 이번 개편의 목적 중 하나다.
 *
 * 금액은 전부 서버가 확정한 값이다. 여기서 더하거나 추정하지 않는다.
 */
import { Wallet } from 'lucide-react';
import type { MySettlementRow } from '@/lib/artistSettlementApi';
import type { PayoutAccount, PayoutAccountMasked, UploadEligibility,
  SettlementHoldStatus } from '@/lib/artistApi';
import SectionHeader from '@/components/ui/SectionHeader';
import SettlementContent from '@/components/artist/SettlementContent';
import { latestSettlement, payoutOrCarry, fmtKrw, fmtMonth, STATUS_LABEL, STATUS_TONE } from '@/components/artist/settlementDisplay';
import {
  SettlementHoldCard, PayoutAccountSection, VerifiedPayoutSummary,
} from '@/components/artist/dashboard/parts';

export default function SettlementTab({
  settlements, settlementsLoading, settlementsError,
  payout, payoutMasked, holdStatus, eligibility, loading, onPayoutSubmitted,
}: {
  settlements: MySettlementRow[];
  settlementsLoading: boolean;
  settlementsError: string | null;
  payout: PayoutAccount | null;
  payoutMasked: PayoutAccountMasked | null;
  holdStatus: SettlementHoldStatus | null;
  eligibility: UploadEligibility | null;
  loading: boolean;
  onPayoutSubmitted: () => void;
}) {
  const latest = latestSettlement(settlements);
  const headline = latest ? payoutOrCarry(latest) : null;
  const verified = payout?.verification_status === 'verified';

  return (
    <div className="space-y-5">
      {/* 큰 숫자 — 들어오자마자 보이는 것 */}
      <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10 sm:p-5">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-mute">
          <Wallet size={12} /> {headline?.label ?? '최근 확정 정산액'}
        </p>
        {settlementsLoading ? (
          <div className="mt-2 h-9 w-40 animate-pulse rounded bg-ink/10" />
        ) : (
          <p className="mt-1 text-3xl font-extrabold tracking-tight tabular-nums">
            {headline ? fmtKrw(headline.amount) : '—'}
          </p>
        )}
        {latest ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-mute">
            <span>{fmtMonth(latest.settlement_month)} 확정</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[latest.status]}`}>
              {STATUS_LABEL[latest.status]}
            </span>
            {latest.paid_at && <span>지급 {latest.paid_at.slice(0, 10)}</span>}
          </div>
        ) : (
          !settlementsLoading && (
            <p className="mt-1 text-[12px] text-ink-mute">
              매월 1회 정산서가 발행되면 표시됩니다. 보통 익월 15일 이내.
            </p>
          )
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">
          5만원 미만은 다음 달로 이월 · 지급 시 3.3% 원천징수
        </p>
      </section>

      {/* 보류는 돈을 못 받는 상태라 목록보다 위에 둔다 */}
      {holdStatus?.is_held && (
        <SettlementHoldCard status={holdStatus} eligibility={eligibility} payout={payout} />
      )}

      {/* 정산 계좌 */}
      <section className="space-y-3">
        <SectionHeader title="정산 계좌" desc="등록한 계좌와 세금 정보로 정산금이 지급됩니다." />
        {loading ? (
          <div className="h-24 animate-pulse rounded-2xl bg-bg-card" />
        ) : verified ? (
          <VerifiedPayoutSummary payout={payout} masked={payoutMasked} />
        ) : (
          <PayoutAccountSection payout={payout} masked={payoutMasked} onSubmitted={onPayoutSubmitted} />
        )}
      </section>

      {/* 월별 내역 — /artist/settlements 와 같은 컴포넌트 */}
      <section className="space-y-3">
        <SectionHeader title="월별 정산 내역" desc="카드를 누르면 트랙별 산출 내역을 볼 수 있어요." />
        <SettlementContent
          rows={settlements}
          loading={settlementsLoading}
          error={settlementsError}
        />
      </section>
    </div>
  );
}
