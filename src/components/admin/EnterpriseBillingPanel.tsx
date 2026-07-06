/**
 * EnterpriseBillingPanel — Priority 6 (Enterprise Billing Management V1).
 *
 * "본사 → 우리" 청구/인보이스 관리 (incoming).
 * "우리 → 본사" 지급 (EnterpriseMonthlySettlementsPanel) 와 완전 분리.
 *
 * SQL: supabase/migrations/0382_enterprise_billing_invoices_v1.sql
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Plus, AlertCircle, CreditCard, FileText, CheckCircle2, Clock,
  XCircle, Calendar, History, Edit3, Send, AlertTriangle,
} from 'lucide-react';
import {
  AdminSection, AdminStatCard, AdminSearch, AdminBadge, AdminButton,
  AdminModal, AdminAlert, AdminEmpty, AdminSkeleton, AdminTooltip,
  type AdminToneName,
} from '@/components/admin/ui';
import {
  listBillingInvoices, getBillingInvoiceDetail, generateBillingInvoice,
  issueBillingInvoice, markBillingInvoicePaid, cancelBillingInvoice,
  markBillingInvoicesOverdue, updateBillingInvoiceAdjustments,
  type BillingInvoice, type BillingInvoiceDetail, type BillingInvoiceStatus,
} from '@/lib/api/enterpriseBillingApi';
import { adminListEnterpriseAccounts, type EnterpriseAccount } from '@/lib/api/enterpriseAccountsApi';

const PAGE_SIZE = 50;

const STATUS_META: Record<BillingInvoiceStatus, { ko: string; tone: AdminToneName }> = {
  draft:     { ko: '초안',     tone: 'neutral' },
  issued:    { ko: '발행 완료', tone: 'info'    },
  paid:      { ko: '입금 완료', tone: 'success' },
  overdue:   { ko: '미납',     tone: 'danger'  },
  cancelled: { ko: '취소',     tone: 'neutral' },
  failed:    { ko: '실패',     tone: 'danger'  },
};

const fmtKRW = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const fmtMonth = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit' }) : '—';
const fmtDate  = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) : '—';
const fmtDt    = (d: string | null | undefined) => d ? new Date(d).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export default function EnterpriseBillingPanel() {
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<BillingInvoiceStatus | ''>('');
  const [monthFilter, setMonthFilter] = useState('');
  const [enterpriseFilter, setEnterpriseFilter] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [offset, setOffset] = useState(0);

  // sources
  const [enterprises, setEnterprises] = useState<EnterpriseAccount[]>([]);

  // modals
  const [showGenerate, setShowGenerate] = useState(false);
  const [detail, setDetail] = useState<BillingInvoiceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [toast, setToast] = useState<{ tone: 'success'|'warning'|'danger'|'info'; title: string; body?: string } | null>(null);

  const monthIsoFirst = (s: string): string => {
    if (!s) return '';
    const d = new Date(s);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
  };

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const r = await listBillingInvoices({
        search: search.trim() || null,
        status: statusFilter || null,
        billingMonth: monthFilter ? monthIsoFirst(monthFilter) : null,
        enterpriseAccountId: enterpriseFilter || null,
        overdueOnly,
        limit: PAGE_SIZE, offset,
      });
      setInvoices(r.data);
      setTotal(r.pagination.total);
    } catch (e) { setError((e as Error).message); }
    finally { if (!silent) setLoading(false); }
  }, [search, statusFilter, monthFilter, enterpriseFilter, overdueOnly, offset]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void adminListEnterpriseAccounts({ limit: 200 }).then((r) => setEnterprises(r.data))
      .catch((e) => console.warn('[billing] enterprises load failed', e));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try { await load(true); } finally { setRefreshing(false); }
  }, [load]);

  const openDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try { setDetail(await getBillingInvoiceDetail(id)); }
    catch (e) { setDetailError((e as Error).message); }
    finally { setDetailLoading(false); }
  }, []);

  const closeDetail = () => { setDetail(null); setDetailError(null); };

  const onMarkOverdue = useCallback(async () => {
    if (!window.confirm('납부기한이 지난 발행 청구서를 미납 상태로 일괄 전환합니다. 진행하시겠습니까?')) return;
    setActionBusy(true);
    try {
      const r = await markBillingInvoicesOverdue();
      setToast({ tone: r.marked_count > 0 ? 'warning' : 'info',
        title: '미납 처리 완료', body: `${r.marked_count}건 미납 전환됨 (기준일 ${r.as_of})` });
      await load(true);
    } catch (e) { setToast({ tone: 'danger', title: '미납 처리 실패', body: (e as Error).message }); }
    finally { setActionBusy(false); }
  }, [load]);

  // KPI (이번 달 기준)
  const kpi = useMemo(() => {
    const totalAmount = invoices.reduce((s, x) => s + x.total_amount, 0);
    const issued = invoices.filter((x) => x.status === 'issued').length;
    const paid = invoices.filter((x) => x.status === 'paid').length;
    const overdue = invoices.filter((x) => x.status === 'overdue').length;
    const cancelled = invoices.filter((x) => x.status === 'cancelled').length;
    const draft = invoices.filter((x) => x.status === 'draft').length;
    const avgPerStore = (() => {
      const totalStores = invoices.reduce((s, x) => s + x.active_store_count, 0);
      return totalStores > 0 ? Math.round(totalAmount / totalStores) : 0;
    })();
    return { totalAmount, issued, paid, overdue, cancelled, draft, avgPerStore };
  }, [invoices]);

  return (
    <AdminSection
      title={<span className="flex items-center gap-2"><CreditCard size={16} /> 본사 청구 관리</span>}
      description="본사가 우리에게 지불하는 월 청구서/인보이스를 관리합니다. (지급 정산 화면과 별개)"
      badge={<AdminBadge tone="primary" variant="subtle">Priority 6 · V1</AdminBadge>}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton tone="neutral" variant="subtle" size="sm"
            leftIcon={<RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />}
            onClick={() => void refreshAll()} disabled={refreshing}>새로고침</AdminButton>
          <AdminButton tone="warning" variant="subtle" size="sm"
            leftIcon={<AlertTriangle size={12} />}
            loading={actionBusy}
            onClick={() => void onMarkOverdue()}>미납 일괄 전환</AdminButton>
          <AdminButton tone="primary" size="sm" leftIcon={<Plus size={12} />}
            onClick={() => setShowGenerate(true)}>청구서 생성</AdminButton>
        </div>
      }
    >
      {/* KPI */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <AdminStatCard label="조회 총 청구액" value={fmtKRW(kpi.totalAmount)} tone="neutral" icon={<FileText size={14} />} />
        <AdminStatCard label="발행 완료" value={kpi.issued} tone="info" icon={<Send size={14} />} />
        <AdminStatCard label="입금 완료" value={kpi.paid} tone="success" icon={<CheckCircle2 size={14} />} />
        <AdminStatCard label="미납" value={kpi.overdue} tone="danger" icon={<AlertCircle size={14} />} />
        <AdminStatCard label="취소" value={kpi.cancelled} tone="neutral" icon={<XCircle size={14} />} />
        <AdminStatCard label="평균 매장당 금액" value={fmtKRW(kpi.avgPerStore)} tone="primary" icon={<History size={14} />} />
      </div>

      {/* Filters */}
      <AdminSearch
        value={search} onChange={(v) => { setSearch(v); setOffset(0); }}
        placeholder="본사명 / 담당자 이메일 / 결제 참조 / 메모 검색"
        filters={
          <>
            <select value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as BillingInvoiceStatus | ''); setOffset(0); }}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 상태</option>
              {(Object.keys(STATUS_META) as BillingInvoiceStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_META[s].ko}</option>
              ))}
            </select>
            <select value={enterpriseFilter}
              onChange={(e) => { setEnterpriseFilter(e.target.value); setOffset(0); }}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 본사</option>
              {enterprises.map((e) => <option key={e.id} value={e.id}>{e.enterprise_name}</option>)}
            </select>
            <input type="month" value={monthFilter}
              onChange={(e) => { setMonthFilter(e.target.value); setOffset(0); }}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs" />
            <label className="inline-flex items-center gap-1 text-[11px] text-ink-mute">
              <input type="checkbox" checked={overdueOnly}
                onChange={(e) => { setOverdueOnly(e.target.checked); setOffset(0); }} />
              미납만
            </label>
          </>
        }
        trailing={<span className="text-[11px] text-ink-mute tabular-nums">{total.toLocaleString()}건</span>}
      />

      {error && (
        <AdminAlert tone="danger" title="조회 실패" description={error}
          action={<AdminButton tone="danger" variant="subtle" size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      )}

      {loading && invoices.length === 0 ? (
        <AdminSkeleton variant="table" rows={6} />
      ) : !loading && invoices.length === 0 && !error ? (
        <AdminEmpty icon={<FileText size={28} />} title="청구서가 없습니다." description="'청구서 생성' 버튼으로 시작하세요." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl bg-bg-card ring-1 ring-line/10 shadow-sm shadow-black/20">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
                  <th className="px-3 py-2">청구월</th>
                  <th className="px-3 py-2">본사 / 담당자</th>
                  <th className="px-3 py-2 text-right">활성 매장</th>
                  <th className="px-3 py-2 text-right">매장당</th>
                  <th className="px-3 py-2 text-right">공급가</th>
                  <th className="px-3 py-2 text-right">할인</th>
                  <th className="px-3 py-2 text-right">세액</th>
                  <th className="px-3 py-2 text-right">총 청구액</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2 text-right">납부기한</th>
                  <th className="px-3 py-2 text-right">발행/입금</th>
                  <th className="px-3 py-2">액션</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="cursor-pointer border-b border-line/5 hover:bg-bg-hover/30"
                    onClick={() => void openDetail(inv.id)}>
                    <td className="px-3 py-2 font-semibold text-ink">{fmtMonth(inv.billing_month)}</td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-ink">{inv.enterprise_name}</div>
                      {inv.manager_email && <div className="text-[10px] text-ink-mute">{inv.manager_email}</div>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{inv.active_store_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-mute">{fmtKRW(inv.monthly_store_price)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtKRW(inv.subtotal_amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-mute">{inv.discount_amount ? `−${fmtKRW(inv.discount_amount)}` : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-mute">{inv.tax_amount ? `+${fmtKRW(inv.tax_amount)}` : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-ink">{fmtKRW(inv.total_amount)}</td>
                    <td className="px-3 py-2"><AdminBadge tone={STATUS_META[inv.status].tone}>{STATUS_META[inv.status].ko}</AdminBadge></td>
                    <td className="px-3 py-2 text-right text-[10px] tabular-nums text-ink-mute">{fmtDate(inv.due_date)}</td>
                    <td className="px-3 py-2 text-right text-[10px] tabular-nums text-ink-mute">
                      {inv.paid_at ? fmtDt(inv.paid_at) : inv.issued_at ? fmtDt(inv.issued_at) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <AdminButton tone="primary" variant="ghost" size="sm"
                        onClick={(e) => { e.stopPropagation(); void openDetail(inv.id); }}>상세</AdminButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between rounded-xl bg-bg-card px-3 py-2 text-xs ring-1 ring-line/10">
              <AdminButton tone="neutral" variant="subtle" size="sm"
                disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>이전</AdminButton>
              <span className="text-ink-mute tabular-nums">{offset + 1} – {Math.min(offset + PAGE_SIZE, total)} / {total.toLocaleString()}</span>
              <AdminButton tone="neutral" variant="subtle" size="sm"
                disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>다음</AdminButton>
            </div>
          )}
        </>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-[110] max-w-sm">
          <AdminAlert tone={toast.tone} title={toast.title} description={toast.body} />
        </div>
      )}

      {showGenerate && (
        <GenerateInvoiceModal
          enterprises={enterprises}
          onClose={() => setShowGenerate(false)}
          onGenerated={async (msg) => {
            setShowGenerate(false);
            setToast({ tone: 'success', title: '청구서 생성 완료', body: msg });
            await load(true);
          }}
        />
      )}

      {(detail || detailLoading || detailError) && (
        <InvoiceDetailModal
          detail={detail}
          loading={detailLoading}
          error={detailError}
          onClose={closeDetail}
          onChanged={async () => {
            if (detail) await openDetail(detail.invoice.id);
            await load(true);
          }}
          onToast={(t) => setToast(t)}
        />
      )}
    </AdminSection>
  );
}

// =============================================================================
// GenerateInvoiceModal
// =============================================================================

function GenerateInvoiceModal({
  enterprises, onClose, onGenerated,
}: {
  enterprises: EnterpriseAccount[];
  onClose: () => void;
  onGenerated: (msg: string) => void | Promise<void>;
}) {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(defaultMonth);
  const [enterpriseId, setEnterpriseId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [taxRate, setTaxRate] = useState(0);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    if (!month) { setErr('청구월을 선택해 주세요.'); return; }
    setBusy(true);
    try {
      const billingMonth = `${month}-01`;
      const r = await generateBillingInvoice({
        billingMonth,
        enterpriseAccountId: enterpriseId || null,
        dueDate: dueDate || null,
        taxRate,
        overwrite,
      });
      await onGenerated(`생성 ${r.created_count} · 재생성 ${r.overwritten_count} · 건너뜀 ${r.skipped_count} · 총 ${fmtKRW(r.total_amount)}`);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <AdminModal open onClose={onClose} size="md"
      title={<span className="flex items-center gap-2"><Plus size={14} /> 청구서 생성</span>}
      footer={
        <>
          <AdminButton tone="neutral" variant="subtle" size="sm" onClick={onClose}>취소</AdminButton>
          <AdminButton tone="primary" size="sm" loading={busy} onClick={() => void onSubmit()}>생성</AdminButton>
        </>
      }>
      <div className="space-y-3 text-xs">
        <label className="block">
          <span className="text-ink-dim">청구월 *</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </label>
        <label className="block">
          <span className="text-ink-dim">본사 (선택)</span>
          <select value={enterpriseId} onChange={(e) => setEnterpriseId(e.target.value)}
            className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5">
            <option value="">전체 본사 (active + invited)</option>
            {enterprises.map((e) => <option key={e.id} value={e.id}>{e.enterprise_name}</option>)}
          </select>
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-ink-dim">납부기한 (선택)</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
              className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5" />
          </label>
          <label className="block">
            <span className="text-ink-dim">세율 % (V1 기본 0)</span>
            <input type="number" min={0} max={100} step={0.01} value={taxRate}
              onChange={(e) => setTaxRate(parseFloat(e.target.value || '0'))}
              className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5" />
          </label>
        </div>
        <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-mute">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          기존 draft 청구서가 있으면 재생성 (issued/paid/cancelled 는 건너뜀)
        </label>

        <AdminAlert tone="info" title="안내"
          description="활성 매장 수와 매장당 기준 금액(enterprise_settlement_profiles.monthly_store_price, default 4,900원) 으로 자동 계산됩니다. 생성 후 draft 상태에서 할인/세액 조정이 가능합니다." />

        {err && <AdminAlert tone="danger" title="생성 실패" description={err} />}
      </div>
    </AdminModal>
  );
}

// =============================================================================
// InvoiceDetailModal
// =============================================================================

function InvoiceDetailModal({
  detail, loading, error, onClose, onChanged, onToast,
}: {
  detail: BillingInvoiceDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onToast: (t: { tone: 'success'|'warning'|'danger'|'info'; title: string; body?: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [dueDate, setDueDate] = useState('');

  const inv = detail?.invoice;
  useEffect(() => { setDueDate(inv?.due_date ?? ''); }, [inv?.due_date]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      onToast({ tone: 'success', title: label });
      await onChanged();
    } catch (e) { onToast({ tone: 'danger', title: `${label} 실패`, body: (e as Error).message }); }
    finally { setBusy(false); }
  };

  const onIssue = () => inv && void run('발행 완료', async () => { await issueBillingInvoice(inv.id, dueDate || null); });
  const onCancel = () => inv && void run('취소 완료', async () => {
    const memo = window.prompt('취소 사유 (선택)') ?? null;
    await cancelBillingInvoice(inv.id, memo);
  });

  return (
    <AdminModal open onClose={onClose} size="xl"
      title={<span className="flex items-center gap-2"><FileText size={14} /> 청구서 상세 — {inv ? fmtMonth(inv.billing_month) : '...'}</span>}
      headerExtra={inv && <AdminBadge tone={STATUS_META[inv.status].tone}>{STATUS_META[inv.status].ko}</AdminBadge>}
      footer={
        inv ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {inv.status === 'draft' && (
              <>
                <AdminButton tone="neutral" variant="subtle" size="sm" leftIcon={<Edit3 size={11} />}
                  onClick={() => setShowAdjust(true)}>할인/세액 조정</AdminButton>
                <AdminButton tone="danger" variant="subtle" size="sm" leftIcon={<XCircle size={11} />}
                  loading={busy} onClick={onCancel}>취소</AdminButton>
                <AdminButton tone="info" size="sm" leftIcon={<Send size={11} />}
                  loading={busy} onClick={onIssue}>발행</AdminButton>
              </>
            )}
            {(inv.status === 'issued' || inv.status === 'overdue') && (
              <>
                <AdminButton tone="danger" variant="subtle" size="sm" leftIcon={<XCircle size={11} />}
                  loading={busy} onClick={onCancel}>취소</AdminButton>
                {inv.status === 'issued' && (
                  <AdminButton tone="warning" variant="subtle" size="sm" leftIcon={<AlertTriangle size={11} />}
                    loading={busy} onClick={() => void run('미납 처리', async () => {
                      await markBillingInvoicesOverdue();  // 전역 batch — 안전
                    })}>미납 처리 (전체)</AdminButton>
                )}
                <AdminButton tone="success" size="sm" leftIcon={<CheckCircle2 size={11} />}
                  loading={busy} onClick={() => setShowPay(true)}>입금 완료</AdminButton>
              </>
            )}
            <AdminButton tone="neutral" variant="ghost" size="sm" onClick={onClose}>닫기</AdminButton>
          </div>
        ) : <AdminButton tone="neutral" variant="ghost" size="sm" onClick={onClose}>닫기</AdminButton>
      }>
      {loading ? (
        <AdminSkeleton variant="block" rows={6} />
      ) : error ? (
        <AdminAlert tone="danger" title="상세 로드 실패" description={error} />
      ) : detail && inv ? (
        <div className="space-y-3 text-xs">
          {/* Summary */}
          <div className="grid gap-2 md:grid-cols-3">
            <KV label="본사" value={inv.enterprise_name ?? '—'} />
            <KV label="담당자" value={inv.manager_email ?? '—'} />
            <KV label="청구월" value={fmtMonth(inv.billing_month)} />
            <KV label="활성 매장" value={`${inv.active_store_count}개`} />
            <KV label="매장당 기준 금액" value={fmtKRW(inv.monthly_store_price)} />
            <KV label="공급가 (subtotal)" value={fmtKRW(inv.subtotal_amount)} />
            <KV label="할인" value={inv.discount_amount ? `−${fmtKRW(inv.discount_amount)}` : '—'} />
            <KV label="세액" value={inv.tax_amount ? `+${fmtKRW(inv.tax_amount)}` : '—'} />
            <KV label="총 청구액" value={fmtKRW(inv.total_amount)} highlight />
            <KV label="납부기한" value={inv.due_date ?? '—'} />
            <KV label="발행일" value={fmtDt(inv.issued_at)} />
            <KV label="입금일" value={fmtDt(inv.paid_at)} />
            {inv.payment_reference && <KV label="결제 참조" value={inv.payment_reference} />}
            {inv.payment_method && <KV label="결제 수단" value={inv.payment_method} />}
            {inv.memo && <KV label="메모" value={inv.memo} />}
          </div>

          {/* Items */}
          <div className="rounded-xl bg-bg-deep/40 ring-1 ring-line/10">
            <div className="border-b border-line/10 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-mute">
              청구 항목 ({detail.items.length})
            </div>
            {detail.items.length === 0 ? (
              <div className="px-3 py-6 text-center text-[11px] text-ink-mute">항목이 없습니다.</div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
                    <th className="px-3 py-2">유형</th>
                    <th className="px-3 py-2">항목</th>
                    <th className="px-3 py-2 text-right">단가</th>
                    <th className="px-3 py-2 text-right">수량</th>
                    <th className="px-3 py-2 text-right">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((it) => (
                    <tr key={it.id} className="border-b border-line/5">
                      <td className="px-3 py-2"><AdminBadge tone="neutral">{it.item_type}</AdminBadge></td>
                      <td className="px-3 py-2">
                        <div className="text-ink">{it.store_name ?? it.region_name ?? '—'}</div>
                        {it.memo && <div className="text-[10px] text-ink-mute">{it.memo}</div>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtKRW(it.unit_price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{it.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-ink">{fmtKRW(it.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {inv.status === 'draft' && (
            <div className="text-xs">
              <label className="block">
                <span className="text-ink-dim">발행 시 납부기한</span>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                  className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5" />
              </label>
            </div>
          )}

          {showAdjust && (
            <AdjustModal invoice={inv}
              onClose={() => setShowAdjust(false)}
              onSaved={async () => { setShowAdjust(false); await onChanged(); onToast({ tone: 'success', title: '조정 완료' }); }} />
          )}
          {showPay && (
            <PaymentModal invoice={inv}
              onClose={() => setShowPay(false)}
              onSaved={async () => { setShowPay(false); await onChanged(); onToast({ tone: 'success', title: '입금 완료 기록됨' }); }} />
          )}
        </div>
      ) : null}
    </AdminModal>
  );
}

function KV({ label, value, highlight = false }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-2 ring-1 ${highlight ? 'bg-violet-500/20 ring-violet-400/30' : 'bg-bg-deep/40 ring-line/10'}`}>
      <div className="text-[10px] uppercase tracking-wider text-ink-mute">{label}</div>
      <div className={`mt-0.5 truncate ${highlight ? 'text-base font-extrabold text-ink' : 'text-xs font-semibold text-ink'}`}>
        {value}
      </div>
    </div>
  );
}

// =============================================================================
// AdjustModal
// =============================================================================

function AdjustModal({ invoice, onClose, onSaved }: {
  invoice: BillingInvoice; onClose: () => void; onSaved: () => void | Promise<void>;
}) {
  const [discount, setDiscount] = useState(invoice.discount_amount);
  const [tax, setTax] = useState(invoice.tax_amount);
  const [memo, setMemo] = useState(invoice.memo ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const newTotal = Math.max(0, invoice.subtotal_amount - discount + tax);

  const onSubmit = async () => {
    setErr(null);
    if (discount < 0 || tax < 0) { setErr('값은 0 이상이어야 합니다.'); return; }
    setBusy(true);
    try {
      await updateBillingInvoiceAdjustments(invoice.id, { discountAmount: discount, taxAmount: tax, memo: memo || null });
      await onSaved();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <AdminModal open onClose={onClose} size="md"
      title="할인/세액 조정"
      footer={
        <>
          <AdminButton tone="neutral" variant="subtle" size="sm" onClick={onClose}>취소</AdminButton>
          <AdminButton tone="primary" size="sm" loading={busy} onClick={() => void onSubmit()}>저장</AdminButton>
        </>
      }>
      <div className="space-y-3 text-xs">
        <KV label="공급가" value={fmtKRW(invoice.subtotal_amount)} />
        <label className="block">
          <span className="text-ink-dim">할인 (원)</span>
          <input type="number" min={0} value={discount} onChange={(e) => setDiscount(parseInt(e.target.value || '0', 10))}
            className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </label>
        <label className="block">
          <span className="text-ink-dim">세액 (원)</span>
          <input type="number" min={0} value={tax} onChange={(e) => setTax(parseInt(e.target.value || '0', 10))}
            className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </label>
        <label className="block">
          <span className="text-ink-dim">메모 (선택)</span>
          <textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)}
            className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </label>
        <KV label="새 총 청구액" value={fmtKRW(newTotal)} highlight />
        {err && <AdminAlert tone="danger" title="저장 실패" description={err} />}
      </div>
    </AdminModal>
  );
}

// =============================================================================
// PaymentModal — 입금 완료 기록
// =============================================================================

function PaymentModal({ invoice, onClose, onSaved }: {
  invoice: BillingInvoice; onClose: () => void; onSaved: () => void | Promise<void>;
}) {
  const [reference, setReference] = useState(invoice.payment_reference ?? '');
  const [method, setMethod] = useState(invoice.payment_method ?? '');
  const today = new Date();
  const [paidAt, setPaidAt] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    setBusy(true);
    try {
      await markBillingInvoicePaid(invoice.id, {
        paymentReference: reference || null,
        paymentMethod: method || null,
        paidAt: paidAt ? new Date(paidAt + 'T00:00:00').toISOString() : null,
      });
      await onSaved();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <AdminModal open onClose={onClose} size="md"
      title="입금 완료 기록"
      footer={
        <>
          <AdminButton tone="neutral" variant="subtle" size="sm" onClick={onClose}>취소</AdminButton>
          <AdminButton tone="success" size="sm" loading={busy} onClick={() => void onSubmit()}>저장</AdminButton>
        </>
      }>
      <div className="space-y-3 text-xs">
        <KV label="청구액" value={fmtKRW(invoice.total_amount)} highlight />
        <label className="block">
          <span className="text-ink-dim">입금일</span>
          <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)}
            className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </label>
        <label className="block">
          <span className="text-ink-dim">결제 수단 (선택)</span>
          <input type="text" value={method} onChange={(e) => setMethod(e.target.value)}
            placeholder="예: 무통장입금 / 계좌이체 / 카드"
            className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </label>
        <label className="block">
          <span className="text-ink-dim">결제 참조 (선택)</span>
          <input type="text" value={reference} onChange={(e) => setReference(e.target.value)}
            placeholder="입금자명 / 트랜잭션 ID"
            className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </label>
        {err && <AdminAlert tone="danger" title="저장 실패" description={err} />}
      </div>
    </AdminModal>
  );
}

// Tooltip + Calendar referenced for future
void AdminTooltip; void Calendar; void Clock;
