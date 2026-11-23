// @vitest-environment jsdom
/**
 * EnterpriseGuidesPanel — 작성·공개 저장·공개 전환·순서·삭제 확인·업로드 실패 (0565).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import type { AdminEnterpriseGuide } from '@/lib/enterpriseGuideApi';

const G = (over: Partial<AdminEnterpriseGuide>): AdminEnterpriseGuide => ({
  id: 'g1', slug: 'getting-started', title: '도입 절차', summary: '요약', category: '시작하기',
  cover_image_url: null, body_md: '## 1단계', attachments: [], is_published: true, sort_order: 10,
  published_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z', created_at: '2026-11-01T00:00:00Z',
  created_by: null, updated_by: null, ...over,
});

const api = {
  adminListEnterpriseGuides: vi.fn(),
  adminUpsertEnterpriseGuide: vi.fn(),
  adminSetEnterpriseGuidePublished: vi.fn(),
  adminReorderEnterpriseGuides: vi.fn(),
  adminDeleteEnterpriseGuide: vi.fn(),
  adminUploadEnterpriseGuideFile: vi.fn(),
};
vi.mock('@/lib/enterpriseGuideApi', async (orig) => ({ ...(await orig<object>()), ...api }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock('@/store/toastStore', () => ({ toast: toastMock }));

const { default: EnterpriseGuidesPanel } = await import('./EnterpriseGuidesPanel');

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  toastMock.success.mockReset(); toastMock.error.mockReset();
  api.adminListEnterpriseGuides.mockResolvedValue([G({}), G({ id: 'g2', slug: 'ops', title: '운영 팁', is_published: false })]);
  api.adminSetEnterpriseGuidePublished.mockResolvedValue(undefined);
  api.adminReorderEnterpriseGuides.mockResolvedValue(undefined);
  api.adminDeleteEnterpriseGuide.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('EnterpriseGuidesPanel', () => {
  it('목록 — 공개·비공개 표시와 개수', async () => {
    render(<EnterpriseGuidesPanel />);
    expect(await screen.findByText('도입 절차')).toBeTruthy();
    expect(screen.getByText('운영 팁')).toBeTruthy();
    expect(screen.getByText(/2개 · 공개 1/)).toBeTruthy();
  });

  it('새 가이드 — 입력값 그대로 공개 저장, 제목 없으면 보내지 않는다', async () => {
    api.adminUpsertEnterpriseGuide.mockImplementation(async (d) => G({ ...d, id: 'new1', slug: 'first', attachments: [] }));
    render(<EnterpriseGuidesPanel />);
    await screen.findByText('도입 절차');
    fireEvent.click(screen.getByRole('button', { name: /새 가이드/ }));

    fireEvent.click(screen.getByRole('button', { name: /저장하고 공개/ }));
    expect(api.adminUpsertEnterpriseGuide).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith('제목을 입력해 주세요');

    fireEvent.change(screen.getByPlaceholderText(/듣다 도입 절차/), { target: { value: '첫 가이드' } });
    fireEvent.change(screen.getByPlaceholderText('getting-started'), { target: { value: 'First' } });
    fireEvent.change(screen.getByLabelText('본문'), { target: { value: '## 안녕' } });
    // 미리보기에 바로 보인다
    expect(screen.getAllByRole('heading', { name: '안녕' }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /저장하고 공개/ }));
    await waitFor(() => expect(api.adminUpsertEnterpriseGuide).toHaveBeenCalledWith(expect.objectContaining({
      id: null, title: '첫 가이드', slug: 'first', body_md: '## 안녕', is_published: true,
    })));
    expect(await screen.findByText('가이드 수정')).toBeTruthy(); // 저장 뒤 같은 글 편집 상태로
  });

  it('공개 전환·순서 바꾸기', async () => {
    render(<EnterpriseGuidesPanel />);
    await screen.findByText('도입 절차');
    fireEvent.click(screen.getByRole('button', { name: '도입 절차 비공개로' }));
    await waitFor(() => expect(api.adminSetEnterpriseGuidePublished).toHaveBeenCalledWith('g1', false));
    await waitFor(() => expect(screen.getByRole('button', { name: '운영 팁 위로' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '운영 팁 위로' }));
    await waitFor(() => expect(api.adminReorderEnterpriseGuides).toHaveBeenCalledWith(['g2', 'g1']));
  });

  it('삭제는 두 번 눌러야 한다', async () => {
    render(<EnterpriseGuidesPanel />);
    await screen.findByText('도입 절차');
    fireEvent.click(screen.getByRole('button', { name: '도입 절차 삭제' }));
    expect(api.adminDeleteEnterpriseGuide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '삭제?' }));
    await waitFor(() => expect(api.adminDeleteEnterpriseGuide).toHaveBeenCalledWith('g1'));
  });

  it('첨부 업로드 — 올린 파일이 목록에 붙고, 실패하면 알린다', async () => {
    render(<EnterpriseGuidesPanel />);
    await screen.findByText('도입 절차');
    const row = screen.getByText('도입 절차').closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: /수정/ }));
    const input = screen.getByText('파일 첨부').closest('label')!.querySelector('input')!;

    api.adminUploadEnterpriseGuideFile.mockResolvedValueOnce({ name: '소개서.pdf', url: 'https://x/storage/v1/object/public/enterprise-guides/a.pdf', size: 2048, type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [new File(['x'], '소개서.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByDisplayValue('소개서.pdf')).toBeTruthy();

    api.adminUploadEnterpriseGuideFile.mockRejectedValueOnce(new Error('파일은 20MB 이하만 올릴 수 있어요'));
    fireEvent.change(input, { target: { files: [new File(['x'], 'big.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  });
});
