// @vitest-environment jsdom
/**
 * NoticePostsPanel — 작성(분류·고정)·공개/고정 전환·삭제 확인·본문 이미지 넣기 (0566).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { AdminNoticePost } from '@/lib/noticePostsApi';

const N = (over: Partial<AdminNoticePost>): AdminNoticePost => ({
  id: 'n1', no: 3, title: '점검 안내', category: '점검', is_pinned: true, body_md: '본문', attachments: [],
  is_published: true, published_at: '2026-11-20T00:00:00Z', created_at: '2026-11-20T00:00:00Z',
  updated_at: '2026-11-20T00:00:00Z', ...over,
});

const api = {
  adminListNoticePosts: vi.fn(),
  adminUpsertNoticePost: vi.fn(),
  adminSetNoticePostFlags: vi.fn(),
  adminDeleteNoticePost: vi.fn(),
  adminUploadNoticePostFile: vi.fn(),
};
vi.mock('@/lib/noticePostsApi', async (orig) => ({ ...(await orig<object>()), ...api }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock('@/store/toastStore', () => ({ toast: toastMock }));

const { default: NoticePostsPanel } = await import('./NoticePostsPanel');

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  toastMock.success.mockReset(); toastMock.error.mockReset();
  api.adminListNoticePosts.mockResolvedValue([N({}), N({ id: 'n2', no: 2, title: '새 기능', category: '업데이트', is_pinned: false, is_published: false })]);
  api.adminSetNoticePostFlags.mockResolvedValue(undefined);
  api.adminDeleteNoticePost.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('NoticePostsPanel', () => {
  it('목록 — 공개·고정 개수, 글 주소', async () => {
    render(<NoticePostsPanel />);
    expect(await screen.findByText('점검 안내')).toBeTruthy();
    expect(screen.getByText(/2개 · 공개 1 · 고정 1/)).toBeTruthy();
    expect(screen.getByText('/notice/3')).toBeTruthy();
  });

  it('새 공지 — 분류·고정·본문 그대로 공개 저장', async () => {
    api.adminUpsertNoticePost.mockImplementation(async (d) => N({ ...d, id: 'new', no: 4 }));
    render(<NoticePostsPanel />);
    await screen.findByText('점검 안내');
    fireEvent.click(screen.getByRole('button', { name: /새 공지/ }));
    fireEvent.change(screen.getByLabelText('분류'), { target: { value: '이벤트' } });
    fireEvent.change(screen.getByPlaceholderText(/서버 점검 안내/), { target: { value: '연말 이벤트' } });
    fireEvent.click(screen.getByLabelText('목록 맨 위에 고정'));
    fireEvent.change(screen.getByLabelText('본문'), { target: { value: '**당첨** 안내' } });
    fireEvent.click(screen.getByRole('button', { name: /저장하고 공개/ }));
    await waitFor(() => expect(api.adminUpsertNoticePost).toHaveBeenCalledWith({
      id: null, title: '연말 이벤트', category: '이벤트', is_pinned: true, body_md: '**당첨** 안내', attachments: [], is_published: true,
    }));
    expect(await screen.findByText('공지 수정')).toBeTruthy();
  });

  it('고정 해제·공개 전환은 바꿀 것만 보낸다', async () => {
    render(<NoticePostsPanel />);
    await screen.findByText('점검 안내');
    fireEvent.click(screen.getByRole('button', { name: '점검 안내 고정 해제' }));
    await waitFor(() => expect(api.adminSetNoticePostFlags).toHaveBeenCalledWith('n1', { is_pinned: false }));
    await waitFor(() => expect(screen.getByRole('button', { name: '새 기능 공개하기' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '새 기능 공개하기' }));
    await waitFor(() => expect(api.adminSetNoticePostFlags).toHaveBeenCalledWith('n2', { is_published: true }));
  });

  it('삭제는 두 번 눌러야 한다', async () => {
    render(<NoticePostsPanel />);
    await screen.findByText('점검 안내');
    fireEvent.click(screen.getByRole('button', { name: '점검 안내 삭제' }));
    expect(api.adminDeleteNoticePost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '삭제?' }));
    await waitFor(() => expect(api.adminDeleteNoticePost).toHaveBeenCalledWith('n1'));
  });

  it('본문 이미지 — 올리면 본문에 이미지 문법으로 들어간다', async () => {
    api.adminUploadNoticePostFile.mockResolvedValue({ name: '점검표.png', url: 'https://x/storage/v1/object/public/notice-posts/inline/a.png', size: 10, type: 'image/png' });
    render(<NoticePostsPanel />);
    await screen.findByText('점검 안내');
    fireEvent.click(screen.getByRole('button', { name: /새 공지/ }));
    const input = screen.getByTitle('본문에 이미지 넣기').querySelector('input')!;
    fireEvent.change(input, { target: { files: [new File(['x'], '점검표.png', { type: 'image/png' })] } });
    await waitFor(() => expect((screen.getByLabelText('본문') as HTMLTextAreaElement).value)
      .toContain('![점검표](https://x/storage/v1/object/public/notice-posts/inline/a.png)'));
    expect(api.adminUploadNoticePostFile).toHaveBeenCalledWith(expect.any(File), 'inline');
  });
});
