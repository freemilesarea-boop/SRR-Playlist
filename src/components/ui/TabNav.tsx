/**
 * TabNav — 가로 탭. 모바일에서 가로 스크롤되고 페이지 폭을 밀지 않는다.
 *
 * URL 동기화는 여기서 하지 않는다 — 쓰는 쪽이 searchParams 든 state 든 고르게
 * 두는 편이 재사용에 유리하다. 여기는 그리기와 접근성만 책임진다.
 */
import type { ReactNode } from 'react';

export interface TabItem<K extends string = string> {
  key: K;
  label: string;
  icon?: ReactNode;
  /** 처리할 게 남은 탭에 숫자를 띄운다. 0 이면 표시하지 않는다. */
  badge?: number;
}

export default function TabNav<K extends string>({
  items,
  value,
  onChange,
  ariaLabel = '탭',
}: {
  items: ReadonlyArray<TabItem<K>>;
  value: K;
  onChange: (key: K) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      // -mx-4 + px-4 : 모바일에서 가장자리까지 스크롤되게 하되 첫 탭이 잘리지 않게.
      className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition ${
              active
                ? 'bg-accent text-bg'
                : 'bg-bg-card text-ink-mute ring-1 ring-line/10 hover:text-ink'
            }`}
          >
            {t.icon}
            {t.label}
            {!!t.badge && t.badge > 0 && (
              <span
                className={`ml-0.5 rounded-full px-1.5 text-[10px] font-bold tabular-nums ${
                  active ? 'bg-bg/25 text-bg' : 'bg-accent/20 text-accent'
                }`}
              >
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
