import { useState } from 'react';
import { Sparkles, Play } from 'lucide-react';
import {
  recommendTracksByContext,
  type RecommendedTrack,
} from '@/lib/recommendationApi';
import {
  TIME_SLOT_TAGS,
  TIME_SLOT_TAG_LABELS,
  SITUATION_TAGS,
  SITUATION_TAG_LABELS,
  BUSINESS_TAGS,
  BUSINESS_TAG_LABELS,
  MOOD_TAGS,
  MOOD_TAG_LABELS,
} from '@/lib/recommendationTaxonomy';
import { usePlayerStore } from '@/store/playerStore';
import { isPlayableUrl } from '@/lib/audio';
import AutoCover from '@/components/AutoCover';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';

export default function RecommendationTester() {
  const [timeSlot, setTimeSlot] = useState('');
  const [situation, setSituation] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [mood, setMood] = useState('');
  const [results, setResults] = useState<RecommendedTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const setQueue = usePlayerStore((s) => s.setQueue);

  async function run() {
    setLoading(true);
    try {
      const rows = await recommendTracksByContext({
        time_slot: timeSlot || null,
        situation: situation || null,
        business_type: businessType || null,
        mood: mood || null,
        limit: 20,
      });
      setResults(rows);
      if (rows.length === 0) {
        toast.info('조건에 맞는 곡이 없어요. 메타데이터가 입력된 트랙이 있는지 확인하세요.');
      }
    } catch (e) {
      toast.error(friendlyError(e, '추천 실패'));
    } finally {
      setLoading(false);
    }
  }

  function play(idx: number) {
    if (results.length === 0) return;
    const playable = results.filter((t) => isPlayableUrl(t.audio_url));
    if (playable.length === 0) {
      toast.info('재생 가능한 음원이 없어요.');
      return;
    }
    const start = isPlayableUrl(results[idx].audio_url)
      ? idx
      : results.findIndex((t) => isPlayableUrl(t.audio_url));
    setQueue(results, Math.max(0, start), null);
  }

  return (
    <section className="space-y-4 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="text-accent" />
        <h3 className="text-sm font-bold tracking-tight">추천 테스트</h3>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select label="시간대" value={timeSlot} onChange={setTimeSlot} options={TIME_SLOT_TAGS} labels={TIME_SLOT_TAG_LABELS} />
        <Select label="상황" value={situation} onChange={setSituation} options={SITUATION_TAGS} labels={SITUATION_TAG_LABELS} />
        <Select label="업종" value={businessType} onChange={setBusinessType} options={BUSINESS_TAGS} labels={BUSINESS_TAG_LABELS} />
        <Select label="무드" value={mood} onChange={setMood} options={MOOD_TAGS} labels={MOOD_TAG_LABELS} />
      </div>

      <button onClick={run} disabled={loading} className="btn-primary">
        <Sparkles size={14} />
        {loading ? '계산 중…' : '추천 테스트 실행'}
      </button>

      {results.length > 0 && (
        <ul className="overflow-hidden rounded-xl bg-bg-soft ring-1 ring-line/10">
          {results.map((t, i) => (
            <li key={t.id} className="border-b border-line/10 last:border-b-0">
              <div className="flex items-center gap-3 p-3">
                <button
                  onClick={() => play(i)}
                  className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg ring-1 ring-line/10"
                  title="재생"
                >
                  <AutoCover title={t.title} category={t.genre} imageUrl={t.cover_url} size="sm" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition hover:opacity-100">
                    <Play size={14} fill="currentColor" className="text-white" />
                  </div>
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {t.title}
                    <span className="ml-2 text-[10px] text-ink-dim">{t.artist ?? '—'}</span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-ink-mute">
                    {t.score_reasons.length > 0
                      ? t.score_reasons.map((r, j) => (
                          <span key={j} className="rounded bg-bg-card px-1.5 py-0.5">{r}</span>
                        ))
                      : <span className="text-ink-dim">이유 없음</span>}
                  </p>
                </div>
                <div className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent">
                  {t.score}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Select({
  label, value, onChange, options, labels,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  labels: Record<string, string>;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input text-xs">
        <option value="">— 없음 —</option>
        {options.map((o) => (
          <option key={o} value={o}>{labels[o] ?? o}</option>
        ))}
      </select>
    </label>
  );
}
