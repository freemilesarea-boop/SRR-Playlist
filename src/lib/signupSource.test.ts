import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));

import {
  EMPTY_SIGNUP_SOURCE, signupSourceLabel, signupSourceMetadata, validateSignupSource,
} from './signupSource';

describe('signupSource', () => {
  it('선택하지 않으면 막는다', () => {
    expect(validateSignupSource(EMPTY_SIGNUP_SOURCE)).not.toBeNull();
  });

  it('기타는 내용까지 적어야 한다', () => {
    expect(validateSignupSource({ source: 'other', detail: '  ' })).not.toBeNull();
    expect(validateSignupSource({ source: 'other', detail: '전시회' })).toBeNull();
  });

  it('일반 선택은 내용 없이 통과', () => {
    expect(validateSignupSource({ source: 'news', detail: '' })).toBeNull();
  });

  it('signUp metadata 에 경로와 가입 화면을 싣는다', () => {
    expect(signupSourceMetadata({ source: 'news', detail: ' ' }, 'business_signup')).toEqual({
      signup_source: 'news',
      signup_source_detail: '',
      signup_source_context: 'business_signup',
    });
    expect(signupSourceMetadata(EMPTY_SIGNUP_SOURCE, 'business_signup')).toEqual({});
  });

  it('라벨', () => {
    expect(signupSourceLabel('news')).toBe('뉴스 · 기사');
    expect(signupSourceLabel('unknown')).toBe('unknown');
    expect(signupSourceLabel(null)).toBe('—');
  });
});
