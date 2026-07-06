/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from 'react';
import { Ban, Trash2, AlertTriangle, CheckCircle2, FileEdit } from 'lucide-react';
import {
  adminGetTrackFeedback,
  type FeedbackAction,
  type TrackFeedbackRow,
} from '@/lib/aiCuration';

const ACTION_META: Record<FeedbackAction, {
  label: string;
  tone: string;
  Icon: typeof Ban;
  priority: number;
}> = {
  admin_removed:       { label: '제거', tone: 'bg-rose-500/25 text-rose-300', Icon: Trash2, priority: 0 },
  admin_excluded:      { label: '제외', tone: 'bg-rose-500/20 text-rose-300', Icon: Ban, priority: 1 },
  admin_review_needed: { label: '검토', tone: 'bg-amber-500/25 text-amber-300', Icon: AlertTriangle, priority: 2 },
  admin_approved:      { label: '승인', tone: 'bg-emerald-500/25 text-emerald-300', Icon: CheckCircle2, priority: 3 },
  metadata_corrected:  { label: '메타 수정', tone: 'bg-indigo-500/25 text-indigo-400', Icon: FileEdit, priority: 4 },
};

export function isHardSkip(action: FeedbackAction): boolean {
  return action === 'admin_removed' || action === 'admin_excluded';
}

interface BadgeProps {
  row: TrackFeedbackRow;
  highlighted?: boolean;
}

export function FeedbackBadge({ row, highlighted }: BadgeProps) {
  const meta = ACTION_META[row.action];
  const Icon = meta.Icon;
  const title = [
    row.store_type ?? 'GLOBAL',
    meta.label,
    row.admin_note ? `· ${row.admin_note}` : '',
    row.playlist_name ? `· ${row.playlist_name}` : '',
    `· ${new Date(row.created_at).toLocaleString()}`,
  ].filter(Boolean).join(' ');
  return (
    <span title={title}
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${meta.tone} ${highlighted ? 'ring-1 ring-current' : ''}`}>
      <Icon size={9} />
      {row.store_type ?? 'GLOBAL'} · {meta.label}
    </span>
  );
}

interface BadgesProps {
  trackId: string;
  /** 우선 표시할 store_type (있으면 가장 앞으로) */
  highlightStore?: string | null;
  /** 비어있을 때 null 렌더 */
  hideIfEmpty?: boolean;
  /** 더 보기 토글 */
  collapsible?: boolean;
}

export default function FeedbackBadges({
  trackId, highlightStore, hideIfEmpty = true, collapsible = true,
}: BadgesProps) {
  const [rows, setRows] = useState<TrackFeedbackRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminGetTrackFeedback(trackId)
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [trackId]);

  if (error) return <span className="text-[10px] text-rose-300">feedback 로딩 실패</span>;
  if (rows == null) return null;
  if (rows.length === 0) {
    return hideIfEmpty ? null : (
      <span className="text-[10px] text-ink-dim">no feedback</span>
    );
  }

  const sorted = [...rows].sort((a, b) => {
    if (highlightStore) {
      const aMatch = a.store_type === highlightStore ? 0 : 1;
      const bMatch = b.store_type === highlightStore ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
    }
    return ACTION_META[a.action].priority - ACTION_META[b.action].priority;
  });

  const primary = highlightStore
    ? sorted.filter((r) => r.store_type === highlightStore)
    : sorted.slice(0, 1);
  const others = sorted.filter((r) => !primary.includes(r));

  return (
    <div className="flex flex-wrap items-center gap-1">
      {primary.map((r) => (
        <FeedbackBadge key={r.id} row={r} highlighted />
      ))}
      {collapsible && others.length > 0 && !expanded && (
        <button onClick={() => setExpanded(true)}
          className="rounded-full bg-bg-deep px-1.5 py-0.5 text-[10px] text-ink-dim hover:bg-bg-hover">
          +{others.length} more
        </button>
      )}
      {(!collapsible || expanded) && others.map((r) => (
        <FeedbackBadge key={r.id} row={r} />
      ))}
    </div>
  );
}
