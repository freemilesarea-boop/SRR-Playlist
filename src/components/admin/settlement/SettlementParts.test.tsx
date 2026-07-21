// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

afterEach(cleanup); // globals:false → RTL auto-cleanup 미등록. 테스트 간 DOM 누적 방지.
import {
  StatusBadge, RequiredActionBadge, FinancialStatus, CarryoverDetail,
  HoldPanel, AuditTimeline, PolicySnapshot,
} from './SettlementParts';
import { buildSettlementDisplayModel } from '@/lib/settlementDisplayModel';
import type { AdminSettlementRow } from '@/lib/artistSettlementApi';

function row(over: Partial<AdminSettlementRow>): AdminSettlementRow {
  return {
    id: 'x', settlement_month: '2099-02-01', artist_user_id: 'a', artist_nickname: 'n', artist_email: 'e',
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
const m = (over: Partial<AdminSettlementRow>) => buildSettlementDisplayModel(row(over));

describe('SettlementParts — status-aware rendering', () => {
  it('manual-carried payable: 현재 지급 가능 ₩0, 다음 달 이월 ₩29,010, never ₩58,020', () => {
    const model = m({ status: 'carried_over', final_payout_amount: 29010, carryover_taxed_amount: 29010, is_manual_carryover: true });
    render(<FinancialStatus model={model} />);
    const finText = screen.getByRole('region', { name: '현재 금융 상태' }).textContent!;
    expect(finText).toMatch(/현재 지급 가능액₩0/);       // current payable zero
    expect(finText).toMatch(/다음 달 이월액₩29,010/);     // money is the carryover
    expect(screen.queryByText('₩58,020')).toBeNull();     // never double-counted
  });

  it('paid row shows paid amount and zero remaining', () => {
    const model = m({ status: 'paid', final_payout_amount: 9670, meets_min_payout: true, paid_at: '2099-03-01' });
    render(<FinancialStatus model={model} />);
    const finText = screen.getByRole('region', { name: '현재 금융 상태' }).textContent!;
    expect(finText).toMatch(/지급 완료액₩9,670/);
    expect(finText).toMatch(/잔여 미지급액₩0/);
  });

  it('StatusBadge/RequiredActionBadge render text (not color only)', () => {
    const held = m({ status: 'held', held_reason: 'pii_incomplete' });
    render(<div><StatusBadge model={held} /><RequiredActionBadge model={held} /></div>);
    expect(screen.getByText('정산정보 입력 필요')).toBeInTheDocument();
    expect(screen.getByText('정산정보 확인')).toBeInTheDocument();
  });

  it('HoldPanel: identity / account / tax friendly text', () => {
    const { unmount } = render(<HoldPanel model={m({ status: 'held', held_reason: 'pii_incomplete' })} />);
    expect(screen.getByRole('alert').textContent).toContain('정산정보 입력이 완료되지 않았습니다');
    expect(screen.getByText(/held_reason=pii_incomplete/)).toBeInTheDocument(); // raw only in details
    unmount();
    render(<HoldPanel model={m({ status: 'held', held_reason: 'account_unverified' })} />);
    expect(screen.getByRole('alert').textContent).toContain('지급 계좌 확인이 완료되지 않았습니다');
  });

  it('HoldPanel tax reason', () => {
    render(<HoldPanel model={m({ status: 'held', held_reason: 'tax_type_unknown' })} />);
    expect(screen.getByRole('alert').textContent).toContain('원천징수 유형 설정이 필요합니다');
  });

  it('CarryoverDetail exposes taxed/untaxed tooltips via aria-label', () => {
    render(<CarryoverDetail model={m({ status: 'pending', previous_carryover_untaxed_amount: 7000, previous_carryover_taxed_amount: 9670 })} />);
    expect(screen.getAllByLabelText(/미과세 이월:/).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/기과세 이월:/).length).toBeGreaterThan(0);
    const region = screen.getByRole('region', { name: '이월 상세' }).textContent!;
    expect(region).toMatch(/이전 미과세 이월₩7,000/);
    expect(region).toMatch(/이전 기과세 이월₩9,670/);
  });

  it('AuditTimeline: empty message + ol semantic with events', () => {
    const { unmount } = render(<AuditTimeline events={[]} />);
    expect(screen.getByText('기록된 정산 변경 이력이 없습니다.')).toBeInTheDocument();
    unmount();
    render(<AuditTimeline events={[
      { id: 1, action: 'auto_carryover_consumed', created_at: '2099-02-01T00:00:00Z', amount: 5000 },
      { id: 2, action: 'mark_paid', created_at: '2099-03-01T00:00:00Z', amount: 9670 },
    ]} />);
    const list = screen.getByRole('list', { name: '정산 변경 이력' });
    expect(list.tagName).toBe('OL');
    expect(screen.getByText('자동 이월 소비')).toBeInTheDocument();
    expect(screen.getByText('지급 완료')).toBeInTheDocument();
  });

  it('PolicySnapshot shows the "생성 당시" note', () => {
    render(<PolicySnapshot model={m({ status: 'pending', minimum_payout_snapshot: 10000 })} />);
    expect(screen.getByText(/이 정산이 생성될 당시 적용된 기준/)).toBeInTheDocument();
  });
});
