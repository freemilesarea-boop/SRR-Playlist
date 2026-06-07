/**
 * payoutIntakeAdminApi.ts — X6.21
 *
 * 관리자용 정산 정보 신청 (payout_intake_submissions) RPC 래퍼.
 *   - 목록 / 승인 / 반려 / 보완 요청
 *   - PII reveal (RRN/계좌)
 *
 * 평문 PII 는 admin_reveal_payout_intake_pii RPC 만 사용.
 */
import { supabase } from '@/lib/supabase';

export type IntakeStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'needs_revision';

export interface PayoutIntakeRow {
  submission_id: string;
  support_inquiry_id: string | null;
  user_id: string;
  user_email: string | null;
  legal_name: string;
  masked_rrn: string | null;
  phone: string;
  address: string;
  bank_name: string;
  masked_account_number: string;
  account_holder: string;
  id_document_url: string;
  id_document_filename: string | null;
  status: IntakeStatus;
  approved_at: string | null;
  rejected_reason: string | null;
  sheets_synced_at: string | null;
  created_at: string;
}

export async function adminListPayoutIntake(
  status: IntakeStatus | '' = '',
  limit = 200,
): Promise<PayoutIntakeRow[]> {
  const { data, error } = await supabase.rpc('admin_list_payout_intake', {
    p_status: status || null,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as PayoutIntakeRow[];
}

export interface ApproveResult {
  ok: true;
  noop?: boolean;
  submission_id: string;
  artist_payout_account_id?: string;
  user_id?: string;
  verification_status?: 'verified';
}

export async function adminApprovePayoutIntake(
  submissionId: string, reason?: string,
): Promise<ApproveResult> {
  const { data, error } = await supabase.rpc('admin_approve_payout_intake', {
    p_submission_id: submissionId,
    p_reason: reason || null,
  });
  if (error) throw error;
  return data as ApproveResult;
}

export async function adminUpdatePayoutIntakeStatus(
  submissionId: string,
  status: 'rejected' | 'needs_revision' | 'withdrawn',
  reason: string,
): Promise<{ ok: true; submission_id: string; before: string; after: string }> {
  const { data, error } = await supabase.rpc('admin_update_payout_intake_status', {
    p_submission_id: submissionId,
    p_status: status,
    p_reason: reason,
  });
  if (error) throw error;
  return data as { ok: true; submission_id: string; before: string; after: string };
}

// PII reveal (intake submissions 전용)
export type IntakePiiType = 'account_number' | 'resident_number' | 'full';

export interface RevealedIntakePii {
  submission_id: string;
  legal_name: string | null;
  resident_registration_number: string | null;
  account_number: string | null;
  bank_name: string;
  account_holder: string;
  user_id: string;
  log_id: number;
  viewed_at: string;
}

export async function adminRevealPayoutIntakePii(opts: {
  submissionId: string;
  reason: string;
  piiType?: IntakePiiType;
}): Promise<RevealedIntakePii> {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null;
  const { data, error } = await supabase.rpc('admin_reveal_payout_intake_pii', {
    p_submission_id: opts.submissionId,
    p_reason: opts.reason,
    p_pii_type: opts.piiType ?? 'full',
    p_user_agent: ua,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as RevealedIntakePii | undefined;
  if (!row) throw new Error('empty response');
  return row;
}

/** 신분증 다운로드용 signed URL (private bucket). */
export async function createIdDocumentSignedUrl(
  path: string, expiresInSec = 60,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('id-documents')
    .createSignedUrl(path, expiresInSec);
  if (error) return null;
  return data?.signedUrl ?? null;
}
