/**
 * 회원 대량 메일 발송 — 관리자 API 래퍼.
 *   RPC: admin_* (수신자 미리보기/캠페인 생성/이력/취소/수신거부 관리)
 *   Edge: dispatch-broadcast-emails (즉시 발송 drain / 테스트 발송)
 */
import { supabase } from './supabase';
import type { EmailKind, RecipientMode, CampaignStatus } from './broadcastEmail';

export interface RecipientFilter {
  search?: string | null;
  plan?: string | null;
  role?: string | null;
  status?: string | null;
  /**
   * 정산 정보 미완비 아티스트만 (0487).
   * 계좌는 등록됐으나 실명·주민등록번호·원천징수 동의가 없어 지급이 보류되는 회원.
   * 'true' 문자열로 전달한다(서버는 p_filter->>'payout_pii_incomplete' 로 읽음).
   */
  payout_pii_incomplete?: 'true' | null;
}

export interface RecipientPreview {
  count: number;
  excluded_unsubscribed: number;
  sample: Array<{ email: string; nickname: string | null }>;
}

export interface CampaignRow {
  id: string;
  subject: string;
  email_kind: EmailKind;
  recipient_mode: RecipientMode;
  status: CampaignStatus;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  created_by_email: string | null;
}

export interface UnsubscribeRow {
  id: string;
  email: string;
  user_id: string | null;
  scope: 'ad' | 'all';
  source: 'link' | 'admin';
  unsubscribed_at: string;
}

export interface CreateCampaignInput {
  subject: string;
  bodyHtml: string;
  kind: EmailKind;
  mode: RecipientMode;
  filter?: RecipientFilter;
  selectedUserIds?: string[];
  scheduledAt?: string | null;
}

export async function previewBroadcastRecipients(input: {
  mode: RecipientMode;
  filter?: RecipientFilter;
  selectedUserIds?: string[];
  kind: EmailKind;
}): Promise<RecipientPreview> {
  const { data, error } = await supabase.rpc('admin_preview_broadcast_recipients', {
    p_recipient_mode: input.mode,
    p_filter: input.filter ?? {},
    p_selected_user_ids: input.selectedUserIds ?? [],
    p_email_kind: input.kind,
  });
  if (error) throw error;
  const d = (data ?? {}) as Partial<RecipientPreview>;
  return {
    count: d.count ?? 0,
    excluded_unsubscribed: d.excluded_unsubscribed ?? 0,
    sample: d.sample ?? [],
  };
}

export async function createBroadcastCampaign(input: CreateCampaignInput): Promise<{
  campaign_id: string;
  total_recipients: number;
  status: CampaignStatus;
}> {
  const { data, error } = await supabase.rpc('admin_create_broadcast_campaign', {
    p_subject: input.subject,
    p_body_html: input.bodyHtml,
    p_email_kind: input.kind,
    p_recipient_mode: input.mode,
    p_filter: input.filter ?? {},
    p_selected_user_ids: input.selectedUserIds ?? [],
    p_scheduled_at: input.scheduledAt ?? null,
  });
  if (error) throw error;
  return data as { campaign_id: string; total_recipients: number; status: CampaignStatus };
}

/** 즉시 발송 워커 호출 (drain). 대량이면 has_more 가 true 인 동안 반복 호출. */
export async function dispatchBroadcast(): Promise<{
  ok: boolean; processed: number; sent: number; failed: number; has_more?: boolean; error?: string;
}> {
  const { data, error } = await supabase.functions.invoke('dispatch-broadcast-emails', {
    body: { drain: true },
  });
  if (error) return { ok: false, processed: 0, sent: 0, failed: 0, error: error.message };
  return data as { ok: boolean; processed: number; sent: number; failed: number; has_more?: boolean };
}

/** 즉시 발송 캠페인을 완료(더 이상 pending 없음)까지 반복 drain. */
export async function drainBroadcastUntilDone(maxRounds = 60): Promise<{ sent: number; failed: number; rounds: number }> {
  let sent = 0, failed = 0, rounds = 0;
  for (; rounds < maxRounds; rounds++) {
    const r = await dispatchBroadcast();
    sent += r.sent ?? 0;
    failed += r.failed ?? 0;
    if (!r.has_more) break;
  }
  return { sent, failed, rounds: rounds + 1 };
}

export async function sendBroadcastTest(input: {
  subject: string; bodyHtml: string; kind: EmailKind; to?: string;
}): Promise<{ ok: boolean; to?: string; error?: string }> {
  const { data, error } = await supabase.functions.invoke('dispatch-broadcast-emails', {
    body: { test: true, subject: input.subject, body_html: input.bodyHtml, email_kind: input.kind, to: input.to },
  });
  if (error) return { ok: false, error: error.message };
  return data as { ok: boolean; to?: string; error?: string };
}

export async function listBroadcastCampaigns(limit = 50, offset = 0): Promise<CampaignRow[]> {
  const { data, error } = await supabase.rpc('admin_list_broadcast_campaigns', { p_limit: limit, p_offset: offset });
  if (error) throw error;
  return (data ?? []) as CampaignRow[];
}

export interface BroadcastCampaignDetail {
  campaign: CampaignRow & { body_html: string; recipient_filter: RecipientFilter };
  jobs_by_status: Record<string, number>;
  recent_failures: Array<{ email: string; error: string | null }>;
}

export async function getBroadcastCampaign(id: string): Promise<BroadcastCampaignDetail | null> {
  const { data, error } = await supabase.rpc('admin_get_broadcast_campaign', { p_id: id });
  if (error) throw error;
  return (data ?? null) as BroadcastCampaignDetail | null;
}

export async function cancelBroadcastCampaign(id: string): Promise<{ ok: boolean; cancelled_jobs: number }> {
  const { data, error } = await supabase.rpc('admin_cancel_broadcast_campaign', { p_id: id });
  if (error) throw error;
  return data as { ok: boolean; cancelled_jobs: number };
}

export async function listEmailUnsubscribes(limit = 100, offset = 0, search?: string): Promise<UnsubscribeRow[]> {
  const { data, error } = await supabase.rpc('admin_list_email_unsubscribes', {
    p_limit: limit, p_offset: offset, p_search: search ?? null,
  });
  if (error) throw error;
  return (data ?? []) as UnsubscribeRow[];
}

export async function addEmailUnsubscribe(email: string, scope: 'ad' | 'all' = 'ad'): Promise<void> {
  const { error } = await supabase.rpc('admin_add_email_unsubscribe', { p_email: email, p_scope: scope });
  if (error) throw error;
}

export async function removeEmailUnsubscribe(email: string): Promise<void> {
  const { error } = await supabase.rpc('admin_remove_email_unsubscribe', { p_email: email });
  if (error) throw error;
}
