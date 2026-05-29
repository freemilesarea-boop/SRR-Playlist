import { useCallback, useEffect, useState } from 'react';
import { Brain, RefreshCw, Check, Zap, Activity, Music2 } from 'lucide-react';
import {
  listPendingAiPredictions,
  aiPredictionsSummary,
  applyTrackAiPredictions,
  bulkApplyHighConfidence,
  type PendingAiPrediction,
  type AiPredictionsSummary,
} from '@/lib/trackAiPredictionsApi';
import AutoCover from '@/components/AutoCover';
import { toast } from '@/store/toastStore';

const ENERGY_LABELS: Record<number, string> = {
  1: '매우 차분',
  2: '차분',
  3: '중간',
  4: '에너지',
  5: '매우 강렬',
};

const TEMPO_FEEL_LABELS: Record<string, string> = {
  slow: '느림',
  mid: '중간',
  fast: '빠름',
};

export default function TrackAiMetadataPanel() {
  const [items, setItems] = useState<PendingAiPrediction[]>([]);
  const [summary, setSummary] = useState<AiPredictionsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [threshold, setThreshold] = useState(0.6);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, sum] = await Promise.all([
        listPendingAiPredictions(50),
        aiPredictionsSummary(),
      ]);
      setItems(rows);
      setSummary(sum);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function handleApply(row: PendingAiPrediction) {
    setApplyingId(row.id);
    try {
      await applyTrackAiPredictions(row.id, {
        applyEnergy: true, applyBpm: true, applyTempoFeel: true,
        overwriteExisting: false,
      });
      toast.success(`'${row.track_title}' 메타데이터 적용됨`);
      setItems((prev) => prev.filter((r) => r.id !== row.id));
      aiPredictionsSummary().then(setSummary).catch(() => {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '적용 실패');
    } finally {
      setApplyingId(null);
    }
  }

  async function handleBulkApply() {
    if (!confirm(`Confidence ≥ ${threshold} 인 모든 예측을 비어있는 필드에만 일괄 적용할까요?`)) return;
    setBulkApplying(true);
    try {
      const count = await bulkApplyHighConfidence(threshold, 500);
      toast.success(`${count}개 트랙 메타데이터 일괄 적용 완료`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '일괄 적용 실패');
    } finally {
      setBulkApplying(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="mb-3 flex items-center gap-2">
          <Brain size={14} className="text-accent" />
          <h3 className="text-sm font-bold tracking-tight">AI 메타데이터 자동 보정</h3>
          <span className="ml-auto text-[10px] text-ink-dim">
            CLAP zero-shot (energy) + librosa (BPM) → tracks 본 테이블 보강
          </span>
        </div>

        {summary && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="총 예측" value={`${summary.total_predictions}`} />
            <Stat label="대기" value={`${summary.pending_count}`} highlight />
            <Stat label="적용됨" value={`${summary.applied_count}`} />
            <Stat
              label="평균 confidence"
              value={summary.avg_energy_confidence != null ? Number(summary.avg_energy_confidence).toFixed(2) : '—'}
            />
            <Stat label={`고신뢰 대기 (≥0.6)`} value={`${summary.high_conf_pending}`} />
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={reload} disabled={loading} className="btn-ghost h-9">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            새로고침
          </button>

          <div className="ml-auto flex items-center gap-2 rounded-lg bg-bg-soft px-3 py-1.5 ring-1 ring-line/10">
            <span className="text-[11px] text-ink-mute">일괄 적용 임계점</span>
            <input
              type="number" min={0} max={1} step={0.05}
              value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}
              className="input h-7 w-16 text-xs"
            />
            <button
              onClick={handleBulkApply}
              disabled={bulkApplying || !summary || summary.high_conf_pending === 0}
              className="btn-primary h-7 text-[11px]"
              title="confidence 이상 예측을 빈 필드에만 일괄 적용 (덮어쓰지 않음)"
            >
              <Zap size={11} />
              {bulkApplying ? '적용 중…' : `고신뢰 ${summary?.high_conf_pending ?? 0}개 적용`}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-bold tracking-tight">
            대기 중 예측
            <span className="ml-2 text-xs text-ink-mute">{items.length}개</span>
          </h4>
        </div>

        {loading ? (
          <p className="py-8 text-center text-xs text-ink-mute">불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-dim">
            대기 중 예측이 없습니다. 새 음원이 승인되면 자동으로 추론되어 여기에 표시됩니다.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((row) => (
              <li key={row.id} className="rounded-xl bg-bg-soft p-3 ring-1 ring-line/10">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-line/10">
                    <AutoCover title={row.track_title} category={row.main_genre ?? undefined} imageUrl={row.cover_url} size="sm" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">
                      {row.track_title}
                      <span className="ml-1.5 text-[10px] text-ink-dim">{row.track_artist ?? '—'}</span>
                    </p>
                    <p className="mt-0.5 text-[10px] text-ink-mute">
                      {row.main_genre ?? '—'}{row.sub_genre ? ` · ${row.sub_genre}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => handleApply(row)}
                    disabled={applyingId === row.id}
                    className="shrink-0 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-400 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50"
                    title="비어있는 필드에 예측값 적용"
                  >
                    <Check size={11} />
                    {applyingId === row.id ? '적용 중…' : '적용'}
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  <FieldRow
                    icon={<Zap size={11} />} label="에너지"
                    current={row.current_energy_level != null ? `${row.current_energy_level} (${ENERGY_LABELS[row.current_energy_level] ?? ''})` : null}
                    predicted={row.predicted_energy_level != null ? `${row.predicted_energy_level} (${ENERGY_LABELS[row.predicted_energy_level] ?? ''})` : null}
                    confidence={row.energy_confidence}
                  />
                  <FieldRow
                    icon={<Activity size={11} />} label="BPM"
                    current={row.current_bpm != null ? `${row.current_bpm}` : null}
                    predicted={row.predicted_bpm != null ? `${row.predicted_bpm}` : null}
                  />
                  <FieldRow
                    icon={<Music2 size={11} />} label="Tempo"
                    current={row.current_tempo_feel ? (TEMPO_FEEL_LABELS[row.current_tempo_feel] ?? row.current_tempo_feel) : null}
                    predicted={row.predicted_tempo_feel ? (TEMPO_FEEL_LABELS[row.predicted_tempo_feel] ?? row.predicted_tempo_feel) : null}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2 ring-1 ring-line/10 ${highlight ? 'bg-accent/10' : 'bg-bg-soft'}`}>
      <div className="text-[9px] font-bold uppercase tracking-wider text-ink-dim">{label}</div>
      <div className={`mt-0.5 truncate text-sm font-bold ${highlight ? 'text-accent' : ''}`}>{value}</div>
    </div>
  );
}

function FieldRow({ icon, label, current, predicted, confidence }: {
  icon: React.ReactNode;
  label: string;
  current: string | null;
  predicted: string | null;
  confidence?: number | null;
}) {
  return (
    <div className="rounded-lg bg-bg-card p-2 ring-1 ring-line/5">
      <div className="mb-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-ink-dim">
        {icon}
        {label}
        {confidence != null && (
          <span className="ml-auto rounded bg-accent/15 px-1 text-[9px] font-bold text-accent">
            {Number(confidence).toFixed(2)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 text-[10px]">
        <span className="text-ink-mute">{current ?? '—'}</span>
        <span className="text-ink-dim">→</span>
        <span className={predicted ? 'font-semibold text-ink' : 'text-ink-dim'}>{predicted ?? '—'}</span>
      </div>
    </div>
  );
}
