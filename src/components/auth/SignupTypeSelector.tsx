import { User, Store } from 'lucide-react';

export type AccountType = 'individual' | 'business';

interface Props {
  value: AccountType | null;
  onSelect: (type: AccountType) => void;
}

export default function SignupTypeSelector({ value, onSelect }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <button
        type="button"
        onClick={() => onSelect('individual')}
        className={`flex flex-col items-start gap-2 rounded-2xl border-2 p-4 text-left transition ${
          value === 'individual'
            ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
            : 'border-line/15 hover:border-line/30 hover:bg-ink/5'
        }`}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent">
          <User size={18} />
        </span>
        <h3 className="text-sm font-bold">일반 회원</h3>
        <p className="text-[11px] leading-relaxed text-ink-mute">
          음악 감상 · 보관함 · 큐레이션 활용
        </p>
      </button>

      <button
        type="button"
        onClick={() => onSelect('business')}
        className={`flex flex-col items-start gap-2 rounded-2xl border-2 p-4 text-left transition ${
          value === 'business'
            ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
            : 'border-line/15 hover:border-line/30 hover:bg-ink/5'
        }`}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Store size={18} />
        </span>
        <h3 className="text-sm font-bold">사업자 회원</h3>
        <p className="text-[11px] leading-relaxed text-ink-mute">
          매장 BGM · 스케줄러 · 사업자 검증 필요
        </p>
      </button>
    </div>
  );
}
