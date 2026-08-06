// Phase ARTIST-BILLING-ACCESS-ENFORCEMENT-1 — 결제 제한 아티스트 상단 고정 안내 배너.
// 빈 화면/일반 오류 대신 사유별 안내 + 결제 페이지 CTA 를 노출한다.
// 기존 음원/정산 열람은 유지되므로 해당 이동 버튼도 함께 제공한다.

import { useNavigate } from 'react-router-dom';
import type { ArtistBillingAccessResult } from '@/lib/artistBillingAccess';

interface Props {
  access: ArtistBillingAccessResult | null;
}

export function ArtistBillingRestrictionBanner({ access }: Props) {
  const navigate = useNavigate();

  // 허용/비아티스트/로딩중 → 배너 없음
  if (!access || !access.isArtist || access.allowed) return null;

  const isCancelled = access.reason === 'cancelled';
  const title = isCancelled
    ? '정기결제가 취소되어 아티스트 기능이 제한되었습니다.'
    : '결제가 확인되지 않아 아티스트 기능이 제한되었습니다.';
  const body = isCancelled
    ? '음원 등록, 유통 신청 및 아티스트 유료 기능을 이용하려면 구독을 다시 시작해 주세요.'
    : '결제수단을 등록하거나 구독을 갱신하면 음원 등록과 유통 신청 기능을 다시 이용할 수 있습니다.';

  return (
    <div
      role="alert"
      aria-live="polite"
      className="sticky top-0 z-40 w-full border-b border-purple-500/30 bg-[#1a1424] px-4 py-4 sm:px-6"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-bold text-white sm:text-base">{title}</p>
          <p className="mt-1 text-xs text-purple-200/80 sm:text-sm">{body}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate('/subscription')}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-500"
          >
            {isCancelled ? '구독 다시 시작' : '결제수단 등록'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/artist')}
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10"
          >
            기존 음원 보기
          </button>
          <button
            type="button"
            onClick={() => navigate('/artist/settlements')}
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10"
          >
            정산 내역 보기
          </button>
        </div>
      </div>
    </div>
  );
}

export default ArtistBillingRestrictionBanner;
