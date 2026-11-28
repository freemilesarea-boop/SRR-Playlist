/**
 * moderationApi — 콘텐츠 신고 · 사용자 차단 (migration 0568).
 *
 * App Store 심사 지침 1.2: 다른 사용자가 만든 콘텐츠가 보이는 앱은 신고·차단 수단과
 * 운영자 처리 절차가 있어야 한다. 웹과 앱이 같은 기능을 쓴다.
 */
import { supabase } from '@/lib/supabase';

export type ReportTargetType = 'track' | 'playlist' | 'user_playlist' | 'curator';
export type ReportReason = 'spam' | 'sexual' | 'violence_hate' | 'copyright' | 'impersonation' | 'other';

export const REPORT_REASONS: ReadonlyArray<{ value: ReportReason; label: string }> = [
  { value: 'spam', label: '스팸 · 광고' },
  { value: 'sexual', label: '음란 · 선정적인 내용' },
  { value: 'violence_hate', label: '폭력 · 혐오 · 차별' },
  { value: 'copyright', label: '저작권 · 권리 침해' },
  { value: 'impersonation', label: '사칭 · 거짓 정보' },
  { value: 'other', label: '기타' },
];

export const REPORT_TARGET_LABEL: Record<ReportTargetType, string> = {
  track: '음원',
  playlist: '플레이리스트',
  user_playlist: '회원 플레이리스트',
  curator: '큐레이터',
};

/** 서버 오류 코드 → 사용자 문구. */
export function moderationErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
  if (msg.includes('login_required')) return '로그인 후 이용할 수 있어요.';
  if (msg.includes('cannot_report_own_content')) return '내가 만든 콘텐츠는 신고할 수 없어요.';
  if (msg.includes('target_not_found')) return '대상을 찾을 수 없어요. 이미 삭제됐을 수 있어요.';
  if (msg.includes('invalid_target')) return '나 자신은 차단할 수 없어요.';
  return '처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
}

export async function reportContent(input: {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  detail?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('report_content', {
    p_target_type: input.targetType,
    p_target_id: input.targetId,
    p_reason: input.reason,
    p_detail: input.detail?.trim() || null,
  });
  if (error) throw error;
  return data as string;
}

export async function blockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('block_user', { p_user_id: userId });
  if (error) throw error;
}

export async function unblockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('unblock_user', { p_user_id: userId });
  if (error) throw error;
}

export interface BlockedUser {
  user_id: string;
  display_name: string;
  blocked_at: string;
}

export async function fetchMyBlockedUsers(): Promise<BlockedUser[]> {
  const { data, error } = await supabase.rpc('my_blocked_users');
  if (error) throw error;
  return (data ?? []) as BlockedUser[];
}

// ── 관리자 ──────────────────────────────────────────────────────────

export type ReportStatus = 'open' | 'actioned' | 'dismissed';

export interface AdminContentReport {
  id: string;
  target_type: ReportTargetType;
  target_id: string;
  target_label: string | null;
  target_owner_id: string | null;
  owner_name: string | null;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  admin_note: string | null;
  reporter_name: string;
  report_count: number;
  created_at: string;
  resolved_at: string | null;
}

export async function adminListContentReports(status: ReportStatus | 'all' = 'open'): Promise<AdminContentReport[]> {
  const { data, error } = await supabase.rpc('admin_list_content_reports', { p_status: status });
  if (error) throw error;
  return (data ?? []) as AdminContentReport[];
}

export async function adminResolveContentReport(input: {
  reportId: string;
  status: 'actioned' | 'dismissed';
  note?: string;
  hideUserPlaylist?: boolean;
}): Promise<void> {
  const { error } = await supabase.rpc('admin_resolve_content_report', {
    p_report_id: input.reportId,
    p_status: input.status,
    p_note: input.note?.trim() || null,
    p_hide_user_playlist: !!input.hideUserPlaylist,
  });
  if (error) throw error;
}

/** 신고 대상 화면 경로(관리자 목록 → 바로가기). */
export function reportTargetPath(r: Pick<AdminContentReport, 'target_type' | 'target_id'>): string | null {
  switch (r.target_type) {
    case 'playlist': return `/playlist/${r.target_id}`;
    case 'user_playlist': return `/my/playlist/${r.target_id}`;
    case 'track': return `/track/${r.target_id}`;
    default: return null; // 큐레이터는 handle 로 열린다 — 이름으로 검색
  }
}
