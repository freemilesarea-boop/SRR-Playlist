/**
 * artistContractApi.ts
 *
 * 아티스트 음원 유통 계약서 RPC wrapper. 0057_artist_contracts.sql 적용 필요.
 *
 * - 본인용: fetchMyContract / signMyContract / rejectMyContract
 * - 관리자용: adminCreateContract / adminListContracts
 */

import { supabase } from './supabase';
// 계약서 본문 v1 — docs 의 단일 진실의 원천. 변호사 검토 후 docs 만 수정.
import contractV1Body from '../../docs/ARTIST_CONTRACT_DRAFT_v1.md?raw';

export type ContractStatus = 'pending_signature' | 'signed' | 'rejected' | 'expired';

export interface MyContract {
  id: string;
  contract_version: string;
  contract_title: string;
  contract_body: string;
  status: ContractStatus;
  pending_signature_at: string;
  signed_at: string | null;
  rejected_reason: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface AdminContractRow {
  id: string;
  artist_user_id: string;
  artist_email: string;
  artist_nickname: string;
  contract_version: string;
  contract_title: string;
  status: ContractStatus;
  pending_signature_at: string;
  signed_at: string | null;
  rejected_reason: string | null;
  rejected_at: string | null;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  /** 0068 — email 발송 상태 (선택, RPC 가 아직 미반환이면 undefined) */
  email_status?: 'not_sent' | 'queued' | 'sent' | 'partial_failed' | 'failed';
  emailed_to_artist_at?: string | null;
  emailed_to_admin_at?: string | null;
  last_admin_emailed_at?: string | null;
  admin_email_delivery_count?: number;
  last_email_error?: string | null;
}

export interface ContractEmailJob {
  job_id: string;
  recipient_email: string;
  recipient_kind: 'artist' | 'admin' | 'hardcoded';
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';
  attempts: number;
  sent_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
  provider_message_id: string | null;
  created_at: string;
}

export async function fetchMyContract(): Promise<MyContract | null> {
  const { data, error } = await supabase.rpc('get_my_contract');
  if (error) throw error;
  const rows = (data ?? []) as MyContract[];
  return rows[0] ?? null;
}

/** 0068 — 승인+결제 완료 아티스트가 호출. 본인 계약 없으면 활성 template 으로 생성. */
export async function ensureMyContract(): Promise<string> {
  const { data, error } = await supabase.rpc('ensure_artist_contract_for_user');
  if (error) throw error;
  return data as string;
}

/** 0068 — 서명 완료 후 Edge Function 호출하여 메일 발송 큐 처리 */
export async function dispatchContractEmails(
  contractId: string,
): Promise<{ ok: boolean; sent?: number; failed?: number; processed?: number; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('dispatch-contract-emails', {
      body: { contract_id: contractId },
    });
    if (error) {
      return { ok: false, error: error.message };
    }
    return data ?? { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function adminListContractEmailJobs(contractId: string): Promise<ContractEmailJob[]> {
  const { data, error } = await supabase.rpc('admin_list_contract_email_jobs', {
    p_contract_id: contractId,
  });
  if (error) throw error;
  return (data ?? []) as ContractEmailJob[];
}

export async function adminRequeueContractEmails(
  contractId: string,
  onlyFailed = false,
): Promise<number> {
  const { data, error } = await supabase.rpc('admin_requeue_contract_emails', {
    p_contract_id: contractId,
    p_only_failed: onlyFailed,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

/** 0073 — jobs 미생성 케이스 복구용. signed 인데 contract_email_jobs 가 0건일 때 사용. */
export async function adminEnqueueContractEmails(contractId: string): Promise<number> {
  const { data, error } = await supabase.rpc('admin_enqueue_contract_emails', {
    p_contract_id: contractId,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

export interface ContractEmailEvent {
  event_id: number;
  job_id: string;
  recipient_email: string;
  from_status: string | null;
  to_status: string;
  attempts: number | null;
  error: string | null;
  provider_message_id: string | null;
  at: string;
}

export async function adminListContractEmailEvents(
  contractId: string,
): Promise<ContractEmailEvent[]> {
  const { data, error } = await supabase.rpc('admin_list_contract_email_events', {
    p_contract_id: contractId,
  });
  if (error) throw error;
  return (data ?? []) as ContractEmailEvent[];
}

export interface DispatchHealth {
  ok: boolean;
  ready: boolean;
  env: {
    resend_api_key_set: boolean;
    /** 0074 — 진단용 추가 필드 */
    resend_api_key_length?: number;
    resend_api_key_first4?: string;
    resend_api_key_last4?: string;
    resend_from: string;
    /** v5 — RESEND_FROM 이 fallback 인지 표시 */
    resend_from_is_fallback?: boolean;
    resend_from_domain: string | null;
    app_public_url: string | null;
    supabase_url?: string;
    module_load_at?: string;
    now?: string;
    /** v5 — runtime env 키 이름 목록 (값 X) + RESEND 유사 키 탐지 */
    env_inspect?: {
      all_keys: string[];
      resend_like_keys: string[];
      has_RESEND_API_KEY: boolean;
      has_RESEND_FROM: boolean;
    };
  };
  resend_domain: {
    domain: string | null;
    status: string | null;
    region: string | null;
    error?: string;
  };
}

/** admin only — Edge Function 환경설정 + Resend 도메인 verification 상태 점검 */
export async function checkDispatchHealth(): Promise<DispatchHealth | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('dispatch-contract-emails', {
      body: { health: true },
    });
    if (error) return { ok: false, error: error.message };
    return (data ?? { ok: false, error: 'no data' }) as DispatchHealth;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function signMyContract(
  contractId: string,
  meta?: { ip?: string | null; userAgent?: string | null },
): Promise<{ status: ContractStatus; signed_at: string }> {
  const { data, error } = await supabase.rpc('sign_artist_contract', {
    p_contract_id: contractId,
    p_signed_ip: meta?.ip ?? null,
    p_signed_user_agent: meta?.userAgent ?? null,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as
    | { status: ContractStatus; signed_at: string }
    | undefined;
  if (!row) throw new Error('empty response');
  return row;
}

export async function rejectMyContract(contractId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('reject_artist_contract', {
    p_contract_id: contractId,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function adminCreateContract(input: {
  artistUserId: string;
  contractVersion: string;
  contractTitle: string;
  contractBody: string;
  expiresAt?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('admin_create_artist_contract', {
    p_artist_user_id: input.artistUserId,
    p_contract_version: input.contractVersion,
    p_contract_title: input.contractTitle,
    p_contract_body: input.contractBody,
    p_expires_at: input.expiresAt ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function adminListContracts(opts?: {
  status?: ContractStatus | '';
  search?: string;
}): Promise<AdminContractRow[]> {
  const { data, error } = await supabase.rpc('admin_artist_contract_list', {
    p_status: opts?.status || null,
    p_search: opts?.search || null,
  });
  if (error) throw error;
  return (data ?? []) as AdminContractRow[];
}

/** 관리자: 계약서 생성 시 사용할 기본 본문 — docs/ARTIST_CONTRACT_DRAFT_v1.md raw import */
export const ARTIST_CONTRACT_V1_BODY: string = contractV1Body;
export const ARTIST_CONTRACT_V1_VERSION = 'v1';
export const ARTIST_CONTRACT_V1_TITLE = '음원 스트리밍 및 정산 이용 계약서';
