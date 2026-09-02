/**
 * StoreStatusPanel — '매장 상태' 통합 화면 (ADMIN-MERGE-STORE-1)
 *
 * 매장 실시간 / 매장 상태 / 실시간 재생이 각각 별도 탭이었다. 셋 다 "지금 매장이
 * 어떤가"를 보는 화면인데 이름만으로는 어디를 열어야 할지 알 수 없었다
 * (StoreMonitoringPanel 은 자기 주석에서 스스로를 'Central Monitoring NOC' 이라 부른다).
 *
 * 보는 각도가 달라 지우지 않고 한 탭 세 뷰로 묶는다 —
 * 상태 목록(장애 우선) / 지금 나오는 곡 / 매장 라이브.
 */
import { lazy } from 'react';
import { Activity, Music, Radio } from 'lucide-react';
import AdminMergedPanel from './AdminMergedPanel';

const StoreMonitoringPanel = lazy(() => import('./StoreMonitoringPanel'));
const StoreNowPlayingPanel = lazy(() => import('./StoreNowPlayingPanel'));
const BusinessLivePanel = lazy(() => import('./BusinessLivePanel'));

export default function StoreStatusPanel({ initialView }: { initialView?: string }) {
  return (
    <AdminMergedPanel
      initialView={initialView}
      views={[
        { key: 'monitoring', label: '상태 목록', hint: '매장별 상태·장애·정책 동기화',
          icon: <Activity size={13} />, render: () => <StoreMonitoringPanel /> },
        { key: 'now-playing', label: '지금 재생', hint: '전국 매장 현재 재생곡(실시간)',
          icon: <Music size={13} />, render: () => <StoreNowPlayingPanel /> },
        { key: 'live', label: '매장 라이브', hint: '매장 접속·재생 라이브 현황',
          icon: <Radio size={13} />, render: () => <BusinessLivePanel /> },
      ]}
    />
  );
}
