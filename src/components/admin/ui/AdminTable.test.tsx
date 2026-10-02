// @vitest-environment jsdom
/**
 * AdminTable — §12 가 요구한 loading / empty / rows / row click / horizontal overflow
 * 를 고정한다. 정렬·검색·pagination 을 내장하지 않는다는 설계도 함께 고정한다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AdminTable, type AdminTableColumn } from './AdminTable';

interface Row { id: string; name: string; n: number }
const ROWS: Row[] = [
  { id: 'a', name: '화정점', n: 1 },
  { id: 'b', name: '숙대점', n: 2 },
];
const COLS: AdminTableColumn<Row>[] = [
  { key: 'name', header: '매장', cell: (r) => r.name },
  { key: 'n', header: '수', cell: (r) => r.n, align: 'right' },
];

afterEach(() => cleanup());

describe('AdminTable', () => {
  it('rows 를 그리고 헤더에 scope="col" 을 붙인다', () => {
    render(<AdminTable caption="매장 목록" columns={COLS} rows={ROWS} rowKey={(r) => r.id} />);
    expect(screen.getByText('화정점')).toBeTruthy();
    expect(screen.getByText('숙대점')).toBeTruthy();
    const ths = screen.getAllByRole('columnheader');
    expect(ths).toHaveLength(2);
    ths.forEach((th) => expect(th.getAttribute('scope')).toBe('col'));
  });

  it('caption 은 스크린리더에만 노출된다', () => {
    const { container } = render(
      <AdminTable caption="매장 목록" columns={COLS} rows={ROWS} rowKey={(r) => r.id} />,
    );
    const cap = container.querySelector('caption');
    expect(cap?.textContent).toBe('매장 목록');
    expect(cap?.className).toContain('sr-only');
  });

  it('loading 이면 스켈레톤을 보이고 데이터 행은 그리지 않는다', () => {
    render(<AdminTable caption="c" columns={COLS} rows={ROWS} rowKey={(r) => r.id} loading />);
    expect(screen.queryByText('화정점')).toBeNull();
    expect(screen.getAllByRole('columnheader')).toHaveLength(2); // 헤더는 유지
  });

  it('비었으면 기본 empty 를 보인다', () => {
    render(<AdminTable caption="c" columns={COLS} rows={[]} rowKey={(r) => r.id} />);
    expect(screen.getByText('표시할 항목이 없습니다.')).toBeTruthy();
  });

  it('empty 를 지정하면 그것을 보인다', () => {
    render(
      <AdminTable caption="c" columns={COLS} rows={[]} rowKey={(r) => r.id} empty={<span>신청 없음</span>} />,
    );
    expect(screen.getByText('신청 없음')).toBeTruthy();
  });

  it('loading 중에는 empty 를 보이지 않는다 (둘이 겹치지 않는다)', () => {
    render(<AdminTable caption="c" columns={COLS} rows={[]} rowKey={(r) => r.id} loading />);
    expect(screen.queryByText('표시할 항목이 없습니다.')).toBeNull();
  });

  it('onRowClick: 클릭과 Enter/Space 로 모두 열린다', () => {
    const onRowClick = vi.fn();
    render(
      <AdminTable caption="c" columns={COLS} rows={ROWS} rowKey={(r) => r.id} onRowClick={onRowClick} />,
    );
    const rows = screen.getAllByRole('row').slice(1); // 헤더 제외
    fireEvent.click(rows[0]);
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
    fireEvent.keyDown(rows[1], { key: 'Enter' });
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1]);
    fireEvent.keyDown(rows[1], { key: ' ' });
    expect(onRowClick).toHaveBeenCalledTimes(3);
    expect(rows[0].getAttribute('tabindex')).toBe('0');
  });

  it('onRowClick 이 없으면 행이 포커스 대상이 아니다', () => {
    render(<AdminTable caption="c" columns={COLS} rows={ROWS} rowKey={(r) => r.id} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0].getAttribute('tabindex')).toBeNull();
  });

  it('가로 overflow 래퍼가 항상 있고 minWidth 가 반영된다', () => {
    const { container } = render(
      <AdminTable caption="c" columns={COLS} rows={ROWS} rowKey={(r) => r.id} minWidth={760} />,
    );
    expect(container.querySelector('.overflow-x-auto')).toBeTruthy();
    expect(container.querySelector('table')?.style.minWidth).toBe('760px');
  });

  it('minWidth 를 주지 않으면 style 을 걸지 않는다', () => {
    const { container } = render(
      <AdminTable caption="c" columns={COLS} rows={ROWS} rowKey={(r) => r.id} />,
    );
    expect(container.querySelector('table')?.style.minWidth).toBe('');
  });

  it('count / toolbar 는 줬을 때만 그린다', () => {
    const { container, unmount } = render(
      <AdminTable caption="c" columns={COLS} rows={ROWS} rowKey={(r) => r.id} />,
    );
    expect(container.textContent).not.toContain('2건');
    unmount();
    render(
      <AdminTable caption="c" columns={COLS} rows={ROWS} rowKey={(r) => r.id} count="2건" toolbar={<button>내보내기</button>} />,
    );
    expect(screen.getByText('2건')).toBeTruthy();
    expect(screen.getByText('내보내기')).toBeTruthy();
  });

  it('rowKey 로 안정적인 key 를 쓴다 (행 순서가 바뀌어도 내용이 따라온다)', () => {
    const { rerender } = render(
      <AdminTable caption="c" columns={COLS} rows={ROWS} rowKey={(r) => r.id} />,
    );
    rerender(
      <AdminTable caption="c" columns={COLS} rows={[...ROWS].reverse()} rowKey={(r) => r.id} />,
    );
    const cells = screen.getAllByRole('cell').map((c) => c.textContent);
    expect(cells[0]).toBe('숙대점');
  });

  it('정렬/검색/pagination 을 내장하지 않는다 (DataGrid 화 방지)', () => {
    const { container } = render(
      <AdminTable caption="c" columns={COLS} rows={ROWS} rowKey={(r) => r.id} />,
    );
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    // 헤더가 정렬 버튼이 아니다
    expect(screen.getAllByRole('columnheader')[0].querySelector('button')).toBeNull();
  });
});
