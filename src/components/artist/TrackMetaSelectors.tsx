import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search, Sparkles } from 'lucide-react';
import {
  GENRE_GROUPS, MOOD_OPTIONS, BUSINESS_OPTIONS, VOCAL_OPTIONS, DAYPART_OPTIONS, LANGUAGE_OPTIONS, TEMPO_OPTIONS,
  META_CAPS, type Option, type SelectedMeta,
} from '@/lib/trackMetadataOptions';
import { toast } from '@/store/toastStore';

/** pill 형태 다중 선택 (max 제한) */
function PillMulti({
  label, options, selected, max, onChange, disabled, overMessage,
}: {
  label: string; options: Option[]; selected: string[]; max: number;
  onChange: (next: string[]) => void; disabled?: boolean; overMessage?: string;
}) {
  function toggle(v: string) {
    if (disabled) return;
    if (selected.includes(v)) onChange(selected.filter((x) => x !== v));
    else if (selected.length < max) onChange([...selected, v]);
    else if (overMessage) toast.warning(overMessage);
  }
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
        {label} <span className={selected.length >= max ? 'text-accent' : 'text-ink-mute'}>· {selected.length}/{max}</span>
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
              disabled={disabled}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                on ? 'bg-accent text-black ring-1 ring-accent' : 'bg-bg-soft text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover'
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
  label, options, value, onChange, disabled, optional,
}: {
  label: string; options: Option[]; value: string; onChange: (v: string) => void; disabled?: boolean; optional?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
        {label} · {optional ? '선택' : '단일 선택'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => !disabled && onChange(value === o.value && optional ? '' : o.value)}
            disabled={disabled}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              value === o.value ? 'bg-accent text-black ring-1 ring-accent' : 'bg-bg-soft text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 장르: 그룹 collapse/expand + 검색 + 선택 개수. 장르 수가 많아 overflow 스크롤 처리. */
function GenrePicker({
  selected, max, onChange, disabled,
}: {
  selected: string[]; max: number; onChange: (next: string[]) => void; disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  function toggle(v: string) {
    if (disabled) return;
    if (selected.includes(v)) onChange(selected.filter((x) => x !== v));
    else if (selected.length < max) onChange([...selected, v]);
    else if (max === 1) onChange([v]); // 단일 선택: 기존 해제 후 교체
    else toast.warning('장르는 1개만 선택할 수 있습니다');
  }

  const groups = useMemo(
    () =>
      GENRE_GROUPS.map((g) => ({
        ...g,
        matches: searching ? g.genres.filter((x) => x.toLowerCase().includes(q)) : g.genres,
      })).filter((g) => g.matches.length > 0),
    [q, searching],
  );

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
        장르 * <span className={selected.length >= max ? 'text-accent' : 'text-ink-mute'}>· {selected.length}/{max}</span>
      </p>

      {/* 검색 */}
      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-dim" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="장르 검색 (예: phonk, jazz, anime)"
          disabled={disabled}
          className="w-full rounded-lg bg-bg-soft py-1.5 pl-8 pr-2 text-xs text-ink ring-1 ring-line/10 placeholder:text-ink-dim focus:outline-none focus:ring-accent/40"
        />
      </div>

      {/* 선택된 장르 요약 */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => toggle(v)}
              disabled={disabled}
              className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold text-black"
            >
              {v} ✕
            </button>
          ))}
        </div>
      )}

      {/* 그룹 목록 (모바일 overflow → 최대 높이 스크롤) */}
      <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg bg-bg-soft/40 p-1.5 ring-1 ring-line/10">
        {groups.map((g) => {
          const open = searching || openGroups[g.label];
          const selCount = g.matches.filter((x) => selected.includes(x)).length;
          return (
            <div key={g.label}>
              <button
                type="button"
                onClick={() => !searching && setOpenGroups((s) => ({ ...s, [g.label]: !s[g.label] }))}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-semibold text-ink hover:bg-bg-hover"
              >
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {g.label}
                {selCount > 0 && <span className="rounded-full bg-accent/20 px-1.5 text-[10px] font-bold text-accent">{selCount}</span>}
                <span className="ml-auto text-[10px] text-ink-dim">{g.matches.length}</span>
              </button>
              {open && (
                <div className="flex flex-wrap gap-1.5 px-2 pb-2 pt-1">
                  {g.matches.map((v) => {
                    const on = selected.includes(v);
                    const atMax = !on && selected.length >= max && max > 1;
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => toggle(v)}
                        disabled={disabled}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                          on ? 'bg-accent text-black ring-1 ring-accent' : 'bg-bg-card text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover'
                        } ${atMax ? 'opacity-40' : ''}`}
                      >
                        {v}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {groups.length === 0 && <p className="px-2 py-3 text-center text-xs text-ink-dim">검색 결과가 없어요</p>}
      </div>
    </div>
  );
}

/** 음원 메타데이터 선택형 입력 (장르/무드/매장/보컬/시간대/언어). */
export default function TrackMetaSelectors({
  value, onChange, disabled,
}: {
  value: SelectedMeta;
  onChange: (next: SelectedMeta) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3 rounded-xl bg-bg-soft/40 p-3 ring-1 ring-line/10">
      <div className="flex items-start gap-2 rounded-lg bg-accent/10 p-2.5 ring-1 ring-accent/15">
        <Sparkles size={14} className="mt-0.5 shrink-0 text-accent" />
        <p className="text-[11px] leading-relaxed text-ink-mute">
          <b className="text-ink">추천용 메타데이터</b>예요. 정확하게 선택할수록 유사곡 추천·매장 큐레이션·차트 노출 정확도가 올라갑니다.
          <br />노출을 위해 관련 없는 매장을 선택하면 관리자 검수에서 제외될 수 있습니다.
        </p>
      </div>

      <GenrePicker selected={value.genre_tags} max={META_CAPS.genre}
        onChange={(v) => onChange({ ...value, genre_tags: v })} disabled={disabled} />
      <PillMulti label="분위기/무드 *" options={MOOD_OPTIONS} selected={value.mood_tags} max={META_CAPS.mood}
        overMessage="분위기는 최대 2개까지 선택할 수 있습니다" onChange={(v) => onChange({ ...value, mood_tags: v })} disabled={disabled} />
      <PillSingle label="추천 매장/업종 *" options={BUSINESS_OPTIONS}
        value={value.business_type_tags[0] ?? ''}
        onChange={(v) => onChange({ ...value, business_type_tags: v ? [v] : [] })} disabled={disabled} />
      <PillSingle label="보컬 타입 *" options={VOCAL_OPTIONS} value={value.vocal_type}
        onChange={(v) => onChange({ ...value, vocal_type: v })} disabled={disabled} />
      <div className="space-y-1.5">
        <PillSingle label="체감 템포 *" options={TEMPO_OPTIONS} value={value.tempo_feel ?? ''}
          onChange={(v) => onChange({ ...value, tempo_feel: v })} disabled={disabled} />
        <p className="text-[10px] text-ink-dim">곡의 체감 템포를 선택해주세요. 실제 BPM과 다를 수 있으며, 큐레이션 참고값으로 사용됩니다.</p>
      </div>
      <PillSingle label="언어권" options={LANGUAGE_OPTIONS} value={value.language ?? ''} optional
        onChange={(v) => onChange({ ...value, language: v })} disabled={disabled} />
      <PillSingle label="추천 시간대 *" options={DAYPART_OPTIONS}
        value={value.recommended_dayparts[0] ?? ''}
        onChange={(v) => onChange({ ...value, recommended_dayparts: v ? [v] : [] })} disabled={disabled} />
    </div>
  );
}
