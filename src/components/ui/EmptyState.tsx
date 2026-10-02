/**
 * EmptyState — "아직 없음" 을 설명과 다음 행동까지 함께 보여준다.
 *
 * 빈 화면에 한 줄만 덩그러니 두면 사용자가 뭘 해야 할지 모른다.
 */
import type { ReactNode } from 'react';

export default function EmptyState({
  icon,
  title,
  desc,
  action,
}: {
  icon?: ReactNode;
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-bg-card px-4 py-10 text-center ring-1 ring-line/10">
      {icon && <div className="mb-2 text-ink-dim">{icon}</div>}
      <p className="text-sm font-bold">{title}</p>
      {desc && <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-ink-mute">{desc}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
