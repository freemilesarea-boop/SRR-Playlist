/**
 * AdminSearch — search input + filter slots 표준 layout.
 *
 * 예:
 *   <AdminSearch
 *     value={q} onChange={setQ} placeholder="검색…"
 *     filters={<><select>...</select><select>...</select></>}
 *     trailing={<button>초기화</button>}
 *   />
 */
import { Search } from 'lucide-react';
import { adminTokens } from './palette';

interface AdminSearchProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  filters?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}

export function AdminSearch({
  value, onChange, placeholder = '검색…', filters, trailing, className = '',
}: AdminSearchProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${adminTokens.radius.xl} bg-bg-card px-3 py-2 ring-1 ring-line/10 ${className}`}>
      <div className="relative flex-1 min-w-[200px]">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-dim" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full ${adminTokens.radius.md} bg-bg-deep pl-7 pr-2 py-1.5 text-xs text-ink placeholder:text-ink-dim ${adminTokens.focusRing}`}
        />
      </div>
      {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
      {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
    </div>
  );
}
