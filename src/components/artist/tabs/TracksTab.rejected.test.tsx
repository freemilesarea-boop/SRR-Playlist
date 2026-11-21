// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

afterEach(() => cleanup());

vi.mock('@/components/artist/dashboard/parts', () => ({
  UploadGate: () => null,
  MyTrackRow: ({ track }: { track: { title: string } }) => <li>{track.title}</li>,
}));

import TracksTab from './TracksTab';
import { isRejectedTrack } from '@/components/artist/dashboard/constants';
import type { MyArtistTrackRow } from '@/lib/artistApi';

const row = (title: string, release_status: string, visibility_status: string) =>
  ({ track_id: title, title, release_status, visibility_status, created_at: '2026-11-21T00:00:00Z' }) as unknown as MyArtistTrackRow;

const tracks = [
  row('발매곡', 'released', 'approved'),
  row('심사곡', 'submitted', 'pending_review'),
  row('반려곡A', 'removed', 'hidden'),
  row('반려곡B', 'removed', 'hidden'),
];

function renderTab() {
  return render(
    <TracksTab
      isApproved={false} tracks={tracks} qcMap={new Map()} loading={false}
      eligibility={null} payout={null} payoutMasked={null} billingPaused={false} userEmail="" plan={null}
      editingTrack={null} onCancelEdit={() => {}} onUploaded={() => {}} onPayoutSubmitted={() => {}}
      onEdit={() => {}} onOpenQcDetail={() => {}} onChanged={() => {}}
    />,
  );
}

describe('음원 관리 — 반려 음원 접기', () => {
  it('검수 반려(removed/hidden)를 반려로 본다', () => {
    expect(isRejectedTrack({ release_status: 'removed', visibility_status: 'hidden' })).toBe(true);
    expect(isRejectedTrack({ release_status: 'submitted', visibility_status: 'rejected' })).toBe(true);
    expect(isRejectedTrack({ release_status: 'released', visibility_status: 'approved' })).toBe(false);
  });

  it("'전체'에서는 반려곡을 접어 두고, 펼치면 보인다", () => {
    renderTab();
    expect(screen.getByText('발매곡')).toBeTruthy();
    expect(screen.getByText('심사곡')).toBeTruthy();
    expect(screen.queryByText('반려곡A')).toBeNull();
    const toggle = screen.getByRole('button', { name: /반려된 음원 2개/ });
    fireEvent.click(toggle);
    expect(screen.getByText('반려곡A')).toBeTruthy();
  });

  it("'반려' 필터에는 반려곡만, 개수도 반려곡 수", () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /^반려 2$/ }));
    expect(screen.getByText('반려곡B')).toBeTruthy();
    expect(screen.queryByText('발매곡')).toBeNull();
  });
});
