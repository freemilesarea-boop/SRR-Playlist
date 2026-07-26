import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { OperatorBreadcrumbSegment } from '@/lib/operatorRouteRegistry';

/**
 * OperatorBreadcrumb — Phase ADMIN-UX-IMPLEMENT-2
 *
 * 레지스트리에서 생성된 breadcrumb 세그먼트를 렌더한다.
 *   • 첫 항목 '운영 홈', 중간 항목 클릭 가능, 현재 항목 aria-current="page".
 *   • Mobile: 조상은 축약(마지막 조상 + 현재만), 긴 라벨 ellipsis.
 *   • URL query 에 의존하지 않음(세그먼트는 route 기반).
 */
export default function OperatorBreadcrumb({ segments }: { segments: OperatorBreadcrumbSegment[] }) {
  if (segments.length === 0) return null;
  const lastIdx = segments.length - 1;

  return (
    <nav aria-label="breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1 text-xs text-ink-dim">
        {segments.map((seg, i) => {
          const isCurrent = i === lastIdx;
          // Mobile 축약: 첫 항목(운영 홈)과 마지막 두 개만 표시. 중간은 lg 이상에서만.
          const hideOnMobile = i !== 0 && i < lastIdx - 1;
          return (
            <li
              key={`${seg.label}-${i}`}
              className={`flex min-w-0 items-center gap-1 ${hideOnMobile ? 'hidden lg:flex' : 'flex'}`}
            >
              {i > 0 && <ChevronRight size={12} className="flex-none text-ink-dim/60" aria-hidden="true" />}
              {isCurrent || !seg.href ? (
                <span
                  aria-current={isCurrent ? 'page' : undefined}
                  className={`max-w-[12rem] truncate ${isCurrent ? 'font-semibold text-ink' : ''}`}
                >
                  {seg.label}
                </span>
              ) : (
                <Link to={seg.href} className="max-w-[10rem] truncate hover:text-ink hover:underline">
                  {seg.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
