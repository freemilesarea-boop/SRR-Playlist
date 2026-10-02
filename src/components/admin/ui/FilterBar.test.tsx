// @vitest-environment jsdom
/**
 * FilterBar — §12: slot 렌더 / clear(reset) / 좁은 화면 wrapping 구조.
 * 핵심 계약은 "state 를 소유하지 않는다" 다 — 그것도 함께 고정한다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { FilterBar } from './FilterBar';

afterEach(() => cleanup());

describe('FilterBar', () => {
  it('준 slot 만 그린다', () => {
    render(
      <FilterBar
        search={<input aria-label="검색" />}
        filters={<select aria-label="상태"><option>전체</option></select>}
        period={<button>최근 7일</button>}
        extra={<button>정렬</button>}
      />,
    );
    expect(screen.getByLabelText('검색')).toBeTruthy();
    expect(screen.getByLabelText('상태')).toBeTruthy();
    expect(screen.getByText('최근 7일')).toBeTruthy();
    expect(screen.getByText('정렬')).toBeTruthy();
  });

  it('search 를 주지 않으면 검색 영역을 만들지 않는다 (억지 검색창 금지)', () => {
    const { container } = render(<FilterBar filters={<span>필터</span>} />);
    expect(container.querySelector('input')).toBeNull();
  });

  it('activeCount 가 0 이면 필터 배지를 숨긴다', () => {
    const { container } = render(<FilterBar filters={<span>f</span>} activeCount={0} />);
    expect(container.textContent).not.toContain('필터 ');
  });

  it('activeCount 가 있으면 배지로 알린다', () => {
    render(<FilterBar filters={<span>f</span>} activeCount={3} />);
    expect(screen.getByText('필터 3')).toBeTruthy();
  });

  it('onReset: active 가 있으면 눌리고 콜백이 온다', () => {
    const onReset = vi.fn();
    render(<FilterBar filters={<span>f</span>} activeCount={2} onReset={onReset} />);
    const btn = screen.getByRole('button', { name: /초기화/ });
    expect(btn.hasAttribute('disabled')).toBe(false);
    fireEvent.click(btn);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('onReset: active 가 0 이면 비활성 — 누를 것이 없다', () => {
    render(<FilterBar filters={<span>f</span>} activeCount={0} onReset={() => {}} />);
    expect(screen.getByRole('button', { name: /초기화/ }).hasAttribute('disabled')).toBe(true);
  });

  it('onReset 을 주지 않으면 초기화 버튼이 없다', () => {
    render(<FilterBar filters={<span>f</span>} activeCount={2} />);
    expect(screen.queryByRole('button', { name: /초기화/ })).toBeNull();
  });

  it('count 는 준 값을 그대로 보인다 (숫자를 계산하지 않는다)', () => {
    render(<FilterBar filters={<span>f</span>} count="128건" />);
    expect(screen.getByText('128건')).toBeTruthy();
  });

  it('좁은 화면: 컨테이너가 flex-wrap 이고 검색이 축소 가능하다', () => {
    const { container } = render(
      <FilterBar search={<input aria-label="검색" />} filters={<span>f</span>} />,
    );
    const bar = container.querySelector('section')!;
    expect(bar.className).toContain('flex-wrap');
    expect(bar.querySelector('.flex-1')?.className).toContain('basis-56');
  });

  it('접근성: 영역에 이름이 있다', () => {
    render(<FilterBar filters={<span>f</span>} />);
    expect(screen.getByRole('region', { name: '검색 및 필터' })).toBeTruthy();
  });

  it('state 를 소유하지 않는다 — 같은 props 면 같은 결과만 낸다', () => {
    const onChange = vi.fn();
    render(<FilterBar search={<input aria-label="검색" value="화정" onChange={onChange} />} />);
    const input = screen.getByLabelText('검색') as HTMLInputElement;
    expect(input.value).toBe('화정');
    fireEvent.change(input, { target: { value: '숙대' } });
    // 값은 호출부가 소유한다 — FilterBar 가 바꾸지 않는다.
    expect(onChange).toHaveBeenCalled();
    expect(input.value).toBe('화정');
  });
});
