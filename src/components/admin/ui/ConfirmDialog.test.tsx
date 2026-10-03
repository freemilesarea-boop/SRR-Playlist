// @vitest-environment jsdom
/**
 * ConfirmDialog — §12: open/close · confirm · cancel · pending 중복 방지 ·
 * destructive variant · 대상/설명 렌더.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

afterEach(() => cleanup());

const base = {
  title: '아티스트 승인',
  onConfirm: () => {},
  onCancel: () => {},
};

describe('ConfirmDialog', () => {
  it('open=false 면 아무것도 그리지 않는다', () => {
    const { container } = render(<ConfirmDialog {...base} open={false} />);
    expect(container.textContent).toBe('');
  });

  it('open=true 면 제목과 버튼이 보인다', () => {
    render(<ConfirmDialog {...base} open confirmLabel="승인" />);
    expect(screen.getByText('아티스트 승인')).toBeTruthy();
    expect(screen.getByRole('button', { name: '승인' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '취소' })).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('대상과 설명을 보여준다 — 무엇에 하는 작업인지 알 수 있다', () => {
    render(
      <ConfirmDialog {...base} open target="로진 로이어" description="승인하면 음원 업로드가 가능해집니다." />,
    );
    expect(screen.getByText('로진 로이어')).toBeTruthy();
    expect(screen.getByText('승인하면 음원 업로드가 가능해집니다.')).toBeTruthy();
  });

  it('대상을 주지 않으면 가짜 대상을 만들지 않는다', () => {
    const { container } = render(<ConfirmDialog {...base} open description="설명" />);
    expect(container.textContent).toContain('설명');
    expect(container.querySelector('.font-bold')?.textContent).not.toBe('undefined');
  });

  it('count 로 대량 작업 건수를 보여준다', () => {
    render(<ConfirmDialog {...base} open target="선택한 음원" count={1234} />);
    expect(screen.getByText('1,234건')).toBeTruthy();
  });

  it('count 만 줘도 건수가 보인다', () => {
    render(<ConfirmDialog {...base} open count={7} />);
    expect(screen.getByText('7건')).toBeTruthy();
  });

  it('confirm 을 누르면 onConfirm 이 한 번 온다', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...base} open onConfirm={onConfirm} confirmLabel="실행" />);
    fireEvent.click(screen.getByRole('button', { name: '실행' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('연타해도 onConfirm 은 한 번만 간다 (pending 이 올라오기 전에도 막는다)', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...base} open onConfirm={onConfirm} confirmLabel="실행" />);
    const btn = screen.getByRole('button', { name: '실행' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('닫고 다시 열면 중복 방지 가드가 풀린다', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmDialog {...base} open onConfirm={onConfirm} confirmLabel="실행" />,
    );
    fireEvent.click(screen.getByRole('button', { name: '실행' }));
    rerender(<ConfirmDialog {...base} open={false} onConfirm={onConfirm} confirmLabel="실행" />);
    rerender(<ConfirmDialog {...base} open onConfirm={onConfirm} confirmLabel="실행" />);
    fireEvent.click(screen.getByRole('button', { name: '실행' }));
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('cancel 을 누르면 onCancel 이 온다', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...base} open onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('pending 중에는 두 버튼 모두 잠긴다', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog {...base} open pending onConfirm={onConfirm} onCancel={onCancel} confirmLabel="실행" />,
    );
    const confirm = screen.getByRole('button', { name: /실행|처리/ });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    const cancel = screen.getByRole('button', { name: '취소' });
    expect(cancel.hasAttribute('disabled')).toBe(true);
    fireEvent.click(cancel);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('pending 중에는 배경 클릭으로도 닫히지 않는다', () => {
    const onCancel = vi.fn();
    const { container } = render(<ConfirmDialog {...base} open pending onCancel={onCancel} />);
    fireEvent.click(container.querySelector('[role="dialog"]')!);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('pending 이 아니면 배경 클릭으로 취소된다', () => {
    const onCancel = vi.fn();
    const { container } = render(<ConfirmDialog {...base} open onCancel={onCancel} />);
    fireEvent.click(container.querySelector('[role="dialog"]')!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('destructive: 확인 버튼이 danger 톤으로 구분된다', () => {
    const { container, unmount } = render(
      <ConfirmDialog {...base} open destructive confirmLabel="삭제" />,
    );
    const danger = screen.getByRole('button', { name: '삭제' }).className;
    unmount();
    render(<ConfirmDialog {...base} open confirmLabel="삭제" />);
    const normal = screen.getByRole('button', { name: '삭제' }).className;
    expect(danger).not.toBe(normal);
    expect(container).toBeTruthy();
  });

  it('children 으로 사유 입력 등을 넣을 수 있다', () => {
    render(
      <ConfirmDialog {...base} open>
        <textarea aria-label="거절 사유" />
      </ConfirmDialog>,
    );
    expect(screen.getByLabelText('거절 사유')).toBeTruthy();
  });
});
