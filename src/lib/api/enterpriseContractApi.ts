/**
 * enterpriseContractApi — Enterprise Contract Management V1 (Phase 4-12).
 * SQL: supabase/migrations/0383_enterprise_contracts_v1.sql
 */
import { supabase } from '@/lib/supabase';

export const CONTRACT_BUCKET = 'enterprise-contracts';
export const CONTRACT_MAX_BYTES = 20 * 1024 * 1024; // 20MB
export const CONTRACT_ALLOWED_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png',
];

export type ContractStatus = 'draft' | 'active' | 'expiring' | 'expired' | 'terminated';
export type SettlementMethod = 'monthly' | 'weekly' | 'manual';

export interface EnterpriseContract {
  id: string;
  enterprise_account_id: string;
  enterprise_name: string | null;
  manager_email: string | null;
  contract_no: string;
  contract_name: string;
  contract_type: string;
  start_date: string;
  end_date: string | null;
  auto_renew: boolean;
  renewal_period_month: number;
  status: ContractStatus;
  computed_status: ContractStatus;
  monthly_store_price: number | null;
  commission_rate: number | null;
  minimum_payout: number | null;
  settlement_method: SettlementMethod | null;
  memo: string | null;
  signed_at: string | null;
  file_count: number;
  days_to_end: number | null;
  created_at: string;
  updated_at: string;
}

export interface EnterpriseContractFile {
  id: string;
  contract_id: string;
  file_name: string;
  file_url: string;
  file_path: string;
  mime_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface ContractListParams {
  search?: string | null;
  status?: ContractStatus | null;
  enterpriseAccountId?: string | null;
  autoRenew?: boolean | null;
  expiringOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface ContractListResponse {
  success: boolean;
  data: EnterpriseContract[];
  pagination: { total: number; limit: number; offset: number; has_more: boolean };
  today: string;
  computed_at: string;
}

export interface ContractDetail {
  success: boolean;
  contract: EnterpriseContract;
  files: EnterpriseContractFile[];
  computed_at: string;
}

export interface ContractKpi {
  total_contracts: number;
  active_contracts: number;
  expiring_30d: number;
  expired_contracts: number;
  auto_renew_count: number;
  terminated_count: number;
  computed_at: string;
}

export interface ContractCreateInput {
  enterpriseAccountId: string;
  contractNo: string;
  contractName: string;
  startDate: string;                   // YYYY-MM-DD
  contractType?: string;
  endDate?: string | null;
  autoRenew?: boolean;
  renewalPeriodMonth?: number;
  status?: ContractStatus;
  monthlyStorePrice?: number | null;
  commissionRate?: number | null;
  minimumPayout?: number | null;
  settlementMethod?: SettlementMethod | null;
  memo?: string | null;
  signedAt?: string | null;
}

export interface ContractUpdateInput {
  id: string;
  contractNo?: string | null;
  contractName?: string | null;
  contractType?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  autoRenew?: boolean | null;
  renewalPeriodMonth?: number | null;
  monthlyStorePrice?: number | null;
  commissionRate?: number | null;
  minimumPayout?: number | null;
  settlementMethod?: SettlementMethod | null;
  memo?: string | null;
  signedAt?: string | null;
}

export interface HqContractSummary {
  success: boolean;
  enterprise_account_id: string;
  active_contract: (EnterpriseContract & { days_to_end: number | null }) | null;
  recent_contracts: Array<{
    id: string; contract_no: string; contract_name: string;
    start_date: string; end_date: string | null; status: ContractStatus;
  }>;
  computed_at: string;
}

// =============================================================================
// Storage upload helper (admin)
// =============================================================================

export async function uploadContractFile(
  contractId: string, file: File,
): Promise<{ path: string; publicUrl: string; sizeBytes: number; mimeType: string }> {
  if (!file) throw new Error('파일이 비어 있습니다.');
  if (file.size > CONTRACT_MAX_BYTES) {
    throw new Error(`파일이 20MB 를 초과합니다 (${(file.size / 1024 / 1024).toFixed(1)}MB).`);
  }
  if (file.type && !CONTRACT_ALLOWED_MIME.includes(file.type)) {
    throw new Error(`허용되지 않는 형식입니다: ${file.type}`);
  }
  const uuid = crypto.randomUUID();
  const safeName = file.name.replace(/[^\w.-]+/g, '_').slice(0, 80);
  const path = `contracts/${contractId}/${uuid}-${safeName}`;

  const { error } = await supabase.storage
    .from(CONTRACT_BUCKET)
    .upload(path, file, {
      contentType: file.type || 'application/pdf',
      upsert: false,
    });
  if (error) throw new Error(`storage upload 실패: ${error.message}`);
  const { data } = supabase.storage.from(CONTRACT_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('public URL 생성 실패');
  return { path, publicUrl: data.publicUrl, sizeBytes: file.size, mimeType: file.type || 'application/pdf' };
}

// =============================================================================
// Admin RPCs
// =============================================================================

export async function listEnterpriseContracts(params: ContractListParams = {}): Promise<ContractListResponse> {
  const { data, error } = await supabase.rpc('admin_list_enterprise_contracts', {
    p_search:                params.search ?? null,
    p_status:                params.status ?? null,
    p_enterprise_account_id: params.enterpriseAccountId ?? null,
    p_auto_renew:            params.autoRenew ?? null,
    p_expiring_only:         params.expiringOnly ?? false,
    p_limit:                 params.limit ?? 50,
    p_offset:                params.offset ?? 0,
  });
  if (error) { console.error('[contractApi] list failed', error); throw error; }
  return data as ContractListResponse;
}

export async function getEnterpriseContract(id: string): Promise<ContractDetail> {
  const { data, error } = await supabase.rpc('admin_get_enterprise_contract', { p_id: id });
  if (error) { console.error('[contractApi] get failed', error); throw error; }
  return data as ContractDetail;
}

export async function createEnterpriseContract(input: ContractCreateInput): Promise<{ success: boolean; contract_id: string }> {
  const { data, error } = await supabase.rpc('admin_create_enterprise_contract', {
    p_enterprise_account_id: input.enterpriseAccountId,
    p_contract_no:           input.contractNo,
    p_contract_name:         input.contractName,
    p_start_date:            input.startDate,
    p_contract_type:         input.contractType ?? 'standard',
    p_end_date:              input.endDate ?? null,
    p_auto_renew:            input.autoRenew ?? true,
    p_renewal_period_month:  input.renewalPeriodMonth ?? 12,
    p_status:                input.status ?? 'draft',
    p_monthly_store_price:   input.monthlyStorePrice ?? null,
    p_commission_rate:       input.commissionRate ?? null,
    p_minimum_payout:        input.minimumPayout ?? null,
    p_settlement_method:     input.settlementMethod ?? null,
    p_memo:                  input.memo ?? null,
    p_signed_at:             input.signedAt ?? null,
  });
  if (error) { console.error('[contractApi] create failed', error); throw error; }
  return data as { success: boolean; contract_id: string };
}

export async function updateEnterpriseContract(input: ContractUpdateInput): Promise<void> {
  const { error } = await supabase.rpc('admin_update_enterprise_contract', {
    p_id:                   input.id,
    p_contract_no:          input.contractNo ?? null,
    p_contract_name:        input.contractName ?? null,
    p_contract_type:        input.contractType ?? null,
    p_start_date:           input.startDate ?? null,
    p_end_date:             input.endDate ?? null,
    p_auto_renew:           input.autoRenew ?? null,
    p_renewal_period_month: input.renewalPeriodMonth ?? null,
    p_monthly_store_price:  input.monthlyStorePrice ?? null,
    p_commission_rate:      input.commissionRate ?? null,
    p_minimum_payout:       input.minimumPayout ?? null,
    p_settlement_method:    input.settlementMethod ?? null,
    p_memo:                 input.memo ?? null,
    p_signed_at:            input.signedAt ?? null,
  });
  if (error) { console.error('[contractApi] update failed', error); throw error; }
}

export async function setEnterpriseContractStatus(
  id: string, status: ContractStatus,
): Promise<{ success: boolean; contract_id: string; status: ContractStatus; previous_status: ContractStatus }> {
  const { data, error } = await supabase.rpc('admin_set_enterprise_contract_status', { p_id: id, p_status: status });
  if (error) { console.error('[contractApi] set_status failed', error); throw error; }
  return data as { success: boolean; contract_id: string; status: ContractStatus; previous_status: ContractStatus };
}

export async function softDeleteEnterpriseContract(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_soft_delete_enterprise_contract', { p_id: id });
  if (error) { console.error('[contractApi] soft_delete failed', error); throw error; }
}

export async function recordContractFile(
  contractId: string,
  meta: { fileName: string; fileUrl: string; filePath: string; mimeType?: string | null; fileSize?: number | null },
): Promise<{ success: boolean; file_id: string }> {
  const { data, error } = await supabase.rpc('admin_upload_contract_file', {
    p_contract_id: contractId,
    p_file_name:   meta.fileName,
    p_file_url:    meta.fileUrl,
    p_file_path:   meta.filePath,
    p_mime_type:   meta.mimeType ?? null,
    p_file_size:   meta.fileSize ?? null,
  });
  if (error) { console.error('[contractApi] file metadata insert failed', error); throw error; }
  return data as { success: boolean; file_id: string };
}

export async function deleteContractFile(fileId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_contract_file', { p_file_id: fileId });
  if (error) { console.error('[contractApi] file delete failed', error); throw error; }
}

export async function getContractKpi(): Promise<ContractKpi> {
  const { data, error } = await supabase.rpc('admin_contract_kpi');
  if (error) { console.error('[contractApi] kpi failed', error); throw error; }
  return data as ContractKpi;
}

// =============================================================================
// HQ read-only
// =============================================================================

export async function getMyEnterpriseContract(): Promise<HqContractSummary> {
  const { data, error } = await supabase.rpc('get_my_enterprise_contract');
  if (error) { console.error('[contractApi] hq contract failed', error); throw error; }
  return data as HqContractSummary;
}
