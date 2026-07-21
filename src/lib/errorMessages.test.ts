import { describe, it, expect } from 'vitest';
import { friendlyError } from './errorMessages';

const UNAVAILABLE = '요청하신 기능을 현재 사용할 수 없습니다. 잠시 후 다시 시도하거나 운영자에게 문의해주세요.';

describe('friendlyError — undefined RPC (PLATFORM-HOTFIX-1)', () => {
  it('maps PGRST202 code to a safe message (no function name leaked)', () => {
    const err = { code: 'PGRST202', message: "Could not find the function public.admin_list_site_notices without parameters in the schema cache", status: 404 };
    const out = friendlyError(err);
    expect(out).toBe(UNAVAILABLE);
    expect(out).not.toMatch(/admin_list_site_notices|public\.|schema cache/);
  });

  it('maps 42883 undefined_function code', () => {
    expect(friendlyError({ code: '42883', message: 'function foo() does not exist' })).toBe(UNAVAILABLE);
  });

  it('maps a string-only "Could not find the function" error', () => {
    const out = friendlyError('Could not find the function public.create_support_inquiry in the schema cache');
    expect(out).toBe(UNAVAILABLE);
    expect(out).not.toMatch(/create_support_inquiry/);
  });

  it('does not leak raw SQL/function detail for undefined-function errors', () => {
    const out = friendlyError({ message: 'function does not exist: get_admin_track_detail' });
    expect(out).not.toMatch(/get_admin_track_detail/);
  });
});

describe('friendlyError — regression (existing mappings still work)', () => {
  it('network / rate-limit / permission', () => {
    expect(friendlyError(new Error('Failed to fetch'))).toMatch(/네트워크/);
    expect(friendlyError({ status: 429, message: 'Too Many Requests' })).toMatch(/너무 많습니다/);
    expect(friendlyError({ code: '42501', message: 'permission denied' })).toMatch(/권한/);
  });
  it('passes through Korean messages', () => {
    expect(friendlyError(new Error('이미 가입된 이메일입니다. 로그인해주세요.'))).toMatch(/이미 가입된 이메일/);
  });
});
