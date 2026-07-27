/**
 * QualityDashboard — UX-2 우측 품질 요약 패널(+ Quick Fix 식별).
 *   기존 runQualityCheck + buildQualityDashboard 재사용. 새 차트 라이브러리 없이 Bar/Stat.
 *   Quick Fix 는 "문제 트랙 선택"까지만 — 자동 삭제/교체하지 않는다(관리자 확인).
 */
import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  type BuilderTrack,
  runQualityCheck,
  formatTotalDuration,
  HIGH_FIT,
  MIN_LEARNING_SAMPLE,
  ARTIST_CONCENTRATION_WARN,
  GENRE_CONCENTRATION_WARN,
} from '@/lib/playlistBuilder';
import { buildQualityDashboard } from '@/lib/playlistBuilderInsights';
import { MiniBars, QualityStatusBadge, Stat } from './parts';
import { numText, pctText } from './format';

function overConcentrated(tracks: BuilderTrack[], key: (t: BuilderTrack) => string | null, threshold: number): string[] {
  if (tracks.length === 0) return [];
  const counts = new Map<string, number>();
  for (const t of tracks) {
    const k = key(t);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const over = new Set<string>();
  for (const [k, c] of counts) if (c / tracks.length > threshold) over.add(k);
  return tracks.filter((t) => {
    const k = key(t);
    return k != null && over.has(k);
  }).map((t) => t.track_id);
}

export function QualityDashboard({
  tracks,
  targetDurationSec,
  onFlag,
}: {
  tracks: BuilderTrack[];
  targetDurationSec: number | null;
  onFlag: (ids: string[], label: string) => void;
}) {
  const issues = useMemo(() => runQualityCheck(tracks, { targetDurationSec }), [tracks, targetDurationSec]);
  const d = useMemo(() => buildQualityDashboard(tracks, issues, { targetDurationSec }), [tracks, issues, targetDurationSec]);

  const quickFixes = useMemo(() => {
    const list: { label: string; ids: string[] }[] = [
      { label: 'Blocked', ids: tracks.filter((t) => t.guardrailBlocked || t.fitStatus === 'excluded').map((t) => t.track_id) },
      { label: 'Penalized', ids: tracks.filter((t) => t.guardrailPenalty > 0 || t.fitStatus === 'review_needed').map((t) => t.track_id) },
      { label: 'Audio 누락', ids: tracks.filter((t) => !t.audioUrl).map((t) => t.track_id) },
      { label: '낮은 Fit', ids: tracks.filter((t) => typeof t.fitScore === 'number' && t.fitScore < HIGH_FIT).map((t) => t.track_id) },
      { label: '데이터 부족', ids: tracks.filter((t) => typeof t.sampleCount === 'number' && t.sampleCount < MIN_LEARNING_SAMPLE).map((t) => t.track_id) },
      { label: '동일 아티스트 과다', ids: overConcentrated(tracks, (t) => t.artist, ARTIST_CONCENTRATION_WARN) },
      { label: '동일 장르 과다', ids: overConcentrated(tracks, (t) => t.genre, GENRE_CONCENTRATION_WARN) },
    ];
    return list.filter((q) => q.ids.length > 0);
  }, [tracks]);

  return (
    <div className="space-y-3 rounded-xl border border-line/10 bg-bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">품질 대시보드</span>
        <span className="ml-auto">
          <QualityStatusBadge status={d.status} />
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3">
        <Stat label="트랙 수" value={String(d.trackCount)} />
        <Stat label="총 시간" value={formatTotalDuration(d.totalDurationSec)} />
        <Stat label="목표 충족" value={d.durationFulfillment == null ? '—' : pctText(d.durationFulfillment)} />
        <Stat label="평균 Fit" value={numText(d.avgFit)} />
        <Stat label="평균 Adaptive" value={numText(d.avgAdaptive)} />
        <Stat label="Vocal 비율" value={pctText(d.vocalRatio)} />
        <Stat label="Blocked" value={String(d.blockedCount)} />
        <Stat label="Penalized" value={String(d.penalizedCount)} />
        <Stat label="Audio 누락" value={String(d.missingAudioCount)} />
        <Stat label="오류/경고" value={`${d.errorCount}/${d.warningCount}`} />
      </div>

      <div className="space-y-2 border-t border-line/10 pt-2">
        <MiniBars title="장르" buckets={d.genre} />
        <MiniBars title="아티스트" buckets={d.artist} />
        <MiniBars title="에너지" buckets={d.energy} />
      </div>

      {quickFixes.length > 0 && (
        <div className="space-y-1.5 border-t border-line/10 pt-2">
          <p className="flex items-center gap-1 text-xs font-medium text-amber-300">
            <AlertTriangle size={12} aria-hidden /> Quick Fix — 문제 트랙 선택
          </p>
          <div className="flex flex-wrap gap-1.5">
            {quickFixes.map((q) => (
              <button
                key={q.label}
                className="btn-ghost h-7 rounded-full px-2 text-[11px]"
                onClick={() => onFlag(q.ids, q.label)}
              >
                {q.label} ({q.ids.length})
              </button>
            ))}
          </div>
          <p className="text-[10px] text-ink-dim">선택만 표시합니다. 삭제/교체는 관리자가 확인 후 수행합니다.</p>
        </div>
      )}
    </div>
  );
}
