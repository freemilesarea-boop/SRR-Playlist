import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Store,
  Play,
  Radio,
  AlertCircle,
  Maximize2,
  Sparkles,
  ChevronDown,
  Clock,
  CalendarClock,
  QrCode,
  Compass,
} from 'lucide-react';
import { BUSINESS_CATEGORIES } from '@/lib/constants';
import { fetchPlaylists, fetchPlaylistTracks, fetchPlaylistCounts, logRecentPlay } from '@/lib/api';
import { useBusinessStore } from '@/store/businessStore';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/store/playerStore';
import type { PlaylistRow } from '@/types/db';
import PlaylistRow_ from '@/components/PlaylistRow';
import PlaylistCard from '@/components/PlaylistCard';
import AutoCover from '@/components/AutoCover';
import BusinessQRSection from '@/components/BusinessQRSection';
import BusinessScheduler from '@/components/BusinessScheduler';
import HomeRecommendation from '@/components/HomeRecommendation';
import { gradientStyle } from '@/lib/cover';
import { currentTimeSlot, timeSlotLabel } from '@/lib/format';
import { filterPlayableTracks } from '@/lib/trackPlayability';
import { toast } from '@/store/toastStore';

type Slot = 'morning' | 'afternoon' | 'evening' | 'night';

/** 한글 카테고리 → 영문 business_tag */
const BUSINESS_TAG_MAP: Record<string, string> = {
  '카페': 'cafe',
  'PT샵': 'pt',
  '필라테스': 'pilates',
  '와인바': 'winebar',
  '네일샵': 'nailshop',
  '편집샵': 'boutique',
};
function mapToBusinessTag(category: string | null): string | null {
  if (!category) return null;
  return BUSINESS_TAG_MAP[category] ?? null;
}

/** 시간대 경계 (시작 hour) — currentTimeSlot 과 일관 */
const SLOT_BOUNDS: Array<{ slot: Slot; start: number }> = [
  { slot: 'morning', start: 5 },
  { slot: 'afternoon', start: 12 },
  { slot: 'evening', start: 17 },
  { slot: 'night', start: 21 },
];

function nextSlotInfo(now: Slot): { slot: Slot; startHour: number } {
  const i = SLOT_BOUNDS.findIndex((b) => b.slot === now);
  const next = SLOT_BOUNDS[(i + 1) % SLOT_BOUNDS.length];
  return { slot: next.slot, startHour: next.start };
}

export default function BusinessPage() {
  const navigate = useNavigate();
  const { businessMode, selectedCategory, setCategory } = useBusinessStore();
  const setBusinessMode = useBusinessStore((s) => s.setBusinessMode);
  const { profile, user } = useAuthStore();
  const setQueue = usePlayerStore((s) => s.setQueue);
  const setShuffle = usePlayerStore((s) => s.setShuffle);
  const setRepeat = usePlayerStore((s) => s.setRepeat);
  const playing = usePlayerStore((s) => s.playing);
  const currentPlaylistId = usePlayerStore((s) => s.playlist?.id);

  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [counts, setCounts] = useState<Map<string, { total: number; playable: number }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchPlaylists(), fetchPlaylistCounts().catch(() => new Map())])
      .then(([all, cnt]) => {
        if (!alive) return;
        setPlaylists(all.filter((p) => p.is_business_only));
        setCounts(cnt);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const slot = currentTimeSlot();
  const slotLabel = timeSlotLabel(slot);
  const next = nextSlotInfo(slot);

  function playableOrder(a: PlaylistRow, b: PlaylistRow) {
    const ca = counts.get(a.id)?.playable ?? 0;
    const cb = counts.get(b.id)?.playable ?? 0;
    if (ca === cb) return a.sort_order - b.sort_order;
    return cb - ca;
  }

  const filtered = useMemo(() => {
    const list = selectedCategory
      ? playlists.filter(
          (p) => p.business_category === selectedCategory || p.category === selectedCategory,
        )
      : playlists;
    return [...list].sort(playableOrder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlists, selectedCategory, counts]);

  const timeRecommended = useMemo(
    () => filtered.filter((p) => p.time_slot === slot),
    [filtered, slot],
  );

  const featured = useMemo(() => {
    const fromTime = timeRecommended.find((p) => (counts.get(p.id)?.playable ?? 0) > 0);
    if (fromTime) return fromTime;
    const fromAny = filtered.find((p) => (counts.get(p.id)?.playable ?? 0) > 0);
    if (fromAny) return fromAny;
    return timeRecommended[0] ?? filtered[0] ?? null;
  }, [timeRecommended, filtered, counts]);

  const featuredCount = featured ? counts.get(featured.id) : undefined;
  const featuredPlayable = (featuredCount?.playable ?? 0) > 0;

  const isBusinessPlan = profile?.subscription_type === 'business';
  const playingNow = businessMode && playing && currentPlaylistId === featured?.id;

  async function startMatchedPlaylist(p: PlaylistRow) {
    setStarting(true);
    try {
      const tracks = await fetchPlaylistTracks(p.id);
      if (tracks.length === 0) {
        toast.info('이 플레이리스트에는 아직 곡이 없어요.');
        return;
      }
      const { playable, dropped } = filterPlayableTracks(tracks);
      if (playable.length === 0) {
        toast.error('재생 가능한 음원이 없어요. 잠시 후 다시 시도해주세요.');
        return;
      }
      if (dropped.length > 0) {
        toast.info(`재생 불가 ${dropped.length}곡은 제외하고 재생합니다`);
      }
      setBusinessMode(true);
      setRepeat('all');
      setShuffle(true);
      setQueue(playable, 0, p);
      if (user) void logRecentPlay(user.id, p.id).catch(() => {});
      toast.success('매장 음악을 시작했어요.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '재생 시작에 실패했어요.');
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-5 px-4 pb-8 pt-6 sm:px-6">
      {/* 헤더 — 1줄 컴팩트 (제목 + 상태 배지) */}
      <header className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent ring-1 ring-accent/30">
          <Store size={18} />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">매장</h1>
        {playingNow ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200 ring-1 ring-emerald-400/30">
            <Radio size={10} className="animate-pulse" /> ON AIR
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-bg-card px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-dim ring-1 ring-line/10">
            OFF
          </span>
        )}
      </header>

      {/* NOW 카드 — 단 하나의 primary action */}
      {featured ? (
        <section className="relative overflow-hidden rounded-3xl ring-1 ring-line/15">
          <div className="absolute inset-0 opacity-90" style={gradientStyle(featured.category || featured.title)} />
          <div className="absolute inset-0 bg-gradient-to-br from-black/20 via-transparent to-black/75" />

          <div className="relative space-y-4 p-5 sm:p-6">
            {/* 시간대 + 다음 전환 한 줄 */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-white/85">
              <span className="inline-flex items-center gap-1">
                <Clock size={12} /> 지금 {slotLabel}
              </span>
              <span className="text-white/55">·</span>
              <span className="inline-flex items-center gap-1 text-white/75">
                다음 {next.startHour}시 {timeSlotLabel(next.slot)}
              </span>
            </div>

            {/* 표지 + 제목 */}
            <div className="flex items-end gap-4">
              <div className="aspect-square w-20 shrink-0 overflow-hidden rounded-xl shadow-2xl ring-1 ring-line/20 sm:w-24">
                <AutoCover
                  title={featured.title}
                  category={featured.category}
                  imageUrl={featured.thumbnail_url}
                  size="md"
                />
              </div>
              <div className="flex-1 space-y-1">
                <p className="text-[11px] uppercase tracking-wider text-white/65">지금 추천</p>
                <h2 className="text-xl font-extrabold leading-tight text-white drop-shadow sm:text-2xl">
                  {featured.title}
                </h2>
              </div>
            </div>

            {!featuredPlayable && (
              <div className="flex items-start gap-2 rounded-xl bg-yellow-400/15 p-2.5 text-[11px] backdrop-blur ring-1 ring-yellow-200/30">
                <AlertCircle size={12} className="mt-0.5 shrink-0 text-yellow-200" />
                <span className="text-white/90">음원이 아직 없어요. 잠시 후 다시 시도해주세요.</span>
              </div>
            )}

            {/* 단 하나의 큰 CTA + 전체화면 보조 */}
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => startMatchedPlaylist(featured)}
                disabled={starting || !featuredPlayable}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white py-4 text-base font-bold text-black shadow-2xl transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Play size={20} fill="currentColor" />
                {starting ? '시작 중…' : playingNow ? '재생 중' : '매장 음악 켜기'}
              </button>
              <button
                onClick={() => navigate('/business/player')}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-ink/10 px-5 py-4 text-sm font-semibold text-white/90 ring-1 ring-white/20 backdrop-blur transition hover:bg-ink/15"
                title="큰 화면, 화면꺼짐 방지, 자동 다음곡"
              >
                <Maximize2 size={16} /> 전체화면
              </button>
            </div>
          </div>
        </section>
      ) : loading ? (
        <section className="rounded-3xl bg-bg-card p-6 text-sm text-ink-mute ring-1 ring-line/10">
          불러오는 중…
        </section>
      ) : null}

      {/* 사업자 플랜 안내 — 1줄 (전환 시 1줄에 끝남) */}
      {!isBusinessPlan && (
        <button
          onClick={() => navigate('/subscription')}
          className="flex w-full items-center gap-2 rounded-2xl bg-accent/8 px-3.5 py-2.5 text-left text-xs ring-1 ring-accent/25 transition hover:bg-accent/12"
        >
          <Sparkles size={14} className="shrink-0 text-accent" />
          <span className="flex-1 text-ink">
            <b className="text-accent">사업자 플랜</b> 으로 업종별 추천 + 장시간 재생 최적화까지
          </span>
          <span className="shrink-0 text-[11px] font-semibold text-accent">구독 →</span>
        </button>
      )}

      {/* === 아래는 평소엔 접힘 — 필요할 때만 펼침 === */}

      {/* 자동 스케줄 운영 — 마운트는 항상 유지(자동전환 로직 백그라운드 동작) */}
      <CollapseSection
        icon={<CalendarClock size={14} className="text-accent" />}
        title="자동 스케줄 운영"
        subtitle="요일·시간대별로 분위기를 미리 정해두면 자동 전환돼요"
      >
        <BusinessScheduler />
      </CollapseSection>

      {/* 매장 QR */}
      <CollapseSection
        icon={<QrCode size={14} className="text-accent" />}
        title="매장 QR 공유"
        subtitle="손님이 찍으면 매장 플레이리스트를 같이 들을 수 있어요"
      >
        <BusinessQRSection playlists={filtered} />
      </CollapseSection>

      {/* 다른 플레이리스트 둘러보기 — 업종/시간대/전체 */}
      <CollapseSection
        icon={<Compass size={14} className="text-accent" />}
        title="다른 플레이리스트 둘러보기"
        subtitle="업종 / 시간대 / 전체"
      >
        <div className="space-y-5">
          {/* 업종 선택 */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-ink-mute">업종</p>
            <div className="-mx-1 flex flex-wrap gap-2 px-1">
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
          </div>

          <HomeRecommendation businessType={mapToBusinessTag(selectedCategory)} />

          {loading ? (
            <p className="text-sm text-ink-mute">불러오는 중…</p>
          ) : (
            <>
              {timeRecommended.length > 0 && (
                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-bold tracking-tight">⏰ 지금 {slotLabel}에 어울리는</h3>
                    <p className="text-[11px] text-ink-mute">시간대 자동 추천</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {timeRecommended.map((p) => {
                      const c = counts.get(p.id);
                      return (
                        <PlaylistCard
                          key={p.id}
                          playlist={p}
                          playableCount={c?.playable}
                          totalCount={c?.total}
                        />
                      );
                    })}
                  </div>
                </section>
              )}

              <PlaylistRow_
                title={selectedCategory ? `${selectedCategory} 추천` : '전체 사업자 플레이리스트'}
                playlists={filtered}
                counts={counts}
                emptyText="해당 업종의 플레이리스트가 아직 없어요."
              />
            </>
          )}
        </div>
      </CollapseSection>
    </div>
  );
}

/**
 * 접힘 섹션 — `<details>` 사용.
 * children 은 접혀 있어도 DOM 에 마운트되어 effect 가 계속 동작합니다
 * (BusinessScheduler 의 1분 tick / 자동 전환 로직이 백그라운드 유지).
 */
function CollapseSection({
  icon,
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group rounded-2xl bg-bg-card/60 ring-1 ring-line/10 open:bg-bg-card" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/10">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{title}</p>
          {subtitle && <p className="mt-0.5 text-[11px] text-ink-mute">{subtitle}</p>}
        </div>
        <ChevronDown
          size={16}
          className="shrink-0 text-ink-dim transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-line/10 px-4 pb-4 pt-4">{children}</div>
    </details>
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
      className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
        active
          ? 'bg-accent text-black'
          : 'bg-bg-card text-ink-mute hover:bg-bg-hover hover:text-ink'
      }`}
    >
      {label}
    </button>
  );
}
