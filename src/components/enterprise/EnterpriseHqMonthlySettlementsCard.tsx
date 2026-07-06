/**
 * EnterpriseHqMonthlySettlementsCard — Phase 1-11
 *
 * /enterprise/me 의 본사 월 정산 read-only 카드.
 * 최근 12개월 목록 + 클릭 시 매장별 근거 모달.
 *
 * API: src/lib/api/enterpriseMonthlySettlementApi.ts (get_my_*)
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Wallet, RefreshCw, AlertCircle, X, FileText, CheckCircle2, XCircle,
  Clock as ClockIcon, ThumbsUp, AlertTriangle, Coins, ArrowRight, CircleDot,
} from 'lucide-react';
import {
  getMyEnterpriseMonthlySettlements,
  getMyEnterpriseMonthlySettlementItems,
  formatSettlementMonth,
  SETTLEMENT_STATUS_LABEL,
  SETTLEMENT_RATE_SOURCE_LABEL,
  type HqEnterpriseMonthlySettlementRow,
  type HqEnterpriseMonthlySettlementDetail,
  type EnterpriseMonthlySettlementItem,
  type EnterpriseMonthlySettlementStatus,
  type CarryoverChainLink,
} from '@/lib/api/enterpriseMonthlySettlementApi';

export default function EnterpriseHqMonthlySettlementsCard() {
  const [rows, setRows] = useState<HqEnterpriseMonthlySettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getMyEnterpriseMonthlySettlements(12);
      setRows(r.rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold flex items-center gap-1.5">
          <Wallet size={14} /> 월 정산 내역
        </h3>
        <button onClick={() => void load()} disabled={loading}
          className="inline-flex items-center gap-1 rounded bg-bg-deep px-2 py-1 text-[11px] hover:bg-bg-hover disabled:opacity-50">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>
      <p className="mt-1 text-[11px] text-ink-mute">
        본사 단위 월 정산 스냅샷. 관리자가 생성/지급 처리합니다. (최근 12개월)
      </p>

      {error && (
        <div className="mt-2 rounded bg-rose-500/25 px-3 py-2 text-xs text-rose-300">
          <AlertCircle size={12} className="inline mr-1" />{error}
          <button onClick={() => void load()} className="ml-2 rounded bg-rose-500/30 px-2 py-0.5 font-bold">재시도</button>
        </div>
      )}

      {loading && rows.length === 0 && (
        <div className="mt-3 space-y-2">
          <div className="h-12 animate-pulse rounded bg-bg-deep" />
          <div className="h-12 animate-pulse rounded bg-bg-deep" />
        </div>
      )}

      {!loading && rows.length === 0 && !error && (
        <p className="mt-3 text-[11px] text-ink-mute">아직 생성된 월 정산이 없습니다.</p>
      )}

      {rows.length > 0 && (
        <ul className="mt-3 divide-y divide-line/10">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setDetailId(r.id)}
                className="flex w-full items-center gap-2 py-2 text-left text-xs hover:bg-bg-hover/40 rounded"
              >
                <div className="w-16 shrink-0 font-mono tabular-nums text-[11px]">
                  {formatSettlementMonth(r.settlement_month)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold tabular-nums">
                    {r.total_commission.toLocaleString('ko-KR')}원
                    {(r.previous_carryover ?? 0) > 0 && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-amber-500/25 px-1.5 py-0.5 text-[9px] font-bold text-slate-900 dark:text-amber-200">
                        <Coins size={8} /> 이월 +{(r.previous_carryover ?? 0).toLocaleString('ko-KR')}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-ink-mute">
                    활성 {r.active_store_count}개 × {r.per_store_commission.toLocaleString('ko-KR')}원
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {detailId && (
        <HqDetailModal settlementId={detailId} onClose={() => setDetailId(null)} />
      )}
    </section>
  );
}

// ----- 상세 모달 (read-only) -----
function HqDetailModal({
  settlementId, onClose,
}: { settlementId: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<HqEnterpriseMonthlySettlementDetail | null>(null);
  const [items, setItems] = useState<EnterpriseMonthlySettlementItem[]>([]);
  const [carryoverSource, setCarryoverSource] = useState<CarryoverChainLink | null>(null);
  const [carryoverChild, setCarryoverChild] = useState<CarryoverChainLink | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getMyEnterpriseMonthlySettlementItems(settlementId);
      setSettlement(r.settlement);
      setItems(r.items);
      setCarryoverSource(r.carryover_source ?? null);
      setCarryoverChild(r.carryover_child ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [settlementId]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <Wallet size={14} /> 월 정산 상세
          </h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-bg-hover"><X size={14} /></button>
        </div>

        {loading && !settlement && <div className="h-40 animate-pulse rounded bg-bg-deep" />}
        {error && (
          <div className="rounded bg-rose-500/25 px-3 py-2 text-xs text-rose-300">
            <AlertCircle size={12} className="inline mr-1" />{error}
          </div>
        )}

        {settlement && (
          <div className="space-y-3 text-xs">
            <div className="rounded-lg bg-bg-deep p-3">
              <div className="flex items-center justify-between">
                <div className="font-mono tabular-nums font-bold">
                  {formatSettlementMonth(settlement.settlement_month)}
                </div>
                <StatusBadge status={settlement.status} />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                <KV k="활성 매장" v={`${settlement.active_store_count.toLocaleString('ko-KR')}개`} />
                <KV k="단가" v={`${settlement.monthly_store_price.toLocaleString('ko-KR')}원`} />
                <KV k="수수료율" v={`${settlement.commission_rate}%`} />
                <KV k="매장당" v={`${settlement.per_store_commission.toLocaleString('ko-KR')}원`} />
                <KV k="총 정산금" v={`${settlement.total_commission.toLocaleString('ko-KR')}원`} highlight />
                {settlement.paid_at && <KV k="지급일" v={new Date(settlement.paid_at).toLocaleDateString('ko-KR')} />}
              </dl>
              {/* 0390 — 적용된 계약 스냅샷 (생성 시점 고정) */}
              {(settlement.rate_source || settlement.contract_no || settlement.settlement_method) && (
                <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px] border-t border-line/10 pt-2">
                  <KV k="적용 출처" v={settlement.rate_source ? SETTLEMENT_RATE_SOURCE_LABEL[settlement.rate_source] : '—'} />
                  <KV k="계약번호" v={settlement.contract_no ?? '—'} />
                  <KV k="정산방법" v={settlement.settlement_method ?? '—'} />
                </dl>
              )}
              {settlement.payment_reference && (
                <p className="mt-2 text-[10px] text-ink-dim">
                  지급 참조: <span className="font-mono">{settlement.payment_reference}</span>
                </p>
              )}
              {/* Phase 3-2 — Carryover chain (HQ read-only) */}
              <HqCarryoverChainCard
                settlement={settlement}
                source={carryoverSource}
                child={carryoverChild}
              />
            </div>

            <div className="rounded-lg bg-bg-deep p-3">
              <p className="text-[10px] uppercase tracking-wider text-ink-dim mb-2 flex items-center gap-1.5">
                <FileText size={11} /> 매장별 근거 ({items.length}개)
              </p>
              <ul className="divide-y divide-line/10">
                {items.map((it) => (
                  <li key={it.id} className="flex items-center gap-2 py-1.5 text-[11px]">
                    <ItemBadge status={it.status} />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{it.store_name ?? '(매장명 없음)'}</div>
                      <div className="text-[10px] text-ink-dim truncate">
                        {it.franchise_name}
                        {it.region_name && ` · ${it.region_name}`}
                        {it.reason && ` · ${it.reason}`}
                      </div>
                    </div>
                    <span className="shrink-0 tabular-nums">
                      {it.per_store_commission.toLocaleString('ko-KR')}원
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Phase 3-2 — HQ 용 이월(Carryover) chain 카드 (read-only, 친절한 copy).
 *
 * HQ 사용자가 궁금해할 세 가지에 답한다:
 *   1) 이번 달 정산금이 왜 이만큼인지 (이월된 금액 포함)
 *   2) 최소정산금을 언제 넘길 것으로 예상되는지
 *   3) 지금까지의 이월 흐름이 어떻게 이어져 왔는지
 */
function HqCarryoverChainCard({
  settlement,
  source,
  child,
}: {
  settlement: HqEnterpriseMonthlySettlementDetail;
  source: CarryoverChainLink | null;
  child: CarryoverChainLink | null;
}) {
  const prev = settlement.previous_carryover ?? 0;
  const total = settlement.total_commission ?? 0;
  const effective = total + prev;
  const min = settlement.minimum_payout ?? 0;
  const belowMinimum = min > 0 && effective < min && settlement.status !== 'paid';
  const gap = belowMinimum ? min - effective : 0;

  // 이월도 chain 도 없고 미달도 아니면 완전히 숨긴다 (노이즈 방지)
  if (!source && !child && prev === 0 && !belowMinimum) return null;

  return (
    <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/5 p-2.5">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-slate-900 dark:text-amber-200">
        <Coins size={11} /> 이월 정산 흐름
      </p>

      <dl className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <dt className="text-[10px] text-ink-dim">지난 달에서 이월</dt>
          <dd className="mt-0.5 font-mono tabular-nums">{prev.toLocaleString('ko-KR')}원</dd>
        </div>
        <div>
          <dt className="text-[10px] text-ink-dim">이번 달 정산금</dt>
          <dd className="mt-0.5 font-mono tabular-nums">{total.toLocaleString('ko-KR')}원</dd>
        </div>
        <div>
          <dt className="text-[10px] text-ink-dim">누적 정산금</dt>
          <dd className="mt-0.5 font-mono tabular-nums font-bold text-emerald-300">
            {effective.toLocaleString('ko-KR')}원
          </dd>
        </div>
      </dl>

      {belowMinimum && (
        <p className="mt-2 flex items-start gap-1.5 rounded bg-amber-500/25 px-2 py-1.5 text-[10px] text-slate-900 dark:text-amber-100">
          <AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-300" />
          <span>
            최소정산금 <span className="font-mono">{min.toLocaleString('ko-KR')}</span>원까지
            <span className="font-bold"> {gap.toLocaleString('ko-KR')}원 남음</span>.
            이번 달은 지급되지 않지만 이 금액은 <span className="font-bold">다음 달로 자동 이월</span>되어
            누적 정산금이 최소정산금을 넘는 달에 자동으로 지급됩니다.
          </span>
        </p>
      )}

      {!belowMinimum && prev > 0 && settlement.status !== 'paid' && (
        <p className="mt-2 flex items-start gap-1.5 rounded bg-emerald-500/25 px-2 py-1.5 text-[10px] text-slate-900 dark:text-emerald-200">
          <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-emerald-300" />
          <span>
            지난 달 이월분과 이번 달 정산금의 합계가 최소정산금을 넘어 지급 가능한 상태입니다.
          </span>
        </p>
      )}

      {(source || child) && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px]">
          <HqChainNode link={source} label="지난" />
          <ArrowRight size={10} className="shrink-0 text-amber-300" />
          <div className="rounded bg-amber-500/25 px-2 py-1 font-bold text-slate-900 dark:text-amber-100 ring-1 ring-amber-400/40">
            <div className="text-[9px] text-amber-300/80">현재</div>
            <div className="font-mono tabular-nums">
              {formatSettlementMonth(settlement.settlement_month)}
            </div>
          </div>
          <ArrowRight size={10} className="shrink-0 text-amber-300" />
          <HqChainNode link={child} label="다음" />
        </div>
      )}
    </div>
  );
}

function HqChainNode({ link, label }: { link: CarryoverChainLink | null; label: string }) {
  if (!link) {
    return (
      <div className="rounded border border-dashed border-ink-dim/30 bg-bg-deep/40 px-2 py-1 text-ink-dim">
        <div className="text-[9px]">{label}</div>
        <div className="text-[10px]">—</div>
      </div>
    );
  }
  const applied = link.carryover_applied;
  return (
    <div className={`rounded bg-bg-deep px-2 py-1 ring-1 ${
      applied ? 'ring-emerald-400/40 text-slate-900 dark:text-emerald-200' : 'ring-line/20 text-ink'
    }`}>
      <div className="flex items-center gap-1 text-[9px] text-ink-dim">
        <CircleDot size={7} /> {label}
      </div>
      <div className="font-mono tabular-nums">{formatSettlementMonth(link.settlement_month)}</div>
      {applied && <div className="text-[9px] text-emerald-300">✓지급 완료</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: EnterpriseMonthlySettlementStatus }) {
  const map = {
    pending:   { tone: 'bg-amber-500/25 text-amber-300',     icon: <ClockIcon size={10} /> },
    approved:  { tone: 'bg-sky-500/25 text-sky-300',         icon: <ThumbsUp size={10} /> },
    paid:      { tone: 'bg-emerald-500/25 text-emerald-300', icon: <CheckCircle2 size={10} /> },
    cancelled: { tone: 'bg-rose-500/25 text-rose-300',       icon: <XCircle size={10} /> },
  } as const;
  const v = map[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${v.tone}`}>
      {v.icon} {SETTLEMENT_STATUS_LABEL[status]}
    </span>
  );
}

function ItemBadge({ status }: { status: 'included' | 'excluded' }) {
  return status === 'included'
    ? <span className="inline-flex items-center gap-1 rounded bg-emerald-500/25 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
        <CheckCircle2 size={9} /> 포함
      </span>
    : <span className="inline-flex items-center gap-1 rounded bg-ink/10 px-1.5 py-0.5 text-[10px] font-bold text-ink-mute">
        <AlertTriangle size={9} /> 제외
      </span>;
}

function KV({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] text-ink-dim">{k}</dt>
      <dd className={`text-[11px] ${highlight ? 'font-bold text-emerald-300' : ''}`}>{v}</dd>
    </div>
  );
}
