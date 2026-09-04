// Phase BRAND-1 — 브랜드 전용 플레이어 (/brand/player/:brandId).
// StorePlayerPage 패턴: 전역 <Player> 의 audio/큐를 그대로 소비만 한다 (audio element 미터치).
// 이미지 사이니지는 BrandSignage 가 독립 DOM 으로 처리 → audio remount 없음.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Play, Pause, SkipForward, SkipBack, X, Wifi, WifiOff, Music, Loader2, Sparkles, ShieldCheck, Maximize2, LogOut, Repeat as SwitchIcon } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';
import { usePlaybackHealthStore } from '@/store/playbackHealthStore';
import { usePlaybackSettingsStore } from '@/store/playbackSettingsStore';
import { useBusinessStore } from '@/store/businessStore';
import { getBrandPlayerConfig, verifyBrandDeviceBinding, revokeBrandDeviceByToken } from '@/lib/api/brandPlayerApi';
import { getBrandToken, clearBrandToken } from '@/lib/brandSession';
import { filterPlayableTracks } from '@/lib/trackPlayability';
import { useBrandPlayerHeartbeat } from '@/hooks/useBrandPlayerHeartbeat';
import BrandVisualStage from '@/components/brand/BrandVisualStage';
import BrandFullscreenControls from '@/components/brand/BrandFullscreenControls';
import BrandPresentationOverlays from '@/components/brand/BrandPresentationOverlays';
import PlaybackBlockedOverlay from '@/components/player/PlaybackBlockedOverlay';
import { normalizeSignageSettings } from '@/lib/brandSignageSettings';
import { useBrandStore } from '@/store/brandStore';
import type { BrandPlayerConfig } from '@/types/brand';
import type { PlaylistRow } from '@/types/db';

export default function BrandPlayerPage() {
  const { brandId } = useParams<{ brandId: string }>();
  const navigate = useNavigate();
  const token = brandId ? getBrandToken(brandId) : null;

  // 전역 player (per-field selector — 불필요한 re-render 최소화)
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const playing = usePlayerStore((s) => s.playing);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const play = usePlayerStore((s) => s.play);
  const pause = usePlayerStore((s) => s.pause);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const setShuffle = usePlayerStore((s) => s.setShuffle);
  const setRepeat = usePlayerStore((s) => s.setRepeat);
  const enableForBusinessMode = usePlaybackSettingsStore((s) => s.enableForBusinessMode);
  const setBusinessMode = useBusinessStore((s) => s.setBusinessMode);
  // BRAND-PLAYER-UX-4 — 브랜드/서비스 로고(사이니지 미디어 없을 때 Priority 2). 기존 필드 재사용.
  const brandLogoUrl = useBrandStore((s) => s.logo_url);
  const loadBrandSettings = useBrandStore((s) => s.load);

  const { online, wakeLockSupported, wakeLockActive } = usePlaybackHealthStore();

  const [config, setConfig] = useState<BrandPlayerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const queuedBrandRef = useRef<string | null>(null); // 이 브랜드로 큐 세팅했는지

  // Presentation Fullscreen: 저장 이미지만 전체화면 노출 (음악·audio element 불변, 전역 <Player> 그대로 재생).
  // presentation=chrome 숨김, fallback=Fullscreen API 미지원/거부 시 CSS 기반 뷰포트 덮기.
  const [presentation, setPresentation] = useState(false);
  const [fallback, setFallback] = useState(false);
  const presentationRef = useRef<HTMLDivElement | null>(null);

  const enterPresentation = useCallback(async () => {
    const el = presentationRef.current;
    if (el && typeof el.requestFullscreen === 'function') {
      try {
        await el.requestFullscreen();
        setFallback(false);
        setPresentation(true);
        return;
      } catch { /* Fullscreen 거부 → CSS fallback */ }
    }
    // Fullscreen API 미지원/거부: CSS 기반 presentation (완전한 OS 전체화면은 불가)
    setFallback(true);
    setPresentation(true);
    toast.info('브라우저 전체화면을 사용할 수 없어 화면 내 프레젠테이션 모드로 표시합니다. ESC로 종료하세요.');
  }, []);

  const exitPresentation = useCallback(() => {
    if (!fallback && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => { /* fullscreenchange 가 상태 동기화 */ });
      return; // fullscreenchange 핸들러가 presentation=false 처리
    }
    setPresentation(false);
    setFallback(false);
  }, [fallback]);

  // 브라우저 자체 ESC 종료 등 외부 fullscreen 상태 변화 동기화 (native 모드)
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && !fallback) { setPresentation(false); }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [fallback]);

  // CSS fallback presentation 은 브라우저 ESC 가 없으므로 keydown 으로 종료 제공
  useEffect(() => {
    if (!presentation || !fallback) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPresentation(false); setFallback(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presentation, fallback]);

  // BRAND-PLAYER-UX-5 — F 키: 전체화면 진입/종료 토글. Input(검색 등) 입력 중에는 무시.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      e.preventDefault();
      if (presentation) exitPresentation(); else void enterPresentation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presentation, enterPresentation, exitPresentation]);

  // 매장/키오스크 모드: crossfade off + wake lock (전역) — store player 와 동일
  //
  // BRAND-PLAYER-24H-DEFAULT — 브랜드 플레이어는 24시간 연속 재생이 기본이다.
  // 브랜드 플레이어에는 매장 스케줄 훅(useStorePlaybackPolicy)을 붙이지 않으므로 영업시간
  // break/closed 로 음악이 끊기지 않는다. 다만 scheduleSuppressed 는 playerStore 의 전역
  // 상태라, 같은 탭에서 매장 플레이어(/business/player)를 먼저 쓰다가 넘어온 경우 게이트가
  // 남아 있으면 setQueue 가 playing=false 로 큐만 깔고 정지한다. 진입 시 명시적으로 푼다.
  useEffect(() => {
    setBusinessMode(true);
    enableForBusinessMode();
    usePlayerStore.getState().setScheduleSuppression(null);
  }, [setBusinessMode, enableForBusinessMode]);

  // 브랜드/서비스 로고 로드(멱등). AppShell 밖 kiosk 라우트에서도 로고 확보.
  useEffect(() => { void loadBrandSettings(); }, [loadBrandSettings]);

  // config 로드 + (최초 1회) 큐 세팅
  const loadConfig = useCallback(async (opts?: { requeueIfEmpty?: boolean }) => {
    if (!brandId || !token) return;
    try {
      const cfg = await getBrandPlayerConfig(brandId, token);
      setConfig(cfg);
      setError(null);
      const { playable } = filterPlayableTracks(cfg.playlist ?? []);
      const alreadyQueuedForBrand = queuedBrandRef.current === brandId;
      const queueEmpty = usePlayerStore.getState().queue.length === 0;
      // 최초 진입 시 큐 세팅. 재조회(reconnect)에서는 큐가 비었을 때만 재설정(재생 중단 방지).
      if (playable.length > 0 && (!alreadyQueuedForBrand || (opts?.requeueIfEmpty && queueEmpty))) {
        const playlistRow: PlaylistRow = {
          id: cfg.brand.id, title: cfg.brand.name, category: 'brand', business_category: null,
          thumbnail_url: null, description: null, is_business_only: true, time_slot: null,
          sort_order: 0, created_at: new Date().toISOString(),
        };
        setShuffle(true);
        setRepeat('all'); // 24h 무한 반복
        setQueue(playable, 0, playlistRow, null, { dailySeedShuffle: true });
        queuedBrandRef.current = brandId;
      }
    } catch (err) {
      // config 실패: 기존 큐 유지 (재생 중단 금지). 최초 로드 실패만 화면 에러 노출.
      if (queuedBrandRef.current !== brandId) {
        setError(err instanceof Error ? err.message : '브랜드 설정을 불러오지 못했어요.');
      }
    } finally {
      setLoading(false);
    }
  }, [brandId, token, setQueue, setShuffle, setRepeat]);

  useEffect(() => {
    if (!brandId) return;
    if (!token) { navigate('/brand', { replace: true }); return; }
    setLoading(true);
    void loadConfig();
  }, [brandId, token, loadConfig, navigate]);

  // 네트워크 재연결 시 config 재조회 (미디어/정책 갱신 + 큐 비었으면 재설정)
  useEffect(() => {
    const onOnline = () => { void loadConfig({ requeueIfEmpty: true }); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [loadConfig]);

  // BRAND-DEVICE-BINDING-1: 진입 시 Device Binding 서버 재검증(자동 진입 게이트).
  // 저장값만으로 승인하지 않는다. 소유자/미폐기/미만료/활성 브랜드가 아니면 로컬 토큰 제거 후 코드 화면.
  // 네트워크 오류는 이미 재생 중인 세션을 강제 종료하지 않는다(기존 offline 정책) — config 로드가 최종 게이트.
  useEffect(() => {
    if (!brandId || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const v = await verifyBrandDeviceBinding(brandId, token);
        if (cancelled || v.ok) return;
        clearBrandToken(brandId);
        navigate('/brand', { replace: true, state: { fromPlayerReject: true, reason: v.reason } });
      } catch { /* 일시 네트워크 오류 → 무시(무한 로딩/강제 종료 금지) */ }
    })();
    return () => { cancelled = true; };
  }, [brandId, token, navigate]);

  // 이 기기 연결 해제 / 다른 매장 연결 — 공식 Player 정지 경로 사용(audio/queue 엔진 미변경).
  const disconnectDevice = useCallback(async () => {
    if (!brandId || !token) return;
    try { await revokeBrandDeviceByToken(brandId, token); } catch { /* 서버 실패해도 로컬 정리 진행 */ }
    clearBrandToken(brandId);
    pause();
    navigate('/brand', { replace: true, state: { deviceRevoked: true } });
  }, [brandId, token, pause, navigate]);

  const switchStore = useCallback(() => {
    if (!brandId) return;
    clearBrandToken(brandId);
    pause();
    navigate('/brand', { replace: true, state: { switchStore: true } });
  }, [brandId, pause, navigate]);

  // 나가기 — 플레이어 종료. 저장된 매장 코드(device binding)는 '유지'해서 다음에 코드 없이
  // 자동 연결되게 한다(clearBrandToken 호출 안 함). 재생만 정지하고 앱 홈으로 이동.
  // (기존 버그: navigate('/brand') 만 하면 저장된 토큰 때문에 BrandPage 가 즉시 플레이어로
  //  자동 재진입 → "나가지지 않음". 홈으로 나가면 자동진입 대상이 아니라 정상 종료됨.)
  const exitPlayer = useCallback(() => {
    const ok = window.confirm(
      '브랜드 플레이어를 종료할까요?\n\n저장된 매장 코드는 유지되어, 다음에 코드 입력 없이 자동으로 다시 연결됩니다.',
    );
    if (!ok) return;
    pause();
    navigate('/');
  }, [pause, navigate]);

  // heartbeat
  useBrandPlayerHeartbeat({ brandId: brandId ?? null, sessionToken: token, enabled: !!brandId && !!token });

  // debug dump
  useEffect(() => {
    const w = window as unknown as { __brandPlayerDebug?: () => unknown };
    w.__brandPlayerDebug = () => {
      const s = usePlayerStore.getState();
      return {
        brandId, brandName: config?.brand.name ?? null,
        online, wakeLockActive,
        queueLength: s.queue.length, index: s.index, playing: s.playing,
        currentTrack: s.queue[s.index]?.title ?? null,
        mediaCount: config?.media.length ?? 0,
        policy: config?.policy ?? null,
      };
    };
    return () => { delete w.__brandPlayerDebug; };
  }, [brandId, config, online, wakeLockActive]);

  const current = queue[index];
  const hasQueue = queue.length > 0;
  // BRAND-PLAYER-UX-4 — 자켓 표시(Priority 3)용 현재/다음 자켓. 다음은 preload 힌트(선형 근사).
  const artworkUrl = current?.cover_url ?? null;
  const nextArtworkUrl = queue[index + 1]?.cover_url ?? queue[0]?.cover_url ?? null;
  // 사이니지 설정(전환효과/시간 + presentation 표시옵션). 레거시/null 은 default(fade/500/전부 off)로 정규화.
  const signage = normalizeSignageSettings(config?.signage);

  // 세션 없음 → 리다이렉트 처리 중
  if (!token) return null;

  if (loading && !config) {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black text-white">
        <Loader2 size={32} className="animate-spin text-accent" />
      </div>
    );
  }

  if (error && !hasQueue) {
    return (
      <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-4 bg-black px-6 text-center text-white">
        <Music size={40} className="text-white/40" />
        <p className="text-lg font-bold">{error}</p>
        <div className="flex gap-2">
          <button onClick={() => { setLoading(true); void loadConfig({ requeueIfEmpty: true }); }} className="rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-black">다시 시도</button>
          <button onClick={() => { if (brandId) clearBrandToken(brandId); navigate('/brand'); }} className="rounded-xl bg-white/10 px-5 py-2.5 text-sm font-bold">코드 다시 입력</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-black text-white" data-presentation-mode={presentation}>
      {/* 자동재생 차단 / 업데이트 대기 안내 — 무인 매장에서 토스트는 아무도 못 본다.
          전체화면(presentation) 위에도 떠야 하므로 z-[120] (BrandPresentationOverlays 보다 위). */}
      <PlaybackBlockedOverlay />
      {/* 상단 최소 바 (presentation 모드에서 숨김) */}
      <header className={`flex items-center justify-between gap-3 px-5 py-3 ${presentation ? 'hidden' : ''}`}>
        <div className="flex items-center gap-2 text-xs font-semibold">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1">
            <Sparkles size={12} className="text-accent" /> {config?.brand.name ?? '브랜드'}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${online ? 'bg-emerald-500/20 text-emerald-200' : 'bg-red-500/20 text-red-200'}`}>
            {online ? <Wifi size={12} /> : <WifiOff size={12} />}{online ? '온라인' : '오프라인'}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-white/60">
            <ShieldCheck size={12} /> 24시간 재생 준비됨
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={switchStore} title="다른 매장 코드 입력" className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20">
            <SwitchIcon size={13} /> 다른 매장
          </button>
          <button onClick={() => void disconnectDevice()} title="이 기기의 매장 연결 해제" className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20">
            <LogOut size={13} /> 연결 해제
          </button>
          <button onClick={exitPlayer} title="플레이어 종료 (저장된 코드는 유지 — 다음에 자동 연결)" className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20">
            <X size={14} /> 나가기
          </button>
        </div>
      </header>

      {/* 사이니지 (화면 대부분) — presentation 진입 시 이 컨테이너만 Fullscreen 대상.
          audio 는 전역 <Player> 소유 → fullscreen/chrome 토글이 audio element 에 영향 없음. */}
      <div
        ref={presentationRef}
        className={`relative overflow-hidden bg-black ${presentation && fallback ? 'fixed inset-0 z-[100]' : 'flex-1'}`}
      >
        <BrandVisualStage
          media={config?.media ?? []}
          brandName={config?.brand.name ?? '브랜드'}
          logoUrl={brandLogoUrl}
          artworkUrl={artworkUrl}
          nextArtworkUrl={nextArtworkUrl}
          trackTitle={current?.title ?? null}
          trackArtist={current?.artist ?? null}
          className="absolute inset-0 h-full w-full"
          chromeHidden={presentation}
          transition={{ effect: signage.transition_effect, durationMs: signage.transition_duration_ms }}
          showSlideDots={signage.show_slide_dots}
        />
        {/* presentation 표시옵션 오버레이(브랜드명/현재곡/시계) — 전체화면에서만, 선택된 것만. */}
        {presentation && (
          <BrandPresentationOverlays
            show={{ brandName: signage.show_brand_name, nowPlaying: signage.show_now_playing, clock: signage.show_clock }}
            brandName={config?.brand.name ?? '브랜드'}
            nowPlaying={current ? { title: current.title, artist: current.artist } : null}
          />
        )}
        {/* BRAND-PLAYER-UX-4 — 전체화면 하단 Control Bar + Queue Viewer.
            기존 Player command(play/pause/next/prev/jumpTo)만 사용 → audio/queue/scheduler 불변. */}
        <BrandFullscreenControls active={presentation} onExit={exitPresentation} />
      </div>

      {/* 하단 음악 상태 + 컨트롤 (작게) — presentation 모드에서 숨김 */}
      <footer className={`flex items-center gap-4 border-t border-white/10 bg-black/60 px-5 py-3 backdrop-blur ${presentation ? 'hidden' : ''}`}>
        <div className="min-w-0 flex-1">
          {hasQueue && current ? (
            <>
              <p className="truncate text-sm font-bold">{current.title}</p>
              <p className="truncate text-xs text-white/55">{current.artist ?? '—'}</p>
            </>
          ) : (
            <p className="text-sm text-white/60">재생 가능한 곡이 없어요. 브랜드 음악 정책을 확인해주세요.</p>
          )}
          {duration > 0 && (
            <div className="mt-1.5 h-1 w-full max-w-md overflow-hidden rounded-full bg-white/15">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.min(100, (currentTime / duration) * 100)}%` }} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prev} aria-label="이전 곡" className="rounded-full bg-white/10 p-2.5 hover:bg-white/20"><SkipBack size={18} fill="currentColor" /></button>
          <button onClick={() => (playing ? pause() : play())} aria-label={playing ? '일시정지' : '재생'} className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-black hover:bg-accent/90">
            {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-0.5" />}
          </button>
          <button onClick={() => next()} aria-label="다음 곡" className="rounded-full bg-white/10 p-2.5 hover:bg-white/20"><SkipForward size={18} fill="currentColor" /></button>
          {/* Presentation Fullscreen 진입 — 저장 이미지만 전체화면. 음악은 계속 재생. */}
          <button
            onClick={() => void enterPresentation()}
            aria-label="전체화면 (이미지 프레젠테이션)"
            aria-pressed={presentation}
            title="저장된 이미지만 전체화면으로 표시 (음악 계속 재생)"
            className="rounded-full bg-white/10 p-2.5 hover:bg-white/20"
          >
            <Maximize2 size={18} />
          </button>
        </div>
      </footer>

      {/* autoplay 차단 대비: 큐는 있는데 정지 상태면 큰 시작 버튼 오버레이 (presentation 모드에서 숨김) */}
      {!presentation && hasQueue && !playing && (
        <button onClick={() => play()} className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-accent px-6 py-3 text-sm font-bold text-black shadow-lg hover:bg-accent/90">
          ▶ 재생 시작 / 다시 재생
        </button>
      )}
      {!presentation && wakeLockSupported && !wakeLockActive && playing && (
        <p className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] text-white/60">화면 꺼짐 방지 대기 중…</p>
      )}
    </div>
  );
}
