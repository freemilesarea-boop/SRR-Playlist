// @vitest-environment jsdom
/**
 * 비밀번호 연속 오류 → 재설정 메일 자동 발송 계약 테스트.
 *
 * 배경: 착지 페이지(/auth/reset, AuthResetPasswordPage)는 이미 있었는데 메일을
 * **보내는** 경로가 앱 어디에도 없었다 — resetPasswordForEmail 호출이 0건이라
 * 비밀번호를 잊은 사용자는 스스로 복구할 방법이 없었다. 3회 연속 틀리면 자동으로
 * 링크를 보내도록 했고, 이 테스트가 횟수·중복 발송 금지·오분류 방지를 고정한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const signInWithPassword = vi.fn();
const sendPasswordReset = vi.fn();

/** zustand 훅 흉내 — `useX()` 와 `useX(selector)` 두 호출 형태를 모두 받는다. */
function storeHook<T>(state: T) {
  return (sel?: (s: T) => unknown) => (sel ? sel(state) : state);
}
vi.mock('@/store/authStore', () => ({
  useAuthStore: storeHook({
    session: null,
    profile: null,
    isProfileReady: false,
    signInWithPassword: (e: string, p: string) => signInWithPassword(e, p),
    signInWithGoogle: () => Promise.resolve(),
    signInWithKakao: () => Promise.resolve(),
    resendSignupEmail: () => Promise.resolve(),
    sendPasswordReset: (e: string) => sendPasswordReset(e),
  }),
}));

// --- signin 모드만 검증한다. 가입 폼·모달·외부 의존은 전부 끊는다. ---
vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));
vi.mock('@/lib/kakao', () => ({ isKakaoLoginEnabled: () => false }));
vi.mock('@/lib/inAppBrowser', () => ({
  detectInAppBrowser: () => null,
  isPwaStandalone: () => false,
}));
vi.mock('@/components/Logo', () => ({ default: () => null }));
vi.mock('@/components/auth/SignupTypeSelector', () => ({ default: () => null }));
vi.mock('@/components/auth/IndividualSignupForm', () => ({ default: () => null }));
vi.mock('@/components/auth/BusinessSignupForm', () => ({ default: () => null }));
vi.mock('@/components/auth/ArtistSignupForm', () => ({ default: () => null }));
vi.mock('@/components/auth/EnterpriseHqSignupForm', () => ({ default: () => null }));
vi.mock('@/components/auth/EnterpriseBrandSignupForm', () => ({ default: () => null }));
vi.mock('@/components/auth/EnterpriseStoreSignupForm', () => ({ default: () => null }));
vi.mock('@/components/auth/InAppBrowserWarningModal', () => ({ default: () => null }));
vi.mock('@/store/toastStore', () => ({ toast: { success: () => {}, error: () => {} } }));

const CREDENTIAL_ERROR = new Error('Invalid login credentials');

/** 이메일·비밀번호를 채우고 로그인 버튼을 n 번 누른다. */
async function attemptSignIn(email: string, times: number) {
  const emailInput = screen.getByPlaceholderText('이메일');
  const pwInput = screen.getByPlaceholderText('비밀번호 (6자 이상)');
  fireEvent.change(emailInput, { target: { value: email } });
  fireEvent.change(pwInput, { target: { value: 'wrongpass' } });
  // 한 테스트에서 두 번 호출될 수 있으므로 기준선을 현재 호출 수로 잡는다.
  const before = signInWithPassword.mock.calls.length;
  for (let i = 0; i < times; i += 1) {
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(before + i + 1));
  }
}

beforeEach(async () => {
  signInWithPassword.mockReset();
  sendPasswordReset.mockReset();
  signInWithPassword.mockRejectedValue(CREDENTIAL_ERROR);
  sendPasswordReset.mockResolvedValue(undefined);
  const { default: LoginPage } = await import('./LoginPage');
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
});
afterEach(() => cleanup());

describe('로그인 비밀번호 연속 오류 → 재설정 메일 자동 발송', () => {
  it('2회 틀린 단계에서는 보내지 않는다', async () => {
    await attemptSignIn('yanghee1848@naver.com', 2);
    expect(sendPasswordReset).not.toHaveBeenCalled();
  });

  it('3회째에 소문자 정규화한 이메일로 보낸다', async () => {
    await attemptSignIn('YangHee1848@Naver.com', 3);
    await waitFor(() => expect(sendPasswordReset).toHaveBeenCalledTimes(1));
    expect(sendPasswordReset).toHaveBeenCalledWith('yanghee1848@naver.com');
  });

  it('3회를 넘겨 더 틀려도 같은 이메일로 다시 보내지 않는다 (메일 폭탄 방지)', async () => {
    await attemptSignIn('yanghee1848@naver.com', 6);
    await waitFor(() => expect(sendPasswordReset).toHaveBeenCalledTimes(1));
  });

  it('3회째에 안내 문구를 띄운다', async () => {
    await attemptSignIn('yanghee1848@naver.com', 3);
    expect(await screen.findByText(/재설정 링크를 보냈어요/)).toBeTruthy();
  });

  it('자격 증명 오류가 아니면 (네트워크 등) 실패로 세지 않는다', async () => {
    signInWithPassword.mockRejectedValue(new Error('Failed to fetch'));
    await attemptSignIn('yanghee1848@naver.com', 5);
    expect(sendPasswordReset).not.toHaveBeenCalled();
  });

  it('이메일을 바꾸면 카운터가 초기화된다', async () => {
    await attemptSignIn('first@example.com', 2);
    await attemptSignIn('second@example.com', 2);
    expect(sendPasswordReset).not.toHaveBeenCalled();
  });

  it('발송이 실패하면 다음 오류에서 다시 시도할 수 있다', async () => {
    sendPasswordReset.mockRejectedValueOnce(new Error('rate limit'));
    await attemptSignIn('yanghee1848@naver.com', 3);
    await waitFor(() => expect(sendPasswordReset).toHaveBeenCalledTimes(1));
    await attemptSignIn('yanghee1848@naver.com', 1);
    await waitFor(() => expect(sendPasswordReset).toHaveBeenCalledTimes(2));
  });
});
