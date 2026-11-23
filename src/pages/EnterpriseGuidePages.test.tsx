// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = { listEnterpriseGuides: vi.fn(), getEnterpriseGuide: vi.fn() };
vi.mock('@/lib/enterpriseGuideApi', async (orig) => ({ ...(await orig<object>()), ...api }));

const { default: ListPage } = await import('./EnterpriseGuideListPage');
const { default: DetailPage } = await import('./EnterpriseGuidePage');

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/enterprise-guide" element={<ListPage />} />
        <Route path="/enterprise-guide/:slug" element={<DetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => { api.listEnterpriseGuides.mockReset(); api.getEnterpriseGuide.mockReset(); });
afterEach(() => cleanup());

describe('엔터프라이즈 가이드 공개 페이지', () => {
  it('목록 — 카테고리별로 묶고 글로 가는 링크', async () => {
    api.listEnterpriseGuides.mockResolvedValue([
      { id: '1', slug: 'getting-started', title: '도입 절차', summary: '5단계', category: '시작하기', cover_image_url: null, attachment_count: 2, published_at: null, updated_at: '2026-11-01T00:00:00Z' },
      { id: '2', slug: 'ops', title: '운영 팁', summary: null, category: '운영', cover_image_url: null, attachment_count: 0, published_at: null, updated_at: '2026-11-01T00:00:00Z' },
    ]);
    at('/enterprise-guide');
    expect((await screen.findByText('도입 절차')).closest('a')?.getAttribute('href')).toBe('/enterprise-guide/getting-started');
    expect(screen.getByRole('heading', { name: '시작하기' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '운영' })).toBeTruthy();
    expect(screen.getByText(/첨부 2/)).toBeTruthy();
  });

  it('목록이 비면 준비 중 안내', async () => {
    api.listEnterpriseGuides.mockResolvedValue([]);
    at('/enterprise-guide');
    expect(await screen.findByText('가이드를 준비하고 있어요')).toBeTruthy();
  });

  it('글 — 본문·첨부 다운로드', async () => {
    api.getEnterpriseGuide.mockResolvedValue({
      id: '1', slug: 'getting-started', title: '도입 절차', summary: '요약', category: '시작하기', cover_image_url: null,
      body_md: '## 1단계\n\n계약을 맺어요.', published_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-03T00:00:00Z',
      attachments: [{ name: '소개서.pdf', url: 'https://x/storage/v1/object/public/enterprise-guides/a.pdf', size: 2048, type: 'application/pdf' }],
    });
    at('/enterprise-guide/getting-started');
    expect(await screen.findByRole('heading', { level: 1, name: '도입 절차' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '1단계' })).toBeTruthy();
    expect(screen.getByText('소개서.pdf').closest('a')?.getAttribute('href')).toContain('enterprise-guides/a.pdf');
    expect(api.getEnterpriseGuide).toHaveBeenCalledWith('getting-started');
  });

  it('없는(비공개) 글', async () => {
    api.getEnterpriseGuide.mockResolvedValue(null);
    at('/enterprise-guide/nope');
    expect(await screen.findByText('찾는 가이드가 없어요')).toBeTruthy();
  });
});
