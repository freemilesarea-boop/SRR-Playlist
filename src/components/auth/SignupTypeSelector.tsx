import { User, Store, Mic2, Building2, MapPin } from 'lucide-react';

/**
 * 사용자 노출용 회원가입 유형 — 5개만.
 *
 * `enterprise-hq` 는 Phase 3-2 이후 내부적으로 Brand Registry 자동 매칭 flow 를
 * 기본값으로 사용한다 (LoginPage → EnterpriseBrandSignupForm 라우팅).
 * 기존 0363 invite code flow 는 URL 직접 접근 (`signup=enterprise-hq-legacy`) 로만
 * 유지 — 별도 카드로 노출하지 않는다.
 */
export type AccountType =
  | 'individual'
  | 'business'
  | 'artist'
  | 'enterprise-hq'
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
  {
    key: 'enterprise-hq',
    icon: <Building2 size={18} />,
    title: '엔터프라이즈 본사',
    desc: '본사 코드로 가입 · 관리자 승인 후 활성화',
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
