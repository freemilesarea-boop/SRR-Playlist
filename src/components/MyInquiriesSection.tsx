/**
 * MyInquiriesSection — Phase X6.1
 *
 * 사용자 마이페이지 / 대시보드 "내 문의" 섹션.
 * 본인 문의 목록 + 상태 / admin_note 일부 표시.
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, MessageSquare, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { listMyInquiries, type MyInquiryRow, type InquiryStatus } from '@/lib/supportInquiryApi';
import { useAuthStore } from '@/store/authStore';

const STATUS_LABEL: Record<InquiryStatus, string> = {
  open: '접수',
  in_progress: '확인 중',
  resolved: '해결됨',
  closed: '종료',
};

const STATUS_ICON: Record<InquiryStatus, typeof MessageSquare> = {
  open: AlertCircle,
  in_progress: Clock,
  resolved: CheckCircle2,
  closed: CheckCircle2,
};

const STATUS_TONE: Record<InquiryStatus, string> = {
  open: 'bg-amber-500/25 text-amber-500',
  in_progress: 'bg-sky-500/25 text-sky-500',
  resolved: 'bg-emerald-500/25 text-emerald-500',
  closed: 'bg-ink/15 text-ink-mute',
};

export default function MyInquiriesSection() {
  const user = useAuthStore((s) => s.user);
  const [rows, setRows] = useState<MyInquiryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try { setRows(await listMyInquiries(50)); }
    catch { /* silent — no toast for empty page */ }
    finally { setLoading(false); }
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  if (!user?.id) return null;
  if (!loading && rows.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between px-1">
        <h2 className="flex items-center gap-1.5 text-sm font-bold tracking-tight">
          <MessageSquare size={14} /> 내 문의
          {rows.length > 0 && <span className="font-mono text-[10px] text-ink-dim">({rows.length})</span>}
        </h2>
        <button onClick={() => void load()} className="text-[10px] text-ink-dim hover:text-ink">
          <RefreshCw size={10} className={`mr-1 inline ${loading ? 'animate-spin' : ''}`} /> 새로고침
        </button>
      </div>
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const Icon = STATUS_ICON[r.status];
          const isExpanded = expanded === r.id;
          return (
            <li key={r.id} className="rounded-xl bg-bg-card p-3 ring-1 ring-line/10">
              <button onClick={() => setExpanded(isExpanded ? null : r.id)}
                className="flex w-full items-center gap-2 text-left">
                <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${STATUS_TONE[r.status]}`}>
                  <Icon size={9} /> {STATUS_LABEL[r.status]}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.title}</span>
                <span className="shrink-0 font-mono text-[10px] text-ink-dim">
                  {new Date(r.created_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
                </span>
              </button>
              {isExpanded && (
                <div className="mt-2 space-y-1 text-xs">
                  <p className="text-ink-mute">{r.inquiry_type}</p>
                  {r.admin_note && (
                    <div className="rounded-lg bg-accent/10 p-2 text-[11px] ring-1 ring-accent/20">
                      <p className="mb-0.5 text-[10px] font-bold text-accent">운영팀 답변</p>
                      <p className="whitespace-pre-wrap">{r.admin_note}</p>
                    </div>
                  )}
                  {r.resolved_at && (
                    <p className="text-[10px] text-ink-dim">
                      해결: {new Date(r.resolved_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
