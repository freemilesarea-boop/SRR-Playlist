/**
 * SectionHeader — 제목 / 보조설명 / 우측 액션의 위계를 한 군데로 모은다.
 *
 * 기존 화면들이 섹션마다 제각각 h2 크기와 여백을 쓰고 있어서 스캔이 안 됐다.
 */
import type { ReactNode } from 'react';

export default function SectionHeader({
  title,
  desc,
  icon,
  action,
}: {
  title: string;
  desc?: string;
  icon?: ReactNode;
  /** 우측 상단 버튼/링크 */
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="flex items-center gap-1.5 text-base font-bold tracking-tight">
          {icon}
          {title}
        </h2>
        {desc && <p className="mt-0.5 text-[12px] leading-relaxed text-ink-mute">{desc}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
