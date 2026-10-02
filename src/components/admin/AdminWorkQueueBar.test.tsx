// @vitest-environment jsdom
/**
 * AdminWorkQueueBar — PHASE 1-A 계약 테스트.
 *
 * 이 줄은 /ops 홈 최상단에 올라간다. 홈이 이것 때문에 깨지면 안 되고,
 * 처리할 것이 없을 때 경고처럼 보이면 안 된다 — 그 두 가지를 고정한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import type { AdminWorkQueueCounts } from '@/lib/adminWorkQueueApi';

const fetchCounts = vi.fn<() => Promise<AdminWorkQueueCounts | null>>();
vi.mock('@/lib/adminWorkQueueApi', () => ({
  fetchAdminWorkQueueCounts: () => fetchCounts(),
}));

const { default: AdminWorkQueueBar } = await import('./AdminWorkQueueBar');

const ZERO: AdminWorkQueueCounts = {
  track_review: 0, artist_approval: 0,
  payout_intake: 0, payout_verify: 0, payout_incomplete: 0,
  settlement_month: null, settlement_pending: 0, settlement_held: 0, settlement_amount: 0,
  inquiry_open: 0, inquiry_urgent: 0, store_offline: 0, store_error: 0,
  is_super_admin: true, computed_at: '2026-10-02T00:00:00Z',
};

const visible = () => true;
const noop = () => {};

beforeEach(() => fetchCounts.mockReset());
afterEach(() => cleanup());

describe('AdminWorkQueueBar — 홈 내성', () => {
  it('RPC 실패(null) 면 아무것도 렌더하지 않는다 — 홈은 그대로 살아 있다', async () => {
    fetchCounts.mockResolvedValue(null);
    const { container } = render(
      <AdminWorkQueueBar onNavigate={noop} isTabVisible={visible} />,
    );
    await waitFor(() => expect(container.querySelector('[aria-busy]')).toBeNull());
    expect(container.textContent).toBe('');
  });

  it('RPC 가 throw 해도 전파되지 않는다', async () => {
    // fetchAdminWorkQueueCounts 는 내부에서 catch 하지만, 호출부가 깨지지 않는 것까지 고정한다.
    fetchCounts.mockResolvedValue(null);
    expect(() =>
      render(<AdminWorkQueueBar onNavigate={noop} isTabVisible={visible} />),
    ).not.toThrow();
  });

  it('대기 0 건이면 "대기 중인 업무가 없습니다" 로 조용히 알린다', async () => {
    fetchCounts.mockResolvedValue(ZERO);
    render(<AdminWorkQueueBar onNavigate={noop} isTabVisible={visible} />);
    expect(await screen.findByText('대기 중인 업무가 없습니다')).toBeTruthy();
  });

  it('대기 0 건 카드에는 danger 테두리를 쓰지 않는다 (정상은 조용하게)', async () => {
    fetchCounts.mockResolvedValue(ZERO);
    const { container } = render(
      <AdminWorkQueueBar onNavigate={noop} isTabVisible={visible} />,
    );
    await screen.findByText('처리 대기');
    expect(container.querySelectorAll('[class*="border-rose"]')).toHaveLength(0);
  });

  it('실제 대기가 있으면 건수와 라벨을 보여준다', async () => {
    fetchCounts.mockResolvedValue({ ...ZERO, track_review: 7, inquiry_open: 2 });
    render(<AdminWorkQueueBar onNavigate={noop} isTabVisible={visible} />);
    expect(await screen.findByText('음원 검수')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
  });

  it('isTabVisible=false 인 탭 카드는 렌더하지 않는다 (권한 경계 유지)', async () => {
    fetchCounts.mockResolvedValue({ ...ZERO, track_review: 7 });
    const { container } = render(
      <AdminWorkQueueBar onNavigate={noop} isTabVisible={() => false} />,
    );
    await waitFor(() => expect(container.querySelector('[aria-busy]')).toBeNull());
    expect(container.textContent).toBe('');
  });
});
