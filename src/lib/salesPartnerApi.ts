import { supabase } from './supabase';

export type SalesPartnerStatus = 'submitted' | 'reviewing' | 'approved' | 'rejected' | 'contacted';

export interface SalesPartnerApplicationInput {
  name: string;
  phone: string;
  email: string;
  region: string;
  target_business_types: string[];
  has_sales_experience: boolean | null;
  expected_store_count: number | null;
  motivation: string;
  company_name?: string | null;
  network_description?: string | null;
  message?: string | null;
}

export interface SalesPartnerApplication extends SalesPartnerApplicationInput {
  id: string;
  status: SalesPartnerStatus;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  admin_note: string | null;
}

/** 외부 지원자(비로그인 포함) 영업 파트너 지원서 제출. */
export async function submitSalesPartnerApplication(input: SalesPartnerApplicationInput): Promise<void> {
  const { error } = await supabase.rpc('submit_sales_partner_application', {
    p_name: input.name,
    p_phone: input.phone,
    p_email: input.email,
    p_region: input.region,
    p_target_business_types: input.target_business_types,
    p_has_sales_experience: input.has_sales_experience,
    p_expected_store_count: input.expected_store_count,
    p_motivation: input.motivation,
    p_company_name: input.company_name ?? null,
    p_network_description: input.network_description ?? null,
    p_message: input.message ?? null,
  });
  if (error) throw error;
}

export async function listSalesPartnerApplications(status?: SalesPartnerStatus): Promise<SalesPartnerApplication[]> {
  const { data, error } = await supabase.rpc('admin_list_sales_partner_applications', { p_status: status ?? null, p_limit: 200 });
  if (error) throw error;
  return (data ?? []) as SalesPartnerApplication[];
}

export async function updateSalesPartnerApplication(id: string, status?: SalesPartnerStatus, note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_update_sales_partner_application', { p_id: id, p_status: status ?? null, p_note: note ?? null });
  if (error) throw error;
}
