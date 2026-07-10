// Phase ALGO-8F — Human Approval Workflow & Runtime Apply Authorization (Shadow) API 래퍼.
// 0450 admin RPC 경유. Approval Workflow · Multi Reviewer · Policy · Audit · Authorization Certificate — 실제 Apply 없음(권한만).
import { supabase } from './supabase';

export type AuthRule = '2of3' | '3of4' | 'all_required';

export interface AuthReview { role: string; reviewer: string | null; vote: string; reason: string | null; voted_at: string }
export interface AuthAudit { actor: string | null; action: string | null; detail: string | null; ts: string }

export interface AuthorizationOverview {
  has_data: boolean;
  request_id?: string | null;
  request?: { request_id: string; apply_package_ref: string | null; title: string | null; description: string | null; policy_key: string | null; status: string; requested_by: string | null; requested_at: string; expiration_at: string | null };
  policy?: { policy_key: string; description: string | null; rule: string; required_approvals: number; total_reviewers: number; roles: string[] };
  reviews?: AuthReview[];
  latest_votes?: Record<string, string>;
  certificate?: { authorization_status: string; approvals_count: number; rejections_count: number; required_approvals: number; policy_satisfied: boolean; authorized_roles: string[]; hash: string | null; note: string | null; created_at: string };
  audit?: AuthAudit[];
}

export async function adminRequestRuntimeAuthorization(packageRef = 'streaming_v2_view_fix (0447+0448)', rule: AuthRule = '3of4', requestedBy = 'admin'): Promise<{ ok: boolean; request_id: string; required_approvals: number; total_reviewers: number; status: string }> {
  const { data, error } = await supabase.rpc('admin_request_runtime_authorization', { p_apply_package_ref: packageRef, p_rule: rule, p_requested_by: requestedBy });
  if (error) throw error;
  return data as { ok: boolean; request_id: string; required_approvals: number; total_reviewers: number; status: string };
}

export async function adminReviewRuntimeAuthorization(requestId: string, reviewerRole: string, vote: 'approve' | 'reject' | 'abstain', reviewer = 'admin', reason: string | null = null): Promise<{ ok: boolean; vote: string; status: string; votes: number }> {
  const { data, error } = await supabase.rpc('admin_review_runtime_authorization', { p_request_id: requestId, p_reviewer_role: reviewerRole, p_vote: vote, p_reviewer: reviewer, p_reason: reason });
  if (error) throw error;
  return data as { ok: boolean; vote: string; status: string; votes: number };
}

export async function adminGenerateRuntimeAuthorization(requestId: string | null = null): Promise<{ ok: boolean; authorization_status: string; request_status: string; approvals: number; rejections: number; required: number; policy_satisfied: boolean; certificate_hash: string }> {
  const { data, error } = await supabase.rpc('admin_generate_runtime_authorization', { p_request_id: requestId });
  if (error) throw error;
  return data as { ok: boolean; authorization_status: string; request_status: string; approvals: number; rejections: number; required: number; policy_satisfied: boolean; certificate_hash: string };
}

export async function adminRuntimeAuthorizationOverview(): Promise<AuthorizationOverview> {
  const { data, error } = await supabase.rpc('admin_runtime_authorization_overview');
  if (error) throw error;
  return data as AuthorizationOverview;
}
