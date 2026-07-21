/**
 * SettlementParts.tsx — SETTLEMENT-UX-2C 정산 Command Center 표시 컴포넌트.
 * 모두 SettlementDisplayModel 기반(컴포넌트 내부 계산식 없음). 순수 표시.
 */
import { CheckCircle2, PauseCircle, ArrowRightCircle, AlertTriangle, Wallet, Info } from 'lucide-react';
import {
  type SettlementDisplayModel,
  humanizeHoldReason,
  humanizeTaxType,
  requiredActionLabel,
} from '@/lib/settlementDisplayModel';

function won(n: number | null | undefined): string {
  return `₩${(n ?? 0).toLocaleString()}`;
}

// ── 상태 Badge (색상 + 아이콘 + 텍스트) ──
export function StatusBadge({ model }: { model: SettlementDisplayModel }) {
  const map: Record<string, { tone: string; icon: React.ReactNode }> = {
    paid: { tone: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/25 dark:text-emerald-200', icon: <CheckCircle2 size={11} /> },
    payable: { tone: 'bg-sky-100 text-sky-900 dark:bg-sky-500/25 dark:text-sky-200', icon: <Wallet size={11} /> },
    held: { tone: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-500/25 dark:text-yellow-200', icon: <PauseCircle size={11} /> },
    manual_carryover: { tone: 'bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-200', icon: <ArrowRightCircle size={11} /> },
    auto_carryover: { tone: 'bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-200', icon: <ArrowRightCircle size={11} /> },
    zero: { tone: 'bg-ink/10 text-ink-dim', icon: <AlertTriangle size={11} /> },
  };
  const m = map[model.displayAmountKind] ?? map.zero;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.tone}`}>
      {m.icon}
      {model.statusLabel}
    </span>
  );
}

// ── 필요 조치 Badge ──
export function RequiredActionBadge({ model }: { model: SettlementDisplayModel }) {
  if (model.requiredAction === 'none') return <span className="text-[10px] text-ink-dim">없음</span>;
  const tone =
    model.requiredAction === 'pay'
      ? 'bg-sky-100 text-sky-900 dark:bg-sky-500/25 dark:text-sky-200'
      : 'bg-rose-100 text-rose-900 dark:bg-rose-500/25 dark:text-rose-200';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`}>
      {requiredActionLabel(model.requiredAction)}
    </span>
  );
}

function Line({ label, value, op, strong, muted, accent }: {
  label: string; value: string; op?: '+' | '-' | '='; strong?: boolean; muted?: boolean; accent?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${strong ? 'font-bold' : ''}`}>
      <span className={muted ? 'text-ink-mute' : ''}>
        {op && <span className="mr-1 inline-block w-3 text-center text-ink-dim">{op}</span>}
        {label}
      </span>
      <span className={`tabular-nums ${accent ? 'text-accent' : ''}`}>{value}</span>
    </div>
  );
}

// ── B. 계산 흐름 + C. 현재 금융 상태 ──
export function FinancialStatus({ model }: { model: SettlementDisplayModel }) {
  return (
    <div className="space-y-4">
      <section aria-label="계산 흐름">
        <h5 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-mute">계산 흐름</h5>
        <div className="space-y-1 rounded-xl bg-bg-card p-3 text-sm ring-1 ring-line/10">
          <Line label="총 발생액" value={won(model.currentGrossAmount)} />
          <Line op="-" label="회사 수수료" value={won(model.companyFeeAmount)} muted />
          <Line op="-" label="영업 수수료" value={won(model.salesAgentFeeAmount)} muted />
          <Line op="=" label="당월 순정산액" value={won(model.currentNetAmount)} strong />
          <Line op="+" label="이전 미과세 이월" value={won(model.previousUntaxedCarryoverAmount)} />
          <Line op="=" label="과세 대상액" value={won(model.taxableBaseAmount)} strong />
          <Line op="-" label="원천징수액" value={won(model.withholdingTaxAmount)} muted />
          <Line op="+" label="이전 기과세 이월" value={won(model.previousTaxedCarryoverAmount)} />
          <Line op="=" label="계산된 최종 금액" value={won(model.calculatedFinalPayoutAmount)} strong accent />
        </div>
      </section>

      <section aria-label="현재 금융 상태">
        <h5 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-mute">현재 금융 상태</h5>
        <div className="space-y-1 rounded-xl bg-bg-card p-3 text-sm ring-1 ring-line/10">
          <Line label="계산된 최종 금액" value={won(model.calculatedFinalPayoutAmount)} muted />
          <Line label="현재 지급 가능액" value={won(model.effectivePayableAmount)} strong accent />
          <Line label="지급 완료액" value={won(model.effectivePaidAmount)} />
          <Line label="잔여 미지급액" value={won(model.effectiveRemainingAmount)} />
          <Line label="다음 달 이월액" value={won(model.effectiveNextCarryoverAmount)} strong />
          <p className="pt-1 text-[10px] leading-relaxed text-ink-dim">
            ※ ‘계산된 최종 금액’은 정산 생성 당시 계산된 참고 금액입니다. 현재 상태에 따라 지급 가능액 또는 이월액과 다를 수 있습니다.
          </p>
        </div>
      </section>
    </div>
  );
}

// ── D. 이월 상세 (Tooltip) ──
export function CarryoverDetail({ model }: { model: SettlementDisplayModel }) {
  const untaxedTip = '미과세 이월: 아직 원천징수되지 않아 다음 지급 시 과세되는 금액';
  const taxedTip = '기과세 이월: 이미 원천징수가 적용되어 다시 과세되지 않는 금액';
  return (
    <section aria-label="이월 상세">
      <h5 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-mute">이월 상세</h5>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <CarryCell tip={untaxedTip} label="이전 미과세 이월" value={won(model.previousUntaxedCarryoverAmount)} />
        <CarryCell tip={taxedTip} label="이전 기과세 이월" value={won(model.previousTaxedCarryoverAmount)} />
        <CarryCell tip={untaxedTip} label="다음 미과세 이월" value={won(model.nextUntaxedCarryoverAmount)} />
        <CarryCell tip={taxedTip} label="다음 기과세 이월" value={won(model.nextTaxedCarryoverAmount)} />
      </div>
    </section>
  );
}

function CarryCell({ label, value, tip }: { label: string; value: string; tip: string }) {
  return (
    <div className="rounded-xl bg-bg-card px-3 py-2 ring-1 ring-line/10">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-dim">
        {label}
        <button type="button" className="text-ink-dim hover:text-ink" aria-label={tip} title={tip}>
          <Info size={10} />
        </button>
      </p>
      <p className="mt-0.5 tabular-nums text-sm">{value}</p>
    </div>
  );
}

// ── E. 정책 Snapshot ──
export interface PolicySnapshotData {
  poolRevenueRatio?: number | null;
  companyFeeRatio?: number | null;
  createdAt?: string | null;
}
export function PolicySnapshot({ model, policy }: { model: SettlementDisplayModel; policy?: PolicySnapshotData }) {
  return (
    <section aria-label="정책 Snapshot">
      <h5 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-mute">정책 Snapshot</h5>
      <div className="space-y-1 rounded-xl bg-bg-card p-3 text-xs ring-1 ring-line/10">
        <Line label="최소 지급 기준" value={model.minimumPayoutAmount != null ? won(model.minimumPayoutAmount) : '—'} />
        <Line label="원천징수 유형/세율" value={humanizeTaxType(model.taxType, model.taxRate)} />
        {policy?.poolRevenueRatio != null && <Line label="정산 풀 비율" value={`${Math.round(policy.poolRevenueRatio * 100)}%`} />}
        {policy?.companyFeeRatio != null && <Line label="회사 수수료율" value={`${Math.round(policy.companyFeeRatio * 100)}%`} />}
        {policy?.createdAt && <Line label="정산 생성 시각" value={new Date(policy.createdAt).toLocaleString('ko-KR')} />}
        <p className="pt-1 text-[10px] text-ink-dim">※ 현재 정책이 아니라 이 정산이 생성될 당시 적용된 기준입니다.</p>
      </div>
    </section>
  );
}

// ── 보류 사유 Panel ──
const ADMIN_HOLD_DETAIL: Record<string, string> = {
  pii_incomplete: '정산정보 입력이 완료되지 않았습니다. 회원의 주민등록번호 또는 정산 동의 상태를 확인하세요.',
  account_missing: '지급 계좌가 등록되지 않았습니다.',
  account_unverified: '지급 계좌 확인이 완료되지 않았습니다.',
  tax_type_unknown: '원천징수 유형 설정이 필요합니다.',
  minimum_not_met: '최소 지급 기준 미달로 다음 달에 자동 합산됩니다.',
  admin_hold: '관리자 검토로 지급이 보류된 상태입니다.',
};
export function HoldPanel({ model }: { model: SettlementDisplayModel }) {
  if (!model.isHeld || !model.holdReason) return null;
  const detail = ADMIN_HOLD_DETAIL[model.holdReason] ?? humanizeHoldReason(model.holdReason) ?? model.holdReason;
  return (
    <div role="alert" className="rounded-xl bg-yellow-500/10 px-3 py-2.5 text-xs ring-1 ring-yellow-500/40">
      <p className="flex items-center gap-1.5 font-bold text-yellow-800 dark:text-yellow-200">
        <PauseCircle size={13} /> 지급 보류 — {model.statusLabel}
      </p>
      <p className="mt-1 text-ink">{detail}</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-[10px] text-ink-dim">개발자 상세</summary>
        <code className="text-[10px] text-ink-dim">held_reason={model.holdReason}</code>
      </details>
    </div>
  );
}

// ── Audit Timeline ──
export interface AuditEvent {
  id: string | number;
  action: string;
  created_at: string;
  actor?: string | null;
  reason?: string | null;
  amount?: number | null;
  from_month?: string | null;
  to_month?: string | null;
  detail?: Record<string, unknown> | null;
}
const ACTION_LABEL: Record<string, string> = {
  settlement_generated: '정산 생성',
  auto_carryover_created: '자동 이월',
  auto_carryover_consumed: '자동 이월 소비',
  admin_manual_carryover: '관리자 수동 이월',
  manual_carryover: '이월 처리',
  finalize: '정산 확정',
  mark_paid: '지급 완료',
  adjustment_applied: '조정 반영',
  mark_held: '보류 처리',
};
export function AuditTimeline({ events }: { events: AuditEvent[] }) {
  if (!events || events.length === 0) {
    return <p className="text-xs text-ink-dim">기록된 정산 변경 이력이 없습니다.</p>;
  }
  return (
    <ol className="space-y-2" aria-label="정산 변경 이력">
      {events.map((e) => (
        <li key={e.id} className="rounded-xl bg-bg-card px-3 py-2 text-xs ring-1 ring-line/10">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{ACTION_LABEL[e.action] ?? e.action}</span>
            <span className="text-[10px] text-ink-dim">{new Date(e.created_at).toLocaleString('ko-KR')}</span>
          </div>
          {e.amount != null && (
            <p className="text-ink-mute">
              금액 {won(e.amount)}
              {e.from_month && e.to_month ? ` · ${e.from_month.slice(0, 7)} → ${e.to_month.slice(0, 7)}` : ''}
            </p>
          )}
          {e.reason && <p className="text-ink">사유: {e.reason}</p>}
          {e.detail && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[10px] text-ink-dim">Raw snapshot</summary>
              <pre className="overflow-x-auto text-[10px] text-ink-dim">{JSON.stringify(e.detail, null, 2)}</pre>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}
