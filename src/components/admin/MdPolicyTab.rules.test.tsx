// @vitest-environment jsdom
/**
 * MdPolicyTab — 규칙 추가·삭제·켜기/끄기·우선순위 (0562·0563).
 * 화면에서 고친 값이 그대로 서버 함수로 가고, 삭제는 두 번 눌러야 실제로 지워지는지 고정한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { MdPolicyRule } from '@/lib/aiCuration';

const RULE: MdPolicyRule = {
  id: 'r1', store_type: 'cafe', genre: 'jazz', vocal_policy: 'vocal',
  is_allowed: true, is_enabled: true, priority: 50, source: 'admin_md_policy_v1',
};

const api = {
  adminMdPolicySummary: vi.fn(),
  adminListMdPolicyRules: vi.fn(),
  adminListMdPolicyViolations: vi.fn(),
  adminBackfillStoreGenrePolicyReview: vi.fn(),
  adminSetMdPolicyRuleEnabled: vi.fn(),
  adminSetMdPolicyRulePriority: vi.fn(),
  adminMdPolicyRuleOptions: vi.fn(),
  adminAddMdPolicyRule: vi.fn(),
  adminDeleteMdPolicyRule: vi.fn(),
};
vi.mock('@/lib/aiCuration', () => api);
vi.mock('@/lib/adminPlaylistInspectorApi', () => ({
  adminChangeTrackFitStatus: vi.fn(), adminRemoveTrackFromPlaylist: vi.fn(),
}));
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: MdPolicyTab } = await import('./MdPolicyTab');

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.adminMdPolicySummary.mockResolvedValue({
    total_rules: 1, enabled_rules: 1, distinct_stores: 1, by_store: { cafe: 1 }, by_vocal_policy: { vocal: 1, instrumental: 0 },
  });
  api.adminListMdPolicyRules.mockResolvedValue([RULE]);
  api.adminListMdPolicyViolations.mockResolvedValue([]);
  api.adminMdPolicyRuleOptions.mockResolvedValue({ store_types: ['cafe', 'hotel'], genres: ['jazz', 'lofi'] });
  api.adminSetMdPolicyRuleEnabled.mockResolvedValue(undefined);
  api.adminSetMdPolicyRulePriority.mockResolvedValue(undefined);
  api.adminAddMdPolicyRule.mockResolvedValue(undefined);
  api.adminDeleteMdPolicyRule.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('MdPolicyTab 규칙 편집', () => {
  it('켜짐 버튼을 누르면 규칙을 끈다', async () => {
    api.adminSetMdPolicyRuleEnabled.mockImplementation(async () => {
      api.adminListMdPolicyRules.mockResolvedValue([{ ...RULE, is_enabled: false }]); // 서버에 반영된 상태
    });
    render(<MdPolicyTab />);
    fireEvent.click(await screen.findByRole('button', { name: '켜짐' }));
    await waitFor(() => expect(api.adminSetMdPolicyRuleEnabled).toHaveBeenCalledWith('r1', false));
    expect(await screen.findByRole('button', { name: '꺼짐' })).toBeTruthy();
  });

  it('우선순위를 바꾸고 Enter 를 누르면 저장한다 — 범위 밖이면 보내지 않는다', async () => {
    render(<MdPolicyTab />);
    const input = await screen.findByLabelText('cafe jazz 우선순위');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(api.adminSetMdPolicyRulePriority).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.blur(input);
    await waitFor(() => expect(api.adminSetMdPolicyRulePriority).toHaveBeenCalledWith('r1', 20));
  });

  it('삭제는 두 번 눌러야 지운다', async () => {
    render(<MdPolicyTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'cafe jazz 규칙 삭제' }));
    expect(api.adminDeleteMdPolicyRule).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '삭제?' }));
    await waitFor(() => expect(api.adminDeleteMdPolicyRule).toHaveBeenCalledWith('r1'));
  });

  it('규칙 추가 폼 — 입력값 그대로 서버로 보낸다', async () => {
    render(<MdPolicyTab />);
    fireEvent.click(await screen.findByRole('button', { name: /규칙 추가/ }));
    await waitFor(() => expect(api.adminMdPolicyRuleOptions).toHaveBeenCalled());
    fireEvent.change(await screen.findByLabelText('매장 종류'), { target: { value: 'hotel' } });
    fireEvent.change(screen.getByLabelText('장르'), { target: { value: ' lofi ' } });
    fireEvent.change(screen.getByLabelText('보컬'), { target: { value: 'instrumental' } });
    fireEvent.change(screen.getByLabelText('허용 / 차단'), { target: { value: 'block' } });
    fireEvent.change(screen.getByLabelText('우선순위 (낮을수록 먼저)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    await waitFor(() => expect(api.adminAddMdPolicyRule).toHaveBeenCalledWith({
      storeType: 'hotel', genre: 'lofi', vocalPolicy: 'instrumental', isAllowed: false, priority: 30,
    }));
  });
});
