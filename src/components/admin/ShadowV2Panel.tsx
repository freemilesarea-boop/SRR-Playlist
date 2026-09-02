/**
 * ShadowV2Panel — 'v2 관측(Shadow)' 통합 화면 (ADMIN-MERGE-SHADOW-1)
 *
 * 스트리밍 v2 / 정산 v2 는 둘 다 flag OFF 상태의 shadow 파이프라인 관측 전용 화면이다
 * (실제 정산·차트에 쓰이지 않는다). 일상 운영 메뉴에 별도 탭 두 개로 있을 이유가 없어
 * 한 탭 두 뷰로 묶는다. 고급(기본 숨김) + super admin 전용은 병합 전과 동일.
 */
import { lazy } from 'react';
import { Headphones, Wallet } from 'lucide-react';
import AdminMergedPanel from './AdminMergedPanel';

const StreamingV2Panel = lazy(() => import('./StreamingV2Panel'));
const SettlementV2Panel = lazy(() => import('./SettlementV2Panel'));

export default function ShadowV2Panel({ initialView }: { initialView?: string }) {
  return (
    <AdminMergedPanel
      initialView={initialView}
      views={[
        { key: 'streaming', label: '스트리밍', hint: 'v2 스트리밍 shadow 관측(정산 무관)',
          icon: <Headphones size={13} />, render: () => <StreamingV2Panel /> },
        { key: 'settlement', label: '정산', hint: 'v2 정산 shadow 계산·비교(실지급 미사용)',
          icon: <Wallet size={13} />, render: () => <SettlementV2Panel /> },
      ]}
    />
  );
}
