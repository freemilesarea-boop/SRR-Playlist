// Artist payout admin API (X6.50 — extracted from artistApi.ts)
// admin PII reveal (계좌/주민번호), 정산 계좌 verify/reject, pending 목록.
import { supabase } from '../supabase';
import type { TaxWithholdingType } from '../artistApi';

export interface AdminPayoutRow {
  account_id: string;
  user_id: string;
  artist_name: string | null;
  email: string | null;
  // X6.14 — PII 필드 (모두 마스킹된 표시용; 원본은 admin_reveal_payout_pii 로만)
  legal_name: string | null;
  masked_rrn: string | null;
  bank_name: string;
  masked_account_number: string;
  account_holder: string;
  tax_withholding_type: TaxWithholdingType;
  has_tax_consent: boolean;
  tax_consent_at: string | null;
  is_pii_complete: boolean;
  verification_status: 'pending' | 'verified' | 'rejected';
  rejected_reason: string | null;
  created_at: string;
}

export async function listPendingPayoutAccounts(): Promise<AdminPayoutRow[]> {
  try {
    const { data, error } = await supabase.rpc('list_pending_payout_accounts', { p_limit: 200 });
    if (error) return [];
    return (data ?? []) as AdminPayoutRow[];
  } catch {
    return [];
  }
}

/** 0061 — admin 만 호출. 원본 계좌번호 반환 + audit log INSERT. verified 상태만 허용. */
export interface RevealedPayoutAccount {
  account_id: string;
  account_number: string;
  bank_name: string;
  account_holder: string;
  artist_user_id: string;
  log_id: string;
  viewed_at: string;
}

export async function adminRevealPayoutAccount(opts: {
  accountId: string;
  reason?: string | null;
  settlementId?: string | null;
}): Promise<RevealedPayoutAccount> {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null;
  const { data, error } = await supabase.rpc('admin_reveal_payout_account', {
    p_account_id: opts.accountId,
    p_reason: opts.reason ?? null,
    p_settlement_id: opts.settlementId ?? null,
    p_user_agent: ua,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as RevealedPayoutAccount | undefined;
  if (!row) throw new Error('empty response');
  return row;
}

// X6.15 — RRN/계좌 PII 통합 reveal (admin only, audit + pii_type 분기)
export type PiiRevealType = 'account_number' | 'resident_number' | 'full';

export interface RevealedPayoutPii {
  account_id: string;
  legal_name: string | null;
  resident_registration_number: string | null;
  account_number: string | null;
  bank_name: string;
  account_holder: string;
  tax_withholding_type: TaxWithholdingType;
  tax_consent_at: string | null;
  artist_user_id: string;
  log_id: string;
  viewed_at: string;
}

export async function adminRevealPayoutPii(opts: {
  accountId: string;
  reason: string;
  piiType?: PiiRevealType;
  settlementId?: string | null;
}): Promise<RevealedPayoutPii> {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null;
  const { data, error } = await supabase.rpc('admin_reveal_payout_pii', {
    p_account_id: opts.accountId,
    p_reason: opts.reason,
    p_pii_type: opts.piiType ?? 'full',
    p_settlement_id: opts.settlementId ?? null,
    p_user_agent: ua,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as RevealedPayoutPii | undefined;
  if (!row) throw new Error('empty response');
  return row;
}

export async function verifyArtistPayoutAccount(accountId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('verify_artist_payout_account', { p_account_id: accountId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * 0532 — 관리자가 정산 계좌(은행·계좌번호·예금주)를 직접 고친다.
 *
 * 계좌번호는 서버에서 암호화해 저장한다(평문 컬럼은 마스킹만 담는다). 신원 정보
 * (실명·주민번호·세금 동의)는 건드리지 않는다 — 명의자가 실제로 바뀌는 건이라면
 * 아티스트가 신분증과 함께 재제출하는 기존 경로를 써야 한다.
 * 변경 전/후와 사유는 artist_payout_account_changes 에 영구 기록된다.
 */
export interface AdminUpdatePayoutResult {
  ok: boolean;
  noop?: boolean;
  changed_fields?: string[];
  masked_account_number?: string;
  pending_settlement_count?: number;
  pending_settlement_amount?: number;
  message?: string;
}

export async function adminUpdateArtistPayoutAccount(opts: {
  accountId: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  reason: string;
}): Promise<{ ok: boolean; error?: string; result?: AdminUpdatePayoutResult }> {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null;
  const { data, error } = await supabase.rpc('admin_update_artist_payout_account', {
    p_account_id: opts.accountId,
    p_bank_name: opts.bankName,
    p_account_number: opts.accountNumber,
    p_account_holder: opts.accountHolder,
    p_reason: opts.reason,
    p_user_agent: ua,
  });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as AdminUpdatePayoutResult;
  return r.ok ? { ok: true, result: r } : { ok: false, error: r.message ?? '변경 실패' };
}

export async function rejectArtistPayoutAccount(
  accountId: string,
  reason: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('reject_artist_payout_account', {
    p_account_id: accountId,
    p_reason: reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
