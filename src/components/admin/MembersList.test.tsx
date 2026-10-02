// @vitest-environment jsdom
/**
 * MembersList — PHASE 2 변환 전 동작 보존 + 추가된 확인 단계 고정.
 *
 * 변환 전: fetch(fetchMemberList — 검색/필터 전부 서버 파라미터) / 디바운스 검색 /
 * 필터 4종 + 검색 / loading / empty / 행 클릭 → MemberDetail / 권한 select /
 * 플랜 select / 낙관적 로컬 갱신 / toast / AdminErrorState.
 * 추가: FilterBar 묶음 · 초기화 · 키보드 행 활성화 · 권한·플랜 변경 확인 단계.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { MemberRow } from '@/lib/adminApi';

const fetchMemberList = vi.fn();
const updateUserRole = vi.fn();
const updateUserPlan = vi.fn();
vi.mock('@/lib/adminApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/adminApi')>('@/lib/adminApi');
  return {
    ...actual,
    fetchMemberList: (o: unknown) => fetchMemberList(o),
    updateUserRole: (id: string, r: string) => updateUserRole(id, r),
    updateUserPlan: (id: string, p: string) => updateUserPlan(id, p),
  };
});
vi.mock('./MemberDetail', () => ({
  default: ({ userId }: { userId: string }) => <div>detail:{userId}</div>,
}));
const success = vi.fn();
const error = vi.fn();
vi.mock('@/store/toastStore', () => ({ toast: { success: (m: string) => success(m), error: (m: string) => error(m) } }));

const { default: MembersList } = await import('./MembersList');

function member(o: Partial<MemberRow> & { id: string }): MemberRow {
  return {
    email: `${o.id}@example.com`, nickname: '회원' + o.id, role: 'user',
    subscription_type: 'free', account_type: null, membership_tier: 'free',
    signup_completed: true, identity_verified: false, business_verified: false,
    business_number: null, created_at: '2026-09-01T00:00:00Z', last_seen_at: null,
    total_streams: 3, total_listened_seconds: 120, total_verified_seconds: 100,
    withdrawn_at: null, disabled_at: null, pii_masked_at: null, last_sign_in_at: null,
    has_cancel_scheduled: false, has_promotion: false, plan_type: null,
    is_enterprise_hq: false, is_franchise_store: false, enterprise_name: null,
    ...o,
  } as MemberRow;
}
const M1 = member({ id: 'm1' });

beforeEach(() => {
  fetchMemberList.mockReset(); updateUserRole.mockReset(); updateUserPlan.mockReset();
  success.mockReset(); error.mockReset();
  fetchMemberList.mockResolvedValue([M1]);
  updateUserRole.mockResolvedValue(undefined);
  updateUserPlan.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

async function ready() {
  render(<MembersList />);
  await screen.findByText('회원m1');
}

describe('MembersList — 로드/필터 (서버 파라미터 유지)', () => {
  it('마운트 시 fetchMemberList 를 부른다', async () => {
    await ready();
    expect(fetchMemberList).toHaveBeenCalled();
  });

  it('필터 변경이 서버 파라미터로 나간다 (클라이언트 필터가 아니다)', async () => {
    await ready();
    fireEvent.change(screen.getByLabelText('회원 유형'), { target: { value: 'artist' } });
    await waitFor(() =>
      expect(fetchMemberList).toHaveBeenCalledWith(expect.objectContaining({ category: 'artist' })),
    );
    fireEvent.change(screen.getByLabelText('권한'), { target: { value: 'admin' } });
    await waitFor(() =>
      expect(fetchMemberList).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' })),
    );
  });

  it('검색도 서버 파라미터로 나간다 (현재 페이지만 거르지 않는다)', async () => {
    await ready();
    fireEvent.change(screen.getByLabelText('회원 검색'), { target: { value: 'rozin' } });
    await waitFor(
      () => expect(fetchMemberList).toHaveBeenCalledWith(expect.objectContaining({ search: 'rozin' })),
      { timeout: 1500 },
    );
  });

  it('필터 개수 배지와 초기화가 동작한다', async () => {
    await ready();
    fireEvent.change(screen.getByLabelText('권한'), { target: { value: 'admin' } });
    expect(await screen.findByText('필터 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /초기화/ }));
    await waitFor(() => expect(screen.queryByText('필터 1')).toBeNull());
  });

  it('검색어 지우기 버튼이 남아 있다', async () => {
    await ready();
    fireEvent.change(screen.getByLabelText('회원 검색'), { target: { value: 'x' } });
    fireEvent.click(screen.getByLabelText('검색어 지우기'));
    expect((screen.getByLabelText('회원 검색') as HTMLInputElement).value).toBe('');
  });

  it('비었으면 empty 문구', async () => {
    fetchMemberList.mockResolvedValue([]);
    render(<MembersList />);
    expect(await screen.findByText('회원이 없어요.')).toBeTruthy();
  });

  it('접근 가능한 표 + 가로 스크롤', async () => {
    const { container } = render(<MembersList />);
    await screen.findByText('회원m1');
    expect(container.querySelector('caption')?.textContent).toBe('회원 목록');
    expect(container.querySelector('table')?.style.minWidth).toBe('980px');
  });
});

describe('MembersList — 행 클릭 → 상세', () => {
  it('클릭으로 상세가 열린다', async () => {
    await ready();
    fireEvent.click(screen.getByText('회원m1'));
    expect(screen.getByText('detail:m1')).toBeTruthy();
  });

  it('키보드(Enter)로도 열린다 — 변환으로 추가된 접근성', async () => {
    await ready();
    const row = screen.getAllByRole('row')[1];
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(screen.getByText('detail:m1')).toBeTruthy();
  });

  it('권한 select 클릭은 상세를 열지 않는다 (stopPropagation 유지)', async () => {
    await ready();
    fireEvent.click(screen.getByLabelText('회원m1 권한'));
    expect(screen.queryByText('detail:m1')).toBeNull();
  });
});

describe('MembersList — 권한 변경 (확인 단계 추가)', () => {
  it('select 를 바꾸면 바로 반영되지 않고 확인을 묻는다', async () => {
    await ready();
    fireEvent.change(screen.getByLabelText('회원m1 권한'), { target: { value: 'admin' } });
    expect(updateUserRole).not.toHaveBeenCalled();
    const d = screen.getByRole('dialog');
    expect(d.textContent).toContain('회원m1');
    expect(d.textContent).toContain('관리자 콘솔 전체에 접근');
  });

  it('확인하면 updateUserRole 을 부른다', async () => {
    await ready();
    fireEvent.change(screen.getByLabelText('회원m1 권한'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('dialog').querySelector('footer button:last-child')!);
    await waitFor(() => expect(updateUserRole).toHaveBeenCalledWith('m1', 'admin'));
    await waitFor(() => expect(success).toHaveBeenCalledWith('권한이 변경됐어요.'));
  });

  it('취소하면 변경하지 않는다', async () => {
    await ready();
    fireEvent.change(screen.getByLabelText('회원m1 권한'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(updateUserRole).not.toHaveBeenCalled();
  });

  it('관리자 승격은 destructive 로 구분된다', async () => {
    await ready();
    fireEvent.change(screen.getByLabelText('회원m1 권한'), { target: { value: 'admin' } });
    expect(screen.getByRole('button', { name: '관리자로 변경' })).toBeTruthy();
  });

  it('실패하면 toast.error', async () => {
    updateUserRole.mockRejectedValue(new Error('nope'));
    await ready();
    fireEvent.change(screen.getByLabelText('회원m1 권한'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('dialog').querySelector('footer button:last-child')!);
    await waitFor(() => expect(error).toHaveBeenCalled());
  });
});

describe('MembersList — 플랜 변경 (확인 단계 추가)', () => {
  it('확인 후 updateUserPlan 을 부르고 낙관적 갱신이 유지된다', async () => {
    await ready();
    fireEvent.change(screen.getByLabelText('회원m1 플랜'), { target: { value: 'business' } });
    expect(updateUserPlan).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').textContent).toContain('사업자');
    fireEvent.click(screen.getByRole('dialog').querySelector('footer button:last-child')!);
    await waitFor(() => expect(updateUserPlan).toHaveBeenCalledWith('m1', 'business'));
    await waitFor(() => expect(success).toHaveBeenCalledWith('플랜이 변경됐어요.'));
  });

  it('취소하면 select 가 원래 값으로 남는다', async () => {
    await ready();
    const sel = screen.getByLabelText('회원m1 플랜') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'business' } });
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(updateUserPlan).not.toHaveBeenCalled();
    expect(sel.value).toBe('free');
  });
});
