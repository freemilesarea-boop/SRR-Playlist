/**
 * Skeleton — DEUDDA §4.4
 * Animated shimmer rectangle. animate-pulse + bg-bg-card 톤 표준화.
 * 사용:
 *   <Skeleton className="h-14 rounded-xl" />        // 1줄
 *   <Skeleton.Card />                                // aspect-square 카드
 *   <Skeleton.Row count={4} />                       // 트랙 행 4개
 */

interface Props {
  className?: string;
}

export default function Skeleton({ className = '' }: Props) {
  return <div className={`animate-pulse rounded-xl bg-bg-card ${className}`} />;
}

Skeleton.Card = function SkeletonCard({ className = '' }: Props) {
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="aspect-square animate-pulse rounded-2xl bg-bg-card" />
      <div className="h-3 w-3/4 animate-pulse rounded bg-bg-card" />
      <div className="h-2.5 w-1/2 animate-pulse rounded bg-bg-card/70" />
    </div>
  );
};

Skeleton.Row = function SkeletonRow({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl bg-bg-card/60 p-3">
          <div className="h-10 w-10 animate-pulse rounded-lg bg-bg-card" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-3/4 animate-pulse rounded bg-bg-card" />
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-bg-card/70" />
          </div>
        </div>
      ))}
    </div>
  );
};
