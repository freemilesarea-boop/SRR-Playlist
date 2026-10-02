/**
 * SummaryCard — 숫자 하나를 빠르게 읽히게 하는 카드.
 *
 * 대시보드 상단에서 "지금 내 상태" 를 3초 안에 파악시키는 용도다.
 * 설명문을 길게 쓰지 않는다 — 라벨 / 수치 / (선택)보조 한 줄이 전부다.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface SummaryCardProps {
  label: string;
  /** 이미 포맷된 문자열을 받는다. 포맷 규칙은 화면마다 다르므로 여기서 정하지 않는다. */
  value: string;
  /** 수치 아래 한 줄. 없으면 렌더하지 않는다. */
  hint?: string;
  icon?: ReactNode;
  /** 주면 카드 전체가 링크가 된다. */
  to?: string;
  /** 로딩 중에는 수치 자리를 스켈레톤으로. */
  loading?: boolean;
}

export default function SummaryCard({ label, value, hint, icon, to, loading }: SummaryCardProps) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-mute">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      {loading ? (
        <div className="mt-1.5 h-7 w-20 animate-pulse rounded bg-ink/10" />
      ) : (
        <p className="mt-1 text-xl font-extrabold tracking-tight tabular-nums sm:text-2xl">{value}</p>
      )}
      {hint && !loading && <p className="mt-0.5 truncate text-[11px] text-ink-dim">{hint}</p>}
    </>
  );

  const cls =
    'min-w-0 rounded-2xl bg-bg-card p-3 ring-1 ring-line/10 sm:p-4';

  return to ? (
    <Link to={to} className={`${cls} block transition hover:ring-accent/40`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
