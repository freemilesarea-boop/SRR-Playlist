import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * OperatorPageHeader — Phase ADMIN-UX-IMPLEMENT-2
 *
 * /ops 페이지 공통 헤더. 각 페이지가 같은 마크업을 반복하지 않도록 한다.
 *   • Title / Description / Primary Action 슬롯.
 *   • legacyTab 이 있으면 "기존 화면에서 보기"(/admin?tab=) 링크 제공 — 하위호환 진입점 유지.
 */
export default function OperatorPageHeader({
  title,
  description,
  legacyTab,
  actions,
}: {
  title: string;
  description?: string;
  legacyTab?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-lg font-extrabold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-ink-dim">{description}</p>}
      </div>
      <div className="flex flex-none items-center gap-2">
        {actions}
        {legacyTab && (
          <Link
            to={`/admin?tab=${legacyTab}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line/15 px-2.5 py-1.5 text-xs font-medium text-ink-mute transition-colors hover:bg-bg-hover hover:text-ink"
            title="기존 관리자 화면에서 보기"
          >
            <ExternalLink size={13} />
            기존 화면
          </Link>
        )}
      </div>
    </div>
  );
}
