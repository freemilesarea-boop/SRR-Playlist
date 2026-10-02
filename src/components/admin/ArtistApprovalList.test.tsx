// @vitest-environment jsdom
/**
 * ArtistApprovalList — PHASE 2 변환 전 동작을 그대로 유지하는지 고정한다.
 *
 * 변환 전 체크리스트: fetch(list_pending_artists p_limit 100) / loading / empty /
 * 승인(approve_artist_profile) / 거절(reject_artist_profile + 사유) /
 * 동기화(repairArtistSignups) / toast 성공·실패 / busyId 잠금.
 * 변환으로 추가된 것: 검색·상태 필터(이미 받아온 rows 범위) · 결과 개수 · 확인 단계.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

const repairArtistSignups = vi.fn();
vi.mock('@/lib/artistApi', () => ({ repairArtistSignups: () => repairArtistSignups() }));

const success = vi.fn();
const error = vi.fn();
vi.mock('@/store/toastStore', () => ({ toast: { success: (m: string) => success(m), error: (m: string) => error(m) } }));

const { default: ArtistApprovalList } = await import('./ArtistApprovalList');

const ROWS = [
  {
    user_id: 'u1', real_name: '김철수', artist_name: '로진 로이어', phone: '010-1111-2222',
    email: 'rozin@example.com', approval_status: 'pending', rejected_reason: null,
    created_at: '2026-09-01T00:00:00Z',
  },
  {
    user_id: 'u2', real_name: '이영희', artist_name: '민선', phone: '010-3333-4444',
    email: 'minsun@example.com', approval_status: 'approved', rejected_reason: null,
    created_at: '2026-09-02T00:00:00Z',
  },
];

beforeEach(() => {
  rpc.mockReset(); repairArtistSignups.mockReset(); success.mockReset(); error.mockReset();
  rpc.mockResolvedValue({ data: ROWS, error: null });
});
afterEach(() => cleanup());

async function renderReady() {
  render(<ArtistApprovalList />);
  await screen.findByText('로진 로이어');
}

describe('ArtistApprovalList — 데이터 로드', () => {
  it('list_pending_artists 를 p_limit 100 으로 부른다 (기존 호출 유지)', async () => {
    await renderReady();
    expect(rpc).toHaveBeenCalledWith('list_pending_artists', { p_limit: 100 });
  });

  it('심사 대기 건수를 헤더에 보여준다', async () => {
    await renderReady();
    expect(screen.getByText('심사 대기 1건')).toBeTruthy();
  });

  it('로드 실패 시 toast.error', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('boom') });
    render(<ArtistApprovalList />);
    await waitFor(() => expect(error).toHaveBeenCalled());
  });

  it('비었으면 empty 문구', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    render(<ArtistApprovalList />);
    expect(await screen.findByText('아티스트 신청이 없어요.')).toBeTruthy();
  });

  it('접근 가능한 표 + 가로 스크롤 래퍼', async () => {
    const { container } = render(<ArtistApprovalList />);
    await screen.findByText('로진 로이어');
    expect(container.querySelector('caption')?.textContent).toBe('아티스트 승인 신청 목록');
    expect(container.querySelector('.overflow-x-auto')).toBeTruthy();
  });
});

describe('ArtistApprovalList — 검색/필터 (이미 받아온 범위)', () => {
  it('검색은 서버를 다시 부르지 않는다', async () => {
    await renderReady();
    const callsBefore = rpc.mock.calls.length;
    fireEvent.change(screen.getByLabelText('아티스트 검색'), { target: { value: '민선' } });
    expect(screen.queryByText('로진 로이어')).toBeNull();
    expect(screen.getByText('민선')).toBeTruthy();
    expect(rpc.mock.calls.length).toBe(callsBefore);
  });

  it('이메일로도 검색된다', async () => {
    await renderReady();
    fireEvent.change(screen.getByLabelText('아티스트 검색'), { target: { value: 'rozin@' } });
    expect(screen.getByText('로진 로이어')).toBeTruthy();
    expect(screen.queryByText('민선')).toBeNull();
  });

  it('상태 필터가 동작한다', async () => {
    await renderReady();
    fireEvent.click(screen.getByRole('button', { name: '승인됨' }));
    expect(screen.queryByText('로진 로이어')).toBeNull();
    expect(screen.getByText('민선')).toBeTruthy();
  });

  it('결과 개수를 보여주고 초기화로 되돌린다', async () => {
    await renderReady();
    expect(screen.getByText('2건')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('아티스트 검색'), { target: { value: '민선' } });
    expect(screen.getByText('1건 / 불러온 2건')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /초기화/ }));
    expect(screen.getByText('2건')).toBeTruthy();
    expect(screen.getByText('로진 로이어')).toBeTruthy();
  });
});

describe('ArtistApprovalList — 승인', () => {
  it('확인 창에 대상 아티스트명이 보인다', async () => {
    await renderReady();
    fireEvent.click(screen.getAllByRole('button', { name: '승인' })[0]);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('로진 로이어');
    expect(dialog.textContent).toContain('음원을 업로드');
  });

  it('확인하면 approve_artist_profile 을 부른다', async () => {
    await renderReady();
    fireEvent.click(screen.getAllByRole('button', { name: '승인' })[0]);
    fireEvent.click(screen.getByRole('dialog').querySelector('footer button:last-child')!);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('approve_artist_profile', { p_user_id: 'u1' }),
    );
    await waitFor(() => expect(success).toHaveBeenCalledWith('승인 완료'));
  });

  it('취소하면 아무 RPC 도 부르지 않는다', async () => {
    await renderReady();
    const before = rpc.mock.calls.length;
    fireEvent.click(screen.getAllByRole('button', { name: '승인' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rpc.mock.calls.length).toBe(before);
  });
});

describe('ArtistApprovalList — 거절', () => {
  it('사유를 입력해 거절하면 p_reason 으로 전달된다', async () => {
    await renderReady();
    fireEvent.click(screen.getAllByRole('button', { name: '거절' })[0]);
    fireEvent.change(screen.getByLabelText('거절 사유'), { target: { value: '서류 미비' } });
    fireEvent.click(screen.getByRole('dialog').querySelector('footer button:last-child')!);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('reject_artist_profile', {
        p_user_id: 'u1',
        p_reason: '서류 미비',
      }),
    );
  });

  it('사유를 비워도 거절할 수 있다 (기존과 동일)', async () => {
    await renderReady();
    fireEvent.click(screen.getAllByRole('button', { name: '거절' })[0]);
    fireEvent.click(screen.getByRole('dialog').querySelector('footer button:last-child')!);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('reject_artist_profile', { p_user_id: 'u1', p_reason: '' }),
    );
  });

  it('★ 취소하면 거절이 실행되지 않는다 — 변환 전 window.prompt 취소는 그냥 거절됐다', async () => {
    await renderReady();
    const before = rpc.mock.calls.length;
    fireEvent.click(screen.getAllByRole('button', { name: '거절' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(rpc.mock.calls.length).toBe(before);
    expect(rpc).not.toHaveBeenCalledWith('reject_artist_profile', expect.anything());
  });

  it('거절 확인 버튼은 destructive 로 구분된다', async () => {
    await renderReady();
    fireEvent.click(screen.getAllByRole('button', { name: '거절' })[0]);
    const confirmBtn = screen.getByRole('dialog').querySelector('footer button:last-child')!;
    expect(confirmBtn.textContent).toBe('거절');
    expect(confirmBtn.className).not.toBe('');
  });
});

describe('ArtistApprovalList — 동기화', () => {
  it('확인 후 repairArtistSignups 를 부르고 결과를 toast 로 알린다', async () => {
    repairArtistSignups.mockResolvedValue({
      ok: true, scanned: 5, users_updated: 1, profiles_created: 2, skipped: 2,
    });
    await renderReady();
    fireEvent.click(screen.getByRole('button', { name: /누락된 아티스트 신청 동기화/ }));
    expect(screen.getByRole('dialog').textContent).toContain('일괄 보정');
    fireEvent.click(screen.getByRole('dialog').querySelector('footer button:last-child')!);
    await waitFor(() => expect(repairArtistSignups).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(success).toHaveBeenCalled());
  });

  it('실패하면 toast.error 로 알린다', async () => {
    repairArtistSignups.mockResolvedValue({ ok: false, error: '권한 없음' });
    await renderReady();
    fireEvent.click(screen.getByRole('button', { name: /누락된 아티스트 신청 동기화/ }));
    fireEvent.click(screen.getByRole('dialog').querySelector('footer button:last-child')!);
    await waitFor(() => expect(error).toHaveBeenCalledWith('권한 없음'));
  });

  it('취소하면 호출하지 않는다', async () => {
    await renderReady();
    fireEvent.click(screen.getByRole('button', { name: /누락된 아티스트 신청 동기화/ }));
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(repairArtistSignups).not.toHaveBeenCalled();
  });
});
