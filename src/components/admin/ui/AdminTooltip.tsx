/**
 * AdminTooltip — 가벼운 CSS-only tooltip (hover/focus 시 absolute label).
 * 의존성 없이 admin row action 버튼에 의미 부여.
 *
 * 예:
 *   <AdminTooltip label="편집">
 *     <button><Pencil size={12} /></button>
 *   </AdminTooltip>
 */
import { adminTokens } from './palette';

interface AdminTooltipProps {
  label: string;
  placement?: 'top' | 'bottom';
  children: React.ReactNode;
}

export function AdminTooltip({ label, placement = 'top', children }: AdminTooltipProps) {
  const place_cls = placement === 'top'
    ? 'bottom-[calc(100%+4px)]'
    : 'top-[calc(100%+4px)]';
  return (
    <span className="relative inline-flex group">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 ${place_cls} z-50 whitespace-nowrap ${adminTokens.radius.md} bg-zinc-900/95 px-2 py-1 text-[10px] font-medium text-white opacity-0 ${adminTokens.shadow.overlay} ${adminTokens.transition} group-hover:opacity-100 group-focus-within:opacity-100`}
      >
        {label}
      </span>
    </span>
  );
}
