// Phase ARTIST-BILLING-ACCESS-ENFORCEMENT-1 / FINAL-CHECK-1
// 결제 제한 아티스트 상단 고정 안내 배너. 아티스트 공통 레이아웃(ArtistLayout)
// 최상단에 렌더되어 대시보드·계약·정산 등 모든 아티스트 페이지에서 항상 보인다.
// 빈 화면/일반 오류/Toast 로만 처리하지 않으며, 사유별 문구 + 결제 페이지 CTA 를 노출한다.
// 문구·CTA 는 순수 함수 artistBillingBannerContent() 가 결정(단위 테스트 대상).

import { useNavigate } from 'react-router-dom';
import {
  artistBillingBannerContent,
  type ArtistBillingAccessResult,
} from '@/lib/artistBillingAccess';

interface Props {
  access: ArtistBillingAccessResult | null;
}

export function ArtistBillingRestrictionBanner({ access }: Props) {
  const navigate = useNavigate();
  const content = artistBillingBannerContent(access);
  if (!content) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="artist-billing-banner"
      data-reason={content.reason}
      className="sticky top-0 z-50 w-full border-b border-purple-500/30 bg-[#1a1424] px-4 py-4 sm:px-6"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-bold text-white sm:text-base">{content.title}</p>
          <p className="mt-1 text-xs text-purple-200/80 sm:text-sm">{content.body}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {content.ctas.map((cta, i) => (
            <button
              key={cta.label}
              type="button"
              onClick={() => navigate(cta.to)}
              className={
                i === 0
                  ? 'rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-300'
                  : 'rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-300'
              }
            >
              {cta.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ArtistBillingRestrictionBanner;
