import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, Clock } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import {
  searchOperatorRoutes, OPERATOR_CATEGORIES,
  type OperatorAccessContext,
} from '@/lib/operatorRouteRegistry';
import { loadRecent, type RecentItem } from '@/lib/operatorRecent';

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  OPERATOR_CATEGORIES.map((c) => [c.id, c.label]),
);

/**
 * OperatorCommandPalette — Phase ADMIN-UX-IMPLEMENT-2
 *
 * Ctrl/Cmd + K 로 여는 운영 검색 팔레트.
 *   • 정적 인덱스(레지스트리)만 검색 — 네트워크/컴포넌트 import 없음.
 *   • 권한 필터(searchOperatorRoutes) — superOnly/internal/deprecated 자동 제외.
 *   • 빈 쿼리 시 "최근 사용" 표시.
 *   • 키보드: ↑/↓ 이동, Enter 이동, Esc 닫기. a11y: dialog + combobox/listbox + aria-activedescendant.
 *   • 닫을 때 직전 focus 복원.
 */
export default function OperatorCommandPalette({ ctx }: { ctx: OperatorAccessContext }) {
  const navigate = useNavigate();
  const profileId = useAuthStore((s) => s.profile?.id);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<RecentItem[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // 전역 단축키: Cmd/Ctrl + K 토글. + 사이드바 버튼 등에서 여는 커스텀 이벤트.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('ops:open-command-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('ops:open-command-palette', onOpen);
    };
  }, []);

  // 열릴 때: 직전 focus 저장, 최근 로드, 입력 focus, 상태 초기화.
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;
      setRecent(loadRecent(profileId));
      setQuery('');
      setActive(0);
      // 다음 tick 에 focus (마운트 후).
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    // 닫힐 때 focus 복원.
    restoreFocusRef.current?.focus?.();
    return undefined;
  }, [open, profileId]);

  const results = useMemo(() => searchOperatorRoutes(query, ctx, 8), [query, ctx]);

  // 표시 항목: 쿼리 없으면 최근(있으면) + 대표, 있으면 검색 결과.
  const showingRecent = query.trim() === '' && recent.length > 0;
  const items: Array<{ id: string; label: string; path: string; category?: string }> = showingRecent
    ? recent.map((r) => ({ id: r.id, label: r.label, path: r.path }))
    : results.map((r) => ({ id: r.entry.id, label: r.entry.label, path: r.entry.canonicalPath, category: r.entry.category }));

  useEffect(() => { setActive(0); }, [query]);

  const close = useCallback(() => setOpen(false), []);

  const go = useCallback((path: string) => {
    setOpen(false);
    navigate(path);
  }, [navigate]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[active];
      if (it) go(it.path);
    }
  };

  // active 항목이 보이도록 스크롤.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  const labelledById = 'ops-cmdk-label';
  const listboxId = 'ops-cmdk-listbox';

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[10vh]" role="presentation">
      <div className="absolute inset-0 bg-black/50" onClick={close} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledById}
        className="relative flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line/10 bg-bg-card shadow-2xl"
      >
        <h2 id={labelledById} className="sr-only">운영 검색</h2>
        {/* Search input (combobox) */}
        <div className="flex items-center gap-2 border-b border-line/10 px-4 py-3">
          <Search size={18} className="flex-none text-ink-dim" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={items[active] ? `ops-cmdk-opt-${active}` : undefined}
            placeholder="검색 (매장, 초대코드, 정산, settlement …)"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-dim"
          />
          <kbd className="hidden flex-none rounded border border-line/20 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim sm:block">Esc</kbd>
        </div>

        {/* Results */}
        <ul ref={listRef} id={listboxId} role="listbox" aria-label="검색 결과" className="min-h-0 flex-1 overflow-y-auto p-2">
          {showingRecent && (
            <li className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-dim" role="presentation">
              <span className="inline-flex items-center gap-1"><Clock size={11} /> 최근 사용</span>
            </li>
          )}
          {items.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-ink-dim" role="presentation">
              검색 결과가 없습니다.
            </li>
          ) : (
            items.map((it, idx) => (
              <li key={`${it.id}-${idx}`} role="presentation">
                <button
                  id={`ops-cmdk-opt-${idx}`}
                  data-idx={idx}
                  role="option"
                  aria-selected={idx === active}
                  onClick={() => go(it.path)}
                  onMouseMove={() => setActive(idx)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                    idx === active ? 'bg-accent/15 text-accent' : 'text-ink hover:bg-bg-hover'
                  }`}
                >
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.category && (
                    <span className="flex-none text-[11px] text-ink-dim">{CATEGORY_LABEL[it.category] ?? ''}</span>
                  )}
                  {idx === active && <CornerDownLeft size={13} className="flex-none text-accent" aria-hidden="true" />}
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="sr-only" aria-live="polite">{items.length}개 결과</div>
      </div>
    </div>
  );
}
