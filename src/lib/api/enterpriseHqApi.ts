/**
 * enterpriseHqApi — Phase 1-7
 *
 * Phase 1-6 invite-code 가입으로 enterprise_accounts.auth_user_id 매칭된
 * HQ 사용자 / 매장 사용자 셀프 dashboard + 본사 사업자 정보 wrapper.
 *
 * 기존 enterpriseAccountsApi.ts (admin 전용) 와 분리 — 사용자(authenticated)
 * 본인 행만 접근하는 셀프 RPC 만 모음.
 *
 * SQL: supabase/migrations/0364_enterprise_hq_profile_dashboard.sql
 */
import { supabase } from '@/lib/supabase';
import {
  ENTERPRISE_DOCUMENT_BUCKET,
  ENTERPRISE_DOCUMENT_SIGNED_URL_TTL,
  type SettlementMethod,
  type SettlementStatus,
} from '@/lib/enterprisePlaceholders';

// =============================================================================
// Types — role / store info
// =============================================================================

export type EnterpriseHqRole =
  | { is_hq: false }
  | {
      is_hq: true;
      enterprise_account_id: string;
      enterprise_name: string;
      brand_code: string | null;
      status: 'active' | 'invited' | 'suspended' | 'inactive';
    };

export type EnterpriseStoreInfo =
  | { is_store: false }
  | {
      is_store: true;
      store_name: string | null;
      store_status: 'active' | 'inactive' | 'suspended';
      franchise_id: string;
      franchise_name: string;
      region_name: string | null;
      region_code: string | null;
      enterprise_account_id: string | null;
      enterprise_name: string | null;
      brand_code: string | null;
    };

// =============================================================================
// Types — dashboard
// =============================================================================

export interface EnterpriseBusinessProfile {
  id: string;
  enterprise_account_id: string;
  company_name: string | null;
  business_number: string | null;
  representative_name: string | null;
  business_address: string | null;
  contact_phone: string | null;
  tax_invoice_email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnterpriseHqFranchiseSummary {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  role: 'primary' | 'secondary';
  store_count: number;
}

export interface EnterpriseHqRegionSummary {
  id: string;
  region_name: string;
  region_code: string | null;
  status: string;
}

export interface EnterpriseHqRecentStore {
  store_id: string;
  store_name: string | null;
  franchise_name: string;
  region_name: string | null;
  joined_at: string | null;
  status: string;
}

export interface EnterpriseHqDashboardAccount {
  id: string;
  enterprise_name: string;
  brand_code: string | null;
  manager_name: string;
  manager_email: string;
  manager_phone: string | null;
  role: string;
  status: 'active' | 'invited' | 'suspended' | 'inactive';
  onboarding_enabled: boolean;
  allow_self_register_region: boolean;
  hq_invite_code: string | null;
  store_invite_code: string | null;
  invite_code_rotated_at: string | null;
  last_login_at: string | null;
}

export interface EnterpriseHqStoreStats {
  total: number;
  active: number;
  inactive: number;
  suspended: number;
  joined_7d: number;
}

export interface EnterpriseHqRegionDistributionItem {
  region_id: string | null;
  region_name: string;
  region_code: string | null;
  region_status: string;
  active_count: number;
  total_count: number;
}

export interface EnterpriseHqDashboard {
  success: boolean;
  enterprise_account: EnterpriseHqDashboardAccount;
  franchises: EnterpriseHqFranchiseSummary[];
  regions: EnterpriseHqRegionSummary[];
  store_count: number;
  // Phase 1-9 additions (optional for back-compat)
  store_stats?: EnterpriseHqStoreStats;
  region_distribution?: EnterpriseHqRegionDistributionItem[];
  recent_stores: EnterpriseHqRecentStore[];
  business_profile: EnterpriseBusinessProfile | null;
  business_profile_present: boolean;
  computed_at: string;
}

// =============================================================================
// Types — upsert input
// =============================================================================

export interface EnterpriseBusinessProfileUpsertInput {
  companyName?: string | null;
  businessNumber?: string | null;
  representativeName?: string | null;
  businessAddress?: string | null;
  contactPhone?: string | null;
  taxInvoiceEmail?: string | null;
  notes?: string | null;
}

export interface EnterpriseBusinessProfileUpsertResult {
  success: boolean;
  profile: EnterpriseBusinessProfile;
}

// =============================================================================
// Wrappers
// =============================================================================

export async function getMyEnterpriseRole(): Promise<EnterpriseHqRole> {
  const { data, error } = await supabase.rpc('get_my_enterprise_role');
  if (error) {
    // 인증 안 됐거나 RPC 미적용 — 안전하게 is_hq=false fallback
    console.warn('[enterpriseHqApi] get_my_enterprise_role failed', error);
    return { is_hq: false };
  }
  return (data as EnterpriseHqRole | null) ?? { is_hq: false };
}

export async function getMyEnterpriseStoreInfo(): Promise<EnterpriseStoreInfo> {
  const { data, error } = await supabase.rpc('get_my_enterprise_store_info');
  if (error) {
    console.warn('[enterpriseHqApi] get_my_enterprise_store_info failed', error);
    return { is_store: false };
  }
  return (data as EnterpriseStoreInfo | null) ?? { is_store: false };
}

export async function getMyEnterpriseDashboard(): Promise<EnterpriseHqDashboard> {
  const { data, error } = await supabase.rpc('get_my_enterprise_dashboard');
  if (error) {
    console.error('[enterpriseHqApi] get_my_enterprise_dashboard failed', error);
    throw new Error(error.message || '본사 대시보드를 불러올 수 없습니다.');
  }
  return data as EnterpriseHqDashboard;
}

export async function upsertMyEnterpriseBusinessProfile(
  input: EnterpriseBusinessProfileUpsertInput,
): Promise<EnterpriseBusinessProfileUpsertResult> {
  const { data, error } = await supabase.rpc('upsert_my_enterprise_business_profile', {
    p_company_name: input.companyName ?? null,
    p_business_number: input.businessNumber ?? null,
    p_representative_name: input.representativeName ?? null,
    p_business_address: input.businessAddress ?? null,
    p_contact_phone: input.contactPhone ?? null,
    p_tax_invoice_email: input.taxInvoiceEmail ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) {
    console.error('[enterpriseHqApi] upsert business profile failed', error);
    throw new Error(error.message || '사업자 정보 저장에 실패했습니다.');
  }
  return data as EnterpriseBusinessProfileUpsertResult;
}


// =============================================================================
// Phase 1-8 — Settlement / Documents (additive)
// SQL: supabase/migrations/0367_enterprise_hq_settlement.sql
// =============================================================================

// 사업자 정보 v2 — 정산 담당자 3 fields 추가
export interface EnterpriseBusinessProfileV2UpsertInput extends EnterpriseBusinessProfileUpsertInput {
  settlementContactName?: string | null;
  settlementContactPhone?: string | null;
  settlementContactEmail?: string | null;
}

export interface EnterpriseBusinessProfileV2 extends EnterpriseBusinessProfile {
  settlement_contact_name: string | null;
  settlement_contact_phone: string | null;
  settlement_contact_email: string | null;
}

export interface EnterpriseBusinessProfileV2UpsertResult {
  success: boolean;
  profile: EnterpriseBusinessProfileV2;
}

export async function upsertMyEnterpriseBusinessProfileV2(
  input: EnterpriseBusinessProfileV2UpsertInput,
): Promise<EnterpriseBusinessProfileV2UpsertResult> {
  const { data, error } = await supabase.rpc('upsert_my_enterprise_business_profile_v2', {
    p_company_name: input.companyName ?? null,
    p_business_number: input.businessNumber ?? null,
    p_representative_name: input.representativeName ?? null,
    p_business_address: input.businessAddress ?? null,
    p_contact_phone: input.contactPhone ?? null,
    p_tax_invoice_email: input.taxInvoiceEmail ?? null,
    p_notes: input.notes ?? null,
    p_settlement_contact_name: input.settlementContactName ?? null,
    p_settlement_contact_phone: input.settlementContactPhone ?? null,
    p_settlement_contact_email: input.settlementContactEmail ?? null,
  });
  if (error) {
    console.error('[enterpriseHqApi] upsert business profile v2 failed', error);
    throw new Error(error.message || '사업자 정보 저장에 실패했습니다.');
  }
  return data as EnterpriseBusinessProfileV2UpsertResult;
}

// ----- settlement (masked for HQ) -----
export interface EnterpriseSettlementSummary {
  id: string;
  bank_name: string | null;
  account_number_masked: string | null;
  account_holder: string | null;
  settlement_status: SettlementStatus;
  settlement_method: SettlementMethod;
  minimum_payout: number;
  rejection_reason: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnterpriseSettlementGetResult {
  success: boolean;
  settlement: EnterpriseSettlementSummary | null;
  has_business_license: boolean;
  has_bankbook: boolean;
}

export async function getMyEnterpriseSettlement(): Promise<EnterpriseSettlementGetResult> {
  const { data, error } = await supabase.rpc('get_my_enterprise_settlement');
  if (error) {
    console.error('[enterpriseHqApi] get settlement failed', error);
    throw new Error(error.message || '정산 정보를 불러올 수 없습니다.');
  }
  return data as EnterpriseSettlementGetResult;
}

/**
 * HQ 가 수정 가능한 정산 필드 (Phase 1-9 §3).
 * settlement_method / minimum_payout 은 계약 조건이므로 admin RPC 전용 — 제외.
 */
export interface EnterpriseSettlementUpsertInput {
  bankName?: string | null;
  accountNumber?: string | null;
  accountHolder?: string | null;
  businessLicensePath?: string | null;
  bankbookPath?: string | null;
}

export interface EnterpriseSettlementUpsertResult {
  success: boolean;
  settlement_status: SettlementStatus;
  settlement_method: SettlementMethod;
  submitted_at: string | null;
}

export async function upsertMyEnterpriseSettlement(
  input: EnterpriseSettlementUpsertInput,
): Promise<EnterpriseSettlementUpsertResult> {
  const { data, error } = await supabase.rpc('upsert_my_enterprise_settlement', {
    p_bank_name: input.bankName ?? null,
    p_account_number: input.accountNumber ?? null,
    p_account_holder: input.accountHolder ?? null,
    // settlement_method / minimum_payout: 의도적으로 null — admin RPC 전용
    p_settlement_method: null,
    p_minimum_payout: null,
    p_business_license_path: input.businessLicensePath ?? null,
    p_bankbook_path: input.bankbookPath ?? null,
  });
  if (error) {
    console.error('[enterpriseHqApi] upsert settlement failed', error);
    throw new Error(error.message || '정산 정보 저장에 실패했습니다.');
  }
  return data as EnterpriseSettlementUpsertResult;
}

// ----- admin: full settlement + documents + status update -----
export interface EnterpriseSettlementFull {
  id: string;
  enterprise_account_id: string;
  bank_name: string | null;
  account_number: string | null;          // full (admin only)
  account_holder: string | null;
  business_license_path: string | null;
  bankbook_path: string | null;
  settlement_status: SettlementStatus;
  settlement_method: SettlementMethod;
  minimum_payout: number;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminEnterpriseSettlementResult {
  success: boolean;
  enterprise_account: {
    id: string;
    enterprise_name: string;
    manager_name: string;
    manager_email: string;
    brand_code: string | null;
  };
  business_profile: EnterpriseBusinessProfileV2 | null;
  settlement: EnterpriseSettlementFull | null;
  computed_at: string;
}

export async function adminGetEnterpriseSettlement(
  enterpriseAccountId: string,
): Promise<AdminEnterpriseSettlementResult> {
  const { data, error } = await supabase.rpc('admin_get_enterprise_settlement', {
    p_enterprise_account_id: enterpriseAccountId,
  });
  if (error) {
    console.error('[enterpriseHqApi] admin get settlement failed', error);
    throw new Error(error.message || '정산 정보를 불러올 수 없습니다.');
  }
  return data as AdminEnterpriseSettlementResult;
}

export interface AdminEnterpriseDocumentPaths {
  success: boolean;
  business_license_path: string | null;
  bankbook_path: string | null;
}

export async function adminGetEnterpriseDocuments(
  enterpriseAccountId: string,
): Promise<AdminEnterpriseDocumentPaths> {
  const { data, error } = await supabase.rpc('admin_get_enterprise_documents', {
    p_enterprise_account_id: enterpriseAccountId,
  });
  if (error) {
    console.error('[enterpriseHqApi] admin get documents failed', error);
    throw new Error(error.message || '증빙서류 정보를 불러올 수 없습니다.');
  }
  return data as AdminEnterpriseDocumentPaths;
}

export interface AdminUpdateSettlementStatusInput {
  enterpriseAccountId: string;
  status: 'reviewing' | 'approved' | 'rejected' | 'unregistered';
  rejectionReason?: string | null;
}

export async function adminUpdateEnterpriseSettlementStatus(
  input: AdminUpdateSettlementStatusInput,
): Promise<{ success: boolean; settlement_status: SettlementStatus; reviewed_at: string }> {
  const { data, error } = await supabase.rpc('admin_update_enterprise_settlement_status', {
    p_enterprise_account_id: input.enterpriseAccountId,
    p_status: input.status,
    p_rejection_reason: input.rejectionReason ?? null,
  });
  if (error) {
    console.error('[enterpriseHqApi] admin update status failed', error);
    throw new Error(error.message || '상태 변경에 실패했습니다.');
  }
  return data as { success: boolean; settlement_status: SettlementStatus; reviewed_at: string };
}

// ----- admin payment settings (Phase 1-9 §3) — 계약 조건 -----
export interface AdminUpdatePaymentSettingsInput {
  enterpriseAccountId: string;
  settlementMethod: SettlementMethod;
  minimumPayout: number;
}

export interface AdminUpdatePaymentSettingsResult {
  success: boolean;
  enterprise_account_id: string;
  settlement_method: SettlementMethod;
  minimum_payout: number;
  updated_at: string;
}

export async function adminUpdateEnterprisePaymentSettings(
  input: AdminUpdatePaymentSettingsInput,
): Promise<AdminUpdatePaymentSettingsResult> {
  const { data, error } = await supabase.rpc('admin_update_enterprise_payment_settings', {
    p_enterprise_account_id: input.enterpriseAccountId,
    p_settlement_method: input.settlementMethod,
    p_minimum_payout: input.minimumPayout,
  });
  if (error) {
    console.error('[enterpriseHqApi] admin update payment settings failed', error);
    throw new Error(error.message || '지급 설정 변경에 실패했습니다.');
  }
  return data as AdminUpdatePaymentSettingsResult;
}

// ----- storage helpers -----

/** HQ 본인 파일 업로드 — bucket 폴더: <ea_id>/business-license.* or bankbook.* */
export async function uploadEnterpriseDocument(args: {
  enterpriseAccountId: string;
  docType: 'business-license' | 'bankbook';
  file: File;
}): Promise<string> {
  const ext = (args.file.name.split('.').pop() ?? '').toLowerCase();
  const safeExt = ['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'pdf';
  const path = `${args.enterpriseAccountId}/${args.docType}.${safeExt}`;
  const { error } = await supabase.storage
    .from(ENTERPRISE_DOCUMENT_BUCKET)
    .upload(path, args.file, { upsert: true, contentType: args.file.type });
  if (error) {
    console.error('[enterpriseHqApi] uploadEnterpriseDocument failed', error);
    throw new Error(error.message || '파일 업로드에 실패했습니다.');
  }
  return path;
}

/** Signed URL — 10분 TTL */
export async function createEnterpriseDocumentSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(ENTERPRISE_DOCUMENT_BUCKET)
    .createSignedUrl(path, ENTERPRISE_DOCUMENT_SIGNED_URL_TTL);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || '문서 링크 생성에 실패했습니다.');
  }
  return data.signedUrl;
}
