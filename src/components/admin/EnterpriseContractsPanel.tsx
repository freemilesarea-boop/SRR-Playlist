/**
 * EnterpriseContractsPanel — Phase 4-12 (Enterprise Contract Management V1).
 * SQL: supabase/migrations/0383_enterprise_contracts_v1.sql
 */
import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, Plus, FileSignature, Edit3, Trash2, Upload, FileText,
  AlertCircle, CheckCircle2, Clock, Pause, Power, XCircle,
} from 'lucide-react';
import {
  AdminSection, AdminStatCard, AdminSearch, AdminBadge, AdminButton,
  AdminModal, AdminAlert, AdminEmpty, AdminSkeleton, AdminTooltip,
  type AdminToneName,
} from '@/components/admin/ui';
import {
  listEnterpriseContracts, getEnterpriseContract, createEnterpriseContract,
  updateEnterpriseContract, setEnterpriseContractStatus, softDeleteEnterpriseContract,
  uploadContractFile, recordContractFile, deleteContractFile, getContractFileSignedUrl, getContractKpi,
  type EnterpriseContract, type ContractDetail, type ContractStatus,
  type ContractKpi, type SettlementMethod,
  CONTRACT_ALLOWED_MIME, CONTRACT_MAX_BYTES,
} from '@/lib/api/enterpriseContractApi';
import { adminListEnterpriseAccounts, type EnterpriseAccount } from '@/lib/api/enterpriseAccountsApi';

const PAGE_SIZE = 50;

const STATUS_META: Record<ContractStatus, { ko: string; tone: AdminToneName }> = {
  draft:      { ko: '초안',   tone: 'neutral' },
  active:     { ko: 'ACTIVE', tone: 'success' },
  expiring:   { ko: 'EXPIRING', tone: 'warning' },
  expired:    { ko: 'EXPIRED', tone: 'danger'  },
  terminated: { ko: '해지',   tone: 'neutral' },
};

const fmtKRW = (n: number | null | undefined) => n == null ? '—' : `${n.toLocaleString('ko-KR')}원`;
const fmtPct = (n: number | null | undefined) => n == null ? '—' : `${n}%`;
const fmtDate = (s: string | null | undefined) => s ? new Date(s).toLocaleDateString('ko-KR') : '—';
const fmtBytes = (b: number | null | undefined) => {
  if (b == null) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

export default function EnterpriseContractsPanel() {
  const [list, setList] = useState<EnterpriseContract[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kpi, setKpi] = useState<ContractKpi | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ContractStatus | ''>('');
  const [enterpriseFilter, setEnterpriseFilter] = useState('');
  const [autoRenewFilter, setAutoRenewFilter] = useState<'' | 'true' | 'false'>('');
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [offset, setOffset] = useState(0);

  // sources
  const [enterprises, setEnterprises] = useState<EnterpriseAccount[]>([]);

  // modals
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<EnterpriseContract | null>(null);
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: 'success'|'warning'|'danger'|'info'; title: string; body?: string } | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const r = await listEnterpriseContracts({
        search: search.trim() || null,
        status: statusFilter || null,
        enterpriseAccountId: enterpriseFilter || null,
        autoRenew: autoRenewFilter === '' ? null : autoRenewFilter === 'true',
        expiringOnly,
        limit: PAGE_SIZE, offset,
      });
      setList(r.data);
      setTotal(r.pagination.total);
    } catch (e) { setError((e as Error).message); }
    finally { if (!silent) setLoading(false); }
  }, [search, statusFilter, enterpriseFilter, autoRenewFilter, expiringOnly, offset]);

  const loadKpi = useCallback(async () => {
    try { setKpi(await getContractKpi()); } catch (e) { console.warn('[contracts] kpi failed', e); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadKpi(); }, [loadKpi]);

  useEffect(() => {
    void adminListEnterpriseAccounts({ limit: 200 }).then((r) => setEnterprises(r.data))
      .catch((e) => console.warn('[contracts] enterprises load failed', e));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try { await Promise.all([load(true), loadKpi()]); } finally { setRefreshing(false); }
  }, [load, loadKpi]);

  const openDetail = useCallback(async (id: string) => {
    setDetailLoading(true); setDetailError(null);
    try { setDetail(await getEnterpriseContract(id)); }
    catch (e) { setDetailError((e as Error).message); }
    finally { setDetailLoading(false); }
  }, []);

  const closeDetail = () => { setDetail(null); setDetailError(null); };

  const onToggleStatus = useCallback(async (c: EnterpriseContract, next: ContractStatus) => {
    setBusy(`s:${c.id}`);
    try {
      await setEnterpriseContractStatus(c.id, next);
      setToast({ tone: 'success', title: '상태 변경됨', body: `${c.contract_name} → ${STATUS_META[next].ko}` });
      await Promise.all([load(true), loadKpi()]);
    } catch (e) { setToast({ tone: 'danger', title: '상태 변경 실패', body: (e as Error).message }); }
    finally { setBusy(null); }
  }, [load, loadKpi]);

  const onDelete = useCallback(async (c: EnterpriseContract) => {
    if (!window.confirm(`"${c.contract_name}" 계약을 삭제(soft delete)하시겠습니까?`)) return;
    setBusy(`d:${c.id}`);
    try {
      await softDeleteEnterpriseContract(c.id);
      setToast({ tone: 'warning', title: '계약이 삭제되었습니다.', body: c.contract_name });
      await Promise.all([load(true), loadKpi()]);
    } catch (e) { setToast({ tone: 'danger', title: '삭제 실패', body: (e as Error).message }); }
    finally { setBusy(null); }
  }, [load, loadKpi]);

  return (
    <AdminSection
      title={<span className="flex items-center gap-2"><FileSignature size={16} /> 계약 관리</span>}
      description="본사 계약을 등록·관리합니다. 활성 계약의 단가/수수료/정산 조건이 청구 생성에 자동 반영됩니다."
      badge={<AdminBadge tone="primary" variant="subtle">Phase 4-12 · V1</AdminBadge>}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AdminButton tone="neutral" variant="subtle" size="sm"
            leftIcon={<RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />}
            onClick={() => void refreshAll()} disabled={refreshing}>새로고침</AdminButton>
          <AdminButton tone="primary" size="sm" leftIcon={<Plus size={12} />}
            onClick={() => setShowCreate(true)}>계약 등록</AdminButton>
        </div>
      }
    >
      {/* KPI */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <AdminStatCard label="전체 계약"    value={kpi?.total_contracts  ?? '—'} tone="neutral" icon={<FileSignature size={14} />} />
        <AdminStatCard label="활성 계약"    value={kpi?.active_contracts ?? '—'} tone="success" icon={<CheckCircle2 size={14} />} />
        <AdminStatCard label="30일 이내 만료" value={kpi?.expiring_30d   ?? '—'} tone="warning" icon={<Clock size={14} />} />
        <AdminStatCard label="만료 계약"    value={kpi?.expired_contracts ?? '—'} tone="danger"  icon={<XCircle size={14} />} />
        <AdminStatCard label="자동갱신"    value={kpi?.auto_renew_count ?? '—'} tone="info"    icon={<RefreshCw size={14} />} />
        <AdminStatCard label="해지"        value={kpi?.terminated_count ?? '—'} tone="neutral" icon={<Power size={14} />} />
      </div>

      <AdminSearch
        value={search} onChange={(v) => { setSearch(v); setOffset(0); }}
        placeholder="본사 / 계약명 / 계약번호 / 메모 검색"
        filters={
          <>
            <select value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as ContractStatus | ''); setOffset(0); }}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 상태</option>
              {(Object.keys(STATUS_META) as ContractStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_META[s].ko}</option>
              ))}
            </select>
            <select value={enterpriseFilter}
              onChange={(e) => { setEnterpriseFilter(e.target.value); setOffset(0); }}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">전체 본사</option>
              {enterprises.map((e) => <option key={e.id} value={e.id}>{e.enterprise_name}</option>)}
            </select>
            <select value={autoRenewFilter}
              onChange={(e) => { setAutoRenewFilter(e.target.value as '' | 'true' | 'false'); setOffset(0); }}
              className="rounded-md bg-bg-deep px-2 py-1.5 text-xs">
              <option value="">자동갱신 (전체)</option>
              <option value="true">자동갱신 ON</option>
              <option value="false">자동갱신 OFF</option>
            </select>
            <label className="inline-flex items-center gap-1 text-[11px] text-ink-mute">
              <input type="checkbox" checked={expiringOnly}
                onChange={(e) => { setExpiringOnly(e.target.checked); setOffset(0); }} />
              만료예정만 (30일)
            </label>
          </>
        }
        trailing={<span className="text-[11px] text-ink-mute tabular-nums">{total.toLocaleString()}건</span>}
      />

      {error && (
        <AdminAlert tone="danger" title="조회 실패" description={error}
          action={<AdminButton tone="danger" variant="subtle" size="sm" onClick={() => void load()}>재시도</AdminButton>} />
      )}

      {loading && list.length === 0 ? (
        <AdminSkeleton variant="table" rows={6} />
      ) : !loading && list.length === 0 && !error ? (
        <AdminEmpty icon={<FileSignature size={28} />} title="등록된 계약이 없습니다." description="'계약 등록' 버튼으로 시작하세요." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl bg-bg-card ring-1 ring-line/10 shadow-sm shadow-black/20">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
                  <th className="px-3 py-2">본사</th>
                  <th className="px-3 py-2">계약명 / 번호</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2 text-right">시작일</th>
                  <th className="px-3 py-2 text-right">종료일</th>
                  <th className="px-3 py-2">자동갱신</th>
                  <th className="px-3 py-2 text-right">매장당</th>
                  <th className="px-3 py-2 text-right">수수료율</th>
                  <th className="px-3 py-2 text-right">최근 수정</th>
                  <th className="px-3 py-2">액션</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="cursor-pointer border-b border-line/5 hover:bg-bg-hover/30"
                    onClick={() => void openDetail(c.id)}>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-ink">{c.enterprise_name}</div>
                      {c.manager_email && <div className="text-[10px] text-ink-mute">{c.manager_email}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-ink">{c.contract_name}</div>
                      <div className="text-[10px] text-ink-mute font-mono">{c.contract_no}</div>
                    </td>
                    <td className="px-3 py-2">
                      <AdminBadge tone={STATUS_META[c.computed_status].tone}>{STATUS_META[c.computed_status].ko}</AdminBadge>
                      {c.computed_status !== c.status && (
                        <div className="mt-0.5 text-[10px] text-ink-dim">(저장: {STATUS_META[c.status].ko})</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-[10px] tabular-nums text-ink-mute">{fmtDate(c.start_date)}</td>
                    <td className="px-3 py-2 text-right text-[10px] tabular-nums text-ink-mute">
                      {fmtDate(c.end_date)}
                      {c.days_to_end != null && c.days_to_end >= 0 && c.days_to_end <= 30 && (
                        <div className="text-[10px] text-amber-300">D-{c.days_to_end}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <AdminBadge tone={c.auto_renew ? 'info' : 'neutral'}>{c.auto_renew ? `ON · ${c.renewal_period_month}M` : 'OFF'}</AdminBadge>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtKRW(c.monthly_store_price)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPct(c.commission_rate)}</td>
                    <td className="px-3 py-2 text-right text-[10px] tabular-nums text-ink-mute">{fmtDate(c.updated_at)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <AdminButton tone="primary" variant="ghost" size="sm" leftIcon={<FileText size={11} />}
                          onClick={(e) => { e.stopPropagation(); void openDetail(c.id); }}>상세</AdminButton>
                        <AdminTooltip label="수정">
                          <AdminButton tone="neutral" variant="ghost" size="sm" leftIcon={<Edit3 size={11} />}
                            onClick={(e) => { e.stopPropagation(); setEditing(c); }}>—</AdminButton>
                        </AdminTooltip>
                        {c.status === 'active' && (
                          <AdminTooltip label="해지">
                            <AdminButton tone="warning" variant="ghost" size="sm" leftIcon={<Pause size={11} />}
                              loading={busy === `s:${c.id}`}
                              onClick={(e) => { e.stopPropagation(); void onToggleStatus(c, 'terminated'); }}>—</AdminButton>
                          </AdminTooltip>
                        )}
                        {c.status === 'draft' && (
                          <AdminTooltip label="활성화">
                            <AdminButton tone="success" variant="ghost" size="sm" leftIcon={<CheckCircle2 size={11} />}
                              loading={busy === `s:${c.id}`}
                              onClick={(e) => { e.stopPropagation(); void onToggleStatus(c, 'active'); }}>—</AdminButton>
                          </AdminTooltip>
                        )}
                        <AdminTooltip label="삭제">
                          <AdminButton tone="danger" variant="ghost" size="sm" leftIcon={<Trash2 size={11} />}
                            loading={busy === `d:${c.id}`}
                            onClick={(e) => { e.stopPropagation(); void onDelete(c); }}>—</AdminButton>
                        </AdminTooltip>
                      </div>
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

      {(showCreate || editing) && (
        <ContractFormModal
          mode={editing ? 'edit' : 'create'}
          contract={editing}
          enterprises={enterprises}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={async (msg) => {
            setShowCreate(false); setEditing(null);
            setToast({ tone: 'success', title: '저장됨', body: msg });
            await Promise.all([load(true), loadKpi()]);
          }}
        />
      )}

      {(detail || detailLoading || detailError) && (
        <ContractDetailModal
          detail={detail} loading={detailLoading} error={detailError}
          onClose={closeDetail}
          onChanged={async () => { if (detail) await openDetail(detail.contract.id); await load(true); }}
          onToast={(t) => setToast(t)}
        />
      )}
    </AdminSection>
  );
}

// =============================================================================
// ContractFormModal
// =============================================================================

function ContractFormModal({
  mode, contract, enterprises, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  contract: EnterpriseContract | null;
  enterprises: EnterpriseAccount[];
  onClose: () => void;
  onSaved: (msg: string) => void | Promise<void>;
}) {
  const isEdit = mode === 'edit';
  const [enterpriseId, setEnterpriseId] = useState(contract?.enterprise_account_id ?? '');
  const [contractNo, setContractNo] = useState(contract?.contract_no ?? '');
  const [contractName, setContractName] = useState(contract?.contract_name ?? '');
  const [contractType, setContractType] = useState(contract?.contract_type ?? 'standard');
  const [startDate, setStartDate] = useState(contract?.start_date ?? '');
  const [endDate, setEndDate] = useState(contract?.end_date ?? '');
  const [autoRenew, setAutoRenew] = useState(contract?.auto_renew ?? true);
  const [renewalPeriod, setRenewalPeriod] = useState(contract?.renewal_period_month ?? 12);
  const [status, setStatus] = useState<ContractStatus>(contract?.status ?? 'draft');
  const [monthlyPrice, setMonthlyPrice] = useState<string>(contract?.monthly_store_price?.toString() ?? '');
  const [commission, setCommission] = useState<string>(contract?.commission_rate?.toString() ?? '');
  const [minPayout, setMinPayout] = useState<string>(contract?.minimum_payout?.toString() ?? '');
  const [method, setMethod] = useState<SettlementMethod | ''>(contract?.settlement_method ?? '');
  const [memo, setMemo] = useState(contract?.memo ?? '');
  const [signedAt, setSignedAt] = useState(contract?.signed_at?.slice(0, 10) ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setErr(null);
    if (!isEdit && !enterpriseId) { setErr('본사를 선택해 주세요.'); return; }
    if (!contractNo.trim()) { setErr('계약번호를 입력해 주세요.'); return; }
    if (!contractName.trim()) { setErr('계약명을 입력해 주세요.'); return; }
    if (!isEdit && !startDate) { setErr('시작일을 선택해 주세요.'); return; }
    setBusy(true);
    try {
      if (isEdit && contract) {
        await updateEnterpriseContract({
          id: contract.id,
          contractNo, contractName, contractType,
          startDate: startDate || null, endDate: endDate || null,
          autoRenew, renewalPeriodMonth: renewalPeriod,
          monthlyStorePrice: monthlyPrice ? parseInt(monthlyPrice, 10) : null,
          commissionRate: commission ? parseFloat(commission) : null,
          minimumPayout: minPayout ? parseInt(minPayout, 10) : null,
          settlementMethod: (method || null) as SettlementMethod | null,
          memo: memo || null,
          signedAt: signedAt ? new Date(signedAt + 'T00:00:00').toISOString() : null,
        });
        await onSaved(`계약 수정됨: ${contractName}`);
      } else {
        await createEnterpriseContract({
          enterpriseAccountId: enterpriseId, contractNo, contractName, contractType,
          startDate, endDate: endDate || null, autoRenew, renewalPeriodMonth: renewalPeriod, status,
          monthlyStorePrice: monthlyPrice ? parseInt(monthlyPrice, 10) : null,
          commissionRate: commission ? parseFloat(commission) : null,
          minimumPayout: minPayout ? parseInt(minPayout, 10) : null,
          settlementMethod: (method || null) as SettlementMethod | null,
          memo: memo || null,
          signedAt: signedAt ? new Date(signedAt + 'T00:00:00').toISOString() : null,
        });
        await onSaved(`계약 등록됨: ${contractName}`);
      }
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <AdminModal open onClose={onClose} size="xl"
      title={<span className="flex items-center gap-2">{isEdit ? <Edit3 size={14} /> : <Plus size={14} />} {isEdit ? '계약 수정' : '계약 등록'}</span>}
      footer={
        <>
          <AdminButton tone="neutral" variant="subtle" size="sm" onClick={onClose}>취소</AdminButton>
          <AdminButton tone="primary" size="sm" loading={busy} onClick={() => void onSubmit()}>{isEdit ? '저장' : '등록'}</AdminButton>
        </>
      }>
      <div className="grid gap-3 md:grid-cols-2 text-xs">
        {!isEdit && (
          <Field label="본사 *" full>
            <select value={enterpriseId} onChange={(e) => setEnterpriseId(e.target.value)}
              className="w-full rounded-md bg-bg-deep px-2 py-1.5">
              <option value="">본사를 선택하세요</option>
              {enterprises.map((e) => <option key={e.id} value={e.id}>{e.enterprise_name}</option>)}
            </select>
          </Field>
        )}
        <Field label="계약번호 *">
          <input type="text" value={contractNo} onChange={(e) => setContractNo(e.target.value)}
            placeholder="예) CN-2026-001"
            className="w-full rounded-md bg-bg-deep px-2 py-1.5 font-mono" />
        </Field>
        <Field label="계약명 *">
          <input type="text" value={contractName} onChange={(e) => setContractName(e.target.value)}
            placeholder="예) 쿠우쿠우 본사 표준 계약"
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>
        <Field label="계약 유형">
          <input type="text" value={contractType} onChange={(e) => setContractType(e.target.value)}
            placeholder="standard / custom / pilot"
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>
        {!isEdit && (
          <Field label="상태">
            <select value={status} onChange={(e) => setStatus(e.target.value as ContractStatus)}
              className="w-full rounded-md bg-bg-deep px-2 py-1.5">
              {(Object.keys(STATUS_META) as ContractStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_META[s].ko}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="시작일 *">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>
        <Field label="종료일">
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>
        <Field label="서명일">
          <input type="date" value={signedAt} onChange={(e) => setSignedAt(e.target.value)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>

        <Field label="자동연장">
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
            <span className="text-[11px] text-ink">{autoRenew ? 'ON' : 'OFF'}</span>
          </label>
        </Field>
        <Field label="갱신 주기 (개월)">
          <input type="number" min={1} max={60} value={renewalPeriod}
            onChange={(e) => setRenewalPeriod(parseInt(e.target.value || '12', 10))}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>

        <Field label="매장당 기준 금액 (원, 선택)">
          <input type="number" min={0} value={monthlyPrice} onChange={(e) => setMonthlyPrice(e.target.value)}
            placeholder="비워두면 본사 설정값 사용"
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>
        <Field label="수수료율 % (0~100, 선택)">
          <input type="number" min={0} max={100} step={0.01} value={commission} onChange={(e) => setCommission(e.target.value)}
            placeholder="비워두면 본사 설정값 사용"
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>
        <Field label="최소 정산금 (원, 선택)">
          <input type="number" min={0} value={minPayout} onChange={(e) => setMinPayout(e.target.value)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>
        <Field label="정산 방법 (선택)">
          <select value={method} onChange={(e) => setMethod(e.target.value as SettlementMethod | '')}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5">
            <option value="">본사 설정값 사용</option>
            <option value="monthly">월별</option>
            <option value="weekly">주별</option>
            <option value="manual">수동</option>
          </select>
        </Field>

        <Field label="메모" full>
          <textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)}
            className="w-full rounded-md bg-bg-deep px-2 py-1.5" />
        </Field>

        <AdminAlert tone="info" title="계약 조건 우선순위"
          description="계약 조건(매장당 금액 / 수수료율 / 최소정산금 / 정산방법)이 입력된 경우, 청구서 생성 시 본사 기본 설정값보다 우선 적용됩니다." />
      </div>

      {err && <div className="mt-3"><AdminAlert tone="danger" title="저장 실패" description={err} /></div>}
    </AdminModal>
  );
}

function Field({ label, children, full = false }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block text-xs ${full ? 'md:col-span-2' : ''}`}>
      <span className="text-ink-dim">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}

// =============================================================================
// ContractDetailModal
// =============================================================================

function ContractDetailModal({
  detail, loading, error, onClose, onChanged, onToast,
}: {
  detail: ContractDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onToast: (t: { tone: 'success'|'warning'|'danger'|'info'; title: string; body?: string }) => void;
}) {
  const c = detail?.contract;
  const [busy, setBusy] = useState(false);

  const onUpload = async (file: File) => {
    if (!c) return;
    setBusy(true);
    try {
      const r = await uploadContractFile(c.id, file);
      await recordContractFile(c.id, {
        fileName: file.name, fileUrl: r.publicUrl, filePath: r.path,
        mimeType: r.mimeType, fileSize: r.sizeBytes,
      });
      onToast({ tone: 'success', title: '파일 업로드 완료', body: file.name });
      await onChanged();
    } catch (e) { onToast({ tone: 'danger', title: '업로드 실패', body: (e as Error).message }); }
    finally { setBusy(false); }
  };

  // 0394 — 버킷 private 전환: file_path 로 만료형 signed URL 발급 후 새 탭 열기
  const onOpenFile = async (filePath: string | null) => {
    if (!filePath) { onToast({ tone: 'danger', title: '열기 실패', body: '파일 경로가 없습니다.' }); return; }
    try {
      const url = await getContractFileSignedUrl(filePath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) { onToast({ tone: 'danger', title: '파일 열기 실패', body: (e as Error).message }); }
  };

  const onDeleteFile = async (fileId: string, fileName: string) => {
    if (!window.confirm(`"${fileName}" 파일을 삭제하시겠습니까?`)) return;
    setBusy(true);
    try {
      await deleteContractFile(fileId);
      onToast({ tone: 'warning', title: '파일 삭제됨', body: fileName });
      await onChanged();
    } catch (e) { onToast({ tone: 'danger', title: '삭제 실패', body: (e as Error).message }); }
    finally { setBusy(false); }
  };

  return (
    <AdminModal open onClose={onClose} size="xl"
      title={<span className="flex items-center gap-2"><FileSignature size={14} /> 계약 상세 — {c?.contract_name ?? '...'}</span>}
      headerExtra={c && <AdminBadge tone={STATUS_META[c.computed_status].tone}>{STATUS_META[c.computed_status].ko}</AdminBadge>}
      footer={<AdminButton tone="neutral" variant="ghost" size="sm" onClick={onClose}>닫기</AdminButton>}>
      {loading ? (
        <AdminSkeleton variant="block" rows={6} />
      ) : error ? (
        <AdminAlert tone="danger" title="상세 로드 실패" description={error} />
      ) : detail && c ? (
        <div className="space-y-3 text-xs">
          {/* Summary */}
          <div className="grid gap-2 md:grid-cols-3">
            <KV label="본사" value={c.enterprise_name ?? '—'} />
            <KV label="계약번호" value={<code className="font-mono">{c.contract_no}</code>} />
            <KV label="계약 유형" value={c.contract_type} />
            <KV label="시작일" value={fmtDate(c.start_date)} />
            <KV label="종료일" value={fmtDate(c.end_date)} />
            <KV label="서명일" value={c.signed_at ? fmtDate(c.signed_at) : '—'} />
            <KV label="자동연장" value={c.auto_renew ? `ON · ${c.renewal_period_month}개월` : 'OFF'} />
            <KV label="저장 상태" value={STATUS_META[c.status].ko} />
            <KV label="계산 상태 (오늘 기준)" value={STATUS_META[c.computed_status].ko} />
          </div>

          {/* 계약 조건 */}
          <div className="rounded-xl bg-bg-deep/40 p-3 ring-1 ring-line/10">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-mute">계약 조건</div>
            <div className="grid gap-2 md:grid-cols-2">
              <KV label="매장당 기준 금액" value={c.monthly_store_price != null ? fmtKRW(c.monthly_store_price) : <span className="text-ink-dim">본사 설정값 사용</span>} />
              <KV label="수수료율"      value={c.commission_rate    != null ? fmtPct(c.commission_rate) : <span className="text-ink-dim">본사 설정값 사용</span>} />
              <KV label="최소 정산금"    value={c.minimum_payout     != null ? fmtKRW(c.minimum_payout) : <span className="text-ink-dim">본사 설정값 사용</span>} />
              <KV label="정산 방법"      value={c.settlement_method ?? <span className="text-ink-dim">본사 설정값 사용</span>} />
            </div>
          </div>

          {/* 메모 */}
          {c.memo && (
            <div className="rounded-xl bg-bg-deep/40 p-3 ring-1 ring-line/10">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-mute">메모</div>
              <p className="whitespace-pre-line text-ink">{c.memo}</p>
            </div>
          )}

          {/* 첨부파일 */}
          <div className="rounded-xl bg-bg-deep/40 p-3 ring-1 ring-line/10">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11px] font-bold uppercase tracking-wider text-ink-mute">첨부파일 ({detail.files.length})</div>
              <label className="inline-flex items-center gap-1 cursor-pointer rounded-md bg-violet-500/25 px-2 py-1 text-[11px] font-bold text-violet-200 hover:bg-violet-500/35">
                <Upload size={11} />
                {busy ? '업로드 중…' : '파일 추가'}
                <input type="file" hidden accept={CONTRACT_ALLOWED_MIME.join(',')}
                  disabled={busy}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUpload(f); e.target.value = ''; }} />
              </label>
            </div>
            <p className="mb-2 text-[10px] text-ink-dim">
              PDF / DOCX / DOC / JPG / PNG 허용 · 최대 {CONTRACT_MAX_BYTES / 1024 / 1024}MB
            </p>
            {detail.files.length === 0 ? (
              <div className="rounded bg-bg-deep px-3 py-3 text-center text-[11px] text-ink-mute">첨부파일이 없습니다.</div>
            ) : (
              <ul className="space-y-1">
                {detail.files.map((f) => (
                  <li key={f.id} className="flex items-center justify-between rounded bg-bg-deep/60 px-2 py-1.5">
                    <button type="button" onClick={() => void onOpenFile(f.file_path)}
                      className="flex items-center gap-2 text-[11px] text-ink hover:underline text-left">
                      <FileText size={11} />
                      <span className="truncate max-w-[280px]">{f.file_name}</span>
                      <span className="text-[10px] text-ink-mute">{fmtBytes(f.file_size)}</span>
                    </button>
                    <AdminButton tone="danger" variant="ghost" size="sm" leftIcon={<Trash2 size={11} />}
                      loading={busy} onClick={() => void onDeleteFile(f.id, f.file_name)}>—</AdminButton>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-[10px] text-ink-dim">
            * 계약 조건은 청구서 생성 시 본사 기본 설정값(`enterprise_settlement_profiles`) 보다 우선 적용됩니다.
          </p>
        </div>
      ) : null}
    </AdminModal>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-bg-deep/40 p-2 ring-1 ring-line/10">
      <div className="text-[10px] uppercase tracking-wider text-ink-mute">{label}</div>
      <div className="mt-0.5 truncate text-xs font-semibold text-ink">{value}</div>
    </div>
  );
}

// Reserved for future
void AlertCircle;
