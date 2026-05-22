import {
  GENRE_OPTIONS, MOOD_OPTIONS, BUSINESS_OPTIONS, VOCAL_OPTIONS, DAYPART_OPTIONS,
  META_CAPS, type Option, type SelectedMeta,
} from '@/lib/trackMetadataOptions';

/** pill 형태 다중 선택 (max 제한) */
function PillMulti({
  label, options, selected, max, onChange, disabled,
}: {
  label: string; options: Option[]; selected: string[]; max: number;
  onChange: (next: string[]) => void; disabled?: boolean;
}) {
  function toggle(v: string) {
    if (disabled) return;
    if (selected.includes(v)) onChange(selected.filter((x) => x !== v));
    else if (selected.length < max) onChange([...selected, v]);
  }
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
        {label} <span className="text-ink-mute">· 최대 {max}개 · {selected.length}/{max}</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o.value);
          const atMax = !on && selected.length >= max;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => toggle(o.value)}
              disabled={disabled || atMax}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                on ? 'bg-accent text-black' : 'bg-bg-soft text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover'
              } ${atMax ? 'opacity-40' : ''}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PillSingle({
  label, options, value, onChange, disabled,
}: {
  label: string; options: Option[]; value: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">{label} · 단일 선택</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => !disabled && onChange(o.value)}
            disabled={disabled}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              value === o.value ? 'bg-accent text-black' : 'bg-bg-soft text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 음원 메타데이터 선택형 입력 (장르/무드/매장/보컬/시간대). 직접 입력 대신 선택만. */
export default function TrackMetaSelectors({
  value, onChange, disabled,
}: {
  value: SelectedMeta;
  onChange: (next: SelectedMeta) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3 rounded-xl bg-bg-soft/40 p-3 ring-1 ring-line/10">
      <p className="text-xs font-semibold text-ink-mute">메타데이터 선택 (자동 플레이리스트 배치에 사용)</p>
      <PillMulti label="장르 *" options={GENRE_OPTIONS} selected={value.genre_tags} max={META_CAPS.genre}
        onChange={(v) => onChange({ ...value, genre_tags: v })} disabled={disabled} />
      <PillMulti label="분위기/무드 *" options={MOOD_OPTIONS} selected={value.mood_tags} max={META_CAPS.mood}
        onChange={(v) => onChange({ ...value, mood_tags: v })} disabled={disabled} />
      <PillMulti label="추천 매장/업종 *" options={BUSINESS_OPTIONS} selected={value.business_type_tags} max={META_CAPS.business}
        onChange={(v) => onChange({ ...value, business_type_tags: v })} disabled={disabled} />
      <PillSingle label="보컬 여부 *" options={VOCAL_OPTIONS} value={value.vocal_type}
        onChange={(v) => onChange({ ...value, vocal_type: v })} disabled={disabled} />
      <PillMulti label="추천 시간대 *" options={DAYPART_OPTIONS} selected={value.recommended_dayparts} max={META_CAPS.daypart}
        onChange={(v) => onChange({ ...value, recommended_dayparts: v })} disabled={disabled} />
    </div>
  );
}
