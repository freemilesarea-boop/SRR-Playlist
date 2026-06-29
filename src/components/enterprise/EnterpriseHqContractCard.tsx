/**
 * EnterpriseHqContractCard — Phase 4-12 (HQ read-only 계약 정보).
 * /enterprise/me 에 마운트. 자기 본사 활성 계약만 표시 (RLS + get_my_enterprise_contract).
 */
import { useEffect, useState } from 'react';
import { FileSignature, AlertCircle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import {
  getMyEnterpriseContract, type HqContractSummary, type ContractStatus,
} from '@/lib/api/enterpriseContractApi';

const STATUS_KO: Record<ContractStatus, { ko: string; cls: string; icon: React.ReactNode }> = {
  draft:      { ko: '준비 중',  cls: 'bg-zinc-500/20 text-zinc-200 ring-zinc-400/40',     icon: <Clock size={10} /> },
  active:     { ko: 'ACTIVE',   cls: 'bg-emerald-500/20 text-emerald-200 ring-emerald-400/40', icon: <CheckCircle2 size={10} /> },
  expiring:   { ko: 'EXPIRING', cls: 'bg-amber-500/20 text-amber-200 ring-amber-400/40',  icon: <Clock size={10} /> },
  expired:    { ko: 'EXPIRED',  cls: 'bg-rose-500/20 text-rose-200 ring-rose-400/40',     icon: <AlertCircle size={10} /> },
  terminated: { ko: '해지',     cls: 'bg-zinc-500/20 text-zinc-300 ring-zinc-400/40',     icon: <XCircle size={10} /> },
};

const fmtKRW = (n: number | null | undefined) => n == null ? '—' : `${n.toLocaleString('ko-KR')}원`;
const fmtPct = (n: number | null | undefined) => n == null ? '—' : `${n}%`;
const fmtDate = (s: string | null | undefined) => s ? new Date(s).toLocaleDateString('ko-KR') : '—';
const METHOD_KO: Record<string, string> = { monthly: '월별', weekly: '주별', manual: '수동' };

export default function EnterpriseHqContractCard() {
  const [data, setData] = useState<HqContractSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getMyEnterpriseContract()
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10 shadow-sm shadow-black/20">
      <h3 className="text-sm font-bold flex items-center gap-1.5">
        <FileSignature size={14} /> 계약 정보
        <span className="text-[10px] font-normal text-ink-dim">(현재 활성 계약, read-only)</span>
      </h3>

      {loading ? (
        <div className="mt-3 h-32 animate-pulse rounded-xl bg-bg-deep" />
      ) : error ? (
        <div className="mt-3 rounded bg-rose-500/20 px-3 py-2 text-[11px] text-rose-200">
          <AlertCircle size={11} className="inline mr-1" /> {error}
        </div>
      ) : !data ? null : data.active_contract ? (
        <>
          {/* 활성 계약 */}
          <div className="mt-3 rounded-xl bg-bg-deep/40 p-3 ring-1 ring-line/10 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-base font-extrabold text-ink truncate">{data.active_contract.contract_name}</div>
                <div className="text-[10px] font-mono text-ink-mute">{data.active_contract.contract_no}</div>
              </div>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${
                STATUS_KO[data.active_contract.computed_status].cls
              }`}>
                {STATUS_KO[data.active_contract.computed_status].icon}
                {STATUS_KO[data.active_contract.computed_status].ko}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-3">
              <KV label="계약 기간" value={`${fmtDate(data.active_contract.start_date)} ~ ${fmtDate(data.active_contract.end_date)}`} />
              <KV label="자동연장" value={data.active_contract.auto_renew ? `ON · ${data.active_contract.renewal_period_month}개월` : 'OFF'} />
              <KV label="매장당 기준 금액" value={fmtKRW(data.active_contract.monthly_store_price)} />
              <KV label="수수료율" value={fmtPct(data.active_contract.commission_rate)} />
              <KV label="최소 정산금" value={fmtKRW(data.active_contract.minimum_payout)} />
              <KV label="정산 방법" value={data.active_contract.settlement_method ? METHOD_KO[data.active_contract.settlement_method] : '—'} />
            </div>

            {data.active_contract.days_to_end != null && data.active_contract.days_to_end <= 30 && data.active_contract.days_to_end >= 0 && (
              <div className="rounded bg-amber-500/20 px-3 py-2 text-[11px] text-amber-200 ring-1 ring-amber-400/40">
                <Clock size={11} className="inline mr-1" />
                계약 종료까지 D-{data.active_contract.days_to_end}일 남았습니다.
              </div>
            )}
          </div>

          {/* 최근 5개 */}
          {data.recent_contracts.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-mute">최근 계약 내역</div>
              <ul className="space-y-1">
                {data.recent_contracts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between rounded bg-bg-deep/40 px-2 py-1.5 text-[11px]">
                    <div className="min-w-0">
                      <span className="font-semibold text-ink truncate">{c.contract_name}</span>
                      <span className="ml-2 text-[10px] font-mono text-ink-mute">{c.contract_no}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-ink-mute">
                      <span>{fmtDate(c.start_date)} ~ {fmtDate(c.end_date)}</span>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-bold ring-1 ${
                        STATUS_KO[c.status].cls
                      }`}>{STATUS_KO[c.status].ko}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <div className="mt-3 rounded bg-bg-deep/40 px-3 py-4 text-center text-[11px] text-ink-mute">
          현재 활성 계약이 없습니다. 관리자에게 문의해 주세요.
        </div>
      )}
    </section>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded bg-bg-deep/60 p-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-mute">{label}</div>
      <div className="mt-0.5 truncate text-xs font-semibold text-ink">{value}</div>
    </div>
  );
}
