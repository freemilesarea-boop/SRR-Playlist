/**
 * EnterpriseHqBillingCard — Priority 6 (HQ read-only 청구 현황).
 *
 * /enterprise/me 에 마운트. 자기 본사 청구서만 조회 (RLS + get_my_enterprise_billing_summary).
 * 수정/결제 처리 버튼 없음.
 */
import { useEffect, useState } from 'react';
import { CreditCard, Clock, CheckCircle2, AlertCircle, FileText } from 'lucide-react';
import {
  getMyEnterpriseBillingSummary,
  type BillingHqSummary, type BillingInvoiceStatus,
} from '@/lib/api/enterpriseBillingApi';

const STATUS_KO: Record<BillingInvoiceStatus, { ko: string; cls: string }> = {
  draft:     { ko: '준비 중',  cls: 'bg-zinc-500/20 text-zinc-200 ring-zinc-400/40' },
  issued:    { ko: '발행 완료', cls: 'bg-blue-500/20 text-slate-900 dark:text-blue-200 ring-blue-400/40' },
  paid:      { ko: '입금 완료', cls: 'bg-emerald-500/20 text-slate-900 dark:text-emerald-200 ring-emerald-400/40' },
  overdue:   { ko: '미납',     cls: 'bg-rose-500/20 text-slate-900 dark:text-rose-200 ring-rose-400/40' },
  cancelled: { ko: '취소',     cls: 'bg-zinc-500/20 text-slate-500 dark:text-zinc-300 ring-zinc-400/40' },
  failed:    { ko: '실패',     cls: 'bg-rose-500/20 text-slate-900 dark:text-rose-200 ring-rose-400/40' },
};

const fmtKRW = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const fmtMonth = (d: string) => new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit' });

export default function EnterpriseHqBillingCard() {
  const [data, setData] = useState<BillingHqSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getMyEnterpriseBillingSummary()
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10 shadow-sm shadow-black/20">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold flex items-center gap-1.5">
          <CreditCard size={14} /> 청구 현황
          <span className="text-[10px] font-normal text-ink-dim">(본사 → 플랫폼 청구)</span>
        </h3>
      </div>

      {loading ? (
        <div className="mt-3 h-24 animate-pulse rounded-xl bg-bg-deep" />
      ) : error ? (
        <div className="mt-3 rounded bg-rose-500/20 px-3 py-2 text-[11px] text-slate-900 dark:text-rose-200">
          <AlertCircle size={11} className="inline mr-1" /> {error}
        </div>
      ) : !data ? null : (
        <>
          {/* 이번 달 */}
          <div className="mt-3 rounded-xl bg-bg-deep/40 p-3 ring-1 ring-line/10">
            <div className="text-[10px] uppercase tracking-wider text-ink-mute">{fmtMonth(data.this_month)} 청구</div>
            {data.current_invoice ? (
              <>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <div className="text-2xl font-extrabold tabular-nums text-ink">
                    {fmtKRW(data.current_invoice.total_amount)}
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${
                    STATUS_KO[data.current_invoice.status].cls
                  }`}>
                    {data.current_invoice.status === 'paid' ? <CheckCircle2 size={10} />
                      : data.current_invoice.status === 'overdue' ? <AlertCircle size={10} />
                      : <Clock size={10} />}
                    {STATUS_KO[data.current_invoice.status].ko}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-ink-mute">
                  <span>활성 매장 {data.active_store_count.toLocaleString()}개 × {fmtKRW(data.monthly_store_price)}</span>
                  {data.current_invoice.due_date && (
                    <span>납부기한 {new Date(data.current_invoice.due_date).toLocaleDateString('ko-KR')}</span>
                  )}
                  {data.current_invoice.is_overdue && (
                    <span className="text-rose-300 font-bold">납부기한 초과</span>
                  )}
                </div>
              </>
            ) : (
              <div className="mt-1 text-xs text-ink-mute">
                이번 달 청구서가 아직 발행되지 않았습니다.
                <div className="mt-0.5 text-[10px] text-ink-dim">
                  활성 매장 {data.active_store_count.toLocaleString()}개 · 매장당 {fmtKRW(data.monthly_store_price)}
                </div>
              </div>
            )}
          </div>

          {/* 최근 6개월 */}
          {data.recent_invoices.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-mute flex items-center gap-1">
                <FileText size={10} /> 최근 6개월 청구 내역
              </div>
              <div className="overflow-x-auto rounded-lg bg-bg-deep/40 ring-1 ring-line/10">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
                      <th className="px-3 py-2">월</th>
                      <th className="px-3 py-2 text-right">매장</th>
                      <th className="px-3 py-2 text-right">총 청구액</th>
                      <th className="px-3 py-2">상태</th>
                      <th className="px-3 py-2 text-right">납부기한</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_invoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-line/5">
                        <td className="px-3 py-2 font-semibold">{fmtMonth(inv.billing_month)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{inv.active_store_count}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-ink">{fmtKRW(inv.total_amount)}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${
                            STATUS_KO[inv.status].cls
                          }`}>
                            {STATUS_KO[inv.status].ko}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-[10px] text-ink-mute">
                          {inv.due_date ? new Date(inv.due_date).toLocaleDateString('ko-KR') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="mt-2 text-[10px] text-ink-dim">
            ※ 청구서는 관리자가 발행/처리합니다. 수정 또는 결제는 별도 안내를 받으실 수 있습니다.
          </p>
        </>
      )}
    </section>
  );
}
