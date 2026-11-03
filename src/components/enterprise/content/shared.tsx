/**
 * 본사 브랜드 콘텐츠 관리(/enterprise/content) 공용 조각.
 */
import type { ReactNode } from 'react';
import { Clock, X } from 'lucide-react';
import {
  HQ_STATUS_LABEL, HQ_KIND_LABEL,
  type HqContentRequest, type HqRequestStatus,
} from '@/lib/api/hqContentApi';

export function Card({ title, subtitle, action, children }: {
  title: ReactNode; subtitle?: ReactNode; action?: ReactNode; children?: ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[12px] leading-relaxed text-ink-mute">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </section>
  );
}

const STATUS_TONE: Record<HqRequestStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  rejected: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  cancelled: 'bg-bg-hover text-ink-mute',
  superseded: 'bg-bg-hover text-ink-mute',
};

export function StatusBadge({ status }: { status: HqRequestStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold ${STATUS_TONE[status]}`}>
      {HQ_STATUS_LABEL[status]}
    </span>
  );
}

/** 검수 대기 중인 요청 한 줄 — 취소 버튼 포함. */
export function PendingRow({ req, summary, onCancel }: {
  req: HqContentRequest; summary: string; onCancel: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-amber-500/20 px-3 py-2 ring-1 ring-amber-400/40">
      <Clock size={14} className="shrink-0 text-amber-600 dark:text-amber-300" />
      <p className="min-w-0 flex-1 truncate text-[12px] text-ink">
        <b>{HQ_KIND_LABEL[req.kind]}</b> {summary && <span className="text-ink-mute">· {summary}</span>}
      </p>
      <StatusBadge status="pending" />
      <button
        type="button"
        onClick={() => onCancel(req.id)}
        className="shrink-0 rounded-md p-1 text-ink-mute hover:bg-bg-hover hover:text-ink"
        aria-label="요청 취소"
        title="요청 취소"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function NoteInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={200}
      placeholder="운영사에 남길 메모 (선택) — 예: 11월 프로모션용"
      className="input w-full text-sm"
    />
  );
}

/** 업로드 파일의 저작권·내용 책임 확인 — 체크해야 요청을 보낼 수 있다. */
export function ResponsibilityCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-xl bg-bg-soft p-2.5 text-[12px] leading-relaxed">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span>
        올리는 파일의 <b>저작권과 내용에 대한 책임은 본사에 있음</b>을 확인합니다.
        (다른 사람의 음악·영상·이미지를 허락 없이 쓰면 안 돼요.)
      </span>
    </label>
  );
}
