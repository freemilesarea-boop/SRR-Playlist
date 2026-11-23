// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NoticePostSummary } from '@/lib/noticePostsApi';

const api = { listNoticePosts: vi.fn() };
vi.mock('@/lib/noticePostsApi', async (orig) => ({ ...(await orig<object>()), ...api }));

const { default: HomeNoticeBar } = await import('./HomeNoticeBar');
const { pickHomeNotice } = await import('@/lib/noticePostsApi');

const NOW = new Date('2026-11-23T00:00:00Z').getTime();
const daysAgo = (d: number) => new Date(NOW - d * 86400000).toISOString();
const R = (no: number, extra: Partial<NoticePostSummary> = {}): NoticePostSummary => ({
  no, title: `공지 ${no}`, category: '공지', is_pinned: false, excerpt: '', attachment_count: 0,
  published_at: daysAgo(1), updated_at: daysAgo(1), ...extra,
});

describe('pickHomeNotice', () => {
  it('목록 맨 앞(고정 글 우선)을 고른다', () => {
    expect(pickHomeNotice([R(9, { is_pinned: true, published_at: daysAgo(200) }), R(10)], null, NOW)?.no).toBe(9);
    expect(pickHomeNotice([R(10), R(8)], null, NOW)?.no).toBe(10);
  });
  it('고정 안 한 글은 30일이 지나면 띄우지 않는다', () => {
    expect(pickHomeNotice([R(3, { published_at: daysAgo(31) })], null, NOW)).toBeNull();
    expect(pickHomeNotice([R(3, { published_at: daysAgo(29) })], null, NOW)?.no).toBe(3);
  });
  it('닫은 글이면 띄우지 않는다 — 새 글이 올라오면 다시', () => {
    expect(pickHomeNotice([R(5)], 5, NOW)).toBeNull();
    expect(pickHomeNotice([R(6), R(5)], 5, NOW)?.no).toBe(6);
  });
  it('공지가 없으면 null', () => {
    expect(pickHomeNotice([], null, NOW)).toBeNull();
  });
});

describe('HomeNoticeBar', () => {
  beforeEach(() => { api.listNoticePosts.mockReset(); window.localStorage.clear(); });
  afterEach(() => cleanup());

  const renderBar = () => render(<MemoryRouter><HomeNoticeBar /></MemoryRouter>);

  it('최신 공지를 글 링크로 보여주고, 닫으면 같은 글은 다시 안 뜬다', async () => {
    api.listNoticePosts.mockResolvedValue([R(7, { title: '점검 안내', category: '점검', published_at: new Date().toISOString() })]);
    renderBar();
    expect((await screen.findByText('점검 안내')).closest('a')?.getAttribute('href')).toBe('/notice/7');
    expect(screen.getByText('점검')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '공지 닫기' }));
    expect(screen.queryByText('점검 안내')).toBeNull();
    cleanup();
    renderBar();
    await waitFor(() => expect(api.listNoticePosts).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('점검 안내')).toBeNull();
  });

  it('불러오기에 실패하면 아무것도 그리지 않는다', async () => {
    api.listNoticePosts.mockRejectedValue(new Error('network'));
    const { container } = renderBar();
    await waitFor(() => expect(api.listNoticePosts).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
