/**
 * useModalA11y — 모달 접근성 (focus trap + Esc + restore focus) (X6.42)
 *
 * 사용법:
 *   const containerRef = useRef<HTMLDivElement>(null);
 *   useModalA11y(containerRef, { onClose, enabled: open });
 *
 *   <div ref={containerRef} role="dialog" aria-modal="true">
 *     ...
 *   </div>
 *
 * 동작:
 *   - mount 시 첫 focusable 요소에 자동 focus (또는 컨테이너 자체)
 *   - Esc 키 누르면 onClose 호출
 *   - Tab/Shift+Tab 시 모달 내부에서 순환 (focus trap)
 *   - unmount 시 이전에 focus 였던 요소로 복원 (restoreFocus 기본 true)
 *
 * 주의:
 *   - 한 페이지에 여러 모달이 동시에 떠 있을 때, 가장 최근 hook 만 활성 효과
 *     (각 모달이 enabled=true 일 때 자기 컨테이너 안에서 trap 작동)
 *   - 첫 focusable 찾기 실패 시 컨테이너 자체에 tabindex=-1 + focus
 */
import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

interface Options {
  onClose: () => void;
  /** false 일 때는 hook 비활성 (조건부 모달 mount/unmount 시 유용) */
  enabled?: boolean;
  /** unmount 시 이전 focus 복원 — 기본 true */
  restoreFocus?: boolean;
  /** 초기 자동 focus 비활성 — 기본 false (= 자동 focus on) */
  skipInitialFocus?: boolean;
}

export function useModalA11y(
  containerRef: RefObject<HTMLElement | null>,
  { onClose, enabled = true, restoreFocus = true, skipInitialFocus = false }: Options,
): void {
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = (document.activeElement as HTMLElement | null) ?? null;

    // 초기 focus
    if (!skipInitialFocus) {
      const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length > 0) {
        // 자동 focus 가 input/textarea 의 placeholder 와 충돌하지 않도록 첫 button 선호
        const first =
          Array.from(focusables).find((el) => el.tagName === 'BUTTON') ?? focusables[0];
        first.focus();
      } else {
        // 컨테이너 자체 focus 가능하게
        if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
        container.focus();
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // focus trap
      const el = containerRef.current;
      if (!el) return;
      const focusables = Array.from(
        el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((node) => !node.hasAttribute('disabled') && node.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !el.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !el.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (restoreFocus && previouslyFocused && typeof previouslyFocused.focus === 'function') {
        // 다음 tick 에 복원 — 모달 unmount 가 끝나야 focus 가 안정적
        window.setTimeout(() => {
          try { previouslyFocused.focus(); } catch { /* noop */ }
        }, 0);
      }
    };
    // containerRef 는 ref 객체로 안정 — enabled / onClose 변동 시만 재실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, onClose, restoreFocus, skipInitialFocus]);
}
