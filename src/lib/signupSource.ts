/**
 * signupSource.ts — 가입 시 "어디서 알게 되셨나요?" 응답.
 * Migration: supabase/migrations/0535_signup_source.sql
 *
 * 이메일 가입은 signUp metadata 로 넘기고(auth 트리거가 users 로 옮김),
 * 로그인된 상태의 신청은 record_my_signup_source RPC 로 남긴다. 첫 응답만 저장된다.
 */
import { supabase } from '@/lib/supabase';

export const SIGNUP_SOURCES = [
  { key: 'news', label: '뉴스 · 기사' },
  { key: 'search', label: '네이버 · 구글 검색' },
  { key: 'sns', label: '인스타그램 · SNS' },
  { key: 'youtube', label: '유튜브' },
  { key: 'blog_community', label: '블로그 · 카페 · 커뮤니티' },
  { key: 'ad', label: '광고' },
  { key: 'referral', label: '지인 추천' },
  { key: 'sales_agent', label: '영업 담당자 안내' },
  { key: 'hq_notice', label: '본사 안내' },
  { key: 'other', label: '기타' },
] as const;

export type SignupSourceKey = (typeof SIGNUP_SOURCES)[number]['key'];

export type SignupSourceContext =
  | 'business_signup'
  | 'business_register'
  | 'enterprise_hq_apply'
  | 'enterprise_store_join'
  | 'enterprise_brand_signup'
  | 'enterprise_store_signup';

export const SIGNUP_SOURCE_CONTEXT_LABEL: Record<SignupSourceContext, string> = {
  business_signup: '사업자 회원가입',
  business_register: '사업자등록',
  enterprise_hq_apply: '본사 신청',
  enterprise_store_join: '가맹점 연결',
  enterprise_brand_signup: '브랜드 본사 가입',
  enterprise_store_signup: '가맹점 가입',
};

export interface SignupSourceValue {
  source: SignupSourceKey | '';
  detail: string;
}

export const EMPTY_SIGNUP_SOURCE: SignupSourceValue = { source: '', detail: '' };

export function signupSourceLabel(key: string | null | undefined): string {
  return SIGNUP_SOURCES.find((s) => s.key === key)?.label ?? (key || '—');
}

/** 폼 검증 — 선택은 필수, "기타" 는 내용까지 필수. */
export function validateSignupSource(v: SignupSourceValue): string | null {
  if (!v.source) return '어디서 알게 되셨는지 선택해주세요.';
  if (v.source === 'other' && !v.detail.trim()) return '어디서 알게 되셨는지 적어주세요.';
  return null;
}

/** signUp metadata 에 섞어 넣을 필드. 선택이 없으면 빈 객체. */
export function signupSourceMetadata(
  v: SignupSourceValue,
  context: SignupSourceContext,
): Record<string, string> {
  if (!v.source) return {};
  return {
    signup_source: v.source,
    signup_source_detail: v.detail.trim(),
    signup_source_context: context,
  };
}

/**
 * 로그인된 회원의 응답 기록. 부가 정보라 실패해도 신청 흐름을 막지 않는다 —
 * 호출부는 await 만 하고 결과는 무시해도 된다.
 */
export async function recordMySignupSource(
  v: SignupSourceValue,
  context: SignupSourceContext,
): Promise<boolean> {
  if (!v.source) return false;
  const { data, error } = await supabase.rpc('record_my_signup_source', {
    p_source: v.source,
    p_detail: v.detail.trim() || null,
    p_context: context,
  });
  if (error) {
    console.warn('[signup-source] record failed:', error.message);
    return false;
  }
  return data === true;
}

export interface AdminSignupSource {
  source: string;
  detail: string | null;
  context: string | null;
  recorded_at: string | null;
}

export async function fetchAdminMemberSignupSource(userId: string): Promise<AdminSignupSource | null> {
  const { data, error } = await supabase.rpc('admin_member_signup_source', { p_user_id: userId });
  if (error) throw error;
  return (data ?? null) as AdminSignupSource | null;
}
