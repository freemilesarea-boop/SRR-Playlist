/**
 * MultiOutputSection — 내 정보 > 분리 송출.
 *
 * 켜면 플레이어를 최대 3개 쓸 수 있다. 플레이어마다 브랜드/매장을 고르고, [창 열기] 로
 * 띄운 창 위에서 출력 장치(스피커)를 고르면 그 공간으로만 나간다.
 * 매장 플레이어의 음악(내 스케줄 / 업종 카테고리)과 안내방송 송출 플레이어는 점주가 직접 고른다.
 */
import { useEffect, useMemo, useState } from 'react';
import { Speaker, ExternalLink, Megaphone, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { getSavedBrandPlayerPath } from '@/lib/brandSession';
import { openOutputSlotWindow, type OutputSlot } from '@/lib/outputSlot';
import {
  DEFAULT_MULTI_OUTPUT_CONFIG, SLOT_MODE_LABEL, fetchStoreCategories, normalizeMultiOutputConfig,
  saveMultiOutput, validateMultiOutputConfig,
  type MultiOutputConfig, type SlotConfig, type SlotMode,
} from '@/lib/multiOutput';

const MODES: SlotMode[] = ['off', 'brand', 'store'];

function sinkSupported(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

export default function MultiOutputSection() {
  const profile = useAuthStore((s) => s.profile);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);

  const savedEnabled = !!profile?.multi_output_enabled;
  const rawConfig = profile?.multi_output_config;
  const savedConfig = useMemo(
    () => (rawConfig ? normalizeMultiOutputConfig(rawConfig) : null),
    [rawConfig],
  );

  const [draft, setDraft] = useState<MultiOutputConfig>(savedConfig ?? DEFAULT_MULTI_OUTPUT_CONFIG);
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState<string[] | null>(null);

  useEffect(() => { if (savedConfig) setDraft(savedConfig); }, [savedConfig]);

  useEffect(() => {
    if (!savedEnabled || categories) return;
    fetchStoreCategories().then(setCategories).catch(() => setCategories([]));
  }, [savedEnabled, categories]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(savedConfig ?? DEFAULT_MULTI_OUTPUT_CONFIG);
  const problem = validateMultiOutputConfig(draft);
  const activeSlots = draft.slots.filter((s) => s.mode !== 'off');

  async function persist(enabled: boolean, config: MultiOutputConfig) {
    setBusy(true);
    try {
      await saveMultiOutput(enabled, config);
      await refreshProfile();
      toast.success(enabled ? '분리 송출 설정을 저장했어요.' : '분리 송출을 껐어요.');
    } catch (e) {
      toast.error(friendlyError(e, '저장에 실패했어요'));
    } finally {
      setBusy(false);
    }
  }

  function updateSlot(slot: OutputSlot, patch: Partial<SlotConfig>) {
    setDraft((d) => {
      const slots = d.slots.map((s): SlotConfig => {
        if (s.slot !== slot) return s;
        const next: SlotConfig = { ...s, ...patch };
        if (next.mode !== 'store') return { slot, mode: next.mode };
        const source = next.source ?? 'schedule';
        return source === 'category' ? { slot, mode: 'store', source, category: next.category } : { slot, mode: 'store', source };
      });
      const active = slots.filter((s) => s.mode !== 'off').map((s) => s.slot);
      const announcement_slot = active.includes(d.announcement_slot) ? d.announcement_slot : (active[0] ?? 1);
      return { slots, announcement_slot };
    });
  }

  function openSlot(s: SlotConfig) {
    if (s.mode === 'brand') openOutputSlotWindow(getSavedBrandPlayerPath() ?? '/brand', s.slot);
    else if (s.mode === 'store') openOutputSlotWindow('/business/player', s.slot);
  }

  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between px-1">
        <h2 className="text-sm font-bold tracking-tight">분리 송출</h2>
        <p className="text-[11px] text-ink-mute">공간별로 다른 음악</p>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => void persist(!savedEnabled, savedConfig ?? draft)}
        className="flex w-full items-center justify-between rounded-2xl bg-bg-card p-3 ring-1 ring-line/10 hover:bg-bg-hover disabled:opacity-60"
      >
        <div className="flex items-start gap-2.5 text-left">
          <Speaker size={18} className="mt-0.5 shrink-0 text-accent" />
          <div>
            <p className="text-sm font-semibold">분리 송출 사용</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-mute">
              플레이어를 최대 3개 띄워 홀·룸처럼 공간마다 다른 스피커로 다른 음악을 틀어요.
            </p>
          </div>
        </div>
        <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${savedEnabled ? 'bg-accent' : 'bg-bg-hover'}`}>
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${savedEnabled ? 'left-5' : 'left-0.5'}`} />
        </span>
      </button>

      {savedEnabled && (
        <div className="space-y-3 rounded-2xl bg-bg-card p-3 ring-1 ring-line/10">
          {!sinkSupported() && (
            <p className="flex items-start gap-1.5 rounded-xl bg-amber-500/10 p-2.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              이 브라우저는 창마다 스피커를 나눌 수 없어요. 매장 PC 의 크롬·엣지에서 사용해 주세요.
            </p>
          )}

          {draft.slots.map((s) => (
            <SlotCard
              key={s.slot}
              config={s}
              categories={categories}
              canOpen={!dirty && s.mode !== 'off'}
              onChange={(patch) => updateSlot(s.slot, patch)}
              onOpen={() => openSlot(s)}
            />
          ))}

          <div className="space-y-1.5 rounded-xl bg-bg-soft p-2.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <Megaphone size={14} className="text-accent" /> 안내·긴급방송 송출 플레이어
            </p>
            <div className="flex flex-wrap gap-1.5">
              {activeSlots.map((s) => (
                <button
                  key={s.slot}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, announcement_slot: s.slot }))}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    draft.announcement_slot === s.slot ? 'bg-accent text-bg' : 'bg-bg-card text-ink-mute hover:text-ink'
                  }`}
                >
                  {s.slot}번 · {SLOT_MODE_LABEL[s.mode]}
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-ink-mute">
              고른 플레이어 창의 스피커로 한 번만 나가요. 다른 창에서는 나가지 않아요.
            </p>
          </div>

          {problem && <p className="px-1 text-[11px] text-red-500">{problem}</p>}

          <button
            type="button"
            disabled={busy || !dirty || !!problem}
            onClick={() => void persist(true, draft)}
            className="btn-primary w-full py-2.5 text-sm disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="mx-auto animate-spin" /> : dirty ? '설정 저장' : '저장됨'}
          </button>

          <ul className="space-y-1 px-1 text-[11px] leading-relaxed text-ink-mute">
            <li>· [창 열기] 로 띄운 창 맨 위에서 그 공간의 스피커를 고르세요. 이 PC 에 기억돼요.</li>
            <li>· 창은 최소화하지 말고 열어 두세요(겹쳐 두는 건 괜찮아요). 최소화하면 재생이 집계되지 않아요.</li>
            <li>· 브랜드 플레이어 창은 처음 한 번 브랜드 코드를 입력해야 해요.</li>
          </ul>
        </div>
      )}
    </section>
  );
}

function SlotCard({ config, categories, canOpen, onChange, onOpen }: {
  config: SlotConfig;
  categories: string[] | null;
  canOpen: boolean;
  onChange: (patch: Partial<SlotConfig>) => void;
  onOpen: () => void;
}) {
  return (
    <div className="space-y-2 rounded-xl bg-bg-soft p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold">{config.slot}번 플레이어</p>
        <button
          type="button"
          disabled={!canOpen}
          onClick={onOpen}
          title={canOpen ? '' : '설정을 저장한 뒤 열 수 있어요'}
          className="inline-flex items-center gap-1 rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/30 transition hover:bg-accent/20 disabled:opacity-40"
        >
          <ExternalLink size={12} /> 창 열기
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={`${config.slot}번 플레이어 종류`}>
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={config.mode === m}
            onClick={() => onChange({ mode: m })}
            className={`rounded-lg py-2 text-xs font-semibold transition ${
              config.mode === m ? 'bg-accent text-bg shadow' : 'bg-bg-card text-ink-mute hover:text-ink'
            }`}
          >
            {m === 'off' ? '사용 안 함' : m === 'brand' ? '브랜드' : '매장'}
          </button>
        ))}
      </div>

      {config.mode === 'store' && (
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            {(['schedule', 'category'] as const).map((src) => (
              <button
                key={src}
                type="button"
                onClick={() => onChange({ source: src })}
                className={`rounded-lg py-1.5 text-[11px] font-semibold transition ${
                  (config.source ?? 'schedule') === src ? 'bg-accent/20 text-accent ring-1 ring-accent/40' : 'bg-bg-card text-ink-mute hover:text-ink'
                }`}
              >
                {src === 'schedule' ? '내 자동 스케줄' : '업종 카테고리'}
              </button>
            ))}
          </div>
          {config.source === 'category' && (
            <select
              value={config.category ?? ''}
              onChange={(e) => onChange({ source: 'category', category: e.target.value || undefined })}
              aria-label={`${config.slot}번 플레이어 카테고리`}
              className="input w-full text-sm"
            >
              <option value="">카테고리 선택</option>
              {(categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <p className="text-[11px] leading-relaxed text-ink-mute">
            {config.source === 'category'
              ? '고른 업종의 매장 전용 플레이리스트를 섞어 틀어요.'
              : '사업자 모드의 자동 스케줄(시간대별 플레이리스트)대로 틀어요.'}
          </p>
        </div>
      )}
    </div>
  );
}
