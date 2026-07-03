import { User, Store, Mic2, Building2, MapPin, Sparkles } from 'lucide-react';

export type AccountType =
  | 'individual'
  | 'business'
  | 'artist'
  | 'enterprise-hq'
  | 'enterprise-brand'
  | 'enterprise-store';

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
  // Phase 1-6 — 본사가 사전 발급한 초대코드로 셀프 가입
  {
    key: 'enterprise-hq',
    icon: <Building2 size={18} />,
    title: '엔터프라이즈 본사 담당자',
    desc: '본사 초대코드로 가입 · 본사 대시보드 접근',
  },
  // Phase 3-2 — Brand Registry 자동 매칭 가입
  {
    key: 'enterprise-brand',
    icon: <Sparkles size={18} />,
    title: '브랜드 자동 매칭 (본사)',
    desc: '브랜드명+코드로 자동 매칭 가입 · 계약 자동 생성 · 관리자 승인 후 활성',
  },
  {
    key: 'enterprise-store',
    icon: <MapPin size={18} />,
    title: '엔터프라이즈 매장',
    desc: '매장 초대코드로 가입 · 본사 정책 자동 적용',
  },
];

export default function SignupTypeSelector({ value, onSelect }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
