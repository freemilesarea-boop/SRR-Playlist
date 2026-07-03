/**
 * BrandRegistryPanel — Phase 3-2
 *
 * `/admin → 브랜드 관리` 탭.
 * 관리자가 브랜드를 사전 등록 + 자동 가입 승인/거절.
 *
 * 절대 무수정:
 *   • 기존 EnterpriseAccountsPanel / EnterpriseContractsPanel 파일 무영향.
 *   • Settlement / Contract Snapshot / Billing / Cron 무관.
 *   • 기존 0363 invite code UI 무영향 — 병행 flow.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2, CheckCircle2, Copy, Handshake, Plus, RefreshCw, Sparkles, X,
} from 'lucide-react';
import {
  AdminSection, AdminCard, AdminBadge, AdminButton, AdminAlert, AdminEmpty,
  AdminSkeleton, AdminModal, AdminSearch, AdminStatCard,
} from '@/components/admin/ui';
import { supabase } from '@/lib/supabase';
import { toast } from '@/store/toastStore';
import {
  adminListBrandRegistry, adminCreateBrandRegistry, adminUpdateBrandRegistry,
  adminToggleBrandRegistryActive, adminGenerateBrandCode,
  adminApproveBrandOnboarding, adminRejectBrandOnboarding,
  type BrandRegistryRow, type BrandSettlementMethod,
} from '@/lib/api/enterpriseBrandRegistryApi';
import {
  adminListEnterpriseAccounts, type EnterpriseAccount,
} from '@/lib/api/enterpriseAccountsApi';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try { return new Date(iso).toISOString().slice(0, 10); } catch { return '—'; }
}
function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `₩${Math.round(n).toLocaleString('ko-KR')}`;
}

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

export default function BrandRegistryPanel() {
  const [tick, setTick] = useState(0);

  return (
    <AdminSection
      title={
        <span className="flex items-center gap-2">
          <Building2 size={16} /> 브랜드 관리 (Brand Registry)
          <AdminBadge tone="primary" variant="subtle">Phase 3-2</AdminBadge>
        </span>
      }
      description={
        <span className="text-[11px] text-ink-mute">
          Enterprise 회원이 <b className="text-ink">브랜드명 + 브랜드코드</b> 로 자동 매칭 가입할 수 있도록 사전 등록합니다.
          기존 초대코드 flow (0363) 는 그대로 유지됩니다.
        </span>
      }
      action={
        <AdminButton size="sm" variant="subtle" tone="neutral" onClick={() => setTick((t) => t + 1)}>
          <RefreshCw size={12} /> 새로고침
        </AdminButton>
      }
    >
      <PendingApprovalsCard tick={tick} onChange={() => setTick((t) => t + 1)} />
      <BrandRegistryList tick={tick} onChange={() => setTick((t) => t + 1)} />
    </AdminSection>
  );
}

// ============================================================================
// Pending approvals — auto_onboarded=true + status='invited'
// ============================================================================
function PendingApprovalsCard({ tick, onChange }: { tick: number; onChange: () => void }) {
  const [pending, setPending] = useState<EnterpriseAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await adminListEnterpriseAccounts({ status: 'invited', limit: 100 });
      const rows = (r.data ?? []).filter(
        (a) => (a as EnterpriseAccount & { auto_onboarded?: boolean }).auto_onboarded === true,
      );
      setPending(rows);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load, tick]);

  const approve = useCallback(async (ea: EnterpriseAccount) => {
    setBusy(ea.id);
    try {
      await adminApproveBrandOnboarding(ea.id);
      await audit('brand.admin_approve', 'success', 'brand onboarding approved',
        { enterprise_account_id: ea.id, brand_code: ea.brand_code });
      toast.success(`${ea.enterprise_name} 승인 완료`);
      onChange(); void load();
    } catch (e) {
      const msg = (e as Error).message;
      await audit('brand.admin_approve', 'failed', 'approval failed', { enterprise_account_id: ea.id }, msg);
      toast.error(`승인 실패: ${msg}`);
    } finally { setBusy(null); }
  }, [onChange, load]);

  const reject = useCallback(async (ea: EnterpriseAccount) => {
    const reason = window.prompt(`${ea.enterprise_name} 거절 사유 (선택)`) ?? '';
    setBusy(ea.id);
    try {
      await adminRejectBrandOnboarding(ea.id, reason || undefined);
      await audit('brand.admin_reject', 'success', 'brand onboarding rejected',
        { enterprise_account_id: ea.id, reason });
      toast.success(`${ea.enterprise_name} 거절 완료`);
      onChange(); void load();
    } catch (e) {
      const msg = (e as Error).message;
      await audit('brand.admin_reject', 'failed', 'reject failed', { enterprise_account_id: ea.id }, msg);
      toast.error(`거절 실패: ${msg}`);
    } finally { setBusy(null); }
  }, [onChange, load]);

  return (
    <AdminCard
      title={<span className="flex items-center gap-2"><Handshake size={13} /> 승인 대기 (자동 가입 요청)</span>}
      subtitle={<span className="text-[10px] text-ink-mute">auto_onboarded=true · status=invited</span>}
    >
      {loading ? <AdminSkeleton variant="block" />
        : err ? <AdminAlert tone="danger" title="조회 실패">{err}</AdminAlert>
        : pending.length === 0 ? <AdminEmpty title="승인 대기 없음" description="자동 가입 요청이 없습니다" />
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-[10px] uppercase text-ink-dim">
                <tr>
                  <th className="px-2 py-1 text-left">브랜드</th>
                  <th className="px-2 py-1 text-left">코드</th>
                  <th className="px-2 py-1 text-left">담당자</th>
                  <th className="px-2 py-1 text-left">이메일</th>
                  <th className="px-2 py-1 text-left">가입일</th>
                  <th className="px-2 py-1 text-right">액션</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((a) => (
                  <tr key={a.id} className="border-t border-line/10">
                    <td className="px-2 py-1 font-medium text-ink">{a.enterprise_name}</td>
                    <td className="px-2 py-1 font-mono text-ink-mute">{a.brand_code ?? '—'}</td>
                    <td className="px-2 py-1">{a.manager_name ?? '—'}</td>
                    <td className="px-2 py-1 truncate max-w-[200px]">{a.manager_email}</td>
                    <td className="px-2 py-1 text-ink-mute">{fmtDate(a.created_at)}</td>
                    <td className="px-2 py-1 text-right">
                      <div className="inline-flex gap-1">
                        <AdminButton size="sm" tone="success" onClick={() => approve(a)} disabled={busy === a.id}>
                          {busy === a.id ? <RefreshCw size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                          승인
                        </AdminButton>
                        <AdminButton size="sm" variant="subtle" tone="danger" onClick={() => reject(a)} disabled={busy === a.id}>
                          <X size={10} /> 거절
                        </AdminButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </AdminCard>
  );
}

// ============================================================================
// Brand Registry List + Create/Edit
// ============================================================================
function BrandRegistryList({ tick, onChange }: { tick: number; onChange: () => void }) {
  const [rows, setRows] = useState<BrandRegistryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<BrandRegistryRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await adminListBrandRegistry({ search: search || null, limit: 200 });
      setRows(r.data ?? []);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { void load(); }, [load, tick]);

  const stats = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((r) => r.is_active).length;
    return { total, active, inactive: total - active };
  }, [rows]);

  const toggleActive = useCallback(async (row: BrandRegistryRow) => {
    setBusy(row.id);
    try {
      await adminToggleBrandRegistryActive(row.id, !row.is_active);
      await audit(row.is_active ? 'brand.deactivate' : 'brand.activate', 'success',
        `admin toggled brand active=${!row.is_active}`,
        { brand_id: row.id, brand_code: row.brand_code });
      toast.success(`${row.brand_name} ${!row.is_active ? '활성화' : '비활성화'}`);
      onChange(); void load();
    } catch (e) {
      const msg = (e as Error).message;
      await audit('brand.deactivate', 'failed', 'toggle failed', { brand_id: row.id }, msg);
      toast.error(`실패: ${msg}`);
    } finally { setBusy(null); }
  }, [onChange, load]);

  return (
    <>
      <AdminCard
        title={<span className="flex items-center gap-2"><Building2 size={13} /> 브랜드 목록</span>}
        subtitle={<span className="text-[10px] text-ink-mute">브랜드코드는 변경 불가 · brand_name + brand_code 로 자동 매칭</span>}
        action={
          <AdminButton size="md" tone="primary" onClick={() => setCreating(true)}>
            <Plus size={12} /> 브랜드 등록
          </AdminButton>
        }
      >
        <div className="grid grid-cols-3 gap-2 mb-3">
          <AdminStatCard label="총 브랜드" value={stats.total} tone="primary" icon={<Building2 size={14} />} />
          <AdminStatCard label="활성" value={stats.active} tone="success" icon={<CheckCircle2 size={14} />} />
          <AdminStatCard label="비활성" value={stats.inactive} tone="neutral" icon={<X size={14} />} />
        </div>

        <div className="mb-2">
          <AdminSearch value={search} onChange={setSearch} placeholder="브랜드명/코드/사업자명 검색" />
        </div>

        {loading ? <AdminSkeleton variant="block" />
          : err ? <AdminAlert tone="danger" title="조회 실패">{err}</AdminAlert>
          : rows.length === 0 ? <AdminEmpty title="등록된 브랜드 없음" description="'브랜드 등록' 으로 시작" />
          : (
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-bg text-[10px] uppercase text-ink-dim">
                  <tr>
                    <th className="px-2 py-1 text-left">브랜드명</th>
                    <th className="px-2 py-1 text-left">코드</th>
                    <th className="px-2 py-1 text-left">사업자명</th>
                    <th className="px-2 py-1 text-left">사업자번호</th>
                    <th className="px-2 py-1 text-left">대표자</th>
                    <th className="px-2 py-1 text-left">담당자</th>
                    <th className="px-2 py-1 text-left">이메일</th>
                    <th className="px-2 py-1 text-right">월 이용료</th>
                    <th className="px-2 py-1 text-right">매장 단가</th>
                    <th className="px-2 py-1 text-right">수수료율</th>
                    <th className="px-2 py-1 text-right">최소 정산</th>
                    <th className="px-2 py-1 text-left">정산방식</th>
                    <th className="px-2 py-1 text-left">자동갱신</th>
                    <th className="px-2 py-1 text-left">활성</th>
                    <th className="px-2 py-1 text-left">생성일</th>
                    <th className="px-2 py-1 text-left">수정일</th>
                    <th className="px-2 py-1 text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-line/10 hover:bg-bg-hover">
                      <td className="px-2 py-1 font-medium text-ink truncate max-w-[140px]">{r.brand_name}</td>
                      <td className="px-2 py-1 font-mono text-ink-mute">{r.brand_code}</td>
                      <td className="px-2 py-1 truncate max-w-[140px]">{r.business_name}</td>
                      <td className="px-2 py-1 font-mono text-[10px] text-ink-mute">{r.business_registration_no ?? '—'}</td>
                      <td className="px-2 py-1">{r.representative_name ?? '—'}</td>
                      <td className="px-2 py-1">{r.manager_name}</td>
                      <td className="px-2 py-1 truncate max-w-[180px]">{r.manager_email}</td>
                      <td className="px-2 py-1 text-right">{fmtMoney(r.default_monthly_fee)}</td>
                      <td className="px-2 py-1 text-right">{fmtMoney(r.default_store_price)}</td>
                      <td className="px-2 py-1 text-right">{r.default_commission_rate}%</td>
                      <td className="px-2 py-1 text-right">{fmtMoney(r.default_minimum_payout)}</td>
                      <td className="px-2 py-1">{r.default_settlement_method}</td>
                      <td className="px-2 py-1">{r.default_auto_renew ? 'ON' : 'OFF'}</td>
                      <td className="px-2 py-1">
                        <AdminBadge tone={r.is_active ? 'success' : 'neutral'} variant="subtle">
                          {r.is_active ? 'ACTIVE' : 'INACTIVE'}
                        </AdminBadge>
                      </td>
                      <td className="px-2 py-1 text-ink-mute">{fmtDate(r.created_at)}</td>
                      <td className="px-2 py-1 text-ink-mute">{fmtDate(r.updated_at)}</td>
                      <td className="px-2 py-1 text-right">
                        <div className="inline-flex gap-1">
                          <AdminButton size="sm" variant="subtle" tone="primary" onClick={() => setEditing(r)}>
                            수정
                          </AdminButton>
                          <AdminButton
                            size="sm"
                            variant="subtle"
                            tone={r.is_active ? 'warning' : 'success'}
                            onClick={() => toggleActive(r)}
                            disabled={busy === r.id}
                          >
                            {r.is_active ? '비활성화' : '활성화'}
                          </AdminButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </AdminCard>

      {creating && (
        <BrandRegistryFormModal
          mode="create"
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); onChange(); void load(); }}
        />
      )}
      {editing && (
        <BrandRegistryFormModal
          mode="edit"
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChange(); void load(); }}
        />
      )}
    </>
  );
}

// ============================================================================
// Create/Edit modal
// ============================================================================
function BrandRegistryFormModal({
  mode, row, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  row?: BrandRegistryRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [brandName, setBrandName] = useState(row?.brand_name ?? '');
  const [brandCode, setBrandCode] = useState(row?.brand_code ?? '');
  const [businessName, setBusinessName] = useState(row?.business_name ?? '');
  const [businessRegNo, setBusinessRegNo] = useState(row?.business_registration_no ?? '');
  const [representative, setRepresentative] = useState(row?.representative_name ?? '');
  const [managerName, setManagerName] = useState(row?.manager_name ?? '');
  const [managerEmail, setManagerEmail] = useState(row?.manager_email ?? '');
  const [managerPhone, setManagerPhone] = useState(row?.manager_phone ?? '');
  const [businessAddress, setBusinessAddress] = useState(row?.business_address ?? '');
  const [monthlyFee, setMonthlyFee] = useState<number>(row?.default_monthly_fee ?? 0);
  const [storePrice, setStorePrice] = useState<number>(row?.default_store_price ?? 4900);
  const [commissionRate, setCommissionRate] = useState<number>(Number(row?.default_commission_rate ?? 0));
  const [minPayout, setMinPayout] = useState<number>(row?.default_minimum_payout ?? 0);
  const [settlementMethod, setSettlementMethod] = useState<BrandSettlementMethod>(row?.default_settlement_method ?? 'monthly');
  const [autoRenew, setAutoRenew] = useState<boolean>(row?.default_auto_renew ?? true);
  const [memo, setMemo] = useState(row?.memo ?? '');
  const [genning, setGenning] = useState(false);
  const [busy, setBusy] = useState(false);

  const genCode = useCallback(async () => {
    if (!brandName.trim()) { toast.error('브랜드명 필요'); return; }
    setGenning(true);
    try {
      const r = await adminGenerateBrandCode(brandName.trim());
      setBrandCode(r.brand_code);
      toast.success(`자동 코드: ${r.brand_code} (base=${r.base}, suffix=${r.suffix})`);
    } catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setGenning(false); }
  }, [brandName]);

  const submit = useCallback(async () => {
    if (!brandName.trim() || !businessName.trim() || !managerName.trim() || !managerEmail.trim()) {
      toast.error('브랜드명 / 사업자명 / 담당자명 / 이메일 은 필수');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'create') {
        const r = await adminCreateBrandRegistry({
          brandName, brandCode: brandCode || null, businessName,
          businessRegistrationNo: businessRegNo || null,
          representativeName: representative || null,
          managerName, managerEmail, managerPhone: managerPhone || null,
          businessAddress: businessAddress || null,
          defaultMonthlyFee: monthlyFee,
          defaultStorePrice: storePrice,
          defaultCommissionRate: commissionRate,
          defaultMinimumPayout: minPayout,
          defaultSettlementMethod: settlementMethod,
          defaultAutoRenew: autoRenew,
          memo: memo || null,
        });
        await audit('brand.create', 'success', 'brand created', { brand_id: r.id, brand_code: r.brand_code });
        toast.success(`브랜드 등록 완료 · 코드 ${r.brand_code}`);
      } else if (row) {
        await adminUpdateBrandRegistry({
          id: row.id,
          brandName, businessName,
          businessRegistrationNo: businessRegNo || null,
          representativeName: representative || null,
          managerName, managerEmail, managerPhone: managerPhone || null,
          businessAddress: businessAddress || null,
          defaultMonthlyFee: monthlyFee,
          defaultStorePrice: storePrice,
          defaultCommissionRate: commissionRate,
          defaultMinimumPayout: minPayout,
          defaultSettlementMethod: settlementMethod,
          defaultAutoRenew: autoRenew,
          memo: memo || null,
        });
        await audit('brand.update', 'success', 'brand updated', { brand_id: row.id });
        toast.success('브랜드 수정 완료');
      }
      onSaved();
    } catch (e) {
      const msg = (e as Error).message;
      await audit(mode === 'create' ? 'brand.create' : 'brand.update', 'failed', 'save failed', {}, msg);
      toast.error(`실패: ${msg}`);
    } finally { setBusy(false); }
  }, [
    mode, row, brandName, brandCode, businessName, businessRegNo, representative,
    managerName, managerEmail, managerPhone, businessAddress,
    monthlyFee, storePrice, commissionRate, minPayout, settlementMethod, autoRenew, memo, onSaved,
  ]);

  return (
    <AdminModal
      open size="xl" onClose={onClose}
      title={<span className="flex items-center gap-2"><Building2 size={14} /> {mode === 'create' ? '브랜드 등록' : `수정 — ${row?.brand_name}`}</span>}
      headerExtra={<AdminBadge tone="primary" variant="subtle">{mode === 'create' ? 'NEW' : 'EDIT'}</AdminBadge>}
      footer={
        <>
          <AdminButton size="lg" variant="subtle" tone="neutral" onClick={onClose} disabled={busy}>취소</AdminButton>
          <AdminButton size="lg" tone="primary" onClick={submit} disabled={busy}>
            {busy ? <><RefreshCw size={12} className="animate-spin" /> 저장 중…</> : '저장'}
          </AdminButton>
        </>
      }
    >
      <div className="space-y-3 text-[12px]">
        {/* 브랜드 식별 */}
        <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/15">
          <p className="text-[10px] font-bold uppercase tracking-wider text-violet-200">브랜드 식별</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-[11px] text-ink-mute">브랜드명 *
              <input className="mt-1 w-full rounded bg-bg px-2 py-1.5 text-[12px] text-ink ring-1 ring-line/20"
                value={brandName} onChange={(e) => setBrandName(e.target.value)} disabled={mode === 'edit'} />
            </label>
            <label className="text-[11px] text-ink-mute">브랜드코드 {mode === 'create' ? '(비우면 자동)' : '(변경 불가)'}
              <div className="mt-1 flex gap-1">
                <input className="flex-1 rounded bg-bg px-2 py-1.5 text-[12px] font-mono text-ink ring-1 ring-line/20"
                  value={brandCode} onChange={(e) => setBrandCode(e.target.value.toUpperCase())} disabled={mode === 'edit'} />
                {mode === 'create' && (
                  <AdminButton size="sm" variant="subtle" tone="primary" onClick={genCode} disabled={genning || !brandName.trim()}>
                    {genning ? <RefreshCw size={10} className="animate-spin" /> : <Sparkles size={10} />} 자동
                  </AdminButton>
                )}
                {brandCode && (
                  <AdminButton size="sm" variant="subtle" tone="neutral" onClick={() => { void navigator.clipboard.writeText(brandCode); toast.success('복사됨'); }}>
                    <Copy size={10} />
                  </AdminButton>
                )}
              </div>
            </label>
          </div>
        </div>

        {/* 사업자 정보 */}
        <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/15">
          <p className="text-[10px] font-bold uppercase tracking-wider text-sky-200">사업자 정보</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-[11px] text-ink-mute">사업자명 *
              <input className="mt-1 w-full rounded bg-bg px-2 py-1.5 text-[12px] text-ink ring-1 ring-line/20"
                value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
            </label>
            <label className="text-[11px] text-ink-mute">사업자번호
              <input className="mt-1 w-full rounded bg-bg px-2 py-1.5 text-[12px] font-mono text-ink ring-1 ring-line/20"
                value={businessRegNo} onChange={(e) => setBusinessRegNo(e.target.value)} placeholder="123-45-67890" />
            </label>
            <label className="text-[11px] text-ink-mute">대표자
              <input className="mt-1 w-full rounded bg-bg px-2 py-1.5 text-[12px] text-ink ring-1 ring-line/20"
                value={representative} onChange={(e) => setRepresentative(e.target.value)} />
            </label>
            <label className="text-[11px] text-ink-mute">담당자명 *
              <input className="mt-1 w-full rounded bg-bg px-2 py-1.5 text-[12px] text-ink ring-1 ring-line/20"
                value={managerName} onChange={(e) => setManagerName(e.target.value)} />
            </label>
            <label className="text-[11px] text-ink-mute">담당자 이메일 *
              <input type="email" className="mt-1 w-full rounded bg-bg px-2 py-1.5 text-[12px] text-ink ring-1 ring-line/20"
                value={managerEmail} onChange={(e) => setManagerEmail(e.target.value)} />
            </label>
            <label className="text-[11px] text-ink-mute">담당자 연락처
              <input className="mt-1 w-full rounded bg-bg px-2 py-1.5 text-[12px] text-ink ring-1 ring-line/20"
                value={managerPhone} onChange={(e) => setManagerPhone(e.target.value)} />
            </label>
            <label className="text-[11px] text-ink-mute col-span-2">본사 주소
              <input className="mt-1 w-full rounded bg-bg px-2 py-1.5 text-[12px] text-ink ring-1 ring-line/20"
                value={businessAddress} onChange={(e) => setBusinessAddress(e.target.value)} />
            </label>
          </div>
        </div>

        {/* 기본 계약값 */}
        <div className="rounded-xl bg-bg-card p-3 ring-1 ring-line/15">
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-200">기본 계약값 (자동 계약 생성 시 사용)</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-[11px] text-ink-mute">월 이용료 (₩)
              <input type="number" min={0} className="mt-1 w-full rounded bg-bg px-2 py-1.5 text-[12px] text-ink ring-1 ring-line/20"
                value={monthlyFee} onChange={(e) => setMonthlyFee(Number(e.target.value) || 0)} />
            </label>
            <label className="text-[11px] text-ink-mute">매장 단가 (₩)
              <input type="number" min={0} className="mt-1 w-full rounded bg-bg px-2 py-1.5 text-[12px] text-ink ring-1 ring-line/20"
                value={storePrice} onChange={(e) => setStorePrice(Number(e.target.value) || 0)} />
            </label>
            <label className="text-[11px] text-ink-mute">수수료율 (%)
              <input type="number" min={0} max={100} step={0.1} className="mt-1 w-full rounded bg-bg px-2 py-1.5 text-[12px] text-ink ring-1 ring-line/20"
                value={commissionRate} onChange={(e) => setCommissionRate(Number(e.target.value) || 0)} />
            </label>
            <label className="text-[11px] text-ink-mute">최소 정산금 (₩)
              <input type="number" min={0} className="mt-1 w-full rounded bg-bg px-2 py-1.5 text-[12px] text-ink ring-1 ring-line/20"
                value={minPayout} onChange={(e) => setMinPayout(Number(e.target.value) || 0)} />
            </label>
            <label className="text-[11px] text-ink-mute">정산방식
              <select className="mt-1 w-full rounded bg-bg px-2 py-1.5 text-[12px] text-ink ring-1 ring-line/20"
                value={settlementMethod} onChange={(e) => setSettlementMethod(e.target.value as BrandSettlementMethod)}>
                <option value="monthly">monthly</option>
                <option value="weekly">weekly</option>
                <option value="manual">manual</option>
              </select>
            </label>
            <label className="text-[11px] text-ink-mute flex items-center gap-2 mt-4">
              <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
              자동갱신 기본값
            </label>
          </div>
        </div>

        <label className="text-[11px] text-ink-mute block">
          메모
          <textarea rows={2} className="mt-1 w-full rounded bg-bg px-2 py-1.5 text-[12px] text-ink ring-1 ring-line/20"
            value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>
      </div>
    </AdminModal>
  );
}
