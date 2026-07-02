/**
 * EnterpriseSettlementCenterPanel — Phase 3-1
 *
 * `/admin → 정산·청구 통합` 탭.
 * 3-view: 계약 / 정산 / 청구·PDF·Email.
 *
 * 절대 무수정:
 *   • 기존 EnterpriseContractsPanel / EnterpriseMonthlySettlementsPanel / EnterpriseBillingPanel
 *     파일 무영향 — 이 panel 은 별도 read + Generate/PDF/Email 액션만 담당.
 *   • Settlement 계산식 (0372+0390) 무관 — Generate 는 기존 RPC 호출.
 *   • Contract/Billing status enum 무변경 — UI 매핑만.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Calendar, CheckCircle2, Download, FileText, Handshake,
  Mail, PlayCircle, RefreshCw, Send, Wallet,
} from 'lucide-react';
import {
  AdminSection, AdminCard, AdminStatCard, AdminBadge, AdminButton,
  AdminAlert, AdminEmpty, AdminSkeleton, AdminModal, AdminSearch,
} from '@/components/admin/ui';
import { supabase } from '@/lib/supabase';
import { toast } from '@/store/toastStore';
import {
  fetchBillingCenterKpi, fetchActiveContractPreview, generateEnterpriseSettlement,
  generateInvoicePdf, createBillingEmailJob, dispatchBillingInvoiceEmail,
  listBillingEmailJobs, setContractSuspended,
  toDisplayContractStatus, toDisplayBillingStatus,
  type BillingCenterKpi, type ContractDisplayStatus, type UnifiedBillingStatus,
  type SnapshotPreview, type EmailJobRow,
} from '@/lib/api/enterpriseSettlementCenterApi';
import {
  listEnterpriseContracts, type EnterpriseContract,
} from '@/lib/api/enterpriseContractApi';
import {
  listBillingInvoices, type BillingInvoice,
} from '@/lib/api/enterpriseBillingApi';
import {
  adminListEnterpriseAccounts, type EnterpriseAccount,
} from '@/lib/api/enterpriseAccountsApi';
import { currentMonthFirstDay } from '@/lib/api/enterpriseMonthlySettlementApi';

// ============================================================================
// Utils
// ============================================================================
function fmtMoney(n: number | null | undefined, currency = 'KRW'): string {
  if (n === null || n === undefined) return '—';
  const v = Math.round(n).toLocaleString('ko-KR');
  return currency === 'KRW' ? `₩${v}` : `${v} ${currency}`;
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try { return new Date(iso).toISOString().slice(0, 10); } catch { return '—'; }
}
function fmtMonth(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.slice(0, 7);
}

function contractPeriodLabel(start: string, end: string | null): string {
  if (!end) return `${start} ~ 무기한`;
  return `${start} ~ ${end}`;
}

function contractStatusTone(s: ContractDisplayStatus):
  'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (s) {
    case 'ACTIVE':     return 'success';
    case 'EXPIRED':    return 'warning';
    case 'PENDING':    return 'info';
    case 'SUSPENDED':  return 'warning';
    case 'TERMINATED': return 'danger';
    default:           return 'neutral';
  }
}
function billingStatusTone(s: UnifiedBillingStatus):
  'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (s) {
    case 'PAID':      return 'success';
    case 'SENT':      return 'info';
    case 'GENERATED': return 'info';
    case 'FAILED':    return 'danger';
    case 'DRAFT':     return 'neutral';
    default:          return 'neutral';
  }
}

/** best-effort audit log (실패해도 mutation 진행). */
async function audit(
  category: string, status: 'success' | 'failed',
  message: string, details: Record<string, unknown>, error?: string,
): Promise<void> {
  try {
    await supabase.rpc('admin_log_operation', {
      p_source: 'enterprise_operations',
      p_category: category,
      p_level: status === 'success' ? 'success' : 'error',
      p_status: status,
      p_message: message,
      p_details: details,
      ...(error ? { p_error_message: error } : {}),
    });
  } catch { /* silent */ }
}

// ============================================================================
// Main panel
// ============================================================================
type View = 'contracts' | 'settlements' | 'billing';

export default function EnterpriseSettlementCenterPanel() {
  const [view, setView] = useState<View>('billing');
  const [kpi, setKpi] = useState<BillingCenterKpi | null>(null);
  const [kpiErr, setKpiErr] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const loadKpi = useCallback(async () => {
    setKpiErr(null);
    try { setKpi(await fetchBillingCenterKpi()); }
    catch (e) { setKpiErr((e as Error).message); }
  }, []);

  useEffect(() => { void loadKpi(); }, [loadKpi, refreshTick]);

  return (
    <AdminSection
      title={
        <span className="flex items-center gap-2">
          <Wallet size={16} /> 정산·청구 통합 (Enterprise Settlement Center)
          <AdminBadge tone="primary" variant="subtle">Phase 3-1</AdminBadge>
        </span>
      }
      description={
        <span className="text-[11px] text-ink-mute">
          기존 계약 / 정산 / 청구 데이터를 하나의 화면에서. Snapshot 은 계약 스냅샷(0390)을 재사용.
        </span>
      }
      action={
        <div className="flex items-center gap-2">
          {(['billing', 'contracts', 'settlements'] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold ring-1 transition-colors ${
                view === v
                  ? 'bg-violet-500/25 text-violet-100 ring-violet-400/50'
                  : 'bg-bg-card text-ink-mute ring-line/20 hover:bg-bg-hover'
              }`}
            >
              {v === 'billing' ? '청구·PDF·Email' : v === 'contracts' ? '계약' : '정산'}
            </button>
          ))}
          <AdminButton size="sm" variant="subtle" tone="neutral" onClick={() => setRefreshTick((t) => t + 1)}>
            <RefreshCw size={12} /> 새로고침
          </AdminButton>
        </div>
      }
    >
      {kpiErr && <AdminAlert tone="danger" title="KPI 조회 실패">{kpiErr}</AdminAlert>}

      <BillingKpiCards kpi={kpi} />

      {view === 'contracts'   && <ContractsView tick={refreshTick} onChange={() => setRefreshTick((t) => t + 1)} />}
      {view === 'settlements' && <SettlementsView tick={refreshTick} onChange={() => setRefreshTick((t) => t + 1)} />}
      {view === 'billing'     && <BillingView    tick={refreshTick} onChange={() => setRefreshTick((t) => t + 1)} />}
    </AdminSection>
  );
}

// ============================================================================
// KPI cards — spec 3
// ============================================================================
function BillingKpiCards({ kpi }: { kpi: BillingCenterKpi | null }) {
  if (!kpi) return <AdminSkeleton variant="kpi" />;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <AdminStatCard label="이번달 청구 예정" value={kpi.this_month_expected_count} tone="info" icon={<Calendar size={14} />} />
      <AdminStatCard label="이번달 생성 완료" value={kpi.this_month_generated_count} tone="success" icon={<CheckCircle2 size={14} />} />
      <AdminStatCard label="미납" value={kpi.unpaid_count} tone={kpi.unpaid_count > 0 ? 'danger' : 'success'} icon={<AlertTriangle size={14} />} />
      <AdminStatCard label="완납" value={kpi.paid_count} tone="success" icon={<CheckCircle2 size={14} />} />
      <AdminStatCard label="다음 청구일" value={fmtDate(kpi.next_due_date)} tone="neutral" icon={<Calendar size={14} />} />
      <AdminStatCard label="총 Enterprise 수" value={kpi.enterprise_count} tone="primary" icon={<Handshake size={14} />} />
      <AdminStatCard label="총 계약금액 (월)" value={fmtMoney(kpi.total_contract_amount)} tone="primary" icon={<Wallet size={14} />} />
      <AdminStatCard label="예상 청구액 (이번달)" value={fmtMoney(kpi.expected_bill_amount)} tone="info" icon={<Wallet size={14} />} />
    </div>
  );
}

// ============================================================================
// Contracts view — spec 1, 2
// ============================================================================
function ContractsView({ tick, onChange }: { tick: number; onChange: () => void }) {
  const [rows, setRows] = useState<EnterpriseContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await listEnterpriseContracts({ search: search || null, limit: 100 });
      setRows(r.data ?? []);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { void load(); }, [load, tick]);

  const selected = useMemo(() => rows.find((r) => r.id === detailId) ?? null, [rows, detailId]);

  return (
    <>
      <AdminCard title="계약 목록 (16 필드)" subtitle={<span className="text-[10px] text-ink-mute">status → ACTIVE/EXPIRED/PENDING/SUSPENDED/TERMINATED UI 매핑</span>}>
        <div className="mb-2">
          <AdminSearch value={search} onChange={setSearch} placeholder="브랜드/계약번호 검색" />
        </div>
        {loading ? <AdminSkeleton variant="block" /> : err ? <AdminAlert tone="danger" title="계약 조회 실패">{err}</AdminAlert> : rows.length === 0 ? (
          <AdminEmpty title="계약 없음" description="검색 조건 변경 또는 등록 필요" />
        ) : (
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-bg text-[10px] uppercase text-ink-dim">
                <tr>
                  <th className="px-2 py-1 text-left">브랜드</th>
                  <th className="px-2 py-1 text-left">계약번호</th>
                  <th className="px-2 py-1 text-left">상태</th>
                  <th className="px-2 py-1 text-right">월 이용료</th>
                  <th className="px-2 py-1 text-right">단가</th>
                  <th className="px-2 py-1 text-right">수수료율</th>
                  <th className="px-2 py-1 text-left">기간</th>
                  <th className="px-2 py-1 text-left">정산방식</th>
                  <th className="px-2 py-1 text-left">자동갱신</th>
                  <th className="px-2 py-1 text-left">담당자</th>
                  <th className="px-2 py-1 text-left">수정일</th>
                  <th className="px-2 py-1 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const display = toDisplayContractStatus(r.status, (r as { metadata?: Record<string, unknown> }).metadata);
                  return (
                    <tr key={r.id} className="border-t border-line/10 hover:bg-bg-hover cursor-pointer" onClick={() => setDetailId(r.id)}>
                      <td className="px-2 py-1 truncate max-w-[140px]">{r.enterprise_name ?? '—'}</td>
                      <td className="px-2 py-1 font-mono text-ink-mute">{r.contract_no}</td>
                      <td className="px-2 py-1"><AdminBadge tone={contractStatusTone(display)} variant="subtle">{display}</AdminBadge></td>
                      <td className="px-2 py-1 text-right">{fmtMoney(r.monthly_store_price)}</td>
                      <td className="px-2 py-1 text-right">{fmtMoney(r.monthly_store_price)}</td>
                      <td className="px-2 py-1 text-right">{r.commission_rate ?? 0}%</td>
                      <td className="px-2 py-1 text-ink-mute">{contractPeriodLabel(r.start_date, r.end_date)}</td>
                      <td className="px-2 py-1">{r.settlement_method ?? 'monthly'}</td>
                      <td className="px-2 py-1">{r.auto_renew ? 'ON' : 'OFF'}</td>
                      <td className="px-2 py-1 truncate max-w-[140px]">{r.manager_email ?? '—'}</td>
                      <td className="px-2 py-1 text-ink-mute">{fmtDate(r.updated_at)}</td>
                      <td className="px-2 py-1 text-right">
                        <AdminButton size="sm" variant="subtle" tone="primary" onClick={(e) => { e.stopPropagation(); setDetailId(r.id); }}>
                          Snapshot
                        </AdminButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      {selected && (
        <ContractSnapshotModal
          contract={selected}
          onClose={() => setDetailId(null)}
          onSuspendedChanged={() => { onChange(); void load(); }}
        />
      )}
    </>
  );
}

// ============================================================================
// Contract Snapshot Card (Modal) — spec 2
// ============================================================================
function ContractSnapshotModal({
  contract, onClose, onSuspendedChanged,
}: { contract: EnterpriseContract; onClose: () => void; onSuspendedChanged: () => void }) {
  const meta = (contract as { metadata?: Record<string, unknown> }).metadata ?? {};
  const suspendedAt = meta.suspended_at as string | undefined;
  const suspendedReason = meta.suspended_reason as string | undefined;
  const [busy, setBusy] = useState(false);

  const toggleSuspended = useCallback(async (target: boolean) => {
    setBusy(true);
    try {
      const reason = target ? window.prompt('SUSPEND 사유 (선택)') ?? '' : '';
      const r = await setContractSuspended(contract.id, target, reason || undefined);
      await audit('contract.suspend', 'success',
        `admin toggled SUSPENDED=${target}`, { contract_id: contract.id, reason });
      toast.success(`Contract ${target ? 'SUSPENDED' : 'RESUMED'} — ${r.contract_id.slice(0, 8)}`);
      onSuspendedChanged();
      onClose();
    } catch (e) {
      const msg = (e as Error).message;
      await audit('contract.suspend', 'failed', 'SUSPEND toggle failed',
        { contract_id: contract.id }, msg);
      toast.error(`실패: ${msg}`);
    } finally { setBusy(false); }
  }, [contract.id, onClose, onSuspendedChanged]);

  return (
    <AdminModal
      open size="lg" onClose={onClose}
      title={<span className="flex items-center gap-2"><FileText size={14} /> Contract Snapshot — {contract.contract_no}</span>}
      headerExtra={<AdminBadge tone="primary" variant="subtle">Read-only</AdminBadge>}
      footer={
        <>
          {suspendedAt ? (
            <AdminButton size="md" tone="success" onClick={() => toggleSuspended(false)} disabled={busy}>
              SUSPENDED 해제
            </AdminButton>
          ) : (
            <AdminButton size="md" tone="warning" variant="subtle" onClick={() => toggleSuspended(true)} disabled={busy}>
              SUSPEND
            </AdminButton>
          )}
          <AdminButton size="md" variant="subtle" tone="neutral" onClick={onClose}>닫기</AdminButton>
        </>
      }
    >
      <div className="space-y-3 text-[12px]">
        <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/15">
          <p className="text-[10px] font-bold uppercase tracking-wider text-violet-200">계약 기본</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-ink-mute">브랜드</dt>       <dd className="text-ink font-medium">{contract.enterprise_name ?? '—'}</dd>
            <dt className="text-ink-mute">계약번호</dt>     <dd className="font-mono">{contract.contract_no}</dd>
            <dt className="text-ink-mute">계약명</dt>       <dd>{contract.contract_name}</dd>
            <dt className="text-ink-mute">생성일</dt>       <dd>{fmtDate(contract.created_at)}</dd>
            <dt className="text-ink-mute">수정일</dt>       <dd>{fmtDate(contract.updated_at)}</dd>
            <dt className="text-ink-mute">서명일</dt>       <dd>{fmtDate(contract.signed_at)}</dd>
          </dl>
        </div>
        <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/15">
          <p className="text-[10px] font-bold uppercase tracking-wider text-sky-200">기간/자동갱신</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-ink-mute">시작일</dt>       <dd>{fmtDate(contract.start_date)}</dd>
            <dt className="text-ink-mute">종료일</dt>       <dd>{fmtDate(contract.end_date)}</dd>
            <dt className="text-ink-mute">자동갱신</dt>     <dd>{contract.auto_renew ? 'ON' : 'OFF'}</dd>
            <dt className="text-ink-mute">갱신 주기</dt>    <dd>{contract.renewal_period_month}개월</dd>
          </dl>
        </div>
        <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/15">
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-200">정산 조건</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-ink-mute">정산방식</dt>     <dd>{contract.settlement_method ?? 'monthly'}</dd>
            <dt className="text-ink-mute">매장 단가</dt>    <dd>{fmtMoney(contract.monthly_store_price)}</dd>
            <dt className="text-ink-mute">수수료율</dt>     <dd>{contract.commission_rate ?? 0}%</dd>
            <dt className="text-ink-mute">최소정산금</dt>   <dd>{fmtMoney(contract.minimum_payout)}</dd>
            <dt className="text-ink-mute">담당자</dt>       <dd>{contract.manager_email ?? '—'}</dd>
            <dt className="text-ink-mute">적용 출처</dt>    <dd>contract</dd>
          </dl>
        </div>
        {suspendedAt && (
          <div className="rounded-xl bg-amber-500/20 p-3 ring-1 ring-amber-500/50">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-100">SUSPENDED</p>
            <p className="mt-1 text-amber-50">{fmtDate(suspendedAt)} — {suspendedReason ?? '(사유 없음)'}</p>
          </div>
        )}
      </div>
    </AdminModal>
  );
}

// ============================================================================
// Settlements view — spec 4, 5 (Generate Modal + snapshot freeze)
// ============================================================================
function SettlementsView({ tick, onChange }: { tick: number; onChange: () => void }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof import('@/lib/api/enterpriseMonthlySettlementApi').adminListEnterpriseMonthlySettlements>>['rows']>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [openGen, setOpenGen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const mod = await import('@/lib/api/enterpriseMonthlySettlementApi');
      const r = await mod.adminListEnterpriseMonthlySettlements({ limit: 50 });
      setRows(r.rows ?? []);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load, tick]);

  return (
    <>
      <AdminCard
        title="정산 목록 (Snapshot freeze 확인)"
        subtitle={<span className="text-[10px] text-ink-mute">contract snapshot 은 이미 0390 에서 저장됨 — 표시만</span>}
        action={
          <AdminButton size="md" tone="warning" onClick={() => setOpenGen(true)}>
            <PlayCircle size={12} /> Generate Settlement
          </AdminButton>
        }
      >
        {loading ? <AdminSkeleton variant="block" /> : err ? <AdminAlert tone="danger" title="정산 조회 실패">{err}</AdminAlert> : rows.length === 0 ? (
          <AdminEmpty title="정산 이력 없음" description="Generate Settlement 로 생성 필요" />
        ) : (
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-bg text-[10px] uppercase text-ink-dim">
                <tr>
                  <th className="px-2 py-1 text-left">정산월</th>
                  <th className="px-2 py-1 text-left">본사</th>
                  <th className="px-2 py-1 text-left">계약번호</th>
                  <th className="px-2 py-1 text-right">매장수</th>
                  <th className="px-2 py-1 text-right">단가</th>
                  <th className="px-2 py-1 text-right">수수료율</th>
                  <th className="px-2 py-1 text-right">총 커미션</th>
                  <th className="px-2 py-1 text-left">상태</th>
                  <th className="px-2 py-1 text-left">Snapshot 출처</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line/10">
                    <td className="px-2 py-1">{fmtMonth(r.settlement_month)}</td>
                    <td className="px-2 py-1 truncate max-w-[140px]">{r.enterprise_name}</td>
                    <td className="px-2 py-1 font-mono text-ink-mute">{r.contract_no ?? '—'}</td>
                    <td className="px-2 py-1 text-right">{r.active_store_count}</td>
                    <td className="px-2 py-1 text-right">{fmtMoney(r.monthly_store_price)}</td>
                    <td className="px-2 py-1 text-right">{r.commission_rate}%</td>
                    <td className="px-2 py-1 text-right font-bold">{fmtMoney(r.total_commission)}</td>
                    <td className="px-2 py-1"><AdminBadge tone={r.status === 'paid' ? 'success' : r.status === 'cancelled' ? 'danger' : 'info'} variant="subtle">{r.status.toUpperCase()}</AdminBadge></td>
                    <td className="px-2 py-1 text-ink-mute">{r.rate_source ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      {openGen && (
        <GenerateSettlementModal
          onClose={() => setOpenGen(false)}
          onDone={() => { setOpenGen(false); onChange(); void load(); }}
        />
      )}
    </>
  );
}

// ============================================================================
// GenerateSettlementModal — spec 4
// ============================================================================
function GenerateSettlementModal({
  onClose, onDone,
}: { onClose: () => void; onDone: () => void }) {
  const [enterprises, setEnterprises] = useState<EnterpriseAccount[]>([]);
  const [selectedEa, setSelectedEa] = useState<string>('');
  const [month, setMonth] = useState<string>(currentMonthFirstDay());
  const [preview, setPreview] = useState<SnapshotPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await adminListEnterpriseAccounts({ status: 'active', limit: 200 });
        setEnterprises(r.data ?? []);
      } catch (e) { toast.error(`본사 목록 조회 실패: ${(e as Error).message}`); }
    })();
  }, []);

  useEffect(() => {
    if (!selectedEa) { setPreview(null); return; }
    setLoading(true);
    fetchActiveContractPreview(selectedEa)
      .then((p) => setPreview(p))
      .catch((e) => toast.error(`계약 조회 실패: ${(e as Error).message}`))
      .finally(() => setLoading(false));
  }, [selectedEa]);

  const submit = useCallback(async () => {
    if (!month) { toast.error('월 선택 필요'); return; }
    setRunning(true);
    const t0 = performance.now();
    try {
      const r = await generateEnterpriseSettlement({ month });
      const durMs = Math.round(performance.now() - t0);
      await audit('quick_action.generate_settlement', 'success',
        `admin generated settlement (${month})`,
        { month, enterprise_account_id: selectedEa || null, created: r.created, skipped: r.skipped, duration_ms: durMs });
      toast.success(`정산 생성 완료: created=${r.created ?? 0} / skipped=${r.skipped ?? 0} (${durMs}ms)`);
      onDone();
    } catch (e) {
      const msg = (e as Error).message;
      await audit('quick_action.generate_settlement', 'failed', 'settlement generate failed',
        { month, enterprise_account_id: selectedEa || null }, msg);
      toast.error(`정산 생성 실패: ${msg}`);
    } finally { setRunning(false); }
  }, [month, selectedEa, onDone]);

  return (
    <AdminModal
      open size="lg" onClose={onClose}
      title={<span className="flex items-center gap-2"><PlayCircle size={14} /> Generate Enterprise Monthly Settlement</span>}
      headerExtra={<AdminBadge tone="warning" variant="subtle">기존 계산식 무수정</AdminBadge>}
      footer={
        <>
          <AdminButton size="lg" variant="subtle" tone="neutral" onClick={onClose} disabled={running}>취소</AdminButton>
          <AdminButton size="lg" tone="warning" onClick={submit} disabled={running || !month}>
            {running ? <><RefreshCw size={12} className="animate-spin" /> 실행 중…</> : '생성'}
          </AdminButton>
        </>
      }
    >
      <div className="space-y-3 text-[12px]">
        <p className="font-semibold text-ink">아래 조건으로 월 정산을 생성합니다. 기존 계산식은 변경하지 않습니다.</p>

        <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/15">
          <p className="text-[10px] font-bold uppercase tracking-wider text-violet-200">1. Enterprise 선택</p>
          <select
            className="mt-2 w-full rounded bg-bg px-2 py-1.5 text-[12px] text-ink ring-1 ring-line/20"
            value={selectedEa}
            onChange={(e) => setSelectedEa(e.target.value)}
          >
            <option value="">전체 (모든 활성 본사)</option>
            {enterprises.map((ea) => (
              <option key={ea.id} value={ea.id}>{ea.enterprise_name} ({ea.brand_code ?? '-'})</option>
            ))}
          </select>
        </div>

        <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/15">
          <p className="text-[10px] font-bold uppercase tracking-wider text-sky-200">2. 청구월 선택</p>
          <input
            type="month"
            className="mt-2 w-full rounded bg-bg px-2 py-1.5 text-[12px] text-ink ring-1 ring-line/20"
            value={month.slice(0, 7)}
            onChange={(e) => setMonth(`${e.target.value}-01`)}
          />
        </div>

        {selectedEa && (
          <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/15">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-200">3. 적용 계약 Snapshot 미리보기</p>
            {loading ? <p className="mt-2 text-ink-mute">조회 중…</p> : preview ? (
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                <dt className="text-ink-mute">계약번호</dt>     <dd className="font-mono">{preview.contract_no}</dd>
                <dt className="text-ink-mute">기간</dt>         <dd>{contractPeriodLabel(preview.contract_start_date, preview.contract_end_date)}</dd>
                <dt className="text-ink-mute">정산방식</dt>     <dd>{preview.settlement_method}</dd>
                <dt className="text-ink-mute">매장 단가</dt>    <dd>{fmtMoney(preview.monthly_store_price)}</dd>
                <dt className="text-ink-mute">수수료율</dt>     <dd>{preview.commission_rate}%</dd>
                <dt className="text-ink-mute">최소정산금</dt>   <dd>{fmtMoney(preview.minimum_payout)}</dd>
                <dt className="text-ink-mute">자동갱신</dt>     <dd>{preview.auto_renew ? 'ON' : 'OFF'}</dd>
                <dt className="text-ink-mute">상태</dt>         <dd>{preview.metadata_suspended_at ? 'SUSPENDED' : 'ACTIVE'}</dd>
              </dl>
            ) : <p className="mt-2 text-ink-mute">활성 계약 없음 → 프로필값 fallback (rate_source=profile)</p>}
          </div>
        )}

        <div className="rounded-xl bg-amber-500/20 p-3 text-[11px] text-amber-50 ring-1 ring-amber-500/50">
          실행 후 취소 불가. 결과는 audit log에 자동 기록됩니다. 매장수·예상 금액은 서버 계산 후 확정됩니다.
        </div>
      </div>
    </AdminModal>
  );
}

// ============================================================================
// Billing view — spec 6, 7, 8, 9
// ============================================================================
function BillingView({ tick, onChange }: { tick: number; onChange: () => void }) {
  const [rows, setRows] = useState<BillingInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [emailFor, setEmailFor] = useState<BillingInvoice | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await listBillingInvoices({ limit: 100 });
      setRows(r.data ?? []);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load, tick]);

  const doPdf = useCallback(async (inv: BillingInvoice) => {
    setBusyId(inv.id);
    try {
      const r = await generateInvoicePdf(inv.id);
      if (!r.ok) throw new Error(r.error || r.message || 'PDF 생성 실패');
      await audit('billing.pdf_generate', 'success', 'admin generated invoice PDF',
        { invoice_id: inv.id, duration_ms: r.duration_ms });
      toast.success(`PDF 생성 완료 (${r.duration_ms ?? '?'}ms)`);
      if (r.pdf_signed_url) window.open(r.pdf_signed_url, '_blank');
      onChange(); void load();
    } catch (e) {
      const msg = (e as Error).message;
      await audit('billing.pdf_generate', 'failed', 'invoice PDF failed', { invoice_id: inv.id }, msg);
      toast.error(`PDF 실패: ${msg}`);
    } finally { setBusyId(null); }
  }, [onChange, load]);

  return (
    <>
      <AdminCard
        title="청구 이력 (Billing History)"
        subtitle={<span className="text-[10px] text-ink-mute">status → DRAFT / GENERATED / SENT / PAID / FAILED UI 매핑</span>}
      >
        {loading ? <AdminSkeleton variant="block" /> : err ? <AdminAlert tone="danger" title="청구 조회 실패">{err}</AdminAlert> : rows.length === 0 ? (
          <AdminEmpty title="청구서 없음" description="Generate Billing 이 필요" />
        ) : (
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-bg text-[10px] uppercase text-ink-dim">
                <tr>
                  <th className="px-2 py-1 text-left">생성일</th>
                  <th className="px-2 py-1 text-left">청구월</th>
                  <th className="px-2 py-1 text-left">본사</th>
                  <th className="px-2 py-1 text-right">금액</th>
                  <th className="px-2 py-1 text-left">상태</th>
                  <th className="px-2 py-1 text-center">PDF</th>
                  <th className="px-2 py-1 text-center">이메일</th>
                  <th className="px-2 py-1 text-right">액션</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const raw = r as BillingInvoice & { pdf_url?: string | null; last_email_sent_at?: string | null; email_send_count?: number };
                  const display = toDisplayBillingStatus(r.status);
                  const hasPdf = !!raw.pdf_url;
                  const emailCount = raw.email_send_count ?? 0;
                  return (
                    <tr key={r.id} className="border-t border-line/10">
                      <td className="px-2 py-1 text-ink-mute">{fmtDate(r.created_at)}</td>
                      <td className="px-2 py-1">{fmtMonth(r.billing_month)}</td>
                      <td className="px-2 py-1 truncate max-w-[140px]">{r.enterprise_name ?? '—'}</td>
                      <td className="px-2 py-1 text-right font-bold">{fmtMoney(r.total_amount, r.currency)}</td>
                      <td className="px-2 py-1"><AdminBadge tone={billingStatusTone(display)} variant="subtle">{display}</AdminBadge></td>
                      <td className="px-2 py-1 text-center">{hasPdf ? <CheckCircle2 size={12} className="inline text-emerald-300" /> : <span className="text-ink-mute">—</span>}</td>
                      <td className="px-2 py-1 text-center">{emailCount > 0 ? `${emailCount}회` : <span className="text-ink-mute">—</span>}</td>
                      <td className="px-2 py-1 text-right">
                        <div className="inline-flex gap-1">
                          <AdminButton size="sm" variant="subtle" tone="primary" onClick={() => doPdf(r)} disabled={busyId === r.id}>
                            {busyId === r.id ? <RefreshCw size={10} className="animate-spin" /> : <Download size={10} />}
                            PDF
                          </AdminButton>
                          <AdminButton size="sm" variant="subtle" tone="info" onClick={() => setEmailFor(r)} disabled={!hasPdf}>
                            <Mail size={10} /> Email
                          </AdminButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      {emailFor && (
        <EmailModal
          invoice={emailFor}
          onClose={() => setEmailFor(null)}
          onSent={() => { setEmailFor(null); onChange(); void load(); }}
        />
      )}
    </>
  );
}

// ============================================================================
// Email Modal (재발송 지원 + 이력) — spec 8
// ============================================================================
function EmailModal({
  invoice, onClose, onSent,
}: { invoice: BillingInvoice; onClose: () => void; onSent: () => void }) {
  const [to, setTo] = useState(invoice.manager_email ?? '');
  const [cc, setCc] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<EmailJobRow[]>([]);
  const [histLoading, setHistLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try { setHistory(await listBillingEmailJobs(invoice.id)); }
    catch { /* silent */ }
    finally { setHistLoading(false); }
  }, [invoice.id]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const send = useCallback(async () => {
    if (!to.trim()) { toast.error('수신 이메일 필요'); return; }
    setBusy(true);
    try {
      const ccList = cc.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      const job = await createBillingEmailJob(invoice.id, to.trim(), ccList.length > 0 ? ccList : undefined);
      await audit('billing.email_enqueue', 'success', 'email job enqueued',
        { invoice_id: invoice.id, job_id: job.job_id, to });
      const dispatch = await dispatchBillingInvoiceEmail(job.job_id);
      if (dispatch.status === 'sent') {
        await audit('billing.email_send', 'success', 'email sent',
          { invoice_id: invoice.id, job_id: job.job_id, resend_id: dispatch.resend_id });
        toast.success(`이메일 발송 완료 (${dispatch.duration_ms ?? '?'}ms)`);
        onSent();
      } else {
        await audit('billing.email_send', 'failed', 'email send failed',
          { invoice_id: invoice.id, job_id: job.job_id }, dispatch.error_message ?? dispatch.error);
        toast.error(`이메일 실패: ${dispatch.error_message ?? dispatch.error ?? 'unknown'}`);
        void loadHistory();
      }
    } catch (e) {
      const msg = (e as Error).message;
      await audit('billing.email_send', 'failed', 'email enqueue failed', { invoice_id: invoice.id }, msg);
      toast.error(`실패: ${msg}`);
    } finally { setBusy(false); }
  }, [invoice.id, to, cc, onSent, loadHistory]);

  return (
    <AdminModal
      open size="lg" onClose={onClose}
      title={<span className="flex items-center gap-2"><Mail size={14} /> 청구서 이메일 발송</span>}
      headerExtra={<AdminBadge tone="info" variant="subtle">Resend</AdminBadge>}
      footer={
        <>
          <AdminButton size="lg" variant="subtle" tone="neutral" onClick={onClose} disabled={busy}>닫기</AdminButton>
          <AdminButton size="lg" tone="info" onClick={send} disabled={busy || !to.trim()}>
            {busy ? <><RefreshCw size={12} className="animate-spin" /> 발송 중…</> : <><Send size={12} /> 발송</>}
          </AdminButton>
        </>
      }
    >
      <div className="space-y-3 text-[12px]">
        <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/15">
          <p className="text-[10px] font-bold uppercase tracking-wider text-violet-200">대상 청구서</p>
          <p className="mt-1">{fmtMonth(invoice.billing_month)} · {invoice.enterprise_name ?? '—'} · {fmtMoney(invoice.total_amount, invoice.currency)}</p>
        </div>
        <div className="grid grid-cols-1 gap-2">
          <label className="text-[11px] text-ink-mute">TO
            <input className="mt-1 w-full rounded bg-bg px-2 py-1.5 text-[12px] text-ink ring-1 ring-line/20"
              value={to} onChange={(e) => setTo(e.target.value)} placeholder="user@example.com" />
          </label>
          <label className="text-[11px] text-ink-mute">CC (콤마 구분, 선택)
            <input className="mt-1 w-full rounded bg-bg px-2 py-1.5 text-[12px] text-ink ring-1 ring-line/20"
              value={cc} onChange={(e) => setCc(e.target.value)} placeholder="cc1@example.com, cc2@example.com" />
          </label>
        </div>
        <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/15">
          <p className="text-[10px] font-bold uppercase tracking-wider text-sky-200">발송 이력 (재발송 이력 포함)</p>
          {histLoading ? <p className="mt-2 text-ink-mute text-[11px]">조회 중…</p> : history.length === 0 ? (
            <p className="mt-2 text-ink-mute text-[11px]">이력 없음</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {history.slice(0, 10).map((h) => (
                <li key={h.id} className="flex items-center justify-between text-[11px]">
                  <span>
                    <AdminBadge tone={h.status === 'sent' ? 'success' : h.status === 'failed' ? 'danger' : 'neutral'} variant="subtle">{h.status}</AdminBadge>
                    <span className="ml-2 text-ink-mute">{fmtDate(h.created_at)}</span>
                    <span className="ml-2">{h.to_email}</span>
                  </span>
                  {h.error_message && <span className="text-rose-300 text-[10px] truncate max-w-[240px]">{h.error_message}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AdminModal>
  );
}
