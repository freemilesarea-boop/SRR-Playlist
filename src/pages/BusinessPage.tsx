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
  Pause,
  Sunrise,
  Sun,
  Moon,
  MessageCircle,
} from 'lucide-react';
import { BUSINESS_CATEGORIES } from '@/lib/constants';
import { fetchPlaylistCounts } from '@/lib/api';
import { useBusinessStore } from '@/store/businessStore';
import { useBusinessScheduleStore } from '@/store/businessScheduleStore';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/store/playerStore';
import { useBusinessAutoSwitch } from '@/hooks/useBusinessAutoSwitch';
import { useStartBusinessMode } from '@/hooks/useStartBusinessMode';
import type { PlaylistRow } from '@/types/db';
import PlaylistRow_ from '@/components/PlaylistRow';
import AutoCover from '@/components/AutoCover';
import BusinessQRSection from '@/components/BusinessQRSection';
import BusinessScheduler from '@/components/BusinessScheduler';
import HomeRecommendation from '@/components/HomeRecommendation';
import { gradientStyle } from '@/lib/cover';
import { formatSlotTime, getCurrentSchedule, getNextSchedule } from '@/lib/businessSchedulerApi';
import { toast } from '@/store/toastStore';
import SupportInquiryButton from '@/components/SupportInquiryButton';
import { isKakaoChannelConfigured, openKakaoChannelChat } from '@/lib/kakao';

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

function slotIcon(name: string | undefined) {
  if (name === '오전') return Sunrise;
  if (name === '오후') return Sun;
  if (name === '저녁') return Moon;
  return Clock;
}

export default function BusinessPage() {
  const navigate = useNavigate();
  const { businessMode, selectedCategory, setCategory } = useBusinessStore();
  const setBusinessMode = useBusinessStore((s) => s.setBusinessMode);
  const { profile: authProfile, user } = useAuthStore();
  const playing = usePlayerStore((s) => s.playing);
  const pausePlayer = usePlayerStore((s) => s.pause);
  const queueLength = usePlayerStore((s) => s.queue.length);

  // === 통합 스토어 ===
  const schedules = useBusinessScheduleStore((s) => s.schedules);
  const storeProfile = useBusinessScheduleStore((s) => s.profile);
  const storePlaylists = useBusinessScheduleStore((s) => s.playlists);
  const scheduleLoading = useBusinessScheduleStore((s) => s.loading);
  const tick = useBusinessScheduleStore((s) => s.tick);
  const tracksLoading = useBusinessScheduleStore((s) => s.tracksLoading);
  const refresh = useBusinessScheduleStore((s) => s.refresh);

  // 자동 운영 엔진 (1분 tick + prefetch + auto-switch) — BusinessPage 마운트 시 1회 활성
  useBusinessAutoSwitch();
  const startBusinessMode = useStartBusinessMode();
  const [starting, setStarting] = useState(false);

  // 페이지 마운트 시 스토어 로드
  useEffect(() => {
    if (user?.id) void refresh(user.id);
  }, [user?.id, refresh]);

  // counts — 둘러보기 섹션 playable 카운트 (스토어가 playlists는 이미 가져옴, counts만 별도)
  const [counts, setCounts] = useState<Map<string, { total: number; playable: number }>>(new Map());
  const [countsLoading, setCountsLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetchPlaylistCounts()
      .then((cnt) => {
        if (!alive) return;
        setCounts(cnt);
      })
      .catch(() => {})
      .finally(() => alive && setCountsLoading(false));
    return () => {
      alive = false;
    };
  }, []);
  const businessOnlyPlaylists = useMemo(
    () => storePlaylists.filter((p) => p.is_business_only),
    [storePlaylists],
  );

  // === NOW = 현재 스케줄 슬롯 (single source of truth) ===
  const current = useMemo(() => getCurrentSchedule(schedules), [schedules, tick]);
  const next = useMemo(() => getNextSchedule(schedules), [schedules, tick]);
  const currentPlaylist = useMemo(() => {
    if (!current?.playlist_id) return null;
    return storePlaylists.find((p) => p.id === current.playlist_id) ?? null;
  }, [current, storePlaylists]);

  const isPlaying = businessMode && playing;
  const isFirstUser = !scheduleLoading && schedules.length === 0;
  const isBusinessPlan = authProfile?.subscription_type === 'business';

  // 영업시간 외 fallback — current 없을 때 첫 schedule with playlist
  const fallbackSchedule = useMemo(() => {
    if (current) return null;
    return schedules.find((s) => s.playlist_id) ?? null;
  }, [current, schedules]);
  const fallbackPlaylist = useMemo(() => {
    if (!fallbackSchedule?.playlist_id) return null;
    return storePlaylists.find((p) => p.id === fallbackSchedule.playlist_id) ?? null;
  }, [fallbackSchedule, storePlaylists]);

  const displaySchedule = current ?? fallbackSchedule;
  const displayPlaylist = currentPlaylist ?? fallbackPlaylist;
  const displayIsFallback = !current && fallbackSchedule != null;

  async function handleStart() {
    setStarting(true);
    try {
      await startBusinessMode();
    } finally {
      setStarting(false);
    }
  }

  function stopBusinessMode() {
    setBusinessMode(false);
    pausePlayer();
    toast.info('매장 모드를 껐어요.');
  }

  function handleToggleBusinessMode() {
    if (isPlaying) {
      stopBusinessMode();
    } else if (displaySchedule || schedules.length > 0) {
      void handleStart();
    } else {
      toast.info('먼저 자동 스케줄에서 시간대를 설정해주세요.');
    }
  }

  const SlotIcon = slotIcon(displaySchedule?.slot_name);

  return (
    <div className="space-y-5 px-4 pb-8 pt-6 sm:px-6">
      {/* 헤더 — 1줄 컴팩트 (제목 + ON AIR/OFF 클릭 토글) */}
      <header className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent ring-1 ring-accent/30">
          <Store size={18} />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">매장</h1>
        <button
          onClick={handleToggleBusinessMode}
          disabled={starting || (!isPlaying && schedules.length === 0)}
          aria-pressed={isPlaying}
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 transition ${
            isPlaying
              ? 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30 hover:bg-emerald-500/25'
              : 'bg-bg-card text-ink-dim ring-line/10 hover:bg-bg-hover hover:text-ink'
          } disabled:opacity-50`}
          title={isPlaying ? '클릭하면 매장 모드 종료' : '클릭하면 현재 시간대 음악 시작'}
        >
          {isPlaying ? (
            <>
              <Radio size={10} className="animate-pulse" /> ON AIR
            </>
          ) : (
            'OFF'
          )}
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          {isPlaying && isKakaoChannelConfigured() && (
            <button
              onClick={() => void openKakaoChannelChat()}
              title="카톡으로 즉시 문의 (@듣다)"
              className="inline-flex items-center gap-1 rounded-lg bg-[#FEE500] px-2.5 py-1.5 text-[11px] font-bold text-[#191919] hover:bg-[#FDD800]"
            >
              <MessageCircle size={12} /> 카톡 문의
            </button>
          )}
          <SupportInquiryButton
            variant={isPlaying ? 'alert' : 'chip'}
            label={isPlaying ? '문제 신고 / 문의하기' : '문의하기'}
            defaultType={isPlaying ? '재생 오류' : '플레이리스트 문의'}
            title={isPlaying ? '매장 재생 문의' : '문의하기'}
            context={isPlaying ? {
              current_playlist_id: currentPlaylist?.id,
              current_playlist_title: currentPlaylist?.title,
              current_schedule_slot: current?.slot_name,
              queue_length: queueLength,
            } : undefined}
          />
        </div>
      </header>

      {/* === 첫 사용자 onboarding — 스케줄 없으면 최상단에 가이드 카드 + 자동 스크롤 === */}
      {isFirstUser && (
        <section className="space-y-3 rounded-3xl bg-accent/[0.08] p-5 ring-1 ring-accent/30">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-bg">
              <CalendarClock size={20} />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-extrabold tracking-tight">매장 음악 자동 운영을 시작하세요</h2>
              <p className="text-xs leading-relaxed text-ink-mute">
                매장 정보 + 오전/오후/저녁 3개 시간대를 한 번만 설정하면, 영업시간에 맞춰 음악이 자동으로 바뀝니다.
              </p>
            </div>
          </div>
          <a
            href="#scheduler-section"
            onClick={(e) => {
              e.preventDefault();
              const el = document.getElementById('scheduler-section');
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                const det = el.querySelector('details');
                if (det && !det.open) det.open = true;
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-bold text-bg hover:opacity-95"
          >
            <Sparkles size={12} /> 지금 설정 시작 →
          </a>
        </section>
      )}

      {/* === NOW 카드 — 현재 스케줄 슬롯 기반 (single source) === */}
      {displaySchedule && displayPlaylist ? (
        <section className="relative overflow-hidden rounded-3xl ring-1 ring-line/15">
          <div
            className="absolute inset-0 opacity-90"
            style={gradientStyle(displayPlaylist.category || displayPlaylist.title)}
          />
          <div className="absolute inset-0 bg-gradient-to-br from-black/20 via-transparent to-black/75" />

          <div className="relative space-y-4 p-5 sm:p-6">
            {/* 시간대 + 다음 전환 한 줄 */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-white/85">
              <span className="inline-flex items-center gap-1">
                <SlotIcon size={12} />
                {displayIsFallback ? '현재 영업시간 외' : `지금 ${displaySchedule.slot_name}`}
                <span className="ml-1 font-mono text-white/60">
                  {formatSlotTime(displaySchedule.start_time, displaySchedule.end_time)}
                </span>
              </span>
              {next && (
                <>
                  <span className="text-white/55">·</span>
                  <span className="inline-flex items-center gap-1 text-white/75">
                    다음 {next.slot_name} {next.start_time.slice(0, 5)}
                  </span>
                </>
              )}
            </div>

            {/* 표지 + 제목 */}
            <div className="flex items-end gap-4">
              <div className="aspect-square w-20 shrink-0 overflow-hidden rounded-xl shadow-2xl ring-1 ring-line/20 sm:w-24">
                <AutoCover
                  title={displayPlaylist.title}
                  category={displayPlaylist.category}
                  imageUrl={displayPlaylist.thumbnail_url}
                  size="md"
                />
              </div>
              <div className="flex-1 space-y-1">
                <p className="text-[11px] uppercase tracking-wider text-white/65">
                  {displayIsFallback ? '폴백 재생' : '지금 자동 재생 슬롯'}
                </p>
                <h2 className="text-xl font-extrabold leading-tight text-white drop-shadow sm:text-2xl">
                  {displayPlaylist.title}
                </h2>
              </div>
            </div>

            {displayIsFallback && (
              <div className="flex items-start gap-2 rounded-xl bg-white/10 p-2.5 text-[11px] backdrop-blur ring-1 ring-white/15">
                <AlertCircle size={12} className="mt-0.5 shrink-0 text-white/80" />
                <span className="text-white/90">
                  지금은 설정된 시간대 외예요. 시작을 누르면 첫 슬롯의 플리로 재생됩니다.
                </span>
              </div>
            )}

            {/* 시작/끄기 통합 버튼 */}
            <div className="flex flex-col gap-2 sm:flex-row">
              {isPlaying ? (
                <button
                  onClick={stopBusinessMode}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white py-4 text-base font-bold text-black shadow-2xl transition active:scale-[0.99]"
                >
                  <Pause size={20} fill="currentColor" /> 매장 모드 끄기
                </button>
              ) : (
                <button
                  onClick={() => void handleStart()}
                  disabled={starting || tracksLoading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white py-4 text-base font-bold text-black shadow-2xl transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Play size={20} fill="currentColor" />
                  {starting ? '시작 중…' : tracksLoading ? '준비 중…' : '매장 음악 켜기'}
                </button>
              )}
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
      ) : isFirstUser ? null : scheduleLoading ? (
        <section className="rounded-3xl bg-bg-card p-6 text-sm text-ink-mute ring-1 ring-line/10">
          불러오는 중…
        </section>
      ) : (
        // schedules는 있는데 플리 미지정 케이스
        <section className="rounded-3xl bg-bg-card p-5 ring-1 ring-line/10">
          <p className="text-sm font-semibold">시간대에 플레이리스트가 지정되지 않았어요.</p>
          <p className="mt-1 text-xs text-ink-mute">
            아래 <b className="text-accent">자동 스케줄 운영</b> 에서 각 슬롯의 플리를 선택해주세요.
          </p>
        </section>
      )}

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

      {/* === 자동 스케줄 운영 — 첫 사용자면 자동 펼침 (load 완료 후 마운트로 defaultOpen 정확히 반영) === */}
      <div id="scheduler-section">
        {scheduleLoading ? (
          <div className="rounded-2xl bg-bg-card/60 px-4 py-3.5 text-xs text-ink-dim ring-1 ring-line/10">
            자동 스케줄 불러오는 중…
          </div>
        ) : (
          <CollapseSection
            icon={<CalendarClock size={14} className="text-accent" />}
            title="자동 스케줄 운영"
            subtitle={
              storeProfile?.store_name
                ? `${storeProfile.store_name} · ${displaySchedule ? `현재 ${displaySchedule.slot_name}` : '영업시간 외'}`
                : '매장 정보 + 3개 시간대(오전·오후·저녁) 한 번만 설정'
            }
            defaultOpen={isFirstUser}
          >
            <BusinessScheduler />
          </CollapseSection>
        )}
      </div>

      {/* 매장 QR */}
      <CollapseSection
        icon={<QrCode size={14} className="text-accent" />}
        title="매장 QR 공유"
        subtitle="손님이 찍으면 매장 플레이리스트를 같이 들을 수 있어요"
      >
        <BusinessQRSection playlists={businessOnlyPlaylists} />
      </CollapseSection>

      {/* 다른 플레이리스트 둘러보기 */}
      <CollapseSection
        icon={<Compass size={14} className="text-accent" />}
        title="다른 플레이리스트 둘러보기"
        subtitle="업종 / 시간대 / 전체"
      >
        <div className="space-y-5">
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

          {scheduleLoading || countsLoading ? (
            <p className="text-sm text-ink-mute">불러오는 중…</p>
          ) : (
            <PlaylistRow_
              title={selectedCategory ? `${selectedCategory} 추천` : '전체 사업자 플레이리스트'}
              playlists={
                selectedCategory
                  ? businessOnlyPlaylists.filter(
                      (p) =>
                        p.business_category === selectedCategory ||
                        p.category === selectedCategory,
                    )
                  : businessOnlyPlaylists
              }
              counts={counts}
              emptyText="해당 업종의 플레이리스트가 아직 없어요."
            />
          )}
        </div>
      </CollapseSection>

    </div>
  );
}

/**
 * 접힘 섹션 — `<details>` 사용.
 * children 은 접혀 있어도 DOM 에 마운트되어 effect 가 계속 동작합니다.
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

