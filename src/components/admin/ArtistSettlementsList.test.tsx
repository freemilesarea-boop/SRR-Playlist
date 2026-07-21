// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminSettlementRow } from '@/lib/artistSettlementApi';

// ── API 계층 mock (adminListSettlements 만 목록 렌더에 필요) ──
const adminListSettlements = vi.fn();
vi.mock('@/lib/artistSettlementApi', () => ({
  adminListSettlements: (...args: unknown[]) => adminListSettlements(...args),
  adminGenerateMonthlySettlement: vi.fn(),
}));

// ── 자식 Drawer/Modal 은 자체 effect 를 갖고 있어 stub 처리 ──
vi.mock('./ArtistSettlementDetail', () => ({
  default: ({ settlementId }: { settlementId: string }) => (
    <div data-testid="detail-drawer">detail:{settlementId}</div>
  ),
}));
vi.mock('./CarryoverModal', () => ({
  default: () => <div data-testid="carryover-modal" />,
}));

import ArtistSettlementsList from './ArtistSettlementsList';

afterEach(cleanup);

function row(over: Partial<AdminSettlementRow>): AdminSettlementRow {
  return {
    id: 'x', settlement_month: '2099-02-01', artist_user_id: 'u-000', artist_nickname: 'n', artist_email: 'e',
    gross_settlement_amount: 0, company_fee_amount: 0, sales_agent_fee_amount: 0, artist_net_settlement: 0,
    previous_carried_amount: 0, total_settlement_amount: 0, meets_min_payout: false, withholding_tax_amount: 0,
    final_payout_amount: 0, carried_over_amount: 0, status: 'pending', finalized_at: null, paid_at: null,
    created_at: '', payout_account_id: null, legal_name: null, rrn_masked: null, has_rrn: false, bank_name: null,
    masked_account_number: null, account_holder: null, has_account_number: false, tax_withholding_type: null,
    payout_account_status: 'missing', is_manual_carryover: false, carryover_applied: false, carried_over_to_month: null,
    carryover_reason: null, held_reason: null, merged_into_settlement_id: null, payout_memo: null, version: 1,
    is_current: true, ...over,
  };
}

const PAID = row({ id: 'p', status: 'paid', final_payout_amount: 9670, meets_min_payout: true, paid_at: '2099-03-01',
  artist_nickname: '지급완료가수', artist_email: 'paid@example.com' });
// 수동 이월: 계산액 29,010 이 이월(taxed)로 표현됨 → 현재 지급 가능 0, 다음 이월 29,010, 절대 58,020 아님
const MANUAL = row({ id: 'c', status: 'carried_over', is_manual_carryover: true, final_payout_amount: 29010,
  carryover_taxed_amount: 29010, artist_nickname: '수동이월가수', artist_email: 'carry@example.com' });
const PAYABLE = row({ id: 'y', status: 'payable', final_payout_amount: 12000, meets_min_payout: true,
  artist_nickname: '지급가능가수', artist_email: 'payable@example.com' });
const HELD_TAX = row({ id: 'h', status: 'held', held_reason: 'tax_type_unknown', artist_nickname: '세율확인가수',
  previous_carryover_untaxed_amount: 3000, artist_email: 'tax@example.com' });
const ALL = [PAID, MANUAL, PAYABLE, HELD_TAX];

async function renderList(rows: AdminSettlementRow[] = ALL) {
  adminListSettlements.mockResolvedValue(rows);
  render(<ArtistSettlementsList />);
  // 초기 loading 스켈레톤이 사라질 때까지(= 데이터 렌더 완료) 대기
  await waitFor(() => expect(screen.queryByLabelText('정산 목록을 불러오는 중')).toBeNull());
}

beforeEach(() => {
  adminListSettlements.mockReset();
});

describe('ArtistSettlementsList — desktop table', () => {
  it('renders all mandated column headers', async () => {
    await renderList();
    for (const label of ['회원/아티스트', '정산월', '당월 순정산', '이전 이월', '원천징수',
      '현재 지급 가능', '지급 완료', '다음 달 이월', '상태', '필요 조치', '상세']) {
      expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument();
    }
  });

  it('manual-carry row: 현재 지급 가능 ₩0, 다음 달 이월 ₩29,010, never ₩58,020', async () => {
    await renderList([MANUAL]);
    const table = screen.getByRole('table');
    const text = table.textContent!;
    expect(text).toMatch(/₩0/);            // 현재 지급 가능 0
    expect(text).toMatch(/기과세 ₩29,010/); // 이월로 표현된 계산액
    expect(within(table).queryByText(/₩58,020/)).toBeNull(); // 절대 중복 합산 안 됨
  });

  it('status badge shows 수동 이월 for manual carryover', async () => {
    await renderList([MANUAL]);
    expect(screen.getAllByText('수동 이월').length).toBeGreaterThan(0);
  });

  it('required action shows 이월 내역 확인 for carryover', async () => {
    await renderList([MANUAL]);
    expect(screen.getAllByText('이월 내역 확인').length).toBeGreaterThan(0);
  });

  it('paid row shows 지급 완료 amount and 지급 완료 status', async () => {
    await renderList([PAID]);
    const table = screen.getByRole('table');
    expect(table.textContent).toMatch(/₩9,670/);
    expect(screen.getAllByText('지급 완료').length).toBeGreaterThan(0);
  });

  it('carryover cell shows 없음 when both taxed/untaxed are 0', async () => {
    await renderList([PAYABLE]); // no prev/next carry
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('없음').length).toBeGreaterThan(0);
  });
});

describe('ArtistSettlementsList — filters share one dataset (목록/Summary)', () => {
  it('facet 지급 완료 narrows list + summary count', async () => {
    await renderList();
    // 초기: 전체 4건
    expect(screen.getByText(/4건/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('상태 필터'), 'paid');
    await waitFor(() => expect(screen.getByText(/1건 \/ 전체 4건/)).toBeInTheDocument());
    // 목록엔 지급완료가수만
    expect(screen.getAllByText('지급완료가수').length).toBeGreaterThan(0);
    expect(screen.queryByText('지급가능가수')).toBeNull();
    // Summary '정산 대상' 카드도 1명으로 갱신
    expect(screen.getByText('1명')).toBeInTheDocument();
  });

  it('search filters by nickname / email (case-insensitive)', async () => {
    await renderList();
    await userEvent.type(screen.getByLabelText('정산 검색'), 'PAYABLE@EXAMPLE.COM');
    await waitFor(() => expect(screen.getByText(/1건 \/ 전체 4건/)).toBeInTheDocument());
    expect(screen.getAllByText('지급가능가수').length).toBeGreaterThan(0);
    expect(screen.queryByText('수동이월가수')).toBeNull();
  });

  it('facet 이월금 보유 keeps only rows with carryover', async () => {
    await renderList();
    await userEvent.selectOptions(screen.getByLabelText('상태 필터'), 'has_carryover');
    // MANUAL(next taxed 29010) + HELD_TAX(prev untaxed 3000) = 2건
    await waitFor(() => expect(screen.getByText(/2건 \/ 전체 4건/)).toBeInTheDocument());
  });

  it('empty filter result shows empty state + 필터 초기화 restores list', async () => {
    await renderList();
    await userEvent.type(screen.getByLabelText('정산 검색'), '존재하지않는이름');
    await waitFor(() => expect(screen.getByText('선택한 조건에 해당하는 정산 내역이 없습니다.')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: '필터 초기화' }));
    await waitFor(() => expect(screen.getByText(/4건/)).toBeInTheDocument());
    expect(screen.getAllByText('수동이월가수').length).toBeGreaterThan(0);
  });
});

describe('ArtistSettlementsList — mobile card', () => {
  it('renders mobile cards with status + amounts', async () => {
    await renderList([PAID]);
    // 모바일 카드 컨테이너 (md:hidden) 는 desktop table 외에 별도 존재
    expect(screen.getAllByText('지급 완료').length).toBeGreaterThan(0);
    // 금액 상세 details 는 모바일 카드에만 존재
    expect(screen.getByText('금액 상세')).toBeInTheDocument();
  });
});

describe('ArtistSettlementsList — loading / empty / error', () => {
  it('shows loading skeleton before data resolves', async () => {
    let resolve!: (v: AdminSettlementRow[]) => void;
    adminListSettlements.mockReturnValue(new Promise<AdminSettlementRow[]>((r) => { resolve = r; }));
    render(<ArtistSettlementsList />);
    expect(screen.getByLabelText('정산 목록을 불러오는 중')).toBeInTheDocument();
    resolve([PAID]);
    await waitFor(() => expect(screen.queryByLabelText('정산 목록을 불러오는 중')).toBeNull());
  });

  it('shows empty state (no data) without 필터 초기화 button', async () => {
    await renderList([]);
    expect(screen.getByText(/정산 데이터가 없어요/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '필터 초기화' })).toBeNull();
  });

  it('shows error state with 다시 시도 that reloads', async () => {
    adminListSettlements.mockRejectedValueOnce(new Error('boom'));
    render(<ArtistSettlementsList />);
    await screen.findByText('조회 실패');
    expect(adminListSettlements).toHaveBeenCalledTimes(1);
    // 재시도 시 성공 데이터
    adminListSettlements.mockResolvedValueOnce([PAID]);
    await userEvent.click(screen.getByRole('button', { name: /다시 시도/ }));
    await waitFor(() => expect(adminListSettlements).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
  });
});

describe('ArtistSettlementsList — detail drawer', () => {
  it('clicking 상세 보기 opens the detail drawer for that row', async () => {
    await renderList([PAID]);
    await userEvent.click(screen.getAllByRole('button', { name: '상세 보기' })[0]);
    const drawer = await screen.findByTestId('detail-drawer');
    expect(drawer).toHaveTextContent('detail:p');
  });
});
