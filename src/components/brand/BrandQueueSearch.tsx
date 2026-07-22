// Phase BRAND-PLAYER-UX-5 — Queue 검색 입력. 현재 Queue 범위 client-side 필터(새 DB query 없음).
import { Search, X } from 'lucide-react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  resultCount: number;
  total: number;
}

export default function BrandQueueSearch({ value, onChange, onFocus, onBlur, resultCount, total }: Props) {
  return (
    <div className="px-3 pb-2">
      <div className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 focus-within:ring-2 focus-within:ring-accent">
        <Search size={15} className="shrink-0 text-white/50" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder="제목·아티스트 검색"
          aria-label="재생목록 검색"
          className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
        />
        {value && (
          <button onClick={() => onChange('')} aria-label="검색어 지우기"
            className="shrink-0 rounded-full p-0.5 text-white/60 hover:bg-white/10 hover:text-white">
            <X size={14} />
          </button>
        )}
      </div>
      {value.trim() !== '' && (
        <p className="px-1 pt-1 text-[11px] text-white/45">{resultCount}곡 검색됨 · 전체 {total}곡</p>
      )}
    </div>
  );
}
