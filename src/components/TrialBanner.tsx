import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Crown } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { resolveSubscriptionStatus, trialRemainingMs } from '@/lib/membership';

/**
 * 영업인 코드 3일 무료 체험 배너 (0195).
 * - trial: 남은 기간(일/시간) 표시 + 결제 유도. D-1 이내면 강조.
 * - expired: 체험 종료 안내 + 결제 유도.
 * 유료/일반/비로그인 회원에겐 표시하지 않음.
 */
export default function TrialBanner() {
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const navigate = useNavigate();
  const [, setTick] = useState(0);

  const status = resolveSubscriptionStatus(session, profile);

  // 체험 중에는 1분마다 남은 시간 갱신
  useEffect(() => {
    if (status !== 'trial') return;
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, [status]);

  if (status !== 'trial' && status !== 'expired') return null;

  if (status === 'expired') {
    return (
      <div className="mx-auto mb-3 flex max-w-[1500px] flex-wrap items-center gap-3 rounded-2xl bg-amber-500/20 px-4 py-3 ring-1 ring-amber-500/25">
        <Crown size={18} className="shrink-0 text-amber-500" />
        <span className="flex-1 text-sm font-semibold text-amber-600">
          무료 체험이 종료되었어요. 계속 매장에서 재생하려면 구독이 필요합니다.
        </span>
        <button
          onClick={() => navigate('/subscription')}
          className="rounded-full bg-amber-500 px-4 py-1.5 text-xs font-bold text-black transition hover:bg-amber-400"
        >
          구독하기
        </button>
      </div>
    );
  }

  const ms = trialRemainingMs(profile);
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const urgent = ms <= 86_400_000; // D-1 이내
  const remainLabel = days > 0 ? `${days}일 ${hours}시간` : `${hours}시간`;

  return (
    <div
      className={`mx-auto mb-3 flex max-w-[1500px] flex-wrap items-center gap-3 rounded-2xl px-4 py-3 ring-1 ${
        urgent ? 'bg-rose-500/20 ring-rose-500/25' : 'bg-accent/10 ring-accent/25'
      }`}
    >
      <Clock size={18} className={`shrink-0 ${urgent ? 'text-rose-500' : 'text-accent'}`} />
      <span className={`flex-1 text-sm font-semibold ${urgent ? 'text-rose-600' : 'text-accent'}`}>
        {urgent ? '무료 체험 종료 임박! ' : '3일 무료 체험 진행 중 · '}
        남은 기간 <b>{remainLabel}</b>
      </span>
      <button
        onClick={() => navigate('/subscription')}
        className={`rounded-full px-4 py-1.5 text-xs font-bold text-black transition ${
          urgent ? 'bg-rose-500 hover:bg-rose-400' : 'bg-accent hover:opacity-90'
        }`}
      >
        지금 구독
      </button>
    </div>
  );
}
