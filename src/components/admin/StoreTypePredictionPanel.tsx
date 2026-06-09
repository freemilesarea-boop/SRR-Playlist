import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Check, ArrowRight, Sparkles } from 'lucide-react';
import {
  listStoreTypePredictions,
  applyAiStoreTypeToTrack,
  getStoreTypeClassificationStatus,
  type StoreTypePredictionRow,
  type StoreTypePredictionFilter,
  type StoreTypeClassificationStatus,
} from '@/lib/storetypePredictionApi';
import AutoCover from '@/components/AutoCover';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';

/**
 * Phase X1.3 — CLAP zero-shot Store Type 분류 결과 비교 / 1-click 적용.
 * 적용 시 tracks.suitable_store = top1 (name_ko).
 * predicted_main_genre / predicted_moods 는 보존됨.
 */

const FILTERS: Array<{ key: StoreTypePredictionFilter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'unapplied', label: '미적용' },
  { key: 'mismatch', label: '불일치' },
];

export default function StoreTypePredictionPanel() {
  const [filter, setFilter] = useState<StoreTypePredictionFilter>('all');
  const [rows, setRows] = useState<StoreTypePredictionRow[]>([]);
  const [status, setStatus] = useState<StoreTypeClassificationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [items, st] = await Promise.all([
        listStoreTypePredictions(filter, 50, 0),
        getStoreTypeClassificationStatus(),
      ]);
      setRows(items);
      setStatus(st);
    } catch (err) {
      toast.error(friendlyError(err, 'store_type 예측 조회 실패'));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void reload(); }, [reload]);

  async function onApply(row: StoreTypePredictionRow) {
    if (!row.predicted_store_type_labels || row.predicted_store_type_labels.length === 0) {
      toast.error('예측 라벨 없음 (taxonomy slug 누락)');
      return;
    }
    setApplyingId(row.track_id);
    try {
      const res = await applyAiStoreTypeToTrack(row.track_id);
      toast.success(`${res.previous_store ?? '(빈 값)'} → ${res.applied_store} 적용`);
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
          <Sparkles size={16} className="text-accent" /> AI 매장 유형 분류
        </h2>
        <p className="text-xs text-ink-mute">
          CLAP zero-shot 으로 추론된 매장 적합도 top1~3 을 artist 입력 메타와 비교하고 1-click 적용.
          적용 시 <code>tracks.suitable_store</code> ← top1. 모델: <span className="font-mono">taxonomy-v1</span> (genre/mood 와 공존).
        </p>
      </header>

      {status && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-bg-card p-3 ring-1 ring-line/10">
          <Stat label="음원 총" value={status.tracks_total} />
          <Stat label="분류 완료" value={status.tracks_classified} tone="success" />
          <Stat label="대기" value={status.tracks_pending} tone={status.tracks_pending > 0 ? 'warn' : undefined} />
          <Stat label="적용됨" value={status.tracks_applied} />
          <Stat label="불일치" value={status.tracks_mismatch} tone={status.tracks_mismatch > 0 ? 'warn' : undefined} />
          <div className="ml-auto flex items-center gap-2 text-xs text-ink-mute">
            <span className="font-mono">{coverageRate.toFixed(1)}%</span> coverage
            <button onClick={() => void reload()} disabled={loading}
              className="inline-flex items-center gap-1 rounded-full bg-bg-soft px-3 py-1.5 ring-1 ring-line/10 hover:text-ink">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={'rounded-full px-4 py-1.5 text-xs font-semibold transition ' +
              (filter === f.key ? 'bg-accent text-white' : 'bg-bg-soft text-ink-mute ring-1 ring-line/10 hover:text-ink')}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        {loading ? (
          <p className="py-8 text-center text-xs text-ink-mute">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-dim">
            {filter === 'all' ? '아직 분류된 음원이 없습니다. Modal storetype-backfill 을 실행해주세요.'
             : filter === 'unapplied' ? '미적용 예측이 없습니다.' : '불일치 예측이 없습니다.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <StoreTypeRow key={row.track_id} row={row} applying={applyingId === row.track_id} onApply={onApply} />
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-ink-dim">
        • <span className="font-semibold">필터</span> — 전체 / 미적용 / 불일치 (tracks.suitable_store ≠ top1).<br />
        • <span className="font-semibold">적용</span> — top1 → <code>tracks.suitable_store</code> 갱신.
          predicted_main_genre / predicted_moods 보존됨.<br />
        • <span className="font-semibold">Store Fit Gate 연결</span> — 적용 후 0234 의 business_match 게이트가 자동 통과 케이스로 동작.
      </p>
    </div>
  );
}

function StoreTypeRow({ row, applying, onApply }: {
  row: StoreTypePredictionRow;
  applying: boolean;
  onApply: (row: StoreTypePredictionRow) => void | Promise<void>;
}) {
  const conf = row.store_type_confidence != null ? Number(row.store_type_confidence) : null;
  const confTone =
    conf == null ? 'text-ink-dim'
    : conf >= 0.5 ? 'text-emerald-400'
    : conf >= 0.3 ? 'text-amber-400'
    : 'text-rose-400';
  const top1 = row.predicted_store_type_labels?.[0] ?? row.predicted_store_type_slugs?.[0] ?? null;
  const isMatch = !!row.current_suitable_store && !!top1 && row.current_suitable_store === top1;
  const isApplied = !!row.applied_at;

  const top3: Array<{ slug: string; label: string; score: number | null }> = [];
  const slugs = row.predicted_store_type_slugs ?? [];
  const labels = row.predicted_store_type_labels ?? [];
  const scores = row.prediction_scores?.store_type;
  for (let i = 0; i < Math.min(3, slugs.length); i++) {
    top3.push({ slug: slugs[i], label: labels[i] ?? slugs[i], score: scores?.[slugs[i]] ?? null });
  }

  return (
    <li className="rounded-xl bg-bg-soft p-3 ring-1 ring-line/10">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-line/10">
          <AutoCover title={row.title} category={row.current_suitable_store ?? undefined} imageUrl={row.cover_url} size="sm" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">
            {row.title}
            <span className="ml-1.5 text-[10px] text-ink-dim">{row.artist ?? '—'}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-ink-mute">기존</span>
            <span className="rounded bg-bg-card px-1.5 py-0.5 font-mono text-[10px]">{row.current_suitable_store ?? '(빈 값)'}</span>
            <ArrowRight size={11} className="text-ink-dim" />
            <span className="text-ink-mute">AI</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${isMatch ? 'bg-emerald-500/15 text-emerald-400' : 'bg-violet-500/15 text-violet-300'}`}>
              {top1 ?? '—'}
            </span>
            <span className={`font-mono text-[10px] ${confTone}`}>
              {conf != null ? `${(conf * 100).toFixed(1)}%` : '—'}
            </span>
            {isMatch && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">일치</span>}
            {isApplied && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">적용됨</span>}
          </div>
        </div>

        <button onClick={() => void onApply(row)}
          disabled={applying || !top1 || isMatch}
          className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-400 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40"
          title={isMatch ? '이미 일치' : 'tracks.suitable_store 갱신'}>
          <Check size={11} />
          {applying ? '적용 중…' : isApplied ? '재적용' : '적용'}
        </button>
      </div>

      {top3.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {top3.map((c, i) => (
            <div key={c.slug} className="rounded-lg bg-bg-card px-2 py-1.5 ring-1 ring-line/10">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-dim">Top {i + 1}</p>
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
  const toneClass = tone === 'success' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : 'text-ink';
  return (
    <div className="flex items-baseline gap-1.5 rounded-full bg-bg-soft px-3 py-1 ring-1 ring-line/10">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-dim">{label}</span>
      <span className={`text-sm font-bold ${toneClass}`}>{value}</span>
    </div>
  );
}
