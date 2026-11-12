/**
 * RecurrenceRuleBuilder — 안내방송 예약 규칙 UI.
 *
 * 한 번 / 매일 / 매주 + 재생 시간 여러 개 + 시간 반복(구간 N분마다)을 위젯으로 고르면
 * `recurrence_rule` 문자열로 만들어 onChange 로 넘긴다.
 * 문법·검증은 `@/lib/announcementRecurrence` (서버 0549 해석기와 동일).
 */
import { useEffect, useMemo, useState } from 'react';
import { Calendar, Clock, Repeat, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import {
  DOW_KO, DOW_ORDER, MIN_INTERVAL_MIN, buildRule, describeRule, parseRule, previewSlots, validateRule,
  type DowToken, type ParsedRule, type TimeItem,
} from '@/lib/announcementRecurrence';

export type RecurrenceMode = 'once' | 'daily' | 'weekly';
export type { DowToken };

export interface RecurrenceRuleBuilderProps {
  /** 현재 저장된 recurrence_rule (수정 시 reverse-parse 됨) */
  value: string | null;
  onChange: (rule: string | null) => void;
  /** once 모드에서 default 로 사용할 datetime-local (보통 startsAt) */
  defaultOnceDt?: string;
  /** disabled (read-only) */
  disabled?: boolean;
}

interface State {
  mode: RecurrenceMode;
  dows: DowToken[];
  items: TimeItem[];
  onceDt: string;
}

const DEFAULT_ITEM: TimeItem = { kind: 'at', time: '12:00' };
const DEFAULT_EVERY: TimeItem = { kind: 'every', from: '10:00', to: '22:00', stepMin: 60 };
const STEP_OPTIONS = [15, 20, 30, 45, 60, 90, 120, 180, 240];

function toState(raw: string | null, defaultOnceDt: string): State {
  const empty: State = { mode: 'daily', dows: [], items: [DEFAULT_ITEM], onceDt: defaultOnceDt };
  const p = parseRule(raw);
  if (!p) return empty;
  if (p.mode === 'once') return { ...empty, mode: 'once', onceDt: p.onceDt };
  if (p.mode === 'daily') return { ...empty, items: p.items };
  return { ...empty, mode: 'weekly', dows: p.dows, items: p.items };
}

function toParsed(s: State): ParsedRule {
  if (s.mode === 'once') return { mode: 'once', onceDt: s.onceDt };
  if (s.mode === 'daily') return { mode: 'daily', items: s.items };
  return { mode: 'weekly', dows: s.dows, items: s.items };
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINS  = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

function stepText(min: number): string {
  if (min % 60 === 0) return `${min / 60}시간`;
  if (min > 60) return `${Math.floor(min / 60)}시간 ${min % 60}분`;
  return `${min}분`;
}

export default function RecurrenceRuleBuilder({
  value, onChange, defaultOnceDt = '', disabled = false,
}: RecurrenceRuleBuilderProps) {
  const [state, setState] = useState<State>(() => toState(value, defaultOnceDt));
  const [showAdvanced, setShowAdvanced] = useState(false);

  const parsed = useMemo(() => toParsed(state), [state]);
  const problem = useMemo(() => validateRule(parsed), [parsed]);
  const built = useMemo(() => buildRule(parsed), [parsed]);

  // 부모가 외부에서 value 를 바꾸면 (예: 다른 일정 편집) 다시 읽는다.
  // 우리가 방금 만든 값이 되돌아온 경우는 무시 — 입력 중인 행이 사라지지 않게.
  useEffect(() => {
    if (value !== built) setState(toState(value, defaultOnceDt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (built !== value) onChange(built);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built]);

  const setMode = (mode: RecurrenceMode) => setState((s) => ({ ...s, mode }));
  const setOnce = (dt: string) => setState((s) => ({ ...s, onceDt: dt }));
  const toggleDow = (d: DowToken) => setState((s) => ({
    ...s, dows: s.dows.includes(d) ? s.dows.filter((x) => x !== d) : [...s.dows, d],
  }));
  const updateItem = (i: number, next: TimeItem) =>
    setState((s) => ({ ...s, items: s.items.map((it, j) => (j === i ? next : it)) }));
  const removeItem = (i: number) => setState((s) => ({ ...s, items: s.items.filter((_, j) => j !== i) }));
  const addItem = (it: TimeItem) => setState((s) => ({ ...s, items: [...s.items, it] }));

  const slots = state.mode === 'once' ? null : previewSlots(state.items);

  return (
    <div className="space-y-3 rounded-xl bg-bg-deep/30 p-3 ring-1 ring-line/10">
      {/* Mode chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-ink-dim mr-1">반복 방식:</span>
        <ModeChip active={state.mode === 'once'}   onClick={() => setMode('once')}   icon={<Calendar size={11} />} label="한 번만" disabled={disabled} />
        <ModeChip active={state.mode === 'daily'}  onClick={() => setMode('daily')}  icon={<Repeat size={11} />}   label="매일"    disabled={disabled} />
        <ModeChip active={state.mode === 'weekly'} onClick={() => setMode('weekly')} icon={<Repeat size={11} />}   label="매주"    disabled={disabled} />
      </div>

      {state.mode === 'once' && (
        <div className="space-y-1 text-xs">
          <label className="block">
            <span className="text-ink-dim">실행 일시 *</span>
            <input type="datetime-local" value={state.onceDt}
              onChange={(e) => setOnce(e.target.value)} disabled={disabled}
              className="mt-0.5 w-full rounded-md bg-bg-deep px-2 py-1.5" />
          </label>
        </div>
      )}

      {state.mode === 'weekly' && (
        <div className="space-y-2 text-xs">
          <span className="text-ink-dim">재생 요일 * (1개 이상)</span>
          <div className="flex flex-wrap gap-1.5">
            {DOW_ORDER.map((d) => {
              const sel = state.dows.includes(d);
              return (
                <button key={d} type="button"
                  onClick={() => toggleDow(d)} disabled={disabled}
                  className={`inline-flex h-8 w-10 items-center justify-center rounded-md text-[12px] font-bold transition-colors ${
                    sel
                      ? 'bg-violet-600 text-white ring-1 ring-violet-400'
                      : 'bg-bg-deep text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover'
                  } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  {DOW_KO[d]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 재생 시간 — 여러 개 + 시간 반복 구간 */}
      {state.mode !== 'once' && (
        <div className="space-y-2 text-xs">
          <span className="text-ink-dim">재생 시간 * (여러 개 넣을 수 있어요)</span>
          {state.items.map((it, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1 rounded-lg bg-bg-card px-2 py-1.5 ring-1 ring-line/10">
              {it.kind === 'at' ? (
                <>
                  <Clock size={12} className="text-ink-dim" />
                  <TimeSelect value={it.time} onChange={(t) => updateItem(i, { ...it, time: t })} disabled={disabled} />
                  <span className="text-ink-mute">에 1회</span>
                </>
              ) : (
                <>
                  <Repeat size={12} className="text-ink-dim" />
                  <TimeSelect value={it.from} onChange={(t) => updateItem(i, { ...it, from: t })} disabled={disabled} />
                  <span className="text-ink-mute">부터</span>
                  <TimeSelect value={it.to} onChange={(t) => updateItem(i, { ...it, to: t })} disabled={disabled} />
                  <span className="text-ink-mute">까지</span>
                  <select value={it.stepMin} disabled={disabled} aria-label="반복 간격"
                    onChange={(e) => updateItem(i, { ...it, stepMin: Number(e.target.value) })}
                    className="rounded-md bg-bg-soft px-2 py-1.5 text-ink">
                    {(STEP_OPTIONS.includes(it.stepMin) ? STEP_OPTIONS : [...STEP_OPTIONS, it.stepMin].sort((a, b) => a - b))
                      .map((m) => <option key={m} value={m}>{stepText(m)}</option>)}
                  </select>
                  <span className="text-ink-mute">마다</span>
                </>
              )}
              {state.items.length > 1 && (
                <button type="button" onClick={() => removeItem(i)} disabled={disabled}
                  aria-label="이 시간 빼기"
                  className="ml-auto rounded-md p-1 text-ink-mute hover:bg-bg-hover hover:text-rose-300">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => addItem(DEFAULT_ITEM)} disabled={disabled}
              className="inline-flex items-center gap-1 rounded-md bg-bg-deep px-2 py-1 text-[11px] font-semibold text-ink-mute ring-1 ring-line/10 hover:text-ink">
              <Plus size={11} /> 시간 추가
            </button>
            <button type="button" onClick={() => addItem(DEFAULT_EVERY)} disabled={disabled}
              className="inline-flex items-center gap-1 rounded-md bg-bg-deep px-2 py-1 text-[11px] font-semibold text-ink-mute ring-1 ring-line/10 hover:text-ink">
              <Repeat size={11} /> 시간 반복 추가
            </button>
          </div>
          <p className="text-[10px] text-ink-dim">
            시간 반복: 정한 구간 안에서 일정 간격으로 계속 재생해요 (최소 {MIN_INTERVAL_MIN}분 간격).
          </p>
        </div>
      )}

      {/* Preview */}
      <div className="rounded-md bg-bg-card p-2 ring-1 ring-violet-400/30">
        <div className="text-[10px] uppercase tracking-wider text-ink-dim">미리보기</div>
        <div className={`mt-0.5 text-xs font-semibold ${problem ? 'text-amber-300' : 'text-ink'}`}>
          {problem ?? (built ? `${describeRule(built)} 에 재생` : '')}
        </div>
        {!problem && slots && slots.total > 1 && (
          <div className="mt-1 font-mono text-[10px] text-ink-mute">
            {slots.times.join(' · ')}{slots.total > slots.times.length ? ` … 외 ${slots.total - slots.times.length}회` : ''}
          </div>
        )}
        <div className="mt-1 text-[10px] text-ink-mute">
          선택한 시간은 매장 local time (Asia/Seoul) 기준으로 적용됩니다.
        </div>
      </div>

      {/* Advanced — raw rule */}
      <div className="text-[10px]">
        <button type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="inline-flex items-center gap-1 text-ink-mute hover:text-ink">
          {showAdvanced ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          고급: 저장 규칙 보기
        </button>
        {showAdvanced && (
          <div className="mt-1 break-all rounded bg-bg-card px-2 py-1 font-mono text-[11px] text-ink-mute">
            {built ?? '(invalid — 저장 불가)'}
          </div>
        )}
      </div>
    </div>
  );
}

function TimeSelect({ value, onChange, disabled }: { value: string; onChange: (t: string) => void; disabled?: boolean }) {
  const [hh, mm] = value.split(':');
  return (
    <span className="inline-flex items-center gap-0.5">
      <select value={hh} onChange={(e) => onChange(`${e.target.value}:${mm}`)} disabled={disabled} aria-label="시"
        className="rounded-md bg-bg-soft px-1.5 py-1.5 font-mono text-ink">
        {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span className="text-ink-mute">:</span>
      <select value={mm} onChange={(e) => onChange(`${hh}:${e.target.value}`)} disabled={disabled} aria-label="분"
        className="rounded-md bg-bg-soft px-1.5 py-1.5 font-mono text-ink">
        {MINS.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
    </span>
  );
}

function ModeChip({ active, onClick, icon, label, disabled }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold transition-colors ${
        active ? 'bg-violet-600 text-white ring-1 ring-violet-400' : 'bg-bg-deep text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      {icon}{label}
    </button>
  );
}
