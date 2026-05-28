import { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Clock,
  Play,
  Plus,
  Sparkles,
  Store,
  Trash2,
  Save,
  Radio,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import {
  DAY_LABELS,
  DAY_LABELS_FULL,
  TEMPLATE_KEYS,
  createDefaultSchedules,
  createSchedule,
  deleteSchedule,
  fetchBusinessProfile,
  fetchBusinessSchedules,
  formatSlotTime,
  getCurrentSchedule,
  getNextSchedule,
  hasOverlap,
  logScheduleEvent,
  nowKstParts,
  updateSchedule,
  upsertBusinessProfile,
  type BusinessProfile,
  type BusinessSchedule,
} from '@/lib/businessSchedulerApi';
import { useAuthStore } from '@/store/authStore';
import { useBusinessStore } from '@/store/businessStore';
import { usePlayerStore } from '@/store/playerStore';
import { usePlaybackSettingsStore } from '@/store/playbackSettingsStore';
import { fetchPlaylists, fetchPlaylistTracks } from '@/lib/api';
import { filterPlayableTracks } from '@/lib/trackPlayability';
import { toast } from '@/store/toastStore';
import type { PlaylistRow, TrackRow } from '@/types/db';

export default function BusinessScheduler() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const profileSub = useAuthStore((s) => s.profile?.subscription_type);
  const setBusinessMode = useBusinessStore((s) => s.setBusinessMode);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const setShuffle = usePlayerStore((s) => s.setShuffle);
  const setRepeat = usePlayerStore((s) => s.setRepeat);
  const playAction = usePlayerStore((s) => s.play);
  const businessMode = useBusinessStore((s) => s.businessMode);

  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [schedules, setSchedules] = useState<BusinessSchedule[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [creatingDefaults, setCreatingDefaults] = useState(false);
  const [editingDay, setEditingDay] = useState<number>(() => nowKstParts().day);
  // 현재 active schedule 의 트랙을 미리 로드 (user gesture 안에서 동기 setQueue 가능하도록).
  const [currentTracks, setCurrentTracks] = useState<TrackRow[] | null>(null);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [tracksError, setTracksError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // 1분마다 현재 스케줄 다시 계산
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  async function load() {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [p, s, pls] = await Promise.all([
        fetchBusinessProfile(userId),
        fetchBusinessSchedules(userId).catch(() => []),
        fetchPlaylists(),
      ]);
      setProfile(p);
      setSchedules(s);
      setPlaylists(pls);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '스케줄 로드 실패');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // 매장 모드 ON + 스케줄 변경 자동 감지 (1분 tick)
  const current = useMemo(() => getCurrentSchedule(schedules), [schedules, tick]);
  const next = useMemo(() => getNextSchedule(schedules), [schedules, tick]);
  const overlaps = useMemo(() => hasOverlap(schedules), [schedules]);

  // 매장 모드 ON 일 때 currentSchedule 변경 → 자동 큐 교체
  const [lastSwitchedScheduleId, setLastSwitchedScheduleId] = useState<string | null>(null);

  // 1) current schedule 의 트랙 prefetch — businessMode 와 무관하게 항상 미리 로드.
  //    user gesture 클릭 핸들러 안에서 동기 setQueue 가능 (autoplay 정책 안전).
  useEffect(() => {
    setCurrentTracks(null);
    setTracksError(null);
    if (!current?.playlist_id) return;
    setTracksLoading(true);
    let alive = true;
    fetchPlaylistTracks(current.playlist_id)
      .then((tracks) => {
        if (!alive) return;
        const { playable } = filterPlayableTracks(tracks);
        if (import.meta.env.DEV) {
          console.debug('[StoreScheduler] tracks loaded count', { slot: current.slot_name, total: tracks.length, playable: playable.length });
        }
        setCurrentTracks(playable);
      })
      .catch((e) => {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (import.meta.env.DEV) console.error('[StoreScheduler] tracks fetch failed', e);
        setTracksError(msg);
      })
      .finally(() => { if (alive) setTracksLoading(false); });
    return () => { alive = false; };
  }, [current?.playlist_id, current?.slot_name]);

  // 2) businessMode ON + schedule 전환 시 자동 큐 교체. prefetched tracks 가 있으면 즉시 사용,
  //    없으면 fetch 후 교체. 첫 시작 시점에는 startBusinessMode 가 직접 큐를 세팅해 토스트만 분리.
  useEffect(() => {
    if (!businessMode || !current?.id || !current.playlist_id) return;
    if (lastSwitchedScheduleId === current.id) return;
    const isInitial = lastSwitchedScheduleId === null;
    // 가드: 매장 모드 off / 컴포넌트 언마운트 / 도중에 schedule 바뀜 → setQueue/play 발화 차단
    let alive = true;
    const targetScheduleId = current.id;
    (async () => {
      try {
        let playable: TrackRow[];
        if (currentTracks && currentTracks.length > 0) {
          playable = currentTracks;
        } else {
          const tracks = await fetchPlaylistTracks(current.playlist_id!);
          playable = filterPlayableTracks(tracks).playable;
        }
        // 비동기 fetch 후에도 여전히 유효한 상태인지 재확인
        if (!alive) return;
        if (!useBusinessStore.getState().businessMode) return; // 모드 off 됐으면 무시
        if (current.id !== targetScheduleId) return; // 스케줄이 그 사이 바뀌었으면 무시
        if (playable.length === 0) {
          toast.error(`${current.slot_name}: 재생 가능한 음악이 없어요.`);
          return;
        }
        const playlist = playlists.find((p) => p.id === current.playlist_id) ?? null;
        setQueue(playable, 0, playlist);
        setRepeat('all');
        setShuffle(true);
        playAction();
        if (import.meta.env.DEV) console.debug('[StoreScheduler] playback started', { tracks: playable.length, isInitial });
        setLastSwitchedScheduleId(current.id);
        if (!isInitial) toast.success(`${current.slot_name} 플레이리스트로 자동 전환했어요`);
        void logScheduleEvent(userId, current.id, current.playlist_id, isInitial ? 'started' : 'switched');
      } catch (e) {
        if (alive) toast.error(e instanceof Error ? e.message : '자동 전환 실패');
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessMode, current?.id, current?.playlist_id, currentTracks]);

  async function saveProfile() {
    if (!userId || !profile) return;
    setSavingProfile(true);
    try {
      const saved = await upsertBusinessProfile({
        user_id: userId,
        store_name: profile.store_name,
        business_type: profile.business_type,
        timezone: profile.timezone || 'Asia/Seoul',
        open_time: profile.open_time,
        close_time: profile.close_time,
      });
      setProfile(saved);
      toast.success('매장 정보를 저장했어요.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleCreateDefaults() {
    if (!userId || !profile?.business_type) {
      toast.info('먼저 업종을 선택하고 저장해주세요.');
      return;
    }
    setCreatingDefaults(true);
    try {
      const { created } = await createDefaultSchedules(userId, profile.business_type);
      toast.success(`기본 스케줄 ${created}건을 생성했어요.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '생성 실패');
    } finally {
      setCreatingDefaults(false);
    }
  }

  async function handleAddSlot() {
    if (!userId) return;
    try {
      await createSchedule({
        user_id: userId,
        day_of_week: editingDay,
        slot_name: '새 시간대',
        start_time: '12:00',
        end_time: '14:00',
        is_active: true,
      });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '추가 실패');
    }
  }

  async function handleUpdate(id: string, patch: Partial<BusinessSchedule>) {
    try {
      await updateSchedule(id, patch);
      setSchedules((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '저장 실패');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('삭제할까요?')) return;
    try {
      await deleteSchedule(id);
      setSchedules((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '삭제 실패');
    }
  }

  const enableForBusinessMode = usePlaybackSettingsStore((s) => s.enableForBusinessMode);

  function startBusinessMode() {
    const now = nowKstParts();
    const timeStr = `${String(Math.floor(now.minutes / 60)).padStart(2, '0')}:${String(now.minutes % 60).padStart(2, '0')}`;
    if (import.meta.env.DEV) console.debug('[StoreScheduler] start clicked', { day: now.day, time: timeStr });
    if (!current) {
      if (import.meta.env.DEV) console.debug('[StoreScheduler] no active schedule');
      toast.info('지금 시간대에 활성화된 스케줄이 없어요.');
      return;
    }
    if (import.meta.env.DEV) console.debug('[StoreScheduler] active schedule found', { id: current.id, name: current.slot_name, playlistId: current.playlist_id });
    if (!current.playlist_id) {
      toast.info('이 스케줄에 플레이리스트가 지정되지 않았어요. 스케줄 설정에서 플레이리스트를 선택해주세요.');
      return;
    }
    if (tracksLoading) {
      toast.info('트랙을 불러오는 중이에요. 잠시 후 다시 시도해주세요.');
      return;
    }
    if (tracksError) {
      toast.error(`트랙 로드 실패: ${tracksError}`);
      return;
    }
    if (!currentTracks || currentTracks.length === 0) {
      if (import.meta.env.DEV) console.debug('[StoreScheduler] no playable tracks for current schedule');
      toast.error('이 스케줄에 재생 가능한 음악이 없어요.');
      return;
    }
    // user gesture 안에서 모든 player 호출을 동기로 수행 (autoplay 정책 안전).
    setStarting(true);
    try {
      enableForBusinessMode();
      const playlist = playlists.find((p) => p.id === current.playlist_id) ?? null;
      setShuffle(true);
      setRepeat('all');
      setQueue(currentTracks, 0, playlist); // playerStore 내부에서 playing=true 세팅
      playAction(); // 명시적 보강
      setBusinessMode(true);
      setLastSwitchedScheduleId(current.id);
      if (import.meta.env.DEV) console.debug('[StoreScheduler] playback started', { tracks: currentTracks.length, slot: current.slot_name });
      void logScheduleEvent(userId, current.id, current.playlist_id, 'started');
      toast.success(`${current.slot_name} 시작 (${currentTracks.length}곡)`);
      // 1.5s 후 실제 재생 상태 검증 — playerStore.playing + audio element 의 실제 currentSrc/currentTime/볼륨/뮤트 (DEV)
      if (import.meta.env.DEV) {
        window.setTimeout(() => {
          const st = usePlayerStore.getState();
          const cur = st.queue[st.index] ?? null;
          const diag = (window as unknown as { __playerDiag?: () => unknown }).__playerDiag;
          const aud = typeof diag === 'function' ? (diag() as { active: { currentSrc: string; currentTime: number; duration: number; paused: boolean; muted: boolean; volume: number; readyState: number } | null }) : null;
          console.debug('[StoreScheduler] verify after 1.5s', {
            store: { playing: st.playing, queue_length: st.queue.length, index: st.index,
              current_track_id: cur?.id, current_track_title: cur?.title, current_audio_url: cur?.audio_url },
            audio: aud?.active ?? '(audio element 접근 불가)',
            url_match: aud?.active && cur?.audio_url ? aud.active.currentSrc === cur.audio_url : null,
          });
          if (!st.playing) {
            console.warn('[StoreScheduler] store.playing=false @1.5s — autoplay 차단 또는 src 미적용 의심.');
          } else if (aud?.active && aud.active.paused) {
            console.warn('[StoreScheduler] store.playing=true 인데 audio.paused=true @1.5s — play() 거절됐을 가능성. [Player] 로그 확인.');
          } else if (aud?.active && aud.active.currentTime <= 0.05) {
            console.warn('[StoreScheduler] audio.currentTime 정체 @1.5s — 시스템 볼륨/사이트 사운드 권한/코덱 의심.');
          } else if (aud?.active) {
            console.debug('[StoreScheduler] OK — audio playback 정상 진행 중', { currentTime: aud.active.currentTime, volume: aud.active.volume, muted: aud.active.muted });
          }
        }, 1500);
      }
    } catch (e) {
      if (import.meta.env.DEV) console.error('[StoreScheduler] audio play failed', e);
      toast.error(e instanceof Error ? e.message : '재생 시작 실패');
    } finally {
      setStarting(false);
    }
  }

  if (!userId) return null;

  const isBusinessPlan = profileSub === 'business';
  const todaySchedules = schedules
    .filter((s) => s.day_of_week === editingDay)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  return (
    <section className="space-y-5 rounded-3xl bg-bg-card p-5 shadow-card ring-1 ring-line/10">
      {/* 헤더 */}
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent ring-1 ring-accent/20">
            <Calendar size={16} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-extrabold tracking-tight">매장 자동 스케줄러</h2>
              {!isBusinessPlan && (
                <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-bold text-yellow-200 ring-1 ring-yellow-300/30">
                  사업자 플랜
                </span>
              )}
            </div>
            <p className="text-xs text-ink-mute">
              영업시간에 맞춰 음악이 자동으로 바뀝니다.
            </p>
          </div>
        </div>
      </header>

      {/* 현재 / 다음 스케줄 */}
      {schedules.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          <CurrentBadge
            label="현재 재생 중"
            schedule={current}
            playlists={playlists}
            playing={businessMode}
            highlight
          />
          <CurrentBadge label="다음 전환" schedule={next} playlists={playlists} />
        </div>
      )}

      {/* 프로필 + 영업시간 */}
      <section className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-ink-mute">매장 정보</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={profile?.store_name ?? ''}
            onChange={(e) =>
              setProfile((p) => ({
                ...(p ?? { user_id: userId, timezone: 'Asia/Seoul', store_name: null, business_type: null, open_time: null, close_time: null }),
                store_name: e.target.value,
              }))
            }
            placeholder="매장명 (예: 라벤더 카페 강남점)"
            className="input text-sm"
          />
          <select
            value={profile?.business_type ?? ''}
            onChange={(e) =>
              setProfile((p) => ({
                ...(p ?? { user_id: userId, timezone: 'Asia/Seoul', store_name: null, business_type: null, open_time: null, close_time: null }),
                business_type: e.target.value || null,
              }))
            }
            className="input text-sm"
          >
            <option value="">업종 선택</option>
            {TEMPLATE_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            type="time"
            value={profile?.open_time?.slice(0, 5) ?? ''}
            onChange={(e) =>
              setProfile((p) => ({
                ...(p ?? { user_id: userId, timezone: 'Asia/Seoul', store_name: null, business_type: null, open_time: null, close_time: null }),
                open_time: e.target.value || null,
              }))
            }
            className="input text-sm"
            placeholder="영업 시작"
          />
          <input
            type="time"
            value={profile?.close_time?.slice(0, 5) ?? ''}
            onChange={(e) =>
              setProfile((p) => ({
                ...(p ?? { user_id: userId, timezone: 'Asia/Seoul', store_name: null, business_type: null, open_time: null, close_time: null }),
                close_time: e.target.value || null,
              }))
            }
            className="input text-sm"
            placeholder="영업 종료"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={saveProfile}
            disabled={savingProfile || !profile?.business_type}
            className="btn-primary text-sm"
          >
            <Save size={14} />
            {savingProfile ? '저장 중…' : '매장 정보 저장'}
          </button>
          {schedules.length === 0 && profile?.business_type && (
            <button
              onClick={handleCreateDefaults}
              disabled={creatingDefaults}
              className="btn-ghost text-sm"
            >
              <Sparkles size={14} />
              {creatingDefaults ? '생성 중…' : '기본 스케줄 만들기'}
            </button>
          )}
        </div>
      </section>

      {/* CTA */}
      {current && (
        <div className="space-y-1.5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={startBusinessMode}
              disabled={starting || tracksLoading || (currentTracks !== null && currentTracks.length === 0)}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 text-sm font-bold text-bg shadow-card hover:opacity-95 disabled:opacity-60"
            >
              <Play size={16} fill="currentColor" />
              {starting
                ? '시작 중…'
                : tracksLoading
                  ? '트랙 불러오는 중…'
                  : `현재 스케줄로 매장 모드 시작${currentTracks ? ` (${currentTracks.length}곡)` : ''}`}
            </button>
            <button
              onClick={() => setBusinessMode(false)}
              disabled={!businessMode}
              className="btn-ghost text-sm"
            >
              매장 모드 끄기
            </button>
          </div>
          {tracksError && (
            <p className="text-[11px] text-red-300">트랙 로드 실패: {tracksError}</p>
          )}
          {!tracksLoading && !tracksError && currentTracks?.length === 0 && (
            <p className="text-[11px] text-yellow-300">
              이 스케줄(<b>{current.slot_name}</b>)에 재생 가능한 음악이 없어요. 스케줄의 플레이리스트를 변경하거나 음원을 추가해주세요.
            </p>
          )}
        </div>
      )}

      {/* 스케줄 편집 */}
      {schedules.length === 0 ? (
        <Empty />
      ) : (
        <section className="space-y-3">
          <header className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink-mute">
              요일별 스케줄
            </h3>
            <button
              onClick={handleAddSlot}
              className="inline-flex items-center gap-1 rounded-full bg-bg-soft px-3 py-1 text-[11px] hover:bg-bg-hover"
            >
              <Plus size={11} /> {DAY_LABELS[editingDay]}요일에 추가
            </button>
          </header>

          {/* 요일 탭 */}
          <div className="-mx-1 flex gap-1 overflow-x-auto pb-1 no-scrollbar">
            {DAY_LABELS.map((label, idx) => {
              const isToday = nowKstParts().day === idx;
              const count = schedules.filter((s) => s.day_of_week === idx).length;
              return (
                <button
                  key={idx}
                  onClick={() => setEditingDay(idx)}
                  className={`shrink-0 rounded-2xl px-3 py-2 text-xs font-semibold transition ${
                    editingDay === idx
                      ? 'bg-accent text-bg'
                      : 'bg-bg-soft text-ink-mute hover:text-ink'
                  } ${isToday && editingDay !== idx ? 'ring-1 ring-accent/40' : ''}`}
                >
                  {label}
                  {count > 0 && (
                    <span className="ml-1 opacity-70">{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 슬롯 리스트 */}
          {todaySchedules.length === 0 ? (
            <div className="rounded-xl bg-bg-soft p-4 text-center text-xs text-ink-mute">
              {DAY_LABELS_FULL[editingDay]} 스케줄이 없어요. + 버튼으로 추가하세요.
            </div>
          ) : (
            <ul className="space-y-2">
              {todaySchedules.map((s) => {
                const overlap = overlaps.some((o) => o.id === s.id);
                const isCurrent = current?.id === s.id;
                return (
                  <SlotRow
                    key={s.id}
                    schedule={s}
                    playlists={playlists}
                    overlap={overlap}
                    isCurrent={isCurrent}
                    onUpdate={(p) => handleUpdate(s.id, p)}
                    onDelete={() => handleDelete(s.id)}
                  />
                );
              })}
            </ul>
          )}

          {overlaps.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl bg-yellow-500/10 p-2.5 text-[11px] ring-1 ring-yellow-400/30">
              <AlertCircle size={12} className="mt-0.5 shrink-0 text-yellow-300" />
              <span className="text-ink-mute">
                겹치는 시간대가 있어요. 빨간색으로 표시된 슬롯의 시간을 조정해주세요.
              </span>
            </div>
          )}
        </section>
      )}

      {loading && <p className="text-xs text-ink-dim">불러오는 중…</p>}
    </section>
  );
}

function CurrentBadge({
  label,
  schedule,
  playlists,
  playing,
  highlight,
}: {
  label: string;
  schedule: BusinessSchedule | null;
  playlists: PlaylistRow[];
  playing?: boolean;
  highlight?: boolean;
}) {
  const playlist = schedule?.playlist_id
    ? playlists.find((p) => p.id === schedule.playlist_id)
    : null;
  return (
    <div
      className={`relative overflow-hidden rounded-2xl p-3.5 ring-1 transition duration-smooth ease-emphasized ${
        highlight
          ? 'bg-accent/[0.08] ring-accent/30 shadow-card'
          : 'bg-bg-soft ring-line/10'
      }`}
    >
      {/* DEUDDA — 활성 카드 좌측 violet bar */}
      {highlight && playing && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-accent" />
      )}
      <div className="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-ink-dim">
        {highlight && playing && <Radio size={10} className="animate-pulse text-accent" />}
        <span className={highlight ? 'text-accent' : ''}>{label}</span>
      </div>
      {schedule ? (
        <div className="mt-1.5 space-y-1">
          <p className="truncate text-[15px] font-bold tracking-tight">{schedule.slot_name}</p>
          <p className="flex items-center gap-1.5 font-mono text-[11px] text-ink-mute">
            <Clock size={11} /> {formatSlotTime(schedule.start_time, schedule.end_time)}
            <span className="text-ink-dim">·</span>
            <span>{DAY_LABELS[schedule.day_of_week]}요일</span>
          </p>
          <p className="truncate text-[12px] text-ink-mute">
            {playlist?.title ?? <span className="text-ink-dim">플리 미지정</span>}
          </p>
        </div>
      ) : (
        <p className="mt-1.5 text-xs text-ink-mute">없음</p>
      )}
    </div>
  );
}

function SlotRow({
  schedule,
  playlists,
  overlap,
  isCurrent,
  onUpdate,
  onDelete,
}: {
  schedule: BusinessSchedule;
  playlists: PlaylistRow[];
  overlap: boolean;
  isCurrent?: boolean;
  onUpdate: (patch: Partial<BusinessSchedule>) => void;
  onDelete: () => void;
}) {
  const businessOnly = playlists.filter((p) => p.is_business_only);
  const others = playlists.filter((p) => !p.is_business_only);
  return (
    <li
      className={`relative space-y-2 overflow-hidden rounded-xl p-3 ring-1 transition duration-smooth ease-emphasized ${
        overlap
          ? 'bg-bg-soft ring-red-400/40'
          : isCurrent
            ? 'bg-accent/[0.06] ring-accent/30'
            : 'bg-bg-soft ring-line/10 hover:ring-line/20'
      } ${!schedule.is_active ? 'opacity-60' : ''}`}
    >
      {/* DEUDDA — 활성 슬롯 좌측 violet bar */}
      {isCurrent && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-accent" />
      )}
      <div className="flex items-center gap-2">
        {isCurrent && (
          <span className="font-mono text-[9px] font-medium uppercase tracking-[0.22em] text-accent">
            NOW
          </span>
        )}
        <input
          value={schedule.slot_name}
          onChange={(e) => onUpdate({ slot_name: e.target.value })}
          className="input flex-1 py-1.5 text-sm font-semibold"
          placeholder="시간대 이름"
        />
        <button
          onClick={() => onUpdate({ is_active: !schedule.is_active })}
          className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-wider transition ${
            schedule.is_active
              ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30 hover:bg-emerald-500/25'
              : 'bg-bg-hover text-ink-mute hover:text-ink'
          }`}
        >
          {schedule.is_active ? 'ACTIVE' : 'OFF'}
        </button>
        <button
          onClick={onDelete}
          aria-label="삭제"
          className="shrink-0 rounded-full p-1.5 text-red-300 transition-colors hover:bg-red-500/10 hover:text-red-200"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="flex items-center gap-2 font-mono text-xs text-ink-mute">
        <input
          type="time"
          value={schedule.start_time.slice(0, 5)}
          onChange={(e) => onUpdate({ start_time: `${e.target.value}:00` })}
          className="input py-1.5 text-xs font-mono"
        />
        <ChevronRight size={12} className="shrink-0 text-ink-dim" />
        <input
          type="time"
          value={schedule.end_time.slice(0, 5)}
          onChange={(e) => onUpdate({ end_time: `${e.target.value}:00` })}
          className="input py-1.5 text-xs font-mono"
        />
      </div>

      <select
        value={schedule.playlist_id ?? ''}
        onChange={(e) => onUpdate({ playlist_id: e.target.value || null })}
        className="input py-1.5 text-xs"
      >
        <option value="">플레이리스트 선택</option>
        {businessOnly.length > 0 && (
          <optgroup label="사업자 전용">
            {businessOnly.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label="일반">
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </li>
  );
}

function Empty() {
  return (
    <div className="space-y-2 rounded-2xl bg-bg-soft p-6 text-center ring-1 ring-line/10">
      <Store size={20} className="mx-auto text-ink-dim" />
      <p className="text-sm font-semibold">아직 매장 스케줄이 없어요</p>
      <p className="text-xs text-ink-mute">
        매장 정보를 저장하고, ‘기본 스케줄 만들기’ 로 빠르게 시작해보세요.
      </p>
    </div>
  );
}
