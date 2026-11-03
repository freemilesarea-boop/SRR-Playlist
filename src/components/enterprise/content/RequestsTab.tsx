/**
 * 본사 > 브랜드 콘텐츠 > 요청 내역 — 보낸 요청과 검수 결과.
 */
import {
  HQ_KIND_LABEL, summarizeRequest, type HqBrandContent,
} from '@/lib/api/hqContentApi';
import { Card, StatusBadge } from './shared';
import { formatWhen } from './format';

export default function RequestsTab({ data, onCancel }: { data: HqBrandContent; onCancel: (id: string) => void }) {
  const regionName = (id: unknown) => data.regions.find((r) => r.id === id)?.name ?? null;
  return (
    <Card title="요청 내역" subtitle="최근 100건. 반영되거나 반려되면 알림센터로도 알려드려요.">
      {data.requests.length === 0 ? (
        <p className="rounded-xl bg-bg-soft p-4 text-center text-[12px] text-ink-mute">아직 보낸 요청이 없어요.</p>
      ) : (
        <ul className="divide-y divide-line/10">
          {data.requests.map((r) => (
            <li key={r.id} className="py-2.5">
              <div className="flex items-center gap-2">
                <StatusBadge status={r.status} />
                <p className="min-w-0 flex-1 truncate text-sm">
                  <b>{HQ_KIND_LABEL[r.kind]}</b>
                  <span className="text-ink-mute"> {summarizeRequest(r, { regionName: regionName(r.payload.region_id) })}</span>
                </p>
                <span className="shrink-0 text-[11px] text-ink-dim">{formatWhen(r.created_at)}</span>
                {r.status === 'pending' && (
                  <button type="button" onClick={() => onCancel(r.id)}
                    className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-ink-mute hover:bg-bg-hover hover:text-ink">
                    취소
                  </button>
                )}
              </div>
              {r.review_note && (
                <p className={`mt-1 rounded-lg px-2.5 py-1.5 text-[12px] ${r.status === 'rejected' ? 'bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200' : 'bg-bg-soft text-ink-mute'}`}>
                  운영사: {r.review_note}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
