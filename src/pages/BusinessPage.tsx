import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, Sparkles, Play, Smartphone, ShieldAlert, Clock } from 'lucide-react';
import { BUSINESS_CATEGORIES } from '@/lib/constants';
import { fetchPlaylists, fetchPlaylistTracks, logRecentPlay } from '@/lib/api';
import { useBusinessStore } from '@/store/businessStore';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/store/playerStore';
import type { PlaylistRow } from '@/types/db';
import PlaylistRow_ from '@/components/PlaylistRow';
import PlaylistCard from '@/components/PlaylistCard';
import { currentTimeSlot, timeSlotLabel } from '@/lib/format';
import { useInstallPrompt, wakeLockSupported, isStandalone } from '@/hooks/useInstallPrompt';
import { toast } from '@/store/toastStore';

const TIME_COPY: Record<string, string> = {
  morning: '오픈 직후, 손님을 부드럽게 맞이하는 시간이에요.',
  afternoon: '느긋한 오후, 매장 회전을 자연스럽게 만들어요.',
  evening: '저녁의 무드를 한 단계 끌어올리는 시간이에요.',
  night: '밤의 분위기를 깊이 있게 가져가요.',
};

export default function BusinessPage() {
  const navigate = useNavigate();
  const { businessMode, setBusinessMode, selectedCategory, setCategory } = useBusinessStore();
  const { profile, user } = useAuthStore();
  const setQueue = usePlayerStore((s) => s.setQueue);
  const setShuffle = usePlayerStore((s) => s.setShuffle);
  const setRepeat = usePlayerStore((s) => s.setRepeat);
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const { canInstall, installed, prompt } = useInstallPrompt();

  useEffect(() => {
    let alive = true;
    fetchPlaylists()
      .then((all) => {
        if (alive) setPlaylists(all.filter((p) => p.is_business_only));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const slot = currentTimeSlot();
  const slotLabel = timeSlotLabel(slot);
  const slotCopy = TIME_COPY[slot];

  const filtered = useMemo(() => {
    if (!selectedCategory) return playlists;
    return playlists.filter(
      (p) => p.business_category === selectedCategory || p.category === selectedCategory,
    );
  }, [playlists, selectedCategory]);

  const timeRecommended = useMemo(
    () => filtered.filter((p) => p.time_slot === slot),
    [filtered, slot],
  );

  const featured = timeRecommended[0] ?? filtered[0] ?? null;
  const isBusinessPlan = profile?.subscription_type === 'business';

  async function startMatchedPlaylist(p: PlaylistRow) {
    setStarting(true);
    try {
      const tracks = await fetchPlaylistTracks(p.id);
      if (tracks.length === 0) {
        toast.info('이 플레이리스트에는 아직 곡이 없어요.');
        return;
      }
      setBusinessMode(true);
      setRepeat('all'); // 매장은 끊김 없이
      setShuffle(true);
      setQueue(tracks, 0, p);
      if (user) void logRecentPlay(user.id, p.id).catch(() => {});
      toast.success('매장 모드로 재생을 시작했어요. 오랫동안 안정적으로 흘러갑니다.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '재생 시작에 실패했어요.');
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-7 px-4 pb-8 pt-6 sm:px-6">
      <header className="space-y-3">
        <div className="flex items-center gap-2">
          <Store size={22} className="text-accent" />
          <h1 className="text-2xl font-bold sm:text-3xl">사업자 모드</h1>
        </div>
        <p className="text-sm text-ink-mute">
          매장 분위기에 맞춰 자동으로 흘러가요. 화면이 꺼져도 안정적으로 재생됩니다.
        </p>
      </header>

      {/* CTA — 매장 모드 시작 카드 */}
      <section className="rounded-3xl bg-gradient-to-br from-accent-soft/40 via-bg-card to-bg-soft p-5 ring-1 ring-accent/20">
        <div className="flex items-center gap-2 text-xs text-accent">
          <Clock size={12} /> 지금 {slotLabel}
        </div>
        <h2 className="mt-1 text-xl font-bold leading-tight">
          {featured ? featured.title : '추천 플레이리스트 준비 중'}
        </h2>
        <p className="mt-1 text-xs text-ink-mute">{slotCopy}</p>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            onClick={() => featured && startMatchedPlaylist(featured)}
            disabled={!featured || starting}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-accent py-4 text-base font-bold text-black active:scale-[0.99] disabled:opacity-50"
          >
            <Play size={20} fill="currentColor" />
            {starting ? '시작 중…' : '매장 모드 시작'}
          </button>
          <button
            onClick={() => setBusinessMode(!businessMode)}
            className={`rounded-2xl px-4 py-4 text-sm font-medium ring-1 transition ${
              businessMode
                ? 'bg-accent/15 text-accent ring-accent/40'
                : 'bg-bg-card text-ink-mute ring-white/10 hover:text-ink'
            }`}
          >
            {businessMode ? '모드 ON' : '모드 OFF'}
          </button>
        </div>

        <ul className="mt-4 space-y-1 text-[11px] text-ink-mute">
          <li>· 화면이 꺼지지 않아 매장 단말에서 그대로 두기 좋아요</li>
          <li>· 자동 셔플 + 무한 반복으로 끊김 없이 흘러가요</li>
          <li>· 시간대가 바뀌면 새 플레이리스트를 추천해드려요</li>
        </ul>
      </section>

      {/* Plan / WakeLock / Install 안내 */}
      <div className="space-y-2">
        {!isBusinessPlan && (
          <Notice
            tone="accent"
            icon={<Sparkles size={14} className="text-accent" />}
            title="사업자 플랜에서 모든 기능을 이용하세요"
            description="업종별 추천 플레이리스트, 직원 공유(예정), 장시간 재생 최적화까지."
            actionLabel="구독 보기"
            onAction={() => navigate('/subscription')}
          />
        )}

        {!wakeLockSupported() && (
          <Notice
            tone="warn"
            icon={<ShieldAlert size={14} className="text-yellow-300" />}
            title="이 브라우저는 화면 꺼짐 방지를 지원하지 않아요"
            description="Chrome / Edge / Safari 16.4+ 에서 가장 안정적으로 동작해요. 또는 단말의 자동잠금을 ‘없음’으로 설정해주세요."
          />
        )}

        {!installed && (
          <Notice
            tone="info"
            icon={<Smartphone size={14} className="text-ink-mute" />}
            title="홈 화면에 추가하면 앱처럼 사용할 수 있어요"
            description={
              isStandalone()
                ? ''
                : '브라우저 메뉴에서 ‘홈 화면에 추가’ 또는 아래 버튼을 누르세요.'
            }
            actionLabel={canInstall ? '설치하기' : undefined}
            onAction={canInstall ? () => void prompt() : undefined}
          />
        )}
      </div>

      {/* 업종 선택 */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-mute">업종을 골라주세요</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-7">
          <CategoryChip label="전체" active={!selectedCategory} onClick={() => setCategory(null)} />
          {BUSINESS_CATEGORIES.map((c) => (
            <CategoryChip
              key={c.key}
              label={`${c.emoji} ${c.key}`}
              active={selectedCategory === c.key}
              onClick={() => setCategory(c.key)}
            />
          ))}
        </div>
      </section>

      {loading ? (
        <p className="text-sm text-ink-mute">불러오는 중…</p>
      ) : (
        <>
          {timeRecommended.length > 0 && (
            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-bold sm:text-xl">⏰ 지금 {slotLabel}에 어울리는</h2>
                <p className="text-xs text-ink-mute">시간대 자동 추천</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {timeRecommended.map((p) => (
                  <PlaylistCard key={p.id} playlist={p} />
                ))}
              </div>
            </section>
          )}

          <PlaylistRow_
            title={selectedCategory ? `${selectedCategory} 추천` : '전체 사업자 플레이리스트'}
            playlists={filtered}
            emptyText="해당 업종의 플레이리스트가 아직 없어요."
          />
        </>
      )}
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-2 text-xs font-medium transition ${
        active
          ? 'bg-accent text-black'
          : 'bg-bg-card text-ink-mute hover:bg-bg-hover hover:text-ink'
      }`}
    >
      {label}
    </button>
  );
}

function Notice({
  tone,
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  tone: 'info' | 'warn' | 'accent';
  icon: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const ring =
    tone === 'warn'
      ? 'ring-yellow-500/30 bg-yellow-500/5'
      : tone === 'accent'
        ? 'ring-accent/30 bg-accent/5'
        : 'ring-white/10 bg-bg-card';
  return (
    <div className={`flex items-start gap-2 rounded-xl p-3 text-xs ring-1 ${ring}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1">
        <p className="font-medium text-ink">{title}</p>
        {description && <p className="mt-0.5 text-ink-mute">{description}</p>}
      </div>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="shrink-0 rounded-md bg-bg-hover px-2.5 py-1 text-[11px] hover:bg-white/10"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
