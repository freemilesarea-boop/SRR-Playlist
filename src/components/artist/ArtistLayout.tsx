// Phase ARTIST-BILLING-ACCESS-ENFORCEMENT-FINAL-CHECK-1
// 아티스트 공통 레이아웃 — 대시보드/계약/정산 등 모든 아티스트 라우트의 최상단에
// 결제 제한 배너를 항상 렌더한다(특정 Upload Form 내부가 아님). 결제 접근 상태는
// Outlet context 로 하위 페이지에 전달해 Mutation 버튼 비활성 등에 재사용한다.

import { Outlet } from 'react-router-dom';
import { ArtistBillingRestrictionBanner } from '@/components/artist/ArtistBillingRestrictionBanner';
import { useArtistBillingAccess } from '@/hooks/useArtistBillingAccess';
import type { ArtistBillingAccessResult } from '@/lib/artistBillingAccess';

export interface ArtistLayoutContext {
  billingAccess: ArtistBillingAccessResult | null;
  refreshBillingAccess: () => Promise<void>;
}

export default function ArtistLayout() {
  // 아티스트 라우트 진입 시 서버 실시간 판정 조회. 실패 시 Fail-Closed(제한) 로 배너 표시.
  const { access, refresh } = useArtistBillingAccess(true);
  const ctx: ArtistLayoutContext = { billingAccess: access, refreshBillingAccess: refresh };
  return (
    <>
      <ArtistBillingRestrictionBanner access={access} />
      <Outlet context={ctx} />
    </>
  );
}
