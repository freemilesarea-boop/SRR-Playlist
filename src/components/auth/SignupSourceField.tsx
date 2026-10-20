import { SIGNUP_SOURCES, type SignupSourceValue } from '@/lib/signupSource';

interface Props {
  value: SignupSourceValue;
  onChange: (v: SignupSourceValue) => void;
  disabled?: boolean;
}

/** "어디서 알게 되셨나요?" — 칩 하나 선택, "기타" 면 직접 입력. */
export default function SignupSourceField({ value, onChange, disabled }: Props) {
  return (
    <div className="space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-mute">
        어디서 알게 되셨나요? *
      </span>
      <div role="radiogroup" aria-label="알게 된 경로" className="flex flex-wrap gap-1.5">
        {SIGNUP_SOURCES.map((s) => {
          const selected = value.source === s.key;
          return (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange({ source: s.key, detail: s.key === 'other' ? value.detail : '' })}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                selected
                  ? 'bg-accent/15 text-accent ring-1 ring-accent/40'
                  : 'bg-bg-soft text-ink-mute ring-1 ring-line/10 hover:text-ink'
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      {value.source === 'other' && (
        <input
          type="text"
          value={value.detail}
          onChange={(e) => onChange({ ...value, detail: e.target.value })}
          disabled={disabled}
          maxLength={200}
          placeholder="어디서 알게 되셨는지 알려주세요"
          aria-label="알게 된 경로 직접 입력"
          className="input"
        />
      )}
    </div>
  );
}
