/**
 * postFiles — 관리자가 올리는 공개 글(엔터프라이즈 가이드·공지사항)의 이미지·PDF 업로드 공용.
 * 버킷마다 업로드·삭제는 관리자만, 읽기는 공개 (0565 enterprise-guides · 0566 notice-posts).
 */
import { supabase } from './supabase';

export interface PostAttachment {
  name: string;
  url: string;
  size?: number | null;
  type?: string | null;
}

export const POST_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const POST_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const POST_ATTACHMENT_TYPES = [...POST_IMAGE_TYPES, 'application/pdf'];

/** 파일 이름에서 저장 경로에 쓸 안전한 부분만 (원래 이름은 첨부 표시용으로 따로 보관). */
export function safeStorageName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${base || 'file'}${ext ? `.${ext}` : ''}`;
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 이미지·PDF 업로드 → 공개 주소. folder 는 버킷 안 폴더(cover / inline / attachment). */
export async function uploadPostFile(
  bucket: string,
  file: File,
  folder: 'cover' | 'inline' | 'attachment',
): Promise<PostAttachment> {
  const allowed = folder === 'attachment' ? POST_ATTACHMENT_TYPES : POST_IMAGE_TYPES;
  if (!allowed.includes(file.type)) {
    throw new Error(folder === 'attachment' ? '이미지(JPG·PNG·WebP·GIF) 또는 PDF 만 올릴 수 있어요' : '이미지(JPG·PNG·WebP·GIF) 만 올릴 수 있어요');
  }
  if (file.size > POST_MAX_FILE_BYTES) {
    throw new Error('파일은 20MB 이하만 올릴 수 있어요');
  }
  const month = new Date().toISOString().slice(0, 7);
  const rand = Math.random().toString(36).slice(2, 10);
  const path = `${folder}/${month}/${Date.now()}-${rand}-${safeStorageName(file.name)}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: file.type,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { name: file.name, url: data.publicUrl, size: file.size, type: file.type };
}
