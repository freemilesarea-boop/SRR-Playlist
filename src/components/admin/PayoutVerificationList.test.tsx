// @vitest-environment jsdom
/**
 * PayoutVerificationList — PHASE 2 변환 전 동작 보존 + 추가된 것 고정.
 *
 * 변환 전 체크리스트: fetch(listPendingPayoutAccounts) / loading / empty(2종 문구) /
 * 상태 필터 5종 + 개수 / initialFilter prop / 승인(verifyArtistPayoutAccount) /
 * 거절(rejectArtistPayoutAccount + window.prompt 사유, 사유 필수) /
 * 계좌 변경 다이얼로그 / RevealPiiButton(is_pii_complete 조건) /
 * PII 미완료 시 승인 버튼 비활성 / '승인됨 · 지급 보류' 구분 / toast.
 * 추가: 검색(받아온 전체 범위) · 결과 개수 · 승인 확인 단계.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { AdminPayoutRow } from '@/lib/artistApi';

const listPendingPayoutAccounts = vi.fn();
const verifyArtistPayoutAccount = vi.fn();
const rejectArtistPayoutAccount = vi.fn();
vi.mock('@/lib/artistApi', () => ({
  listPendingPayoutAccounts: () => listPendingPayoutAccounts(),
  verifyArtistPayoutAccount: (id: string) => verifyArtistPayoutAccount(id),
  rejectArtistPayoutAccount: (id: string, r: string) => rejectArtistPayoutAccount(id, r),
}));
vi.mock('./RevealPiiButton', () => ({
  default: ({ maskedValue }: { maskedValue: string }) => <button>reveal:{maskedValue}</button>,
}));
vi.mock('./PayoutAccountEditDialog', () => ({
  default: ({ row }: { row: AdminPayoutRow }) => <div>edit-dialog:{row.account_id}</div>,
}));
const success = vi.fn();
const error = vi.fn();
vi.mock('@/store/toastStore', () => ({ toast: { success: (m: string) => success(m), error: (m: string) => error(m) } }));

const { default: PayoutVerificationList } = await import('./PayoutVerificationList');

function row(o: Partial<AdminPayoutRow> & { account_id: string }): AdminPayoutRow {
  return {
    user_id: 'u-' + o.account_id,
    artist_name: '로진 로이어', email: 'rozin@example.com', legal_name: '김철수',
    masked_rrn: '900101-*******', bank_name: '우리은행',
    masked_account_number: '1002-***-545816', account_holder: '유지은',
    tax_withholding_type: 'business_income_3_3', has_tax_consent: true,
    tax_consent_at: '2026-09-01T00:00:00Z', is_pii_complete: true,
    verification_status: 'pending', rejected_reason: null,
    created_at: '2026-09-01T00:00:00Z',
    ...o,
  } as AdminPayoutRow;
}

const PENDING = row({ account_id: 'a1' });
const HELD = row({
  account_id: 'a2', artist_name: '민선', email: 'minsun@example.com',
  verification_status: 'verified', is_pii_complete: false, masked_rrn: null,
  has_tax_consent: false, tax_consent_at: null,
});

beforeEach(() => {
  listPendingPayoutAccounts.mockReset(); verifyArtistPayoutAccount.mockReset();
  rejectArtistPayoutAccount.mockReset(); success.mockReset(); error.mockReset();
  listPendingPayoutAccounts.mockResolvedValue([PENDING, HELD]);
  verifyArtistPayoutAccount.mockResolvedValue({ ok: true });
  rejectArtistPayoutAccount.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function ready() {
  render(<PayoutVerificationList />);
  await screen.findByText('로진 로이어');
}

describe('PayoutVerificationList — 로드/표시 보존', () => {
  it('listPendingPayoutAccounts 를 부른다', async () => {
    await ready();
    expect(listPendingPayoutAccounts).toHaveBeenCalled();
  });

  it('헤더에 확인 대기 / 정보 미완비 건수를 유지한다', async () => {
    await ready();
    expect(screen.getByText(/확인 대기 1건 · 정보 미완비 1건/)).toBeTruthy();
  });

  it("'승인됨 · 지급 보류' 구분이 남아 있다", async () => {
    await ready();
    expect(screen.getByText('승인됨 · 지급 보류')).toBeTruthy();
  });

  it('PII 완비 행만 RevealPiiButton 을 쓴다', async () => {
    await ready();
    expect(screen.getByText('reveal:900101-*******')).toBeTruthy();
    expect(screen.getByText('reveal:1002-***-545816')).toBeTruthy();
    expect(screen.getByText('PII 미완료')).toBeTruthy();
  });

  it('PII 미완료 행은 승인 버튼이 비활성이다', async () => {
    await ready();
    const btns = screen.getAllByRole('button', { name: '승인' });
    // HELD 는 verified 라 승인 버튼이 없다 → pending 행 하나만 활성
    expect(btns).toHaveLength(1);
    expect(btns[0].hasAttribute('disabled')).toBe(false);
  });

  it('비었으면 전용 문구', async () => {
    listPendingPayoutAccounts.mockResolvedValue([]);
    render(<PayoutVerificationList />);
    expect(await screen.findByText('등록된 정산 계좌가 없어요.')).toBeTruthy();
  });

  it('접근 가능한 표 + minWidth 가로 스크롤', async () => {
    const { container } = render(<PayoutVerificationList />);
    await screen.findByText('로진 로이어');
    expect(container.querySelector('caption')?.textContent).toBe('정산 계좌 목록');
    expect(container.querySelector('table')?.style.minWidth).toBe('760px');
  });

  it('PII 경고 Alert 가 남아 있다', async () => {
    await ready();
    expect(screen.getByText(/민감 PII/)).toBeTruthy();
  });
});

describe('PayoutVerificationList — 필터/검색', () => {
  it('initialFilter prop 이 그대로 적용된다', async () => {
    render(<PayoutVerificationList initialFilter="incomplete" />);
    await screen.findByText('민선');
    expect(screen.queryByText('로진 로이어')).toBeNull();
  });

  it('상태 필터 칩이 개수와 함께 남아 있다', async () => {
    await ready();
    expect(screen.getByRole('button', { name: /정보 미완비 1/ })).toBeTruthy();
  });

  it('검색은 서버를 다시 부르지 않고 받아온 범위에서 거른다', async () => {
    await ready();
    const before = listPendingPayoutAccounts.mock.calls.length;
    fireEvent.change(screen.getByLabelText('정산 계좌 검색'), { target: { value: 'minsun' } });
    expect(screen.getByText('민선')).toBeTruthy();
    expect(screen.queryByText('로진 로이어')).toBeNull();
    expect(listPendingPayoutAccounts.mock.calls.length).toBe(before);
  });

  it('결과 개수를 전체 대비로 보여준다', async () => {
    await ready();
    expect(screen.getByText('2건 / 전체 2건')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('정산 계좌 검색'), { target: { value: 'minsun' } });
    expect(screen.getByText('1건 / 전체 2건')).toBeTruthy();
  });

  it('초기화가 검색과 필터를 함께 되돌린다', async () => {
    render(<PayoutVerificationList initialFilter="incomplete" />);
    await screen.findByText('민선');
    fireEvent.click(screen.getByRole('button', { name: /초기화/ }));
    expect(await screen.findByText('로진 로이어')).toBeTruthy();
  });
});

describe('PayoutVerificationList — 승인 (확인 단계 추가)', () => {
  it('확인 창에 아티스트와 계좌가 보인다', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '승인' }));
    const d = screen.getByRole('dialog');
    expect(d.textContent).toContain('로진 로이어');
    expect(d.textContent).toContain('우리은행');
    expect(d.textContent).toContain('1002-***-545816');
  });

  it('확인하면 verifyArtistPayoutAccount 를 부른다', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '승인' }));
    fireEvent.click(screen.getByRole('dialog').querySelector('footer button:last-child')!);
    await waitFor(() => expect(verifyArtistPayoutAccount).toHaveBeenCalledWith('a1'));
    await waitFor(() => expect(success).toHaveBeenCalledWith('계좌 승인 완료'));
  });

  it('취소하면 승인하지 않는다', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '승인' }));
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(verifyArtistPayoutAccount).not.toHaveBeenCalled();
  });

  it('실패하면 toast.error (성공/실패 의미 유지)', async () => {
    verifyArtistPayoutAccount.mockResolvedValue({ ok: false, error: '권한 없음' });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: '승인' }));
    fireEvent.click(screen.getByRole('dialog').querySelector('footer button:last-child')!);
    await waitFor(() => expect(error).toHaveBeenCalledWith('권한 없음'));
  });
});

describe('PayoutVerificationList — 거절 (기존 흐름 유지)', () => {
  it('사유를 입력하면 그대로 전달된다', async () => {
    vi.stubGlobal('prompt', vi.fn(() => '명의 불일치'));
    await ready();
    // 두 행 모두 거절 가능(rejected 가 아니므로) — 기존 동작과 동일하다. 첫 행을 쓴다.
    fireEvent.click(screen.getAllByRole('button', { name: '거절' })[0]);
    await waitFor(() => expect(rejectArtistPayoutAccount).toHaveBeenCalledWith('a1', '명의 불일치'));
  });

  it('사유가 비면 거절하지 않는다 (기존 필수 조건 유지)', async () => {
    vi.stubGlobal('prompt', vi.fn(() => ''));
    await ready();
    // 두 행 모두 거절 가능(rejected 가 아니므로) — 기존 동작과 동일하다. 첫 행을 쓴다.
    fireEvent.click(screen.getAllByRole('button', { name: '거절' })[0]);
    await waitFor(() => expect(error).toHaveBeenCalledWith('거절 사유는 필수입니다'));
    expect(rejectArtistPayoutAccount).not.toHaveBeenCalled();
  });
});

describe('PayoutVerificationList — 계좌 변경', () => {
  it('계좌 변경 버튼이 다이얼로그를 연다', async () => {
    await ready();
    fireEvent.click(screen.getAllByRole('button', { name: /계좌 변경/ })[0]);
    expect(screen.getByText('edit-dialog:a1')).toBeTruthy();
  });
});
