/**
 * FilterBar — 검색·필터를 한 영역에 모으는 **composition container**.
 *
 * 관리자 영역에는 상태 필터가 38곳, 검색이 11곳 있는데 전부 각자 구현돼 있어
 * 같은 화면 안에서도 검색창과 select 가 떨어져 있거나 좁은 화면에서 줄바꿈이
 * 제각각이었다. 이 컴포넌트는 그 배치만 통일한다.
 *
 * **filter state 를 소유하지 않는다.** 값·변경 핸들러·쿼리 파라미터는 전부 호출부가
 * 그대로 들고 있고, 여기엔 이미 만들어진 노드를 slot 으로 넣는다. 그래서 기존
 * state / API 파라미터를 하나도 바꾸지 않고 적용할 수 있다.
 *
 * 기존 AdminSearch 를 대체하지 않는다 — AdminSearch 는 검색 input 한 벌이고,
 * 이것은 그것을 포함해 여러 필터를 담는 바깥 레이아웃이다. search slot 에
 * AdminSearch 를 넣어도 되고 화면의 기존 input 을 그대로 넣어도 된다.
 */
import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { AdminBadge } from './AdminBadge';
import { adminTokens } from './palette';
import { adminTypography } from '@/lib/adminTypography';

export interface FilterBarProps {
  /** 검색 input. 없으면 영역 자체를 그리지 않는다 — 억지로 검색창을 만들지 않는다. */
  search?: ReactNode;
  /** 상태 필터(select / chip 묶음). */
  filters?: ReactNode;
  /** 기간 필터. filters 와 시각적으로 구분해야 할 때만 쓴다. */
  period?: ReactNode;
  /** 그 외 (정렬 토글 등). */
  extra?: ReactNode;
  /** 결과 개수 등. 숫자는 호출부가 계산한다. */
  count?: ReactNode;
  /**
   * 지금 걸려 있는 필터 수. 0 이거나 생략하면 표시하지 않는다 —
   * 아무 필터도 없는 상태를 배지로 알릴 이유가 없다.
   */
  activeCount?: number;
  /** 주면 '초기화' 버튼이 보인다. activeCount 가 0 이면 비활성. */
  onReset?: () => void;
  resetLabel?: string;
  className?: string;
}

export function FilterBar({
  search,
  filters,
  period,
  extra,
  count,
  activeCount = 0,
  onReset,
  resetLabel = '초기화',
  className = '',
}: FilterBarProps) {
  const hasActive = activeCount > 0;
  return (
    <section
      aria-label="검색 및 필터"
      className={`flex flex-wrap items-center gap-2 ${adminTokens.radius.xl} bg-bg-card px-3 py-2.5 ring-1 ring-line/10 ${className}`}
    >
      {search && <div className="min-w-[160px] flex-1 basis-56">{search}</div>}
      {filters && <div className="flex flex-wrap items-center gap-1.5">{filters}</div>}
      {period && <div className="flex flex-wrap items-center gap-1.5">{period}</div>}
      {extra && <div className="flex flex-wrap items-center gap-1.5">{extra}</div>}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {hasActive && (
          <AdminBadge tone="info" variant="subtle" size="sm">
            필터 {activeCount}
          </AdminBadge>
        )}
        {count && <span className={adminTypography.hint}>{count}</span>}
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            disabled={!hasActive}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-ink-dim transition ring-1 ring-line/15 hover:text-ink hover:ring-line/25 disabled:opacity-40 ${adminTokens.focusRing}`}
          >
            <RotateCcw size={11} />
            {resetLabel}
          </button>
        )}
      </div>
    </section>
  );
}
