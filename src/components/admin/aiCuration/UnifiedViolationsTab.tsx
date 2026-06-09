import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { listUnifiedViolations, type UnifiedViolation } from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';

const VIOLATION_LABELS: Record<string, string> = {
  high_skip_rate: '스킵 과다', ai_mismatch: 'AI 불일치', wrong_store_fit: '매장 부적합', wrong_energy: '에너지 불일치',
};

export default function UnifiedViolationsTab() {
  const [rows, setRows] = useState<UnifiedViolation[]>([]);
  const [loading, setLoading] = useState(false);
  const [sev, setSev] = useState<'all' | 'high' | 'medium'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await listUnifiedViolations(200)); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = rows.filter((r) => sev === 'all' || r.severity === sev);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {(['all', 'high', 'medium'] as const).map((s) => (
          <button key={s} onClick={() => setSev(s)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${sev === s ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:bg-bg-hover'}`}>
            {s === 'all' ? '전체' : s === 'high' ? '심각' : '보통'}
          </button>
        ))}
        <button onClick={() => void load()} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-bg-hover">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>
      <p className="text-[11px] text-ink-dim">스킵 과다 + AI 불일치(매장 부적합/에너지 불일치)를 한 화면에서 검토합니다.</p>
      {shown.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">{loading ? '불러오는 중…' : '위반/검토 후보가 없어요.'}</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => (
            <li key={r.id} className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold">{r.title ?? '(제목없음)'} <span className="text-xs text-ink-mute">· {r.artist ?? ''}</span></span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${r.severity === 'high' ? 'bg-rose-500/15 text-rose-600' : r.severity === 'medium' ? 'bg-amber-500/15 text-amber-600' : 'bg-ink/10 text-ink-mute'}`}>
                    {VIOLATION_LABELS[r.violation_type] ?? r.violation_type}
                  </span>
                  <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] text-ink-dim">{r.source === 'skip' ? '스킵' : 'AI'}</span>
                  {r.skip_count != null && <span className="text-[10px] text-ink-dim">스킵 {r.skip_count}</span>}
                  {r.mismatch_score != null && <span className="text-[10px] text-ink-dim">불일치 {Math.round(r.mismatch_score * 100)}%</span>}
                </span>
              </div>
              {r.reason && <p className="mt-1 text-[11px] text-ink-mute">{r.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
