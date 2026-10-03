/**
 * AdminTable — 관리자 목록의 **반복되는 상태 처리와 레이아웃/접근성**을 통일한다.
 *
 * 목적은 "테이블 디자인 통일" 이 아니다. 관리자 영역에 손으로 만든 테이블이 51개 있고,
 * 그 중 loading 은 100%, empty 는 58%, 결과 개수는 39% 만 갖추고 있었다. 매 화면이
 * colSpan 을 직접 세고, overflow 래퍼를 빼먹고(8곳), th 에 scope 를 안 달았다.
 * 그 반복만 걷어낸다.
 *
 * **일부러 넣지 않은 것: 정렬 · 검색 · pagination.**
 * 화면마다 서버/클라이언트 방식이 다르고(서버 p_search 인 화면과 단일 fetch 인 화면이
 * 섞여 있다) 여기에 내장하면 거대한 DataGrid 가 된다. 그것들은 호출부가 소유하고,
 * 이 컴포넌트는 columns/rows 를 받아 그리기만 한다 — FilterBar 와 조합해서 쓴다.
 *
 * 데이터 fetching · pagination · sorting 방식은 호출부의 기존 구현을 그대로 둔다.
 */
import type { ReactNode } from 'react';
import { AdminEmpty } from './AdminEmpty';
import { AdminSkeleton } from './AdminSkeleton';
import { adminTokens } from './palette';
import { adminTypography } from '@/lib/adminTypography';

export interface AdminTableColumn<T> {
  /** React key + 열 식별자. */
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  align?: 'left' | 'center' | 'right';
  /** 헤더 셀에만 적용 (폭 지정 등). */
  thClassName?: string;
  /** 본문 셀에만 적용. */
  tdClassName?: string;
}

export interface AdminTableProps<T> {
  columns: ReadonlyArray<AdminTableColumn<T>>;
  rows: ReadonlyArray<T>;
  /** 안정적인 행 key — index 를 쓰지 않는다(정렬/필터 후 상태가 섞인다). */
  rowKey: (row: T) => string;
  /** 스크린리더용 표 설명. 화면에는 보이지 않는다. */
  caption: string;
  loading?: boolean;
  /** 비었을 때 표시할 내용. 생략하면 기본 AdminEmpty. */
  empty?: ReactNode;
  /** 행 클릭. 주면 행이 키보드로도 활성화된다(Enter/Space). */
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  /** 좁은 화면에서 가로 스크롤을 발생시킬 최소 폭(px). 열이 많은 표에만 준다. */
  minWidth?: number;
  /** 결과 개수 등 표 위에 붙일 요약. 숫자를 여기서 계산하지 않는다. */
  count?: ReactNode;
  /** 표 위 오른쪽 영역(액션 등). */
  toolbar?: ReactNode;
  className?: string;
}

const ALIGN: Record<'left' | 'center' | 'right', string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

export function AdminTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  loading = false,
  empty,
  onRowClick,
  rowClassName,
  minWidth,
  count,
  toolbar,
  className = '',
}: AdminTableProps<T>) {
  const span = columns.length;
  const interactive = typeof onRowClick === 'function';

  return (
    <div className={`space-y-2 ${className}`}>
      {(count || toolbar) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={adminTypography.hint}>{count}</span>
          {toolbar}
        </div>
      )}

      {/* overflow 래퍼는 항상 둔다 — 열이 늘어난 뒤에 빼먹어서 좁은 화면이 깨지는 일을 막는다. */}
      <div className={`overflow-x-auto ${adminTokens.radius.xl} bg-bg-card ring-1 ring-line/10`}>
        <table
          className="w-full text-sm"
          style={minWidth ? { minWidth: `${minWidth}px` } : undefined}
        >
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line/10 text-[11px] uppercase tracking-wider text-ink-dim">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`px-3 py-2.5 font-semibold ${ALIGN[c.align ?? 'left']} ${c.thClassName ?? ''}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={span} className="px-3 py-4">
                  <AdminSkeleton variant="table" rows={4} />
                </td>
              </tr>
            )}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={span} className="px-3 py-8">
                  {empty ?? <AdminEmpty title="표시할 항목이 없습니다." />}
                </td>
              </tr>
            )}

            {!loading &&
              rows.map((row, i) => (
                <tr
                  key={rowKey(row)}
                  className={`border-b border-line/10 last:border-b-0 ${
                    interactive ? `cursor-pointer hover:bg-bg-hover ${adminTokens.focusRing}` : ''
                  } ${rowClassName?.(row) ?? ''}`}
                  {...(interactive
                    ? {
                        tabIndex: 0,
                        onClick: () => onRowClick?.(row),
                        onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onRowClick?.(row);
                          }
                        },
                      }
                    : {})}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-2.5 ${ALIGN[c.align ?? 'left']} ${c.tdClassName ?? ''}`}
                    >
                      {c.cell(row, i)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
