/**
 * supportInquiryApi.ts — Phase X6.1
 *
 * 문의하기 (Support Inquiry) 클라이언트 API.
 * 사업자/아티스트/일반회원 모두 사용.
 *
 * 관리자 알림은 0284 RPC 내부에서 admin_notifications 에 INSERT → Resend 자동 발송.
 */
import { supabase } from '@/lib/supabase';

export type InquiryType =
  | '재생 오류'
  | '플레이리스트 문의'
  | '결제/구독 문의'
  | '정산 문의'
  | '음원 등록 문의'
  | '계정/로그인 문의'
  | '기타';

export const INQUIRY_TYPES: InquiryType[] = [
  '재생 오류',
  '플레이리스트 문의',
  '결제/구독 문의',
  '정산 문의',
  '음원 등록 문의',
  '계정/로그인 문의',
  '기타',
];

export type InquiryStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type InquiryPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface InquiryAttachment {
  file_url: string;
  file_name?: string;
  file_type?: string;
  file_size?: number;
}

export interface CreateInquiryInput {
  inquiry_type: InquiryType;
  title: string;
  body: string;
  contact_email?: string;
  contact_phone?: string;
  wants_kakao_contact?: boolean;
  current_page_url?: string;
  browser_user_agent?: string;
  /** 매장 재생 컨텍스트 등 자동 수집된 메타. trigger 가 이 객체를 보고 urgent 자동 설정. */
  context?: Record<string, unknown>;
  attachments?: InquiryAttachment[];
}

export interface CreateInquiryResult {
  ok: true;
  inquiry_id: string;
  priority: InquiryPriority;
  inquiry_type: InquiryType;
}

export async function createSupportInquiry(input: CreateInquiryInput): Promise<CreateInquiryResult> {
  const { data, error } = await supabase.rpc('create_support_inquiry', {
    p_inquiry_type: input.inquiry_type,
    p_title: input.title,
    p_body: input.body,
    p_contact_email: input.contact_email ?? null,
    p_contact_phone: input.contact_phone ?? null,
    p_wants_kakao_contact: input.wants_kakao_contact ?? false,
    p_current_page_url: input.current_page_url ?? (typeof window !== 'undefined' ? window.location.href : null),
    p_browser_user_agent: input.browser_user_agent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : null),
    p_context: input.context ?? {},
    p_attachments: input.attachments ?? [],
  });
  if (error) throw error;

  // X6.2.10 — 문의 저장 성공 후 notify-new-inquiry Edge Function 호출.
  // 본인 inquiry_id 만 통과 (function 내부 검증). 일반 사용자도 호출 가능.
  // fire-and-forget — 발송 실패해도 문의 저장은 이미 성공.
  const result = data as CreateInquiryResult;
  if (result?.inquiry_id) {
    void supabase.functions
      .invoke('notify-new-inquiry', { body: { inquiry_id: result.inquiry_id } })
      .then((res) => {
        if (import.meta.env.DEV) console.log('[notify-new-inquiry]', res);
      })
      .catch((e) => {
        if (import.meta.env.DEV) console.warn('[notify-new-inquiry] failed', e);
      });
  }

  return result;
}

export interface MyInquiryRow {
  id: string;
  inquiry_type: InquiryType;
  title: string;
  status: InquiryStatus;
  priority: InquiryPriority;
  admin_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

export async function listMyInquiries(limit = 50): Promise<MyInquiryRow[]> {
  const { data, error } = await supabase.rpc('list_my_inquiries', { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as MyInquiryRow[];
}

export interface InquiryDetail {
  inquiry: {
    id: string;
    user_id: string | null;
    user_email: string | null;
    user_role: string | null;
    business_id: string | null;
    artist_id: string | null;
    inquiry_type: InquiryType;
    title: string;
    body: string;
    contact_email: string | null;
    contact_phone: string | null;
    wants_kakao_contact: boolean;
    status: InquiryStatus;
    priority: InquiryPriority;
    current_page_url: string | null;
    browser_user_agent: string | null;
    context: Record<string, unknown>;
    admin_note: string | null;
    assigned_admin_id: string | null;
    resolved_at: string | null;
    created_at: string;
    updated_at: string;
  };
  attachments: Array<{
    id: string;
    inquiry_id: string;
    file_url: string;
    file_name: string | null;
    file_type: string | null;
    file_size: number | null;
    created_at: string;
  }>;
  business?: Record<string, unknown> | null;
  artist?: Record<string, unknown> | null;
}

export async function getMyInquiryDetail(inquiryId: string): Promise<InquiryDetail> {
  const { data, error } = await supabase.rpc('get_my_inquiry_detail', { p_inquiry_id: inquiryId });
  if (error) throw error;
  return data as InquiryDetail;
}

// ===== Admin =====
export interface AdminInquiryRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_role: string | null;
  business_id: string | null;
  artist_id: string | null;
  inquiry_type: InquiryType;
  title: string;
  body: string;
  contact_email: string | null;
  contact_phone: string | null;
  wants_kakao_contact: boolean;
  status: InquiryStatus;
  priority: InquiryPriority;
  current_page_url: string | null;
  context: Record<string, unknown>;
  admin_note: string | null;
  assigned_admin_id: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  attachment_count: number;
}

export interface AdminInquiryFilter {
  status?: InquiryStatus;
  inquiry_type?: InquiryType;
  priority?: InquiryPriority;
  assigned_admin_id?: string;
  search?: string;
  limit?: number;
}

export async function adminListSupportInquiries(filter: AdminInquiryFilter = {}): Promise<AdminInquiryRow[]> {
  const { data, error } = await supabase.rpc('admin_list_support_inquiries', {
    p_status: filter.status ?? null,
    p_inquiry_type: filter.inquiry_type ?? null,
    p_priority: filter.priority ?? null,
    p_assigned_admin_id: filter.assigned_admin_id ?? null,
    p_search: filter.search ?? null,
    p_limit: filter.limit ?? 100,
  });
  if (error) throw error;
  return (data ?? []) as AdminInquiryRow[];
}

export async function adminGetSupportInquiryDetail(inquiryId: string): Promise<InquiryDetail> {
  const { data, error } = await supabase.rpc('admin_get_support_inquiry_detail', { p_inquiry_id: inquiryId });
  if (error) throw error;
  return data as InquiryDetail;
}

export interface AdminInquiryUpdate {
  status?: InquiryStatus;
  priority?: InquiryPriority;
  admin_note?: string;
  assigned_admin_id?: string;
}

export async function adminUpdateInquiry(
  inquiryId: string, update: AdminInquiryUpdate,
): Promise<{ ok: true; inquiry_id: string }> {
  const { data, error } = await supabase.rpc('admin_update_inquiry', {
    p_inquiry_id: inquiryId,
    p_status: update.status ?? null,
    p_priority: update.priority ?? null,
    p_admin_note: update.admin_note ?? null,
    p_assigned_admin_id: update.assigned_admin_id ?? null,
  });
  if (error) throw error;
  return data as { ok: true; inquiry_id: string };
}

// X6.3 — 답변 작성 + 사용자 이메일 자동 발송
export interface SendReplyResult {
  ok: true;
  inquiry_id: string;
  status: InquiryStatus;
  user_email: string | null;
  user_id: string | null;
  inquiry_type: InquiryType;
  title: string;
}

export async function adminSendInquiryReply(
  inquiryId: string,
  replyBody: string,
  status: 'in_progress' | 'resolved' | 'closed' = 'resolved',
): Promise<{ rpc: SendReplyResult; emailResult: { ok: boolean; sent_to?: string; error?: string } }> {
  // 1. DB 업데이트 (admin_note, status, assigned, event 로깅)
  const { data, error } = await supabase.rpc('admin_send_inquiry_reply', {
    p_inquiry_id: inquiryId,
    p_reply_body: replyBody,
    p_status: status,
  });
  if (error) throw error;
  const rpc = data as SendReplyResult;

  // 2. Edge Function 호출 → 사용자 이메일 발송
  let emailResult: { ok: boolean; sent_to?: string; error?: string } = { ok: false };
  try {
    const { data: efData } = await supabase.functions.invoke('notify-inquiry-reply', {
      body: { inquiry_id: inquiryId },
    });
    emailResult = efData as { ok: boolean; sent_to?: string; error?: string };
  } catch (e) {
    emailResult = { ok: false, error: (e as Error).message };
  }

  return { rpc, emailResult };
}

// X6.3 — 특정 문의의 이벤트 타임라인 (audit log)
export interface InquiryEventRow {
  id: number;
  event_type: 'created' | 'status_changed' | 'priority_changed' | 'note_updated'
            | 'reply_sent' | 'reply_failed' | 'assigned'
            | 'kakao_dispatched' | 'kakao_failed' | 'webhook_dispatched' | 'webhook_failed';
  channel: 'email' | 'kakao_chat' | 'kakao_alimtalk' | 'kakao_friendtalk' | 'webhook' | null;
  actor_user_id: string | null;
  actor_email: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  detail: string | null;
  created_at: string;
}

export async function adminListInquiryEvents(inquiryId: string): Promise<InquiryEventRow[]> {
  const { data, error } = await supabase.rpc('admin_list_inquiry_events', { p_inquiry_id: inquiryId });
  if (error) throw error;
  return (data ?? []) as InquiryEventRow[];
}

export interface SupportInquirySummary {
  window_days: number;
  total: number;
  open: number;
  in_progress: number;
  resolved: number;
  closed: number;
  urgent_open: number;
  by_type: Record<string, number>;
}

export async function adminSupportInquirySummary(days = 30): Promise<SupportInquirySummary> {
  const { data, error } = await supabase.rpc('admin_support_inquiry_summary', { p_days: days });
  if (error) throw error;
  return data as SupportInquirySummary;
}
