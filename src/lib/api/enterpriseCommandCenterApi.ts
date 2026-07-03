/**
 * enterpriseCommandCenterApi — Phase 4
 *
 * Enterprise Command Center 전용 **조합 wrapper**.
 * 신규 backend/RPC/migration 없음 — 기존 wrapper 를 client-side 에서 aggregation.
 *
 * 절대 무수정:
 *   • 기존 wrapper (enterpriseAccountsApi / enterpriseContractApi /
 *     enterpriseBillingApi / enterpriseMonthlySettlementApi / enterpriseOperationsApi /
 *     enterpriseBrandRegistryApi / enterpriseSettlementCenterApi) 시그니처 무영향.
 *   • Settlement 계산식 / Contract Snapshot / Cron / Dispatch / Policy 무관.
 *   • Migration / RPC 신규 없음.
 */
import {
  adminListEnterpriseAccounts, adminEnterpriseAccountKpi,
  type EnterpriseAccount, type EnterpriseAccountKpi,
} from './enterpriseAccountsApi';
import {
  listEnterpriseContracts, getContractKpi,
  type EnterpriseContract, type ContractKpi,
} from './enterpriseContractApi';
import {
  listBillingInvoices,
  type BillingInvoice,
} from './enterpriseBillingApi';
import {
  adminListEnterpriseMonthlySettlements,
  currentMonthFirstDay,
  type EnterpriseMonthlySettlementRow,
} from './enterpriseMonthlySettlementApi';
import {
  fetchEnterpriseOpsOverview, fetchEnterpriseOpsActivityFeed,
  type EnterpriseOpsOverview, type EnterpriseOpsActivityFeed, type EnterpriseOpsActivityEvent,
} from './enterpriseOperationsApi';
import {
  adminListBrandRegistry,
  type BrandRegistryRow,
} from './enterpriseBrandRegistryApi';

// ============================================================================
// KPI (spec 2) — 14개 지표
// ============================================================================

export interface CommandCenterKpi {
  // Enterprise
  total_enterprises: number;
  active_enterprises: number;
  pending_approvals: number;
  // Contracts
  total_contracts: number;
  active_contracts: number;
  expiring_contracts: number;
  // Billing / Settlement (this month)
  this_month_billing_count: number;
  this_month_settlement_count: number;
  this_month_revenue: number;
  unpaid_amount: number;
  // Stores
  total_stores: number;
  online_stores: number;
  offline_stores: number;
  drift_stores: number;
  computed_at: string;
}

/**
 * 14개 KPI 를 한 번에 집계. 기존 RPC 를 병렬 호출 후 client-side 조합.
 * 새 계산식 없음. 각 값은 이미 기존 RPC 결과에 존재하는 것만 사용.
 */
export async function fetchCommandCenterKpi(): Promise<CommandCenterKpi> {
  const [accountKpi, invitedList, contractKpi, thisMonthBilling, thisMonthSettlement, overview, unpaidList] =
    await Promise.all([
      adminEnterpriseAccountKpi().catch(() => null),
      adminListEnterpriseAccounts({ status: 'invited', limit: 500 }).catch(() => null),
      getContractKpi().catch(() => null),
      listBillingInvoices({ billingMonth: currentMonthFirstDay(), limit: 200 }).catch(() => null),
      adminListEnterpriseMonthlySettlements({ month: currentMonthFirstDay(), limit: 200 }).catch(() => null),
      fetchEnterpriseOpsOverview().catch(() => null),
      listBillingInvoices({ status: 'overdue', limit: 200 }).catch(() => null),
    ]);

  const thisMonthInvoices = thisMonthBilling?.data ?? [];
  const thisMonthRevenue = thisMonthInvoices
    .filter((i) => i.status === 'paid' || i.status === 'issued')
    .reduce((acc, i) => acc + (i.total_amount ?? 0), 0);
  const unpaidAmount = (unpaidList?.data ?? [])
    .reduce((acc, i) => acc + (i.total_amount ?? 0), 0);

  return {
    total_enterprises:            accountKpi?.total ?? 0,
    active_enterprises:           accountKpi?.active ?? 0,
    pending_approvals:            (invitedList?.data ?? []).filter(
      (a) => (a as EnterpriseAccount & { auto_onboarded?: boolean }).auto_onboarded === true,
    ).length,
    total_contracts:              contractKpi?.total_contracts ?? 0,
    active_contracts:             contractKpi?.active_contracts ?? 0,
    expiring_contracts:           contractKpi?.expiring_30d ?? 0,
    this_month_billing_count:     thisMonthInvoices.length,
    this_month_settlement_count:  (thisMonthSettlement?.rows ?? []).length,
    this_month_revenue:           thisMonthRevenue,
    unpaid_amount:                unpaidAmount,
    total_stores:                 overview?.total_stores ?? 0,
    online_stores:                overview?.online_stores ?? 0,
    offline_stores:               overview?.offline_stores ?? 0,
    drift_stores:                 overview?.drift_stores ?? 0,
    computed_at:                  new Date().toISOString(),
  };
}

// ============================================================================
// Brand Overview list (spec 3)
// ============================================================================

export interface BrandOverviewRow {
  brand_id: string;                            // enterprise_brand_registry.id (nullable if legacy)
  enterprise_account_id: string | null;        // linked enterprise_accounts.id
  brand_name: string;
  brand_code: string;
  is_active: boolean;
  status: 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'INACTIVE';
  contract_status: EnterpriseContract['status'] | 'no_contract';
  next_due_date: string | null;
  unpaid_count: number;
  unpaid_amount: number;
  updated_at: string;
}

/**
 * 브랜드 카드 목록. 기존 Brand Registry + Enterprise Accounts + Billing 을 client 조합.
 * 새 계산식 없음. 매장 수 / 온라인 오프라인 은 KPI 로만 노출 (per-brand 계산은 기존 API 미제공).
 */
export async function fetchBrandOverviewList(): Promise<BrandOverviewRow[]> {
  const [brands, accounts, contracts, overdue] = await Promise.all([
    adminListBrandRegistry({ limit: 200 }).catch(() => ({ data: [] as BrandRegistryRow[], total: 0, limit: 200, offset: 0, success: true })),
    adminListEnterpriseAccounts({ limit: 500 }).catch(() => ({ data: [] as EnterpriseAccount[], success: true, pagination: { total: 0, limit: 500, offset: 0, has_more: false } })),
    listEnterpriseContracts({ limit: 500 }).catch(() => ({ data: [] as EnterpriseContract[], success: true, pagination: { total: 0, limit: 500, offset: 0, has_more: false }, today: '', computed_at: '' })),
    listBillingInvoices({ status: 'overdue', limit: 500 }).catch(() => ({ data: [] as BillingInvoice[], success: true, pagination: { total: 0, limit: 500, offset: 0, has_more: false }, computed_at: '' })),
  ]);

  const accountByBrandRegistry = new Map<string, EnterpriseAccount>();
  const accountByBrandCode = new Map<string, EnterpriseAccount>();
  for (const a of (accounts.data ?? [])) {
    const brandRegistryId = (a as EnterpriseAccount & { brand_registry_id?: string }).brand_registry_id;
    if (brandRegistryId) accountByBrandRegistry.set(brandRegistryId, a);
    if (a.brand_code) accountByBrandCode.set(a.brand_code.toUpperCase(), a);
  }

  const contractByEnterprise = new Map<string, EnterpriseContract>();
  for (const c of (contracts.data ?? [])) {
    if (!contractByEnterprise.has(c.enterprise_account_id)) contractByEnterprise.set(c.enterprise_account_id, c);
  }

  const overdueByEnterprise = new Map<string, { count: number; amount: number; earliest: string | null }>();
  for (const inv of (overdue.data ?? [])) {
    const key = inv.enterprise_account_id;
    const cur = overdueByEnterprise.get(key) ?? { count: 0, amount: 0, earliest: null };
    cur.count += 1;
    cur.amount += (inv.total_amount ?? 0);
    if (inv.due_date && (!cur.earliest || inv.due_date < cur.earliest)) cur.earliest = inv.due_date;
    overdueByEnterprise.set(key, cur);
  }

  const rows: BrandOverviewRow[] = [];
  for (const b of (brands.data ?? [])) {
    const account =
      accountByBrandRegistry.get(b.id)
      ?? accountByBrandCode.get(b.brand_code.toUpperCase())
      ?? null;
    const contract = account ? contractByEnterprise.get(account.id) ?? null : null;
    const overdueInfo = account ? overdueByEnterprise.get(account.id) : undefined;
    rows.push({
      brand_id: b.id,
      enterprise_account_id: account?.id ?? null,
      brand_name: b.brand_name,
      brand_code: b.brand_code,
      is_active: b.is_active,
      status:
        !account ? 'INACTIVE'
        : account.status === 'active' ? 'ACTIVE'
        : account.status === 'suspended' ? 'SUSPENDED'
        : account.status === 'invited' ? 'PENDING'
        : 'INACTIVE',
      contract_status: contract?.status ?? 'no_contract',
      next_due_date: overdueInfo?.earliest ?? null,
      unpaid_count: overdueInfo?.count ?? 0,
      unpaid_amount: overdueInfo?.amount ?? 0,
      updated_at: b.updated_at,
    });
  }
  return rows;
}

// ============================================================================
// Brand Detail (spec 4) — 하나의 브랜드에 대해 모든 관련 read-only 정보
// ============================================================================

export interface BrandDetailBundle {
  brand: BrandRegistryRow;
  enterprise_account: EnterpriseAccount | null;
  contract: EnterpriseContract | null;
  recent_billing: BillingInvoice[];
  recent_settlements: EnterpriseMonthlySettlementRow[];
  recent_activity: EnterpriseOpsActivityEvent[];
}

export async function fetchBrandDetail(brandId: string): Promise<BrandDetailBundle | null> {
  const [brands, accounts, activity] = await Promise.all([
    adminListBrandRegistry({ limit: 200 }).catch(() => null),
    adminListEnterpriseAccounts({ limit: 500 }).catch(() => null),
    fetchEnterpriseOpsActivityFeed(20).catch(() => null),
  ]);
  const brand = (brands?.data ?? []).find((b) => b.id === brandId);
  if (!brand) return null;

  const account = (accounts?.data ?? []).find((a) => {
    const brandRegistryId = (a as EnterpriseAccount & { brand_registry_id?: string }).brand_registry_id;
    return brandRegistryId === brand.id || a.brand_code === brand.brand_code;
  }) ?? null;

  const [contractList, billing, settlements] = await Promise.all([
    account
      ? listEnterpriseContracts({ enterpriseAccountId: account.id, limit: 5 }).catch(() => null)
      : Promise.resolve(null),
    account
      ? listBillingInvoices({ enterpriseAccountId: account.id, limit: 10 }).catch(() => null)
      : Promise.resolve(null),
    // Settlement RPC 시그니처는 enterprise 필터를 받지 않음 → 전체 조회 후 client 필터.
    account
      ? adminListEnterpriseMonthlySettlements({ limit: 100 }).catch(() => null)
      : Promise.resolve(null),
  ]);

  return {
    brand,
    enterprise_account: account,
    contract: contractList?.data?.[0] ?? null,
    recent_billing: billing?.data ?? [],
    recent_settlements: (settlements?.rows ?? []).filter(
      (r) => account && r.enterprise_account_id === account.id,
    ).slice(0, 10),
    recent_activity: (activity?.events ?? []).slice(0, 10),
  };
}

// ============================================================================
// Timeline (spec 5) — 기존 activity feed 재사용
// ============================================================================

export async function fetchCommandCenterTimeline(limit = 20): Promise<EnterpriseOpsActivityEvent[]> {
  const feed = await fetchEnterpriseOpsActivityFeed(limit).catch(() => null);
  return feed?.events ?? [];
}

// ============================================================================
// Alerts (spec 6)
// ============================================================================

export type AlertLevel = 'critical' | 'warning' | 'info';

export interface CommandCenterAlert {
  key: string;
  level: AlertLevel;
  label: string;
  count: number;
  action_tab?: string;   // 클릭 시 이동할 탭 key
}

export async function fetchCommandCenterAlerts(): Promise<CommandCenterAlert[]> {
  const [pending, contractKpi, overdue, overview] = await Promise.all([
    adminListEnterpriseAccounts({ status: 'invited', limit: 100 }).catch(() => null),
    getContractKpi().catch(() => null),
    listBillingInvoices({ status: 'overdue', limit: 100 }).catch(() => null),
    fetchEnterpriseOpsOverview().catch(() => null),
  ]);

  const pendingApprovals = (pending?.data ?? []).filter(
    (a) => (a as EnterpriseAccount & { auto_onboarded?: boolean }).auto_onboarded === true,
  ).length;

  const alerts: CommandCenterAlert[] = [];
  if (pendingApprovals > 0)   alerts.push({ key: 'pending_approvals', level: 'warning', label: '승인 대기', count: pendingApprovals, action_tab: 'brand-registry' });
  const expiring = contractKpi?.expiring_30d ?? 0;
  if (expiring > 0)           alerts.push({ key: 'expiring_contracts', level: 'warning', label: '30일 내 만료', count: expiring, action_tab: 'enterprise-contracts' });
  const overdueCount = (overdue?.data ?? []).length;
  if (overdueCount > 0)       alerts.push({ key: 'overdue_billing', level: 'critical', label: 'Billing 미납', count: overdueCount, action_tab: 'enterprise-settlement-center' });
  const offline = overview?.offline_stores ?? 0;
  if (offline > 0)            alerts.push({ key: 'offline_stores', level: 'warning', label: '오프라인 매장', count: offline, action_tab: 'store-monitoring' });
  const drift = overview?.drift_stores ?? 0;
  if (drift > 0)              alerts.push({ key: 'drift_stores', level: 'warning', label: '정책 미동기', count: drift, action_tab: 'policy-deployment' });
  const noc = (overview?.noc?.critical as number | undefined) ?? 0;
  if (noc > 0)                alerts.push({ key: 'noc_critical', level: 'critical', label: 'NOC Critical', count: noc, action_tab: 'enterprise-noc' });
  return alerts;
}

// ============================================================================
// Global Search (spec 8) — 기존 데이터에서 client-side 필터링
// ============================================================================

export interface SearchHit {
  category: 'brand' | 'contract' | 'enterprise' | 'store';
  id: string;
  label: string;
  sub_label?: string;
  action_tab?: string;
  action_brand_id?: string;   // brand-registry 로 이동하면서 이 id 를 열기
}

export async function fetchGlobalSearch(query: string): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const [brands, contracts, accounts] = await Promise.all([
    adminListBrandRegistry({ search: q, limit: 20 }).catch(() => null),
    listEnterpriseContracts({ search: q, limit: 20 }).catch(() => null),
    adminListEnterpriseAccounts({ search: q, limit: 20 }).catch(() => null),
  ]);

  const hits: SearchHit[] = [];
  for (const b of (brands?.data ?? [])) {
    hits.push({
      category: 'brand', id: b.id,
      label: `${b.brand_name} (${b.brand_code})`,
      sub_label: b.business_name,
      action_tab: 'brand-registry',
      action_brand_id: b.id,
    });
  }
  for (const c of (contracts?.data ?? [])) {
    hits.push({
      category: 'contract', id: c.id,
      label: `${c.contract_no} · ${c.enterprise_name ?? '(브랜드 없음)'}`,
      sub_label: `${c.status} · ${c.start_date}`,
      action_tab: 'enterprise-contracts',
    });
  }
  for (const a of (accounts?.data ?? [])) {
    hits.push({
      category: 'enterprise', id: a.id,
      label: `${a.enterprise_name}`,
      sub_label: `${a.manager_email} · ${a.status}`,
      action_tab: 'enterprise-accounts',
    });
  }
  return hits.slice(0, 30);
}

// ============================================================================
// Quick Actions (spec 7)
// ============================================================================

export interface QuickActionLink {
  key: string;
  label: string;
  target_tab: string;
}

export const QUICK_ACTION_LINKS: QuickActionLink[] = [
  { key: 'create_brand',       label: '브랜드 생성',   target_tab: 'brand-registry' },
  { key: 'create_contract',    label: '계약 생성',     target_tab: 'enterprise-contracts' },
  { key: 'create_billing',     label: 'Billing 생성',  target_tab: 'enterprise-billing' },
  { key: 'create_settlement',  label: 'Settlement 생성', target_tab: 'enterprise-settlement-center' },
  { key: 'policy_deploy',      label: 'Policy 배포',   target_tab: 'policy-deployment' },
  { key: 'emergency_broadcast', label: '긴급공지',    target_tab: 'enterprise-emergency' },
  { key: 'dispatch',           label: 'Dispatch',      target_tab: 'enterprise-operations' },
];

// ============================================================================
// Re-exports (편의)
// ============================================================================
export type {
  EnterpriseAccount, EnterpriseAccountKpi,
  EnterpriseContract, ContractKpi,
  BillingInvoice, EnterpriseMonthlySettlementRow,
  EnterpriseOpsOverview, EnterpriseOpsActivityFeed, EnterpriseOpsActivityEvent,
  BrandRegistryRow,
};
