import { Link } from 'react-router-dom';
import { CreditCard, Settings, LogOut, ChevronRight, Shield } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

export default function ProfilePage() {
  const { profile, user, signOut } = useAuthStore();

  const planLabel =
    profile?.subscription_type === 'business'
      ? '사업자 플랜'
      : profile?.subscription_type === 'personal'
        ? '일반 플랜'
        : '무료 플랜';

  return (
    <div className="space-y-8 px-4 pb-8 pt-6 sm:px-6">
      <header className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-soft text-2xl font-bold text-black">
          {(profile?.nickname ?? user?.email ?? '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold">{profile?.nickname ?? '이름없음'}</h1>
          <p className="truncate text-xs text-ink-mute">{user?.email}</p>
          <p className="mt-1 inline-block rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-accent">
            {planLabel}
          </p>
        </div>
      </header>

      <div className="divide-y divide-white/5 overflow-hidden rounded-2xl bg-bg-card">
        <Row to="/subscription" icon={<CreditCard size={18} />} label="구독 관리" />
        {profile?.role === 'admin' && (
          <Row to="/admin" icon={<Shield size={18} />} label="관리자 페이지" />
        )}
        <Row to="/business" icon={<Settings size={18} />} label="사업자 모드 설정" />
      </div>

      <button onClick={signOut} className="flex w-full items-center justify-center gap-2 text-sm text-ink-mute hover:text-red-300">
        <LogOut size={16} /> 로그아웃
      </button>

      <p className="text-center text-[11px] text-ink-dim">스르륵 플리 · v0.1.0 MVP</p>
    </div>
  );
}

function Row({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3.5 hover:bg-bg-hover">
      <span className="text-ink-mute">{icon}</span>
      <span className="flex-1 text-sm">{label}</span>
      <ChevronRight size={16} className="text-ink-dim" />
    </Link>
  );
}
