import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Check, ArrowRight, Sparkles } from 'lucide-react';
import {
  listGenrePredictions,
  applyAiGenreToTrack,
  getGenreClassificationStatus,
  type GenrePredictionRow,
  type GenrePredictionFilter,
  type GenreClassificationStatus,
} from '@/lib/genrePredictionApi';
import AutoCover from '@/components/AutoCover';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';

/**
 * Phase X1.1 — CLAP zero-shot 장르 분류 결과 비교 / 1-click 적용 패널.
 *
 * 각 트랙: 기존 artist 입력 main_genre vs AI 예측 main_genre + confidence + top3 candidates.
 * 적용 → tracks.main_genre 갱신 + applied_at 마크.
 */

const FILTERS: Array<{ key: GenrePredictionFilter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'unapplied', label: '미적용' },
  { key: 'mismatch', label: '불일치' },
];

export default function GenrePredictionPanel() {
  const [filter, setFilter] = useState<GenrePredictionFilter>('all');
  const [rows, setRows] = useState<GenrePredictionRow[]>([]);
  const [status, setStatus] = useState<GenreClassificationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [items, st] = await Promise.all([
        listGenrePredictions(filter, 50, 0),
        getGenreClassificationStatus(),
      ]);
      setRows(items);
      setStatus(st);
    } catch (err) {
      toast.error(friendlyError(err, '장르 예측 조회 실패'));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void reload(); }, [reload]);

  async function onApply(row: GenrePredictionRow) {
    if (!row.predicted_main_genre_label) { toast.error('예측 라벨 없음 (taxonomy slug 누락)'); return; }
    setApplyingId(row.track_id);
    try {
      const res = await applyAiGenreToTrack(row.track_id);
      toast.success(`${res.previous_genre ?? '(빈 값)'} → ${res.applied_genre} 적용`);
      await reload();
    } catch (err) {
      toast.error(friendlyError(err, '적용 실패'));
    } finally {
      setApplyingId(null);
    }
  }

  const coverageRate = useMemo(() => {
    if (!status || status.tracks_total === 0) return 0;
    return (status.tracks_classified / status.tracks_total) * 100;
  }, [status]);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
          <Sparkles size={16} className="text-accent" /> AI 장르 분류
        </h2>
        <p className="text-xs text-ink-mute">
          CLAP zero-shot 으로 추론된 장르를 artist 입력 메타와 비교하고 1-click 으로 적용합니다.
          모델 버전: <span className="font-mono">taxonomy-v1</span>.
        </p>
      </header>

      {/* 상단 통계 */}
      {status && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-bg-card p-3 ring-1 ring-line/10">
          <Stat label="음원 총" value={status.tracks_total} />
          <Stat label="분류 완료" value={status.tracks_classified} tone="success" />
          <Stat label="대기" value={status.tracks_pending} tone={status.tracks_pending > 0 ? 'warn' : undefined} />
          <Stat label="적용됨" value={status.tracks_applied} />
          <Stat label="불일치" value={status.tracks_mismatch} tone={status.tracks_mismatch > 0 ? 'warn' : undefined} />
          <div className="ml-auto flex items-center gap-2 text-xs text-ink-mute">
            <span className="font-mono">{coverageRate.toFixed(1)}%</span> coverage
            <button onClick={() => void reload()} disabled={loading} className="inline-flex items-center gap-1 rounded-full bg-bg-soft px-3 py-1.5 ring-1 ring-line/10 hover:text-ink">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              새로고침
            </button>
          </div>
        </div>
      )}

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={
              'rounded-full px-4 py-1.5 text-xs font-semibold transition ' +
              (filter === f.key ? 'bg-accent text-white' : 'bg-bg-soft text-ink-mute ring-1 ring-line/10 hover:text-ink')
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 결과 목록 */}
      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        {loading ? (
          <p className="py-8 text-center text-xs text-ink-mute">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-dim">
            {filter === 'all' ? '아직 분류된 음원이 없습니다. Modal genre-backfill 을 실행해주세요.'
             : filter === 'unapplied' ? '미적용 예측이 없습니다.'
             : '불일치 예측이 없습니다.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <GenreRow key={row.track_id} row={row} applying={applyingId === row.track_id} onApply={onApply} />
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-ink-dim">
        • <span className="font-semibold">필터</span> — <span className="font-mono">전체</span>: 분류된 모든 트랙 / <span className="font-mono">미적용</span>: 아직 tracks.main_genre 에 반영 안 됨 / <span className="font-mono">불일치</span>: 기존 입력값과 AI 예측이 다른 트랙.<br />
        • <span className="font-semibold">적용</span> — tracks.main_genre 를 AI 예측의 한국어 이름으로 덮어씁니다 (artist 가 직접 다시 수정 가능).<br />
        • <span className="font-semibold">confidence</span> — 활성 장르 후보들에 대한 softmax 분포 top1. 0.30 미만은 신중히 검토.
      </p>
    </div>
  );
}

function GenreRow({ row, applying, onApply }: {
  row: GenrePredictionRow;
  applying: boolean;
  onApply: (row: GenrePredictionRow) => void | Promise<void>;
}) {
  const conf = row.genre_confidence != null ? Number(row.genre_confidence) : null;
  const confTone =
    conf == null ? 'text-ink-dim'
    : conf >= 0.5 ? 'text-emerald-400'
    : conf >= 0.3 ? 'text-amber-400'
    : 'text-rose-400';
  const isMatch = !!row.current_main_genre && row.current_main_genre === row.predicted_main_genre_label;
  const isApplied = !!row.applied_at;

  // top3 = main + subs[0..1] (총 3개)
  const top3: Array<{ slug: string; label: string; score: number | null }> = [];
  if (row.predicted_main_genre_slug) {
    top3.push({
      slug: row.predicted_main_genre_slug,
      label: row.predicted_main_genre_label ?? row.predicted_main_genre_slug,
      score: conf,
    });
  }
  const scores = row.prediction_scores?.genre;
  const subSlugs = row.predicted_sub_genres ?? [];
  const subLabels = row.predicted_sub_labels ?? [];
  for (let i = 0; i < Math.min(2, subSlugs.length); i++) {
    top3.push({
      slug: subSlugs[i],
      label: subLabels[i] ?? subSlugs[i],
      score: scores?.[subSlugs[i]] ?? null,
    });
  }

  return (
    <li className="rounded-xl bg-bg-soft p-3 ring-1 ring-line/10">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-line/10">
          <AutoCover title={row.title} category={row.current_main_genre ?? undefined} imageUrl={row.cover_url} size="sm" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">
            {row.title}
            <span className="ml-1.5 text-[10px] text-ink-dim">{row.artist ?? '—'}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-ink-mute">기존</span>
            <span className="rounded bg-bg-card px-1.5 py-0.5 font-mono text-[10px]">{row.current_main_genre ?? '(빈 값)'}</span>
            <ArrowRight size={11} className="text-ink-dim" />
            <span className="text-ink-mute">AI</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${isMatch ? 'bg-emerald-500/15 text-emerald-400' : 'bg-violet-500/15 text-violet-300'}`}>
              {row.predicted_main_genre_label ?? row.predicted_main_genre_slug ?? '—'}
            </span>
            <span className={`font-mono text-[10px] ${confTone}`}>
              {conf != null ? `${(conf * 100).toFixed(1)}%` : '—'}
            </span>
            {isMatch && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">일치</span>}
            {isApplied && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">적용됨</span>}
          </div>
        </div>

        <button
          onClick={() => void onApply(row)}
          disabled={applying || !row.predicted_main_genre_label || isMatch}
          className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-400 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40"
          title={isMatch ? '이미 일치' : 'tracks.main_genre 갱신'}
        >
          <Check size={11} />
          {applying ? '적용 중…' : isApplied ? '재적용' : '적용'}
        </button>
      </div>

      {/* Top 3 후보 분포 */}
      {top3.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {top3.map((c, i) => (
            <div key={c.slug} className="rounded-lg bg-bg-card px-2 py-1.5 ring-1 ring-line/10">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-dim">
                Top {i + 1}
              </p>
              <p className="mt-0.5 truncate text-[11px] font-semibold">{c.label}</p>
              <p className="font-mono text-[10px] text-ink-mute">
                {c.score != null ? `${(c.score * 100).toFixed(1)}%` : '—'}
              </p>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'warn' }) {
  const toneClass =
    tone === 'success' ? 'text-emerald-400'
    : tone === 'warn' ? 'text-amber-400'
    : 'text-ink';
  return (
    <div className="flex items-baseline gap-1.5 rounded-full bg-bg-soft px-3 py-1 ring-1 ring-line/10">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-dim">{label}</span>
      <span className={`text-sm font-bold ${toneClass}`}>{value}</span>
    </div>
  );
}
