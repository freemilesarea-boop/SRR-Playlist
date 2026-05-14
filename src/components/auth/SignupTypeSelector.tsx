import { User, Store, Mic2 } from 'lucide-react';

export type AccountType = 'individual' | 'business' | 'artist';

interface Props {
  value: AccountType | null;
  onSelect: (type: AccountType) => void;
}

const TYPES: { key: AccountType; icon: React.ReactNode; title: string; desc: string }[] = [
  {
    key: 'individual',
    icon: <User size={18} />,
    title: '일반 회원',
    desc: '음악 감상 · 보관함 · 큐레이션 활용',
  },
  {
    key: 'business',
    icon: <Store size={18} />,
    title: '사업자 회원',
    desc: '매장 BGM · 스케줄러 · 사업자 검증 필요',
  },
  {
    key: 'artist',
    icon: <Mic2 size={18} />,
    title: '아티스트 회원',
    desc: '본인 음원 등록 · 관리자 승인 필요',
  },
];

export default function SignupTypeSelector({ value, onSelect }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {TYPES.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onSelect(t.key)}
          className={`flex flex-col items-start gap-2 rounded-2xl border-2 p-4 text-left transition ${
            value === t.key
              ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
              : 'border-line/15 hover:border-line/30 hover:bg-ink/5'
          }`}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent">
            {t.icon}
          </span>
          <h3 className="text-sm font-bold">{t.title}</h3>
          <p className="text-[11px] leading-relaxed text-ink-mute">{t.desc}</p>
        </button>
      ))}
    </div>
  );
}
