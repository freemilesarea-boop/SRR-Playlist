// @vitest-environment jsdom
/**
 * MetadataViolationsList — 비-테이블(카드 목록) 화면의 PHASE 2 변환 검증.
 *
 * 변환 전: 상태 필터 5종 / 목록 / 상태 변경(resolveMetadataViolation) /
 * 제외(window.confirm → excludeTrackFromPlaylist) / toast.
 * 변환: 필터를 FilterBar 로 묶고 결과 개수 추가, 제외를 ConfirmDialog 로.
 * AdminTable 은 적용하지 않는다 — 이 화면은 표가 아니라 카드 목록이다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { MetadataViolation } from '@/lib/skipApi';

const listMetadataViolations = vi.fn();
const resolveMetadataViolation = vi.fn();
const excludeTrackFromPlaylist = vi.fn();
const metadataViolationStats = vi.fn();
vi.mock('@/lib/skipApi', () => ({
  listMetadataViolations: (f: string) => listMetadataViolations(f),
  resolveMetadataViolation: (id: string, s: string, n?: string) => resolveMetadataViolation(id, s, n),
  excludeTrackFromPlaylist: (p: string, t: string) => excludeTrackFromPlaylist(p, t),
  metadataViolationStats: () => metadataViolationStats(),
}));
vi.mock('@/components/artist/TrackMetaSelectors', () => ({ default: () => <div>meta-selectors</div> }));
const success = vi.fn();
const error = vi.fn();
vi.mock('@/store/toastStore', () => ({ toast: { success: (m: string) => success(m), error: (m: string) => error(m) } }));

const { default: MetadataViolationsList } = await import('./MetadataViolationsList');

const ROW = {
  id: 'v1', track_id: 't1', playlist_id: 'p1',
  title: '한여름 밤', artist_name: '로진 로이어', playlist_title: '카페 재즈',
  playlist_skip_count: 4, total_skip_count: 5, status: 'pending',
  note: null, created_at: '2026-09-01T00:00:00Z',
} as unknown as MetadataViolation;

beforeEach(() => {
  listMetadataViolations.mockReset(); resolveMetadataViolation.mockReset();
  excludeTrackFromPlaylist.mockReset(); metadataViolationStats.mockReset();
  success.mockReset(); error.mockReset();
  listMetadataViolations.mockResolvedValue([ROW]);
  metadataViolationStats.mockResolvedValue(null);
  excludeTrackFromPlaylist.mockResolvedValue(undefined);
  resolveMetadataViolation.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

async function ready() {
  render(<MetadataViolationsList />);
  await screen.findByText('한여름 밤');
}

describe('MetadataViolationsList — 필터/목록 보존', () => {
  it('목록을 불러온다', async () => {
    await ready();
    expect(listMetadataViolations).toHaveBeenCalled();
  });

  it('상태 필터 5종이 FilterBar 안에 남아 있다', async () => {
    await ready();
    const bar = screen.getByRole('region', { name: '검색 및 필터' });
    for (const label of ['전체']) expect(bar.textContent).toContain(label);
    expect(bar.querySelectorAll('button[aria-pressed]').length).toBe(5);
  });

  it('필터를 누르면 서버를 다시 부른다 (기존 동작)', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    // 컴포넌트는 'all' 을 null 로 바꿔 넘긴다 (기존 동작).
    await waitFor(() => expect(listMetadataViolations).toHaveBeenCalledWith(null));
  });

  it('결과 개수를 보여준다 (추가)', async () => {
    await ready();
    expect(screen.getByRole('region', { name: '검색 및 필터' }).textContent).toContain('1건');
  });

  it('검색창을 넣지 않았다 (이 화면은 서버가 상태로 이미 거른다)', async () => {
    await ready();
    expect(screen.getByRole('region', { name: '검색 및 필터' }).querySelector('input')).toBeNull();
  });
});

describe('MetadataViolationsList — 제외 (ConfirmDialog 로 교체)', () => {
  it('확인 창에 곡과 플레이리스트가 모두 보인다', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /제외/ }));
    const d = screen.getByRole('dialog');
    expect(d.textContent).toContain('한여름 밤');
    expect(d.textContent).toContain('카페 재즈');
    expect(d.textContent).toContain('되돌리려면');
  });

  it('확인하면 excludeTrackFromPlaylist 를 기존 인자로 부른다', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /제외/ }));
    fireEvent.click(screen.getByRole('dialog').querySelector('footer button:last-child')!);
    await waitFor(() => expect(excludeTrackFromPlaylist).toHaveBeenCalledWith('p1', 't1'));
    await waitFor(() => expect(success).toHaveBeenCalledWith('플레이리스트에서 제외했어요.'));
  });

  it('취소하면 제외하지 않는다', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /제외/ }));
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(excludeTrackFromPlaylist).not.toHaveBeenCalled();
  });

  it('실패하면 toast.error (기존 메시지 유지)', async () => {
    excludeTrackFromPlaylist.mockRejectedValue(new Error('boom'));
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /제외/ }));
    fireEvent.click(screen.getByRole('dialog').querySelector('footer button:last-child')!);
    await waitFor(() => expect(error).toHaveBeenCalledWith('제외 실패: boom'));
  });
});

describe('MetadataViolationsList — 상태 변경은 그대로', () => {
  it('해결 처리에는 확인 창을 붙이지 않았다 (되돌릴 수 있는 분류 작업)', async () => {
    await ready();
    // '해결' 은 두 버튼에 들어간다 — 행 액션인 '이상 없음(해결)' 을 쓴다.
    fireEvent.click(screen.getByRole('button', { name: /이상 없음/ }));
    await waitFor(() => expect(resolveMetadataViolation).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
