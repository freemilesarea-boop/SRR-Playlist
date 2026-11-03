/**
 * hqContentApi — 본사가 자기 브랜드의 음악·매장 화면 광고·안내방송을 바꾸는 요청(검수 후 반영).
 * Migration: supabase/migrations/0541_hq_brand_content_requests.sql
 *
 * 본사는 바로 바꾸지 않는다. 요청(hq_content_requests)을 남기고, 운영사가 관리자 화면에서
 * 승인하면 기존 관리자 기능(admin_* RPC)으로 그대로 적용된다. 결과는 본사 알림센터로 간다.
 */
import { supabase } from '@/lib/supabase';
import { uploadBrandMedia } from '@/lib/brandMediaUpload';
import { uploadAnnouncementFile } from '@/lib/api/announcementApi';

export type HqContentKind =
  | 'music_policy' | 'playback_policy'
  | 'media_add' | 'media_update' | 'media_delete'
  | 'announcement_asset_add' | 'announcement_asset_delete'
  | 'schedule_create' | 'schedule_update' | 'schedule_delete';

export type HqRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'superseded';
export type HqScopeType = 'enterprise' | 'region' | 'store';
export type HqVocalPolicy = 'any' | 'vocal_ok' | 'prefer_instrumental' | 'instrumental_only';

export interface HqMusicPolicy {
  policy_mode: 'inherit' | 'custom' | null;
  allowed_genres: string[] | null;
  preferred_genres: string[] | null;
  blocked_genres: string[] | null;
  preferred_moods: string[] | null;
  blocked_moods: string[] | null;
  energy_min: number | null;
  energy_max: number | null;
  bpm_min: number | null;
  bpm_max: number | null;
  vocal_policy: HqVocalPolicy | null;
  updated_at: string | null;
}

export interface HqBrandMedia {
  id: string;
  asset_type: 'image' | 'video';
  url: string;
  thumbnail_url: string | null;
  title: string | null;
  display_duration_seconds: number;
  sort_order: number;
  starts_at: string | null;
  ends_at: string | null;
  status: 'active' | 'inactive';
  mime_type: string | null;
}

export interface HqAnnouncementAsset {
  id: string;
  title: string;
  file_url: string;
  file_path: string;
  duration_seconds: number | null;
  status: string;
  created_at: string;
}

export interface HqSchedule {
  id: string;
  name: string;
  asset_id: string;
  scope_type: HqScopeType;
  region_id: string | null;
  store_ids: string[];
  starts_at: string | null;
  ends_at: string | null;
  recurrence_rule: string | null;
  status: string;
  max_plays_per_day: number;
}

export interface HqContentRequest {
  id: string;
  kind: HqContentKind;
  payload: Record<string, unknown>;
  status: HqRequestStatus;
  hq_note: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface HqBrandContent {
  enterprise: { id: string; name: string; brand_code: string | null };
  brand: {
    id: string; name: string; status: string; industry_type: string | null;
    playback_mode: 'always_on' | 'business_hours' | null;
    open_time: string | null; close_time: string | null;
    playback_days: number[] | null; playback_timezone: string | null;
  } | null;
  music_policy: HqMusicPolicy | null;
  today_playlist: { service_date: string; track_count: number; generated_at: string } | null;
  media: HqBrandMedia[];
  announcement_assets: HqAnnouncementAsset[];
  schedules: HqSchedule[];
  regions: { id: string; name: string }[];
  stores: { id: string; name: string }[];
  requests: HqContentRequest[];
}

export interface MusicPolicyPreview {
  total: number;
  industry_pass: number;
  eligible: number;
  is_study: boolean;
  policy_mode: string;
}

export async function getMyBrandContent(): Promise<HqBrandContent> {
  const { data, error } = await supabase.rpc('hq_get_my_brand_content');
  if (error) throw error;
  return data as HqBrandContent;
}

export async function previewMyMusicPolicy(overrides: Record<string, unknown>): Promise<MusicPolicyPreview> {
  const { data, error } = await supabase.rpc('hq_preview_brand_music_policy', { p_overrides: overrides });
  if (error) throw error;
  return data as MusicPolicyPreview;
}

export async function submitContentRequest(
  kind: HqContentKind,
  payload: Record<string, unknown>,
  note?: string | null,
): Promise<string> {
  const { data, error } = await supabase.rpc('hq_submit_content_request', {
    p_kind: kind,
    p_payload: payload,
    p_note: note?.trim() || null,
  });
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function cancelContentRequest(id: string): Promise<void> {
  const { error } = await supabase.rpc('hq_cancel_content_request', { p_id: id });
  if (error) throw error;
}

/** 본사 검수 전 업로드 폴더 — 스토리지 정책(0541)이 이 폴더만 허용한다. */
export function hqUploadFolder(enterpriseId: string): string {
  return `hq/${enterpriseId}`;
}

/** 매장 화면 이미지·영상을 올리고 'media_add' 요청에 넣을 값을 돌려준다. */
export async function uploadHqMedia(enterpriseId: string, brandId: string, file: File) {
  const r = await uploadBrandMedia(brandId, file, { folder: hqUploadFolder(enterpriseId) });
  if (!r.ok || !r.url || !r.path) throw new Error(r.error ?? '업로드에 실패했어요.');
  return {
    url: r.url,
    file_path: r.path,
    asset_type: r.assetType ?? 'image',
    mime_type: r.mimeType ?? null,
    media_duration_seconds: r.durationSeconds ?? null,
  };
}

/** 안내 음원을 올리고 'announcement_asset_add' 요청에 넣을 값을 돌려준다. */
export async function uploadHqAnnouncement(enterpriseId: string, file: File) {
  const r = await uploadAnnouncementFile(file, enterpriseId, hqUploadFolder(enterpriseId));
  return {
    file_url: r.publicUrl,
    file_path: r.path,
    file_name: file.name,
    mime_type: r.mimeType,
    file_size_bytes: r.sizeBytes,
  };
}

// ── 관리자 검수 ─────────────────────────────────────────────────────────

export interface AdminHqContentRequest extends HqContentRequest {
  enterprise_account_id: string;
  enterprise_name: string;
  brand_code: string | null;
  brand_id: string | null;
  brand_name: string | null;
  brand_industry: string | null;
  requester_email: string | null;
  applied_result: Record<string, unknown> | null;
  current: Record<string, unknown> | null;
  asset_title: string | null;
  asset_request_status: HqRequestStatus | null;
  region_name: string | null;
}

export async function adminListHqContentRequests(status: HqRequestStatus | null = 'pending'): Promise<AdminHqContentRequest[]> {
  const { data, error } = await supabase.rpc('admin_list_hq_content_requests', { p_status: status, p_limit: 150 });
  if (error) throw error;
  return (data ?? []) as AdminHqContentRequest[];
}

export async function adminReviewHqContentRequest(id: string, approve: boolean, note?: string | null): Promise<void> {
  const { error } = await supabase.rpc('admin_review_hq_content_request', {
    p_id: id,
    p_approve: approve,
    p_note: note?.trim() || null,
  });
  if (error) throw error;
}

/** 반려된 업로드 요청의 파일을 지운다 — 관리자만 버킷 삭제 권한이 있다. */
export async function removeRejectedUpload(r: Pick<HqContentRequest, 'kind' | 'payload'>): Promise<void> {
  const bucket = r.kind === 'media_add' ? 'brand-media' : r.kind === 'announcement_asset_add' ? 'enterprise-announcements' : null;
  const path = typeof r.payload.file_path === 'string' ? r.payload.file_path : null;
  if (!bucket || !path || !path.startsWith('hq/')) return;
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
}

// ── 표시용 ──────────────────────────────────────────────────────────────

export const HQ_KIND_LABEL: Record<HqContentKind, string> = {
  music_policy: '브랜드 음악 설정',
  playback_policy: '재생 시간',
  media_add: '매장 화면 추가',
  media_update: '매장 화면 수정',
  media_delete: '매장 화면 삭제',
  announcement_asset_add: '안내 음원 추가',
  announcement_asset_delete: '안내 음원 삭제',
  schedule_create: '안내방송 일정 추가',
  schedule_update: '안내방송 일정 수정',
  schedule_delete: '안내방송 일정 삭제',
};

export const HQ_STATUS_LABEL: Record<HqRequestStatus, string> = {
  pending: '검수 대기',
  approved: '반영됨',
  rejected: '반려',
  cancelled: '취소함',
  superseded: '새 요청으로 대체',
};

const DOW_KO: Record<string, string> = { MON: '월', TUE: '화', WED: '수', THU: '목', FRI: '금', SAT: '토', SUN: '일' };

/** 'daily:22:30' → '매일 22:30' 처럼 사람이 읽는 반복 규칙. */
export function describeRecurrence(rule: string | null | undefined): string {
  if (!rule) return '반복 없음';
  const once = /^once:(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(rule);
  if (once) return `${Number(once[2])}/${Number(once[3])} ${once[4]} 한 번`;
  const daily = /^daily:(\d{2}:\d{2})$/.exec(rule);
  if (daily) return `매일 ${daily[1]}`;
  const weekly = /^weekly:([A-Z,]+):(\d{2}:\d{2})$/.exec(rule);
  if (weekly) return `매주 ${weekly[1].split(',').map((d) => DOW_KO[d] ?? d).join('·')} ${weekly[2]}`;
  return rule;
}

export function describeScope(
  scope: HqScopeType | null | undefined,
  opts: { regionName?: string | null; storeCount?: number },
): string {
  if (scope === 'region') return `${opts.regionName ?? '지역'} 매장`;
  if (scope === 'store') return `선택한 매장 ${opts.storeCount ?? 0}곳`;
  return '전체 가맹점';
}

/** 요청 한 줄 요약 — 본사 요청 내역·관리자 검수 목록 공용. */
export function summarizeRequest(r: Pick<HqContentRequest, 'kind' | 'payload'>, ctx?: { assetTitle?: string | null; regionName?: string | null }): string {
  const p = r.payload as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '');
  switch (r.kind) {
    case 'music_policy': {
      if (p.policy_mode !== 'custom') return '업종 기본 음악으로';
      const genres = Array.isArray(p.allowed_genres) ? (p.allowed_genres as string[]) : [];
      return genres.length ? `허용 장르 ${genres.length}개` : '장르 제한 없음';
    }
    case 'playback_policy':
      return p.playback_mode === 'business_hours'
        ? `영업시간에만 ${str('open_time').slice(0, 5)}~${str('close_time').slice(0, 5)}`
        : '24시간 재생';
    case 'media_add':
      return `${p.asset_type === 'video' ? '영상' : '이미지'} "${str('title') || '제목 없음'}"`;
    case 'announcement_asset_add':
      return `"${str('title')}"`;
    case 'schedule_create':
      return `"${str('name')}" · ${describeRecurrence(str('recurrence_rule'))} · ${describeScope(p.scope_type as HqScopeType, {
        regionName: ctx?.regionName,
        storeCount: Array.isArray(p.store_ids) ? p.store_ids.length : 0,
      })}${ctx?.assetTitle ? ` · 음원 "${ctx.assetTitle}"` : ''}`;
    case 'schedule_update':
      if (p.status === 'paused') return '일시중지';
      if (p.status === 'active' && Object.keys(p).length <= 2) return '다시 켜기';
      return `${str('name') ? `"${str('name')}" · ` : ''}${describeRecurrence(str('recurrence_rule') || null)}`;
    case 'media_update':
      return p.status === 'inactive' ? '표시 중지' : p.status === 'active' ? '다시 표시' : '내용 수정';
    default:
      return '';
  }
}
