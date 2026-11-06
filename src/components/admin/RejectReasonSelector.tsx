/**
 * RejectReasonSelector — X6.65 (Phase 3c).
 *
 * 거절/제거/일괄거절 모달에서 공통으로 사용하는 사유 입력 컴포넌트.
 * SQL `_normalize_decision_reason` (0332) 가 매핑하는 8개 표준 패턴을 dropdown 으로 강제,
 * 검수자별 표현 차이로 cluster 가 분산되던 문제 해소.
 *
 * 동작:
 *   - 표준 사유 dropdown (필수) + 보충 메모 textarea (선택)
 *   - 최종 reason 텍스트: dropdown label 단독 또는 `"{label}: {note}"`
 *   - 부모는 reason 문자열만 받음 (모달 UX 차이 흡수)
 */
import { useEffect, useState } from 'react';
import {
  listCanonicalRejectReasons,
  FALLBACK_CANONICAL_REJECT_REASONS,
  type CanonicalRejectReason,
} from '@/lib/aiCuration';
import { REVIEW_SYMPTOMS, composeReason, parseProblemTimes, formatSeconds, type ReviewDetail } from '@/lib/reviewSymptoms';

interface Props {
  /** 부모로 최종 reason 텍스트 전달 (dropdown + 메모 결합본). 빈 문자열 = 미선택. */
  onChange: (combinedReason: string) => void;
  disabled?: boolean;
  /** placeholder for the optional note textarea */
  notePlaceholder?: string;
  /** 보충 메모 표시 여부 (takedown 처럼 추가 설명이 필요한 경우) — default true. */
  showNote?: boolean;
  /** 메모 최소 글자수 (제거(takedown) 처럼 사유 무조건 5자 이상 필요한 경우). default 0. */
  minNoteLength?: number;
  /** 구조화 기록(0547) — 표준 사유 키 + 증상 + 문제 시점 + 메모. 미선택이면 null. */
  onDetail?: (detail: ReviewDetail | null) => void;
}

export default function RejectReasonSelector({
  onChange,
  disabled,
  notePlaceholder = '아티스트에게 전달될 보충 메모 (선택)',
  showNote = true,
  minNoteLength = 0,
  onDetail,
}: Props) {
  const [reasons, setReasons] = useState<CanonicalRejectReason[]>(FALLBACK_CANONICAL_REJECT_REASONS);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [note, setNote] = useState('');
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [times, setTimes] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fresh = await listCanonicalRejectReasons();
        if (!cancelled && fresh.length > 0) setReasons(fresh);
      } catch (e) {
        // fallback static list 유지 — 사유 입력 흐름 막지 않음
        console.warn('[RejectReasonSelector] canonical reasons fetch failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const selected = reasons.find((r) => r.reason_key === selectedKey);
    if (!selected) {
      onChange('');
      onDetail?.(null);
      return;
    }
    const seconds = parseProblemTimes(times);
    const sym = selected.reason_key === 'audio_quality_low' ? symptoms : [];
    onChange(composeReason(selected.label, sym, seconds, note));
    onDetail?.({ reasonKey: selected.reason_key, symptoms: sym, problemSeconds: seconds, note: note.trim() });
    // 의도적으로 onChange 는 deps 에 미포함 — 부모가 매 렌더마다 새 함수를 만들면 무한 루프 발생.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, note, reasons, symptoms, times]);

  const selected = reasons.find((r) => r.reason_key === selectedKey);
  const noteOk = !showNote || minNoteLength === 0 || note.trim().length >= minNoteLength;

  return (
    <div className="space-y-2">
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-ink-mute">표준 사유 (필수)</span>
        <select
          value={selectedKey}
          onChange={(e) => setSelectedKey(e.target.value)}
          disabled={disabled}
          className="input"
        >
          <option value="">— 선택해주세요 —</option>
          {reasons.map((r) => (
            <option key={r.reason_key} value={r.reason_key}>
              {r.label}
            </option>
          ))}
        </select>
        {selected?.description && (
          <span className="block text-[11px] text-ink-dim">{selected.description}</span>
        )}
      </label>

      {selectedKey === 'audio_quality_low' && (
        <div className="space-y-1">
          <span className="text-xs font-semibold text-ink-mute">들린 문제 (해당하는 것 모두)</span>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {REVIEW_SYMPTOMS.map((sym) => (
              <label key={sym.key} className="flex items-center gap-1.5 text-[12px]">
                <input
                  type="checkbox"
                  checked={symptoms.includes(sym.key)}
                  disabled={disabled}
                  onChange={() => setSymptoms(symptoms.includes(sym.key) ? symptoms.filter((x) => x !== sym.key) : [...symptoms, sym.key])}
                />
                {sym.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {selectedKey && (
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-ink-mute">문제가 들린 시점 (선택)</span>
          <input
            value={times}
            onChange={(e) => setTimes(e.target.value)}
            disabled={disabled}
            placeholder="예: 2:30, 3:10~3:40"
            className="input text-[12px]"
          />
          {parseProblemTimes(times).length > 0 && (
            <span className="block text-[11px] text-ink-dim">
              {parseProblemTimes(times).map(formatSeconds).join(' · ')} 로 기록돼요
            </span>
          )}
        </label>
      )}

      {showNote && (
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-ink-mute">
            보충 메모{minNoteLength > 0 ? ` (최소 ${minNoteLength}자)` : ' (선택)'}
          </span>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={disabled}
            placeholder={notePlaceholder}
            className="input text-[12px]"
          />
          {minNoteLength > 0 && !noteOk && note.length > 0 && (
            <span className="block text-[11px] text-rose-300 dark:text-rose-300">
              {minNoteLength - note.trim().length}자 더 필요해요
            </span>
          )}
        </label>
      )}
    </div>
  );
}
