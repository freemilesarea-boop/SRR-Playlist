/**
 * RecurrenceRuleBuilder — Announcement Scheduler 반복 규칙 UI.
 *
 * 사용자는 한 번/매일/매주 + 시간/요일/일시 를 위젯으로 선택.
 * 내부에서 `recurrence_rule` 문자열로 변환 → onChange 로 부모에 전달.
 * 기존 DB / RPC / parser 무수정 — 0381 의 `_announcement_is_due_now` 가
 * 지원하는 포맷만 생성:
 *   - once:YYYY-MM-DDTHH:MM
 *   - daily:HH:MM
 *   - weekly:DOW1,DOW2,...:HH:MM   (DOW = SUN|MON|TUE|WED|THU|FRI|SAT)
 *
 * NOTE: parser 가 monthly / seconds 미지원이므로 UI 에 노출하지 않음 (V2 예정).
 */
import { useEffect, useMemo, useState } from 'react';
import { Calendar, Clock, Repeat, ChevronDown, ChevronRight } from 'lucide-react';

export type RecurrenceMode = 'once' | 'daily' | 'weekly';
export type DowToken = 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT';

const DOW_LABEL: Record<DowToken, string> = {
  MON: '월', TUE: '화', WED: '수', THU: '목', FRI: '금', SAT: '토', SUN: '일',
};
// 월요일 기준 정렬 (KO 관습)
const DOW_ORDER: DowToken[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export interface RecurrenceRuleBuilderProps {
  /** 현재 저장된 recurrence_rule (수정 시 reverse-parse 됨) */
  value: string | null;
  onChange: (rule: string | null) => void;
  /** once 모드에서 default 로 사용할 datetime-local (보통 startsAt) */
  defaultOnceDt?: string;
  /** disabled (read-only) */
  disabled?: boolean;
}

interface ParsedState {
  mode: RecurrenceMode;
  hh: string;          // '00' ~ '23'
  mm: string;          // '00' ~ '59'
  dows: Set<DowToken>; // weekly only
  onceDt: string;      // datetime-local 'YYYY-MM-DDTHH:MM'
}

function parseRule(raw: string | null, defaultOnceDt = ''): ParsedState {
  const empty: ParsedState = {
    mode: 'daily', hh: '12', mm: '00', dows: new Set<DowToken>(),
    onceDt: defaultOnceDt,
  };
  if (!raw) return empty;
  const trimmed = raw.trim();

  // once:YYYY-MM-DDTHH:MM
  if (trimmed.startsWith('once:')) {
    const body = trimmed.slice('once:'.length);
    // body = YYYY-MM-DDTHH:MM (datetime-local 형식 그대로)
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(body);
    if (m) {
      return { ...empty, mode: 'once', hh: m[2], mm: m[3], onceDt: `${m[1]}T${m[2]}:${m[3]}` };
    }
    return { ...empty, mode: 'once' };
  }

  // daily:HH:MM
  const dailyM = /^daily:(\d{1,2}):(\d{1,2})$/.exec(trimmed);
  if (dailyM) {
    return { ...empty, mode: 'daily', hh: dailyM[1].padStart(2, '0'), mm: dailyM[2].padStart(2, '0') };
  }

  // weekly:DOW1,DOW2,...:HH:MM
  const weeklyM = /^weekly:([A-Z,]+):(\d{1,2}):(\d{1,2})$/i.exec(trimmed);
  if (weeklyM) {
    const dows = new Set<DowToken>();
    weeklyM[1].split(',').map((s) => s.trim().toUpperCase()).forEach((tok) => {
      if (['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].includes(tok)) {
        dows.add(tok as DowToken);
      }
    });
    return { ...empty, mode: 'weekly', dows, hh: weeklyM[2].padStart(2, '0'), mm: weeklyM[3].padStart(2, '0') };
  }

  return empty;
}

function buildRule(state: ParsedState): string | null {
  const time = `${state.hh.padStart(2, '0')}:${state.mm.padStart(2, '0')}`;
  if (state.mode === 'daily') return `daily:${time}`;
  if (state.mode === 'weekly') {
    if (state.dows.size === 0) return null;
    // 일정한 순서로 직렬화 (parser 는 순서 무관)
    const dows = DOW_ORDER.filter((d) => state.dows.has(d)).join(',');
    return `weekly:${dows}:${time}`;
  }
  if (state.mode === 'once') {
    if (!state.onceDt) return null;
    // datetime-local 은 'YYYY-MM-DDTHH:MM' — parser 가 요구하는 그대로
    return `once:${state.onceDt}`;
  }
  return null;
}

function previewLabel(state: ParsedState): string {
  const time = `${state.hh.padStart(2, '0')}:${state.mm.padStart(2, '0')}`;
  if (state.mode === 'daily') return `매일 ${time} 에 재생`;
  if (state.mode === 'weekly') {
    if (state.dows.size === 0) return '재생 요일을 1개 이상 선택해 주세요.';
    const labels = DOW_ORDER.filter((d) => state.dows.has(d)).map((d) => DOW_LABEL[d]).join(', ');
    return `매주 ${labels} ${time} 에 재생`;
  }
  if (state.mode === 'once') {
    if (!state.onceDt) return '실행 일시를 선택해 주세요.';
    try {
      const dt = new Date(state.onceDt);
      return `${dt.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 에 1회 재생`;
    } catch { return state.onceDt; }
  }
  return '';
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINS  = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

export default function RecurrenceRuleBuilder({
  value, onChange, defaultOnceDt = '', disabled = false,
}: RecurrenceRuleBuilderProps) {
  const [state, setState] = useState<ParsedState>(() => parseRule(value, defaultOnceDt));
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 부모가 외부에서 value 를 갱신하면 (예: 다른 schedule 편집) reset
  useEffect(() => {
    setState(parseRule(value, defaultOnceDt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const built = useMemo(() => buildRule(state), [state]);

  useEffect(() => {
    // 사용자가 위젯을 조작했을 때만 부모에 통보 (built 가 변경되면)
    if (built !== value) {
      onChange(built);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built]);

  const setMode  = (mode: RecurrenceMode) => setState((s) => ({ ...s, mode }));
  const setHH    = (hh: string)           => setState((s) => ({ ...s, hh }));
  const setMM    = (mm: string)           => setState((s) => ({ ...s, mm }));
  const setOnce  = (dt: string)           => setState((s) => ({ ...s, onceDt: dt }));
  const toggleDow = (d: DowToken)          => setState((s) => {
    const next = new Set(s.dows);
    if (next.has(d)) next.delete(d); else next.add(d);
    return { ...s, dows: next };
  });

  const preview = previewLabel(state);
  const invalid =
    (state.mode === 'weekly' && state.dows.size === 0) ||
    (state.mode === 'once' && !state.onceDt);

  return (
    <div className="space-y-3 rounded-xl bg-bg-deep/30 p-3 ring-1 ring-line/10">
      {/* Mode chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-ink-dim mr-1">반복 방식:</span>
        <ModeChip active={state.mode === 'once'}   onClick={() => setMode('once')}   icon={<Calendar size={11} />} label="한 번만" disabled={disabled} />
        <ModeChip active={state.mode === 'daily'}  onClick={() => setMode('daily')}  icon={<Repeat size={11} />}   label="매일"    disabled={disabled} />
        <ModeChip active={state.mode === 'weekly'} onClick={() => setMode('weekly')} icon={<Repeat size={11} />}   label="매주"    disabled={disabled} />
        <span
          className="ml-2 inline-flex items-center gap-1 rounded-md bg-bg-deep px-2 py-1 text-[10px] text-ink-dim"
          title="V1 한정 — Announcement Scheduler 의 parser 가 monthly 를 지원하지 않습니다. 곧 지원 예정."
        >
          매월 (곧 지원)
        </span>
      </div>

      {/* Mode-specific controls */}
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
              const sel = state.dows.has(d);
              return (
                <button key={d} type="button"
                  onClick={() => toggleDow(d)} disabled={disabled}
                  className={`inline-flex h-8 w-10 items-center justify-center rounded-md text-[12px] font-bold transition-colors ${
                    sel
                      ? 'bg-violet-600 text-white ring-1 ring-violet-400'
                      : 'bg-bg-deep text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover'
                  } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  {DOW_LABEL[d]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Time picker (always shown except once which uses datetime-local) */}
      {(state.mode === 'daily' || state.mode === 'weekly') && (
        <div className="text-xs">
          <span className="text-ink-dim">재생 시간 *</span>
          <div className="mt-0.5 flex items-center gap-1">
            <Clock size={12} className="text-ink-dim" />
            <select value={state.hh} onChange={(e) => setHH(e.target.value)} disabled={disabled}
              className="rounded-md bg-bg-deep px-2 py-1.5 font-mono">
              {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
            <span className="text-ink-mute">시</span>
            <select value={state.mm} onChange={(e) => setMM(e.target.value)} disabled={disabled}
              className="rounded-md bg-bg-deep px-2 py-1.5 font-mono">
              {MINS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <span className="text-ink-mute">분</span>
            <span className="ml-2 text-[10px] text-ink-dim">초 단위 미지원 (HH:MM)</span>
          </div>
        </div>
      )}

      {/* Preview */}
      <div className="rounded-md bg-bg-card p-2 ring-1 ring-violet-400/30">
        <div className="text-[10px] uppercase tracking-wider text-ink-dim">미리보기</div>
        <div className={`mt-0.5 text-xs font-semibold ${invalid ? 'text-amber-300' : 'text-ink'}`}>
          {preview}
        </div>
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
          <div className="mt-1 rounded bg-bg-card px-2 py-1 font-mono text-[11px] text-ink-mute">
            {built ?? '(invalid — 저장 불가)'}
          </div>
        )}
      </div>
    </div>
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
