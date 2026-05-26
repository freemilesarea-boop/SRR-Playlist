import { useCallback, useEffect, useState } from 'react';
import { ScrollText, RefreshCw } from 'lucide-react';
import { fetchAdminActionLog, ADMIN_ACTION_LABELS, type AdminActionLogRow } from '@/lib/adminRbacApi';
import { toast } from '@/store/toastStore';

function summarizeDetail(detail: unknown): string {
  if (!detail || typeof detail !== 'object') return '';
  const entries = Object.entries(detail as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  return entries.join(' · ');
}

export default function AdminActionLog() {
  const [rows, setRows] = useState<AdminActionLogRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await fetchAdminActionLog(200)); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
            <ScrollText size={16} className="text-accent" /> 관리자 액션 로그
          </h2>
          <p className="text-xs text-ink-mute">누가 · 언제 · 어떤 곡/대상 · 무엇을 했는지 기록 (정산·승인·삭제·Guardrail 등)</p>
        </div>
        <button onClick={() => void load()} disabled={loading}
          className="inline-flex items-center gap-1 rounded-md bg-bg-card px-2 py-1 text-[11px] text-ink-mute hover:bg-bg-hover">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        {loading ? (
          <div className="p-8 text-center text-xs text-ink-mute">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-xs text-ink-mute">기록된 액션이 없어요.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-ink-dim">
                <tr className="border-b border-line/10 text-left">
                  <th className="px-3 py-2 font-semibold">언제</th>
                  <th className="px-3 py-2 font-semibold">누가</th>
                  <th className="px-3 py-2 font-semibold">무엇을</th>
                  <th className="px-3 py-2 font-semibold">어떤 곡/대상</th>
                  <th className="px-3 py-2 font-semibold">상세</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/5 align-top last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-ink-dim">{new Date(r.created_at).toLocaleString('ko-KR')}</td>
                    <td className="px-3 py-2 font-semibold">{r.actor_email ?? '?'}</td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-ink/5 px-1.5 py-0.5 font-semibold">{ADMIN_ACTION_LABELS[r.action] ?? r.action}</span>
                    </td>
                    <td className="px-3 py-2">{r.target_title ?? r.target_email ?? (r.target_id ? <span className="font-mono text-[10px] text-ink-dim">{r.target_id.slice(0, 8)}</span> : '—')}</td>
                    <td className="px-3 py-2 text-ink-mute">{summarizeDetail(r.detail) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
