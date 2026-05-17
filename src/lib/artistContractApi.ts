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
}

export async function fetchMyContract(): Promise<MyContract | null> {
  const { data, error } = await supabase.rpc('get_my_contract');
  if (error) throw error;
  const rows = (data ?? []) as MyContract[];
  return rows[0] ?? null;
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
export const ARTIST_CONTRACT_V1_TITLE = '음원 유통 및 스트리밍 정산 계약서 (v1)';
