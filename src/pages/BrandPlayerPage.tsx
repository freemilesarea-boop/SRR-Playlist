// Phase BRAND-1 — 브랜드 전용 플레이어 (/brand/player/:brandId).
// StorePlayerPage 패턴: 전역 <Player> 의 audio/큐를 그대로 소비만 한다 (audio element 미터치).
// 이미지 사이니지는 BrandSignage 가 독립 DOM 으로 처리 → audio remount 없음.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Play, Pause, SkipForward, SkipBack, X, Wifi, WifiOff, Music, Loader2, Sparkles, ShieldCheck } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import { usePlaybackHealthStore } from '@/store/playbackHealthStore';
import { usePlaybackSettingsStore } from '@/store/playbackSettingsStore';
import { useBusinessStore } from '@/store/businessStore';
import { getBrandPlayerConfig } from '@/lib/api/brandPlayerApi';
import { getBrandToken, clearBrandToken } from '@/lib/brandSession';
import { filterPlayableTracks } from '@/lib/trackPlayability';
import { useBrandPlayerHeartbeat } from '@/hooks/useBrandPlayerHeartbeat';
import BrandSignage from '@/components/brand/BrandSignage';
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

  const { online, wakeLockSupported, wakeLockActive } = usePlaybackHealthStore();

  const [config, setConfig] = useState<BrandPlayerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const queuedBrandRef = useRef<string | null>(null); // 이 브랜드로 큐 세팅했는지

  // 매장/키오스크 모드: crossfade off + wake lock (전역) — store player 와 동일
  useEffect(() => {
    setBusinessMode(true);
    enableForBusinessMode();
  }, [setBusinessMode, enableForBusinessMode]);

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
    <div className="fixed inset-0 z-[90] flex flex-col bg-black text-white">
      {/* 상단 최소 바 */}
      <header className="flex items-center justify-between gap-3 px-5 py-3">
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
        <button onClick={() => navigate('/brand')} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20">
          <X size={14} /> 나가기
        </button>
      </header>

      {/* 사이니지 (화면 대부분) */}
      <div className="relative flex-1 overflow-hidden">
        <BrandSignage
          items={config?.media ?? []}
          brandName={config?.brand.name ?? '브랜드'}
          className="absolute inset-0 h-full w-full"
        />
      </div>

      {/* 하단 음악 상태 + 컨트롤 (작게) */}
      <footer className="flex items-center gap-4 border-t border-white/10 bg-black/60 px-5 py-3 backdrop-blur">
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
          <button onClick={next} aria-label="다음 곡" className="rounded-full bg-white/10 p-2.5 hover:bg-white/20"><SkipForward size={18} fill="currentColor" /></button>
        </div>
      </footer>

      {/* autoplay 차단 대비: 큐는 있는데 정지 상태면 큰 시작 버튼 오버레이 */}
      {hasQueue && !playing && (
        <button onClick={() => play()} className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-accent px-6 py-3 text-sm font-bold text-black shadow-lg hover:bg-accent/90">
          ▶ 재생 시작 / 다시 재생
        </button>
      )}
      {wakeLockSupported && !wakeLockActive && playing && (
        <p className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] text-white/60">화면 꺼짐 방지 대기 중…</p>
      )}
    </div>
  );
}
