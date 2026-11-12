// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AnnouncementStatusView from './AnnouncementStatusView';
import type { AnnouncementStatusDetail } from '@/lib/api/announcementApi';

const now = '2026-11-12T06:00:00Z';
const base: AnnouncementStatusDetail = {
  enterprise_account_id: 'ea',
  now,
  devices: [
    { store_user_id: 'a', store_label: '성수점', state: 'online', last_seen_at: '2026-11-12T05:59:40Z', closed_at: null, user_agent: null },
    { store_user_id: 'b', store_label: '마포점', state: 'offline', last_seen_at: '2026-11-12T05:40:00Z', closed_at: null, user_agent: null },
  ],
  today: [
    { store_user_id: 'a', store_label: '성수점', schedule_name: '마감 안내', asset_title: 'x', status: 'played', error: null, scheduled_at: '2026-11-12T05:30:00Z' },
    { store_user_id: 'b', store_label: '마포점', schedule_name: '마감 안내', asset_title: 'x', status: 'failed', error: 'autoplay_blocked :: x', scheduled_at: '2026-11-12T05:30:00Z' },
  ],
  summary: { devices_online: 1, devices_offline: 1, played: 1, failed: 1, active_schedules: 2 },
};

describe('AnnouncementStatusView', () => {
  it('기기 상태와 오늘 결과를 보여 준다', () => {
    render(<AnnouncementStatusView data={base} />);
    expect(screen.getByText('켜짐')).toBeTruthy();
    expect(screen.getByText('꺼짐')).toBeTruthy();
    expect(screen.getByText(/신호가 끊겼어요/)).toBeTruthy();
    expect(screen.getByText(/20분 전/)).toBeTruthy();
    expect(screen.getByText(/화면 터치 안 됨/)).toBeTruthy();
    expect(screen.getByText(/꺼짐 1/)).toBeTruthy();
  });

  it('안내 전용 기기가 없으면 등록 방법을 안내한다', () => {
    render(<AnnouncementStatusView data={{ ...base, devices: [], today: [], summary: { ...base.summary, devices_online: 0, devices_offline: 0 } }} />);
    expect(screen.getByText(/켜진 안내 전용 플레이어가 없어요/)).toBeTruthy();
    expect(screen.getByText(/아직 없어요/)).toBeTruthy();
  });
});
