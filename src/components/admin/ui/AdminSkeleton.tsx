/**
 * AdminSkeleton — loading placeholder.
 * <AdminSkeleton rows={3} />, <AdminSkeleton variant="table" rows={5} />, <AdminSkeleton variant="card" />
 */
import { adminTokens } from './palette';

interface AdminSkeletonProps {
  variant?: 'block' | 'card' | 'table' | 'kpi';
  rows?: number;
  className?: string;
}

export function AdminSkeleton({ variant = 'block', rows = 3, className = '' }: AdminSkeletonProps) {
  if (variant === 'card') {
    return (
      <div className={`${adminTokens.radius.xl} bg-bg-card p-4 ring-1 ring-line/10 ${className}`}>
        <div className="h-4 w-32 animate-pulse rounded bg-bg-deep" />
        <div className="mt-3 h-16 animate-pulse rounded bg-bg-deep" />
      </div>
    );
  }
  if (variant === 'kpi') {
    return (
      <div className={`grid gap-2 sm:grid-cols-2 lg:grid-cols-4 ${className}`}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`${adminTokens.radius.xl} bg-bg-card p-4 ring-1 ring-line/10`}>
            <div className="h-3 w-16 animate-pulse rounded bg-bg-deep" />
            <div className="mt-3 h-7 w-20 animate-pulse rounded bg-bg-deep" />
          </div>
        ))}
      </div>
    );
  }
  if (variant === 'table') {
    return (
      <div className={`${adminTokens.radius.xl} bg-bg-card overflow-hidden ring-1 ring-line/10 ${className}`}>
        <div className="border-b border-line/10 px-4 py-2">
          <div className="h-3 w-24 animate-pulse rounded bg-bg-deep" />
        </div>
        <div className="divide-y divide-line/10">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="px-4 py-3">
              <div className="h-3 w-3/4 animate-pulse rounded bg-bg-deep" />
              <div className="mt-2 h-2.5 w-1/2 animate-pulse rounded bg-bg-deep" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-3 w-full animate-pulse rounded bg-bg-deep" />
      ))}
    </div>
  );
}
