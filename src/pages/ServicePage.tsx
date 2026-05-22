import { Link } from 'react-router-dom';
import { Sparkles, Store, Music2, ShieldCheck, ArrowRight, Headphones } from 'lucide-react';

const BUSINESS_TYPES = ['병원', '카페', '편집샵', '미용실', '음식점', '와인바', '헬스장', '호텔 라운지'];

const POINTS = [
  { icon: <Music2 size={18} />, title: '매장 맞춤 AI 큐레이션', desc: '업종·시간대·분위기에 맞는 플레이리스트를 자동으로 추천합니다.' },
  { icon: <ShieldCheck size={18} />, title: '공연권 부담 완화', desc: '매장 환경에 맞는 음악을 부담 없이 운영할 수 있도록 설계했어요.' },
  { icon: <Store size={18} />, title: '업종별 BGM', desc: '병원·카페·편집샵·미용실·음식점 등 업종별 맞춤 BGM을 제공합니다.' },
  { icon: <Headphones size={18} />, title: '간편한 매장 운영', desc: '복잡한 설정 없이 매장 분위기에 맞는 음악을 바로 틀 수 있어요.' },
];

export default function ServicePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 pb-20 pt-8 sm:px-6">
      <header className="space-y-3 text-center">
        <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
          <Sparkles size={12} /> DEUDDA · 매장 음악 서비스
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          듣다는 매장 환경에 맞는<br />AI 음악 큐레이션 서비스예요
        </h1>
        <p className="mx-auto max-w-xl text-sm leading-relaxed text-ink-mute">
          사업자 회원가입 후 매장 업종·분위기에 맞는 플레이리스트를 이용할 수 있어요.
          공연권료 부담을 줄이고, 우리 매장에 어울리는 음악을 쉽게 운영하세요.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        {POINTS.map((p) => (
          <div key={p.title} className="space-y-1.5 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">{p.icon}</div>
            <h3 className="text-sm font-bold">{p.title}</h3>
            <p className="text-xs leading-relaxed text-ink-mute">{p.desc}</p>
          </div>
        ))}
      </section>

      <section className="space-y-3 rounded-2xl bg-bg-soft/60 p-5 ring-1 ring-line/10">
        <h2 className="text-sm font-bold">업종별 맞춤 BGM</h2>
        <div className="flex flex-wrap gap-2">
          {BUSINESS_TYPES.map((b) => (
            <span key={b} className="rounded-full bg-bg-card px-3 py-1 text-xs font-medium text-ink-mute ring-1 ring-line/10">
              {b}
            </span>
          ))}
        </div>
        <p className="text-xs text-ink-dim">영업·매장 납품 확장 예정이에요.</p>
      </section>

      <section className="flex flex-col gap-3 sm:flex-row">
        <Link to="/login" className="btn-primary flex-1 justify-center py-3 text-sm font-bold">
          사업자 회원가입 <ArrowRight size={16} />
        </Link>
        <Link
          to="/service/preview"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-bg-card py-3 text-sm font-bold ring-1 ring-line/15 hover:bg-bg-hover"
        >
          <Headphones size={16} /> 업종별 미리듣기
        </Link>
      </section>
    </div>
  );
}
