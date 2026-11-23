/**
 * noticePostsApi — 공지사항 게시판 (0566). /notice 목록, /notice/:no 글.
 *
 * 공개: 누구나 공개 글만 (고정 글 먼저, 그다음 최신순). 글에는 이전·다음 글이 붙는다.
 * 관리자: 작성·수정·공개/고정 전환·삭제(숨김), 이미지·PDF 업로드(storage 'notice-posts').
 * 팝업 공지(siteNoticesApi, 화면 위에 띄우는 것)와는 별개.
 */
import { supabase } from './supabase';
import { uploadPostFile, type PostAttachment } from './postFiles';

export const NOTICE_POST_BUCKET = 'notice-posts';
export const NOTICE_CATEGORIES = ['공지', '업데이트', '점검', '이벤트'] as const;
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number];
/** 공지 분류 배지 색 (아이보리 종이 배경 기준) */
export const NOTICE_CATEGORY_TONE: Record<NoticeCategory, string> = {
  공지: 'bg-stone-900 text-white',
  업데이트: 'bg-violet-100 text-violet-800',
  점검: 'bg-amber-100 text-amber-900',
  이벤트: 'bg-emerald-100 text-emerald-800',
};

export interface NoticePostSummary {
  no: number;
  title: string;
  category: NoticeCategory;
  is_pinned: boolean;
  excerpt: string;
  attachment_count: number;
  published_at: string | null;
  updated_at: string;
}

export interface NoticePostLink { no: number; title: string }

export interface NoticePost {
  no: number;
  title: string;
  category: NoticeCategory;
  is_pinned: boolean;
  body_md: string;
  attachments: PostAttachment[];
  published_at: string | null;
  updated_at: string;
  /** 한 칸 오래된 글 */
  prev: NoticePostLink | null;
  /** 한 칸 새 글 */
  next: NoticePostLink | null;
}

export interface AdminNoticePost {
  id: string;
  no: number;
  title: string;
  category: NoticeCategory;
  is_pinned: boolean;
  body_md: string;
  attachments: PostAttachment[];
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NoticePostInput {
  id: string | null;
  title: string;
  category: NoticeCategory;
  is_pinned: boolean;
  body_md: string;
  attachments: PostAttachment[];
  is_published: boolean;
}

export async function listNoticePosts(): Promise<NoticePostSummary[]> {
  const { data, error } = await supabase.rpc('list_notice_posts');
  if (error) throw error;
  return (data ?? []) as NoticePostSummary[];
}

/** 없거나 비공개면 null. 숫자가 아닌 주소도 null. */
export async function getNoticePost(no: number): Promise<NoticePost | null> {
  if (!Number.isSafeInteger(no) || no <= 0) return null;
  const { data, error } = await supabase.rpc('get_notice_post', { p_no: no });
  if (error) throw error;
  return (data ?? null) as NoticePost | null;
}

export async function adminListNoticePosts(): Promise<AdminNoticePost[]> {
  const { data, error } = await supabase.rpc('admin_list_notice_posts');
  if (error) throw error;
  return (data ?? []) as AdminNoticePost[];
}

export async function adminUpsertNoticePost(input: NoticePostInput): Promise<AdminNoticePost> {
  const { data, error } = await supabase.rpc('admin_upsert_notice_post', {
    p_id: input.id,
    p_title: input.title,
    p_category: input.category,
    p_is_pinned: input.is_pinned,
    p_body_md: input.body_md,
    p_attachments: input.attachments,
    p_is_published: input.is_published,
  });
  if (error) throw error;
  return data as AdminNoticePost;
}

/** 공개·고정 중 바꿀 것만 넘긴다 (null 은 그대로). */
export async function adminSetNoticePostFlags(
  id: string, flags: { is_published?: boolean; is_pinned?: boolean },
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_notice_post_flags', {
    p_id: id, p_is_published: flags.is_published ?? null, p_is_pinned: flags.is_pinned ?? null,
  });
  if (error) throw error;
}

export async function adminDeleteNoticePost(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_notice_post', { p_id: id });
  if (error) throw error;
}

export function adminUploadNoticePostFile(file: File, kind: 'inline' | 'attachment'): Promise<PostAttachment> {
  return uploadPostFile(NOTICE_POST_BUCKET, file, kind);
}

export function formatNoticeDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
