// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = { listNoticePosts: vi.fn(), getNoticePost: vi.fn() };
vi.mock('@/lib/noticePostsApi', async (orig) => ({ ...(await orig<object>()), ...api }));

const { default: NoticePage } = await import('./NoticePage');
const { default: NoticePostPage } = await import('./NoticePostPage');

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/notice" element={<NoticePage />} />
        <Route path="/notice/:no" element={<NoticePostPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const ROW = (no: number, title: string, category: string, extra = {}) => ({
  no, title, category, is_pinned: false, excerpt: `${title} 내용`, attachment_count: 0,
  published_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:00:00Z', ...extra,
});

beforeEach(() => { api.listNoticePosts.mockReset(); api.getNoticePost.mockReset(); });
afterEach(() => cleanup());

describe('공지사항 공개 페이지', () => {
  it('목록 — 글 링크와 분류 필터', async () => {
    api.listNoticePosts.mockResolvedValue([
      ROW(3, '점검 안내', '점검', { is_pinned: true, attachment_count: 1 }),
      ROW(2, '새 기능', '업데이트'),
      ROW(1, '서비스 오픈', '공지'),
    ]);
    at('/notice');
    expect((await screen.findByText('점검 안내')).closest('a')?.getAttribute('href')).toBe('/notice/3');
    expect(screen.getByLabelText('고정')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '업데이트' }));
    expect(screen.queryByText('점검 안내')).toBeNull();
    expect(screen.getByText('새 기능')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '전체' }));
    expect(screen.getByText('점검 안내')).toBeTruthy();
  });

  it('목록이 비면 안내', async () => {
    api.listNoticePosts.mockResolvedValue([]);
    at('/notice');
    expect(await screen.findByText('아직 올라온 공지가 없어요')).toBeTruthy();
  });

  it('글 — 본문·첨부·이전/다음 글', async () => {
    api.getNoticePost.mockResolvedValue({
      no: 2, title: '새 기능', category: '업데이트', is_pinned: false,
      body_md: '## 바뀐 점\n\n- 안내방송 반복', published_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-22T00:00:00Z',
      attachments: [{ name: '변경 내역.pdf', url: 'https://x/storage/v1/object/public/notice-posts/a.pdf', size: 3000, type: 'application/pdf' }],
      prev: { no: 1, title: '서비스 오픈' }, next: { no: 3, title: '점검 안내' },
    });
    at('/notice/2');
    expect(await screen.findByRole('heading', { level: 1, name: '새 기능' })).toBeTruthy();
    expect(api.getNoticePost).toHaveBeenCalledWith(2);
    expect(screen.getByRole('heading', { name: '바뀐 점' })).toBeTruthy();
    expect(screen.getByText(/2026\.11\.22 수정/)).toBeTruthy();
    expect(screen.getByText('변경 내역.pdf').closest('a')?.getAttribute('href')).toContain('notice-posts/a.pdf');
    expect(screen.getByText('서비스 오픈').closest('a')?.getAttribute('href')).toBe('/notice/1');
    expect(screen.getByText('점검 안내').closest('a')?.getAttribute('href')).toBe('/notice/3');
  });

  it('없는 글', async () => {
    api.getNoticePost.mockResolvedValue(null);
    at('/notice/999');
    expect(await screen.findByText('찾는 공지가 없어요')).toBeTruthy();
  });
});
