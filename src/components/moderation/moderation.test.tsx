// @vitest-environment jsdom
// 신고·차단 (App Store 지침 1.2) — 버튼이 로그인·사유 선택·서버 호출을 제대로 거치는가.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

let session: object | null = { user: { id: 'me' } };
let user: { id: string } | null = { id: 'me' };
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { session: object | null; user: { id: string } | null }) => unknown) => sel({ session, user }),
}));
const gateOpen = vi.fn();
vi.mock('@/store/gateStore', () => ({ useGateStore: { getState: () => ({ open: gateOpen }) } }));
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('@/store/toastStore', () => ({ toast: toastMock }));

const { default: ReportButton } = await import('./ReportButton');
const { default: BlockButton } = await import('./BlockButton');
const { useBlockStore } = await import('@/store/blockStore');
const { moderationErrorMessage, reportTargetPath } = await import('@/lib/moderationApi');

beforeEach(() => {
  session = { user: { id: 'me' } };
  user = { id: 'me' };
  rpc.mockReset().mockResolvedValue({ data: [], error: null });
  gateOpen.mockReset();
  Object.values(toastMock).forEach((f) => f.mockReset());
  useBlockStore.getState().reset();
});
afterEach(() => cleanup());

describe('ReportButton', () => {
  it('로그인 안 했으면 로그인 창을 띄우고 신고 창은 열지 않는다', () => {
    session = null;
    render(<ReportButton targetType="track" targetId="t1" targetName="곡" />);
    fireEvent.click(screen.getByRole('button', { name: '신고하기' }));
    expect(gateOpen).toHaveBeenCalledWith('login');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('사유를 고르기 전에는 제출할 수 없고, 고르면 report_content 를 부른다', async () => {
    rpc.mockResolvedValue({ data: 'r1', error: null });
    render(<ReportButton targetType="user_playlist" targetId="p1" targetName="플리" />);
    fireEvent.click(screen.getByRole('button', { name: '신고하기' }));
    const submit = screen.getAllByRole('button', { name: '신고하기' }).at(-1)!;
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('스팸 · 광고'));
    fireEvent.change(screen.getByLabelText('자세한 내용 (선택)'), { target: { value: ' 광고 도배 ' } });
    await act(async () => { fireEvent.click(submit); });

    expect(rpc).toHaveBeenCalledWith('report_content', {
      p_target_type: 'user_playlist', p_target_id: 'p1', p_reason: 'spam', p_detail: '광고 도배',
    });
    expect(toastMock.success).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('BlockButton', () => {
  it('나 자신에게는 보이지 않는다', () => {
    render(<BlockButton userId="me" displayName="나" />);
    expect(screen.queryByRole('button', { name: '사용자 차단' })).toBeNull();
  });

  it('확인 후 block_user 를 부르고 차단 목록에 넣는다', async () => {
    const onBlocked = vi.fn();
    render(<BlockButton userId="u2" displayName="상대" onBlocked={onBlocked} />);
    fireEvent.click(screen.getByRole('button', { name: '사용자 차단' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '차단하기' })); });

    expect(rpc).toHaveBeenCalledWith('block_user', { p_user_id: 'u2' });
    expect(useBlockStore.getState().ids.has('u2')).toBe(true);
    expect(onBlocked).toHaveBeenCalled();
  });
});

describe('moderationApi', () => {
  it('서버 오류 코드를 사용자 문구로 바꾼다', () => {
    expect(moderationErrorMessage(new Error('cannot_report_own_content'))).toContain('내가 만든');
    expect(moderationErrorMessage(new Error('login_required'))).toContain('로그인');
    expect(moderationErrorMessage(new Error('boom'))).toContain('다시 시도');
  });

  it('관리자 목록에서 대상 화면으로 가는 경로', () => {
    expect(reportTargetPath({ target_type: 'user_playlist', target_id: 'x' })).toBe('/my/playlist/x');
    expect(reportTargetPath({ target_type: 'playlist', target_id: 'x' })).toBe('/playlist/x');
    expect(reportTargetPath({ target_type: 'curator', target_id: 'x' })).toBeNull();
  });
});
