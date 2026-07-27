/**
 * playlistBuilder/dialogs — UX-2 모달들(저장 리뷰 / AI 순서 Diff / 대체 후보).
 *   모두 AdminModal 재사용. 어떤 모달도 DB 저장/배포를 하지 않는다(호출부가 결정).
 */
import { useMemo, useState } from 'react';
import { ArrowRight, ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { AdminModal } from '@/components/admin/ui';
import {
  type BuilderTrack,
  formatTotalDuration,
  effectiveScore,
} from '@/lib/playlistBuilder';
import {
  type SaveReviewSummary,
  computeOrderDiff,
  orderImprovement,
} from '@/lib/playlistBuilderInsights';
import { QualityStatusBadge } from './parts';

// ---------------------------------------------------------------------------
// Save Review
// ---------------------------------------------------------------------------
export function SaveReviewDialog({
  open,
  onClose,
  summary,
  playlistTitle,
  afterStatusLabel,
  saving,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  summary: SaveReviewSummary;
  playlistTitle: string;
  afterStatusLabel: string; // 저장 후 상태(draft/released)
  saving: boolean;
  onConfirm: () => void;
}) {
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between py-1 text-sm">
      <span className="text-ink-mute">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title="저장 검토"
      footer={
        <>
          <button className="btn-ghost h-9 px-3 text-sm" onClick={onClose} disabled={saving}>
            돌아가서 수정
          </button>
          <button
            className="btn-primary h-9 px-4 text-sm disabled:opacity-50"
            onClick={onConfirm}
            disabled={saving || summary.willBlock}
            title={summary.willBlock ? '오류/차단 트랙이 있어 저장할 수 없습니다' : undefined}
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </>
      }
    >
      <div className="space-y-1">
        <div className="mb-2 flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{playlistTitle}</span>
          <QualityStatusBadge status={summary.status} />
        </div>
        {row('트랙 수', summary.trackCount)}
        {row('총 재생시간', formatTotalDuration(summary.totalDurationSec))}
        {row('추가된 트랙', `+${summary.added}`)}
        {row('삭제된 트랙', `-${summary.removed}`)}
        {row('순서 변경', summary.reordered)}
        {row('오류', summary.errorCount)}
        {row('경고', summary.warningCount)}
        {row('저장 후 상태', afterStatusLabel)}
        <p className="mt-2 rounded-lg bg-line/5 px-3 py-2 text-xs text-ink-mute">
          저장은 현재 트랙 집합/순서를 트랜잭션 1회로 반영합니다. Production 자동 배포는 없습니다.
        </p>
        {summary.willBlock && (
          <p className="text-xs text-rose-300">오류 또는 차단 트랙이 있어 저장할 수 없습니다. 먼저 해결해주세요.</p>
        )}
      </div>
    </AdminModal>
  );
}

// ---------------------------------------------------------------------------
// AI Order Diff (현재 vs 추천)
// ---------------------------------------------------------------------------
function MetricRow({ label, a, b, lowerBetter = true }: { label: string; a: number | null; b: number | null; lowerBetter?: boolean }) {
  const fmt = (v: number | null) => (v == null ? '—' : (Math.round(v * 10) / 10).toString());
  const improved = a != null && b != null && (lowerBetter ? b < a : b > a);
  const worse = a != null && b != null && (lowerBetter ? b > a : b < a);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="flex-1 text-ink-mute">{label}</span>
      <span className="w-10 text-right tabular-nums">{fmt(a)}</span>
      <ArrowRight size={11} className="text-ink-dim" aria-hidden />
      <span className={`w-10 text-right tabular-nums ${improved ? 'text-emerald-300' : worse ? 'text-rose-300' : ''}`}>
        {fmt(b)}
      </span>
    </div>
  );
}

export function OrderDiffDialog({
  open,
  onClose,
  current,
  suggested,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  current: BuilderTrack[];
  suggested: BuilderTrack[];
  onApply: (order: BuilderTrack[]) => void;
}) {
  const [changedOnly, setChangedOnly] = useState(true);
  const diff = useMemo(() => computeOrderDiff(current, suggested), [current, suggested]);
  const imp = useMemo(() => orderImprovement(current, suggested), [current, suggested]);
  const rows = changedOnly ? diff.filter((d) => d.moved) : diff;

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title="AI 순서 제안 비교"
      size="lg"
      footer={
        <>
          <button className="btn-ghost h-9 px-3 text-sm" onClick={onClose}>
            취소
          </button>
          <button
            className="btn-primary h-9 px-4 text-sm disabled:opacity-50"
            onClick={() => onApply(suggested)}
            disabled={imp.movedCount === 0}
          >
            추천 순서 적용(미저장)
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-line/10 p-3">
          <p className="mb-2 text-xs font-medium">순서 품질(현재 → 추천)</p>
          <div className="space-y-1">
            <MetricRow label="동일 아티스트 인접" a={imp.current.sameArtistAdjacent} b={imp.suggested.sameArtistAdjacent} />
            <MetricRow label="동일 장르 인접" a={imp.current.sameGenreAdjacent} b={imp.suggested.sameGenreAdjacent} />
            <MetricRow label="평균 BPM 변화" a={imp.current.avgBpmDelta} b={imp.suggested.avgBpmDelta} />
            <MetricRow label="평균 Energy 변화" a={imp.current.avgEnergyDelta} b={imp.suggested.avgEnergyDelta} />
            <MetricRow label="보컬 연속" a={imp.current.vocalAdjacent} b={imp.suggested.vocalAdjacent} />
            <MetricRow label="경고 수" a={imp.current.warningCount} b={imp.suggested.warningCount} />
          </div>
          <p className="mt-2 text-[11px] text-ink-dim">{imp.movedCount}곡 이동 제안. 적용해도 저장 전까지 DB 미반영.</p>
        </div>

        <label className="flex items-center gap-1.5 text-xs text-ink-mute">
          <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} />
          변경된 트랙만 보기
        </label>

        <ul className="max-h-[40vh] divide-y divide-line/10 overflow-y-auto rounded-lg border border-line/10">
          {rows.map((d) => (
            <li key={d.trackId} className="flex items-center gap-2 p-2 text-xs">
              <span className="w-16 shrink-0 text-ink-dim">
                #{d.fromIndex + 1}
                {d.moved && (
                  <>
                    {' '}
                    {d.delta < 0 ? <ArrowUp size={10} className="inline text-emerald-300" /> : <ArrowDown size={10} className="inline text-amber-300" />}
                    {' '}#{d.toIndex + 1}
                  </>
                )}
                {!d.moved && <Minus size={10} className="ml-1 inline text-ink-dim" />}
              </span>
              <span className="min-w-0 flex-1 truncate">{d.title ?? '제목 없음'}</span>
              <span className="shrink-0 text-ink-mute">{d.reason}</span>
            </li>
          ))}
          {rows.length === 0 && <li className="p-4 text-center text-xs text-ink-mute">변경된 트랙이 없습니다.</li>}
        </ul>
      </div>
    </AdminModal>
  );
}

// ---------------------------------------------------------------------------
// Replacement 후보
// ---------------------------------------------------------------------------
export function ReplacementDialog({
  open,
  onClose,
  target,
  candidates,
  onReplace,
}: {
  open: boolean;
  onClose: () => void;
  target: BuilderTrack | null;
  candidates: BuilderTrack[];
  onReplace: (candidateId: string) => void;
}) {
  if (!target) return null;
  return (
    <AdminModal open={open} onClose={onClose} title="대체 후보" size="lg">
      <div className="space-y-3">
        <div className="rounded-lg bg-line/5 p-2 text-xs">
          <span className="text-ink-mute">교체 대상: </span>
          <span className="font-medium">{target.title ?? '제목 없음'}</span>
          <span className="text-ink-mute"> · {target.artist ?? '—'}</span>
        </div>
        <p className="text-[11px] text-ink-dim">
          유사 장르/Energy/BPM 기준 후보(Blocked·Penalized 제외, 현재 목록 제외). 관리자가 선택해야 교체됩니다.
        </p>
        <ul className="max-h-[46vh] divide-y divide-line/10 overflow-y-auto rounded-lg border border-line/10">
          {candidates.map((c) => {
            const eff = effectiveScore(c);
            return (
              <li key={c.track_id} className="flex items-center gap-2 p-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate">{c.title ?? '제목 없음'}</p>
                  <p className="truncate text-xs text-ink-mute">
                    {c.artist ?? '—'}
                    {c.genre ? ` · ${c.genre}` : ''}
                  </p>
                </div>
                {eff != null && <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">{Math.round(eff)}</span>}
                <button className="btn-ghost h-7 px-2 text-xs" onClick={() => onReplace(c.track_id)}>
                  교체
                </button>
              </li>
            );
          })}
          {candidates.length === 0 && <li className="p-6 text-center text-xs text-ink-mute">적합한 대체 후보가 없습니다.</li>}
        </ul>
      </div>
    </AdminModal>
  );
}
