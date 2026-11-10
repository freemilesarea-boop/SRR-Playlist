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
import { memberListRpcArgs, MEMBER_SORT_OPTIONS, type MemberRow } from '@/lib/adminApi';

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

describe('MembersList — 정렬 (0549, 서버 정렬)', () => {
  it('기본은 최신 가입순이다', async () => {
    await ready();
    expect((screen.getByLabelText('정렬') as HTMLSelectElement).value).toBe('created_desc');
    expect(fetchMemberList).toHaveBeenCalledWith(expect.objectContaining({ sort: 'created_desc' }));
  });

  it('정렬 선택지 6가지를 보여준다', async () => {
    await ready();
    const labels = Array.from((screen.getByLabelText('정렬') as HTMLSelectElement).options).map((o) => o.text);
    expect(labels).toEqual([
      '최신 가입순', '오래된 가입순', '최근 접속순', '청취시간 많은순', '스트리밍 많은순', '이름순 (가나다)',
    ]);
  });

  it('정렬을 바꾸면 서버에 다시 요청한다 (받아온 100명만 다시 정렬하지 않는다)', async () => {
    await ready();
    fireEvent.change(screen.getByLabelText('정렬'), { target: { value: 'created_asc' } });
    await waitFor(() =>
      expect(fetchMemberList).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'created_asc' })),
    );
  });

  it('정렬은 필터 개수에 들어가지 않고 초기화로 되돌아가지 않는다', async () => {
    await ready();
    fireEvent.change(screen.getByLabelText('정렬'), { target: { value: 'listened_desc' } });
    fireEvent.change(screen.getByLabelText('권한'), { target: { value: 'admin' } });
    expect(await screen.findByText('필터 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /초기화/ }));
    await waitFor(() => expect(screen.queryByText('필터 1')).toBeNull());
    expect((screen.getByLabelText('정렬') as HTMLSelectElement).value).toBe('listened_desc');
  });
});

describe('MembersList — 더 보기 (100명씩)', () => {
  const page = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => member({ id: `p${from + i}` }));

  it('100명 미만이면 더 보기를 보여주지 않는다', async () => {
    await ready();
    expect(screen.queryByRole('button', { name: /더 보기/ })).toBeNull();
    expect(screen.getByText('1명 표시 중')).toBeTruthy();
  });

  it('100명이 꽉 차면 더 보기 → offset 100 으로 다음 장을 받아 뒤에 붙인다', async () => {
    fetchMemberList.mockImplementation((o: { offset?: number }) =>
      Promise.resolve(o.offset === 100 ? page(100, 30) : page(0, 100)));
    render(<MembersList />);
    await screen.findByText('회원p0');
    expect(screen.getByText('100명 표시 중 · 더 있음')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /더 보기/ }));
    await screen.findByText('회원p129');
    expect(fetchMemberList).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 100, limit: 100, sort: 'created_desc' }),
    );
    expect(screen.getByText('회원p0')).toBeTruthy(); // 앞 장이 그대로 남는다
    expect(screen.getByText('130명 표시 중')).toBeTruthy();
    // 마지막 장(30명)이면 버튼이 사라진다
    expect(screen.queryByRole('button', { name: /더 보기/ })).toBeNull();
  });

  it('다음 장은 지금 걸린 필터·정렬 그대로 받는다', async () => {
    fetchMemberList.mockResolvedValue(page(0, 100));
    render(<MembersList />);
    await screen.findByText('회원p0');
    fireEvent.change(screen.getByLabelText('정렬'), { target: { value: 'listened_desc' } });
    fireEvent.change(screen.getByLabelText('회원 유형'), { target: { value: 'business' } });
    await waitFor(() =>
      expect(fetchMemberList).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'business', offset: 0 })),
    );
    fireEvent.click(await screen.findByRole('button', { name: /더 보기/ }));
    await waitFor(() =>
      expect(fetchMemberList).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 100, category: 'business', sort: 'listened_desc' }),
      ),
    );
  });

  it('필터를 바꾸면 처음 장부터 다시 받는다 (펼친 목록을 이어 붙이지 않는다)', async () => {
    fetchMemberList.mockImplementation((o: { offset?: number; role?: string }) =>
      Promise.resolve(o.role === 'admin' ? [member({ id: 'adm' })] : o.offset === 100 ? page(100, 10) : page(0, 100)));
    render(<MembersList />);
    await screen.findByText('회원p0');
    fireEvent.click(screen.getByRole('button', { name: /더 보기/ }));
    await screen.findByText('회원p109');
    fireEvent.change(screen.getByLabelText('권한'), { target: { value: 'admin' } });
    await screen.findByText('회원adm');
    expect(screen.queryByText('회원p0')).toBeNull();
    expect(screen.getByText('1명 표시 중')).toBeTruthy();
  });

  it('페이지 사이에 가입이 생겨 경계 행이 겹쳐 와도 두 번 보이지 않는다', async () => {
    fetchMemberList.mockImplementation((o: { offset?: number }) =>
      Promise.resolve(o.offset === 100 ? page(99, 5) : page(0, 100)));
    render(<MembersList />);
    await screen.findByText('회원p0');
    fireEvent.click(screen.getByRole('button', { name: /더 보기/ }));
    await screen.findByText('회원p103');
    expect(screen.getAllByText('회원p99')).toHaveLength(1);
    expect(screen.getByText('104명 표시 중')).toBeTruthy();
  });

  it('더 보기 실패는 목록을 지우지 않고 toast 로 알린다', async () => {
    fetchMemberList.mockImplementation((o: { offset?: number }) =>
      o.offset === 100 ? Promise.reject(new Error('net')) : Promise.resolve(page(0, 100)));
    render(<MembersList />);
    await screen.findByText('회원p0');
    fireEvent.click(screen.getByRole('button', { name: /더 보기/ }));
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(screen.getByText('회원p0')).toBeTruthy();
    expect(screen.getByRole('button', { name: /더 보기/ })).toBeTruthy();
  });

  it('탭 복귀 새로고침은 지금 필터로, 펼쳐 둔 만큼 다시 받는다', async () => {
    fetchMemberList.mockImplementation((o: { offset?: number }) =>
      Promise.resolve(o.offset === 100 ? page(100, 100) : page(0, 100)));
    render(<MembersList />);
    await screen.findByText('회원p0');
    fireEvent.change(screen.getByLabelText('정렬'), { target: { value: 'created_asc' } });
    await waitFor(() =>
      expect(fetchMemberList).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'created_asc', offset: 0 })),
    );
    fireEvent.click(await screen.findByRole('button', { name: /더 보기/ }));
    await screen.findByText('회원p199');
    fireEvent(window, new Event('focus'));
    await waitFor(() =>
      expect(fetchMemberList).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'created_asc', offset: 0, limit: 200 }),
      ),
    );
  });
});

describe('memberListRpcArgs', () => {
  it('기본 정렬이면 p_sort 를 보내지 않는다 — 0549 이전 서버(7인자)와도 맞는다', () => {
    expect(memberListRpcArgs({})).not.toHaveProperty('p_sort');
    expect(memberListRpcArgs({ sort: 'created_desc' })).not.toHaveProperty('p_sort');
  });

  it('그 밖의 정렬은 p_sort 로 보낸다', () => {
    for (const { value } of MEMBER_SORT_OPTIONS.filter((o) => o.value !== 'created_desc')) {
      expect(memberListRpcArgs({ sort: value }).p_sort).toBe(value);
    }
  });

  it('기존 인자는 그대로다', () => {
    expect(memberListRpcArgs({ search: 'a', category: 'artist' })).toEqual({
      p_limit: 100, p_offset: 0, p_search: 'a', p_plan: null, p_role: null, p_status: null, p_category: 'artist',
    });
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
